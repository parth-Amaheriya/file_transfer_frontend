import { Copy, Check, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface CodeSnippetPanelProps {
  onSendCode: (code: string) => void;
}

const CodeSnippetPanel = ({ onSendCode }: CodeSnippetPanelProps) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");

  const copySnippet = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sendCode = () => {
    if (newCode.trim()) {
      onSendCode(newCode);
      setNewCode("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Textarea
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="Paste your code snippet here..."
          className="min-h-[200px] font-mono text-sm"
        />
        <Button onClick={sendCode} className="w-full">
          <Send className="h-4 w-4 mr-2" />
          Send Code
        </Button>
      </div>
    </div>
  );
};

export default CodeSnippetPanel;
