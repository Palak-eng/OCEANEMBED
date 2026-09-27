"""
api/live_satellite.py

Near-Real-Time (NRT) Satellite & Marine Ingestion Service for OceanDepth AI.
Fetches 100% live data for all 7 surface channels — no hardcoded science values:
  - SST, currents (U/V), 10m winds (U/V): Open-Meteo Marine + Forecast (minutes lag)
  - SSS: NOAA CoastWatch SMAP Daily NRT (0.25 deg, ~1-3 day lag)
  - SLA: NOAA CoastWatch blended altimetry NRT (0.25 deg, ~2 day lag)
Climatological defaults are used ONLY as a fallback when a feed is unreachable,
and telemetry reports exactly which channels are live.
"""

import json
import math
import time
import urllib.request
from datetime import datetime

_ERDDAP_SSS_URL = (
    "https://coastwatch.noaa.gov/erddap/griddap/noaacwSMAPsssDaily.json"
    "?sss[(last)][(0.0)][({lat})][({lon})]"
)
_ERDDAP_SLA_URL = (
    "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsshDaily.json"
    "?sla[(last)][({lat})][({lon})]"
)


def _fetch_json(url: str, timeout: int):
    req = urllib.request.Request(url, headers={"User-Agent": "OceanDepthAI/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _erddap_last_value(payload: dict, var: str):
    """Extract (value, timestamp, lat, lon) from an ERDDAP .json table response."""
    try:
        table = payload.get("table", {})
        names = table.get("columnNames", [])
        rows = table.get("rows", [])
        if not rows:
            return None
        row = rows[-1]
        idx = names.index(var)
        value = row[idx]
        if value is None:
            return None
        ts = row[names.index("time")] if "time" in names else None
        lat = row[names.index("latitude")] if "latitude" in names else None
        lon = row[names.index("longitude")] if "longitude" in names else None
        return float(value), ts, lat, lon
    except Exception:
        return None


def fetch_live_surface(lat: float, lon: float) -> dict:
    """
    Fetches real-time marine and atmospheric satellite observations for any (lat, lon).
    Returns a normalized dictionary formatted for OceanEmbed v2:
        - sst: Sea Surface Temperature (°C)
        - sss: Sea Surface Salinity (PSU)
        - sla: Sea Level Anomaly (m)
        - ugos, vgos: Geostrophic Current components (m/s)
        - wind_u, wind_v: 10m Wind components (m/s)
        - telemetry: source, timestamp, latency_ms
    """
    t0 = time.time()
    lat = float(lat)
    lon = float(lon)

    # 1. Defaults / Climatological fallback in case of network timeout
    # Arabian Sea (lon < 77°) is saline (~36.0 PSU); Bay of Bengal is fresher (~32.5 PSU)
    default_sss = 36.0 if lon < 77.0 else 32.5
    surface = {
        "sst": 28.5,
        "sss": default_sss,
        "sla": 0.0,
        "ugos": 0.05,
        "vgos": -0.02,
        "wind_u": 4.0,
        "wind_v": -2.0,
    }
    telemetry = {
        "source": "Climatological Baseline (Fallback)",
        "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "latency_ms": 0,
        "is_live": False,
    }

    live_channels = []
    errors = {}
    try:
        # A. Query Marine Satellite Feed (SST, Wave Height, Currents) — live
        marine_url = (
            f"https://marine-api.open-meteo.com/v1/marine?"
            f"latitude={lat}&longitude={lon}&"
            f"current=sea_surface_temperature,wave_height,"
            f"ocean_current_velocity,ocean_current_direction"
        )
        marine_data = _fetch_json(marine_url, timeout=6)
        marine_current = marine_data.get("current", {}) or {}

        # Extract SST (live current value first, hourly fallback)
        sst_live = marine_current.get("sea_surface_temperature")
        if sst_live is None:
            hourly_sst = marine_data.get("hourly", {}).get("sea_surface_temperature", [])
            sst_live = hourly_sst[0] if hourly_sst else None
        if sst_live is not None:
            surface["sst"] = round(float(sst_live), 2)
            live_channels.append("sst")

        # Extract Currents (km/h -> m/s) and convert to U and V vectors — live
        if marine_current.get("ocean_current_velocity") is not None:
            curr_vel = float(marine_current.get("ocean_current_velocity")) / 3.6
            curr_dir = math.radians(float(marine_current.get("ocean_current_direction", 90.0) or 90.0))
            surface["ugos"] = round(curr_vel * math.sin(curr_dir), 3)
            surface["vgos"] = round(curr_vel * math.cos(curr_dir), 3)
            live_channels.extend(["ugos", "vgos"])
    except Exception as e:
        errors["open_meteo_marine"] = str(e)

    try:
        # B. Query Atmospheric Satellite Feed (10m Wind Speed & Direction) — live
        wind_url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}&"
            f"current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms"
        )
        wind_data = _fetch_json(wind_url, timeout=6)
        wind_current = wind_data.get("current", {}) or {}

        if wind_current.get("wind_speed_10m") is not None:
            # wind_speed_unit=ms already returns m/s — no conversion needed
            wind_spd = float(wind_current.get("wind_speed_10m"))
            wind_dir = math.radians(float(wind_current.get("wind_direction_10m", 270.0) or 270.0))
            # Meteorological vector convention (direction towards which wind blows):
            surface["wind_u"] = round(-wind_spd * math.sin(wind_dir), 2)
            surface["wind_v"] = round(-wind_spd * math.cos(wind_dir), 2)
            live_channels.extend(["wind_u", "wind_v"])
    except Exception as e:
        errors["open_meteo_wind"] = str(e)

    try:
        # C. Live Sea Surface Salinity from NOAA CoastWatch SMAP Daily NRT — live
        sss_data = _fetch_json(_ERDDAP_SSS_URL.format(lat=lat, lon=lon), timeout=8)
        sss_hit = _erddap_last_value(sss_data, "sss")
        if sss_hit is not None:
            sss_val, sss_ts, _, _ = sss_hit
            if 25.0 <= sss_val <= 40.0:
                surface["sss"] = round(sss_val, 2)
                live_channels.append("sss")
                telemetry["sss_observed_at"] = sss_ts
    except Exception as e:
        errors["noaa_smap_sss"] = str(e)

    try:
        # D. Live Sea Level Anomaly from NOAA blended altimetry NRT — live
        sla_data = _fetch_json(_ERDDAP_SLA_URL.format(lat=lat, lon=lon), timeout=8)
        sla_hit = _erddap_last_value(sla_data, "sla")
        if sla_hit is not None:
            sla_val, sla_ts, _, _ = sla_hit
            if -2.0 <= sla_val <= 2.0:
                surface["sla"] = round(sla_val, 3)
                live_channels.append("sla")
                telemetry["sla_observed_at"] = sla_ts
    except Exception as e:
        errors["noaa_altimetry_sla"] = str(e)

    latency = (time.time() - t0) * 1000
    telemetry["latency_ms"] = round(latency, 1)
    telemetry["live_channels"] = sorted(set(live_channels))
    telemetry["fallback_channels"] = sorted(
        c for c in ("sst", "sss", "sla", "ugos", "vgos", "wind_u", "wind_v")
        if c not in live_channels
    )
    if errors:
        telemetry["errors"] = errors

    if len(live_channels) >= 6:
        telemetry["source"] = (
            "Live: Open-Meteo (SST/currents/winds) + NOAA SMAP (SSS) + NOAA Altimetry (SLA)"
        )
        telemetry["is_live"] = True
    elif live_channels:
        telemetry["source"] = f"Partially live ({','.join(sorted(set(live_channels)))}) + climatology fallback"
        telemetry["is_live"] = True
    else:
        telemetry["source"] = "Climatological Baseline (Fallback)"
        telemetry["is_live"] = False

    return {
        "surface": surface,
        "telemetry": telemetry,
    }


def fetch_24h_history(lat: float, lon: float) -> dict:
    """
    Returns the last 24 hours of hourly live surface observations for one
    point, for scientist CSV export:
      hours: [{time, sst_c, ugos_ms, vgos_ms, wind_u_ms, wind_v_ms, wave_height_m}]
      plus latest live sss_psu / sla_m from NOAA NRT with observation dates.
    Open-Meteo hourly is same-day live; SSS/SLA are NRT (1-3 day lag).
    """
    t0 = time.time()
    lat = float(lat)
    lon = float(lon)
    errors = {}

    marine_url = (
        f"https://marine-api.open-meteo.com/v1/marine?"
        f"latitude={lat}&longitude={lon}&"
        f"hourly=sea_surface_temperature,wave_height,"
        f"ocean_current_velocity,ocean_current_direction&"
        f"past_days=1&forecast_days=1&cell_selection=sea"
    )
    wind_url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}&"
        f"hourly=wind_speed_10m,wind_direction_10m&"
        f"wind_speed_unit=ms&past_days=1&forecast_days=1"
    )

    try:
        marine = _fetch_json(marine_url, timeout=10)
    except Exception as e:
        errors["open_meteo_marine"] = str(e)
        marine = {}
    try:
        wind = _fetch_json(wind_url, timeout=10)
    except Exception as e:
        errors["open_meteo_wind"] = str(e)
        wind = {}

    m_hourly = (marine.get("hourly") or {}) if isinstance(marine, dict) else {}
    w_hourly = (wind.get("hourly") or {}) if isinstance(wind, dict) else {}
    m_time = m_hourly.get("time") or []
    n = len(m_time)

    def _col(d: dict, key: str):
        vals = d.get(key) or []
        return vals if len(vals) == n else [None] * n

    sst = _col(m_hourly, "sea_surface_temperature")
    wave = _col(m_hourly, "wave_height")
    cvel = _col(m_hourly, "ocean_current_velocity")
    cdir = _col(m_hourly, "ocean_current_direction")
    w_time = _col(w_hourly, "time")
    wspd = _col(w_hourly, "wind_speed_10m")
    wdir = _col(w_hourly, "wind_direction_10m")

    # Align wind series to marine timestamps when possible
    w_by_time = {t: i for i, t in enumerate(w_time) if t}
    hours = []
    start = max(0, n - 24)
    for i in range(start, n):
        t = m_time[i]
        cu = cvu = cvv = wu = wv = None
        try:
            if cvel[i] is not None and cdir[i] is not None:
                v = float(cvel[i]) / 3.6
                r = math.radians(float(cdir[i]))
                cu = round(v * math.sin(r), 3)
                cvv = round(v * math.cos(r), 3)
        except Exception:
            pass
        try:
            j = w_by_time.get(t, i if i < len(wspd) else None)
            if j is not None and wspd[j] is not None and wdir[j] is not None:
                s = float(wspd[j])
                r = math.radians(float(wdir[j]))
                wu = round(-s * math.sin(r), 2)
                wv = round(-s * math.cos(r), 2)
        except Exception:
            pass
        hours.append({
            "time": t,
            "sst_c": round(float(sst[i]), 2) if sst[i] is not None else None,
            "ugos_ms": cu,
            "vgos_ms": cvv,
            "wind_u_ms": wu,
            "wind_v_ms": wv,
            "wave_height_m": round(float(wave[i]), 2) if wave[i] is not None else None,
        })

    if not hours:
        errors["no_data"] = (
            "No hourly data returned for this point — it may be a land cell. "
            "Try a nearby ocean coordinate."
        )

    # Latest live SSS / SLA attached to every row on export
    sss_val = sss_ts = sla_val = sla_ts = None
    try:
        sss_hit = _erddap_last_value(
            _fetch_json(_ERDDAP_SSS_URL.format(lat=lat, lon=lon), timeout=8), "sss"
        )
        if sss_hit and 25.0 <= sss_hit[0] <= 40.0:
            sss_val, sss_ts = round(sss_hit[0], 2), sss_hit[1]
    except Exception as e:
        errors["noaa_smap_sss"] = str(e)
    try:
        sla_hit = _erddap_last_value(
            _fetch_json(_ERDDAP_SLA_URL.format(lat=lat, lon=lon), timeout=8), "sla"
        )
        if sla_hit and -2.0 <= sla_hit[0] <= 2.0:
            sla_val, sla_ts = round(sla_hit[0], 3), sla_hit[1]
    except Exception as e:
        errors["noaa_altimetry_sla"] = str(e)

    return {
        "location": {"latitude": lat, "longitude": lon},
        "hours": hours,
        "sss_psu": sss_val,
        "sss_observed_at": sss_ts,
        "sla_m": sla_val,
        "sla_observed_at": sla_ts,
        "sources": [
            "Open-Meteo Marine hourly (SST, currents, waves)",
            "Open-Meteo Forecast hourly (10 m winds)",
            "NOAA SMAP Daily NRT (SSS)",
            "NOAA Blended Altimetry NRT (SLA)",
        ],
        "latency_ms": round((time.time() - t0) * 1000, 1),
        "errors": errors,
    }