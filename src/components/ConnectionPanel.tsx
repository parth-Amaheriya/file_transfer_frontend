import { Copy, Wifi, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface ConnectionPanelProps {
  pairingCode: string;
  status: "waiting" | "connecting" | "connected";
  onDisconnect: () => void;
}

const statusConfig = {
  waiting: { label: "Waiting for peer", color: "bg-muted-foreground", icon: WifiOff },
  connecting: { label: "Connecting...", color: "bg-amber-500", icon: Loader2 },
  connected: { label: "Connected", color: "bg-accent", icon: Wifi },
};

const ConnectionPanel = ({ pairingCode, status, onDisconnect }: ConnectionPanelProps) => {
  const [copied, setCopied] = useState(false);

  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;

  const copyCode = () => {
    navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="surface-elevated rounded-xl p-6 space-y-6 h-fit">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Pairing Code
        </p>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold tracking-[0.3em] font-mono text-foreground">
            {pairingCode}
          </span>
          <Button variant="ghost" size="icon" onClick={copyCode} className="relative">
            <Copy className="h-4 w-4" />
            {copied && (
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs bg-foreground text-card px-2 py-1 rounded animate-fade-in">
                Copied!
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Status
        </p>
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${cfg.color}`} />
          <StatusIcon className={`h-4 w-4 text-muted-foreground ${status === "connecting" ? "animate-spin" : ""}`} />
          <span className="text-sm text-foreground">{cfg.label}</span>
        </div>
      </div>

      <div className="pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground mb-4 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          No data stored. Direct P2P transfer.
        </p>
        <Button variant="ghost" size="sm" onClick={onDisconnect} className="text-muted-foreground hover:text-destructive">
          Disconnect
        </Button>
      </div>
    </div>
  );
};

export default ConnectionPanel;
