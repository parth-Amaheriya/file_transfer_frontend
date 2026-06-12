import { CheckCircle2, FileText, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface IncomingTransferApprovalRequest {
  transferId: string;
  senderDeviceId: string;
  senderDeviceName: string;
  files: Array<{
    name: string;
    size: number;
    mimeType?: string;
  }>;
  totalSize: number;
  approvalTimeoutMs: number;
}

interface TransferApprovalDialogProps {
  request: IncomingTransferApprovalRequest | null;
  open: boolean;
  onAccept: () => void;
  onReject: () => void;
}

const formatBytes = (size: number) => {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${size} B`;
};

const TransferApprovalDialog = ({ request, open, onAccept, onReject }: TransferApprovalDialogProps) => {
  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Incoming files from {request?.senderDeviceName || "another device"}</DialogTitle>
          <DialogDescription>
            Approve this transfer before any chunks are shared.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-secondary/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{request?.files.length || 0} files</p>
                <p className="text-xs text-muted-foreground">{formatBytes(request?.totalSize || 0)} total</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
                <FileText className="h-4 w-4" />
              </div>
            </div>
          </div>

          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {(request?.files || []).map((file) => (
              <div key={file.name} className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-foreground">{file.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
                <span className="shrink-0 rounded-md bg-secondary px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {file.mimeType || "File"}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2.5 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span className="leading-tight">Approval timeout: {Math.round((request?.approvalTimeoutMs || 30000) / 1000)} seconds</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onReject} className="gap-2">
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
          <Button onClick={onAccept} className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferApprovalDialog;