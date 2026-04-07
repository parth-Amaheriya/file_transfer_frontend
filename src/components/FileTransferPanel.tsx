import { Upload, FileImage, FileVideo, FileArchive, File, Check, ArrowUp, ArrowDown, X, Search, CheckCircle2, Circle, Users } from "lucide-react";
import { useMemo, useState, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}

const FileTransferPanel = ({ peers, selectedPeerIds, onSelectionChange, onFileUpload, onCancelTransfer, files }: FileTransferPanelProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileSelect = (selectedFiles: FileList | null) => {
    if (selectedFiles && selectedPeerIds.length > 0) {
      Array.from(selectedFiles).forEach(file => onFileUpload(file, selectedPeerIds));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <div className="surface rounded-2xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Send to</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{selectedPeerIds.length > 0 ? `${selectedPeerIds.length} selected` : "Choose one or more recipients"}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllPeers}
              className="h-8 px-3 text-xs"
              disabled={peers.length === 0}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="h-8 px-3 text-xs"
              disabled={selectedPeerIds.length === 0}
            >
              Clear
            </Button>
          </div>
        </div>

        {selectedPeers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedPeers.map((peer) => (
              <button
                key={peer.identifier}
                type="button"
                onClick={() => togglePeer(peer.identifier)}
                className="group inline-flex max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-left transition-colors hover:bg-primary/10"
                title={`Remove ${peer.label || peer.identifier}`}
              >
                <span className="h-5 w-5 rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary flex items-center justify-center shrink-0">
                  {(peer.label || peer.identifier).slice(0, 1)}
                </span>
                <span className="truncate text-xs font-medium text-foreground max-w-[120px]">
                  {peer.label || peer.identifier}
                </span>
                <X className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search devices"
            className="h-10 rounded-xl pl-9"
          />
        </div>

        {peers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/20 px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">No other devices connected yet</p>
            <p className="text-xs text-muted-foreground mt-1">Recipients will appear here once another device joins.</p>
          </div>
        ) : visiblePeers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/20 px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">No matching devices</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different name or identifier.</p>
          </div>
        ) : (
          <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
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
                  onClick={() => togglePeer(peer.identifier)}
                  aria-pressed={checked}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-150 hover:-translate-y-px hover:shadow-sm ${
                    checked
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-primary/30 hover:bg-secondary/30"
                  }`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase ${checked ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                    {initials || displayName.slice(0, 1).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                      {checked ? (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Selected
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{peer.identifier}</p>
                  </div>

                  <div className="shrink-0">
                    {checked ? (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/60" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-150 cursor-pointer
          ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Drop files here or click to upload</p>
        <p className="text-xs text-muted-foreground mt-1">Any file type and size supported</p>
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
