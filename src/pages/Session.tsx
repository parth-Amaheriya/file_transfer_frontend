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
import { api, type PairingCodeOut, type Message } from "@/lib/api";
import { WebRTCManager, type FileTransferProgress } from "@/lib/webrtc";

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
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const lastProcessedMessageIndexRef = useRef<number>(-1);
  const markedFilesUnreadRef = useRef<Set<string>>(new Set());

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
    // Initialize WebRTC for any peer count - Pure P2P mesh topology
    // Each device connects directly to all other devices via WebRTC
    const peerCount = pairing?.peer_count || 0;
    const shouldUseWebRTC = (pairing?.status === "connected" || pairing?.status === "active") && 
                           peerCount >= 1 && 
                           !webrtcRef.current;
    
    if (shouldUseWebRTC) {
      const isInitiator = !joinCode; // The device that initiated is the offerer
      console.log(`Initializing WebRTC mesh for ${isInitiator ? 'initiator' : 'joiner'}, pairing ID: ${pairing.id}, device ID: ${deviceId}, peers: ${peerCount}`);
      const webrtc = new WebRTCManager(
        (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000",
        pairing.id,
        deviceId,
        isInitiator,
        (message) => {
          console.log('WebRTC message received:', message);
          if (message.type === "peer_connected") {
            setPairing(prev => prev ? { ...prev, status: "connected" } : null);
          }
          setMessages(prev => [...prev, { ...message, sender: "peer" }]);

          // Mark tab as unread if message is from peer
          if (message.sender === "peer" || (message.sender !== "you" && message.sender !== undefined)) {
            let tabToMark = "";
            if (message.type === "text") {
              tabToMark = message.isCode ? "code" : "messages";
            } else if (message.type.includes("file")) {
              tabToMark = "files";
            }
            
            if (tabToMark) {
              setUnreadTabs(prev => new Set([...prev, tabToMark]));
            }
          }
        },
        (state) => {
          console.log('WebRTC connection state changed:', state);
          setConnectionState(state);
          // If WebRTC fails with multiple devices, allow WebSocket to take over
          if (state === 'failed' && (pairing?.peer_count || 0) >= 1) {
            console.log('WebRTC failed, clearing to allow WebSocket fallback');
            webrtcRef.current = null;
          }
        },
        (progress) => {
          console.log('File progress update:', progress);
          setFiles(prev => {
            const existingIndex = prev.findIndex(f => f.id === progress.id);
            
            if (existingIndex >= 0) {
              // Update existing file
              const updated = [...prev];
              updated[existingIndex] = {
                ...updated[existingIndex],
                progress: progress.progress,
                status: progress.status as any,
                direction: progress.status === 'receiving' ? 'received' : 'sent'
              };
              return updated;
            } else if (progress.status === 'receiving' || progress.status === 'sending') {
              // Add new file if it's being received or sent
              const newFile: FileItem = {
                id: progress.id,
                name: progress.name,
                size: `${(progress.size / 1024 / 1024).toFixed(1)} MB`,
                progress: progress.progress,
                status: progress.status as any,
                type: progress.name.includes('.') 
                  ? progress.name.endsWith('.jpg') || progress.name.endsWith('.png') || progress.name.endsWith('.gif') ? 'image'
                  : progress.name.endsWith('.mp4') || progress.name.endsWith('.avi') ? 'video'
                  : progress.name.endsWith('.zip') || progress.name.endsWith('.rar') ? 'archive'
                  : 'other'
                  : 'other',
                direction: progress.status === 'receiving' ? 'received' : 'sent'
              };
              
              // Mark files tab as unread only if receiving and not already marked
              if (progress.status === 'receiving' && !markedFilesUnreadRef.current.has(progress.id)) {
                markedFilesUnreadRef.current.add(progress.id);
                setUnreadTabs(prev => new Set([...prev, 'files']));
              }
              
              return [...prev, newFile];
            }
            
            return prev;
          });
        }
      );

      webrtcRef.current = webrtc;
      webrtc.initialize().catch(console.error);

      return () => {
        if (webrtcRef.current) {
          webrtcRef.current.close();
          webrtcRef.current = null;
        }
      };
    }
  }, [pairing?.status, pairing?.id, pairing?.peer_count, deviceId, joinCode]);

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
    if (webrtcRef.current) {
      const message: Message = { type: "text", content, sender: "you" };
      webrtcRef.current.sendMessage(message);
      setMessages(prev => [...prev, { ...message, timestamp: Date.now() }]);
    }
  };

  const sendCode = (code: string, title: string) => {
    if (webrtcRef.current) {
      const message: Message = { type: "text", content: code, sender: "you", isCode: true, codeTitle: title };
      webrtcRef.current.sendMessage(message);
      setMessages(prev => [...prev, { ...message, timestamp: Date.now() }]);
    }
  };

  const uploadFile = async (file: File) => {
    if (webrtcRef.current) {
      // Use WebRTC P2P for file transfer (works for any number of devices)
      try {
        console.log(`Sending file via WebRTC P2P: ${file.name}`);
        await webrtcRef.current.sendFile(file);
      } catch (error) {
        console.error("File upload failed:", error);
      }
    }
  };

  const cancelFileTransfer = (fileId: string) => {
    if (webrtcRef.current) {
      webrtcRef.current.cancelFileTransfer(fileId);
    }
  };

  const downloadFile = async (filename: string) => {
    // Files are downloaded automatically via WebRTC when received
    console.log("File received via WebRTC P2P - download automatic via File System Access API");
  };
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          console.log('File downloaded successfully:', filename);
        } else {
          console.error('File download failed:', response.status);
        }
      } catch (error) {
        console.error('File download failed:', error);
      }
    }
  };

  const handleDisconnect = () => {
    // Close WebRTC connection
    if (webrtcRef.current) {
      webrtcRef.current.close();
      webrtcRef.current = null;
    }

    // Clear all cache and state
    sessionStorage.removeItem("pairing");
    sessionStorage.removeItem("deviceId");
    localStorage.clear(); // Clear any persistent cache
    
    // Reset state
    setPairing(null);
    setMessages([]);
    setFiles([]);
    setConnectionState("new");

    // Navigate back to home
    navigate("/");
  };

  if (!pairing) {
    return <div>Loading...</div>;
  }

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
              connectionState === "connected" ? "connected" :
              connectionState === "failed" ? "failed" :
              pairing.status === "pending" ? "waiting" : "connecting"
            }
            onDisconnect={handleDisconnect}
            peers={pairing.peers}
            peerCount={pairing.peer_count}
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
                <FileTransferPanel onFileUpload={uploadFile} onFileDownload={downloadFile} onCancelTransfer={cancelFileTransfer} files={files} />
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
