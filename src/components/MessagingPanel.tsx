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

  const mentionContext = useMemo(() => {
    const beforeCaret = input.slice(0, caretPosition);
    const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);

    if (!match) {
      return null;
    }

    const token = match[0];
    const tokenStart = beforeCaret.length - token.length;
    const mentionStart = tokenStart + match[1].length;

    return {
      query: match[2].toLowerCase(),
      mentionStart,
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

  const stripLeadingMention = (content: string, targetPeerIds: string[]) => {
    if (targetPeerIds.length === 0) {
      return content.trim();
    }

    const targetPeers = targetPeerIds
      .map((peerId) => peers.find((peer) => peer.identifier === peerId))
      .filter((peer): peer is DeviceDescriptor => Boolean(peer));

    const aliases = targetPeers
      .flatMap((peer) => [peer.label, peer.identifier])
      .filter((alias): alias is string => Boolean(alias))
      .sort((left, right) => right.length - left.length);

    const trimmedContent = content.trimStart();

    for (const alias of aliases) {
      const prefix = `@${alias.toLowerCase()}`;
      if (!trimmedContent.toLowerCase().startsWith(prefix)) {
        continue;
      }

      const nextChar = trimmedContent.slice(prefix.length, prefix.length + 1);
      if (nextChar && !/\s|,|\.|!|\?|:|;/.test(nextChar)) {
        continue;
      }

      const stripped = trimmedContent.slice(prefix.length).trimStart();
      return stripped || trimmedContent;
    }

    const stripped = trimmedContent.replace(/^@[^\s]+\s*/, "").trimStart();
    return stripped || trimmedContent;
  };

  const resolveTargetPeerIds = (content: string) => {
    const trimmed = content.trimStart();

    if (!trimmed.startsWith("@")) {
      return [] as string[];
    }

    const normalized = trimmed.toLowerCase();
    const candidates = peers
      .flatMap((peer) => {
        const aliases = [peer.label, peer.identifier].filter((alias): alias is string => Boolean(alias));
        return aliases.map((alias) => ({ peer, alias }));
      })
      .sort((left, right) => right.alias.length - left.alias.length);

    for (const candidate of candidates) {
      const alias = candidate.alias.trim();
      if (!alias) {
        continue;
      }

      const prefix = `@${alias.toLowerCase()}`;
      if (!normalized.startsWith(prefix)) {
        continue;
      }

      const nextChar = trimmed.slice(prefix.length, prefix.length + 1);
      if (nextChar && !/\s|,|\.|!|\?|:|;/.test(nextChar)) {
        continue;
      }

      return [candidate.peer.identifier];
    }

    const handle = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
    if (!handle) {
      return [] as string[];
    }

    const matches = peers.filter((peer) => {
      const aliases = [peer.label, peer.identifier].filter((alias): alias is string => Boolean(alias));
      return aliases.some((alias) => alias.toLowerCase().startsWith(handle));
    });

    return matches.length === 1 ? [matches[0].identifier] : [] as string[];
  };

  const send = () => {
    if (!input.trim()) return;

    const targetPeerIds = resolveTargetPeerIds(input);
    const outboundContent = stripLeadingMention(input, targetPeerIds);
    onSendMessage(outboundContent, targetPeerIds);
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
        const recipientPeer = msg.target_peer_ids?.length === 1
          ? peers.find((peer) => peer.identifier === msg.target_peer_ids?.[0])
          : null;
        const recipientLabel = recipientPeer ? recipientPeer.label || recipientPeer.identifier : null;

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

              {isYou && recipientLabel && (
                <span className="mb-1 px-1 text-[11px] text-muted-foreground">
                  To {recipientLabel}
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
