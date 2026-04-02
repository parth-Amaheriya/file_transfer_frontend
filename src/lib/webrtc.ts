import type { Message } from "./api";

// Check if WebRTC is available
const isWebRTCAvailable = typeof RTCPeerConnection !== 'undefined';

export interface FileTransferProgress {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'sending' | 'receiving' | 'completed' | 'failed';
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signalingServer: string;
  private pairingId: string;
  private deviceId: string;
  private isInitiator: boolean;
  private onMessage: (message: WebRTCMessage) => void;
  private onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  private onFileProgress: (progress: FileTransferProgress) => void;
  private signalingInterval: number | null = null;
  private connectionTimeout: number | null = null;
  private receivedFiles: Map<string, { chunks: Map<number, Uint8Array>; totalSize: number; mimeType: string; fileId: string; expectedChunks: number; startTime: number }> = new Map();

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
        maxPacketLifeTime: 3000,
        maxRetransmits: 10, // Increase retransmits for reliability
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

          this.receivedFiles.set(message.filename, {
            chunks: new Map(),
            totalSize: message.file_size,
            mimeType: message.mime_type || '',
            fileId,
            expectedChunks,
            startTime: Date.now()
          });

          this.onFileProgress({
            id: fileId,
            name: message.filename,
            size: message.file_size,
            progress: 0,
            status: 'receiving'
          });

        } else if (message.type === 'file_end' && message.filename) {
          // File transfer complete
          const fileData = this.receivedFiles.get(message.filename);
          if (fileData) {
            const totalTime = Date.now() - fileData.startTime;
            const avgSpeed = fileData.totalSize / (totalTime / 1000) / (1024 * 1024); // MB/s
            console.log(`File reception completed: ${message.filename} in ${totalTime}ms (${avgSpeed.toFixed(2)} MB/s)`);

            // Combine all chunks in order
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

            // Store chunk by index
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
          console.log('Received signaling messages:', messages);
        }
        for (const message of messages) {
          await this.handleSignalingMessage(message);
        }
      } catch (error) {
        console.error('Error polling signaling messages:', error);
      }
    }, 1000);
  }

  private async handleSignalingMessage(message: any): Promise<void> {
    console.log('Handling signaling message:', message);

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

    } else if (message.type === 'answer' && this.isInitiator) {
      console.log('Received answer, setting remote description');
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));

    } else if (message.type === 'ice_candidate') {
      console.log('Adding ICE candidate:', message.data);
      await this.peerConnection!.addIceCandidate(new RTCIceCandidate(message.data));
    }
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
      throw new Error('Failed to get signaling messages');
    }
    const messages = await response.json();
    return messages;
  }

  async sendMessage(message: WebRTCMessage): Promise<void> {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      await this.waitForBufferSpace();
      this.dataChannel.send(JSON.stringify(message));
    } else {
      throw new Error('Data channel not ready');
    }
  }

  async sendFile(file: File, onProgress?: (progress: number) => void): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    console.log(`Starting file transfer: ${file.name} (${file.size} bytes)`);

    const fileId = Math.random().toString(36).substr(2, 9);
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
        throw new Error(`Buffer management failed: ${error}`);
      }

      // Check if data channel is still open
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        throw new Error('Data channel closed during file transfer');
      }

      try {
        this.dataChannel.send(messageBuffer);
      } catch (error) {
        console.error(`Failed to send chunk ${chunkIndex}:`, error);
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
  }
}