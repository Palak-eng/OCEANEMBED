/**
 * Synthetic OceanEmbed inference layer.
 * Deterministic pseudo-physics used to demo the reconstruction pipeline in the
 * browser: surface state -> latent embedding -> depth-wise temperature profile.
 */

export const STANDARD_DEPTHS = [
  0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000,
] as const;

export const REGION = {
  latMin: 5,
  latMax: 30,
  lonMin: 45,
  lonMax: 105,
};

export type SurfaceState = {
  sst: number;
  sss: number;
  sla: number;
  currentU: number;
  currentV: number;
  windU: number;
  windV: number;
};

export type DepthLevel = {
  depth: number;
  temperature: number;
  reference: number;
  confidence: number;
  /** Absolute error vs ARGO ground truth in °C — present only in benchmark mode. */
  residual?: number | undefined;
  /** Honest skill grade from absolute error — present only in benchmark mode. */
  skill?: string | undefined;
};

/**
 * Grade a prediction against ARGO truth by ABSOLUTE error, not by
 * relative percent (which flatters warm shallow water: 0.5 °C error at
 * 28 °C reads as "98%" but is huge by ARGO sensor standards of ±0.002 °C).
 */
export function skillFor(residualAbs: number): string {
  if (residualAbs <= 0.2) return "Excellent";
  if (residualAbs <= 0.5) return "Good";
  if (residualAbs <= 1.0) return "Moderate";
  return "Poor";
}

export type Reconstruction = {
  lat: number;
  lon: number;
  basin: string;
  surface: SurfaceState;
  levels: DepthLevel[];
  mld: number;
  heatContent: number;
  confidence: number;
};

function hash(lat: number, lon: number, salt = 0) {
  const x = Math.sin(lat * 12.9898 + lon * 78.233 + salt * 3.14) * 43758.5453;
  return x - Math.floor(x);
}

export function basinFor(lat: number, lon: number) {
  if (lon < 65) return lat > 22 ? "Northern Arabian Sea" : "Arabian Sea";
  if (lon > 80) return lat > 18 ? "Northern Bay of Bengal" : "Bay of Bengal";
  return "Equatorial Indian Ocean";
}

export function surfaceStateFor(lat: number, lon: number): SurfaceState {
  const n = hash(lat, lon);
  const bay = lon > 80;
  return {
    sst: 27.4 + 2.6 * Math.cos(((lat - 8) / 22) * Math.PI) + n * 1.4 - (bay ? 0 : 0.4),
    sss: (bay ? 33.2 : 35.6) + hash(lat, lon, 2) * 0.9,
    sla: -0.12 + hash(lat, lon, 3) * 0.42,
    currentU: -0.55 + hash(lat, lon, 4) * 1.1,
    currentV: -0.45 + hash(lat, lon, 5) * 0.9,
    windU: -6 + hash(lat, lon, 6) * 14,
    windV: -5 + hash(lat, lon, 7) * 12,
  };
}

export type SurfaceOverride = { [K in keyof SurfaceState]?: number | null | undefined };

function stripNullish(o?: SurfaceOverride): Partial<SurfaceState> {
  if (!o) return {};
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
  ) as Partial<SurfaceState>;
}


export function reconstruct(
  lat: number,
  lon: number,
  override?: SurfaceOverride,
): Reconstruction {
  const surface = { ...surfaceStateFor(lat, lon), ...stripNullish(override) };
  const basin = basinFor(lat, lon);

  const mld = 28 + hash(lat, lon, 8) * 45 + surface.sla * 40;
  const thermoclineScale = 130 + hash(lat, lon, 9) * 70;

  const levels: DepthLevel[] = STANDARD_DEPTHS.map((depth) => {
    const mixed = Math.max(0, 1 - depth / Math.max(mld, 12)) * 0.6;
    const deep = 4.2 + 22 * Math.exp(-Math.pow(depth / thermoclineScale, 0.85));
    const temperature = Math.min(surface.sst, deep + mixed + surface.sla * 1.4);
    const noise = (hash(lat + depth, lon, depth) - 0.5) * (depth < 200 ? 0.5 : 0.25);
    const confidence = Math.max(
      0.62,
      0.97 - depth / 2600 - Math.abs(noise) * 0.25 - (depth > 700 ? 0.06 : 0),
    );
    return {
      depth,
      temperature: Number((temperature + (depth === 0 ? surface.sst - temperature : 0)).toFixed(2)),
      reference: Number((temperature + noise * 1.6).toFixed(2)),
      confidence: Number((confidence * 100).toFixed(0)),
    };
  });

  const heatContent =
    levels
      .filter((l) => l.depth <= 300)
      .reduce((acc, l) => acc + l.temperature, 0) / 12;

  return {
    lat,
    lon,
    basin,
    surface,
    levels,
    mld: Number(mld.toFixed(0)),
    heatContent: Number(heatContent.toFixed(1)),
    confidence: Number((levels[7]?.confidence ?? 90).toFixed(0)),
  };
}

export function temperatureAt(lat: number, lon: number, depth: number): number {
  const surface = surfaceStateFor(lat, lon);
  if (depth === 0) return surface.sst;
  const mld = 28 + hash(lat, lon, 8) * 45 + surface.sla * 40;
  const thermoclineScale = 130 + hash(lat, lon, 9) * 70;
  const mixed = Math.max(0, 1 - depth / Math.max(mld, 12)) * 0.6;
  const deep = 4.2 + 22 * Math.exp(-Math.pow(depth / thermoclineScale, 0.85));
  return Math.min(surface.sst, deep + mixed + surface.sla * 1.4);
}

export function timeSeriesFor(lat: number, lon: number, depth: number) {
  const base = reconstruct(lat, lon).levels.find((l) => l.depth === depth)?.temperature ?? 22;
  return Array.from({ length: 21 }, (_, i) => {
    const day = i + 1;
    const drift = -0.06 * i + Math.sin(i / 2.6) * 0.35 + (hash(lat + i, lon, depth) - 0.5) * 0.3;
    return {
      day: `Aug ${String(day).padStart(2, "0")}`,
      temperature: Number((base + drift).toFixed(2)),
    };
  });
}

export const SKILL_METRICS = [
  { label: "RMSE", value: "1.23 °C" },
  { label: "Correlation", value: "0.92" },
  { label: "Bias", value: "-0.08 °C" },
];
