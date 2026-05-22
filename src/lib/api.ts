const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export interface DeviceDescriptor {
  identifier: string;
  label?: string;
  metadata?: { type?: string };
}

export interface FeatureFlags {
  file_transfer: boolean;
  messaging: boolean;
  code_sharing: boolean;
  emoji_support: boolean;
  mentions: boolean;
}

export interface PolicySettings {
  max_file_size_bytes: number;
  pairing_ttl_seconds: number;
  max_devices_per_session: number;
  pairing_rate_limit_per_minute: number;
  admin_rate_limit_per_minute: number;
}

export interface RuntimeConfig {
  maintenance_mode: "off" | "block_new" | "shutdown";
  feature_flags: FeatureFlags;
  policy: PolicySettings;
  updated_at: string;
}

export interface AdminUser {
  username: string;
  email?: string | null;
  role: "viewer" | "operator" | "admin" | "owner";
  display_name?: string | null;
  last_login_at?: string | null;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  role: AdminUser["role"];
  action: string;
  target?: string | null;
  status: "success" | "blocked" | "denied";
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface AdminDashboard {
  current_user: AdminUser;
  settings: RuntimeConfig;
  sessions: PairingCodeOut[];
  audit_log: AuditLogEntry[];
}

export interface AdminLoginResponse {
  token: string;
  token_type: "bearer";
  user: AdminUser;
  expires_at: string;
  settings: RuntimeConfig;
}

export interface AdminSettingsUpdate {
  maintenance_mode: RuntimeConfig["maintenance_mode"];
  feature_flags: FeatureFlags;
  policy: PolicySettings;
}

export interface PairingCodeOut {
  id: string;
  code: string;
  status: "pending" | "connected" | "expired" | "terminated";
  initiator: DeviceDescriptor;
  peer?: DeviceDescriptor;
  peers?: DeviceDescriptor[];
  peer_count?: number;
  device_count?: number;
  created_at: string;
  connected_at?: string;
  expires_at: string;
  terminated_at?: string;
  termination_reason?: string;
}

export interface PairingQrCodeOut {
  code: string;
  url: string;
  qrcode: string;
}

export interface Message {
  type:
    | "text"
    | "ping"
    | "pong"
    | "file_manifest"
    | "transfer_approval_request"
    | "transfer_approval_response"
    | "transfer_approval_cancel"
    | "have"
    | "request"
    | "complete"
    | "file_init"
    | "file_chunk"
    | "file_end"
    | "file_cancel"
    | "peer_connected"
    | "peer_name_changed"
    | "file_shared";
  content?: string;
  file_name?: string;
  filename?: string;
  file_size?: number;
  file_id?: string;
  files?: Array<{
    name: string;
    size: number;
    mimeType?: string;
  }>;
  total_size?: number;
  sender_device_id?: string;
  sender_device_name?: string;
  transfer_id?: string;
  approval_timeout_ms?: number;
  approval_status?: "accepted" | "rejected" | "timeout" | "cancelled";
  approval_reason?: string;
  chunk_index?: number;
  chunk_indices?: number[];
  chunk_data?: string;
  chunk_size?: number;
  chunk_hashes?: string[];
  origin_device_id?: string;
  target_peer_ids?: string[];
  mime_type?: string;
  timestamp?: string | number;
  sender?: "you" | "peer";
  senderName?: string;
  isCode?: boolean;
  codeTitle?: string;
  relay_hop?: number;
}

export interface SignalingMessage {
  type: "offer" | "answer" | "ice_candidate" | "ice_restart_request";
  data: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, unknown>;
  sender_device_id: string;
  target_device_id: string;
}

export const api = {
  async getRuntimeConfig(): Promise<RuntimeConfig> {
    const response = await fetch(`${API_BASE}/api/runtime-config`);
    if (!response.ok) throw new Error("Failed to get runtime config");
    return response.json();
  },

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

  async adminLogin(email: string, password: string): Promise<AdminLoginResponse> {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error("Failed to sign in");
    return response.json();
  },

  async adminLogout(token: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/admin/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to sign out");
  },

  async getAdminDashboard(token: string): Promise<AdminDashboard> {
    const response = await fetch(`${API_BASE}/api/admin/dashboard`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to load admin dashboard");
    return response.json();
  },

  async getAdminSessions(token: string): Promise<PairingCodeOut[]> {
    const response = await fetch(`${API_BASE}/api/admin/sessions`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to load admin sessions");
    return response.json();
  },

  async disconnectAdminSession(token: string, pairingId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/admin/sessions/${pairingId}/disconnect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to disconnect session");
  },

  async disconnectAdminDevice(token: string, pairingId: string, deviceId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/admin/sessions/${pairingId}/devices/${deviceId}/disconnect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to disconnect device");
  },

  async getAdminAuditLog(token: string): Promise<AuditLogEntry[]> {
    const response = await fetch(`${API_BASE}/api/admin/audit-log`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to load audit log");
    return response.json();
  },

  async updateAdminSettings(token: string, settings: AdminSettingsUpdate): Promise<RuntimeConfig> {
    const response = await fetch(`${API_BASE}/api/admin/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error("Failed to update admin settings");
    return response.json();
  },

  async adminForgotPassword(email: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE}/api/admin/forgot-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new Error("Failed to request password reset");
    return response.json();
  },

  async adminVerifyOtp(email: string, otp: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE}/api/admin/verify-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, otp }),
    });
    if (!response.ok) throw new Error("Failed to verify OTP");
    return response.json();
  },

  async adminResetPassword(email: string, otp: string, newPassword: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE}/api/admin/reset-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, otp, new_password: newPassword }),
    });
    if (!response.ok) throw new Error("Failed to reset password");
    return response.json();
  },

  async listAdminUsers(token: string): Promise<AdminUser[]> {
    const response = await fetch(`${API_BASE}/api/admin/users`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to list users");
    return response.json();
  },

  async createAdminUser(token: string, userData: { username: string; email: string; password: string; role?: string; display_name?: string }): Promise<AdminUser> {
    const response = await fetch(`${API_BASE}/api/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(userData),
    });
    if (!response.ok) throw new Error("Failed to create user");
    return response.json();
  },

  async updateAdminUser(token: string, username: string, userData: { email?: string; role?: string; display_name?: string }): Promise<AdminUser> {
    const response = await fetch(`${API_BASE}/api/admin/users/${username}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(userData),
    });
    if (!response.ok) throw new Error("Failed to update user");
    return response.json();
  },

  async deleteAdminUser(token: string, username: string): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE}/api/admin/users/${username}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to delete user");
    return response.json();
  },

  async getPairing(code: string): Promise<PairingCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/${code}`);
    if (!response.ok) throw new Error("Failed to get pairing");
    return response.json();
  },

  async getPairingQRCode(code: string): Promise<PairingQrCodeOut> {
    const response = await fetch(`${API_BASE}/api/pairing/${code}/qrcode`);
    if (!response.ok) throw new Error("Failed to get pairing QR code");
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

  subscribeToPairingUpdates(code: string, onUpdate: (data: PairingCodeOut) => void, onError?: (error: Event) => void): EventSource {
    const eventSource = new EventSource(`${API_BASE}/api/pairing/${code}/events`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "pairing_update") {
          onUpdate(parsed.data);
        }
      } catch (error) {
        console.error("Failed to parse SSE data:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      if (onError) {
        onError(error);
      }
    };

    return eventSource;
  },

  createWebSocket(pairingId: string, deviceId: string): WebSocket {
    const wsUrl = API_BASE.replace(/^http/, 'ws');
    return new WebSocket(`${wsUrl}/ws/pairing/${pairingId}/${deviceId}`);
  },
};