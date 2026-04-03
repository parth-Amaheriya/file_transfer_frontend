import { ArrowLeft, FileText, MessageSquare, Code } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BackgroundEffects from "@/components/BackgroundEffects";
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
  peerChunks: Record<string, Set<number>>;
  inFlight: Record<string, Set<number>>;
  completed: boolean;
};

const calculateSwarmChunkSize = (fileSize: number) => {
  if (fileSize < 1024 * 1024) return 16 * 1024;
  if (fileSize < 100 * 1024 * 1024) return 64 * 1024;
  return 128 * 1024;
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
  const chunkHashes: string[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
    chunkHashes.push(await hashChunk(chunk));
  }

  return {
    fileId,
    filename: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    chunkSize,
    chunkCount,
    chunkHashes,
    originDeviceId,
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
  const joinCode = location.state?.joinCode;

  const [pairing, setPairing] = useState<PairingCodeOut | null>(() => {
    // Try to restore pairing from sessionStorage on refresh
    const saved = sessionStorage.getItem("pairing");
    return saved ? JSON.parse(saved) : null;
  });
  const [deviceId, setDeviceId] = useState<string>(() => {
    // Restore device ID from sessionStorage
    return sessionStorage.getItem("deviceId") || Math.random().toString(36).substr(2, 9);
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
  const [activeTab, setActiveTab] = useState<string>("files");
  const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set());
  const webrtcManagersRef = useRef<Map<string, WebRTCManager>>(new Map<string, WebRTCManager>());
  const peerConnectionStatesRef = useRef<Record<string, RTCPeerConnectionState>>({});
  const [peerConnectionStates, setPeerConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const swarmTransfersRef = useRef<Map<string, SwarmTransferState>>(new Map());
  const lastProcessedMessageIndexRef = useRef<number>(-1);
  const markedFilesUnreadRef = useRef<Set<string>>(new Set());

  const getConnectedPeerManagers = (): WebRTCManager[] => {
    return Array.from(webrtcManagersRef.current.entries())
      .filter(([peerId]) => peerConnectionStates[peerId] === "connected")
      .map(([, manager]) => manager);
  };

  const getConnectedPeerIds = (): string[] => {
    return Array.from(webrtcManagersRef.current.keys() as Iterable<string>).filter(
      (peerId) => peerConnectionStatesRef.current[peerId] === "connected"
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
    const managers = getConnectedPeerManagers();
    await Promise.all(
      managers.map((manager) => manager.sendHave(fileId, chunkIndices).catch((error) => console.error("Failed to broadcast HAVE:", error)))
    );
  };

  const requestNextChunks = async (fileId: string) => {
    const transfer = swarmTransfersRef.current.get(fileId);
    if (!transfer || transfer.completed) {
      return;
    }

    const connectedPeers = getConnectedPeerIds();
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
        if (transfer.peerChunks[peerId]?.has(chunkIndex) || peerId === manifest.originDeviceId) {
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
        (peerId) => (transfer.peerChunks[peerId]?.has(chunkIndex) || peerId === manifest.originDeviceId) && outstandingByPeer(peerId) < 2
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
      label: "My Device", 
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
          label: "My Device", 
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
  }, [pairing, deviceId]);

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

  // Poll for pairing status updates for the initiating device
  useEffect(() => {
    if (pairing && !joinCode && pairing.status === "pending") {
      console.log('Starting pairing status polling for initiator');
      const pollInterval = setInterval(async () => {
        try {
          const updatedPairing = await api.getPairing(pairing.code);
          console.log('Polled pairing status:', updatedPairing.status);
          if (updatedPairing.status !== pairing.status) {
            console.log(`Pairing status changed from ${pairing.status} to ${updatedPairing.status}`);
            setPairing(updatedPairing);
          }
        } catch (error) {
          console.error("Failed to poll pairing status:", error);
        }
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(pollInterval);
    }
  }, [pairing, joinCode]);

  // Poll for peer updates - refresh peer list for all connected devices
  useEffect(() => {
    if (pairing && (pairing.status === "active" || pairing.status === "connected")) {
      console.log('Starting peer list polling');
      const pollInterval = setInterval(async () => {
        try {
          const updatedPairing = await api.getPairing(pairing.code);
          // Update if peer count or peer list changed
          if ((updatedPairing.peer_count || 0) !== (pairing.peer_count || 0) ||
              JSON.stringify(updatedPairing.peers) !== JSON.stringify(pairing.peers)) {
            console.log(`Peer count updated: ${updatedPairing.peer_count || 0}`);
            setPairing(updatedPairing);
          }
        } catch (error) {
          console.error("Failed to poll peer updates:", error);
        }
      }, 1500); // Poll every 1.5 seconds for faster disconnection detection

      return () => clearInterval(pollInterval);
    }
  }, [pairing?.code, pairing?.status]);

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
        try {
          await manager.announceSwarmManifest(transfer.manifest);
          const ownedChunks = Array.from(transfer.ownedChunks.values());
          if (ownedChunks.length > 0) {
            await manager.sendHave(transfer.manifest.fileId, ownedChunks);
          }
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
            };

            const transfer = ensureTransfer(manifest);
            transfer.manifest = manifest;
            if (!transfer.peerChunks[remotePeerId]) {
              transfer.peerChunks[remotePeerId] = new Set();
            }

            if (manifest.originDeviceId === remotePeerId) {
              transfer.peerChunks[remotePeerId] = new Set(Array.from({ length: manifest.chunkCount }, (_, index) => index));
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
              transfer.peerChunks[remotePeerId] = new Set(Array.from({ length: transfer.manifest.chunkCount }, (_, index) => index));
            }
            void requestNextChunks(message.file_id);
            return;
          }

          if (message.type !== "request" && message.type !== "have" && message.type !== "complete" && message.type !== "file_manifest" && message.type !== "file_cancel") {
            setMessages((prev) => [...prev, { ...message, sender: "peer" }]);

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

  const sendMessage = (content: string) => {
    const managers = getConnectedPeerManagers();
    if (managers.length === 0) return;

    const message: Message = { type: "text", content, sender: "you" };
    managers.forEach((manager) => {
      manager.sendMessage(message).catch((error) => console.error("Failed to send message:", error));
    });
    setMessages(prev => [...prev, { ...message, timestamp: Date.now() }]);
  };

  const sendCode = (code: string, title: string) => {
    const managers = getConnectedPeerManagers();
    if (managers.length === 0) return;

    const message: Message = { type: "text", content: code, sender: "you", isCode: true, codeTitle: title };
    managers.forEach((manager) => {
      manager.sendMessage(message).catch((error) => console.error("Failed to send code:", error));
    });
    setMessages(prev => [...prev, { ...message, timestamp: Date.now() }]);
  };

  const uploadFile = async (file: File) => {
    const managers = getConnectedPeerManagers();
    if (managers.length === 0) return;

    const fileId = Math.random().toString(36).substr(2, 9);

    try {
      const manifest = await createSwarmManifest(file, deviceId, fileId);
      const transfer = ensureTransfer(manifest);
      transfer.sourceFile = file;
      transfer.manifest = manifest;
      transfer.completed = false;
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
        },
      ]);

      await Promise.all(managers.map(async (manager) => {
        await manager.announceSwarmManifest(manifest);
        await manager.sendHave(manifest.fileId, Array.from({ length: manifest.chunkCount }, (_, index) => index));
      }));

      setFiles((prev) => prev.map((fileItem) => fileItem.id === manifest.fileId ? { ...fileItem, progress: 100, status: "completed" } : fileItem));
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
        timestamp: Date.now(),
      };

      for (const manager of getConnectedPeerManagers()) {
        manager.sendMessage(cancelMessage).catch((error) => console.error("Failed to broadcast swarm cancellation:", error));
      }

      swarmTransfersRef.current.delete(fileId);
      setFiles((prev) => prev.map((file) => file.id === fileId ? { ...file, status: "failed", progress: 0 } : file));
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

    // Clear all cache and state
    sessionStorage.removeItem("pairing");
    sessionStorage.removeItem("deviceId");
    localStorage.clear(); // Clear any persistent cache
    
    // Reset state
    setPairing(null);
    setMessages([]);
    setFiles([]);
    setUnreadTabs(new Set());
    setConnectionState("new");

    // Navigate back to home
    navigate("/");
  };

  if (!pairing) {
    return <div>Loading...</div>;
  }

  const allParticipants = [pairing.initiator, ...(pairing.peers || [])].filter(
    (participant) => participant.identifier !== deviceId
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
    <div className="min-h-screen relative">
      <BackgroundEffects />

      <header className="border-b border-border bg-card sticky top-0 z-10">
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

      <main className="container max-w-6xl px-4 py-8">
        <div className="grid lg:grid-cols-[300px_1fr] gap-6">
          <ConnectionPanel
            pairingCode={pairing.code}
            status={
              liveConnectionState === "connected" ? "connected" :
              liveConnectionState === "failed" ? "failed" :
              pairing.status === "pending" ? "waiting" : "connecting"
            }
            onDisconnect={handleDisconnect}
            peers={livePeers}
            peerCount={livePeers.length}
          />

          <div className="surface-elevated rounded-xl p-6">
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
              <TabsList className="bg-secondary mb-6">
                <TabsTrigger value="files" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                  {unreadTabs.has("files") && (
                    <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="messages" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Message
                  {unreadTabs.has("messages") && (
                    <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <Code className="h-3.5 w-3.5" />
                  Code
                  {unreadTabs.has("code") && (
                    <span className="notification-badge absolute top-0.5 right-0.5 h-2.5 w-2.5 bg-red-500 border border-white/30"></span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="files">
                <FileTransferPanel onFileUpload={uploadFile} onCancelTransfer={cancelFileTransfer} files={files} />
              </TabsContent>

              <TabsContent value="messages">
                <MessagingPanel messages={messages} onSendMessage={sendMessage} />
              </TabsContent>

              <TabsContent value="code">
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
