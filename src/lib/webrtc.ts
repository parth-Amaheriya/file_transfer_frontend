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
        this.sendSignalingMessage({
          type: 'ice_candidate',
          data: event.candidate
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      this.onConnectionStateChange(this.peerConnection!.connectionState);
    };

    // Create data channel if initiator
    if (this.isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('data', {
        ordered: true,
        maxPacketLifeTime: 3000
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
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };
  }

  private async handleDataChannelMessage(data: ArrayBuffer | string): Promise<void> {
    try {
      if (typeof data === 'string') {
        const message: Message = JSON.parse(data);

        if (message.type === 'file_shared' && message.chunk_data && message.filename) {
          // Handle received file
          try {
            const binaryString = atob(message.chunk_data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const blob = new Blob([bytes], { type: message.mime_type });
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
              id: Math.random().toString(36).substr(2, 9),
              name: message.filename,
              size: message.file_size || 0,
              progress: 100,
              status: 'completed'
            });
          } catch (error) {
            console.error('Error processing received file:', error);
          }
        }

        this.onMessage(message);
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
    }
  }

  private async startSignaling(): Promise<void> {
    if (this.isInitiator) {
      // Create offer
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);

      await this.sendSignalingMessage({
        type: 'offer',
        data: offer
      });
    }

    // Poll for signaling messages
    this.signalingInterval = window.setInterval(async () => {
      try {
        const messages = await this.getSignalingMessages();
        for (const message of messages) {
          await this.handleSignalingMessage(message);
        }
      } catch (error) {
        console.error('Error polling signaling messages:', error);
      }
    }, 1000);
  }

  private async handleSignalingMessage(message: any): Promise<void> {
    if (message.type === 'offer' && !this.isInitiator) {
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);

      await this.sendSignalingMessage({
        type: 'answer',
        data: answer
      });

    } else if (message.type === 'answer' && this.isInitiator) {
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));

    } else if (message.type === 'ice_candidate') {
      await this.peerConnection!.addIceCandidate(new RTCIceCandidate(message.data));
    }
  }

  private async sendSignalingMessage(message: any): Promise<void> {
    const response = await fetch(`${this.signalingServer}/api/pairing/${this.pairingId}/signaling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    if (!response.ok) {
      throw new Error('Failed to send signaling message');
    }
  }

  private async getSignalingMessages(): Promise<any[]> {
    const response = await fetch(`${this.signalingServer}/api/pairing/${this.pairingId}/signaling`);
    if (!response.ok) {
      throw new Error('Failed to get signaling messages');
    }
    return response.json();
  }

  async sendMessage(message: WebRTCMessage): Promise<void> {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    }
  }

  async sendFile(file: File, onProgress?: (progress: number) => void): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    const fileId = Math.random().toString(36).substr(2, 9);

    // For now, send small files as base64. For larger files, implement chunking
    if (file.size > 50 * 1024 * 1024) { // 50MB limit for base64
      throw new Error('File too large. Maximum size is 50MB for now.');
    }

    // Update progress to sending
    this.onFileProgress({
      id: fileId,
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'sending'
    });

    // Read file as base64
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binaryString);

    if (onProgress) onProgress(50);

    // Send file message
    const message: Message = {
      type: 'file_shared',
      filename: file.name,
      file_size: file.size,
      mime_type: file.type,
      chunk_data: base64,
      timestamp: Date.now()
    } as Message;

    this.dataChannel.send(JSON.stringify(message));

    if (onProgress) onProgress(100);

    // Update progress
    this.onFileProgress({
      id: fileId,
      name: file.name,
      size: file.size,
      progress: 100,
      status: 'completed'
    });
  }

  close(): void {
    if (this.signalingInterval) {
      clearInterval(this.signalingInterval);
    }
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
  }
}