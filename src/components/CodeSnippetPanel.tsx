import { Copy, Check, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Message } from "@/lib/api";

interface CodeSnippet {
  id: string;
  code: string;
  language: string;
  sender: "you" | "peer";
}

interface CodeSnippetPanelProps {
  onSendCode: (code: string) => void;
  messages: Message[];
}

const detectLanguage = (code: string): string => {
  const trimmed = code.trim();
  
  if (trimmed.includes("import ") || trimmed.includes("from ") || trimmed.includes("def ")) {
    return "Python";
  }
  if (trimmed.includes("const ") || trimmed.includes("function ") || trimmed.includes("=>")) {
    return "TypeScript";
  }
  if (trimmed.includes("function ") || trimmed.includes("var ") || trimmed.includes("let ")) {
    return "JavaScript";
  }
  if (trimmed.includes("public ") || trimmed.includes("class ") || trimmed.includes("void ")) {
    return "Java";
  }
  if (trimmed.includes("#include") || trimmed.includes("int main")) {
    return "C++";
  }
  if (trimmed.includes("<?php") || trimmed.includes("echo ")) {
    return "PHP";
  }
  return "Code";
};

const CodeSnippetPanel = ({ onSendCode, messages }: CodeSnippetPanelProps) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");

  // Filter and format code messages
  const codeSnippets: CodeSnippet[] = messages
    .filter(msg => msg.type === "text" && msg.content)
    .map((msg, idx) => ({
      id: `code-${idx}`,
      code: msg.content!,
      language: detectLanguage(msg.content!),
      sender: msg.sender === "you" ? "you" : "peer",
    }));

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
      {/* Display received code snippets */}
      <div className="space-y-3">
        {codeSnippets.map((snippet) => (
          <div key={snippet.id} className="surface rounded-lg p-4 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{snippet.language}</span>
              <span className="text-xs font-medium text-muted-foreground capitalize">{snippet.sender}</span>
            </div>
            <pre className="bg-black rounded-lg p-3 overflow-x-auto">
              <code className="text-sm text-gray-100 font-mono">{snippet.code}</code>
            </pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copySnippet(snippet.id, snippet.code)}
              className="w-full"
            >
              {copiedId === snippet.id ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Code
                </>
              )}
            </Button>
          </div>
        ))}
      </div>

      {/* Send new code */}
      <div className="space-y-3 border-t border-border pt-4">
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
