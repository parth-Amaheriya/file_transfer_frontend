import { ArrowLeft, FileText, MessageSquare, Code, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BackgroundEffects from "@/components/BackgroundEffects";
import Loader from "@/components/Loader";
import ConnectionPanel from "@/components/ConnectionPanel";
import FileTransferPanel from "@/components/FileTransferPanel";
import TransferApprovalDialog, { type IncomingTransferApprovalRequest } from "@/components/TransferApprovalDialog";
import MessagingPanel from "@/components/MessagingPanel";
import CodeSnippetPanel from "@/components/CodeSnippetPanel";
import { type FileItem } from "@/components/FileTransferPanel";
import { api, type DeviceDescriptor, type PairingCodeOut, type Message, type RuntimeConfig } from "@/lib/api";
import { WebRTCManager, type FileTransferProgress, type SwarmChunkReceipt, type SwarmManifest } from "@/lib/webrtc";

type SwarmTransferState = {
  manifest: SwarmManifest;
  sourceFile?: File;
  localChunks: Map<number, Uint8Array>;
  ownedChunks: Set<number>;
  targetPeerIds: string[];
  peerHasAll: Record<string, boolean>;
  peerChunks: Record<string, Set<number>>;
  inFlight: Record<string, Set<number>>;
  completed: boolean;
};

type TransferApprovalPeerStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

type TransferApprovalPeerState = {
  peerId: string;
  peerName: string;
  status: TransferApprovalPeerStatus;
  reason?: "accepted" | "rejected" | "timeout" | "cancelled";
  respondedAt?: number;
};

type PendingTransferApproval = {
  transferId: string;
  fileName: string;
  totalSize: number;
  senderDeviceName: string;
  targetPeerIds: string[];
  peerStates: Record<string, TransferApprovalPeerState>;
  createdAt: number;
  timeoutMs: number;
};

const calculateSwarmChunkSize = (fileSize: number) => {
  return 64 * 1024;
};

const MAX_OUTSTANDING_REQUESTS_PER_PEER = 2;
const CHUNK_REQUEST_TIMEOUT_MS = 15000;

const bytesToHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const hashChunk = async (chunk: Uint8Array) => {
  const buffer = new Uint8Array(chunk.byteLength);
  buffer.set(chunk);
  const digest = await crypto.subtle.digest("SHA-256", buffer.buffer);
  return bytesToHex(digest);
};

const createSwarmManifest = async (file: File, originDeviceId: string, fileId: string): Promise<SwarmManifest> => {
  const chunkSize = calculateSwarmChunkSize(file.size);
  const chunkCount = Math.ceil(file.size / chunkSize);

  return {
    fileId,
    filename: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    chunkSize,
    chunkCount,
    chunkHashes: [],
    originDeviceId,
    targetPeerIds: [],
  };
};

const readFileChunk = async (file: File, chunkIndex: number, chunkSize: number) => {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, file.size);
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
};

const DEFAULT_DEVICE_NAME = "MYDEVICE";

const normalizeDeviceName = (value?: string | null) => value?.trim() || DEFAULT_DEVICE_NAME;

const formatBytes = (size: number) => {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${size} B`;
};

const APPROVAL_TIMEOUT_MS = 30000;

const readStoredPairing = (connectionCode?: string) => {
  const saved = sessionStorage.getItem("pairing");
  if (!saved) {
    return null;
  }

  try {
    const parsed = JSON.parse(saved) as PairingCodeOut;
    if (connectionCode && parsed.code !== connectionCode) {
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem("pairing");
    return null;
  }
};

const Session = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { connectionCode: routeConnectionCode } = useParams<{ connectionCode?: string }>();
  const searchParams = new URLSearchParams(location.search);
  const connectionCode = (routeConnectionCode || location.state?.joinCode || searchParams.get("joinCode") || searchParams.get("code") || "").trim().toUpperCase() || undefined;
  const initialDeviceName = normalizeDeviceName(location.state?.deviceName || sessionStorage.getItem("deviceName") || DEFAULT_DEVICE_NAME);
  const { data: runtimeConfig } = useQuery<RuntimeConfig>({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const [pairing, setPairing] = useState<PairingCodeOut | null>(() => {
    return readStoredPairing(connectionCode);
  });
  const [deviceId, setDeviceId] = useState<string>(() => {
    // Restore device ID from sessionStorage
    return sessionStorage.getItem("deviceId") || Math.random().toString(36).substr(2, 9);
  });
  const [deviceName, setDeviceName] = useState<string>(initialDeviceName);
  const deviceNameRef = useRef<string>(deviceName);
  useEffect(() => {
    deviceNameRef.current = deviceName;
  }, [deviceName]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
  const [activeTab, setActiveTab] = useState<string>("files");
  const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set());
  const [selectedPeerIds, setSelectedPeerIds] = useState<string[]>([]);
  const [pendingTransferApprovals, setPendingTransferApprovals] = useState<Record<string, PendingTransferApproval>>({});
  const pendingTransferApprovalsRef = useRef<Record<string, PendingTransferApproval>>({});
  const approvalTimeoutTimersRef = useRef<Record<string, Record<string, number>>>({});
  const [incomingApprovalRequests, setIncomingApprovalRequests] = useState<IncomingTransferApprovalRequest[]>([]);
  const incomingApprovalTimersRef = useRef<Map<string, number>>(new Map());
  const webrtcManagersRef = useRef<Map<string, WebRTCManager>>(new Map<string, WebRTCManager>());
  const peerConnectionStatesRef = useRef<Record<string, RTCPeerConnectionState>>({});
  const [peerConnectionStates, setPeerConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const swarmTransfersRef = useRef<Map<string, SwarmTransferState>>(new Map());
  const lastProcessedMessageIndexRef = useRef<number>(-1);
  const markedFilesUnreadRef = useRef<Set<string>>(new Set());
  const peerSelectionInitializedRef = useRef(false);
  const peerSelectionTouchedRef = useRef(false);
  const peerCleanupTimersRef = useRef<Record<string, number>>({});
  const chunkRequestTimeoutsRef = useRef<Record<string, number>>({});
  const disconnectingRef = useRef(false);
  const loaderStartRef = useRef<number | null>(pairing ? null : Date.now());
  const loaderHideTimerRef = useRef<number | null>(null);
  const [showLoader, setShowLoader] = useState(() => !pairing);
  const maintenanceMode = runtimeConfig?.maintenance_mode || "off";
  const featureFlags = runtimeConfig?.feature_flags;
  const policy = runtimeConfig?.policy;

  useEffect(() => {
    if (!connectionCode) {
      return;
    }

    if (pairing?.code !== connectionCode) {
      sessionStorage.removeItem("pairing");
      setPairing(null);
    }
  }, [connectionCode, pairing?.code]);

  const getConnectedPeerManagers = (peerIds?: string[]): WebRTCManager[] => {
    return Array.from(webrtcManagersRef.current.entries())
      .filter(([peerId]) => peerConnectionStatesRef.current[peerId] === "connected" && (!peerIds || peerIds.includes(peerId)))
      .map(([, manager]) => manager);
  };

  const getConnectedPeerIds = (peerIds?: string[]): string[] => {
    return Array.from(webrtcManagersRef.current.keys() as Iterable<string>).filter(
      (peerId) => peerConnectionStatesRef.current[peerId] === "connected" && (!peerIds || peerIds.includes(peerId))
    );
  };

  const syncOverallConnectionState = () => {
    const states = Object.values(peerConnectionStatesRef.current);

    if (states.length === 0) {
      setConnectionState("new");
      return;
    }

    if (states.some((state) => state === "connected")) {
      setConnectionState("connected");
      return;
    }

    if (states.some((state) => state === "connecting" || state === "new")) {
      setConnectionState("connecting");
      return;
    }

    if (states.every((state) => state === "failed" || state === "disconnected" || state === "closed")) {
      setConnectionState("failed");
    }
  };

  const ensureTransfer = (manifest: SwarmManifest) => {
    const existing = swarmTransfersRef.current.get(manifest.fileId);
    if (existing) {
      return existing;
    }

    const created: SwarmTransferState = {
      manifest,
      localChunks: new Map(),
      ownedChunks: new Set(),
      targetPeerIds: [],
      peerHasAll: {},
      peerChunks: {},
      inFlight: {},
      completed: false,
    };

    swarmTransfersRef.current.set(manifest.fileId, created);
    return created;
  };

  const markPeerChunks = (fileId: string, peerId: string, chunkIndices: number[]) => {
    const transfer = swarmTransfersRef.current.get(fileId);
    if (!transfer) {
      return;
    }

    if (!transfer.peerChunks[peerId]) {
      transfer.peerChunks[peerId] = new Set();
    }

    chunkIndices.forEach((chunkIndex) => transfer.peerChunks[peerId].add(chunkIndex));

    const remotePeerIds = transfer.targetPeerIds.filter((targetPeerId) => targetPeerId !== deviceId);
    if (remotePeerIds.length === 0) {
      return;
    }

    const deliveredProgress = remotePeerIds.reduce((sum, targetPeerId) => {
      if (transfer.peerHasAll[targetPeerId]) {
        return sum + 1;
      }

      const receivedCount = transfer.peerChunks[targetPeerId]?.size || 0;
      return sum + Math.min(receivedCount, transfer.manifest.chunkCount) / transfer.manifest.chunkCount;
    }, 0);

    const progress = Math.min(100, Math.round((deliveredProgress / remotePeerIds.length) * 100));

    if (transfer.manifest.originDeviceId === deviceId) {
      setFiles((prev) => prev.map((file) =>
        file.id === fileId
          ? { ...file, progress, status: progress >= 100 ? "completed" : "transferring" }
          : file
      ));
    }
  };

  const markOwnChunk = (fileId: string, chunkIndex: number, chunkData: Uint8Array) => {
    const transfer = swarmTransfersRef.current.get(fileId);
    if (!transfer) {
      return;
    }

    transfer.localChunks.set(chunkIndex, chunkData);
    transfer.ownedChunks.add(chunkIndex);
  };

  const broadcastHave = async (fileId: string, chunkIndices: number[]) => {
    const transfer = swarmTransfersRef.current.get(fileId);
    const managers = getConnectedPeerManagers(transfer?.targetPeerIds);
    await Promise.all(
      managers.map((manager) => manager.sendHave(fileId, chunkIndices).catch((error) => console.error("Failed to broadcast HAVE:", error)))
    );
  };

  const requestNextChunks = async (fileId: string) => {
    const transfer = swarmTransfersRef.current.get(fileId);
    if (!transfer || transfer.completed) {
      return;
    }

    const connectedPeers = getConnectedPeerIds(transfer.targetPeerIds);
    if (connectedPeers.length === 0) {
      return;
    }

    const { manifest } = transfer;
    const missingChunks = Array.from({ length: manifest.chunkCount }, (_, index) => index).filter(
      (chunkIndex) => !transfer.ownedChunks.has(chunkIndex)
    );

    if (missingChunks.length === 0) {
      return;
    }

    const peerCounts = new Map<number, number>();
    for (const chunkIndex of missingChunks) {
      let count = 0;
      for (const peerId of connectedPeers) {
        if (transfer.peerHasAll[peerId] || transfer.peerChunks[peerId]?.has(chunkIndex) || peerId === manifest.originDeviceId) {
          count += 1;
        }
      }
      peerCounts.set(chunkIndex, count);
    }

    const outstandingByPeer = (peerId: string) => transfer.inFlight[peerId]?.size || 0;
    const inFlight = new Set<number>();
    Object.values(transfer.inFlight as Record<string, Set<number>>).forEach((entries: Set<number>) => {
      entries.forEach((chunkIndex) => inFlight.add(chunkIndex));
    });

    const orderedChunks = missingChunks
      .filter((chunkIndex) => !inFlight.has(chunkIndex))
      .sort((left, right) => (peerCounts.get(left) || 0) - (peerCounts.get(right) || 0));

    for (const chunkIndex of orderedChunks) {
      const candidatePeers = connectedPeers.filter(
        (peerId) => (transfer.peerHasAll[peerId] || transfer.peerChunks[peerId]?.has(chunkIndex) || peerId === manifest.originDeviceId) && outstandingByPeer(peerId) < MAX_OUTSTANDING_REQUESTS_PER_PEER
      );

      if (candidatePeers.length === 0) {
        continue;
      }

      const peerId = candidatePeers.sort((left, right) => outstandingByPeer(left) - outstandingByPeer(right))[0];
      if (!transfer.inFlight[peerId]) {
        transfer.inFlight[peerId] = new Set();
      }

      transfer.inFlight[peerId].add(chunkIndex);
      const manager = webrtcManagersRef.current.get(peerId);
      if (manager) {
        const timeoutKey = getChunkRequestTimeoutKey(fileId, peerId, chunkIndex);
        const existingTimeout = chunkRequestTimeoutsRef.current[timeoutKey];
        if (existingTimeout !== undefined) {
          window.clearTimeout(existingTimeout);
        }

        chunkRequestTimeoutsRef.current[timeoutKey] = window.setTimeout(() => {
          delete chunkRequestTimeoutsRef.current[timeoutKey];

          const currentTransfer = swarmTransfersRef.current.get(fileId);
          if (!currentTransfer || currentTransfer.completed || currentTransfer.ownedChunks.has(chunkIndex)) {
            return;
          }

          currentTransfer.inFlight[peerId]?.delete(chunkIndex);
          void requestNextChunks(fileId);
        }, CHUNK_REQUEST_TIMEOUT_MS);

        manager.requestChunk(fileId, chunkIndex).catch((error) => {
          console.error(`Failed to request chunk ${chunkIndex} from ${peerId}:`, error);
          transfer.inFlight[peerId].delete(chunkIndex);
          clearChunkRequestTimeout(fileId, peerId, chunkIndex);
        });
      }
    }
  };

  const clearPeerCleanupTimer = (peerId: string) => {
    const timerId = peerCleanupTimersRef.current[peerId];
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      delete peerCleanupTimersRef.current[peerId];
    }
  };

  const getChunkRequestTimeoutKey = (fileId: string, peerId: string, chunkIndex: number) => `${fileId}:${peerId}:${chunkIndex}`;

  const clearChunkRequestTimeout = (fileId: string, peerId: string, chunkIndex: number) => {
    const timeoutKey = getChunkRequestTimeoutKey(fileId, peerId, chunkIndex);
    const timerId = chunkRequestTimeoutsRef.current[timeoutKey];
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      delete chunkRequestTimeoutsRef.current[timeoutKey];
    }
  };

  const clearApprovalTimer = (transferId: string, peerId: string) => {
    const transferTimers = approvalTimeoutTimersRef.current[transferId];
    const timerId = transferTimers?.[peerId];
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      delete transferTimers[peerId];
    }

    if (transferTimers && Object.keys(transferTimers).length === 0) {
      delete approvalTimeoutTimersRef.current[transferId];
    }
  };

  const clearApprovalTimersForTransfer = (transferId: string) => {
    const transferTimers = approvalTimeoutTimersRef.current[transferId];
    if (!transferTimers) {
      return;
    }

    Object.values(transferTimers).forEach((timerId) => window.clearTimeout(timerId));
    delete approvalTimeoutTimersRef.current[transferId];
  };

  const commitPendingTransferApprovals = (
    updater: (current: Record<string, PendingTransferApproval>) => Record<string, PendingTransferApproval>
  ) => {
    const next = updater(pendingTransferApprovalsRef.current);
    pendingTransferApprovalsRef.current = next;
    setPendingTransferApprovals(next);
    return next;
  };

  const removePendingApproval = (transferId: string) => {
    clearApprovalTimersForTransfer(transferId);
    commitPendingTransferApprovals((current) => {
      if (!current[transferId]) {
        return current;
      }

      const next = { ...current };
      delete next[transferId];
      return next;
    });
  };

  const sendApprovalCancel = async (transferId: string, peerIds: string[]) => {
    const managers = getConnectedPeerManagers(peerIds);
    if (managers.length === 0) {
      return;
    }

    await Promise.all(
      managers.map((manager) =>
        manager.sendMessage({
          type: "transfer_approval_cancel",
          transfer_id: transferId,
          sender_device_id: deviceId,
          sender_device_name: normalizeDeviceName(deviceName),
        }).catch((error) => console.error("Failed to cancel transfer approval:", error))
      )
    );
  };

  const cancelPendingTransfer = async (transferId: string, status: "rejected" | "cancelled", reason?: string) => {
    const record = pendingTransferApprovalsRef.current[transferId];
    if (!record) {
      return;
    }

    setFiles((prev) => prev.map((file) => file.id === transferId ? { ...file, status, progress: 0 } : file));
    await sendApprovalCancel(transferId, record.targetPeerIds);
    removePendingApproval(transferId);

    if (reason) {
      toast[status === "rejected" ? "error" : "info"](reason);
    }
  };

  const startApprovedTransfer = async (transferId: string) => {
    const record = pendingTransferApprovalsRef.current[transferId];
    if (!record) {
      return;
    }

    const transfer = swarmTransfersRef.current.get(transferId);
    if (!transfer?.sourceFile) {
      await cancelPendingTransfer(transferId, "cancelled", "Transfer could not start.");
      return;
    }

    const approvedPeerIds = record.targetPeerIds.filter((peerId) => {
      const peerState = record.peerStates[peerId];
      return peerState?.status === "APPROVED" && peerConnectionStatesRef.current[peerId] === "connected";
    });

    if (approvedPeerIds.length === 0) {
      await cancelPendingTransfer(transferId, "rejected", "No receivers approved the transfer.");
      return;
    }

    transfer.targetPeerIds = [deviceId, ...approvedPeerIds];
    transfer.manifest.targetPeerIds = transfer.targetPeerIds;

    setFiles((prev) => prev.map((file) => file.id === transferId ? { ...file, status: "transferring" } : file));

    const managers = getConnectedPeerManagers(approvedPeerIds);
    if (managers.length === 0) {
      await cancelPendingTransfer(transferId, "cancelled", "All approved receivers disconnected before transfer started.");
      return;
    }

    try {
      await Promise.all(managers.map(async (manager) => {
        await manager.announceSwarmManifest(transfer.manifest);
      }));

      clearApprovalTimersForTransfer(transferId);
      removePendingApproval(transferId);
    } catch (error) {
      console.error("Failed to announce approved transfer manifest:", error);
      await cancelPendingTransfer(transferId, "cancelled", "Could not start the transfer.");
    }
  };

  const maybeResolvePendingTransfer = async (transferId: string) => {
    const record = pendingTransferApprovalsRef.current[transferId];
    if (!record) {
      return;
    }

    const peerStates = Object.values(record.peerStates);
    const hasPending = peerStates.some((peerState) => peerState.status === "PENDING_APPROVAL");
    if (hasPending) {
      return;
    }

    const approvedPeerIds = record.targetPeerIds.filter((peerId) => record.peerStates[peerId]?.status === "APPROVED");
    if (approvedPeerIds.length === 0) {
      await cancelPendingTransfer(transferId, "rejected", "All receivers rejected or timed out.");
      return;
    }

    await startApprovedTransfer(transferId);
  };

  const recordTransferApprovalDecision = async (
    transferId: string,
    peerId: string,
    decision: "accepted" | "rejected" | "timeout" | "cancelled"
  ) => {
    clearApprovalTimer(transferId, peerId);

    commitPendingTransferApprovals((current) => {
      const record = current[transferId];
      if (!record) {
        return current;
      }

      const peerState = record.peerStates[peerId];
      if (!peerState || peerState.status !== "PENDING_APPROVAL") {
        return current;
      }

      const next = { ...current };
      next[transferId] = {
        ...record,
        peerStates: {
          ...record.peerStates,
          [peerId]: {
            ...peerState,
            status: decision === "accepted" ? "APPROVED" : "REJECTED",
            reason: decision,
            respondedAt: Date.now(),
          },
        },
      };
      return next;
    });

    await maybeResolvePendingTransfer(transferId);
  };

  const scheduleApprovalTimeout = (transferId: string, peerId: string, timeoutMs: number) => {
    clearApprovalTimer(transferId, peerId);
    if (!approvalTimeoutTimersRef.current[transferId]) {
      approvalTimeoutTimersRef.current[transferId] = {};
    }

    approvalTimeoutTimersRef.current[transferId][peerId] = window.setTimeout(() => {
      void recordTransferApprovalDecision(transferId, peerId, "timeout");
    }, timeoutMs);
  };

  const handleIncomingApprovalRequest = (request: IncomingTransferApprovalRequest) => {
    setIncomingApprovalRequests((prev) => {
      if (prev.some((existing) => existing.transferId === request.transferId)) {
        return prev;
      }

      return [...prev, request];
    });

    // Schedule auto-dismiss timeout if user doesn't respond
    const existingTimer = incomingApprovalTimersRef.current.get(request.transferId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timeout = request.approvalTimeoutMs || APPROVAL_TIMEOUT_MS;
    const timerId = window.setTimeout(() => {
      incomingApprovalTimersRef.current.delete(request.transferId);
      // Auto-reject if user didn't respond in time
      setIncomingApprovalRequests((prev) => {
        const stillPending = prev.find((r) => r.transferId === request.transferId);
        if (!stillPending) {
          return prev;
        }
        // Notify sender that we timed out
        const manager = webrtcManagersRef.current.get(request.senderDeviceId);
        if (manager) {
          manager.sendMessage({
            type: "transfer_approval_response",
            transfer_id: request.transferId,
            sender_device_id: deviceId,
            sender_device_name: deviceName.trim() || "You",
            approval_status: "timeout",
          }).catch((error) => console.error("Failed to send approval timeout:", error));
        }
        return prev.filter((r) => r.transferId !== request.transferId);
      });
      toast.info(`Auto-rejected file transfer from ${request.senderDeviceName}: approval timed out.`);
    }, timeout);

    incomingApprovalTimersRef.current.set(request.transferId, timerId);
  };

  const dismissIncomingApprovalRequest = (transferId: string) => {
    // Clear any pending timeout
    const timerId = incomingApprovalTimersRef.current.get(transferId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      incomingApprovalTimersRef.current.delete(transferId);
    }
    setIncomingApprovalRequests((prev) => prev.filter((request) => request.transferId !== transferId));
  };

  const respondToApprovalRequest = (request: IncomingTransferApprovalRequest, approvalStatus: "accepted" | "rejected") => {
    const manager = webrtcManagersRef.current.get(request.senderDeviceId);
    if (manager) {
      manager.sendMessage({
        type: "transfer_approval_response",
        transfer_id: request.transferId,
        sender_device_id: deviceId,
        sender_device_name: deviceName.trim() || "You",
        approval_status: approvalStatus,
      }).catch((error) => console.error("Failed to send approval response:", error));
    }

    dismissIncomingApprovalRequest(request.transferId);
  };

  const cleanupPeerManager = (peerId: string, reason: string) => {
    console.warn(`[Session] Cleaning up peer ${peerId} at ${new Date().toISOString()} because ${reason}`);
    clearPeerCleanupTimer(peerId);

    const existing = webrtcManagersRef.current.get(peerId);
    if (existing) {
      existing.close();
      webrtcManagersRef.current.delete(peerId);
    }

    delete peerConnectionStatesRef.current[peerId];
    setPeerConnectionStates((prev) => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });

    for (const transfer of swarmTransfersRef.current.values()) {
      delete transfer.peerChunks[peerId];
      delete transfer.peerHasAll[peerId];
      delete transfer.inFlight[peerId];
    }

    for (const timeoutKey of Object.keys(chunkRequestTimeoutsRef.current)) {
      if (timeoutKey.split(":")[1] === peerId) {
        window.clearTimeout(chunkRequestTimeoutsRef.current[timeoutKey]);
        delete chunkRequestTimeoutsRef.current[timeoutKey];
      }
    }

    for (const [transferId, record] of Object.entries(pendingTransferApprovalsRef.current)) {
      const peerState = record.peerStates[peerId];
      if (!peerState || peerState.status !== "PENDING_APPROVAL") {
        continue;
      }

      void recordTransferApprovalDecision(transferId, peerId, "rejected");
    }

    for (const [transferId, transfer] of swarmTransfersRef.current.entries()) {
      if (!transfer.targetPeerIds.includes(peerId)) {
        continue;
      }

      transfer.targetPeerIds = transfer.targetPeerIds.filter((targetPeerId) => targetPeerId !== peerId);
      transfer.manifest.targetPeerIds = transfer.targetPeerIds;

      const activeRemoteTargets = transfer.targetPeerIds.filter(
        (targetPeerId) => targetPeerId !== deviceId && peerConnectionStatesRef.current[targetPeerId] === "connected"
      );

      if (transfer.completed) {
        continue;
      }

      if (activeRemoteTargets.length === 0) {
        transfer.completed = true;
        setFiles((prev) => prev.map((file) => file.id === transferId ? { ...file, status: "cancelled", progress: 0 } : file));
      }
    }

    syncOverallConnectionState();
    void Promise.all(Array.from(swarmTransfersRef.current.keys() as Iterable<string>).map((fileId) => requestNextChunks(fileId)));
  };

  const schedulePeerCleanup = (peerId: string, reason: string) => {
    if (disconnectingRef.current) {
      return;
    }

    if (peerCleanupTimersRef.current[peerId] !== undefined) {
      return;
    }

    const gracePeriodMs = 60000;
    console.warn(`[Session] Scheduling cleanup for peer ${peerId} in ${gracePeriodMs}ms because ${reason}`);
    peerCleanupTimersRef.current[peerId] = window.setTimeout(() => {
      delete peerCleanupTimersRef.current[peerId];
      const currentState = peerConnectionStatesRef.current[peerId];
      if (currentState === "failed" || currentState === "disconnected" || currentState === "closed") {
        cleanupPeerManager(peerId, `${reason} (grace period elapsed)`);
      }
    }, gracePeriodMs);
  };

  const initiateMutation = useMutation({
    mutationFn: () => api.initiatePairing({ 
      identifier: deviceId, 
      label: normalizeDeviceName(deviceName), 
      metadata: { type: "desktop" } 
    }),
    onSuccess: (data) => setPairing(data),
  });

  const joinMutation = useMutation({
    mutationFn: async (code: string) => {
      console.log('Attempting to join pairing with code:', code);
      try {
        // Always try to join directly - don't skip based on status
        // The backend will handle it correctly even if already connected
        console.log('Attempting to join pairing');
        const joinedPairing = await api.joinPairing(code, { 
          identifier: deviceId, 
          label: normalizeDeviceName(deviceName), 
          metadata: { type: "desktop" } 
        });
        console.log('Successfully joined pairing:', joinedPairing.status, 'peer_count:', joinedPairing.peer_count);
        return joinedPairing;
      } catch (error: unknown) {
        console.error('Join failed:', error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('Join mutation successful, pairing status:', data.status);
      setPairing(data);
    },
  });

  // Save pairing and deviceId to sessionStorage whenever they change
  useEffect(() => {
    if (pairing) {
      sessionStorage.setItem("pairing", JSON.stringify(pairing));
    } else {
      sessionStorage.removeItem("pairing");
    }
    sessionStorage.setItem("deviceId", deviceId);
    sessionStorage.setItem("deviceName", normalizeDeviceName(deviceName));
  }, [pairing, deviceId, deviceName]);

  useEffect(() => {
    if (loaderHideTimerRef.current !== null) {
      window.clearTimeout(loaderHideTimerRef.current);
      loaderHideTimerRef.current = null;
    }

    if (!pairing) {
      if (loaderStartRef.current === null) {
        loaderStartRef.current = Date.now();
      }
      setShowLoader(true);
      return;
    }

    if (loaderStartRef.current === null) {
      setShowLoader(false);
      return;
    }

    const elapsed = Date.now() - loaderStartRef.current;
    const remaining = Math.max(0, 1000 - elapsed);

    if (remaining === 0) {
      loaderStartRef.current = null;
      setShowLoader(false);
      return;
    }

    loaderHideTimerRef.current = window.setTimeout(() => {
      loaderStartRef.current = null;
      setShowLoader(false);
    }, remaining);

    return () => {
      if (loaderHideTimerRef.current !== null) {
        window.clearTimeout(loaderHideTimerRef.current);
        loaderHideTimerRef.current = null;
      }
    };
  }, [pairing]);

  useEffect(() => {
    if (!pairing) {
      return;
    }

    let cancelled = false;

    const validateStoredPairing = async () => {
      try {
        const freshPairing = await api.getPairing(pairing.code);
        if (!cancelled) {
          setPairing(freshPairing);
        }
      } catch (error) {
        console.warn("Stored pairing is no longer valid, resetting session state:", error);
        sessionStorage.removeItem("pairing");
        if (!cancelled) {
          setPairing(null);
        }
      }
    };

    void validateStoredPairing();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const liveRemotePeerIds = [pairing?.initiator, ...(pairing?.peers || [])]
      .filter((participant): participant is DeviceDescriptor => Boolean(participant))
      .filter((participant) => participant.identifier !== deviceId)
      .filter((participant) => peerConnectionStates[participant.identifier] === "connected")
      .map((participant) => participant.identifier);

    if (!peerSelectionInitializedRef.current) {
      if (liveRemotePeerIds.length > 0) {
        setSelectedPeerIds(liveRemotePeerIds);
        peerSelectionInitializedRef.current = true;
      }
      return;
    }

    if (!peerSelectionTouchedRef.current) {
      setSelectedPeerIds(liveRemotePeerIds);
      return;
    }

    setSelectedPeerIds((prev) => prev.filter((peerId) => liveRemotePeerIds.includes(peerId)));
  }, [pairing?.initiator, pairing?.peers, peerConnectionStates, deviceId]);

  useEffect(() => {
    if (!runtimeConfig) {
      return;
    }

    // Only initiate/join if we don't have a restored pairing and maintenance allows new sessions
    if (!pairing && runtimeConfig.maintenance_mode === "off") {
      if (connectionCode) {
        joinMutation.mutate(connectionCode);
      } else {
        initiateMutation.mutate();
      }
    }
  }, [connectionCode, pairing, runtimeConfig?.maintenance_mode]);

  // Subscribe to real-time pairing updates via SSE
  useEffect(() => {
    if (!pairing) {
      return;
    }

    console.log('Starting SSE subscription for pairing updates');
    const eventSource = api.subscribeToPairingUpdates(
      pairing.code,
      (updatedPairing) => {
        console.log('Received SSE pairing update:', updatedPairing.status);
        if (updatedPairing.status !== pairing.status ||
            (updatedPairing.peer_count || 0) !== (pairing.peer_count || 0) ||
            JSON.stringify(updatedPairing.peers) !== JSON.stringify(pairing.peers)) {
          console.log(`Pairing updated: status=${updatedPairing.status}, peers=${updatedPairing.peer_count || 0}`);
          setPairing(updatedPairing);
        }
      },
      (error) => {
        console.error("SSE connection failed, falling back to polling:", error);
        // Could implement fallback polling here if needed
      }
    );

    return () => {
      console.log('Closing SSE connection');
      eventSource.close();
    };
  }, [pairing?.code]); // Only depend on pairing code, not the whole pairing object

  useEffect(() => {
    if (!pairing || pairing.status === "pending") {
      return;
    }

    const baseUrl = import.meta.env.VITE_API_BASE || "http://localhost:8000";
    const participants = [pairing.initiator, ...(pairing.peers || [])].filter(
      (participant) => participant.identifier !== deviceId
    );
    const participantIds = new Set(participants.map((participant) => participant.identifier));

    for (const [peerId, manager] of webrtcManagersRef.current.entries()) {
      if (!participantIds.has(peerId)) {
        manager.close();
        webrtcManagersRef.current.delete(peerId);
        delete peerConnectionStatesRef.current[peerId];
      }
    }

    const syncSwarmTransfersWithPeer = async (peerId: string) => {
      const manager = webrtcManagersRef.current.get(peerId);
      if (!manager) {
        return;
      }

      for (const transfer of swarmTransfersRef.current.values()) {
        if (!transfer.targetPeerIds.includes(peerId)) {
          continue;
        }

        try {
          await manager.announceSwarmManifest(transfer.manifest);
        } catch (error) {
          console.error(`Failed to sync swarm manifest to ${peerId}:`, error);
        }
      }
    };

    const createPeerManager = (remotePeer: DeviceDescriptor) => {
      const remotePeerId = remotePeer.identifier;
      const isInitiator = deviceId.localeCompare(remotePeerId) < 0;

      const manager = new WebRTCManager(
        baseUrl,
        pairing.id,
        deviceId,
        remotePeerId,
        isInitiator,
        (message) => {
          console.log(`WebRTC message received from ${remotePeerId}:`, message);

          if (message.type === "peer_connected") {
            setPairing((prev) => prev ? { ...prev, status: "connected" } : null);
            setMessages((prev) => [...prev, {
              type: "peer_connected",
              content: `${remotePeer.label || remotePeer.identifier} joined the session`,
              sender: "peer",
              sender_device_id: remotePeer.identifier,
              timestamp: Date.now(),
            }]);
            
            const currentName = deviceNameRef.current;
            if (currentName && currentName !== "My Device") {
              manager.sendMessage({
                type: "peer_name_changed",
                sender_device_id: deviceId,
                sender_device_name: normalizeDeviceName(currentName),
                content: normalizeDeviceName(currentName),
                timestamp: Date.now(),
              }).catch(console.error);
            }
            return;
          }

          if (message.type === "transfer_approval_request" && message.transfer_id) {
            const filesForApproval = message.files || [];
            handleIncomingApprovalRequest({
              transferId: message.transfer_id,
              senderDeviceId: message.sender_device_id || remotePeerId,
              senderDeviceName: message.sender_device_name || remotePeer.label || remotePeer.identifier,
              files: filesForApproval,
              totalSize: message.total_size || filesForApproval.reduce((sum, file) => sum + file.size, 0),
              approvalTimeoutMs: message.approval_timeout_ms || APPROVAL_TIMEOUT_MS,
            });
            return;
          }

          if (message.type === "transfer_approval_cancel" && message.transfer_id) {
            dismissIncomingApprovalRequest(message.transfer_id);
            return;
          }

          if (message.type === "transfer_approval_response" && message.transfer_id) {
            const decision = message.approval_status === "accepted"
              ? "accepted"
              : message.approval_status === "timeout"
                ? "timeout"
                : "rejected";

            void recordTransferApprovalDecision(message.transfer_id, remotePeerId, decision);
            return;
          }

          if (message.type === "file_cancel") {
            const cancelLabel = message.content || `File cancelled: ${message.filename || message.file_name || "file"}`;

            setMessages((prev) => [...prev, { ...message, sender: "peer", sender_device_id: remotePeer.identifier, senderName: message.senderName || remotePeer.label || remotePeer.identifier, content: cancelLabel, timestamp: Date.now() }]);

            if (activeTab !== "files") {
              setUnreadTabs((prev) => new Set([...prev, "files"]));
            }

            return;
          }

          if (message.type === "file_manifest" && message.file_id && message.filename && message.file_size) {
            const chunkSize = message.chunk_size || calculateSwarmChunkSize(message.file_size);
            const manifest: SwarmManifest = {
              fileId: message.file_id,
              filename: message.filename,
              fileSize: message.file_size,
              mimeType: message.mime_type || "application/octet-stream",
              chunkSize,
              chunkCount: Math.ceil(message.file_size / chunkSize),
              chunkHashes: message.chunk_hashes || [],
              originDeviceId: message.origin_device_id || remotePeerId,
              targetPeerIds: message.target_peer_ids || [remotePeerId],
            };

            const transfer = ensureTransfer(manifest);
            transfer.manifest = manifest;
            transfer.targetPeerIds = manifest.targetPeerIds;
            transfer.peerHasAll[remotePeerId] = manifest.originDeviceId === remotePeerId;
            if (!transfer.peerChunks[remotePeerId]) {
              transfer.peerChunks[remotePeerId] = new Set();
            }

            void requestNextChunks(manifest.fileId);
            return;
          }

          if (message.type === "have" && message.file_id && message.chunk_indices) {
            markPeerChunks(message.file_id, remotePeerId, message.chunk_indices);
            void requestNextChunks(message.file_id);
            return;
          }

          if (message.type === "complete" && message.file_id) {
            const transfer = swarmTransfersRef.current.get(message.file_id);
            if (transfer) {
              transfer.peerHasAll[remotePeerId] = true;
              transfer.peerChunks[remotePeerId] = new Set();
              
              // Check if all target peers (excluding self) have completed
              const remoteTargetPeerIds = transfer.targetPeerIds.filter((id) => id !== deviceId);
              const allPeersCompleted = remoteTargetPeerIds.every((peerId) => transfer.peerHasAll[peerId]);
              
              if (allPeersCompleted && !transfer.completed) {
                transfer.completed = true;
                if (transfer.manifest.originDeviceId === deviceId) {
                  // Update the sender's UI to completed
                  setFiles((prev) => prev.map((file) =>
                    file.id === message.file_id
                      ? { ...file, progress: 100, status: "completed" }
                      : file
                  ));
                }
              }
            }
            void requestNextChunks(message.file_id);
            return;
          }

          if (message.type === "file_end" && message.file_id) {
            // Handle file_end message - mark transfer as completed on sender side
            const transfer = swarmTransfersRef.current.get(message.file_id);
            if (transfer && !transfer.completed) {
              transfer.peerHasAll[remotePeerId] = true;
              transfer.peerChunks[remotePeerId] = new Set(Array.from({ length: transfer.manifest.chunkCount }, (_, index) => index));
              
              // Check if all peers have completed
              const remoteTargetPeerIds = transfer.targetPeerIds.filter((id) => id !== deviceId);
              const allPeersCompleted = remoteTargetPeerIds.every((peerId) => transfer.peerHasAll[peerId]);
              
              if (allPeersCompleted) {
                transfer.completed = true;
                if (transfer.manifest.originDeviceId === deviceId) {
                  setFiles((prev) => prev.map((file) =>
                    file.id === message.file_id
                      ? { ...file, progress: 100, status: "completed" }
                      : file
                  ));
                }
              }
            }
            void requestNextChunks(message.file_id);
            return;
          }

          if (message.type === "peer_name_changed" && message.sender_device_id && message.sender_device_name) {
            const newName = message.sender_device_name;
            let oldName = remotePeerId;

            setPairing((prev) => {
              if (!prev) return null;
              const peer = (prev.peers || []).find((p) => p.identifier === remotePeerId);
              if (peer?.label) {
                oldName = peer.label;
              } else if (prev.initiator.identifier === remotePeerId && prev.initiator.label) {
                oldName = prev.initiator.label;
              }

              const updatedPeers = (prev.peers || []).map((p) => {
                if (p.identifier === remotePeerId) {
                  return { ...p, label: newName };
                }
                return p;
              });
              const updatedInitiator = prev.initiator.identifier === remotePeerId
                ? { ...prev.initiator, label: newName }
                : prev.initiator;
              return { ...prev, peers: updatedPeers, initiator: updatedInitiator };
            });
            
            if (oldName !== newName) {
              setMessages((prev) => [...prev, {
                type: "peer_name_changed",
                content: `${oldName} changed their name to ${newName}`,
                sender: "peer",
                sender_device_id: remotePeer.identifier,
                timestamp: Date.now(),
              }]);
            }
            return;
          }

          if (message.type !== "request" && message.type !== "have" && message.type !== "complete" && message.type !== "file_manifest" && message.type !== "file_end" && message.type !== "peer_name_changed") {
            setMessages((prev) => [...prev, { ...message, sender: "peer", sender_device_id: remotePeer.identifier, senderName: message.senderName || remotePeer.label || remotePeer.identifier, timestamp: Date.now() }]);

            if (message.sender === "peer" || (message.sender !== "you" && message.sender !== undefined)) {
              let tabToMark = "";
              if (message.type === "text") {
                tabToMark = message.isCode ? "code" : "messages";
              } else if (message.type.includes("file")) {
                tabToMark = "files";
              }

              if (tabToMark) {
                setUnreadTabs((prev) => new Set([...prev, tabToMark]));
              }
            }
          }
        },
        (state) => {
          console.log(`[Session] WebRTC connection state changed for ${remotePeerId} at ${new Date().toISOString()}:`, state);

          if (state === "connected" || state === "connecting" || state === "new") {
            clearPeerCleanupTimer(remotePeerId);
          }

          peerConnectionStatesRef.current[remotePeerId] = state;
          setPeerConnectionStates((prev) => ({ ...prev, [remotePeerId]: state }));
          syncOverallConnectionState();

          if (state === "failed" || state === "disconnected" || state === "closed") {
            schedulePeerCleanup(remotePeerId, `peer state ${state}`);
            return;
          }

          if (state === "connected") {
            void syncSwarmTransfersWithPeer(remotePeerId);
            void Promise.all(Array.from(swarmTransfersRef.current.keys() as Iterable<string>).map((fileId) => requestNextChunks(fileId)));
          }
        },
        (progress) => {
          console.log(`File progress update from ${remotePeerId}:`, progress);
          setFiles((prev) => {
            const existingIndex = prev.findIndex((file) => file.id === progress.id);

            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = {
                ...updated[existingIndex],
                progress: progress.progress,
                status: progress.status,
                direction: progress.status === "receiving" ? "received" : "sent",
              };
              return updated;
            }

            if (progress.status === "receiving" || progress.status === "sending") {
              const newFile: FileItem = {
                id: progress.id,
                name: progress.name,
                size: `${(progress.size / 1024 / 1024).toFixed(1)} MB`,
                progress: progress.progress,
                status: progress.status,
                type: progress.name.includes(".")
                  ? progress.name.endsWith(".jpg") || progress.name.endsWith(".png") || progress.name.endsWith(".gif")
                    ? "image"
                    : progress.name.endsWith(".mp4") || progress.name.endsWith(".avi")
                      ? "video"
                      : progress.name.endsWith(".zip") || progress.name.endsWith(".rar")
                        ? "archive"
                        : "other"
                  : "other",
                direction: progress.status === "receiving" ? "received" : "sent",
                senderName: progress.status === "receiving" ? (remotePeer.label || remotePeer.identifier) : (deviceName.trim() || "You"),
              };

              if (progress.status === "receiving" && !markedFilesUnreadRef.current.has(progress.id)) {
                markedFilesUnreadRef.current.add(progress.id);
                setUnreadTabs((prev) => new Set([...prev, "files"]));
              }

              return [...prev, newFile];
            }

            return prev;
          });
        },
        (completedFile) => {
          const transfer = swarmTransfersRef.current.get(completedFile.fileId);
          if (transfer) {
            transfer.completed = true;
            transfer.peerChunks[remotePeerId] = new Set(Array.from({ length: transfer.manifest.chunkCount }, (_, index) => index));
            for (let chunkIndex = 0; chunkIndex < transfer.manifest.chunkCount; chunkIndex += 1) {
              clearChunkRequestTimeout(completedFile.fileId, remotePeerId, chunkIndex);
            }
          }
          void requestNextChunks(completedFile.fileId);

          // Send a complete message back to the sender to notify that we've received all chunks
          // This needs to be sent to the origin sender, not necessarily the peer we received the last chunk from
          // We send it to all connected peers in case it's a swarm
          const managers = getConnectedPeerManagers();
          const fileId = completedFile.fileId;
          Promise.all(managers.map((manager) =>
            manager.sendMessage({
              type: "complete",
              file_id: fileId,
              timestamp: Date.now(),
            }).catch((error) => console.error(`Failed to send completion notification:`, error))
          ));
          
          // Also send a file_end message as a secondary notification for the sender side
          Promise.all(managers.map((manager) =>
            manager.sendMessage({
              type: "file_end",
              file_id: fileId,
              filename: completedFile.filename,
              timestamp: Date.now(),
            }).catch((error) => console.error(`Failed to send file_end notification:`, error))
          ));
        },
        async (chunk: SwarmChunkReceipt) => {
          const transfer = swarmTransfersRef.current.get(chunk.fileId);
          if (!transfer) {
            return;
          }

          const expectedHash = transfer.manifest.chunkHashes[chunk.chunkIndex];
          if (expectedHash) {
            const actualHash = await hashChunk(chunk.chunk);
            if (actualHash !== expectedHash) {
              console.warn(`Rejecting chunk ${chunk.chunkIndex} for ${chunk.fileId} due to hash mismatch`);
              transfer.inFlight[remotePeerId]?.delete(chunk.chunkIndex);
              return;
            }
          }

          markOwnChunk(chunk.fileId, chunk.chunkIndex, chunk.chunk);
          markPeerChunks(chunk.fileId, remotePeerId, [chunk.chunkIndex]);

          transfer.inFlight[remotePeerId]?.delete(chunk.chunkIndex);
          clearChunkRequestTimeout(chunk.fileId, remotePeerId, chunk.chunkIndex);

          await broadcastHave(chunk.fileId, [chunk.chunkIndex]);

          if (transfer.ownedChunks.size === transfer.manifest.chunkCount) {
            transfer.completed = true;
          }

          await requestNextChunks(chunk.fileId);
        },
        async ({ fileId, chunkIndex }) => {
          const transfer = swarmTransfersRef.current.get(fileId);
          if (!transfer) {
            return null;
          }

          const existingChunk = transfer.localChunks.get(chunkIndex);
          if (existingChunk) {
            return existingChunk;
          }

          if (transfer.sourceFile) {
            return readFileChunk(transfer.sourceFile, chunkIndex, transfer.manifest.chunkSize);
          }

          return null;
        }
      );

      webrtcManagersRef.current.set(remotePeerId, manager);
      peerConnectionStatesRef.current[remotePeerId] = "new";
      setPeerConnectionStates((prev) => ({ ...prev, [remotePeerId]: "new" }));
      manager.initialize().catch((error) => {
        console.error(`Failed to initialize peer connection with ${remotePeerId}:`, error);
        peerConnectionStatesRef.current[remotePeerId] = "failed";
        setPeerConnectionStates((prev) => ({ ...prev, [remotePeerId]: "failed" }));
          syncOverallConnectionState();
      });
    };

    participants.forEach((participant) => {
      if (!webrtcManagersRef.current.has(participant.identifier)) {
        createPeerManager(participant);
      }
    });

    syncOverallConnectionState();

    return () => {
      for (const [peerId, manager] of webrtcManagersRef.current.entries()) {
        if (!participantIds.has(peerId)) {
          clearPeerCleanupTimer(peerId);
          manager.close();
          webrtcManagersRef.current.delete(peerId);
          delete peerConnectionStatesRef.current[peerId];
        }
      }
    };
  }, [pairing?.status, pairing?.id, pairing?.peers, pairing?.initiator, deviceId]);

  // Watch for new messages from peer and mark tabs as unread
  useEffect(() => {
    // Only process messages that haven't been processed yet
    if (messages.length > lastProcessedMessageIndexRef.current + 1) {
      for (let i = lastProcessedMessageIndexRef.current + 1; i < messages.length; i++) {
        const message = messages[i];
        
        // Only process messages from peer (not sent by us)
        if (message.sender === "peer" || (message.sender !== "you" && message.sender !== undefined)) {
          if (message.type === "text") {
            const tabToMark = message.isCode ? "code" : "messages";
            
            // Only mark as unread if we're not currently viewing this tab
            if (activeTab !== tabToMark) {
              setUnreadTabs(prev => new Set([...prev, tabToMark]));
            }
          } else if (message.type.includes("file")) {
            if (activeTab !== "files") {
              setUnreadTabs(prev => new Set([...prev, "files"]));
            }
          }
        }
      }
      
      // Update the last processed message index
      lastProcessedMessageIndexRef.current = messages.length - 1;
    }
  }, [messages, activeTab]);

  const sendMessage = (content: string, targetPeerIds: string[] = []) => {
    if (featureFlags && !featureFlags.messaging) {
      toast.error("Messaging is disabled by an administrator.");
      return;
    }

    const recipientIds = targetPeerIds.length > 0 ? targetPeerIds : getConnectedPeerIds();
    const managers = getConnectedPeerManagers(targetPeerIds.length > 0 ? targetPeerIds : undefined);
    if (managers.length === 0) return;

    const message: Message = {
      type: "text",
      content,
      sender: "you",
      senderName: deviceName.trim() || "You",
      ...(targetPeerIds.length > 0 ? { target_peer_ids: recipientIds } : {}),
    };
    managers.forEach((manager) => {
      manager.sendMessage(message).catch((error) => console.error("Failed to send message:", error));
    });
    setMessages(prev => [...prev, { ...message, timestamp: Date.now() }]);
  };

  const sendCode = (code: string, title: string) => {
    if (featureFlags && !featureFlags.code_sharing) {
      toast.error("Code sharing is disabled by an administrator.");
      return;
    }

    const managers = getConnectedPeerManagers();
    if (managers.length === 0) return;

    const message: Message = { type: "text", content: code, sender: "you", senderName: deviceName.trim() || "You", isCode: true, codeTitle: title };
    managers.forEach((manager) => {
      manager.sendMessage(message).catch((error) => console.error("Failed to send code:", error));
    });
    setMessages(prev => [...prev, { ...message, timestamp: Date.now() }]);
  };

  const uploadFile = async (file: File, targetPeerIds: string[]) => {
    if (featureFlags && !featureFlags.file_transfer) {
      toast.error("File transfer is disabled by an administrator.");
      return;
    }

    if (policy && file.size > policy.max_file_size_bytes) {
      toast.error(`File exceeds the ${Math.round(policy.max_file_size_bytes / 1024 / 1024)} MB limit.`);
      return;
    }

    const selectedTargets = targetPeerIds.length > 0 ? targetPeerIds : selectedPeerIds;
    const connectedTargets = getConnectedPeerIds(selectedTargets);
    const managers = getConnectedPeerManagers(connectedTargets);

    if (managers.length === 0) {
      toast.error("Select at least one connected receiver.");
      return;
    }

    const fileId = Math.random().toString(36).substr(2, 9);
    let manifest: SwarmManifest | null = null;

    try {
      manifest = await createSwarmManifest(file, deviceId, fileId);
      manifest.targetPeerIds = [deviceId, ...connectedTargets.filter((peerId) => peerId !== deviceId)];
      const transfer = ensureTransfer(manifest);
      transfer.sourceFile = file;
      transfer.manifest = manifest;
      transfer.completed = false;
      transfer.targetPeerIds = manifest.targetPeerIds;
      transfer.peerHasAll[deviceId] = true;
      transfer.ownedChunks = new Set(Array.from({ length: manifest.chunkCount }, (_, index) => index));

      setFiles((prev) => [
        ...prev,
        {
          id: manifest.fileId,
          name: manifest.filename,
          size: `${(manifest.fileSize / 1024 / 1024).toFixed(1)} MB`,
          progress: 0,
          status: "pending_approval",
          type: manifest.filename.endsWith(".jpg") || manifest.filename.endsWith(".png") || manifest.filename.endsWith(".gif")
            ? "image"
            : manifest.filename.endsWith(".mp4") || manifest.filename.endsWith(".avi")
              ? "video"
              : manifest.filename.endsWith(".zip") || manifest.filename.endsWith(".rar")
                ? "archive"
                : "other",
          direction: "sent",
              senderName: deviceName.trim() || "You",
        },
      ]);

      // Build peer lookup from current participants - avoids closure issue with livePeers
      const currentParticipants = [pairing.initiator, ...(pairing.peers || [])].filter(
        (p) => p.identifier !== deviceId
      );
      const peerStates: Record<string, TransferApprovalPeerState> = {};
      connectedTargets.forEach((peerId) => {
        const peer = currentParticipants.find((candidate) => candidate.identifier === peerId);
        peerStates[peerId] = {
          peerId,
          peerName: peer?.label || peer?.identifier || peerId,
          status: "PENDING_APPROVAL",
        };
      });

      const approvalRecord: PendingTransferApproval = {
        transferId: manifest.fileId,
        fileName: manifest.filename,
        totalSize: manifest.fileSize,
        senderDeviceName: deviceName.trim() || "You",
        targetPeerIds: connectedTargets,
        peerStates,
        createdAt: Date.now(),
        timeoutMs: APPROVAL_TIMEOUT_MS,
      };

      commitPendingTransferApprovals((current) => ({
        ...current,
        [manifest.fileId]: approvalRecord,
      }));

      for (const peerId of connectedTargets) {
        const manager = webrtcManagersRef.current.get(peerId);
        if (!manager) {
          continue;
        }

        scheduleApprovalTimeout(manifest.fileId, peerId, APPROVAL_TIMEOUT_MS);

        await manager.sendMessage({
          type: "transfer_approval_request",
          transfer_id: manifest.fileId,
          sender_device_id: deviceId,
          sender_device_name: deviceName.trim() || "You",
          files: [{ name: file.name, size: file.size, mimeType: file.type || undefined }],
          total_size: file.size,
          approval_timeout_ms: APPROVAL_TIMEOUT_MS,
        });
      }

      void maybeResolvePendingTransfer(manifest.fileId);
    } catch (error) {
      console.error("File upload failed:", error);
      await cancelPendingTransfer(fileId, "cancelled", "File upload failed.");
    }
  };

  const cancelFileTransfer = (fileId: string) => {
    const pendingApproval = pendingTransferApprovalsRef.current[fileId];
    if (pendingApproval) {
      void cancelPendingTransfer(fileId, "cancelled", "Transfer cancelled before approval.");
      return;
    }

    const swarmTransfer = swarmTransfersRef.current.get(fileId);
    if (swarmTransfer) {
      const cancelMessage: Message = {
        type: "file_cancel",
        filename: swarmTransfer.manifest.filename,
        file_id: fileId,
        content: `File cancelled: ${swarmTransfer.manifest.filename}`,
        timestamp: Date.now(),
      };

      for (const manager of getConnectedPeerManagers()) {
        manager.sendMessage(cancelMessage).catch((error) => console.error("Failed to broadcast swarm cancellation:", error));
      }

      swarmTransfersRef.current.delete(fileId);
      setFiles((prev) => prev.map((file) => file.id === fileId ? { ...file, status: "cancelled", progress: 0 } : file));
      setMessages((prev) => [...prev, { ...cancelMessage, sender: "you" }]);
      return;
    }

    for (const manager of Array.from(webrtcManagersRef.current.values()) as WebRTCManager[]) {
      manager.cancelFileTransfer(fileId);
    }
  };

  const handleUserNameChange = (newName: string) => {
    const oldName = deviceName;
    setDeviceName(newName);
    
    if (oldName !== newName && oldName.trim() !== "") {
      setMessages((prev) => [...prev, {
        type: "peer_name_changed",
        content: `You changed your name to ${newName}`,
        sender: "you",
        timestamp: Date.now(),
      }]);
    }

    // Broadcast the name change to all connected peers
    const managers = getConnectedPeerManagers();
    if (managers.length > 0) {
      const message: Message = {
        type: "peer_name_changed",
        sender_device_id: deviceId,
        sender_device_name: normalizeDeviceName(newName),
        content: normalizeDeviceName(newName),
        timestamp: Date.now(),
      };
      
      managers.forEach((manager) => {
        manager.sendMessage(message).catch((error) => {
          console.error("Failed to broadcast name change:", error);
        });
      });
    }
  };

  const handleDisconnect = () => {
    disconnectingRef.current = true;

    for (const peerId of Object.keys(peerCleanupTimersRef.current)) {
      clearPeerCleanupTimer(peerId);
    }

    // Close all WebRTC connections
    for (const manager of webrtcManagersRef.current.values()) {
      manager.close();
    }
    webrtcManagersRef.current.clear();
    peerConnectionStatesRef.current = {};
    setPeerConnectionStates({});
    swarmTransfersRef.current.clear();
    markedFilesUnreadRef.current.clear();
    lastProcessedMessageIndexRef.current = -1;
    setSelectedPeerIds([]);
    peerSelectionInitializedRef.current = false;

    // Clear all cache and state
    sessionStorage.removeItem("pairing");
    sessionStorage.removeItem("deviceId");
    sessionStorage.removeItem("deviceName");
    localStorage.clear(); // Clear any persistent cache
    
    // Reset state
    setPairing(null);
    setMessages([]);
    setFiles([]);
    setUnreadTabs(new Set());
    setConnectionState("new");
    peerSelectionTouchedRef.current = false;
    // Clear all incoming approval request timers
    for (const [, timerId] of incomingApprovalTimersRef.current.entries()) {
      window.clearTimeout(timerId);
    }
    incomingApprovalTimersRef.current.clear();

    setPendingTransferApprovals({});
    pendingTransferApprovalsRef.current = {};
    approvalTimeoutTimersRef.current = {};
    setIncomingApprovalRequests([]);

    // Navigate back to home
    navigate("/");
  };

  const shouldShowLoader = (!pairing && (!runtimeConfig || (showLoader && maintenanceMode === "off")));

  if (shouldShowLoader) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#ececec]">
          <Loader />
        </div>
      );
  }

  if (!pairing && maintenanceMode !== "off") {
    return (
      <div className="min-h-screen flex items-center justify-center relative px-4 bg-gradient-to-br from-[#18120f] via-[#231915] to-[#0f1312] text-white">
        <BackgroundEffects />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative z-10 max-w-lg rounded-3xl border border-white/10 bg-white/8 p-8 shadow-2xl backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.35em] text-white/60">Maintenance mode</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">New pairings are paused</h1>
          <p className="mt-3 text-sm leading-6 text-white/75">
            An administrator has {maintenanceMode === "shutdown" ? "fully stopped active sessions and disabled new connections" : "blocked new pairings and joins for now"}.
          </p>
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-white/70">
            <p className="font-medium text-white/80">What this means</p>
            <p className="mt-1">Existing sessions continue only if the app is in block-new mode. Refresh or try again later.</p>
          </div>
          <Button variant="outline" className="mt-6 w-full bg-white text-black hover:bg-white/90" onClick={() => navigate("/")}>
            Return home
          </Button>
        </div>
      </div>
    );
  }

  const allParticipants = [pairing.initiator, ...(pairing.peers || [])].filter(
    (participant) => participant.identifier !== deviceId
  );
  const selectablePeers = allParticipants.filter(
    (participant) => peerConnectionStates[participant.identifier] === "connected"
  );
  const livePeers = allParticipants.filter(
    (participant) => peerConnectionStates[participant.identifier] === "connected"
  );
  const recoveringPeers = Object.keys(peerCleanupTimersRef.current).length > 0;
  const liveConnectionState =
    livePeers.length > 0
      ? "connected"
      : recoveringPeers
        ? "connecting"
      : Object.values(peerConnectionStates).some((state) => state === "connecting" || state === "new")
        ? "connecting"
        : Object.values(peerConnectionStates).some((state) => state === "failed" || state === "disconnected" || state === "closed")
          ? "failed"
          : connectionState;

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <BackgroundEffects />

      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container max-w-6xl flex min-w-0 items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleDisconnect}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-bold tracking-tight text-foreground">Nexdrop</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {maintenanceMode !== "off" && (
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 uppercase tracking-[0.2em] text-[10px] text-foreground">
                {maintenanceMode === "shutdown" ? "Shutdown" : "Join blocked"}
              </span>
            )}
            <span>Session Active</span>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl px-4 py-8">
        <div className="grid min-w-0 gap-6 lg:grid-cols-[300px_1fr]">
          <ConnectionPanel
            pairingCode={pairing.code}
            status={
              liveConnectionState === "connected" ? "connected" :
              liveConnectionState === "failed" ? "failed" :
              pairing.status === "pending" ? "waiting" : "connecting"
            }
            onDisconnect={handleDisconnect}
            userName={normalizeDeviceName(deviceName)}
            onUserNameChange={handleUserNameChange}
            peers={livePeers}
            peerCount={livePeers.length}
          />

          <div className="surface-elevated min-w-0 rounded-xl p-6">
            {maintenanceMode !== "off" && (
              <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
                {maintenanceMode === "shutdown"
                  ? "Maintenance shutdown is active. Active sessions will be disconnected."
                  : "Maintenance is active. New pairings and joins are blocked."}
              </div>
            )}
            <Tabs value={activeTab} onValueChange={(value) => {
              setActiveTab(value);
              setUnreadTabs(prev => {
                const updated = new Set(prev);
                updated.delete(value);
                
                // Clear marked files when user views the files tab
                if (value === "files") {
                  markedFilesUnreadRef.current.clear();
                }
                
                return updated;
              });
            }}>
              <div className="mb-6 flex justify-center">
                <TabsList className="max-w-full bg-secondary">
                  <TabsTrigger value="files" className="relative flex-none gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                    <FileText className="h-3.5 w-3.5" />
                    Files
                    {unreadTabs.has("files") && (
                      <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="messages" className="relative flex-none gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Messages
                    {unreadTabs.has("messages") && (
                      <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="code" className="relative flex-none gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                    <Code className="h-3.5 w-3.5" />
                    Code
                    {unreadTabs.has("code") && (
                      <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="files" className="min-w-0">
                {incomingApprovalRequests.length > 0 && (
                  <div className="mb-5 space-y-3">
                    {incomingApprovalRequests.map((request) => (
                      <div key={request.transferId} className="rounded-2xl border border-border bg-card/90 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Incoming files from {request.senderDeviceName}</p>
                            <p className="text-xs text-muted-foreground">{request.files.length} files • {formatBytes(request.totalSize)}</p>
                          </div>
                          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-amber-700">
                            Approval needed
                          </span>
                        </div>

                        <div className="mt-3 space-y-2">
                          {request.files.map((file) => (
                            <div key={file.name} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm text-foreground">{file.name}</p>
                                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                              </div>
                              <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                                {file.mimeType || "File"}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-muted-foreground">Approve before any chunks are shared.</p>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => respondToApprovalRequest(request, "rejected")}>
                              Reject
                            </Button>
                            <Button size="sm" onClick={() => respondToApprovalRequest(request, "accepted")}>
                              Accept
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {Object.values(pendingTransferApprovals).length > 0 && (
                  <div className="mb-5 space-y-3">
                    {Object.values(pendingTransferApprovals).map((transfer) => {
                      const peerStates = Object.values(transfer.peerStates);
                      const pendingCount = peerStates.filter((peerState) => peerState.status === "PENDING_APPROVAL").length;
                      const approvedCount = peerStates.filter((peerState) => peerState.status === "APPROVED").length;
                      const rejectedCount = peerStates.filter((peerState) => peerState.status === "REJECTED").length;

                      return (
                        <div key={transfer.transferId} className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Waiting for receivers...</p>
                              <p className="text-xs text-muted-foreground">{transfer.fileName} • {formatBytes(transfer.totalSize)}</p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {pendingCount > 0 ? <Loader2 className="h-4 w-4 animate-spin text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                              <span>{approvedCount} approved</span>
                              <span>{rejectedCount} rejected</span>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            {peerStates.map((peerState) => (
                              <div key={peerState.peerId} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2">
                                <span className="truncate text-sm text-foreground">{peerState.peerName}</span>
                                {peerState.status === "PENDING_APPROVAL" && (
                                  <span className="flex items-center gap-1 text-xs text-amber-600">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Waiting
                                  </span>
                                )}
                                {peerState.status === "APPROVED" && (
                                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Approved
                                  </span>
                                )}
                                {peerState.status === "REJECTED" && (
                                  <span className="flex items-center gap-1 text-xs text-destructive">
                                    <XCircle className="h-3.5 w-3.5" />
                                    {peerState.reason === "timeout" ? "Timed out" : "Rejected"}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>

                          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                            {pendingCount > 0 ? "Approval pending" : "Starting transfer..."}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <FileTransferPanel
                  peers={selectablePeers}
                  selectedPeerIds={selectedPeerIds}
                  onSelectionChange={(peerIds) => {
                    peerSelectionTouchedRef.current = true;
                    setSelectedPeerIds(peerIds);
                  }}
                  onFileUpload={uploadFile}
                  onCancelTransfer={cancelFileTransfer}
                  files={files}
                  disabled={featureFlags ? !featureFlags.file_transfer : false}
                  maxFileSizeBytes={policy?.max_file_size_bytes}
                />
              </TabsContent>

              <TabsContent value="messages" className="min-w-0">
                <MessagingPanel
                  messages={messages}
                  peers={livePeers}
                  onSendMessage={sendMessage}
                  disabled={featureFlags ? !featureFlags.messaging : false}
                  emojiEnabled={featureFlags ? featureFlags.emoji_support : true}
                  mentionsEnabled={featureFlags ? featureFlags.mentions : true}
                />
              </TabsContent>

              <TabsContent value="code" className="min-w-0">
                <CodeSnippetPanel onSendCode={sendCode} messages={messages} disabled={featureFlags ? !featureFlags.code_sharing : false} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      <TransferApprovalDialog
        request={incomingApprovalRequests[0] || null}
        open={Boolean(incomingApprovalRequests[0])}
        onAccept={() => {
          const request = incomingApprovalRequests[0];
          if (!request) {
            return;
          }

          const manager = webrtcManagersRef.current.get(request.senderDeviceId);
          if (manager) {
            manager.sendMessage({
              type: "transfer_approval_response",
              transfer_id: request.transferId,
              sender_device_id: deviceId,
              sender_device_name: deviceName.trim() || "You",
              approval_status: "accepted",
            }).catch((error) => console.error("Failed to send approval response:", error));
          }

          dismissIncomingApprovalRequest(request.transferId);
        }}
        onReject={() => {
          const request = incomingApprovalRequests[0];
          if (!request) {
            return;
          }

          const manager = webrtcManagersRef.current.get(request.senderDeviceId);
          if (manager) {
            manager.sendMessage({
              type: "transfer_approval_response",
              transfer_id: request.transferId,
              sender_device_id: deviceId,
              sender_device_name: deviceName.trim() || "You",
              approval_status: "rejected",
            }).catch((error) => console.error("Failed to send approval response:", error));
          }

          dismissIncomingApprovalRequest(request.transferId);
        }}
      />
    </div>
  );
};

export default Session;
