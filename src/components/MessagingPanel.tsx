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
  <div className="flex flex-col h-[420px] rounded-2xl border bg-background shadow-sm">
    
    {/* Messages */}
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-thin"
    >
      {visibleMessages.length === 0 && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No messages yet
        </div>
      )}

      {visibleMessages.map((msg, index) => {
        // 🔴 File cancel message (system style)
        if (msg.type === "file_cancel") {
          return (
            <div key={index} className="flex justify-center">
              <div className="px-4 py-1.5 text-xs rounded-full bg-muted text-muted-foreground border">
                {msg.sender !== "you" && (
                  <span className="mr-1 font-medium">
                    {msg.senderName || "Peer"}:
                  </span>
                )}
                {msg.content ||
                  `File cancelled${msg.filename ? `: ${msg.filename}` : ""}`}
              </div>
            </div>
          );
        }

        if (msg.isCode) return null;

        const isYou = msg.sender === "you";

        return (
          <div
            key={index}
            className={`flex ${isYou ? "justify-end" : "justify-start"}`}
          >
            <div className="flex flex-col max-w-[75%]">
              
              {/* Sender name */}
              {!isYou && (
                <span className="text-[11px] mb-1 px-1 text-muted-foreground">
                  {msg.senderName || "Peer"}
                </span>
              )}

              {/* Message bubble */}
              <div
                className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm transition-all
                  ${
                    isYou
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }
                `}
              >
                {msg.content}
              </div>

              {/* Timestamp */}
              <span
                className={`text-[10px] mt-1 px-1 ${
                  isYou
                    ? "text-right text-muted-foreground"
                    : "text-left text-muted-foreground"
                }`}
              >
                {msg.timestamp
                  ? new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>

    {/* Input Area */}
    <div className="border-t px-3 py-2 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Type a message..."
          className="flex-1 rounded-full px-4"
        />

        <Button
          onClick={send}
          size="icon"
          className="rounded-full shadow-sm"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>
);
};

export default MessagingPanel;
