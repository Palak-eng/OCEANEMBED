import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BellRing, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/ocean/TopNav";
import { Panel } from "@/components/ocean/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  WATCH_POINTS,
  getMyAlertSubscription,
  getWatchBoard,
  listAlerts,
  runDisasterScan,
  saveAlertSubscription,
} from "@/lib/alerts.functions";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Disaster Alerts — OceanEmbed" },
      {
        name: "description",
        content:
          "Automatic marine heatwave, cyclone-wind and high-seas alerts for the North Indian Ocean, emailed to signed-in users the moment thresholds are crossed.",
      },
      { property: "og:title", content: "Disaster Alerts — OceanEmbed" },
      {
        property: "og:description",
        content:
          "Live calamity watch across the Bay of Bengal and Arabian Sea with email notifications for subscribers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AlertsPage,
});

const SEVERITY: Record<string, string> = {
  watch: "bg-primary/25 text-foreground",
  warning: "bg-yellow-400/25 text-foreground",
  severe: "bg-destructive/30 text-foreground",
};

function AlertsPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState<string>(WATCH_POINTS[0]!.region);
  const [enabled, setEnabled] = useState(true);
  const qc = useQueryClient();

  const fetchSub = useServerFn(getMyAlertSubscription);
  const fetchAlerts = useServerFn(listAlerts);
  const scan = useServerFn(runDisasterScan);
  const save = useServerFn(saveAlertSubscription);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      setAccessToken(data.session?.access_token ?? null);
      if (data.session?.user.email) setEmail((e) => e || data.session!.user.email!);
    });
  }, []);

  const board = useQuery({
    queryKey: ["watch-board"],
    queryFn: () => getWatchBoard(),
    staleTime: 10 * 60 * 1000,
  });

  const sub = useQuery({
    queryKey: ["alert-sub"],
    queryFn: () => fetchSub({ data: { accessToken: accessToken! } }),
    enabled: signedIn === true && !!accessToken,
  });

  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => fetchAlerts({ data: { accessToken: accessToken! } }),
    enabled: signedIn === true && !!accessToken,
  });

  useEffect(() => {
    const saved = sub.data;
    if (saved) {
      setEmail(saved.email);
      // Django stores coordinates — snap back to the nearest watch region.
      const nearest = WATCH_POINTS.reduce((best, w) => {
        const d = Math.hypot(w.lat - saved.lat, w.lon - saved.lon);
        const bd = Math.hypot(best.lat - saved.lat, best.lon - saved.lon);
        return d < bd ? w : best;
      });
      setRegion(nearest.region);
      setEnabled(saved.enabled);
    }
  }, [sub.data]);

  const saving = useMutation({
    mutationFn: () => {
      const p = WATCH_POINTS.find((w) => w.region === region) ?? WATCH_POINTS[0]!;
      return save({
        data: { accessToken: accessToken!, region, lat: p.lat, lon: p.lon, enabled },
      });
    },
    onSuccess: () => {
      toast.success(enabled ? "You're on the alert list" : "Alerts paused");
      qc.invalidateQueries({ queryKey: ["alert-sub"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save your alert settings"),
  });

  const scanning = useMutation({
    mutationFn: () => scan({ data: { accessToken: accessToken! } }),
    onSuccess: (r) => {
      toast.success(
        r.created > 0
          ? `${r.created} new alert${r.created > 1 ? "s" : ""} issued to ${r.recipients} subscriber${r.recipients === 1 ? "" : "s"}`
          : "All watch points are within safe limits",
      );
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["watch-board"] });
    },
    onError: () => toast.error("Scan failed — try again in a moment"),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <div className="panel-surface flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive/25 text-destructive-foreground">
            <BellRing className="size-5" />
          </span>
          <div className="mr-auto">
            <h1 className="font-display text-2xl font-bold">Calamity &amp; disaster alerts</h1>
            <p className="text-sm text-muted-foreground">
              Marine heatwaves, cyclone-strength winds and high seas across the North Indian Ocean —
              checked against live observations and emailed to subscribers.
            </p>
          </div>
          <Button
            className="gap-2"
            disabled={!signedIn || scanning.isPending}
            onClick={() => scanning.mutate()}
          >
            <RefreshCw className={`size-4 ${scanning.isPending ? "animate-spin" : ""}`} /> Run check
            now
          </Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel
            title="Live watch board"
            subtitle="Six sentinel cells on the 0.25° grid"
            bodyClassName="p-0"
          >
            <div className="divide-y divide-border">
              {board.isLoading && (
                <p className="p-4 text-sm text-muted-foreground">Reading live observations…</p>
              )}
              {board.data?.map((r) => (
                <div key={r.region} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
                  <div className="min-w-44">
                    <p className="font-medium">{r.region}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.lat.toFixed(2)}°N, {r.lon.toFixed(2)}°E
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>SST {r.sst != null ? `${r.sst.toFixed(1)} °C` : "—"}</span>
                    <span>
                      Wind {r.windSpeed != null ? `${r.windSpeed.toFixed(1)} m/s` : "—"}
                    </span>
                    <span>
                      Waves {r.waveHeight != null ? `${r.waveHeight.toFixed(1)} m` : "—"}
                    </span>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {r.triggers.length === 0 ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-lime/20 px-2.5 py-1 text-xs">
                        <ShieldCheck className="size-3.5" /> Normal
                      </span>
                    ) : (
                      r.triggers.map((t) => (
                        <span
                          key={t.kind}
                          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${SEVERITY[t.severity]}`}
                        >
                          <AlertTriangle className="size-3.5" /> {t.kind.replace(/_/g, " ")}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Email me alerts" subtitle="Signed-in users only">
            {signedIn === false ? (
              <p className="text-sm text-muted-foreground">
                Sign in to subscribe to disaster alerts for your region.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="alert-email">Email address</Label>
                  <Input
                    id="alert-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gmail.com"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Region to watch</Label>
                  <Select value={region} onValueChange={setRegion}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WATCH_POINTS.map((w) => (
                        <SelectItem key={w.region} value={w.region}>
                          {w.region}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2">
                  <span className="text-sm">Send me emails</span>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>
                <Button
                  className="gap-2"
                  disabled={saving.isPending || !email}
                  onClick={() => saving.mutate()}
                >
                  <Mail className="size-4" /> Save alert settings
                </Button>
                <p className="text-xs text-muted-foreground">
                  Thresholds: sea surface temperature ≥ 31 °C (marine heatwave), 10 m wind ≥ 17 m/s
                  (cyclone strength), significant wave height ≥ 3 m (high seas).
                </p>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Issued alerts" subtitle="Newest first, one per hazard per region per day">
          {signedIn === false ? (
            <p className="text-sm text-muted-foreground">Sign in to see the alert history.</p>
          ) : alerts.data && alerts.data.length > 0 ? (
            <div className="flex flex-col gap-3">
              {alerts.data.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${SEVERITY[a.severity]}`}
                    >
                      {a.severity}
                    </span>
                    <p className="font-display text-base">{a.headline}</p>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(a.created_at).toUTCString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{a.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No alerts recorded yet. Run a check to screen the watch points now.
            </p>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
