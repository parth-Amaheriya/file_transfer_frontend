import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { Smile, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

const MessagingPanel = ({ messages, peers, onSendMessage }: MessagingPanelProps) => {
  const [input, setInput] = useState("");
  const [caretPosition, setCaretPosition] = useState(0);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const visibleMessages = messages.filter((message) => message.type === "text" || message.type === "file_cancel");

  const formatMessageTime = (timestamp?: string | number) => {
    if (!timestamp) {
      return "";
    }

    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  };

  const mentionContext = useMemo(() => {
    const beforeCaret = input.slice(0, caretPosition);
    const match = beforeCaret.match(/^\s*((?:@[^\s@]+\s*)*)@([^\s@]*)$/);

    if (!match) {
      return null;
    }

    const token = match[0];
    const tokenStart = beforeCaret.length - token.length;

    return {
      query: match[2].toLowerCase(),
      mentionStart: tokenStart + match[1].length,
    };
  }, [caretPosition, input]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionContext) {
      return [] as DeviceDescriptor[];
    }

    const query = mentionContext.query;

    return peers
      .filter((peer) => {
        const label = (peer.label || peer.identifier).toLowerCase();
        return query.length === 0 || label.includes(query) || peer.identifier.toLowerCase().includes(query);
      })
      .sort((left, right) => (left.label || left.identifier).localeCompare(right.label || right.identifier))
      .slice(0, 6);
  }, [mentionContext, peers]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        emojiPickerOpen &&
        !emojiPickerRef.current?.contains(target) &&
        !emojiButtonRef.current?.contains(target)
      ) {
        setEmojiPickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [emojiPickerOpen]);

  useEffect(() => {
    setSuggestionIndex(0);
  }, [mentionContext?.query, mentionSuggestions.length]);

  const updateInput = (nextValue: string, nextCaretPosition: number) => {
    setInput(nextValue);
    setCaretPosition(nextCaretPosition);

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  };

  const insertAtCaret = (value: string) => {
    const selectionStart = inputRef.current?.selectionStart ?? caretPosition ?? input.length;
    const selectionEnd = inputRef.current?.selectionEnd ?? caretPosition ?? input.length;
    const nextValue = `${input.slice(0, selectionStart)}${value}${input.slice(selectionEnd)}`;

    updateInput(nextValue, selectionStart + value.length);
    setEmojiPickerOpen(false);
  };

  const selectPeerSuggestion = (peer: DeviceDescriptor) => {
    if (!mentionContext) {
      return;
    }

    const displayName = peer.label || peer.identifier;
    const nextValue = `${input.slice(0, mentionContext.mentionStart)}@${displayName} ${input.slice(caretPosition)}`;
    const nextCaret = mentionContext.mentionStart + displayName.length + 2;

    updateInput(nextValue, nextCaret);
  };

  const resolvePeerFromAlias = (alias: string) => {
    const normalizedAlias = alias.trim().toLowerCase();

    if (!normalizedAlias) {
      return null;
    }

    const exactMatch = peers.find((peer) => {
      const aliases = [peer.label, peer.identifier].filter((value): value is string => Boolean(value));
      return aliases.some((value) => value.toLowerCase() === normalizedAlias);
    });

    if (exactMatch) {
      return exactMatch;
    }

    const prefixMatches = peers.filter((peer) => {
      const aliases = [peer.label, peer.identifier].filter((value): value is string => Boolean(value));
      return aliases.some((value) => value.toLowerCase().startsWith(normalizedAlias));
    });

    return prefixMatches.length === 1 ? prefixMatches[0] : null;
  };

  const parseOutgoingMessage = (content: string) => {
    let remainder = content.trimStart();
    const targetPeerIds: string[] = [];

    while (remainder.startsWith("@")) {
      const match = remainder.match(/^@([^\s@]+)/);

      if (!match) {
        break;
      }

      const resolvedPeer = resolvePeerFromAlias(match[1]);

      if (resolvedPeer && !targetPeerIds.includes(resolvedPeer.identifier)) {
        targetPeerIds.push(resolvedPeer.identifier);
      }

      remainder = remainder.slice(match[0].length).trimStart();
    }

    if (targetPeerIds.length === 0) {
      return {
        targetPeerIds: [] as string[],
        normalizedContent: content.trim(),
      };
    }

    return {
      targetPeerIds,
      normalizedContent: remainder,
    };
  };

  const send = () => {
    if (!input.trim()) return;

    const { targetPeerIds, normalizedContent } = parseOutgoingMessage(input);
    if (targetPeerIds.length > 0 && !normalizedContent.trim()) {
      return;
    }

    onSendMessage(normalizedContent, targetPeerIds);
    setInput("");
    setCaretPosition(0);
    setEmojiPickerOpen(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && emojiPickerOpen) {
      setEmojiPickerOpen(false);
      return;
    }

    if (mentionContext && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestionIndex((current) => (current + 1) % mentionSuggestions.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length);
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
    <div className="flex h-[420px] flex-col rounded-2xl border bg-background shadow-sm">
    
    {/* Messages */}
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3 scrollbar-thin">
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
        const senderLabel = msg.senderName || (isYou ? "You" : "Peer");
        const recipientLabels = msg.target_peer_ids?.length
          ? msg.target_peer_ids.map((peerId) => {
              const peer = peers.find((item) => item.identifier === peerId);
              return `@${peer?.label || peer?.identifier || peerId}`;
            })
          : [];
        const senderInitials = getInitials(senderLabel);

        return (
          <div
            key={index}
            className={`flex ${isYou ? "justify-end" : "justify-start"}`}
          >
            <div className={`flex max-w-[78%] gap-3 ${isYou ? "flex-row-reverse" : "flex-row"}`}>
              {!isYou && (
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-foreground ring-1 ring-border">
                  {senderInitials || "P"}
                </div>
              )}

              <div className={`flex min-w-0 flex-col ${isYou ? "items-end" : "items-start"}`}>
                <div className={`mb-1 flex items-center gap-2 px-1 ${isYou ? "flex-row-reverse" : "flex-row"}`}>
                  <span className="text-sm font-semibold text-foreground">
                    {senderLabel}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                </div>

                {isYou && recipientLabels.length > 0 && (
                  <span className="mb-1 px-1 text-[11px] text-muted-foreground">
                    To {recipientLabels.join(" ")}
                  </span>
                )}

                <div
                  className={`rounded-2xl border px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-all ${
                    isYou
                      ? "rounded-br-sm border-primary/15 bg-primary text-primary-foreground"
                      : "rounded-bl-sm border-border bg-card text-foreground"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>

    {/* Input Area */}
    <div className="border-t px-3 py-2 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="relative">
        {mentionContext && mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 z-20 mb-2 overflow-hidden rounded-2xl border bg-card shadow-lg">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Send to one person
            </div>
            <div className="max-h-48 overflow-y-auto pb-2">
              {mentionSuggestions.map((peer, index) => {
                const label = peer.label || peer.identifier;
                const isActive = index === suggestionIndex;

                return (
                  <button
                    key={peer.identifier}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectPeerSuggestion(peer);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors ${isActive ? "bg-secondary" : "hover:bg-secondary/70"}`}
                  >
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    {peer.label && peer.label !== peer.identifier && (
                      <span className="text-xs text-muted-foreground">@{peer.identifier}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {emojiPickerOpen && (
          <div
            ref={emojiPickerRef}
            className="absolute bottom-full right-0 z-20 mb-2 overflow-hidden rounded-2xl border bg-card shadow-lg"
          >
            <Picker
              data={data}
              onEmojiSelect={(emoji: EmojiSelect) => insertAtCaret(emoji.native)}
              theme="light"
              previewPosition="none"
              skinTonePosition="none"
              searchPosition="top"
              autoFocus
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setCaretPosition(e.currentTarget.selectionStart ?? e.target.value.length);
            }}
            onClick={(e) => setCaretPosition(e.currentTarget.selectionStart ?? input.length)}
            onSelect={(e) => setCaretPosition(e.currentTarget.selectionStart ?? input.length)}
            onKeyUp={(e) => setCaretPosition(e.currentTarget.selectionStart ?? input.length)}
            onKeyDown={handleKeyPress}
            placeholder="Type a message or @name for a private chat..."
            className="flex-1 rounded-full px-4"
          />

          <Button
            ref={emojiButtonRef}
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setEmojiPickerOpen((current) => !current)}
            className="rounded-full shadow-sm"
          >
            <Smile className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            onClick={send}
            size="icon"
            className="rounded-full shadow-sm"
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
