import { Upload, FileImage, FileVideo, FileArchive, File, Check, ArrowUp, ArrowDown } from "lucide-react";
import { useState, useRef } from "react";
import { Progress } from "@/components/ui/progress";

export interface FileItem {
  id: string;
  name: string;
  size: string;
  progress: number;
  status: "sending" | "receiving" | "completed";
  type: "image" | "video" | "archive" | "other";
}

const typeIcons = {
  image: FileImage,
  video: FileVideo,
  archive: FileArchive,
  other: File,
};

interface FileTransferPanelProps {
  onFileUpload: (file: File) => void;
  files: FileItem[];
}

const FileTransferPanel = ({ onFileUpload, files }: FileTransferPanelProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (selectedFiles: FileList | null) => {
    if (selectedFiles) {
      Array.from(selectedFiles).forEach(file => onFileUpload(file));
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
        <p className="text-xs text-muted-foreground mt-1">Any file type, up to 100MB</p>
      </div>

      <div className="space-y-2">
        {files.map((file) => {
          const Icon = typeIcons[file.type];
          return (
            <div key={file.id} className="surface rounded-lg p-4 flex items-center gap-4 animate-fade-in">
              <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">{file.size}</p>
                {file.status !== "completed" && (
                  <Progress value={file.progress} className="mt-2 h-1" />
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {file.status === "sending" && <ArrowUp className="h-4 w-4 text-primary" />}
                {file.status === "receiving" && <ArrowDown className="h-4 w-4 text-primary" />}
                {file.status === "completed" && <Check className="h-4 w-4 text-accent" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FileTransferPanel;
