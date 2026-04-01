const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export interface DeviceDescriptor {
  id: string;
  name: string;
  type: string;
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
  type: "text" | "file_init" | "file_chunk" | "file_end";
  content?: string;
  file_name?: string;
  file_size?: number;
  chunk_data?: string;
  chunk_size?: number;
  mime_type?: string;
  timestamp?: string;
}

export const api = {
  async initiatePairing(device: DeviceDescriptor): Promise<PairingCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(device),
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
      body: JSON.stringify(device),
    });
    if (!response.ok) throw new Error("Failed to join pairing");
    return response.json();
  },

  async getPairing(code: string): Promise<PairingCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/${code}`);
    if (!response.ok) throw new Error("Failed to get pairing");
    return response.json();
  },

  async uploadFile(pairingId: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_BASE}/api/pairing/${pairingId}/files`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error("Failed to upload file");
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