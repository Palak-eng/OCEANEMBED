"""
api/climatology.py

Service for loading the 30-year NOAA World Ocean Atlas (WOA) climatology
for the North Indian Ocean (5°N–30°N, 45°E–105°E) and computing:
1. Historical Climatological Normal temperatures per depth
2. Thermal Anomaly: ΔT = T_predicted - T_climatology
3. Oceanographic Anomaly Diagnostics (Marine Heatwaves vs Upwelling / Cold Eddies)
4. Ocean Layer categorization (Mixed Layer, Thermocline, Mesopelagic, Bathypelagic)
"""

import os
from datetime import datetime
from pathlib import Path
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
CLIMATOLOGY_FILE = BASE_DIR / "model" / "noaa_woa_nio_climatology.npz"

_CLIM_DATA = None
_MONTHS = None
_LATS = None
_LONS = None
_DEPTHS = None
_TEMPS = None


def _ensure_loaded():
    global _CLIM_DATA, _MONTHS, _LATS, _LONS, _DEPTHS, _TEMPS
    if _CLIM_DATA is not None:
        return

    if not CLIMATOLOGY_FILE.is_file():
        return

    data = np.load(CLIMATOLOGY_FILE, allow_pickle=True)
    _MONTHS = data["months"]
    _LATS = data["latitudes"]
    _LONS = data["longitudes"]
    _DEPTHS = data["depths"]
    _TEMPS = data["temperatures"]  # Shape: (12, len(lats), len(lons), len(depths))
    _CLIM_DATA = data


def get_climatology_profile(lat: float, lon: float, date_iso: str | None, depths: list[int]) -> dict[int, float]:
    """
    Returns a dictionary mapping {depth_m: climatology_temp_c} for the given
    coordinate, date (month), and requested depths.
    """
    _ensure_loaded()

    # Determine month (1-12)
    month = 9  # default September
    if date_iso:
        try:
            dt = datetime.fromisoformat(str(date_iso).replace("Z", "+00:00"))
            month = dt.month
        except Exception:
            try:
                parts = str(date_iso).split("-")
                if len(parts) >= 2:
                    month = int(parts[1])
            except Exception:
                month = 9

    if _TEMPS is None:
        # Fallback if file isn't available
        return {int(d): round(max(4.0, 28.0 - 0.022 * int(d)), 2) for d in depths}

    m_idx = int(np.clip(month - 1, 0, 11))
    lat_clamped = float(np.clip(lat, _LATS[0], _LATS[-1]))
    lon_clamped = float(np.clip(lon, _LONS[0], _LONS[-1]))

    # Bilinear interpolation indices
    lat_i0 = int(np.clip(np.searchsorted(_LATS, lat_clamped) - 1, 0, len(_LATS) - 2))
    lat_i1 = lat_i0 + 1
    lat_w1 = (lat_clamped - _LATS[lat_i0]) / (_LATS[lat_i1] - _LATS[lat_i0])
    lat_w0 = 1.0 - lat_w1

    lon_i0 = int(np.clip(np.searchsorted(_LONS, lon_clamped) - 1, 0, len(_LONS) - 2))
    lon_i1 = lon_i0 + 1
    lon_w1 = (lon_clamped - _LONS[lon_i0]) / (_LONS[lon_i1] - _LONS[lon_i0])
    lon_w0 = 1.0 - lon_w1

    # 4 grid corners
    t00 = _TEMPS[m_idx, lat_i0, lon_i0, :]
    t01 = _TEMPS[m_idx, lat_i0, lon_i1, :]
    t10 = _TEMPS[m_idx, lat_i1, lon_i0, :]
    t11 = _TEMPS[m_idx, lat_i1, lon_i1, :]

    # Interpolated profile at base depths
    clim_full_profile = (
        lat_w0 * lon_w0 * t00 +
        lat_w0 * lon_w1 * t01 +
        lat_w1 * lon_w0 * t10 +
        lat_w1 * lon_w1 * t11
    )

    base_depth_map = dict(zip(_DEPTHS, clim_full_profile))
    profile_out = {}
    for d in depths:
        d_val = float(d)
        if d_val in base_depth_map:
            val = float(base_depth_map[d_val])
        else:
            val = float(np.interp(d_val, _DEPTHS, clim_full_profile))
        profile_out[int(d_val)] = round(val, 2)

    return profile_out


def classify_thermal_anomaly(delta_t: float) -> dict:
    """
    Classifies the thermal anomaly ΔT into standard oceanographic alert categories.
    ΔT >= +1.0 °C: Subsurface Marine Heatwave
    +0.5 <= ΔT < +1.0 °C: Warm Anomaly
    -0.5 <= ΔT <= +0.5 °C: Climatological Normal
    -1.0 < ΔT <= -0.5 °C: Cool Anomaly
    ΔT <= -1.0 °C: Upwelling / Cold-Core Eddy
    """
    dt = round(float(delta_t), 2)
    sign = "+" if dt > 0 else ""
    formatted_dt = f"{sign}{dt:.2f} °C"

    if dt >= 1.0:
        return {
            "label": "Subsurface Marine Heatwave",
            "delta_str": formatted_dt,
            "badge_color": "red",
            "severity": "critical",
            "description": "Extreme warm anomaly: high risk to coral ecosystems and potential catalyst for tropical cyclone rapid intensification.",
        }
    elif dt >= 0.5:
        return {
            "label": "Warm Anomaly",
            "delta_str": formatted_dt,
            "badge_color": "amber",
            "severity": "warning",
            "description": "Moderate warm anomaly above 30-year NOAA normal baseline.",
        }
    elif dt >= -0.5:
        return {
            "label": "Climatological Normal",
            "delta_str": formatted_dt,
            "badge_color": "emerald",
            "severity": "normal",
            "description": "Within ±0.5 °C of 30-year NOAA WOA historical baseline.",
        }
    elif dt > -1.0:
        return {
            "label": "Cool Anomaly",
            "delta_str": formatted_dt,
            "badge_color": "sky",
            "severity": "cool",
            "description": "Moderate cool subsurface anomaly.",
        }
    else:
        return {
            "label": "Upwelling / Cold-Core Eddy",
            "delta_str": formatted_dt,
            "badge_color": "indigo",
            "severity": "upwelling",
            "description": "Strong subsurface cooling indicative of nutrient-rich coastal/equatorial upwelling or cyclonic eddy.",
        }


def get_ocean_layer(depth_m: int) -> dict:
    """Returns the biological and physical ocean layer classification for a depth."""
    d = int(depth_m)
    if d <= 50:
        return {
            "name": "Epipelagic (Surface Mixed Layer)",
            "zone": "Sunlight Zone (0–50 m)",
            "characteristic": "Solar heated, wind-mixed upper layer.",
        }
    elif d <= 200:
        return {
            "name": "Thermocline Zone",
            "zone": "Rapid Transition Zone (75–200 m)",
            "characteristic": "Steepest vertical temperature and density gradient.",
        }
    elif d <= 700:
        return {
            "name": "Mesopelagic (Intermediate Water)",
            "zone": "Twilight Zone (300–700 m)",
            "characteristic": "Oxygen minimum zone, minimal seasonal variation.",
        }
    else:
        return {
            "name": "Bathypelagic (Deep Ocean Baseline)",
            "zone": "Deep Ocean (>700 m)",
            "characteristic": "Cold, stable abyssal waters under immense pressure.",
        }
