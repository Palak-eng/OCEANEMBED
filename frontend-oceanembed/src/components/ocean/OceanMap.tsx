import { Crosshair, Minus, Plus, Navigation } from "lucide-react";
import { useRef, useState } from "react";
import heatmap from "@/assets/ocean-heatmap.jpg";
import { HeatmapCanvas } from "@/components/ocean/HeatmapCanvas";
import { REGION, reconstruct } from "@/lib/ocean-model";
import { cn } from "@/lib/utils";
import type { ArgoBenchmarkFloat } from "@/lib/django.functions";

type Props = {
  lat: number;
  lon: number;
  depth: number;
  onPick: (lat: number, lon: number) => void;
  className?: string | undefined;
  argoFloats?: ArgoBenchmarkFloat[] | undefined;
  selectedFloatId?: string | undefined;
  onSelectFloat?: ((fl: ArgoBenchmarkFloat) => void) | undefined;
};

const SCALE_TICKS = [32, 28, 24, 20, 16, 12, 8, 4];

export function OceanMap({
  lat,
  lon,
  depth,
  onPick,
  className,
  argoFloats,
  selectedFloatId,
  onSelectFloat,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  const x = ((lon - REGION.lonMin) / (REGION.lonMax - REGION.lonMin)) * 100;
  const y = ((REGION.latMax - lat) / (REGION.latMax - REGION.latMin)) * 100;
  const reading = reconstruct(lat, lon).levels.find((l) => l.depth === depth);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    onPick(
      Number((REGION.latMax - py * (REGION.latMax - REGION.latMin)).toFixed(1)),
      Number((REGION.lonMin + px * (REGION.lonMax - REGION.lonMin)).toFixed(1)),
    );
  }

  return (
    <div className={cn("flex gap-3", className)}>
      <div
        ref={ref}
        onClick={handleClick}
        className="relative flex-1 cursor-crosshair overflow-hidden rounded-lg border border-border"
      >
        <div
          className="relative size-full origin-center transition-transform duration-300"
          style={{ transform: `scale(${zoom})` }}
        >
          <img
            src={heatmap}
            alt=""
            aria-hidden
            width={1200}
            height={912}
            className="absolute inset-0 size-full object-cover"
          />
          <HeatmapCanvas depth={depth} className="absolute inset-0 opacity-60" />
        </div>

        <div className="pointer-events-none absolute inset-0 bg-background/10" />

        <div className="absolute left-3 top-3 flex flex-col overflow-hidden rounded-md border border-border bg-panel backdrop-blur">
          {[
            { icon: Plus, action: () => setZoom((z) => Math.min(2.2, z + 0.2)), key: "in" },
            { icon: Minus, action: () => setZoom((z) => Math.max(1, z - 0.2)), key: "out" },
            { icon: Crosshair, action: () => setZoom(1), key: "reset" },
          ].map(({ icon: Icon, action, key }) => (
            <button
              key={key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                action();
              }}
              className="border-b border-border p-2 text-muted-foreground transition-colors last:border-0 hover:bg-secondary hover:text-foreground"
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>

        {/* ARGO Float Ground-Truth Pins */}
        {argoFloats?.map((fl) => {
          const flX = ((fl.longitude - REGION.lonMin) / (REGION.lonMax - REGION.lonMin)) * 100;
          const flY = ((REGION.latMax - fl.latitude) / (REGION.latMax - REGION.latMin)) * 100;
          const isSelected = fl.float_id === selectedFloatId;

          return (
            <div
              key={fl.float_id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectFloat?.(fl);
              }}
              className="group absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-20"
              style={{ left: `${flX}%`, top: `${flY}%` }}
              title={`ARGO Float #${fl.float_id} (${fl.region})`}
            >
              <div className="relative flex items-center justify-center">
                {isSelected && (
                  <span className="absolute size-8 animate-ping rounded-full bg-amber-400/40" />
                )}
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border shadow-lg transition-transform hover:scale-125",
                    isSelected
                      ? "border-amber-300 bg-amber-500 text-black shadow-amber-500/50"
                      : "border-cyan-300 bg-cyan-600/90 text-white shadow-cyan-500/40"
                  )}
                >
                  <Navigation className="size-3.5 rotate-45" />
                </span>
                <span
                  className={cn(
                    "absolute left-7 top-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[0.65rem] font-bold shadow backdrop-blur transition-opacity",
                    isSelected
                      ? "bg-amber-500/90 text-black opacity-100"
                      : "bg-black/75 text-cyan-200 opacity-80 group-hover:opacity-100"
                  )}
                >
                  #{fl.float_id}
                </span>
              </div>
            </div>
          );
        })}

        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${x}%`, top: `${y}%` }}
        >
          <span className="block size-4 rounded-full border-2 border-foreground bg-foreground/25 shadow-[0_0_0_6px_oklch(1_0_0_/_12%)]" />
        </div>

        <div
          className="pointer-events-none absolute max-w-[13rem] translate-x-4 -translate-y-1/2 rounded-md border border-border bg-panel p-2 text-xs leading-relaxed backdrop-blur"
          style={{
            left: `${Math.min(x, 62)}%`,
            top: `${Math.min(Math.max(y, 12), 88)}%`,
          }}
        >
          <p className="text-muted-foreground">
            Lat <span className="text-foreground">{lat.toFixed(1)}° N</span>
          </p>
          <p className="text-muted-foreground">
            Lon <span className="text-foreground">{lon.toFixed(1)}° E</span>
          </p>
          <p className="text-muted-foreground">
            Temp ({depth} m){" "}
            <span className="font-semibold text-accent">{reading?.temperature.toFixed(1)} °C</span>
          </p>
        </div>
      </div>

      <div className="flex w-16 flex-col items-center gap-2 py-1">
        <span className="label-caps text-[0.6rem] leading-tight">Temp °C</span>
        <div className="flex flex-1 gap-1">
          <div className="temp-scale w-4 rounded-sm border border-border" />
          <div className="flex flex-col justify-between text-[0.65rem] text-muted-foreground">
            {SCALE_TICKS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
