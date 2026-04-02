const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export interface DeviceDescriptor {
  identifier: string;
  label?: string;
  metadata?: { type?: string };
}

export interface PairingCodeOut {
  id: string;
  code: string;
  status: string;
  initiator: DeviceDescriptor;
  peer?: DeviceDescriptor;
  created_at: string;
  connected_at?: string;
  expires_at: string;
}

export interface Message {
  type: "text" | "file_init" | "file_chunk" | "file_end" | "file_cancel" | "peer_connected" | "file_shared";
  content?: string;
  file_name?: string;
  filename?: string;
  file_size?: number;
  file_id?: string;
  chunk_data?: string;
  chunk_size?: number;
  mime_type?: string;
  timestamp?: string | number;
  sender?: "you" | "peer";
  isCode?: boolean;
  codeTitle?: string;
}

export interface SignalingMessage {
  type: "offer" | "answer" | "ice_candidate";
  data: any;
}

export const api = {
  async initiatePairing(device: DeviceDescriptor): Promise<PairingCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device }),
    });
    if (!response.ok) throw new Error("Failed to initiate pairing");
    return response.json();
  },

  async joinPairing(code: string, device: DeviceDescriptor): Promise<PairingCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/join/${code}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device }),
    });
    if (!response.ok) throw new Error("Failed to join pairing");
    return response.json();
  },

  async getPairing(code: string): Promise<PairingCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/${code}`);
    if (!response.ok) throw new Error("Failed to get pairing");
    return response.json();
  },

  async sendSignalingMessage(pairingId: string, message: SignalingMessage): Promise<void> {
    const response = await fetch(`${API_BASE}/api/pairing/${pairingId}/signaling`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error("Failed to send signaling message");
  },

  async getSignalingMessages(pairingId: string): Promise<SignalingMessage[]> {
    const response = await fetch(`${API_BASE}/api/pairing/${pairingId}/signaling`);
    if (!response.ok) throw new Error("Failed to get signaling messages");
    return response.json();
  },

  async uploadFile(pairingId: string, file: File, deviceId: string, onProgress?: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("device_id", deviceId);
      formData.append("file", file);

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = (event.loaded / event.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Upload failed"));
      });

      xhr.open("POST", `${API_BASE}/api/pairing/${pairingId}/files`);
      xhr.send(formData);
    });
  },

  async downloadFile(pairingId: string, filename: string): Promise<Blob> {
    const response = await fetch(`${API_BASE}/api/pairing/${pairingId}/files/${filename}`);
    if (!response.ok) throw new Error("Failed to download file");
    return response.blob();
  },

  createWebSocket(pairingId: string, deviceId: string): WebSocket {
    const wsUrl = API_BASE.replace(/^http/, 'ws');
    return new WebSocket(`${wsUrl}/ws/pairing/${pairingId}/${deviceId}`);
  },
};