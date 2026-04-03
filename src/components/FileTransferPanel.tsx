import { Upload, FileImage, FileVideo, FileArchive, File, Check, ArrowUp, ArrowDown, X } from "lucide-react";
import { useState, useRef } from "react";
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
}

const FileTransferPanel = ({ peers, selectedPeerIds, onSelectionChange, onFileUpload, onCancelTransfer, files }: FileTransferPanelProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      <div className="surface rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Send to</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectionChange(peers.map((peer) => peer.identifier))}
            className="h-8 px-2 text-xs"
            disabled={peers.length === 0}
          >
            Select all
          </Button>
        </div>

        {peers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No other devices connected yet.</p>
        ) : (
          <div className="grid gap-2">
            {peers.map((peer) => {
              const checked = selectedPeerIds.includes(peer.identifier);
              return (
                <label
                  key={peer.identifier}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{peer.label || peer.identifier}</p>
                    <p className="text-xs text-muted-foreground truncate">{peer.identifier}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (checked) {
                        onSelectionChange(selectedPeerIds.filter((peerId) => peerId !== peer.identifier));
                      } else {
                        onSelectionChange([...selectedPeerIds, peer.identifier]);
                      }
                    }}
                    className="h-4 w-4 accent-primary cursor-pointer"
                  />
                </label>
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
