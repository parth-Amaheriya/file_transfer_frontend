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
        // First try to get the pairing to see if it already exists
        const existingPairing = await api.getPairing(code);
        console.log('Existing pairing status:', existingPairing.status);
        if (existingPairing.status === "connected") {
          // Already connected, just return the existing pairing
          console.log('Pairing already connected, returning existing pairing');
          return existingPairing;
        } else {
          // Try to join if it's still pending
          console.log('Pairing is pending, attempting to join');
          const joinedPairing = await api.joinPairing(code, { 
            identifier: deviceId, 
            label: "My Device", 
            metadata: { type: "desktop" } 
          });
          console.log('Successfully joined pairing:', joinedPairing.status);
          return joinedPairing;
        }
      } catch (error: any) {
        console.log('Join failed, trying direct join:', error.message);
        // If getPairing fails, try to join directly
        if (error.message?.includes("not found")) {
          const joinedPairing = await api.joinPairing(code, { 
            identifier: deviceId, 
            label: "My Device", 
            metadata: { type: "desktop" } 
          });
          console.log('Direct join successful:', joinedPairing.status);
          return joinedPairing;
        }
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

  useEffect(() => {
    if (pairing?.status === "connected" && !webrtcRef.current) {
      const isInitiator = !joinCode; // The device that initiated is the offerer
      console.log(`Initializing WebRTC for ${isInitiator ? 'initiator' : 'joiner'}, pairing ID: ${pairing.id}, device ID: ${deviceId}`);
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
          if (message.sender === undefined || message.sender !== "you") {
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
              
              // Mark files tab as unread if receiving
              if (progress.status === 'receiving') {
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
  }, [pairing?.status, pairing?.id, deviceId, joinCode]);

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
      try {
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
    // Files are now downloaded automatically when received via WebRTC
    console.log("Download not needed - files are received automatically");
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
          />

          <div className="surface-elevated rounded-xl p-6">
            <Tabs value={activeTab} onValueChange={(value) => {
              setActiveTab(value);
              setUnreadTabs(prev => {
                const updated = new Set(prev);
                updated.delete(value);
                return updated;
              });
            }}>
              <TabsList className="bg-secondary mb-6">
                <TabsTrigger value="files" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                  {unreadTabs.has("files") && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500"></span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="messages" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Message
                  {unreadTabs.has("messages") && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500"></span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm relative">
                  <Code className="h-3.5 w-3.5" />
                  Code
                  {unreadTabs.has("code") && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500"></span>
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
