import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BackgroundEffects from "@/components/BackgroundEffects";

const Index = () => {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => sessionStorage.getItem("deviceName") || "MyDevice");
  const navigate = useNavigate();
  const deviceNameHasSpaces = /\s/.test(deviceName);

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
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Device name</p>
            <div className="space-y-1">
              <Input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                aria-invalid={deviceNameHasSpaces}
                placeholder="MyLaptop"
                className={`font-medium ${deviceNameHasSpaces ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
              />
              <p className={`text-[11px] ${deviceNameHasSpaces ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                {deviceNameHasSpaces
                  ? "Device name must not contain spaces."
                  : "Use a single word with no spaces."}
              </p>
            </div>
          </div>

          <Button
            variant="hero"
            size="lg"
            className="w-full text-base h-12"
            onClick={() => {
              if (deviceNameHasSpaces) {
                return;
              }

              navigate("/session", { state: { deviceName: deviceName.trim() || "MyDevice" } });
            }}
            disabled={deviceNameHasSpaces}
          >
            Create Session
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
              placeholder="Enter pairing code"
              className="font-mono tracking-widest text-center"
              autoFocus
            />
            <Button
              variant="outline"
              onClick={() => {
                if (!code.trim() || deviceNameHasSpaces) {
                  return;
                }

                navigate("/session", { state: { joinCode: code.trim(), deviceName: deviceName.trim() || "MyDevice" } });
              }}
              disabled={!code.trim() || deviceNameHasSpaces}
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
