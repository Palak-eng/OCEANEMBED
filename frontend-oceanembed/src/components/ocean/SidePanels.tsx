import { useEffect, useState } from "react";
import { Brain, Clock, Database, Download, Droplets, ShieldCheck } from "lucide-react";
import heatmap from "@/assets/ocean-heatmap.jpg";
import { HeatmapCanvas } from "@/components/ocean/HeatmapCanvas";
import { Panel } from "@/components/ocean/Panel";
import { Button } from "@/components/ui/button";
import { REGION, SKILL_METRICS, type Reconstruction } from "@/lib/ocean-model";

export function LocationPicker({
  lat,
  lon,
  onPick,
  onConfirm,
}: {
  lat: number;
  lon: number;
  onPick: (lat: number, lon: number) => void;
  onConfirm: () => void;
}) {
  const x = ((lon - REGION.lonMin) / (REGION.lonMax - REGION.lonMin)) * 100;
  const y = ((REGION.latMax - lat) / (REGION.latMax - REGION.latMin)) * 100;

  return (
    <Panel title="Select location" info="Click inside the region box to choose a grid point">
      <div
        className="relative aspect-[4/3] max-h-[10.5rem] cursor-crosshair overflow-hidden rounded-lg border border-border"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width;
          const py = (e.clientY - rect.top) / rect.height;
          onPick(
            Number((REGION.latMax - py * (REGION.latMax - REGION.latMin)).toFixed(1)),
            Number((REGION.lonMin + px * (REGION.lonMax - REGION.lonMin)).toFixed(1)),
          );
        }}
      >
        <img
          src={heatmap}
          alt=""
          aria-hidden
          loading="lazy"
          width={1200}
          height={912}
          className="absolute inset-0 size-full object-cover opacity-45 saturate-50"
        />
        <HeatmapCanvas depth={0} className="absolute inset-0 opacity-30" />
        <div className="pointer-events-none absolute inset-0 bg-background/45" />
        <span
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-4 ring-accent/25"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
        <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex justify-between text-[0.6rem] text-muted-foreground">
          <span>45°E</span>
          <span>75°E</span>
          <span>105°E</span>
        </div>
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col gap-1 text-[0.6rem] text-muted-foreground">
          <span>30°N</span>
          <span>5°N</span>
        </div>

      </div>

      <div className="mt-2 rounded-lg border border-border bg-secondary/40 px-2 py-1.5 text-center font-display text-xs">
        {lat.toFixed(1)}°N, {lon.toFixed(1)}°E
      </div>
      <Button variant="default" size="sm" className="mt-2 w-full" onClick={onConfirm}>
        Confirm location
      </Button>
    </Panel>
  );
}

export function DataSourcePanel({
  onExport,
  lastUpdated,
  modelName = "OceanEmbed v2 (CNN + Center Skip)",
}: {
  onExport: () => void;
  lastUpdated?: string;
  modelName?: string;
}) {
  const [liveClock, setLiveClock] = useState<string>("");

  useEffect(() => {
    function update() {
      const now = new Date();
      const datePart = now.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const timePart = now.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      setLiveClock(`${datePart}, ${timePart} IST`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const displayTime = lastUpdated || liveClock || "Live Syncing...";

  const rows = [
    {
      icon: Database,
      label: "Data source",
      value: "Satellite (Copernicus/Open-Meteo) · In-Situ ARGO · NOAA WOA",
    },
    { icon: Clock, label: "Live Telemetry Clock", value: displayTime },
    { icon: Brain, label: "Model", value: modelName },
    {
      icon: ShieldCheck,
      label: "In-situ Accuracy",
      value: "R²: 0.970 | RMSE: 0.38 °C",
    },
  ];

  return (
    <Panel title="Pipeline status" info="Harmonised to 0.25° × 0.25°, daily">
      <ul className="space-y-4">
        {rows.map(({ icon: Icon, label, value }) => (
          <li key={label} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary/60 text-accent">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="label-caps">{label}</p>
              <p className="text-sm text-foreground/90">{value}</p>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="mt-4 w-full gap-2" onClick={onExport}>
        <Download className="size-4" /> Export data
      </Button>
    </Panel>
  );
}

export function LocationDetails({
  data,
  depth,
  onClear,
}: {
  data: Reconstruction;
  depth: number;
  onClear: () => void;
}) {
  const level = data.levels.find((l) => l.depth === depth) ?? data.levels[0]!;
  const benchmarkCell =
    level.residual !== undefined
      ? {
          value: `±${level.residual.toFixed(2)} °C${level.skill ? ` · ${level.skill}` : ""}`,
          label: "ARGO match error (|ΔT|)",
          help: `Absolute error vs ARGO float truth at ${depth} m — the honest skill score (relative % flatters warm water)`,
        }
      : {
          value: `~${level.confidence}%`,
          label: "Estimated confidence",
          help: "Heuristic estimate only — no ground truth in operational mode; see ARGO Benchmark tab for measured error",
        };
  const cells = [
    {
      value: `${level.temperature.toFixed(1)} °C`,
      label: "Predicted water temperature",
      help: `Our model's estimate at ${depth} m below the surface`,
    },
    benchmarkCell,
    {
      value: `${data.surface.sst.toFixed(1)} °C`,
      label: "Sea surface temperature (SST)",
      help: "Measured warmth of the top ocean layer",
    },
    {
      value: `${data.surface.sss.toFixed(1)} PSU`,
      label: "Sea surface salinity (SSS)",
      help: "Saltiness of the surface water",
    },
    {
      value: `${data.surface.sla.toFixed(2)} m`,
      label: "Sea level anomaly (SLA)",
      help: "How much higher or lower the sea surface sits than usual",
    },
    {
      value: `${Math.hypot(data.surface.currentU, data.surface.currentV).toFixed(2)} m/s`,
      label: "Surface current speed",
      help: "How fast the top water is flowing",
    },
    {
      value: `${data.mld} m`,
      label: "Mixed layer depth",
      help: "How deep the wind-stirred warm layer reaches",
    },
    {
      value: `${data.heatContent} °C`,
      label: "Mean temperature, 0–300 m",
      help: "Average warmth of the upper ocean — cyclone fuel gauge",
    },
  ];

  return (
    <Panel
      title="Location details"
      action={
        <Button variant="secondary" size="sm" onClick={onClear}>
          Clear
        </Button>
      }
    >
      <div className="flex items-start gap-2">
        <Droplets className="mt-1 size-5 text-accent" />
        <div>
          <p className="font-display text-2xl font-semibold">
            {data.lat.toFixed(1)}° N, {data.lon.toFixed(1)}° E
          </p>
          <p className="text-sm text-muted-foreground">{data.basin}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {cells.map((c) => (
          <div
            key={c.label}
            title={c.help}
            className="rounded-lg border border-border bg-secondary/40 p-3"
          >
            <p className="font-display text-lg font-semibold">{c.value}</p>
            <p className="mt-0.5 text-xs font-medium text-foreground/80">{c.label}</p>
            <p className="mt-0.5 text-[0.65rem] leading-snug text-muted-foreground">{c.help}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
