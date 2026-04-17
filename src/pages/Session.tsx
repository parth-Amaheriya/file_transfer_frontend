import { ArrowLeft, FileText,MessageCircle,Code2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BackgroundEffects from "@/components/BackgroundEffects";
import Loader from "@/components/Loader";
import ConnectionPanel from "@/components/ConnectionPanel";
import FileTransferPanel from "@/components/FileTransferPanel";
import MessagingPanel from "@/components/MessagingPanel";
import CodeSnippetPanel from "@/components/CodeSnippetPanel";
import { type FileItem } from "@/components/FileTransferPanel";
import { api, type DeviceDescriptor, type PairingCodeOut, type Message } from "@/lib/api";
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

const calculateSwarmChunkSize = (fileSize: number) => {
  return 64 * 1024;
};

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

const Session = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryJoinCode = new URLSearchParams(location.search).get("joinCode") || new URLSearchParams(location.search).get("code");
  const joinCode = (location.state?.joinCode || queryJoinCode || "").trim().toUpperCase() || undefined;
  const initialDeviceName = location.state?.deviceName || sessionStorage.getItem("deviceName") || "My Device";

  const [pairing, setPairing] = useState<PairingCodeOut | null>(() => {
    // Try to restore pairing from sessionStorage on refresh
    const saved = sessionStorage.getItem("pairing");
    return saved ? JSON.parse(saved) : null;
  });
  const [deviceId, setDeviceId] = useState<string>(() => {
    // Restore device ID from sessionStorage
    return sessionStorage.getItem("deviceId") || Math.random().toString(36).substr(2, 9);
  });
  const [deviceName] = useState<string>(initialDeviceName);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
  const [activeTab, setActiveTab] = useState<string>("files");
  const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set());
  const [selectedPeerIds, setSelectedPeerIds] = useState<string[]>([]);
  const webrtcManagersRef = useRef<Map<string, WebRTCManager>>(new Map<string, WebRTCManager>());
  const peerConnectionStatesRef = useRef<Record<string, RTCPeerConnectionState>>({});
  const [peerConnectionStates, setPeerConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const swarmTransfersRef = useRef<Map<string, SwarmTransferState>>(new Map());
  const lastProcessedMessageIndexRef = useRef<number>(-1);
  const markedFilesUnreadRef = useRef<Set<string>>(new Set());
  const peerSelectionInitializedRef = useRef(false);
  const peerSelectionTouchedRef = useRef(false);
  const loaderStartRef = useRef<number | null>(pairing ? null : Date.now());
  const loaderHideTimerRef = useRef<number | null>(null);
  const [showLoader, setShowLoader] = useState(() => !pairing);

  const getConnectedPeerManagers = (peerIds?: string[]): WebRTCManager[] => {
    return Array.from(webrtcManagersRef.current.entries())
      .filter(([peerId]) => peerConnectionStates[peerId] === "connected" && (!peerIds || peerIds.includes(peerId)))
      .map(([, manager]) => manager);
  };

  const getConnectedPeerIds = (peerIds?: string[]): string[] => {
    return Array.from(webrtcManagersRef.current.keys() as Iterable<string>).filter(
      (peerId) => peerConnectionStatesRef.current[peerId] === "connected" && (!peerIds || peerIds.includes(peerId))
    );
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
        (peerId) => (transfer.peerHasAll[peerId] || transfer.peerChunks[peerId]?.has(chunkIndex) || peerId === manifest.originDeviceId) && outstandingByPeer(peerId) < 2
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
        manager.requestChunk(fileId, chunkIndex).catch((error) => {
          console.error(`Failed to request chunk ${chunkIndex} from ${peerId}:`, error);
          transfer.inFlight[peerId].delete(chunkIndex);
        });
      }
    }
  };

  const initiateMutation = useMutation({
    mutationFn: () => api.initiatePairing({ 
      identifier: deviceId, 
      label: deviceName.trim() || "My Device", 
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
          label: deviceName.trim() || "My Device", 
          metadata: { type: "desktop" } 
        });
        console.log('Successfully joined pairing:', joinedPairing.status, 'peer_count:', joinedPairing.peer_count);
        return joinedPairing;
      } catch (error: any) {
        console.error('Join failed:', error.message);
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
    sessionStorage.setItem("deviceName", deviceName);
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
    // Only initiate/join if we don't have a restored pairing
    if (!pairing) {
      if (joinCode) {
        joinMutation.mutate(joinCode);
      } else {
        initiateMutation.mutate();
      }
    }
  }, [joinCode, pairing]);

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

    const baseUrl = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";
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

    const updateOverallConnectionState = () => {
      const states = Object.values(peerConnectionStatesRef.current);
      if (states.length === 0) {
        setConnectionState("new");
      } else if (states.some((state) => state === "connected")) {
        setConnectionState("connected");
      } else if (states.some((state) => state === "connecting" || state === "new")) {
        setConnectionState("connecting");
      } else if (states.length > 0 && states.every((state) => state === "failed" || state === "disconnected" || state === "closed")) {
        setConnectionState("failed");
      }
    };

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

          setFiles((prev) => prev.map((fileItem) =>
            fileItem.id === transfer.manifest.fileId
              ? { ...fileItem, progress: 100, status: "completed" }
              : fileItem
          ));
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
            return;
          }

          if (message.type === "file_cancel") {
            const cancelLabel = message.content || `File cancelled: ${message.filename || message.file_name || "file"}`;

            setMessages((prev) => [...prev, { ...message, sender: "peer", senderName: remotePeer.label || remotePeer.identifier, content: cancelLabel, timestamp: Date.now() }]);

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
            }
            void requestNextChunks(message.file_id);
            return;
          }

          if (message.type !== "request" && message.type !== "have" && message.type !== "complete" && message.type !== "file_manifest") {
            setMessages((prev) => [...prev, { ...message, sender: "peer", senderName: remotePeer.label || remotePeer.identifier, timestamp: Date.now() }]);

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
          console.log(`WebRTC connection state changed for ${remotePeerId}:`, state);
          peerConnectionStatesRef.current[remotePeerId] = state;
          setPeerConnectionStates((prev) => ({ ...prev, [remotePeerId]: state }));
          updateOverallConnectionState();

          if (state === "failed" || state === "disconnected" || state === "closed") {
            const existing = webrtcManagersRef.current.get(remotePeerId);
            if (existing) {
              existing.close();
              webrtcManagersRef.current.delete(remotePeerId);
            }
            delete peerConnectionStatesRef.current[remotePeerId];
            setPeerConnectionStates((prev) => {
              const updated = { ...prev };
              delete updated[remotePeerId];
              return updated;
            });

            for (const transfer of swarmTransfersRef.current.values()) {
              delete transfer.peerChunks[remotePeerId];
              delete transfer.peerHasAll[remotePeerId];
              delete transfer.inFlight[remotePeerId];
            }

            updateOverallConnectionState();
            void Promise.all(Array.from(swarmTransfersRef.current.keys() as Iterable<string>).map((fileId) => requestNextChunks(fileId)));
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
                status: progress.status as any,
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
                status: progress.status as any,
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
          }
          void requestNextChunks(completedFile.fileId);
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
        updateOverallConnectionState();
      });
    };

    participants.forEach((participant) => {
      if (!webrtcManagersRef.current.has(participant.identifier)) {
        createPeerManager(participant);
      }
    });

    updateOverallConnectionState();

    return () => {
      for (const [peerId, manager] of webrtcManagersRef.current.entries()) {
        if (!participantIds.has(peerId)) {
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
    const managers = getConnectedPeerManagers();
    if (managers.length === 0) return;

    const message: Message = { type: "text", content: code, sender: "you", senderName: deviceName.trim() || "You", isCode: true, codeTitle: title };
    managers.forEach((manager) => {
      manager.sendMessage(message).catch((error) => console.error("Failed to send code:", error));
    });
    setMessages(prev => [...prev, { ...message, timestamp: Date.now() }]);
  };

  const uploadFile = async (file: File, targetPeerIds: string[]) => {
    const selectedTargets = targetPeerIds.length > 0 ? targetPeerIds : selectedPeerIds;
    const connectedTargets = getConnectedPeerIds(selectedTargets);
    const managers = getConnectedPeerManagers(connectedTargets);

    const fileId = Math.random().toString(36).substr(2, 9);

    try {
      const manifest = await createSwarmManifest(file, deviceId, fileId);
      manifest.targetPeerIds = [deviceId, ...selectedTargets.filter((peerId) => peerId !== deviceId)];
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
          status: "sending",
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

      if (managers.length > 0) {
        await Promise.all(managers.map(async (manager) => {
          await manager.announceSwarmManifest(manifest);
        }));

        setFiles((prev) => prev.map((fileItem) => fileItem.id === manifest.fileId ? { ...fileItem, progress: 100, status: "completed" } : fileItem));
      }
    } catch (error) {
      console.error("File upload failed:", error);
    }
  };

  const cancelFileTransfer = (fileId: string) => {
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

  const handleDisconnect = () => {
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

    // Navigate back to home
    navigate("/");
  };

  if (!pairing || showLoader) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#ececec]">
          <Loader />
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
  const liveConnectionState =
    livePeers.length > 0
      ? "connected"
      : Object.values(peerConnectionStates).some((state) => state === "connecting" || state === "new")
        ? "connecting"
        : Object.values(peerConnectionStates).some((state) => state === "failed" || state === "disconnected" || state === "closed")
          ? "failed"
          : connectionState;

  return (
    <div className="flex flex-col h-screen relative">
      <BackgroundEffects />

      <header className="border-b border-border bg-card sticky top-0 z-10 flex-shrink-0">
        <div className="container max-w-6xl flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleDisconnect}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-bold tracking-tight text-foreground">Nexdrop</span>
          </div>
          <span className="text-xs text-muted-foreground font-medium">Session Active</span>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        <div className="container max-w-6xl px-4 py-4 flex-1 min-h-0 flex flex-col">
          <div className="grid lg:grid-cols-[300px_1fr] gap-6 flex-1 min-h-0">
            <ConnectionPanel
            pairingCode={pairing.code}
            status={
              liveConnectionState === "connected" ? "connected" :
              liveConnectionState === "failed" ? "failed" :
              pairing.status === "pending" ? "waiting" : "connecting"
            }
            onDisconnect={handleDisconnect}
            userName={deviceName.trim() || "My Device"}
            peers={livePeers}
            peerCount={livePeers.length}
          />

          <div className="surface-elevated rounded-xl p-6 flex flex-col min-h-0 flex-1">
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
            }} className="flex flex-col flex-1 min-h-0">
              <TabsList className="bg-secondary mb-6">
                <TabsTrigger value="files" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                  {unreadTabs.has("files") && (
                    <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="messages" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Messages
                  {unreadTabs.has("messages") && (
                    <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <Code2 className="h-3.5 w-3.5" />
                  Code
                  {unreadTabs.has("code") && (
                    <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="files" className="flex-1 min-h-0">
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
                />
              </TabsContent>

              <TabsContent value="messages" className="flex-1 min-h-0">
                <MessagingPanel messages={messages} peers={livePeers} onSendMessage={sendMessage} />
              </TabsContent>

              <TabsContent value="code" className="flex-1 min-h-0">
                <CodeSnippetPanel onSendCode={sendCode} messages={messages} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Session;
