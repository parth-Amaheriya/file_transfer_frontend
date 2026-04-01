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
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {snippet.sender === "me" ? "You" : "Peer"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => copySnippet(snippet.id, snippet.code)}
              >
                {copiedId === snippet.id ? (
                  <Check className="h-3.5 w-3.5 text-accent" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
          <pre className="bg-[#1C1917] p-4 overflow-x-auto">
            <code className="text-sm font-mono text-[#FAFAF9] leading-relaxed">{snippet.code}</code>
          </pre>
        </div>
      ))}

      <div className="space-y-2 pt-2 border-t border-border">
        <Textarea
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="Paste code snippet to share..."
          className="font-mono text-sm min-h-[80px]"
        />
        <Button size="sm" disabled={!newCode.trim()}>
          Share Snippet
        </Button>
      </div>
    </div>
  );
};

export default CodeSnippetPanel;
