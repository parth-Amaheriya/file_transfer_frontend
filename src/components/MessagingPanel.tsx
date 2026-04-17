
// export default MessagingPanel;
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { Send, Smile } from "lucide-react";
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
        {visibleMessages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-base text-muted-foreground">No messages yet</p>
              <p className="mt-2 text-sm text-muted-foreground">Start the conversation by sending a message</p>
            </div>
          </div>
        )}

        {visibleMessages.map((msg, index) => {
          // System message - file cancel
          if (msg.type === "file_cancel") {
            return (
              <div key={index} className="flex justify-center py-1.5">
                <p className="text-xs text-muted-foreground">
                  {msg.senderName || "Peer"} cancelled file share{msg.filename ? `: ${msg.filename}` : ""}
                </p>
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
              {!isYou && (
                <div className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/5 text-xs font-semibold text-muted-foreground">
                  {senderInitials || "P"}
                </div>
              )}

              <div className={`max-w-sm ${isYou ? "text-right" : "text-left"}`}>
                <p className={`mb-1 text-xs font-medium text-muted-foreground ${isYou ? "text-right" : "text-left"}`}>
                  {senderLabel}
                </p>

                <div
                  className={`rounded-2xl px-4 py-3 ${
                    isYou ? "bg-primary/5 text-foreground" : "bg-card text-foreground"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatMessageTime(msg.timestamp)}
                  </p>
                </div>

                {isYou && recipientLabels.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    To {recipientLabels.join(" ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-5 pt-0">
        <div className="relative">
          {mentionContext && mentionSuggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-3 overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
              <div className="border-b border-border px-4 py-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Send to
              </div>
              <div className="max-h-56 overflow-y-auto p-1">
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
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${isActive ? "bg-primary/5" : "hover:bg-muted/60"}`}
                    >
                      <span className="font-medium text-foreground">{label}</span>
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
              className="absolute bottom-full right-0 z-20 mb-3 overflow-hidden rounded-2xl border border-border bg-background shadow-lg"
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

          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <button
              ref={emojiButtonRef}
              type="button"
              onClick={() => setEmojiPickerOpen((current) => !current)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            >
              <Smile className="h-5 w-5" />
            </button>

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
              placeholder="Type a message..."
              className="flex-1 border-0 bg-transparent px-0 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            />

            <Button type="button" onClick={send} size="sm" className="h-9 rounded-xl bg-primary px-4 text-primary-foreground transition-opacity hover:opacity-90">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessagingPanel;