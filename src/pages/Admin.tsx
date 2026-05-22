import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeAlert, Clock3, LogOut, RefreshCw, Shield, ShieldCheck, Sparkles, Users } from "lucide-react";
import BackgroundEffects from "@/components/BackgroundEffects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type AdminDashboard, type AdminSettingsUpdate, type AdminUser, type RuntimeConfig } from "@/lib/api";
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
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
      const response = await api.adminLogin(loginEmail.trim(), password);
      localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setPassword("");
      await loadDashboard(response.token);
      toast.success(`Signed in as ${response.user.email || response.user.display_name || response.user.username}`);
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
        <main className="relative z-10 mx-auto flex min-h-screen max-w-4xl items-center px-4 py-10">
          <div className="w-full">
            <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-8 shadow-[0_25px_80px_rgba(120,75,18,0.10)] backdrop-blur-xl">
              <div className="flex flex-col items-center gap-3 text-stone-600">
                <Shield className="h-5 w-5 text-amber-600" />
                <span className="text-xs uppercase tracking-[0.35em]">Admin Access</span>
              </div>
              <h1 className="mt-5 text-4xl font-black tracking-tight text-foreground text-center">Nexdrop Control Room</h1>
              <p className="mt-4 text-sm leading-6 text-muted-foreground text-center max-w-2xl mx-auto">
                Manage maintenance mode, feature flags, session limits, and audit trails from one place.
              </p>

              {error && (
                <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-900 max-w-md mx-auto">
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="mt-8 space-y-4 max-w-md mx-auto">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Email Address</label>
                  <Input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} type="email" className="border-amber-900/10 bg-white/80 text-foreground placeholder:text-muted-foreground" placeholder="nexdrop.team@gmail.com" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Password</label>
                  <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="border-amber-900/10 bg-white/80 text-foreground placeholder:text-muted-foreground" placeholder="••••••••" />
                </div>
                <div className="flex flex-col items-center gap-3 pt-2">
                  <Button type="submit" disabled={loginPending} className="bg-amber-500 text-white hover:bg-amber-600 w-full">
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {loginPending ? "Signing in..." : "Sign in"}
                  </Button>
                  <div className="flex w-full justify-end">
                    <Button type="button" variant="link" className="h-auto px-0 text-stone-600 hover:text-amber-700" onClick={() => navigate("/admin/forgot-password")}>
                      Forgot password?
                    </Button>
                  </div>
                  <Button type="button" variant="ghost" className="text-stone-600 hover:bg-amber-100/70 hover:text-stone-900" onClick={() => navigate("/")}>Return home</Button>
                </div>
              </form>
            </section>
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
          {/* Header */}
          <header className="flex flex-col gap-4 rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-3 text-stone-600">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
                <span className="text-xs uppercase tracking-[0.35em]">Admin Console</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-foreground">Nexdrop Control Room</h1>
              <p className="max-w-2xl truncate text-sm leading-6 text-muted-foreground" title={`Signed in as ${currentUser.display_name || currentUser.email || currentUser.username} with ${currentUser.role} permissions.`}>
                Signed in as <span className="font-semibold text-foreground">{currentUser.display_name || currentUser.email || currentUser.username}</span> with <span className="font-semibold text-foreground">{currentUser.role}</span> permissions.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <span className="rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-stone-700">
                Updated {formatDateTime(dashboard.settings.updated_at)}
              </span>
              {currentUser.role === "owner" && (
                <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => setShowCreateModal(true)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Add Admin
                </Button>
              )}
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

          {/* Admin User Management - Owner Only */}
          {currentUser.role === "owner" && (
            <AdminUserManagement
              token={token}
              showCreateModal={showCreateModal}
              onCloseCreateModal={() => setShowCreateModal(false)}
            />
          )}

          {/* Main content grid */}
          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            {/* Sidebar - Settings */}
            <aside className="space-y-6">
              <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 shrink-0 text-amber-600" />
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Maintenance</p>
                    <h2 className="truncate text-lg font-semibold text-foreground">Mode and policy</h2>
                  </div>
                </div>

                <div className="mt-5 space-y-5">
                  {/* Maintenance Mode */}
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

                  {/* Feature Flags */}
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
                              "flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition",
                              toggleTone(enabled),
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">{label}</span>
                              <span className="block text-xs text-muted-foreground">{enabled ? "Enabled" : "Disabled"}</span>
                            </span>
                            <span className="shrink-0 rounded-full border border-current px-2.5 py-1 text-[10px] uppercase tracking-[0.25em]">
                              {enabled ? "On" : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Policy Limits */}
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

            {/* Main Content */}
            <section className="space-y-6 min-w-0">
              {/* Active Sessions */}
              <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 shrink-0 text-emerald-600" />
                      <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Active sessions</p>
                    </div>
                    <h2 className="mt-2 truncate text-xl font-semibold text-foreground">Live pairings and connected devices</h2>
                  </div>
                  <span className="shrink-0 rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-stone-700">
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
                            <div className="min-w-0 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-amber-900/10 bg-stone-900 px-3 py-1 text-sm font-semibold tracking-[0.35em] text-white">{session.code}</span>
                                <span className={cn("rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.25em]", statusTone(session.status))}>
                                  {session.status}
                                </span>
                              </div>
                              <p className="truncate text-sm text-stone-600" title={`Created by ${session.initiator.label || session.initiator.identifier}`}>
                                Created by <span className="font-semibold text-foreground">{session.initiator.label || session.initiator.identifier}</span>
                              </p>
                              <div className="flex flex-wrap gap-3 text-xs text-stone-500">
                                <span className="inline-flex items-center gap-2 rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5">
                                  <Clock3 className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">Expires {formatDateTime(session.expires_at)}</span>
                                </span>
                                <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5">
                                  <Users className="h-3.5 w-3.5 shrink-0" />
                                  {session.device_count || peers.length + 1} devices
                                </span>
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button variant="destructive" size="sm" onClick={() => disconnectSession(session.id)}>
                                Disconnect session
                              </Button>
                            </div>
                          </div>

                          <div className="mt-4 space-y-3">
                            <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Connected devices</p>
                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900">
                                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate" title={session.initiator.label || session.initiator.identifier}>{session.initiator.label || session.initiator.identifier}</span>
                              </span>
                              {peers.length === 0 ? (
                                <span className="rounded-full border border-amber-900/10 bg-white/80 px-3 py-2 text-xs text-muted-foreground">
                                  Waiting for another device
                                </span>
                              ) : (
                                peers.map((peer) => (
                                  <span key={peer.identifier} className="inline-flex max-w-full items-center gap-2 rounded-full border border-amber-900/10 bg-white/80 px-3 py-2 text-xs text-stone-700">
                                    <span className="truncate" title={peer.label || peer.identifier}>{peer.label || peer.identifier}</span>
                                    <button
                                      type="button"
                                      onClick={() => disconnectPeer(session.id, peer.identifier)}
                                      className="shrink-0 rounded-full border border-amber-900/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-500 transition hover:border-red-400/30 hover:text-red-700"
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

              {/* Audit Log */}
              <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <BadgeAlert className="h-5 w-5 shrink-0 text-amber-600" />
                      <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Audit log</p>
                    </div>
                    <h2 className="mt-2 truncate text-xl font-semibold text-foreground">Every admin action, in order</h2>
                  </div>
                  <span className="shrink-0 rounded-full border border-amber-900/10 bg-white/80 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-stone-700">
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
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold text-foreground" title={entry.actor}>{entry.actor}</span>
                              <span className="shrink-0 rounded-full border border-amber-900/10 bg-white/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-stone-600">
                                {entry.role}
                              </span>
                              <span className="shrink-0 rounded-full border border-amber-900/10 bg-white/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-stone-600">
                                {entry.action}
                              </span>
                              {entry.target && (
                                <span className="max-w-[150px] truncate rounded-full border border-amber-900/10 bg-white/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-stone-600" title={entry.target}>
                                  {entry.target}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-stone-500">{formatDateTime(entry.timestamp)}</p>
                          </div>
                          <span className={cn("shrink-0 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.25em]", entry.status === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900" : "border-red-400/20 bg-red-400/10 text-red-900")}>
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

// ============================================================================
// Admin User Management Component - Owner Only
// ============================================================================

interface AdminUserManagementProps {
  token: string;
  showCreateModal: boolean;
  onCloseCreateModal: () => void;
}

const AdminUserManagement = ({ token, showCreateModal, onCloseCreateModal }: AdminUserManagementProps) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEditModal, setShowEditModal] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state for create
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"viewer" | "operator" | "admin">("viewer");
  const [newDisplayName, setNewDisplayName] = useState("");

  // Form state for edit
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"viewer" | "operator" | "admin" | "owner">("viewer");
  const [editDisplayName, setEditDisplayName] = useState("");

  useEffect(() => {
    void loadUsers();
  }, [token]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listAdminUsers(token);
      setUsers(data.filter((u) => u.username !== "owner")); // Hide owner from list
    } catch (err) {
      console.error(err);
      setError("Failed to load users");
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    setError(null);
    try {
      await api.createAdminUser(token, {
        username: newUsername.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
        display_name: newDisplayName || undefined,
      });
      toast.success(`User '${newUsername}' created successfully`);
      onCloseCreateModal();
      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("viewer");
      setNewDisplayName("");
      await loadUsers();
    } catch (err) {
      console.error(err);
      setError("Failed to create user");
      toast.error("Failed to create user");
    }
  };

  const handleUpdateUser = async () => {
    if (!showEditModal) return;
    setError(null);
    try {
      await api.updateAdminUser(token, showEditModal, {
        email: editEmail,
        role: editRole,
        display_name: editDisplayName || undefined,
      });
      toast.success(`User '${showEditModal}' updated successfully`);
      setShowEditModal(null);
      await loadUsers();
    } catch (err) {
      console.error(err);
      setError("Failed to update user");
      toast.error("Failed to update user");
    }
  };

  const handleDeleteUser = async () => {
    if (!showDeleteModal) return;
    setError(null);
    try {
      await api.deleteAdminUser(token, showDeleteModal);
      toast.success(`User '${showDeleteModal}' deleted successfully`);
      setShowDeleteModal(null);
      await loadUsers();
    } catch (err) {
      console.error(err);
      setError("Failed to delete user");
      toast.error("Failed to delete user");
    }
  };

  const openEditModal = (user: AdminUser) => {
    setEditEmail(user.email || "");
    setEditRole(user.role);
    setEditDisplayName(user.display_name || "");
    setShowEditModal(user.username);
  };

  const openDeleteModal = (username: string) => {
    setShowDeleteModal(username);
  };

  return (
    <section className="rounded-[2rem] border border-amber-900/10 bg-white/80 p-6 shadow-[0_20px_70px_rgba(120,75,18,0.08)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-xl font-semibold text-foreground">Manage admin accounts</h2>
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 shrink-0 text-blue-600" />
            <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Admin Users</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="mt-5">
        {loading ? (
          <div className="flex items-center justify-center gap-3 text-stone-600 py-8">
            <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
            <span className="text-sm">Loading users...</span>
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-blue-900/10 bg-blue-50/70 p-8 text-center">
            <Users className="h-8 w-8 text-blue-400 mx-auto mb-3" />
            <p className="text-sm text-stone-600 mb-4">No admin users yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <div key={user.username} className="rounded-2xl border border-blue-900/10 bg-[#f0f9ff] p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-foreground" title={user.display_name || user.username}>{user.display_name || user.username}</span>
                      <span className="shrink-0 rounded-full border border-blue-900/10 bg-white px-2.5 py-0.5 text-[10px] uppercase tracking-[0.25em] text-stone-600">
                        {user.role}
                      </span>
                    </div>
                    {user.email && (
                      <p className="truncate text-xs text-stone-500" title={user.email}>{user.email}</p>
                    )}
                    {user.last_login_at && (
                      <p className="text-xs text-stone-500">
                        Last login: {formatDateTime(user.last_login_at)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEditModal(user)}>
                      Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => openDeleteModal(user.username)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <ModalOverlay onClose={onCloseCreateModal}>
          <div className="my-auto flex w-full max-w-md max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-blue-900/20 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <ModalHeader title="Create Admin User" description="Add a new admin to your system" onClose={onCloseCreateModal} />
            
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <FormField label="Username *">
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="border-blue-900/10 bg-white"
                  placeholder="admin_username"
                  required
                />
              </FormField>
              <FormField label="Email *">
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="border-blue-900/10 bg-white"
                  placeholder="admin@example.com"
                  type="email"
                  required
                />
              </FormField>
              <FormField label="Password *">
                <Input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  type="password"
                  className="border-blue-900/10 bg-white"
                  placeholder="••••••••"
                  required
                />
              </FormField>
              <FormField label="Role *">
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "viewer" | "operator" | "admin")}
                  className="w-full rounded-xl border border-blue-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400/50"
                >
                  <option value="viewer">Viewer - Read-only access</option>
                  <option value="operator">Operator - Can manage sessions</option>
                  <option value="admin">Admin - Can manage settings</option>
                </select>
              </FormField>
              <FormField label="Display Name (optional)">
                <Input
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="border-blue-900/10 bg-white"
                  placeholder="John Doe"
                />
              </FormField>
            </div>

            <ModalFooter>
              <Button onClick={onCloseCreateModal} variant="outline" className="flex-1">
                Cancel
              </Button>
              <Button 
                onClick={handleCreateUser} 
                className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                disabled={!newUsername || !newEmail || !newPassword}
              >
                Create User
              </Button>
            </ModalFooter>
          </div>
        </ModalOverlay>
      )}

      {/* Edit User Modal */}
      {showEditModal && (
        <ModalOverlay onClose={() => setShowEditModal(null)}>
          <div className="my-auto flex w-full max-w-md max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-blue-900/20 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <ModalHeader title={`Edit User: ${showEditModal}`} description="Update user details" onClose={() => setShowEditModal(null)} />
            
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <FormField label="Email *">
                <Input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="border-blue-900/10 bg-white"
                  placeholder="admin@example.com"
                  type="email"
                  required
                />
              </FormField>
              <FormField label="Role *">
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as "viewer" | "operator" | "admin" | "owner")}
                  className="w-full rounded-xl border border-blue-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400/50"
                >
                  <option value="viewer">Viewer - Read-only access</option>
                  <option value="operator">Operator - Can manage sessions</option>
                  <option value="admin">Admin - Can manage settings</option>
                  <option value="owner">Owner - Full access (cannot change)</option>
                </select>
                <p className="text-[10px] text-red-500 mt-1">Note: Owner role cannot be changed</p>
              </FormField>
              <FormField label="Display Name (optional)">
                <Input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="border-blue-900/10 bg-white"
                  placeholder="John Doe"
                />
              </FormField>
            </div>

            <ModalFooter>
              <Button onClick={() => setShowEditModal(null)} variant="outline" className="flex-1">
                Cancel
              </Button>
              <Button 
                onClick={handleUpdateUser} 
                className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                disabled={!editEmail}
              >
                Save Changes
              </Button>
            </ModalFooter>
          </div>
        </ModalOverlay>
      )}

      {/* Delete User Modal */}
      {showDeleteModal && (
        <ModalOverlay onClose={() => setShowDeleteModal(null)}>
          <div className="flex w-full max-w-md max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-red-900/20 bg-white shadow-2xl">
            <ModalHeader title="Delete User" description={`Are you sure you want to delete user '${showDeleteModal}'?`} onClose={() => setShowDeleteModal(null)} />
            
            <ModalFooter>
              <Button onClick={() => setShowDeleteModal(null)} variant="outline" className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleDeleteUser} variant="destructive" className="flex-1">
                Delete Permanently
              </Button>
            </ModalFooter>
          </div>
        </ModalOverlay>
      )}
    </section>
  );
};

// ============================================================================
// Shared UI Components for Modals
// ============================================================================

interface ModalOverlayProps {
  children: React.ReactNode;
  onClose: () => void;
}

const ModalOverlay = ({ children, onClose }: ModalOverlayProps) => (
  <div 
    className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-6"
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    {children}
  </div>
);

interface ModalHeaderProps {
  title: string;
  description?: string;
  onClose: () => void;
}

const ModalHeader = ({ title, description, onClose }: ModalHeaderProps) => (
  <div className="flex items-start justify-between border-b border-blue-900/10 px-6 py-4">
    <div className="min-w-0 pr-4">
      <h3 className="truncate text-lg font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 truncate text-sm text-muted-foreground">{description}</p>}
    </div>
    <button
      onClick={onClose}
      className="shrink-0 text-gray-400 hover:text-gray-600 text-lg leading-none"
      aria-label="Close"
    >
      ×
    </button>
  </div>
);

interface FormFieldProps {
  label: string;
  children: React.ReactNode;
}

const FormField = ({ label, children }: FormFieldProps) => (
  <div className="space-y-2">
    <label className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{label}</label>
    {children}
  </div>
);

interface ModalFooterProps {
  children: React.ReactNode;
}

const ModalFooter = ({ children }: ModalFooterProps) => (
  <div className="border-t border-blue-900/10 px-6 py-4">
    <div className="flex gap-3">
      {children}
    </div>
  </div>
);

export default Admin;