import { Upload, FileImage, FileVideo, FileArchive, File, Check, ArrowUp, ArrowDown, X, Search, CheckCircle2, Circle, Users } from "lucide-react";
import { useMemo, useState, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { DeviceDescriptor } from "@/lib/api";

export interface FileItem {
  id: string;
  name: string;
  size: string;
  progress: number;
  status: "uploading" | "sending" | "receiving" | "completed" | "failed" | "cancelled";
  type: "image" | "video" | "archive" | "other";
  direction?: "sent" | "received";
  senderName?: string;
}

const typeIcons = {
  image: FileImage,
  video: FileVideo,
  archive: FileArchive,
  other: File,
};

interface FileTransferPanelProps {
  peers: DeviceDescriptor[];
  selectedPeerIds: string[];
  onSelectionChange: (peerIds: string[]) => void;
  onFileUpload: (file: File, targetPeerIds: string[]) => void;
  onCancelTransfer?: (fileId: string) => void;
  files: FileItem[];
  disabled?: boolean;
  maxFileSizeBytes?: number;
}

const FileTransferPanel = ({ peers, selectedPeerIds, onSelectionChange, onFileUpload, onCancelTransfer, files, disabled = false, maxFileSizeBytes }: FileTransferPanelProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRecipientOpen, setIsRecipientOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recipientInputRef = useRef<HTMLInputElement>(null);
  const closeRecipientTimerRef = useRef<number | null>(null);

  const selectedPeers = useMemo(
    () => peers.filter((peer) => selectedPeerIds.includes(peer.identifier)),
    [peers, selectedPeerIds]
  );

  const visiblePeers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return peers;
    }

    return peers.filter((peer) => {
      const name = (peer.label || "").toLowerCase();
      const identifier = peer.identifier.toLowerCase();
      return name.includes(query) || identifier.includes(query);
    });
  }, [peers, searchQuery]);

  const togglePeer = (peerId: string) => {
    if (selectedPeerIds.includes(peerId)) {
      onSelectionChange(selectedPeerIds.filter((selectedId) => selectedId !== peerId));
      return;
    }

    onSelectionChange([...selectedPeerIds, peerId]);
  };

  const selectAllPeers = () => {
    onSelectionChange(peers.map((peer) => peer.identifier));
  };

  const clearSelection = () => {
    onSelectionChange([]);
  };

  const closeRecipientList = () => {
    if (closeRecipientTimerRef.current !== null) {
      window.clearTimeout(closeRecipientTimerRef.current);
      closeRecipientTimerRef.current = null;
    }

    closeRecipientTimerRef.current = window.setTimeout(() => {
      setIsRecipientOpen(false);
    }, 120);
  };

  const openRecipientList = () => {
    if (closeRecipientTimerRef.current !== null) {
      window.clearTimeout(closeRecipientTimerRef.current);
      closeRecipientTimerRef.current = null;
    }

    setIsRecipientOpen(true);
  };

  const handlePeerSelect = (peerId: string) => {
    if (selectedPeerIds.includes(peerId)) {
      onSelectionChange(selectedPeerIds.filter((selectedId) => selectedId !== peerId));
    } else {
      onSelectionChange([...selectedPeerIds, peerId]);
    }

    setSearchQuery("");
    setIsRecipientOpen(true);
    recipientInputRef.current?.focus();
  };

  const handleRecipientKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && searchQuery.length === 0 && selectedPeerIds.length > 0) {
      onSelectionChange(selectedPeerIds.slice(0, -1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (visiblePeers.length > 0) {
        handlePeerSelect(visiblePeers[0].identifier);
      }
    }
  };

  const handleFileSelect = (selectedFiles: FileList | null) => {
    if (disabled) {
      return;
    }

    if (selectedFiles && selectedPeerIds.length > 0) {
      Array.from(selectedFiles).forEach(file => onFileUpload(file, selectedPeerIds));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) {
      return;
    }
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleClick = () => {
    if (disabled) {
      return;
    }

    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <div className="surface rounded-2xl p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">Send to</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{selectedPeerIds.length > 0 ? `${selectedPeerIds.length} selected` : "Select devices in one field"}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllPeers}
              className="h-7 px-2.5 text-[11px] rounded-full"
              disabled={disabled || peers.length === 0}
            >
              Send to all
            </Button>
            {selectedPeerIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="h-7 px-2.5 text-[11px] rounded-full"
                disabled={disabled}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/80 px-3 py-2.5 shadow-sm transition-all focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
          <div className="flex flex-wrap items-center gap-2">
            {selectedPeers.map((peer) => {
              const displayName = peer.label || peer.identifier;
              return (
                <button
                  key={peer.identifier}
                  type="button"
                  onClick={() => handlePeerSelect(peer.identifier)}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/15 bg-primary/5 px-2 py-1 text-left transition-colors hover:bg-primary/10"
                  title={`Remove ${displayName}`}
                >
                  <span className="flex items-center justify-center 
             h-5 w-5 rounded-full 
             bg-primary text-primary-foreground 
             text-[10px] font-semibold uppercase 
             shrink-0 leading-none 
             ring-1 ring-border">
                    {displayName.slice(0, 1)}
                  </span>
                  <span className="truncate text-[11px] font-medium text-foreground max-w-[110px]">
                    {displayName}
                  </span>
                  <X className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
                </button>
              );
            })}

            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={recipientInputRef}
                value={searchQuery}
                disabled={disabled}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setIsRecipientOpen(true);
                }}
                onFocus={openRecipientList}
                onBlur={closeRecipientList}
                onKeyDown={handleRecipientKeyDown}
                placeholder={selectedPeerIds.length === 0 ? "Select devices..." : "Add more devices..."}
                className="h-8 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
        </div>

        {isRecipientOpen && (
          <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
            {peers.length === 0 ? (
              <div className="px-4 py-4 text-center">
                <p className="text-sm font-medium text-foreground">No other devices connected yet</p>
                <p className="text-xs text-muted-foreground mt-1">Recipients appear here after another device joins.</p>
              </div>
            ) : visiblePeers.length === 0 ? (
              <div className="px-4 py-4 text-center">
                <p className="text-sm font-medium text-foreground">No matching devices</p>
                <p className="text-xs text-muted-foreground mt-1">Try a different name or identifier.</p>
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto p-2">
                {visiblePeers.map((peer) => {
                  const checked = selectedPeerIds.includes(peer.identifier);
                  const displayName = peer.label || peer.identifier;
                  const initials = displayName
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase();

                  return (
                    <button
                      key={peer.identifier}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handlePeerSelect(peer.identifier);
                      }}
                      aria-pressed={checked}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${checked ? "bg-primary/5" : "hover:bg-secondary/40"
                        }`}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase ${checked ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                        {initials || displayName.slice(0, 1).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{peer.identifier}</p>
                      </div>

                      <div className="shrink-0">
                        {checked ? (
                          <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                        ) : (
                          <Circle className="h-4.5 w-4.5 text-muted-foreground/60" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) { setIsDragging(true); } }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-150 cursor-pointer
          ${disabled ? "cursor-not-allowed opacity-60 border-border" : isDragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={disabled}
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Drop files here or click to upload</p>
        <p className="text-xs text-muted-foreground mt-1">
          {maxFileSizeBytes ? `Max ${(maxFileSizeBytes / 1024 / 1024).toFixed(0)} MB per file.` : "Any file type and size supported"}
        </p>
        {disabled && (
          <p className="mt-2 text-xs text-muted-foreground">
            File transfer is disabled by an administrator.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {[...files].reverse().map((file) => {
          const Icon = typeIcons[file.type];
          const isTransferring = file.status === 'sending' || file.status === 'uploading' || file.status === 'receiving';
          return (
            <div key={file.id} className="surface rounded-lg p-4 flex items-center gap-4 animate-fade-in">
              <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                {file.senderName && (
                  <p className="text-[11px] text-muted-foreground truncate">{file.senderName}</p>
                )}
                <p className="text-xs text-muted-foreground">{file.size}</p>
                {file.status !== "completed" && file.status !== "failed" && file.status !== "cancelled" && (
                  <Progress value={file.progress} className="mt-2 h-1" />
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {file.status === "uploading" && <ArrowUp className="h-4 w-4 text-primary" />}
                {file.status === "sending" && <ArrowUp className="h-4 w-4 text-primary" />}
                {file.status === "receiving" && <ArrowDown className="h-4 w-4 text-primary" />}
                {isTransferring && onCancelTransfer && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancelTransfer(file.id)}
                    className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                    title="Cancel transfer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {file.status === "completed" && file.direction !== "received" && <Check className="h-4 w-4 text-accent" />}
                {file.status === "failed" && <span className="text-xs text-destructive">Failed</span>}
                {file.status === "cancelled" && <span className="text-xs text-amber-600">Cancelled</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FileTransferPanel;
