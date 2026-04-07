import { Copy, Wifi, WifiOff, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { DeviceDescriptor } from "@/lib/api";

interface ConnectionPanelProps {
  pairingCode: string;
  status: "waiting" | "connecting" | "connected" | "failed";
  onDisconnect: () => void;
  userName?: string;
  peers?: DeviceDescriptor[];
  peerCount?: number;
}

const statusConfig = {
  waiting: { label: "Waiting for peer", color: "bg-muted-foreground", icon: WifiOff },
  connecting: { label: "Connecting...", color: "bg-amber-500", icon: Loader2 },
  connected: { label: "Direct P2P Connected", color: "bg-accent", icon: Wifi },
  failed: { label: "Connection Failed", color: "bg-destructive", icon: WifiOff },
};

const ConnectionPanel = ({ pairingCode, status, onDisconnect, userName, peers, peerCount }: ConnectionPanelProps) => {
  const [copied, setCopied] = useState(false);

  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;
  const deviceCount = (peerCount ?? 0) + 1; // +1 for the initiator

  const copyCode = () => {
    navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="surface-elevated rounded-xl p-6 space-y-6 h-fit">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
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

          {userName && (
            <div className="max-w-[110px] text-right pt-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                User
              </p>
              <p className="text-xs font-medium text-foreground truncate" title={userName}>
                {userName}
              </p>
            </div>
          )}
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

      {/* Device count indicator */}
      {peerCount !== undefined && (
        <div className="space-y-3 py-3 border-t border-b border-border">
          <div className="flex items-center gap-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-foreground">
              <span className="font-semibold">{deviceCount}</span> {deviceCount === 1 ? 'Device' : 'Devices'} Connected
            </span>
          </div>
          
          {peers && peers.length > 0 && (
            <div className="pl-7 space-y-2">
              {peers.map((peer, idx) => (
                <div key={idx} className="text-xs text-muted-foreground">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-2"></span>
                  {peer.label || peer.identifier}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pt-4">
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
