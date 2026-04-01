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

const Session = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const joinCode = location.state?.joinCode;

  const [pairing, setPairing] = useState<PairingCodeOut | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const initiateMutation = useMutation({
    mutationFn: () => api.initiatePairing({ 
      identifier: crypto.randomUUID(), 
      label: "My Device", 
      metadata: { type: "desktop" } 
    }),
    onSuccess: (data) => setPairing(data),
  });

  const joinMutation = useMutation({
    mutationFn: (code: string) => api.joinPairing(code, { 
      identifier: crypto.randomUUID(), 
      label: "My Device", 
      metadata: { type: "desktop" } 
    }),
    onSuccess: (data) => setPairing(data),
  });

  useEffect(() => {
    if (joinCode) {
      joinMutation.mutate(joinCode);
    } else {
      initiateMutation.mutate();
    }
  }, [joinCode]);

  useEffect(() => {
    if (pairing?.status === "connected") {
      const deviceId = pairing.initiator.id === "device1" ? "device1" : "device2";
      const ws = api.createWebSocket(pairing.id, deviceId);
      wsRef.current = ws;

      ws.onopen = () => console.log("WebSocket connected");
      ws.onmessage = (event) => {
        const message: Message = JSON.parse(event.data);
        setMessages(prev => [...prev, message]);
        // Handle file messages if needed
      };
      ws.onclose = () => console.log("WebSocket closed");

      return () => {
        ws.close();
      };
    }
  }, [pairing]);

  const sendMessage = (content: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message: Message = { type: "text", content };
      wsRef.current.send(JSON.stringify(message));
      setMessages(prev => [...prev, { ...message, timestamp: new Date().toISOString() }]);
    }
  };

  const uploadFile = async (file: File) => {
    if (pairing) {
      try {
        await api.uploadFile(pairing.id, file);
        // Add to files list
        const fileItem = {
          id: Date.now().toString(),
          name: file.name,
          size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
          progress: 100,
          status: "completed" as const,
          type: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.name.endsWith(".zip") || file.name.endsWith(".rar") ? "archive" : "other",
        };
        setFiles(prev => [...prev, fileItem]);
        // Send file_init message via WS
        const message: Message = { type: "file_init", file_name: file.name, file_size: file.size, mime_type: file.type };
        wsRef.current?.send(JSON.stringify(message));
      } catch (error) {
        console.error("Upload failed", error);
      }
    }
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
            status={pairing.status === "connected" ? "connected" : pairing.status === "pending" ? "waiting" : "connecting"}
            onDisconnect={() => navigate("/")}
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
                <FileTransferPanel onFileUpload={uploadFile} files={files} />
              </TabsContent>

              <TabsContent value="messages">
                <MessagingPanel messages={messages} onSendMessage={sendMessage} />
              </TabsContent>

              <TabsContent value="code">
                <CodeSnippetPanel onSendCode={(code) => sendMessage(code)} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Session;
