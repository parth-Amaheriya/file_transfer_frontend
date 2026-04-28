import { Copy, QrCode, Wifi, WifiOff, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type DeviceDescriptor, type PairingQrCodeOut } from "@/lib/api";

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
  connecting: { label: "Connecting...", color: "bg-primary", icon: Loader2 },
  connected: { label: "Direct P2P Connected", color: "bg-accent", icon: Wifi },
  failed: { label: "Connection Failed", color: "bg-destructive", icon: WifiOff },
};

const ConnectionPanel = ({ pairingCode, status, onDisconnect, userName, peers, peerCount }: ConnectionPanelProps) => {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const { data: pairingQr, isLoading: isQrLoading, isError: isQrError } = useQuery<PairingQrCodeOut>({
    queryKey: ["pairing-qr", pairingCode],
    queryFn: () => api.getPairingQRCode(pairingCode),
    enabled: Boolean(pairingCode),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setShowQr(false);
  }, [pairingCode]);

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
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Pairing Code
            </p>
            {userName && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground shrink-0">
                  You
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-foreground truncate max-w-[140px]" title={userName}>
                  {userName}
                </span>
              </div>
            )}
          </div>
          <div className="[perspective:1200px]">
            <div className={`relative min-h-[14rem] transition-transform duration-500 [transform-style:preserve-3d] ${showQr ? "[transform:rotateY(180deg)]" : ""}`}>
              <div className={`absolute inset-0 flex items-center rounded-2xl border border-border bg-card/60 p-5 shadow-sm [backface-visibility:hidden] ${showQr ? "pointer-events-none" : ""}`}>
                <div className="flex w-full items-center gap-3">
                  <span className="text-3xl font-bold tracking-[0.3em] font-mono text-foreground">
                    {pairingCode}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={copyCode} className="relative">
                      <Copy className="h-4 w-4" />
                      {copied && (
                        <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs bg-foreground text-card px-2 py-1 rounded animate-fade-in">
                          Copied!
                        </span>
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setShowQr(true)} aria-label="Show QR code">
                      <QrCode className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card/60 p-5 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)] ${showQr ? "" : "pointer-events-none"}`}
                onClick={() => setShowQr(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setShowQr(false);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Hide QR code"
              >
                <div className="rounded-2xl bg-white p-3 shadow-inner">
                  {pairingQr?.qrcode ? (
                    <img src={pairingQr.qrcode} alt={`QR code for pairing ${pairingCode}`} className="h-36 w-36" />
                  ) : (
                    <div className="flex h-36 w-36 items-center justify-center text-center text-xs text-muted-foreground">
                      {isQrError ? "QR unavailable" : isQrLoading ? "Loading QR..." : "Preparing QR..."}
                    </div>
                  )}
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Scan to join</p>
                  <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Tap to return to the code</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Status
        </p>
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${cfg.color}`} />
          <StatusIcon className={`h-4 w-4 ${status === "connecting" ? "text-primary animate-spin" : "text-muted-foreground"}`} />
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
