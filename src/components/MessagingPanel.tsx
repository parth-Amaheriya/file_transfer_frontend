import { Send } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Message } from "@/lib/api";

interface MessagingPanelProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
}

const MessagingPanel = ({ messages, onSendMessage }: MessagingPanelProps) => {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleMessages = messages.filter((message) => message.type === "text" || message.type === "file_cancel");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    onSendMessage(input);
    setInput("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") send();
  };

  return (
    <div className="flex flex-col h-[400px]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 p-1">
        {visibleMessages.map((msg, index) => {
          if (msg.type === "file_cancel") {
            return (
              <div key={index} className="flex justify-center animate-fade-in">
                <div className="max-w-[85%] rounded-full border border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
                  {msg.sender !== "you" && (
                    <span className="block text-[10px] uppercase tracking-widest text-muted-foreground/80 mb-1">
                      {msg.senderName || "Peer"}
                    </span>
                  )}
                  <span>{msg.content || `File cancelled${msg.filename ? `: ${msg.filename}` : ""}`}</span>
                </div>
              </div>
            );
          }

          if (msg.isCode) {
            return null;
          }

          return (
            <div key={index} className={`flex ${msg.sender === "you" ? "justify-end" : "justify-start"} animate-fade-in`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                msg.sender === "you" 
                  ? "bg-primary text-primary-foreground rounded-br-md" 
                  : "bg-secondary text-secondary-foreground rounded-bl-md"
              }`}>
                {msg.sender !== "you" && (
                  <p className="text-[10px] uppercase tracking-widest mb-1 text-secondary-foreground/60">
                    {msg.senderName || "Peer"}
                  </p>
                )}
                <p className="text-sm leading-relaxed">{msg.content}</p>
                <p className={`text-[10px] mt-1 ${
                  msg.sender === "you" 
                    ? "text-primary-foreground/60" 
                    : "text-secondary-foreground/60"
                }`}>
                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-4">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          className="flex-1"
        />
        <Button onClick={send} size="icon">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default MessagingPanel;
