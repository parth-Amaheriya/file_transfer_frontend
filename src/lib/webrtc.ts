import type { Message, SignalingMessage } from "./api";

// Check if WebRTC is available
const isWebRTCAvailable = typeof RTCPeerConnection !== 'undefined';

// Check if File System Access API is available
const isFileSystemAccessAvailable = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

// Maximum memory buffer for receiving files before forcing streaming or warning
const MAX_MEMORY_BUFFER_BYTES = 200 * 1024 * 1024; // 200MB

const GOOGLE_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 45000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5000;
const RECOVERY_RETRY_DELAYS_MS = [1000, 3000, 7000, 15000, 30000];
const MAX_RECOVERY_ATTEMPTS = 5;
const DOWNLOADED_FILE_IDS_KEY = 'downloadedFileIds';
const DOWNLOADED_FILE_SIGNATURES_KEY = 'downloadedFileSignatures';

const readStoredStringSet = (storageKey: string): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(storageKey) || '[]'));
  } catch {
    return new Set<string>();
  }
};

const buildDownloadSignature = (fileData: {
  originDeviceId?: string;
  filename?: string;
  totalSize: number;
  mimeType: string;
  relayHop?: number;
  chunkHashes?: string[];
}): string => {
  return JSON.stringify([
    fileData.originDeviceId || 'unknown',
    fileData.filename || 'unknown',
    fileData.totalSize,
    fileData.mimeType || 'application/octet-stream',
    fileData.relayHop || 0,
    (fileData.chunkHashes || []).join(','),
  ]);
};

export interface FileTransferProgress {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'sending' | 'receiving' | 'completed' | 'failed' | 'cancelled';
}

interface ReceivedFileData {
  chunks?: Map<number, Uint8Array>; // For memory buffer mode
  fileHandle?: FileSystemFileHandle; // For streaming mode
  writeStream?: FileSystemWritableFileStream; // Reused writable stream for streaming mode
  totalSize: number;
  mimeType: string;
  originDeviceId?: string;
  fileId: string;
  expectedChunks: number;
  startTime: number;
  mode: 'memory' | 'streaming'; // Which mode is being used
  bytesWritten?: number; // For streaming mode
  cancelled?: boolean; // Flag to indicate cancellation
  relayHop?: number;
  chunkSize?: number;
  chunkHashes?: string[];
  filename?: string;
  writeQueue?: Promise<void>; // Serialize streaming writes to avoid race conditions
}

export interface ReceivedFileComplete {
  file: File;
  fileId: string;
  filename: string;
  mimeType: string;
  relayHop?: number;
}

export interface SwarmManifest {
  fileId: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  chunkCount: number;
  chunkHashes: string[];
  originDeviceId: string;
  targetPeerIds: string[];
}

export interface SwarmChunkRequest {
  fileId: string;
  chunkIndex: number;
}

export interface SwarmChunkReceipt {
  fileId: string;
  chunkIndex: number;
  chunk: Uint8Array;
  filename?: string;
  mimeType?: string;
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private dataChannelPromise: Promise<RTCDataChannel>;
  private dataChannelResolver: (dc: RTCDataChannel) => void;
  private signalingServer: string;
  private pairingId: string;
  private deviceId: string;
  private targetDeviceId: string;
  private isInitiator: boolean;
  private onMessage: (message: Message) => void;
  private onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  private onFileProgress: (progress: FileTransferProgress) => void;
  private onFileComplete: (file: ReceivedFileComplete) => void;
  private onSwarmChunkReceived?: (chunk: SwarmChunkReceipt) => void;
  private getChunkData?: (request: SwarmChunkRequest) => Promise<Uint8Array | null>;
  private signalingInterval: number | null = null;
  private connectionTimeout: number | null = null;
  private heartbeatInterval: number | null = null;
  private heartbeatMonitor: number | null = null;
  private recoveryTimer: number | null = null;
  private recoveryInProgress = false;
  private recoveryAttempts = 0;
  private lastHeartbeatAt = 0;
  private lastHeartbeatSentAt = 0;
  private isClosing = false;
  private isReconnecting = false;
  private pendingIceCandidates: RTCIceCandidate[] = []; // Buffer ICE candidates until remote description is set
  private receivedFiles: Map<string, ReceivedFileData> = new Map();
  private activeTransfers: Map<string, { cancelled: boolean; fileId?: string; filename?: string }> = new Map(); // Track active file transfers for cancellation
  private receivingFilesByFileId: Map<string, string> = new Map(); // Track fileId -> filename for receiving files
  private sendingFilesByFileId: Map<string, { filename: string; size: number }> = new Map(); // Track fileId -> {filename, size} for sending files

  constructor(
    signalingServer: string,
    pairingId: string,
    deviceId: string,
    targetDeviceId: string,
    isInitiator: boolean,
    onMessage: (message: Message) => void,
    onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    onFileProgress: (progress: FileTransferProgress) => void,
    onFileComplete: (file: ReceivedFileComplete) => void,
    onSwarmChunkReceived?: (chunk: SwarmChunkReceipt) => void,
    getChunkData?: (request: SwarmChunkRequest) => Promise<Uint8Array | null>
  ) {
    this.signalingServer = signalingServer;
    this.pairingId = pairingId;
    this.deviceId = deviceId;
    this.targetDeviceId = targetDeviceId;
    this.isInitiator = isInitiator;
    this.onMessage = onMessage;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onFileProgress = onFileProgress;
    this.onFileComplete = onFileComplete;
    this.onSwarmChunkReceived = onSwarmChunkReceived;
    this.getChunkData = getChunkData;
    this.dataChannelPromise = new Promise(resolve => this.dataChannelResolver = resolve);
  }

  private resetDataChannelPromise(): void {
    this.dataChannelPromise = new Promise((resolve) => {
      this.dataChannelResolver = resolve;
    });
  }

  private createPeerConnection(): RTCPeerConnection {
    const peerConnection = new RTCPeerConnection({
      iceServers: [
        ...GOOGLE_STUN_SERVERS.map((urls) => ({ urls })),
      ]
    });

    peerConnection.onicecandidate = (event) => {
      if (this.isClosing || this.isReconnecting) {
        return;
      }

      if (event.candidate) {
        console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] ICE candidate generated at ${new Date().toISOString()}:`, event.candidate);
        void this.sendSignalingMessage({
          type: 'ice_candidate',
          data: event.candidate,
          sender_device_id: this.deviceId,
          target_device_id: this.targetDeviceId
        });
      } else {
        console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] ICE candidate gathering complete at ${new Date().toISOString()}`);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] ICE connection state at ${new Date().toISOString()}:`, state);

      if (this.isClosing || this.isReconnecting) {
        return;
      }

      if (state === 'connected') {
        this.resetRecoveryState();
      } else if (state === 'disconnected' || state === 'failed') {
        void this.scheduleRecovery(`ICE state ${state}`);
      } else if (state === 'closed') {
        void this.rebuildPeerConnection('ICE state closed');
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Peer connection state at ${new Date().toISOString()}:`, state);

      if (this.isClosing || this.isReconnecting) {
        return;
      }

      this.onConnectionStateChange(state);

      if (state === 'connected') {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
        this.resetRecoveryState();
      } else if (state === 'disconnected' || state === 'failed') {
        void this.scheduleRecovery(`peer connection ${state}`);
      } else if (state === 'closed') {
        void this.rebuildPeerConnection('peer connection closed');
      }
    };

    peerConnection.onsignalingstatechange = () => {
      console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Signaling state at ${new Date().toISOString()}:`, peerConnection.signalingState);
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] ICE gathering state at ${new Date().toISOString()}:`, peerConnection.iceGatheringState);
    };

    if (this.isInitiator) {
      this.dataChannel = peerConnection.createDataChannel('data', {
        ordered: true,
        maxRetransmits: 30,
        protocol: 'file-transfer'
      });
      this.setupDataChannel();
    } else {
      peerConnection.ondatachannel = (event) => {
        if (this.isClosing || this.isReconnecting) {
          return;
        }

        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    return peerConnection;
  }

  async initialize(): Promise<void> {
    if (!isWebRTCAvailable) {
      throw new Error('WebRTC is not available in this environment');
    }

    this.peerConnection = this.createPeerConnection();

    // Start signaling
    await this.startSignaling();

    // Set connection timeout (60 seconds for more reliable connections)
    this.connectionTimeout = window.setTimeout(() => {
      if (this.peerConnection?.connectionState !== 'connected') {
        console.error('WebRTC connection timeout - no connection established within 60 seconds');
        this.onConnectionStateChange('failed');
      }
    }, 60000);
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannelResolver(this.dataChannel); // Resolve the promise

    this.dataChannel.binaryType = 'arraybuffer'; // Enable binary data transfer

    this.dataChannel.onopen = () => {
      console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Data channel opened successfully at ${new Date().toISOString()}`);
      this.startHeartbeat();
    };

    this.dataChannel.onclose = () => {
      console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Data channel closed at ${new Date().toISOString()}`);
      this.stopHeartbeat();
      if (!this.isClosing) {
        void this.scheduleRecovery('data channel closed');
      }
    };

    this.dataChannel.onerror = (event) => {
      console.error('Data channel error:', event);
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };
  }

  private resetRecoveryState(): void {
    this.recoveryAttempts = 0;
    this.recoveryInProgress = false;
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatMonitor !== null) {
      clearInterval(this.heartbeatMonitor);
      this.heartbeatMonitor = null;
    }
  }

  private startHeartbeat(): void {
    if (this.isClosing || !this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }

    this.stopHeartbeat();
    this.lastHeartbeatAt = Date.now();
    this.lastHeartbeatSentAt = 0;

    console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Starting heartbeat monitor at ${new Date(this.lastHeartbeatAt).toISOString()}`);
    void this.sendHeartbeatPing();

    this.heartbeatInterval = window.setInterval(() => {
      void this.sendHeartbeatPing();
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatMonitor = window.setInterval(() => {
      void this.checkHeartbeatHealth();
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }

  private async sendHeartbeatPing(): Promise<void> {
    if (this.isClosing || !this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }

    try {
      const timestamp = Date.now();
      this.lastHeartbeatSentAt = timestamp;
      this.dataChannel.send(JSON.stringify({ type: 'ping', timestamp }));
      console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Heartbeat ping sent at ${new Date(timestamp).toISOString()}`);
    } catch (error) {
      console.error(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Heartbeat ping failed at ${new Date().toISOString()}:`, error);
      await this.scheduleRecovery('heartbeat send failed');
    }
  }

  private async checkHeartbeatHealth(): Promise<void> {
    if (this.isClosing || !this.peerConnection || this.peerConnection.connectionState === 'closed') {
      return;
    }

    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      if (this.peerConnection.connectionState !== 'connected') {
        await this.scheduleRecovery('data channel unavailable');
      }
      return;
    }

    const elapsedSinceHeartbeat = Date.now() - this.lastHeartbeatAt;
    if (elapsedSinceHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      console.warn(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Heartbeat stale for ${elapsedSinceHeartbeat}ms; last ping at ${this.lastHeartbeatSentAt ? new Date(this.lastHeartbeatSentAt).toISOString() : 'never'}`);
      await this.scheduleRecovery('heartbeat timeout');
    }
  }

  private async scheduleRecovery(reason: string): Promise<void> {
    if (this.isClosing || this.isReconnecting || !this.peerConnection) {
      return;
    }

    if (this.peerConnection.connectionState === 'closed' || this.dataChannel?.readyState === 'closed') {
      await this.rebuildPeerConnection(reason);
      return;
    }

    if (this.recoveryInProgress || this.recoveryTimer !== null) {
      return;
    }

    if (this.peerConnection.connectionState === 'connected' && this.dataChannel?.readyState === 'open') {
      this.resetRecoveryState();
      return;
    }

    const delay = RECOVERY_RETRY_DELAYS_MS[Math.min(this.recoveryAttempts, RECOVERY_RETRY_DELAYS_MS.length - 1)];
    console.warn(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Scheduling recovery in ${delay}ms because ${reason}`);

    this.recoveryTimer = window.setTimeout(() => {
      this.recoveryTimer = null;
      void this.runRecovery(reason);
    }, delay);
  }

  private async runRecovery(reason: string): Promise<void> {
    if (this.isClosing || this.isReconnecting || !this.peerConnection) {
      return;
    }

    if (this.recoveryInProgress) {
      return;
    }

    if (this.peerConnection.connectionState === 'closed' || this.dataChannel?.readyState === 'closed') {
      await this.rebuildPeerConnection(reason);
      return;
    }

    if (this.peerConnection.connectionState === 'connected' && this.dataChannel?.readyState === 'open') {
      this.resetRecoveryState();
      return;
    }

    this.recoveryInProgress = true;
    this.recoveryAttempts += 1;
    const attempt = this.recoveryAttempts;

    console.warn(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Recovery attempt #${attempt} at ${new Date().toISOString()} because ${reason}`);

    try {
      try {
        this.peerConnection.restartIce();
        console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] restartIce() invoked`);
      } catch (restartError) {
        console.warn(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] restartIce() failed, continuing with renegotiation:`, restartError);
      }

      if (this.isInitiator) {
        await this.sendRestartOffer(reason, attempt);
      } else {
        await this.sendRestartRequest(reason, attempt);
      }
    } catch (error) {
      console.error(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Recovery attempt #${attempt} failed:`, error);
    } finally {
      this.recoveryInProgress = false;

      if (this.isClosing || !this.peerConnection || this.peerConnection.connectionState === 'connected') {
        this.resetRecoveryState();
        return;
      }

      if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
        console.error(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Recovery exhausted after ${this.recoveryAttempts} attempts at ${new Date().toISOString()}`);
        this.onConnectionStateChange('failed');
        return;
      }

      const retryDelay = RECOVERY_RETRY_DELAYS_MS[Math.min(this.recoveryAttempts, RECOVERY_RETRY_DELAYS_MS.length - 1)];
      this.recoveryTimer = window.setTimeout(() => {
        this.recoveryTimer = null;
        void this.runRecovery(`${reason} (retry ${this.recoveryAttempts + 1})`);
      }, retryDelay);
    }
  }

  private async rebuildPeerConnection(reason: string): Promise<void> {
    if (this.isClosing || this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    console.warn(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Rebuilding peer connection at ${new Date().toISOString()} because ${reason}`);

    try {
      this.stopHeartbeat();
      this.resetRecoveryState();
      this.pendingIceCandidates = [];

      const currentDataChannel = this.dataChannel;
      if (currentDataChannel) {
        currentDataChannel.onopen = null;
        currentDataChannel.onclose = null;
        currentDataChannel.onerror = null;
        currentDataChannel.onmessage = null;
        if (currentDataChannel.readyState !== 'closed') {
          try {
            currentDataChannel.close();
          } catch (error) {
            console.warn(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Failed to close stale data channel during rebuild:`, error);
          }
        }
      }

      const currentPeerConnection = this.peerConnection;
      if (currentPeerConnection) {
        currentPeerConnection.onicecandidate = null;
        currentPeerConnection.oniceconnectionstatechange = null;
        currentPeerConnection.onconnectionstatechange = null;
        currentPeerConnection.onsignalingstatechange = null;
        currentPeerConnection.onicegatheringstatechange = null;
        currentPeerConnection.ondatachannel = null;
        if (currentPeerConnection.connectionState !== 'closed') {
          try {
            currentPeerConnection.close();
          } catch (error) {
            console.warn(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Failed to close stale peer connection during rebuild:`, error);
          }
        }
      }

      this.dataChannel = null;
      this.resetDataChannelPromise();
      this.isReconnecting = false;
      this.peerConnection = this.createPeerConnection();

      if (this.signalingInterval === null) {
        await this.startSignaling();
      }

      if (this.isInitiator) {
        await this.sendRestartOffer(`${reason} (rebuild)`, this.recoveryAttempts + 1);
      } else {
        await this.sendRestartRequest(`${reason} (rebuild)`, this.recoveryAttempts + 1);
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  private async sendRestartOffer(reason: string, attempt: number): Promise<void> {
    if (!this.peerConnection || this.peerConnection.signalingState === 'closed') {
      return;
    }

    const offer = await this.peerConnection.createOffer({ iceRestart: true });
    await this.peerConnection.setLocalDescription(offer);

    console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Sending ICE restart offer for ${reason} (attempt ${attempt}) at ${new Date().toISOString()}`);
    await this.sendSignalingMessage({
      type: 'offer',
      data: offer,
      sender_device_id: this.deviceId,
      target_device_id: this.targetDeviceId
    });
  }

  private async sendRestartRequest(reason: string, attempt: number): Promise<void> {
    console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Requesting remote ICE restart for ${reason} (attempt ${attempt}) at ${new Date().toISOString()}`);
    await this.sendSignalingMessage({
      type: 'ice_restart_request',
      data: {
        reason,
        attempt,
        requested_at: Date.now(),
      },
      sender_device_id: this.deviceId,
      target_device_id: this.targetDeviceId,
    } as SignalingMessage);
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

  private async appendChunkToFile(writeStream: FileSystemWritableFileStream, chunkData: Uint8Array, offset: number): Promise<void> {
    try {
      await writeStream.seek(offset);
      // Convert to plain Uint8Array without shared buffer type issues
      const plainBuffer = new Uint8Array(chunkData);
      await writeStream.write(plainBuffer as any);
    } catch (error) {
      console.error('Error appending chunk to file:', error);
      throw error;
    }
  }

  private triggerBrowserDownload(fileId: string, file: File, filename: string): void {
    const alreadyDownloaded = readStoredStringSet(DOWNLOADED_FILE_IDS_KEY);
    if (alreadyDownloaded.has(fileId)) {
      console.log(`Skipping duplicate browser download for ${fileId}`);
      return;
    }

    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    alreadyDownloaded.add(fileId);
    localStorage.setItem(DOWNLOADED_FILE_IDS_KEY, JSON.stringify(Array.from(alreadyDownloaded)));
  }

  private shouldAutoDownload(fileData: ReceivedFileData): boolean {
    const signature = buildDownloadSignature(fileData);
    const downloadedSignatures = readStoredStringSet(DOWNLOADED_FILE_SIGNATURES_KEY);

    if (downloadedSignatures.has(signature)) {
      console.log(`Skipping duplicate browser download for signature ${signature}`);
      return false;
    }

    downloadedSignatures.add(signature);
    localStorage.setItem(DOWNLOADED_FILE_SIGNATURES_KEY, JSON.stringify(Array.from(downloadedSignatures)));
    return true;
  }

  private calculateChunkSize(fileSize: number): number {
    return 16 * 1024;
  }

  private async hashChunk(chunkData: Uint8Array): Promise<string> {
    const buffer = new Uint8Array(chunkData.byteLength);
    buffer.set(chunkData);
    const digest = await crypto.subtle.digest("SHA-256", buffer.buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private createBinaryChunkMessage(fileId: string, chunkIndex: number, chunkData: Uint8Array): ArrayBuffer {
    const fileIdBytes = new TextEncoder().encode(fileId);
    const buffer = new ArrayBuffer(1 + 4 + 1 + fileIdBytes.length + chunkData.byteLength);
    const view = new DataView(buffer);

    view.setUint8(0, 3);
    view.setUint32(1, chunkIndex, true);
    view.setUint8(5, fileIdBytes.length);

    new Uint8Array(buffer, 6, fileIdBytes.length).set(fileIdBytes);
    new Uint8Array(buffer, 6 + fileIdBytes.length).set(chunkData);

    return buffer;
  }

  private decodeBinaryChunkMessage(data: ArrayBuffer): { fileId: string; chunkIndex: number; chunkData: Uint8Array } | null {
    if (data.byteLength < 6) {
      return null;
    }

    const view = new DataView(data);
    const messageType = view.getUint8(0);
    if (messageType !== 2 && messageType !== 3) {
      return null;
    }

    const chunkIndex = view.getUint32(1, true);
    const fileIdLength = view.getUint8(5);
    if (data.byteLength < 6 + fileIdLength) {
      return null;
    }

    const fileIdBytes = new Uint8Array(data, 6, fileIdLength);
    const fileId = new TextDecoder().decode(fileIdBytes);
    const chunkData = new Uint8Array(data.slice(6 + fileIdLength));
    return { fileId, chunkIndex, chunkData };
  }

  private async storeSwarmChunk(fileId: string, chunkIndex: number, chunkData: Uint8Array): Promise<void> {
    const fileData = this.receivedFiles.get(fileId);
    if (!fileData || fileData.cancelled) {
      return;
    }

    const expectedHash = fileData.chunkHashes?.[chunkIndex];
    if (expectedHash) {
      const actualHash = await this.hashChunk(chunkData);
      if (actualHash !== expectedHash) {
        console.warn(`Rejected chunk ${chunkIndex} for ${fileId} due to hash mismatch`);
        this.onFileProgress({
          id: fileData.fileId,
          name: fileData.filename || this.receivingFilesByFileId.get(fileId) || fileId,
          size: fileData.totalSize,
          progress: 0,
          status: 'failed'
        });
        return;
      }
    }

    fileData.chunks = fileData.chunks || new Map<number, Uint8Array>();
    fileData.chunks.set(chunkIndex, chunkData);

    const receivedChunks = fileData.chunks.size;
    const progress = (receivedChunks / fileData.expectedChunks) * 100;

    this.onFileProgress({
      id: fileData.fileId,
      name: this.receivingFilesByFileId.get(fileId) || fileData.fileId,
      size: fileData.totalSize,
      progress,
      status: receivedChunks === fileData.expectedChunks ? 'completed' : 'receiving'
    });

    this.onSwarmChunkReceived?.({
      fileId,
      chunkIndex,
      chunk: chunkData,
      filename: this.receivingFilesByFileId.get(fileId),
      mimeType: fileData.mimeType
    });

    if (receivedChunks === fileData.expectedChunks) {
      await this.finalizeSwarmFile(fileId);
    }
  }

  private async finalizeSwarmFile(fileId: string): Promise<void> {
    const fileData = this.receivedFiles.get(fileId);
    if (!fileData || fileData.cancelled) {
      return;
    }

    // For streaming mode, check if all bytes have been written
    if (fileData.mode === 'streaming') {
      if (!fileData.bytesWritten || fileData.bytesWritten < fileData.totalSize) {
        return;
      }
    } else {
      // For memory mode, check if all chunks have been received
      if (!fileData.chunks || fileData.chunks.size !== fileData.expectedChunks) {
        return;
      }
    }

    const filename = this.receivingFilesByFileId.get(fileId) || fileId;
    let completedFile: File;

    if (fileData.mode === 'streaming' && fileData.fileHandle) {
      if (fileData.writeStream) {
        try {
          await fileData.writeStream.close();
        } catch (error) {
          console.warn('Error closing streaming file writer:', error);
        }
        fileData.writeStream = undefined;
      }

      completedFile = await fileData.fileHandle.getFile();
    } else {
      const sortedChunks = Array.from(fileData.chunks.entries())
        .sort(([left], [right]) => left - right)
        .map(([, chunk]) => chunk);

      const totalSize = sortedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of sortedChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      completedFile = new File([combined], filename, { type: fileData.mimeType || 'application/octet-stream' });
    }

    this.onFileProgress({
      id: fileData.fileId,
      name: filename,
      size: fileData.totalSize,
      progress: 100,
      status: 'completed'
    });

    this.onFileComplete({
      file: completedFile,
      fileId: fileData.fileId,
      filename,
      mimeType: fileData.mimeType,
      relayHop: fileData.relayHop
    });

    if (fileData.mode === 'memory' && this.shouldAutoDownload(fileData)) {
      this.triggerBrowserDownload(fileId, completedFile, filename);
    }

    this.receivedFiles.delete(fileId);
    this.receivingFilesByFileId.delete(fileId);
  }

  async announceSwarmManifest(manifest: SwarmManifest): Promise<void> {
    await this.sendMessage({
      type: 'file_manifest',
      file_id: manifest.fileId,
      filename: manifest.filename,
      file_size: manifest.fileSize,
      mime_type: manifest.mimeType,
      chunk_size: manifest.chunkSize,
      origin_device_id: manifest.originDeviceId,
      target_peer_ids: manifest.targetPeerIds
    });
  }

  async sendHave(fileId: string, chunkIndices: number[]): Promise<void> {
    await this.sendMessage({
      type: 'have',
      file_id: fileId,
      chunk_indices: chunkIndices
    });
  }

  async requestChunk(fileId: string, chunkIndex: number): Promise<void> {
    await this.sendMessage({
      type: 'request',
      file_id: fileId,
      chunk_index: chunkIndex
    });
  }

  async sendChunk(fileId: string, chunkIndex: number, chunkData: Uint8Array): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    await this.waitForBufferSpace();
    this.dataChannel.send(this.createBinaryChunkMessage(fileId, chunkIndex, chunkData));
  }

  private isStreamingFile(fileId: string): boolean {
    const fileData = this.receivedFiles.get(fileId);
    return fileData?.mode === 'streaming' && fileData.fileHandle !== undefined;
  }

  private async handleDataChannelMessage(data: ArrayBuffer | string): Promise<void> {
    try {
      if (typeof data === 'string') {
        // Handle JSON messages
        const message: Message = JSON.parse(data);

        if (message.type === 'ping') {
          this.lastHeartbeatAt = Date.now();
          console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Heartbeat ping received at ${new Date(this.lastHeartbeatAt).toISOString()}`);
          try {
            this.dataChannel?.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          } catch (error) {
            console.error(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Failed to reply to heartbeat ping:`, error);
          }
          return;
        }

        if (message.type === 'pong') {
          this.lastHeartbeatAt = Date.now();
          console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Heartbeat pong received at ${new Date(this.lastHeartbeatAt).toISOString()}`);
          this.resetRecoveryState();
          return;
        }

        if ((message.type === 'file_manifest' || message.type === 'file_init') && message.filename && message.file_size) {
          const fileId = message.file_id || Math.random().toString(36).substr(2, 9);
          const chunkSize = message.chunk_size || this.calculateChunkSize(message.file_size);
          const expectedChunks = Math.ceil(message.file_size / chunkSize);

          console.log(`Starting to receive swarm file: ${message.filename} (${message.file_size} bytes), expected chunks: ${expectedChunks}, fileId: ${fileId}`);

          // Decide which mode to use: streaming for files >100MB when available, memory buffer otherwise
          let mode: 'memory' | 'streaming' = 'memory';
          let fileHandle: FileSystemFileHandle | undefined;

          if (isFileSystemAccessAvailable && message.file_size > 100 * 1024 * 1024) {
            try {
              console.log('File size >100MB and FileSystem API available, requesting save location...');
              fileHandle = await this.requestFileHandle(message.filename, message.mime_type);
              mode = 'streaming';
              const writeStream = await fileHandle.createWritable({ keepExistingData: true });
              console.log('File system streaming mode enabled');

              // Persist the writable stream so each chunk does not reopen the file.
              const receivedFileData: ReceivedFileData = {
                totalSize: message.file_size,
                mimeType: message.mime_type || '',
                originDeviceId: message.origin_device_id || this.targetDeviceId,
                fileId,
                expectedChunks,
                startTime: Date.now(),
                mode,
                chunks: undefined,
                fileHandle,
                writeStream,
                bytesWritten: 0,
                cancelled: false,
                relayHop: message.relay_hop || 0,
                chunkSize,
                chunkHashes: message.chunk_hashes,
                filename: message.filename
              };

              this.receivedFiles.set(fileId, receivedFileData);
              this.receivingFilesByFileId.set(fileId, message.filename);

              this.onFileProgress({
                id: fileId,
                name: message.filename,
                size: message.file_size,
                progress: 0,
                status: 'receiving'
              });

              console.log(`File reception mode: ${mode} (${message.file_size} bytes)`);
              return;
            } catch (error) {
              console.warn('Failed to enable streaming mode, falling back to memory buffer:', error);
              mode = 'memory';
            }
          }

          const receivedFileData: ReceivedFileData = {
            totalSize: message.file_size,
            mimeType: message.mime_type || '',
            originDeviceId: message.origin_device_id || this.targetDeviceId,
            fileId,
            expectedChunks,
            startTime: Date.now(),
            mode: 'memory',
            chunks: new Map(),
            fileHandle: undefined,
            writeStream: undefined,
            bytesWritten: undefined,
            cancelled: false,
            relayHop: message.relay_hop || 0,
            chunkSize,
            chunkHashes: message.chunk_hashes,
            filename: message.filename
          };

          this.receivedFiles.set(fileId, receivedFileData);
          this.receivingFilesByFileId.set(fileId, message.filename);

          this.onFileProgress({
            id: fileId,
            name: message.filename,
            size: message.file_size,
            progress: 0,
            status: 'receiving'
          });

          console.log(`File reception mode: ${mode} (${message.file_size} bytes)`);

        } else if (message.type === 'have' || message.type === 'request' || message.type === 'complete') {
          if (message.type === 'request' && message.file_id && typeof message.chunk_index === 'number') {
            const requestedChunk = await this.getChunkData?.({
              fileId: message.file_id,
              chunkIndex: message.chunk_index,
            });

            if (requestedChunk) {
              await this.sendChunk(message.file_id, message.chunk_index, requestedChunk);
            }
          }

          if (message.type === 'complete' && message.file_id) {
            await this.finalizeSwarmFile(message.file_id);
          }

          this.onMessage(message);

        } else if (message.type === 'file_cancel' && message.filename) {
          // Remote side cancelled the file transfer
          console.log(`Received cancellation for file: ${message.filename}`);

          const cancelKey = message.file_id || message.filename;

          // Check if we're receiving this file
          const fileData = cancelKey ? this.receivedFiles.get(cancelKey) : undefined;
          if (fileData) {
            console.log(`Stopping reception of file: ${message.filename}`);
            
            // Mark file as cancelled
            fileData.cancelled = true;

            // Update progress to cancelled
            this.onFileProgress({
              id: fileData.fileId,
              name: message.filename,
              size: fileData.totalSize,
              progress: 0,
              status: 'cancelled'
            });

            this.receivedFiles.delete(fileData.fileId);
            // Clean up fileId mapping
            for (const [fileId, name] of this.receivingFilesByFileId.entries()) {
              if (fileId === cancelKey || name === message.filename) {
                this.receivingFilesByFileId.delete(fileId);
                break;
              }
            }
          } else {
            // Check if we're sending this file
            let foundTransfer = false;
            let fileIdToCleanup: string | null = null;
            
            for (const [key, transfer] of this.activeTransfers.entries()) {
              if (transfer.filename === message.filename) {
                console.log(`Stopping transmission of file: ${message.filename}`);
                transfer.cancelled = true;
                fileIdToCleanup = transfer.fileId || null;
                foundTransfer = true;
                
                // Update UI progress to cancelled immediately
                const sendingFile = this.sendingFilesByFileId.get(transfer.fileId || '');
                if (sendingFile && transfer.fileId) {
                  this.onFileProgress({
                    id: transfer.fileId,
                    name: message.filename,
                    size: sendingFile.size,
                    progress: 0,
                    status: 'cancelled'
                  });
                  
                  // Clean up the sending file mapping
                  this.sendingFilesByFileId.delete(transfer.fileId);
                }
                break;
              }
            }
            
            if (foundTransfer && fileIdToCleanup) {
              console.log(`File transfer marked as cancelled by remote side: ${message.filename}`);
            }
          }
        }

        if (message.type !== 'request' && message.type !== 'complete' && message.type !== 'have') {
          this.onMessage(message);
        }

      } else if (data instanceof ArrayBuffer) {
        // Handle binary messages
        const chunkMessage = this.decodeBinaryChunkMessage(data);

        if (chunkMessage) {
          const { fileId, chunkIndex, chunkData } = chunkMessage;
          console.log(`Received swarm chunk ${chunkIndex} for file ${fileId}`);

          const fileData = this.receivedFiles.get(fileId);
          if (!fileData) {
            console.warn(`Received chunk for unknown file ${fileId}`);
            return;
          }

          if (fileData.cancelled) {
            console.log(`Skipping chunk for cancelled file: ${fileId}`);
            return;
          }

          if (fileData.mode === 'streaming' && fileData.fileHandle) {
            // Serialize streaming writes to avoid race conditions on the file handle
            const prevWrite = fileData.writeQueue || Promise.resolve();
            fileData.writeQueue = prevWrite.then(async () => {
              if (fileData.cancelled) {
                console.log(`Skipping streaming chunk for cancelled file: ${fileId}`);
                return;
              }
              try {
                const chunkSize = fileData.chunkSize || this.calculateChunkSize(fileData.totalSize);
                const offset = chunkIndex * chunkSize;

                if (!fileData.writeStream) {
                  throw new Error('Streaming writer is not available');
                }

                await this.appendChunkToFile(fileData.writeStream, chunkData, offset);
                fileData.bytesWritten = (fileData.bytesWritten || 0) + chunkData.length;
                const receivedChunks = Math.ceil((fileData.bytesWritten || 0) / chunkSize);
                const progress = (receivedChunks / fileData.expectedChunks) * 100;

                if (receivedChunks % 10 === 0 || receivedChunks === fileData.expectedChunks) {
                  const elapsed = Date.now() - fileData.startTime;
                  const speed = (fileData.bytesWritten || 0) / (elapsed / 1000) / (1024 * 1024);
                  console.log(`Streamed ${receivedChunks}/${fileData.expectedChunks} chunks (${progress.toFixed(1)}%) - ${speed.toFixed(2)} MB/s`);
                }

                this.onFileProgress({
                  id: fileData.fileId,
                  name: fileData.filename || this.receivingFilesByFileId.get(fileId) || 'Unknown',
                  size: fileData.totalSize,
                  progress,
                  status: 'receiving'
                });

                // For streaming mode, notify swarm but skip in-memory chunk storage
                this.onSwarmChunkReceived?.({
                  fileId,
                  chunkIndex,
                  chunk: chunkData,
                  filename: fileData.filename || this.receivingFilesByFileId.get(fileId),
                  mimeType: fileData.mimeType
                });

                // Check if file is complete based on bytesWritten vs totalSize
                if ((fileData.bytesWritten || 0) >= fileData.totalSize) {
                  await this.finalizeSwarmFile(fileId);
                }
              } catch (error) {
                console.error('Error writing chunk to file:', error);
                this.onFileProgress({
                  id: fileData.fileId,
                  name: fileData.filename || this.receivingFilesByFileId.get(fileId) || 'Unknown',
                  size: fileData.totalSize,
                  progress: 0,
                  status: 'failed'
                });
              }
            }).catch((error) => {
              console.error('Error in streaming write queue:', error);
            });
          } else {
            await this.storeSwarmChunk(fileId, chunkIndex, chunkData);
          }
        }
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
    }
  }

  private async startSignaling(): Promise<void> {
    if (this.signalingInterval !== null) {
      return;
    }

    if (this.isInitiator) {
      console.log('Creating offer as initiator');
      // Create offer
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);

      console.log('Sending offer:', offer);
      await this.sendSignalingMessage({
        type: 'offer',
        data: offer,
        sender_device_id: this.deviceId,
        target_device_id: this.targetDeviceId
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
        if (this.peerConnection!.signalingState !== 'stable') {
          console.log('Skipping duplicate or late offer in signaling state:', this.peerConnection!.signalingState);
          return;
        }
        console.log('Received offer, creating answer');
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));
        const answer = await this.peerConnection!.createAnswer();
        await this.peerConnection!.setLocalDescription(answer);

        console.log('Sending answer:', answer);
        await this.sendSignalingMessage({
          type: 'answer',
          data: answer,
          sender_device_id: this.deviceId,
          target_device_id: this.targetDeviceId
        });

        // Process any buffered ICE candidates now that remote description is set
        await this.processPendingIceCandidates();

      } else if (message.type === 'answer' && this.isInitiator) {
        if (this.peerConnection!.signalingState !== 'have-local-offer') {
          console.log('Skipping duplicate or late answer in signaling state:', this.peerConnection!.signalingState);
          return;
        }
        console.log('Received answer, setting remote description');
        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));

        // Process any buffered ICE candidates now that remote description is set
        await this.processPendingIceCandidates();

      } else if (message.type === 'ice_restart_request' && this.isInitiator) {
        console.log(`[WebRTC ${this.deviceId} -> ${this.targetDeviceId}] Received ICE restart request at ${new Date().toISOString()}:`, message);
        await this.runRecovery('peer requested ICE restart');

      } else if (message.type === 'ice_candidate') {
        if (!this.peerConnection || this.peerConnection.connectionState === 'closed') {
          console.log('Skipping ICE candidate because peer connection is closed');
          return;
        }
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
    const response = await fetch(`${this.signalingServer}/api/pairing/${this.pairingId}/signaling?device_id=${encodeURIComponent(this.deviceId)}&sender_device_id=${encodeURIComponent(this.targetDeviceId)}`);
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
      console.log('Data channel not created yet, waiting...');
      this.dataChannel = await this.dataChannelPromise;
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

    let filename: string | null = null;

    // First, check if we're receiving this file by looking up fileId directly
    const fileData = this.receivedFiles.get(fileId);
    if (fileData) {
      filename = this.receivingFilesByFileId.get(fileId) || fileData.filename || null;
      console.log(`Cancelling reception of file: ${filename || fileId}`);
      fileData.cancelled = true;

      // Update UI immediately to show cancelled status
      this.onFileProgress({
        id: fileData.fileId,
        name: filename || fileId,
        size: fileData.totalSize,
        progress: (fileData.chunks?.size || 0) / fileData.expectedChunks * 100,
        status: 'cancelled'
      });

      this.receivedFiles.delete(fileId);
      this.receivingFilesByFileId.delete(fileId);
      console.log(`File marked as cancelled: ${filename || fileId}`);
    } else {
      // Check if we're sending this file via activeTransfers or sendingFilesByFileId
      const sendingFile = this.sendingFilesByFileId.get(fileId);
      if (sendingFile) {
        console.log(`Cancelling sending of file: ${sendingFile.filename}`);
        filename = sendingFile.filename;

        // Mark any matching active transfer as cancelled
        for (const [, transfer] of this.activeTransfers.entries()) {
          if (transfer.fileId === fileId) {
            transfer.cancelled = true;
            break;
          }
        }

        // Update UI immediately to show cancelled status
        this.onFileProgress({
          id: fileId,
          name: sendingFile.filename,
          size: sendingFile.size,
          progress: 0,
          status: 'cancelled'
        });

        this.sendingFilesByFileId.delete(fileId);
        console.log(`Sending file marked as cancelled: ${sendingFile.filename}`);
      }
    }

    // Send cancellation message to the other side
    if (filename) {
      this.sendCancellationMessage(filename);
    }
  }

  private sendCancellationMessage(filename: string): void {
    try {
      const cancelMessage: Message = {
        type: 'file_cancel',
        filename: filename,
        timestamp: Date.now()
      };
      this.sendMessage(cancelMessage).catch(error => {
        console.error('Failed to send cancellation message:', error);
      });
    } catch (error) {
      console.error('Error sending cancellation message:', error);
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

  async sendFile(file: File, onProgress?: (progress: number) => void, relayHop: number = 0): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    console.log(`Starting file transfer: ${file.name} (${file.size} bytes)`);

    const fileId = Math.random().toString(36).substr(2, 9);
    const transferKey = `transfer-${fileId}`;
    
    // Track this transfer for cancellation
    this.activeTransfers.set(transferKey, { cancelled: false, fileId, filename: file.name });
    // Also track fileId -> filename mapping for cancellation message handling
    this.sendingFilesByFileId.set(fileId, { filename: file.name, size: file.size });

    try {
      // Dynamic chunk size: smaller for small files, larger for big files
      const chunkSize = 64 * 1024;
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

      // Send file start message (JSON) - include fileId so receiver can track it
      const startMessage: Message = {
        type: 'file_init',
        filename: file.name,
        file_size: file.size,
        mime_type: file.type,
        timestamp: Date.now(),
        file_id: fileId, // Add fileId to message so receiver can track by it
        relay_hop: relayHop
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
            status: 'cancelled'
          });
          break; // Exit the loop gracefully instead of throwing
        }

        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        const arrayBuffer = await chunk.arrayBuffer();

        // Create binary message: [type(1), chunkIndex(4), fileIdLength(1), fileId(var), data]
        const fileIdBytes = new TextEncoder().encode(fileId);
        const messageSize = 1 + 4 + 1 + fileIdBytes.length + arrayBuffer.byteLength;
        const messageBuffer = new ArrayBuffer(messageSize);
        const view = new DataView(messageBuffer);

        view.setUint8(0, 3); // Message type: file chunk (binary) - uses same type as createBinaryChunkMessage
        view.setUint32(1, chunkIndex, true); // Chunk index
        view.setUint8(5, fileIdBytes.length); // FileId length

        // Copy fileId
        const fileIdArray = new Uint8Array(messageBuffer, 6, fileIdBytes.length);
        fileIdArray.set(fileIdBytes);

        // Copy chunk data
        const uint8Array = new Uint8Array(messageBuffer, 6 + fileIdBytes.length);
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

      // Send file end message (JSON) only if not cancelled
      const transfer = this.activeTransfers.get(transferKey);
      if (!transfer?.cancelled) {
        const endMessage: Message = {
          type: 'file_end',
          filename: file.name,
          timestamp: Date.now(),
          relay_hop: relayHop
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
    } finally {
      // Clean up the transfer record
      this.activeTransfers.delete(transferKey);
      this.sendingFilesByFileId.delete(fileId);
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
    this.isClosing = true;
    this.resetRecoveryState();
    this.stopHeartbeat();
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