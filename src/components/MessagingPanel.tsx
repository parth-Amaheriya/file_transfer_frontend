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
        {messages.filter(m => m.type === "text" && !m.isCode).map((msg, index) => (
          <div key={index} className={`flex justify-end animate-fade-in`}>
            <div className="max-w-[75%] rounded-2xl px-4 py-2.5 bg-primary text-primary-foreground rounded-br-md">
              <p className="text-sm leading-relaxed">{msg.content}</p>
              <p className="text-[10px] mt-1 text-primary-foreground/60">
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
              </p>
            </div>
          </div>
        ))}
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
