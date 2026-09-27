import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BACKEND_BASE_URL = process.env["BACKEND_BASE_URL"] ?? "http://localhost:8000";

const authedFetch = (path: string, accessToken: string, init?: RequestInit) =>
  fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(60000),
  });

/**
 * Calamity / disaster watch for the North Indian Ocean.
 *
 * Live surface observations (Open-Meteo Marine + Forecast) are screened against
 * operational-style thresholds. Any triggered condition is stored once per
 * region per day in public.disaster_alerts and pushed to every signed-in user
 * who opted in.
 */

export const WATCH_POINTS = [
  { region: "Bay of Bengal (central)", lat: 15.2, lon: 88.6 },
  { region: "Bay of Bengal (head)", lat: 20.5, lon: 88.0 },
  { region: "Arabian Sea (east)", lat: 18.2, lon: 70.5 },
  { region: "Arabian Sea (west)", lat: 14.0, lon: 60.0 },
  { region: "Andaman Sea", lat: 11.5, lon: 94.0 },
  { region: "Lakshadweep Sea", lat: 9.5, lon: 74.0 },
] as const;

type Reading = {
  region: string;
  lat: number;
  lon: number;
  sst: number | null;
  windSpeed: number | null;
  waveHeight: number | null;
  currentSpeed: number | null;
};

type Trigger = {
  kind: string;
  severity: "watch" | "warning" | "severe";
  headline: string;
  detail: string;
};

const snap = (v: number) => Math.round(v / 0.25) * 0.25;

async function readPoint(p: { region: string; lat: number; lon: number }): Promise<Reading> {
  const lat = snap(p.lat);
  const lon = snap(p.lon);
  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    "&current=sea_surface_temperature,ocean_current_velocity,wave_height&cell_selection=sea";
  const airUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=wind_speed_10m&wind_speed_unit=ms";

  const empty: Reading = {
    region: p.region,
    lat,
    lon,
    sst: null,
    windSpeed: null,
    waveHeight: null,
    currentSpeed: null,
  };

  try {
    const [m, a] = await Promise.all([fetch(marineUrl), fetch(airUrl)]);
    const marine = m.ok
      ? ((await m.json()) as {
          current?: {
            sea_surface_temperature?: number | null;
            ocean_current_velocity?: number | null;
            wave_height?: number | null;
          };
        })
      : {};
    const air = a.ok
      ? ((await a.json()) as { current?: { wind_speed_10m?: number | null } })
      : {};
    const velKmh = marine.current?.ocean_current_velocity ?? null;
    return {
      ...empty,
      sst: marine.current?.sea_surface_temperature ?? null,
      waveHeight: marine.current?.wave_height ?? null,
      currentSpeed: velKmh == null ? null : velKmh / 3.6,
      windSpeed: air.current?.wind_speed_10m ?? null,
    };
  } catch {
    return empty;
  }
}

function evaluate(r: Reading): Trigger[] {
  const out: Trigger[] = [];
  const where = `${r.lat.toFixed(2)}°N, ${r.lon.toFixed(2)}°E`;

  if (r.sst != null && r.sst >= 31) {
    out.push({
      kind: "marine_heatwave",
      severity: r.sst >= 32 ? "severe" : "warning",
      headline: `Marine heatwave conditions in the ${r.region}`,
      detail: `Sea surface temperature has reached ${r.sst.toFixed(1)} °C at ${where}. Sustained values above 31 °C deepen the warm layer, suppress mixing and raise coral-bleaching and fish-mortality risk.`,
    });
  } else if (r.sst != null && r.sst >= 30) {
    out.push({
      kind: "warm_pool_watch",
      severity: "watch",
      headline: `Warm pool building in the ${r.region}`,
      detail: `Sea surface temperature is ${r.sst.toFixed(1)} °C at ${where} — warm enough to fuel rapid cyclone intensification if a system develops.`,
    });
  }

  if (r.windSpeed != null && r.windSpeed >= 17) {
    out.push({
      kind: "cyclonic_winds",
      severity: r.windSpeed >= 25 ? "severe" : "warning",
      headline: `Cyclone-strength winds over the ${r.region}`,
      detail: `10 m winds of ${r.windSpeed.toFixed(1)} m/s (${(r.windSpeed * 3.6).toFixed(0)} km/h) observed at ${where}. Strong wind stress drives storm surge, upwelling and dangerous seas.`,
    });
  }

  if (r.waveHeight != null && r.waveHeight >= 3) {
    out.push({
      kind: "high_seas",
      severity: r.waveHeight >= 4.5 ? "severe" : "warning",
      headline: `High seas in the ${r.region}`,
      detail: `Significant wave height of ${r.waveHeight.toFixed(1)} m at ${where}. Small craft and fishing operations are unsafe in these conditions.`,
    });
  }

  return out;
}

export interface DjangoSubscription {
  email: string;
  region: string;
  lat: number;
  lon: number;
  enabled: boolean;
}

export interface DjangoAlert {
  id: number;
  severity: string;
  headline: string;
  detail: string;
  created_at: string;
}

/** Read the signed-in user's alert preferences from Django (Gmail-backed). */
export const getMyAlertSubscription = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ accessToken: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<DjangoSubscription | null> => {
    const res = await authedFetch("/api/alerts/mine/", data.accessToken);
    if (!res.ok) throw new Error("Could not load your alert settings.");
    const body = (await res.json()) as { subscription: DjangoSubscription | null };
    return body.subscription;
  });

/** Opt in / update where the user wants to be warned about (Django + Gmail). */
export const saveAlertSubscription = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        accessToken: z.string().min(1),
        region: z.string().min(2).max(80),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const path = data.enabled ? "/api/alerts/subscribe/" : "/api/alerts/unsubscribe/";
    const res = await authedFetch(path, data.accessToken, {
      method: "POST",
      body: JSON.stringify(
        data.enabled
          ? { latitude: data.lat, longitude: data.lon }
          : { latitude: data.lat, longitude: data.lon },
      ),
    });
    if (!res.ok) throw new Error("Could not save your alert settings.");
    return { ok: true };
  });

/** Alert mails Django recently sent to the caller, newest first. */
export const listAlerts = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ accessToken: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<DjangoAlert[]> => {
    const res = await authedFetch("/api/alerts/recent/", data.accessToken);
    if (!res.ok) throw new Error("Could not load alert history.");
    const body = (await res.json()) as { alerts: DjangoAlert[] };
    return body.alerts;
  });

/** Live surface snapshot of every watch point (no writes). */
export const getWatchBoard = createServerFn({ method: "GET" }).handler(async () => {
  const readings = await Promise.all(WATCH_POINTS.map(readPoint));
  return readings.map((r) => ({ ...r, triggers: evaluate(r) }));
});

export interface DisasterScanResult {
  scanned: number;
  created: number;
  recipients: number;
  newAlerts: { headline: string; region: string; severity: string }[];
  emailReady: boolean;
}

/**
 * Screen every watch point with LIVE data and Gmail subscribers via Django.
 * Deduplicated per user + cell + event per 24h — safe to call repeatedly.
 */
export const runDisasterScan = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ accessToken: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<DisasterScanResult> => {
    const res = await authedFetch("/api/alerts/scan/", data.accessToken, { method: "POST" });
    if (!res.ok) throw new Error("Scan failed — try again in a moment");
    return (await res.json()) as DisasterScanResult;
  });
