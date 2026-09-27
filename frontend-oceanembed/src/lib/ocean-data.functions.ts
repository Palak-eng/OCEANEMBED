import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BACKEND_BASE_URL = process.env["BACKEND_BASE_URL"] ?? "http://localhost:8000";

export interface HistoryHour {
  time: string;
  sst_c: number | null;
  ugos_ms: number | null;
  vgos_ms: number | null;
  wind_u_ms: number | null;
  wind_v_ms: number | null;
  wave_height_m: number | null;
}

export interface History24h {
  location: { latitude: number; longitude: number };
  hours: HistoryHour[];
  sss_psu: number | null;
  sss_observed_at: string | null;
  sla_m: number | null;
  sla_observed_at: string | null;
  sources: string[];
}

/**
 * GET /api/history/ — last 24h of hourly live surface data from Django,
 * which merges Open-Meteo hourly + NOAA NRT SSS/SLA. Used for scientist CSV export.
 */
export const getHistory24h = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => Point.parse(input))
  .handler(async ({ data }): Promise<History24h> => {
    const res = await fetch(
      `${BACKEND_BASE_URL}/api/history/?latitude=${data.lat}&longitude=${data.lon}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) throw new Error("History feed unavailable from backend.");
    return (await res.json()) as History24h;
  });

/**
 * Live surface-observation ingest.
 *
 * Pulls real, openly available ocean/atmosphere surface fields (SST, surface
 * currents, 10 m winds) from the Open-Meteo Marine + Forecast APIs and
 * harmonises them onto the project's 0.25 deg x 0.25 deg daily grid.
 */

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const snap = (v: number) => Math.round(v / 0.25) * 0.25;

export type LiveSurface = {
  gridLat: number;
  gridLon: number;
  observedAt: string | null;
  sst: number | null;
  sss: number | null;
  sssObservedAt: string | null;
  sla: number | null;
  slaObservedAt: string | null;
  currentU: number | null;
  currentV: number | null;
  currentSpeed: number | null;
  windU: number | null;
  windV: number | null;
  windSpeed: number | null;
  waveHeight: number | null;
  sstSeries: { day: string; temperature: number }[];
  sources: string[];
  error?: string;
};

function toUV(speed: number | null, directionDeg: number | null) {
  if (speed == null || directionDeg == null) return { u: null, v: null };
  const rad = (directionDeg * Math.PI) / 180;
  return { u: speed * Math.sin(rad), v: speed * Math.cos(rad) };
}

export const getLiveSurface = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => Point.parse(input))
  .handler(async ({ data }): Promise<LiveSurface> => {
    const gridLat = snap(data.lat);
    const gridLon = snap(data.lon);

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${gridLat}&longitude=${gridLon}` +
      "&current=sea_surface_temperature,ocean_current_velocity,ocean_current_direction,wave_height" +
      "&daily=sea_surface_temperature_max&past_days=21&forecast_days=1&cell_selection=sea";

    const airUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${gridLat}&longitude=${gridLon}` +
      "&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms";

    const sssUrl =
      `https://coastwatch.noaa.gov/erddap/griddap/noaacwSMAPsssDaily.json` +
      `?sss[(last)][(0.0)][(${gridLat})][(${gridLon})]`;
    const slaUrl =
      `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.json` +
      `?sla[(last)][(${gridLat})][(${gridLon})]`;

    const base: LiveSurface = {
      gridLat,
      gridLon,
      observedAt: null,
      sst: null,
      sss: null,
      sssObservedAt: null,
      sla: null,
      slaObservedAt: null,
      currentU: null,
      currentV: null,
      currentSpeed: null,
      windU: null,
      windV: null,
      windSpeed: null,
      waveHeight: null,
      sstSeries: [],
      sources: [
        "Open-Meteo Marine (SST, currents, waves)",
        "Open-Meteo Forecast (10 m winds)",
        "NOAA SMAP Daily NRT (SSS)",
        "NOAA Blended Altimetry NRT (SLA)",
      ],
    };

    function erddapLast(
      body: unknown,
      variable: string,
    ): { value: number | null; time: string | null } {
      try {
        const table = (body as { table?: { columnNames?: string[]; rows?: unknown[][] } }).table;
        const names = table?.columnNames ?? [];
        const rows = table?.rows ?? [];
        if (!rows.length) return { value: null, time: null };
        const last = rows[rows.length - 1] as unknown[];
        const vIdx = names.indexOf(variable);
        const tIdx = names.indexOf("time");
        const raw = vIdx >= 0 ? (last[vIdx] as number | null) : null;
        const ts = tIdx >= 0 ? (last[tIdx] as string | null) : null;
        return {
          value: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
          time: typeof ts === "string" ? ts : null,
        };
      } catch {
        return { value: null, time: null };
      }
    }

    try {
      const [marineRes, airRes, sssRes, slaRes] = await Promise.all([
        fetch(marineUrl),
        fetch(airUrl),
        fetch(sssUrl).catch(() => null),
        fetch(slaUrl).catch(() => null),
      ]);
      if (!marineRes.ok) throw new Error(`Marine feed ${marineRes.status}`);
      const marine = (await marineRes.json()) as {
        current?: {
          time?: string;
          sea_surface_temperature?: number | null;
          ocean_current_velocity?: number | null;
          ocean_current_direction?: number | null;
          wave_height?: number | null;
        };
        daily?: { time?: string[]; sea_surface_temperature_max?: (number | null)[] };
      };
      const air = airRes.ok
        ? ((await airRes.json()) as {
            current?: { wind_speed_10m?: number | null; wind_direction_10m?: number | null };
          })
        : {};

      const speedKmh = marine.current?.ocean_current_velocity ?? null;
      const currentSpeed = speedKmh == null ? null : speedKmh / 3.6;
      const cur = toUV(currentSpeed, marine.current?.ocean_current_direction ?? null);
      const windSpeed = air.current?.wind_speed_10m ?? null;
      const wind = toUV(windSpeed, air.current?.wind_direction_10m ?? null);

      const days = marine.daily?.time ?? [];
      const maxes = marine.daily?.sea_surface_temperature_max ?? [];
      const sstSeries = days
        .map((d, i) => ({ day: d, temperature: maxes[i] ?? null }))
        .filter((r): r is { day: string; temperature: number } => r.temperature != null)
        .map((r) => ({
          day: new Date(r.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
          temperature: Number(r.temperature.toFixed(2)),
        }));

      const sssLive =
        sssRes && sssRes.ok ? erddapLast(await sssRes.json().catch(() => null), "sss") : { value: null, time: null };
      const slaLive =
        slaRes && slaRes.ok ? erddapLast(await slaRes.json().catch(() => null), "sla") : { value: null, time: null };

      return {
        ...base,
        observedAt: marine.current?.time ?? null,
        sst: marine.current?.sea_surface_temperature ?? null,
        sss:
          sssLive.value != null && sssLive.value >= 25 && sssLive.value <= 40
            ? Number(sssLive.value.toFixed(2))
            : null,
        sssObservedAt: sssLive.time,
        sla:
          slaLive.value != null && slaLive.value >= -2 && slaLive.value <= 2
            ? Number(slaLive.value.toFixed(3))
            : null,
        slaObservedAt: slaLive.time,
        currentU: cur.u,
        currentV: cur.v,
        currentSpeed,
        windU: wind.u,
        windV: wind.v,
        windSpeed,
        waveHeight: marine.current?.wave_height ?? null,
        sstSeries,
      };
    } catch (error) {
      return {
        ...base,
        error: error instanceof Error ? error.message : "Live surface feed unavailable",
      };
    }
  });
