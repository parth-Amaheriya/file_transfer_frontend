import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackgroundEffects from "@/components/BackgroundEffects";
import { api, type RuntimeConfig } from "@/lib/api";

const DEFAULT_DEVICE_NAME = "MYDEVICE";

const normalizeDeviceName = (value: string) => value.trim() || DEFAULT_DEVICE_NAME;

const Index = () => {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => sessionStorage.getItem("deviceName") || DEFAULT_DEVICE_NAME);
  const [deviceId] = useState(() => sessionStorage.getItem("deviceId") || Math.random().toString(36).substr(2, 9));
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();
  const { data: runtimeConfig } = useQuery<RuntimeConfig>({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const maintenanceBlocked = runtimeConfig ? runtimeConfig.maintenance_mode !== "off" : false;

  useEffect(() => {
    sessionStorage.setItem("deviceId", deviceId);
    sessionStorage.setItem("deviceName", normalizeDeviceName(deviceName));
  }, [deviceId, deviceName]);

  const openConnection = (connectionCode: string) => {
    const trimmedCode = connectionCode.trim().toUpperCase();

    if (!trimmedCode || maintenanceBlocked) {
      return;
    }

    const normalizedName = normalizeDeviceName(deviceName);
    sessionStorage.setItem("deviceId", deviceId);
    sessionStorage.setItem("deviceName", normalizedName);
    navigate(`/${encodeURIComponent(trimmedCode)}`, { state: { deviceName: normalizedName } });
  };

  const createRandomConnection = async () => {
    if (maintenanceBlocked || isCreating) {
      return;
    }

    setIsCreating(true);

    try {
      const normalizedName = normalizeDeviceName(deviceName);
      const pairing = await api.initiatePairing({
        identifier: deviceId,
        label: normalizedName,
        metadata: { type: "desktop" },
      });

      sessionStorage.setItem("pairing", JSON.stringify(pairing));
      sessionStorage.setItem("deviceId", deviceId);
      sessionStorage.setItem("deviceName", normalizedName);
      navigate(`/${pairing.code}`, { replace: true, state: { deviceName: normalizedName } });
    } catch (error) {
      console.error("Failed to create a random connection code:", error);
      toast.error("Could not create a connection code right now.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative px-4">
      <BackgroundEffects />

      <div className="w-full max-w-sm space-y-10 animate-fade-in">
        {/* Brand */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
            Nexdrop
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mx-auto">
            Instant, secure, serverless file sharing.
            <br />
            Connect two devices with a pairing code.
          </p>
        </div>

        {/* Actions Card */}
        <div className="surface-elevated rounded-xl p-6 space-y-5">
          {maintenanceBlocked && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-900">
              {runtimeConfig?.maintenance_mode === "shutdown"
                ? "Maintenance shutdown is active. New pairings and active sessions are blocked."
                : "Maintenance mode is active. New pairings and joins are temporarily blocked."}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Device name</p>
            <div className="space-y-1">
              <Input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="MYDEVICE"
                className="font-medium"
              />
            </div>
          </div>

          <Button
            variant="hero"
            size="lg"
            className="w-full text-base h-12"
            onClick={createRandomConnection}
            disabled={maintenanceBlocked || isCreating}
          >
            {isCreating ? "Generating..." : "Generate code"}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">or join</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Enter connection code"
              className="font-mono tracking-widest text-center"
            />
            <Button
              variant="outline"
              onClick={() => {
                openConnection(code);
              }}
              disabled={!code.trim() || maintenanceBlocked}
            >
              Join
            </Button>
          </div>
        </div>

        {/* Trust */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5" />
          <span>End-to-end encrypted · No data stored · Direct P2P</span>
        </div>
      </div>
    </div>
  );
};

export default Index;
