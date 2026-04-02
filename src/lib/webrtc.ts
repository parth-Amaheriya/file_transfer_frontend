import type { Message } from "./api";

// Check if WebRTC is available
const isWebRTCAvailable = typeof RTCPeerConnection !== 'undefined';

// Check if File System Access API is available
const isFileSystemAccessAvailable = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export interface FileTransferProgress {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'sending' | 'receiving' | 'completed' | 'failed';
}

interface ReceivedFileData {
  chunks?: Map<number, Uint8Array>; // For memory buffer mode
  fileHandle?: FileSystemFileHandle; // For streaming mode
  totalSize: number;
  mimeType: string;
  fileId: string;
  expectedChunks: number;
  startTime: number;
  mode: 'memory' | 'streaming'; // Which mode is being used
  bytesWritten?: number; // For streaming mode
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signalingServer: string;
  private pairingId: string;
  private deviceId: string;
  private isInitiator: boolean;
  private onMessage: (message: Message) => void;
  private onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  private onFileProgress: (progress: FileTransferProgress) => void;
  private signalingInterval: number | null = null;
  private connectionTimeout: number | null = null;
  private pendingIceCandidates: RTCIceCandidate[] = []; // Buffer ICE candidates until remote description is set
  private receivedFiles: Map<string, ReceivedFileData> = new Map();
  private activeTransfers: Map<string, { cancelled: boolean; fileId?: string }> = new Map(); // Track active file transfers for cancellation

  constructor(
    signalingServer: string,
    pairingId: string,
    deviceId: string,
    isInitiator: boolean,
    onMessage: (message: Message) => void,
    onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    onFileProgress: (progress: FileTransferProgress) => void
  ) {
    this.signalingServer = signalingServer;
    this.pairingId = pairingId;
    this.deviceId = deviceId;
    this.isInitiator = isInitiator;
    this.onMessage = onMessage;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onFileProgress = onFileProgress;
  }

  async initialize(): Promise<void> {
    if (!isWebRTCAvailable) {
      throw new Error('WebRTC is not available in this environment');
    }

    // Create peer connection
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('ICE candidate generated:', event.candidate);
        this.sendSignalingMessage({
          type: 'ice_candidate',
          data: event.candidate
        });
      } else {
        console.log('ICE candidate gathering complete');
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.peerConnection!.iceConnectionState);
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Peer connection state:', this.peerConnection!.connectionState);
      this.onConnectionStateChange(this.peerConnection!.connectionState);

      // Clear timeout if connected
      if (this.peerConnection!.connectionState === 'connected') {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
      }
    };

    this.peerConnection.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', this.peerConnection!.iceGatheringState);
    };

    // Create data channel if initiator
    if (this.isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('data', {
        ordered: true,
        maxRetransmits: 10, // Increase retransmits for reliability (cannot use with maxPacketLifeTime)
        protocol: 'file-transfer'
      });
      this.setupDataChannel();
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    // Start signaling
    this.startSignaling();

    // Set connection timeout (30 seconds)
    this.connectionTimeout = window.setTimeout(() => {
      if (this.peerConnection?.connectionState !== 'connected') {
        console.error('WebRTC connection timeout - no connection established within 30 seconds');
        this.onConnectionStateChange('failed');
      }
    }, 30000);
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.binaryType = 'arraybuffer'; // Enable binary data transfer

    this.dataChannel.onopen = () => {
      console.log('Data channel opened successfully');
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
    };

    this.dataChannel.onerror = (event) => {
      console.error('Data channel error:', event);
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };
  }

  private async requestFileHandle(filename: string, mimeType: string): Promise<FileSystemFileHandle> {
    try {
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: mimeType || 'File',
            accept: { [mimeType || 'application/octet-stream']: ['.bin'] }
          }
        ]
      });
      console.log(`File handle obtained for: ${filename}`);
      return fileHandle;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') {
        throw new Error('User cancelled file save');
      }
      throw error;
    }
  }

  private async writeChunkToFile(fileHandle: FileSystemFileHandle, chunkData: Uint8Array): Promise<void> {
    try {
      const writable = await fileHandle.createWritable();
      // Convert to plain Uint8Array without shared buffer type issues
      const plainBuffer = new Uint8Array(chunkData);
      await writable.write(plainBuffer as any);
      await writable.close();
    } catch (error) {
      console.error('Error writing chunk to file:', error);
      throw error;
    }
  }

  private async appendChunkToFile(fileHandle: FileSystemFileHandle, chunkData: Uint8Array, offset: number): Promise<void> {
    try {
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek(offset);
      // Convert to plain Uint8Array without shared buffer type issues
      const plainBuffer = new Uint8Array(chunkData);
      await writable.write(plainBuffer as any);
      await writable.close();
    } catch (error) {
      console.error('Error appending chunk to file:', error);
      throw error;
    }
  }

  private async handleDataChannelMessage(data: ArrayBuffer | string): Promise<void> {
    try {
      if (typeof data === 'string') {
        // Handle JSON messages
        const message: Message = JSON.parse(data);

        if (message.type === 'file_init' && message.filename && message.file_size) {
          // Start receiving file
          const fileId = Math.random().toString(36).substr(2, 9);
          // Use same chunk size calculation as sender
          const chunkSize = message.file_size < 1024 * 1024 ? 16 * 1024 :
                           message.file_size < 100 * 1024 * 1024 ? 64 * 1024 :
                           128 * 1024;
          const expectedChunks = Math.ceil(message.file_size / chunkSize);

          console.log(`Starting to receive file: ${message.filename} (${message.file_size} bytes), expected chunks: ${expectedChunks}`);

          // Decide which mode to use: streaming for files >100MB when available, memory buffer otherwise
          let mode: 'memory' | 'streaming' = 'memory';
          let fileHandle: FileSystemFileHandle | undefined;

          if (isFileSystemAccessAvailable && message.file_size > 100 * 1024 * 1024) {
            try {
              console.log('File size >100MB and FileSystem API available, requesting save location...');
              fileHandle = await this.requestFileHandle(message.filename, message.mime_type);
              mode = 'streaming';
              console.log('File system streaming mode enabled');
            } catch (error) {
              console.warn('Failed to enable streaming mode, falling back to memory buffer:', error);
              mode = 'memory';
            }
          }

          const receivedFileData: ReceivedFileData = {
            totalSize: message.file_size,
            mimeType: message.mime_type || '',
            fileId,
            expectedChunks,
            startTime: Date.now(),
            mode,
            chunks: mode === 'memory' ? new Map() : undefined,
            fileHandle: mode === 'streaming' ? fileHandle : undefined,
            bytesWritten: mode === 'streaming' ? 0 : undefined
          };

          this.receivedFiles.set(message.filename, receivedFileData);

          this.onFileProgress({
            id: fileId,
            name: message.filename,
            size: message.file_size,
            progress: 0,
            status: 'receiving'
          });

          console.log(`File reception mode: ${mode} (${message.file_size} bytes)`);

        } else if (message.type === 'file_end' && message.filename) {
          // File transfer complete
          const fileData = this.receivedFiles.get(message.filename);
          if (fileData) {
            const totalTime = Date.now() - fileData.startTime;
            const avgSpeed = fileData.totalSize / (totalTime / 1000) / (1024 * 1024); // MB/s
            console.log(`File reception completed: ${message.filename} in ${totalTime}ms (${avgSpeed.toFixed(2)} MB/s)`);

            if (fileData.mode === 'streaming') {
              // Streaming mode: file is already on disk
              console.log(`Streaming complete, file saved: ${message.filename}`);
              
              this.onFileProgress({
                id: fileData.fileId,
                name: message.filename,
                size: fileData.totalSize,
                progress: 100,
                status: 'completed'
              });
            } else {
              // Memory buffer mode: combine chunks and download
              if (fileData.chunks) {
                const sortedChunks = Array.from(fileData.chunks.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([, chunk]) => chunk);

                const totalSize = sortedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const combined = new Uint8Array(totalSize);
                let offset = 0;
                for (const chunk of sortedChunks) {
                  combined.set(chunk, offset);
                  offset += chunk.length;
                }

                // Create blob and trigger download
                const blob = new Blob([combined], { type: fileData.mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = message.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                // Update progress
                this.onFileProgress({
                  id: fileData.fileId,
                  name: message.filename,
                  size: fileData.totalSize,
                  progress: 100,
                  status: 'completed'
                });
              }
            }

            this.receivedFiles.delete(message.filename);
          }
        }

        this.onMessage(message);

      } else if (data instanceof ArrayBuffer) {
        // Handle binary messages
        const view = new DataView(data);
        const messageType = view.getUint8(0);

        if (messageType === 2) { // Binary file chunk
          const chunkIndex = view.getUint32(1, true);
          const chunkData = data.slice(5); // Skip header

          // Find the file being received (assuming one at a time for simplicity)
          const fileEntries = Array.from(this.receivedFiles.entries());
          if (fileEntries.length > 0) {
            const [filename, fileData] = fileEntries[0];
            const uint8Array = new Uint8Array(chunkData);

            if (fileData.mode === 'streaming' && fileData.fileHandle) {
              // Write chunk directly to file
              try {
                const chunkSize = fileData.totalSize < 1024 * 1024 ? 16 * 1024 :
                                 fileData.totalSize < 100 * 1024 * 1024 ? 64 * 1024 :
                                 128 * 1024;
                const offset = chunkIndex * chunkSize;
                
                await this.appendChunkToFile(fileData.fileHandle, uint8Array, offset);
                fileData.bytesWritten = (fileData.bytesWritten || 0) + uint8Array.length;

                const receivedChunks = chunkIndex + 1;
                const progress = (receivedChunks / fileData.expectedChunks) * 100;

                // Log progress for large files
                if (receivedChunks % 10 === 0 || receivedChunks === fileData.expectedChunks) {
                  const elapsed = Date.now() - fileData.startTime;
                  const speed = (fileData.bytesWritten || 0) / (elapsed / 1000) / (1024 * 1024); // MB/s
                  console.log(`Streamed ${receivedChunks}/${fileData.expectedChunks} chunks (${progress.toFixed(1)}%) - ${speed.toFixed(2)} MB/s`);
                }

                this.onFileProgress({
                  id: fileData.fileId,
                  name: filename,
                  size: fileData.totalSize,
                  progress,
                  status: 'receiving'
                });
              } catch (error) {
                console.error('Error writing chunk to file:', error);
                this.onFileProgress({
                  id: fileData.fileId,
                  name: filename,
                  size: fileData.totalSize,
                  progress: 0,
                  status: 'failed'
                });
              }
            } else {
              // Memory buffer mode: store chunk as before
              if (fileData.chunks) {
                fileData.chunks.set(chunkIndex, uint8Array);

                const receivedChunks = fileData.chunks.size;
                const progress = (receivedChunks / fileData.expectedChunks) * 100;

                // Log progress for large files
                if (receivedChunks % 100 === 0 || receivedChunks === fileData.expectedChunks) {
                  const elapsed = Date.now() - fileData.startTime;
                  const speed = (receivedChunks * (fileData.totalSize / fileData.expectedChunks)) / (elapsed / 1000) / (1024 * 1024); // MB/s
                  console.log(`Received ${receivedChunks}/${fileData.expectedChunks} chunks (${progress.toFixed(1)}%) - ${speed.toFixed(2)} MB/s`);
                }

                this.onFileProgress({
                  id: fileData.fileId,
                  name: filename,
                  size: fileData.totalSize,
                  progress,
                  status: 'receiving'
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
    }
  }

  private async startSignaling(): Promise<void> {
    if (this.isInitiator) {
      console.log('Creating offer as initiator');
      // Create offer
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);

      console.log('Sending offer:', offer);
      await this.sendSignalingMessage({
        type: 'offer',
        data: offer
      });
    }

    // Poll for signaling messages
    this.signalingInterval = window.setInterval(async () => {
      try {
        const messages = await this.getSignalingMessages();
        if (messages.length > 0) {
          console.log(`Received ${messages.length} signaling messages`);
        }
        for (const message of messages) {
          try {
            await this.handleSignalingMessage(message);
          } catch (err) {
            console.error('Error handling individual signaling message:', err);
          }
        }
      } catch (error) {
        console.error('Error polling signaling messages:', error);
      }
    }, 1000);
  }

  private async handleSignalingMessage(message: any): Promise<void> {
    console.log('Handling signaling message type:', message.type, 'Full message:', message);

    try {
      if (message.type === 'offer' && !this.isInitiator) {
        console.log('Received offer, creating answer');
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));
        const answer = await this.peerConnection!.createAnswer();
        await this.peerConnection!.setLocalDescription(answer);

        console.log('Sending answer:', answer);
        await this.sendSignalingMessage({
          type: 'answer',
          data: answer
        });

        // Process any buffered ICE candidates now that remote description is set
        await this.processPendingIceCandidates();

      } else if (message.type === 'answer' && this.isInitiator) {
        console.log('Received answer, setting remote description');
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));

        // Process any buffered ICE candidates now that remote description is set
        await this.processPendingIceCandidates();

      } else if (message.type === 'ice_candidate') {
        const candidate = new RTCIceCandidate(message.data);

        // If remote description is not set yet, buffer the candidate
        if (!this.peerConnection!.remoteDescription) {
          console.log('Buffering ICE candidate until remote description is set');
          this.pendingIceCandidates.push(candidate);
        } else {
          console.log('Adding ICE candidate immediately');
          await this.peerConnection!.addIceCandidate(candidate);
        }
      } else {
        console.warn('Unknown signaling message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling signaling message:', error, 'Message was:', message);
    }
  }

  private async processPendingIceCandidates(): Promise<void> {
    console.log(`Processing ${this.pendingIceCandidates.length} buffered ICE candidates`);
    for (const candidate of this.pendingIceCandidates) {
      try {
        await this.peerConnection!.addIceCandidate(candidate);
        console.log('Added buffered ICE candidate');
      } catch (error) {
        console.error('Failed to add buffered ICE candidate:', error);
      }
    }
    this.pendingIceCandidates = [];
  }

  private async sendSignalingMessage(message: any): Promise<void> {
    console.log('Sending signaling message:', message);
    const response = await fetch(`${this.signalingServer}/api/pairing/${this.pairingId}/signaling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to send signaling message:', response.status, errorText);
      throw new Error('Failed to send signaling message');
    }
    console.log('Signaling message sent successfully');
  }

  private async getSignalingMessages(): Promise<any[]> {
    const response = await fetch(`${this.signalingServer}/api/pairing/${this.pairingId}/signaling`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to get signaling messages:', response.status, errorText);
      // Return empty array on 404 or 409, throw on other errors
      if (response.status === 404 || response.status === 409) {
        console.warn('Pairing not connected or not found yet');
        return [];
      }
      throw new Error('Failed to get signaling messages');
    }
    const messages = await response.json();
    return messages;
  }

  async sendMessage(message: Message): Promise<void> {
    if (!this.dataChannel) {
      throw new Error('Data channel not created yet');
    }
    
    if (this.dataChannel.readyState !== 'open') {
      console.warn(`Data channel state is '${this.dataChannel.readyState}', waiting for it to open...`);
      await this.waitForDataChannelOpen();
    }

    await this.waitForBufferSpace();
    this.dataChannel.send(JSON.stringify(message));
  }

  cancelFileTransfer(fileId: string): void {
    console.log(`Cancelling file transfer: ${fileId}`);
    for (const [key, transfer] of this.activeTransfers.entries()) {
      if (transfer.fileId === fileId) {
        transfer.cancelled = true;
        console.log(`Marked transfer ${key} as cancelled`);
        break;
      }
    }
  }

  private async waitForDataChannelOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const maxWaitTime = 10000; // 10 seconds max
      const startTime = Date.now();

      const checkChannel = () => {
        if (this.dataChannel?.readyState === 'open') {
          console.log('Data channel is now open');
          resolve();
        } else if (Date.now() - startTime > maxWaitTime) {
          reject(new Error('Data channel did not open within 10 seconds'));
        } else {
          setTimeout(checkChannel, 100);
        }
      };
      checkChannel();
    });
  }

  async sendFile(file: File, onProgress?: (progress: number) => void): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    console.log(`Starting file transfer: ${file.name} (${file.size} bytes)`);

    const fileId = Math.random().toString(36).substr(2, 9);
    const transferKey = `transfer-${fileId}`;
    
    // Track this transfer for cancellation
    this.activeTransfers.set(transferKey, { cancelled: false, fileId });

    try {
      // Dynamic chunk size: smaller for small files, larger for big files
      const chunkSize = file.size < 1024 * 1024 ? 16 * 1024 : // 16KB for files < 1MB
                        file.size < 100 * 1024 * 1024 ? 64 * 1024 : // 64KB for files < 100MB
                        128 * 1024; // 128KB for larger files
      const totalChunks = Math.ceil(file.size / chunkSize);

      console.log(`Using chunk size: ${chunkSize} bytes, total chunks: ${totalChunks}`);

      // Update progress to sending
      this.onFileProgress({
        id: fileId,
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'sending'
      });

      // Send file start message (JSON)
      const startMessage: Message = {
        type: 'file_init',
        filename: file.name,
        file_size: file.size,
        mime_type: file.type,
        timestamp: Date.now()
      };

      await this.sendMessage(startMessage);

      let sentChunks = 0;
      const startTime = Date.now();

      // Send file in chunks (binary)
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Check if transfer was cancelled
        const transfer = this.activeTransfers.get(transferKey);
        if (transfer?.cancelled) {
          console.log(`File transfer cancelled: ${file.name}`);
          this.onFileProgress({
            id: fileId,
            name: file.name,
            size: file.size,
            progress: (sentChunks / totalChunks) * 100,
            status: 'failed'
          });
          this.activeTransfers.delete(transferKey);
          throw new Error('File transfer cancelled by user');
        }

        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        const arrayBuffer = await chunk.arrayBuffer();

        // Create binary message: [type(1), chunkIndex(4), data]
        const messageSize = 1 + 4 + arrayBuffer.byteLength;
        const messageBuffer = new ArrayBuffer(messageSize);
        const view = new DataView(messageBuffer);

        view.setUint8(0, 2); // Message type: file chunk (binary)
        view.setUint32(1, chunkIndex, true); // Chunk index

        // Copy chunk data
        const uint8Array = new Uint8Array(messageBuffer, 5);
        uint8Array.set(new Uint8Array(arrayBuffer));

        // Wait for buffer to have space before sending
        try {
          await this.waitForBufferSpace();
        } catch (error) {
          console.error(`Failed to wait for buffer space on chunk ${chunkIndex}:`, error);
          this.activeTransfers.delete(transferKey);
          throw new Error(`Buffer management failed: ${error}`);
        }

        // Check if data channel is still open
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
          this.activeTransfers.delete(transferKey);
          throw new Error('Data channel closed during file transfer');
        }

        try {
          this.dataChannel.send(messageBuffer);
        } catch (error) {
          console.error(`Failed to send chunk ${chunkIndex}:`, error);
          this.activeTransfers.delete(transferKey);
          throw new Error(`Failed to send data: ${error}`);
        }
        sentChunks++;

        const progress = (sentChunks / totalChunks) * 100;
        if (onProgress) onProgress(progress);

        this.onFileProgress({
          id: fileId,
          name: file.name,
          size: file.size,
          progress,
          status: 'sending'
        });

        // Log progress for large files
        if (sentChunks % 100 === 0 || sentChunks === totalChunks) {
          const elapsed = Date.now() - startTime;
          const speed = (sentChunks * chunkSize) / (elapsed / 1000) / (1024 * 1024); // MB/s
          console.log(`Sent ${sentChunks}/${totalChunks} chunks (${progress.toFixed(1)}%) - ${speed.toFixed(2)} MB/s`);
        }
      }

      // Send file end message (JSON)
      const endMessage: Message = {
        type: 'file_end',
        filename: file.name,
        timestamp: Date.now()
      };

      await this.sendMessage(endMessage);

      const totalTime = Date.now() - startTime;
      const avgSpeed = file.size / (totalTime / 1000) / (1024 * 1024); // MB/s
      console.log(`File transfer completed: ${file.name} in ${totalTime}ms (${avgSpeed.toFixed(2)} MB/s)`);

      // Update progress to completed
      this.onFileProgress({
        id: fileId,
        name: file.name,
        size: file.size,
        progress: 100,
        status: 'completed'
      });
    } finally {
      // Clean up the transfer record
      this.activeTransfers.delete(transferKey);
    }
  }

  private async waitForBufferSpace(): Promise<void> {
    return new Promise((resolve, reject) => {
      const maxWaitTime = 30000; // 30 seconds max wait
      const startTime = Date.now();

      const checkBuffer = () => {
        if (!this.dataChannel) {
          reject(new Error('Data channel not available'));
          return;
        }

        if (this.dataChannel.readyState !== 'open') {
          reject(new Error('Data channel is not open'));
          return;
        }

        if (this.dataChannel.bufferedAmount < 32 * 1024) { // Wait until buffer is less than 32KB
          resolve();
        } else {
          // Check timeout
          if (Date.now() - startTime > maxWaitTime) {
            reject(new Error('Timeout waiting for buffer space'));
            return;
          }

          // Wait a bit and check again
          setTimeout(checkBuffer, 5);
        }
      };
      checkBuffer();
    });
  }

  close(): void {
    if (this.signalingInterval) {
      clearInterval(this.signalingInterval);
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    // Clear any pending ICE candidates
    this.pendingIceCandidates = [];
  }
}