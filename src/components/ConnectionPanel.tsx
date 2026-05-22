import { QrCode, Share2, Wifi, WifiOff, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type DeviceDescriptor, type PairingQrCodeOut } from "@/lib/api";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ConnectionPanelProps {
  pairingCode: string;
  status: "waiting" | "connecting" | "connected" | "failed";
  onDisconnect: () => void;
  userName?: string;
  onUserNameChange?: (value: string) => void;
  peers?: DeviceDescriptor[];
  peerCount?: number;
}

const statusConfig = {
  waiting: { label: "Waiting for peer", color: "bg-muted-foreground", icon: WifiOff },
  connecting: { label: "Connecting...", color: "bg-primary", icon: Loader2 },
  connected: { label: "Direct P2P Connected", color: "bg-accent", icon: Wifi },
  failed: { label: "Connection Failed", color: "bg-destructive", icon: WifiOff },
};

const ConnectionPanel = ({ pairingCode, status, onDisconnect, userName, onUserNameChange, peers, peerCount }: ConnectionPanelProps) => {
  const [showQr, setShowQr] = useState(false);
  const [isEditingUserName, setIsEditingUserName] = useState(false);
  const [draftUserName, setDraftUserName] = useState(userName || "MYDEVICE");

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

  useEffect(() => {
    setDraftUserName(userName || "MYDEVICE");
  }, [userName]);

  const shareLink = typeof window !== "undefined"
    ? `${window.location.origin.replace(/\/$/, "")}/${pairingCode}`
    : pairingCode;

  const commitUserName = () => {
    const nextValue = draftUserName.trim() || "MYDEVICE";
    setDraftUserName(nextValue);
    setIsEditingUserName(false);
    onUserNameChange?.(nextValue);
  };

  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;
  const deviceCount = (peerCount ?? 0) + 1; // +1 for the initiator
  const normalizedUserName = draftUserName.trim() || "MYDEVICE";
  const displayUserLabel = `${normalizedUserName.slice(0, 6)}${normalizedUserName.length > 6 ? "..." : ""}`;
  const userNameFieldClassName = "min-w-0 w-[9ch] max-w-[9ch] flex-shrink-0 overflow-hidden whitespace-nowrap text-ellipsis uppercase tracking-[0.2em]";

  const copyCode = () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      toast.success("Connection link copied");
    }).catch(() => {
      toast.error("Could not copy the connection link");
    });
  };

  return (
    <div className="surface-elevated rounded-xl p-5 space-y-6 h-fit">
      <div className="[perspective:1200px]">
        <div className={`grid transition-transform duration-500 [transform-style:preserve-3d] ${showQr ? "[transform:rotateY(180deg)]" : ""}`}>
          <div className={`col-start-1 row-start-1 space-y-6 [backface-visibility:hidden] ${showQr ? "pointer-events-none" : ""}`}>
            <div className="w-full rounded-2xl border border-border/60 bg-background/70 px-1.5 py-1">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {userName && (
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        You
                      </span>
                    </div>
                  )}

                  {userName && <span className="h-5 w-px shrink-0 bg-border/70" />}

                  {userName && isEditingUserName ? (
                    <Input
                      value={draftUserName}
                      readOnly={false}
                      onChange={(event) => setDraftUserName(event.target.value.toUpperCase())}
                      onBlur={commitUserName}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitUserName();
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          setDraftUserName(userName || "MYDEVICE");
                          setIsEditingUserName(false);
                        }
                      }}
                      autoFocus={isEditingUserName}
                      title={normalizedUserName}
                      className={`h-6 border-0 bg-transparent px-0 py-0 text-sm font-semibold text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 ${userNameFieldClassName}`}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditingUserName(true)}
                      title={normalizedUserName}
                      className={`border-0 bg-transparent p-0 text-sm font-semibold text-foreground ${userNameFieldClassName}`}
                    >
                      {displayUserLabel}
                    </button>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={copyCode}
                        aria-label="Share connection link"
                        className="h-9 w-9 rounded-xl border-border/60 bg-background/60 text-foreground shadow-none hover:bg-background"
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Share connection link</TooltipContent>
                  </Tooltip>
                  <Button variant="ghost" size="icon" onClick={() => setShowQr(true)} aria-label="Show QR code" className="h-10 w-10 rounded-xl">
                    <QrCode className="h-4 w-4" />
                  </Button>
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
                    <span className="font-semibold">{deviceCount-1}</span> {deviceCount-1 === 1 ? 'Device' : 'Devices'} Connected
                  </span>
                </div>

                {peers && peers.length > 0 && (
                  <div className="pl-7 space-y-2">
                    {peers.map((peer, idx) => {
                      const displayName = peer.label || peer.identifier;
                      return (
                        <div key={idx} className="text-xs text-muted-foreground">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-2"></span>
                          <span className="truncate max-w-[180px]" title={displayName}>{displayName}</span>
                        </div>
                      );
                    })}
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

          <div
            className={`col-start-1 row-start-1 flex min-h-full flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card p-6 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)] ${showQr ? "" : "pointer-events-none"}`}
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
            <div className="rounded-2xl bg-white p-4 shadow-inner">
              {pairingQr?.qrcode ? (
                <img src={pairingQr.qrcode} alt="QR code for pairing" className="h-40 w-40" />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center text-center text-xs text-muted-foreground">
                  {isQrError ? "QR unavailable" : isQrLoading ? "Loading QR..." : "Preparing QR..."}
                </div>
              )}
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Scan to join</p>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Tap to return to the connection</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default ConnectionPanel;
