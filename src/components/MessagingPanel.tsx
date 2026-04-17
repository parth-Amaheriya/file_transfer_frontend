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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);

  const visibleMessages = messages.filter(
    (m) => m.type === "text" || m.type === "file_cancel"
  );

  // ✅ Detect scroll position
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;

    const threshold = 80;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    setIsAtBottom(atBottom);
  };

  // ✅ Auto-scroll
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [visibleMessages, isAtBottom]);

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

  // 🧠 Mention logic
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
  }, [input, caretPosition]);

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

    const next =
      input.slice(0, start) + value + input.slice(end);

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
    if (e.key === "Escape" && emojiPickerOpen) {
      setEmojiPickerOpen(false);
      return;
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
    <div className="flex h-full flex-col">
      {/* ✅ MESSAGES */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-3"
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

            return (
              <div
                key={index}
                className={`flex ${isYou ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[75%]">
                  <div
                    className={`rounded-2xl px-4 py-2.5 ${
                      isYou ? "bg-[#e4eadb]" : "bg-[#f5e5d8]"
                    }`}
                  >
                    <p className="text-[14px] leading-5 whitespace-pre-wrap">
                      {msg.content}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      {formatMessageTime(msg.timestamp)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 👇 scroll anchor */}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ✅ INPUT */}
      <div className="border-t px-2 py-2">
        <div className="relative">
          {/* Mentions */}
          {mentionContext && mentionSuggestions.length > 0 && (
            <div className="absolute bottom-full mb-2 w-full rounded-xl bg-white shadow">
              {mentionSuggestions.map((peer, i) => (
                <button
                  key={peer.identifier}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectPeerSuggestion(peer);
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    i === suggestionIndex ? "bg-gray-100" : ""
                  }`}
                >
                  {peer.label || peer.identifier}
                </button>
              ))}
            </div>
          )}

          {/* Emoji */}
          {emojiPickerOpen && (
            <div
              ref={emojiPickerRef}
              className="absolute bottom-full right-0 mb-2"
            >
              <Picker
                data={data}
                onEmojiSelect={(e: EmojiSelect) =>
                  insertAtCaret(e.native)
                }
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCaretPosition(e.target.selectionStart ?? 0);
              }}
              onKeyDown={handleKeyPress}
              placeholder="Type message..."
              className="flex-1 rounded-full"
            />

            <Button
              ref={emojiButtonRef}
              size="icon"
              variant="outline"
              onClick={() => setEmojiPickerOpen((v) => !v)}
              className="rounded-full"
            >
              <Smile className="h-4 w-4" />
            </Button>

            <Button
              size="icon"
              onClick={send}
              className="rounded-full"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessagingPanel;