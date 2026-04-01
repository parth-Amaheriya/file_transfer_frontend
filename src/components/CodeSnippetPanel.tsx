import { Copy, Check, Send, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Message } from "@/lib/api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CodeSnippet {
  id: string;
  code: string;
  language: string;
  sender: "you" | "peer";
  title?: string;
}

interface CodeSnippetPanelProps {
  onSendCode: (code: string, title: string) => void;
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
  const [newTitle, setNewTitle] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filter and format code messages only
  const codeSnippets: CodeSnippet[] = messages
    .filter(msg => msg.type === "text" && msg.content && msg.isCode)
    .map((msg, idx) => ({
      id: `code-${idx}`,
      code: msg.content!,
      language: detectLanguage(msg.content!),
      sender: msg.sender === "you" ? "you" : "peer",
      title: msg.codeTitle,
    }));

  const copySnippet = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sendCode = () => {
    if (newCode.trim()) {
      onSendCode(newCode, newTitle.trim() || "Untitled Snippet");
      setNewCode("");
      setNewTitle("");
    }
  };

  const truncateCode = (code: string, maxLines: number = 5): { truncated: string; isTruncated: boolean } => {
    const lines = code.split("\n");
    if (lines.length > maxLines) {
      return { truncated: lines.slice(0, maxLines).join("\n"), isTruncated: true };
    }
    return { truncated: code, isTruncated: false };
  };

  return (
    <div className="space-y-4">
      {/* Display received code snippets */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {codeSnippets.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-8">
            No code snippets yet. Share your first snippet!
          </p>
        ) : (
          codeSnippets.map((snippet) => {
            const { truncated, isTruncated } = truncateCode(snippet.code, 5);
            const isExpanded = expandedId === snippet.id;

            return (
              <Collapsible key={snippet.id} open={isExpanded} onOpenChange={(open) => setExpandedId(open ? snippet.id : null)}>
                <div className="surface rounded-lg overflow-hidden animate-fade-in">
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors text-left cursor-pointer">
                      <div className="flex items-center gap-3 flex-1">
                        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{snippet.title || "Untitled Snippet"}</p>
                          <p className="text-xs text-muted-foreground">
                            {snippet.language} • {snippet.code.split("\n").length} lines • {snippet.sender === "you" ? "You" : "Peer"}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copySnippet(snippet.id, snippet.code);
                        }}
                        className="ml-2 p-2 hover:bg-secondary rounded-md transition-colors"
                      >
                        {copiedId === snippet.id ? (
                          <Check className="h-4 w-4 text-accent" />
                        ) : (
                          <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        )}
                      </button>
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="border-t border-border">
                    <div className="p-4 space-y-3 bg-card/50">
                      <pre className="bg-black rounded-lg p-3 overflow-x-auto max-h-[300px] overflow-y-auto">
                        <code className="text-sm text-gray-100 font-mono whitespace-pre-wrap">
                          {isExpanded ? snippet.code : truncated}
                        </code>
                      </pre>
                      {isTruncated && !isExpanded && (
                        <p className="text-xs text-muted-foreground text-center">
                          ... and {snippet.code.split("\n").length - 5} more lines
                        </p>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })
        )}
      </div>

      {/* Send new code */}
      <div className="space-y-3 border-t border-border pt-4">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Give your snippet a title (e.g., Authentication Helper)..."
          className="text-sm"
        />
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
