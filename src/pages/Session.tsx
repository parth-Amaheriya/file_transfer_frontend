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
    return sessionStorage.getItem("deviceId") || crypto.randomUUID();
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
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
      try {
        // First try to get the pairing to see if it already exists
        const existingPairing = await api.getPairing(code);
        if (existingPairing.status === "connected") {
          // Already connected, just return the existing pairing
          return existingPairing;
        } else {
          // Try to join if it's still pending
          return await api.joinPairing(code, { 
            identifier: deviceId, 
            label: "My Device", 
            metadata: { type: "desktop" } 
          });
        }
      } catch (error: any) {
        // If getPairing fails, try to join directly
        if (error.message?.includes("not found")) {
          return await api.joinPairing(code, { 
            identifier: deviceId, 
            label: "My Device", 
            metadata: { type: "desktop" } 
          });
        }
        throw error;
      }
    },
    onSuccess: (data) => setPairing(data),
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
      const pollInterval = setInterval(async () => {
        try {
          const updatedPairing = await api.getPairing(pairing.code);
          if (updatedPairing.status !== pairing.status) {
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
      const webrtc = new WebRTCManager(
        import.meta.env.VITE_API_BASE || "http://localhost:8000",
        pairing.id,
        deviceId,
        isInitiator,
        (message) => {
          if (message.type === "peer_connected") {
            setPairing(prev => prev ? { ...prev, status: "connected" } : null);
          }
          setMessages(prev => [...prev, { ...message, sender: "peer" }]);
        },
        (state) => {
          setConnectionState(state);
        },
        (progress) => {
          setFiles(prev => prev.map(f =>
            f.id === progress.id
              ? {
                  ...f,
                  progress: progress.progress,
                  status: progress.status,
                  direction: progress.status === 'receiving' ? 'received' : 'sent'
                }
              : f
          ));
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
      // Add to files list with initial status
      const fileId = crypto.randomUUID();
      const fileItem = {
        id: fileId,
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        progress: 0,
        status: "sending" as const,
        type: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.name.endsWith(".zip") || file.name.endsWith(".rar") ? "archive" : "other",
        direction: "sent" as const,
      };
      setFiles(prev => [...prev, fileItem]);

      try {
        await webrtcRef.current.sendFile(file, (progress) => {
          setFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, progress } : f
          ));
        });
        setFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, status: "completed" as const } : f
        ));
      } catch (error) {
        console.error("File upload failed:", error);
        setFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, status: "failed" as const } : f
        ));
      }
    }
  }; 
            f.id === fileId ? { ...f, progress: Math.round(progress) } : f
          ));
        });
        
        // Mark as completed
        setFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, progress: 100, status: "completed" as const } : f
        ));
        
        // Send file_init message via WS
        const message: Message = { type: "file_init", file_name: file.name, file_size: file.size, mime_type: file.type };
        wsRef.current?.send(JSON.stringify(message));
      } catch (error) {
        console.error("Upload failed", error);
        // Mark as failed
        setFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, status: "failed" as const } : f
        ));
      }
    }
  };

  const downloadFile = async (filename: string) => {
    // Files are now downloaded automatically when received via WebRTC
    console.log("Download not needed - files are received automatically");
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
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
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
            onDisconnect={() => {
              sessionStorage.removeItem("pairing");
              sessionStorage.removeItem("deviceId");
              navigate("/");
            }}
          />

          <div className="surface-elevated rounded-xl p-6">
            <Tabs defaultValue="files">
              <TabsList className="bg-secondary mb-6">
                <TabsTrigger value="files" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                  <FileText className="h-3.5 w-3.5" />
                  Files
                </TabsTrigger>
                <TabsTrigger value="messages" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Messages
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                  <Code className="h-3.5 w-3.5" />
                  Code
                </TabsTrigger>
              </TabsList>

              <TabsContent value="files">
                <FileTransferPanel onFileUpload={uploadFile} onFileDownload={downloadFile} files={files} />
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
