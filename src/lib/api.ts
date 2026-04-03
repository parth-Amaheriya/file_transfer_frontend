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
  peers?: DeviceDescriptor[];
  peer_count?: number;
  created_at: string;
  connected_at?: string;
  expires_at: string;
}

export interface Message {
  type:
    | "text"
    | "file_manifest"
    | "have"
    | "request"
    | "complete"
    | "file_init"
    | "file_chunk"
    | "file_end"
    | "file_cancel"
    | "peer_connected"
    | "file_shared";
  content?: string;
  file_name?: string;
  filename?: string;
  file_size?: number;
  file_id?: string;
  chunk_index?: number;
  chunk_indices?: number[];
  chunk_data?: string;
  chunk_size?: number;
  chunk_hashes?: string[];
  origin_device_id?: string;
  mime_type?: string;
  timestamp?: string | number;
  sender?: "you" | "peer";
  isCode?: boolean;
  codeTitle?: string;
  relay_hop?: number;
}

export interface SignalingMessage {
  type: "offer" | "answer" | "ice_candidate";
  data: any;
  sender_device_id: string;
  target_device_id: string;
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

  async getSignalingMessages(pairingId: string, deviceId: string, senderDeviceId?: string): Promise<SignalingMessage[]> {
    const url = new URL(`${API_BASE}/api/pairing/${pairingId}/signaling`);
    url.searchParams.set("device_id", deviceId);
    if (senderDeviceId) {
      url.searchParams.set("sender_device_id", senderDeviceId);
    }
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Failed to get signaling messages");
    return response.json();
  },

  async leavePairing(pairingId: string, deviceId: string): Promise<PairingCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/${pairingId}/leave/${deviceId}`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to leave pairing");
    return response.json();
  },

  createWebSocket(pairingId: string, deviceId: string): WebSocket {
    const wsUrl = API_BASE.replace(/^http/, 'ws');
    return new WebSocket(`${wsUrl}/ws/pairing/${pairingId}/${deviceId}`);
  },
};