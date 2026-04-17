import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { Send, Smile } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type DeviceDescriptor, type Message } from "@/lib/api";

interface MessagingPanelProps {
  messages: Message[];
  peers: DeviceDescriptor[];
  onSendMessage: (content: string, targetPeerIds?: string[]) => void;
}

type EmojiSelect = {
  native: string;
};

const MessagingPanel = ({
  messages,
  peers,
  onSendMessage,
}: MessagingPanelProps) => {
  const [input, setInput] = useState("");
  const [caretPosition, setCaretPosition] = useState(0);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const visibleMessages = messages.filter(
    (m) => m.type === "text" || m.type === "file_cancel"
  );

  // ✅ Auto scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleMessages]);

  // ✅ Close emoji picker on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;

      if (
        emojiPickerOpen &&
        !emojiPickerRef.current?.contains(target) &&
        !emojiButtonRef.current?.contains(target)
      ) {
        setEmojiPickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [emojiPickerOpen]);

  const formatMessageTime = (timestamp?: string | number) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ✅ Mention logic
  const mentionContext = useMemo(() => {
    const beforeCaret = input.slice(0, caretPosition);
    const match = beforeCaret.match(/^\s*((?:@[^\s@]+\s*)*)@([^\s@]*)$/);
    if (!match) return null;

    const token = match[0];
    const tokenStart = beforeCaret.length - token.length;

    return {
      query: match[2].toLowerCase(),
      mentionStart: tokenStart + match[1].length,
    };
  }, [caretPosition, input]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionContext) return [];

    return peers
      .filter((peer) => {
        const label = (peer.label || peer.identifier).toLowerCase();
        return (
          label.includes(mentionContext.query) ||
          peer.identifier.toLowerCase().includes(mentionContext.query)
        );
      })
      .slice(0, 6);
  }, [mentionContext, peers]);

  const updateInput = (value: string, caret: number) => {
    setInput(value);
    setCaretPosition(caret);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  const insertAtCaret = (value: string) => {
    const start = inputRef.current?.selectionStart ?? input.length;
    const end = inputRef.current?.selectionEnd ?? input.length;

    const next = input.slice(0, start) + value + input.slice(end);

    updateInput(next, start + value.length);
    setEmojiPickerOpen(false);
  };

  const selectPeerSuggestion = (peer: DeviceDescriptor) => {
    if (!mentionContext) return;

    const name = peer.label || peer.identifier;

    const next =
      input.slice(0, mentionContext.mentionStart) +
      `@${name} ` +
      input.slice(caretPosition);

    updateInput(
      next,
      mentionContext.mentionStart + name.length + 2
    );
  };

  const send = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
    setCaretPosition(0);
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setEmojiPickerOpen(false);
    }

    if (mentionContext && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestionIndex((i) => (i + 1) % mentionSuggestions.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        selectPeerSuggestion(mentionSuggestions[suggestionIndex]);
        return;
      }
    }

    if (e.key === "Enter") send();
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      {/* ✅ SCROLLABLE MESSAGE PANEL - ONLY THIS SCROLLS */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden px-2 py-3"
        style={{
          scrollBehavior: "smooth",
        }}
      >
        {visibleMessages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet
          </div>
        )}

        <div className="space-y-3">
          {visibleMessages.map((msg, index) => {
            if (msg.type === "file_cancel") {
              return (
                <div key={index} className="text-center text-xs text-muted-foreground">
                  File cancelled
                </div>
              );
            }

            const isYou = msg.sender === "you";
            const senderLabel = isYou ? "You" : msg.senderName || "Peer";

            return (
              <div
                key={index}
                className={`flex ${isYou ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[75%]">
                  <p className={`mb-1 text-[11px] font-medium text-[#9a9a9a] ${isYou ? "text-right" : "text-left"}`}>
                    {senderLabel}
                  </p>
                  <div
                    className={`rounded-2xl px-4 py-2.5 ${
                      isYou ? "bg-[#e4eadb]" : "bg-[#f5e5d8]"
                    }`}
                  >
                    <p className="text-[14px] leading-5 whitespace-pre-wrap">
                      {msg.content}
                    </p>
                    <p className="mt-1 text-[10px] text-gray-400">
                      {formatMessageTime(msg.timestamp)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ✅ INPUT (naturally stays at bottom) */}
      <div className="flex-shrink-0 border-t border-black/5 px-2 py-2">
        <div className="relative">
          {/* Emoji Picker */}
          {emojiPickerOpen && (
            <div
              ref={emojiPickerRef}
              className="absolute bottom-full right-0 z-50 mb-2 max-h-96 overflow-hidden rounded-lg"
            >
              <Picker
                data={data}
                onEmojiSelect={(e: EmojiSelect) =>
                  insertAtCaret(e.native)
                }
              />
            </div>
          )}

          <div className="flex items-center gap-3 rounded-full border bg-white px-3 py-2 shadow-sm">
            <Button
              ref={emojiButtonRef}
              size="icon"
              variant="ghost"
              onClick={() => setEmojiPickerOpen((v) => !v)}
              className="rounded-full"
            >
              <Smile className="h-5 w-5" />
            </Button>

            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCaretPosition(e.target.selectionStart ?? 0);
              }}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 border-0 bg-transparent shadow-none"
            />

            <Button
              onClick={send}
              className="h-10 w-10 rounded-full bg-primary p-0 hover:bg-primary/90"
            >
              <Send className="h-4 w-4 -rotate-12 text-white" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessagingPanel;

