import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeAlert, Clock3, LogOut, RefreshCw, Shield, ShieldCheck, Sparkles, Users } from "lucide-react";
import BackgroundEffects from "@/components/BackgroundEffects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type AdminDashboard, type AdminSettingsUpdate, type RuntimeConfig } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TOKEN_KEY = "nexdrop-admin-token";

const toSettingsDraft = (settings: RuntimeConfig): AdminSettingsUpdate => ({
  maintenance_mode: settings.maintenance_mode,
  feature_flags: { ...settings.feature_flags },
  policy: { ...settings.policy },
});

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const formatFileSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

const statusTone = (status: string) => {
  if (status === "connected") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-900";
  }
  if (status === "pending") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-900";
  }
  if (status === "terminated") {
    return "border-red-500/20 bg-red-500/10 text-red-900";
  }
  return "border-border bg-white/70 text-muted-foreground";
};

const toggleTone = (value: boolean) =>
  value
    ? "border-amber-500/20 bg-amber-100 text-amber-900"
    : "border-border bg-white/70 text-muted-foreground";

const Admin = () => {
  const navigate = useNavigate();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AdminSettingsUpdate | null>(null);
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async (currentToken: string = token) => {
    if (!currentToken) {
      return;
    }

    setLoadingDashboard(true);
    try {
      const data = await api.getAdminDashboard(currentToken);
      setDashboard(data);
      setSettingsDraft(toSettingsDraft(data.settings));
      localStorage.setItem(TOKEN_KEY, currentToken);
      setToken(currentToken);
      setError(null);
    } catch (loadError) {
      console.error(loadError);
      localStorage.removeItem(TOKEN_KEY);
      setToken("");
      setDashboard(null);
      setSettingsDraft(null);
      setError("Your admin session expired. Sign in again.");
    } finally {
      setLoadingDashboard(false);
    }
  };

  useEffect(() => {
    if (token && !dashboard && !loadingDashboard) {
      void loadDashboard(token);
    }
  }, [token, dashboard, loadingDashboard]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginPending(true);
    setError(null);

    try {
      const response = await api.adminLogin(username.trim(), password);
      localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setPassword("");
      await loadDashboard(response.token);
      toast.success(`Signed in as ${response.user.username}`);
    } catch (loginError) {
      console.error(loginError);
      setError("Invalid credentials or rate limited. Try again in a moment.");
      toast.error("Sign in failed");
    } finally {
      setLoginPending(false);
    }
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await api.adminLogout(token);
      } catch (logoutError) {
        console.error(logoutError);
      }
    }

    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setDashboard(null);
    setSettingsDraft(null);
    navigate("/");
  };

  const refreshDashboard = async () => {
    if (!token) {
      return;
    }

    await loadDashboard(token);
  };

  const updateFeatureFlag = (key: keyof RuntimeConfig["feature_flags"], value: boolean) => {
    setSettingsDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        feature_flags: {
          ...current.feature_flags,
          [key]: value,
        },
      };
    });
  };

  const updatePolicy = (key: keyof RuntimeConfig["policy"], value: number) => {
    setSettingsDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        policy: {
          ...current.policy,
          [key]: value,
        },
      };
    });
  };

  const handleSaveSettings = async () => {
    if (!token || !settingsDraft) {
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateAdminSettings(token, settingsDraft);
      setSettingsDraft(toSettingsDraft(updated));
      if (dashboard) {
        setDashboard({ ...dashboard, settings: updated });
      }
      await refreshDashboard();
      toast.success("Settings saved");
    } catch (saveError) {
      console.error(saveError);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const disconnectSession = async (pairingId: string) => {
    if (!token) {
      return;
    }

    try {
      await api.disconnectAdminSession(token, pairingId);
      await refreshDashboard();
      toast.success("Session disconnected");
    } catch (disconnectError) {
      console.error(disconnectError);
      toast.error("Unable to disconnect session");
    }
  };

  const disconnectPeer = async (pairingId: string, deviceId: string) => {
    if (!token) {
      return;
    }

    try {
      await api.disconnectAdminDevice(token, pairingId, deviceId);
      await refreshDashboard();
      toast.success("Device disconnected");
    } catch (disconnectError) {
      console.error(disconnectError);
      toast.error("Unable to disconnect device");
    }
  };

  if (loadingDashboard && token && !dashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4ede1] text-[#23180f]">
        <BackgroundEffects />
        <div className="relative z-10 rounded-3xl border border-amber-900/10 bg-white/80 px-8 py-6 shadow-[0_20px_60px_rgba(120,75,18,0.08)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 animate-pulse rounded-full bg-amber-500" />
            <span className="text-sm text-stone-600">Loading admin console...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboard || !settingsDraft) {
    return (
      <div className="min-h-screen relative overflow-hidden bg-[#f4ede1] text-[#23180f]">
        <BackgroundEffects />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(244,184,112,0.28),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(255,255,255,0.85),_transparent_24%),linear-gradient(180deg,_rgba(250,244,234,0.98),_rgba(241,231,215,0.94))]" />
        <main className="relative z-10 mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10">
          <div className="grid w-full gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-8 shadow-[0_25px_80px_rgba(120,75,18,0.10)] backdrop-blur-xl">
              <div className="flex items-center gap-3 text-stone-600">
                <Shield className="h-5 w-5 text-amber-600" />
                <span className="text-xs uppercase tracking-[0.35em]">Admin Access</span>
              </div>
              <h1 className="mt-5 text-4xl font-black tracking-tight text-foreground">Nexdrop Control Room</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
                Manage maintenance mode, feature flags, session limits, and audit trails from one place.
              </p>

              {error && (
                <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-900">
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="mt-8 space-y-4 max-w-md">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Username</label>
                  <Input value={username} onChange={(event) => setUsername(event.target.value)} className="border-amber-900/10 bg-white/80 text-foreground placeholder:text-muted-foreground" placeholder="owner" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Password</label>
                  <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="border-amber-900/10 bg-white/80 text-foreground placeholder:text-muted-foreground" placeholder="••••••••" />
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Button type="submit" disabled={loginPending} className="bg-amber-500 text-white hover:bg-amber-600">
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {loginPending ? "Signing in..." : "Sign in"}
                  </Button>
                  <Button type="button" variant="ghost" className="text-stone-600 hover:bg-amber-100/70 hover:text-stone-900" onClick={() => navigate("/")}>Return home</Button>
                </div>
              </form>
            </section>

            <aside className="grid gap-4 rounded-[2rem] border border-amber-900/10 bg-white/75 p-6 shadow-[0_25px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
              <div className="rounded-2xl border border-amber-900/10 bg-[#fff9f0] p-4 shadow-sm">
                <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Seeded roles</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-stone-700">
                  <span>owner</span>
                  <span>admin</span>
                  <span>operator</span>
                  <span>viewer</span>
                </div>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-amber-900">What it controls</p>
                <ul className="mt-3 space-y-2 text-sm text-amber-950/80">
                  <li>Maintenance mode and shutdowns</li>
                  <li>File transfer, messaging, code sharing, emoji, mentions</li>
                  <li>Pairing TTL, device caps, and rate limits</li>
                  <li>Live sessions and audit history</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-amber-900/10 bg-white/80 p-4 text-sm text-muted-foreground">
                MongoDB is used for persisted admin state and audit logs when configured.
              </div>
            </aside>
          </div>
        </main>
      </div>
    );
  }

  const sessions = dashboard.sessions || [];
  const auditLog = dashboard.audit_log || [];
  const currentUser = dashboard.current_user;

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#f4ede1] text-[#23180f]">
      <BackgroundEffects />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(244,184,112,0.28),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(255,255,255,0.85),_transparent_24%),linear-gradient(180deg,_rgba(250,244,234,0.98),_rgba(241,231,215,0.94))]" />

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 lg:px-6">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-4 rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-stone-600">
                <Sparkles className="h-4 w-4 text-amber-600" />
                <span className="text-xs uppercase tracking-[0.35em]">Admin Console</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-foreground">Nexdrop Control Room</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{currentUser.display_name || currentUser.username}</span> with <span className="font-semibold text-foreground">{currentUser.role}</span> permissions.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-stone-700">
                Updated {formatDateTime(dashboard.settings.updated_at)}
              </span>
              <Button variant="outline" className="border-amber-900/10 bg-white/80 text-stone-700 hover:bg-amber-50" onClick={refreshDashboard}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button className="bg-amber-500 text-white hover:bg-amber-600" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          </header>

          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-6">
              <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-amber-600" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Maintenance</p>
                    <h2 className="text-lg font-semibold text-foreground">Mode and policy</h2>
                  </div>
                </div>

                <div className="mt-5 space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-stone-500">Maintenance mode</label>
                    <select
                      value={settingsDraft.maintenance_mode}
                      onChange={(event) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          maintenance_mode: event.target.value as RuntimeConfig["maintenance_mode"],
                        })
                      }
                      className="w-full rounded-2xl border border-amber-900/10 bg-white/80 px-4 py-3 text-sm text-foreground outline-none transition focus:border-amber-400/50"
                    >
                      <option value="off">Off</option>
                      <option value="block_new">Block new pairings and joins</option>
                      <option value="shutdown">Shutdown and disconnect active sessions</option>
                    </select>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Feature flags</p>
                    <div className="space-y-2">
                      {([
                        ["file_transfer", "File transfer"],
                        ["messaging", "Messaging"],
                        ["code_sharing", "Code sharing"],
                        ["emoji_support", "Emoji support"],
                        ["mentions", "Mentions"],
                      ] as const).map(([key, label]) => {
                        const enabled = settingsDraft.feature_flags[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => updateFeatureFlag(key, !enabled)}
                            className={cn(
                              "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition",
                              toggleTone(enabled),
                            )}
                          >
                            <span>
                              <span className="block text-sm font-medium text-foreground">{label}</span>
                              <span className="block text-xs text-muted-foreground">{enabled ? "Enabled" : "Disabled"}</span>
                            </span>
                            <span className="rounded-full border border-current px-2.5 py-1 text-[10px] uppercase tracking-[0.25em]">
                              {enabled ? "On" : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Policy limits</p>
                    <div className="grid gap-3">
                      <label className="space-y-2">
                        <span className="text-xs text-stone-500">Max file size (MB)</span>
                        <Input type="number" min="1" value={Math.max(1, Math.round(settingsDraft.policy.max_file_size_bytes / 1024 / 1024))} onChange={(event) => updatePolicy("max_file_size_bytes", Math.max(1, Number(event.target.value) || 1) * 1024 * 1024)} className="border-amber-900/10 bg-white/80 text-foreground" />
                        <span className="block text-[11px] text-muted-foreground">Current limit: {formatFileSize(settingsDraft.policy.max_file_size_bytes)}</span>
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs text-stone-500">Pairing TTL (seconds)</span>
                        <Input type="number" min="60" value={settingsDraft.policy.pairing_ttl_seconds} onChange={(event) => updatePolicy("pairing_ttl_seconds", Math.max(60, Number(event.target.value) || 60))} className="border-amber-900/10 bg-white/80 text-foreground" />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs text-stone-500">Max devices per session</span>
                        <Input type="number" min="1" value={settingsDraft.policy.max_devices_per_session} onChange={(event) => updatePolicy("max_devices_per_session", Math.max(1, Number(event.target.value) || 1))} className="border-amber-900/10 bg-white/80 text-foreground" />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs text-stone-500">Pairing rate limit / min</span>
                        <Input type="number" min="1" value={settingsDraft.policy.pairing_rate_limit_per_minute} onChange={(event) => updatePolicy("pairing_rate_limit_per_minute", Math.max(1, Number(event.target.value) || 1))} className="border-amber-900/10 bg-white/80 text-foreground" />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs text-stone-500">Admin rate limit / min</span>
                        <Input type="number" min="1" value={settingsDraft.policy.admin_rate_limit_per_minute} onChange={(event) => updatePolicy("admin_rate_limit_per_minute", Math.max(1, Number(event.target.value) || 1))} className="border-amber-900/10 bg-white/80 text-foreground" />
                      </label>
                    </div>
                  </div>

                  <Button onClick={handleSaveSettings} className="w-full bg-amber-500 text-white hover:bg-amber-600" disabled={saving}>
                    {saving ? "Saving changes..." : "Save settings"}
                  </Button>
                </div>
              </section>
            </aside>

            <section className="space-y-6">
              <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 text-emerald-600" />
                      <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Active sessions</p>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">Live pairings and connected devices</h2>
                  </div>
                  <span className="rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-stone-700">
                    {sessions.length} live
                  </span>
                </div>

                <div className="mt-5 grid gap-4">
                  {sessions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-amber-900/10 bg-amber-50/70 p-6 text-sm text-stone-600">
                      No active pairings right now.
                    </div>
                  ) : (
                    sessions.map((session) => {
                      const peers = session.peers || [];
                      return (
                        <article key={session.id} className="rounded-3xl border border-amber-900/10 bg-[#fff9f0] p-5 shadow-sm">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-amber-900/10 bg-stone-900 px-3 py-1 text-sm font-semibold tracking-[0.35em] text-white">{session.code}</span>
                                <span className={cn("rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.25em]", statusTone(session.status))}>
                                  {session.status}
                                </span>
                              </div>
                              <p className="text-sm text-stone-600">
                                Created by <span className="font-semibold text-foreground">{session.initiator.label || session.initiator.identifier}</span>
                              </p>
                              <div className="flex flex-wrap gap-3 text-xs text-stone-500">
                                <span className="inline-flex items-center gap-2 rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5">
                                  <Clock3 className="h-3.5 w-3.5" />
                                  Expires {formatDateTime(session.expires_at)}
                                </span>
                                <span className="inline-flex items-center gap-2 rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5">
                                  <Users className="h-3.5 w-3.5" />
                                  {session.device_count || peers.length + 1} devices
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button variant="destructive" size="sm" onClick={() => disconnectSession(session.id)}>
                                Disconnect session
                              </Button>
                            </div>
                          </div>

                          <div className="mt-4 space-y-3">
                            <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Connected devices</p>
                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900">
                                <Sparkles className="h-3.5 w-3.5" />
                                {session.initiator.label || session.initiator.identifier}
                              </span>
                              {peers.length === 0 ? (
                                <span className="rounded-full border border-amber-900/10 bg-white/80 px-3 py-2 text-xs text-muted-foreground">
                                  Waiting for another device
                                </span>
                              ) : (
                                peers.map((peer) => (
                                  <span key={peer.identifier} className="inline-flex items-center gap-2 rounded-full border border-amber-900/10 bg-white/80 px-3 py-2 text-xs text-stone-700">
                                    {peer.label || peer.identifier}
                                    <button
                                      type="button"
                                      onClick={() => disconnectPeer(session.id, peer.identifier)}
                                      className="rounded-full border border-amber-900/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-500 transition hover:border-red-400/30 hover:text-red-700"
                                    >
                                      Kick
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <BadgeAlert className="h-5 w-5 text-amber-600" />
                      <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Audit log</p>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">Every admin action, in order</h2>
                  </div>
                  <span className="rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-stone-700">
                    {auditLog.length} entries
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {auditLog.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-amber-900/10 bg-amber-50/70 p-6 text-sm text-stone-600">
                      No audit entries yet.
                    </div>
                  ) : (
                    auditLog.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-amber-900/10 bg-[#fff9f0] p-4 shadow-sm">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">{entry.actor}</span>
                              <span className="rounded-full border border-amber-900/10 bg-white/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-stone-600">
                                {entry.role}
                              </span>
                              <span className="rounded-full border border-amber-900/10 bg-white/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-stone-600">
                                {entry.action}
                              </span>
                              {entry.target && (
                                <span className="rounded-full border border-amber-900/10 bg-white/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-stone-600">
                                  {entry.target}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-stone-500">{formatDateTime(entry.timestamp)}</p>
                          </div>
                          <span className={cn("rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.25em]", entry.status === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900" : "border-red-400/20 bg-red-400/10 text-red-900")}>
                            {entry.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Admin;
