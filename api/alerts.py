"""
api/alerts.py

Gmail calamity-alert system for OceanDepth AI.

When the model + NOAA climatology detect a dangerous ocean event at a
location — a subsurface marine heatwave (anomaly >= +1.0 C, severity
"critical") or strong upwelling / cold-core eddy (severity "upwelling") —
every logged-in subscriber watching nearby waters gets a Gmail alert.

Design notes:
- Detection reuses the enriched predictions already built by
  `predict_temperature` (they carry `anomaly_severity`, `anomaly_c`,
  `depth_m`), so alerting costs zero extra model calls.
- Sending uses Django's SMTP backend (Gmail App Password, see BACKEND_API.md).
  If Gmail is not configured the functions return False and the API keeps
  working — alerts never break predictions.
- `AlertLog` dedupes: max 1 email per user + event type + rounded cell/day.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import AlertLog, AlertSubscription

logger = logging.getLogger(__name__)

# Only shallow layers can trigger a calamity mail — a deep-only anomaly is
# scientifically interesting but not an imminent surface disaster.
CALAMITY_MAX_DEPTH_M = 100

# Cool-down: never mail the same user about the same cell+event twice in 24h.
ALERT_COOLDOWN_HOURS = 24

# Sentinel watch cells for the daily cron scan (ecologically sensitive NIO zones).
SENTINEL_CELLS = [
    (21.5, 62.0, "Northern Arabian Sea"),
    (15.0, 65.0, "Central Arabian Sea"),
    (10.0, 73.0, "Laccadive Basin / Sri Lanka Dome"),
    (6.0, 85.0, "Equatorial Indian Ocean"),
    (12.0, 88.0, "Central Bay of Bengal"),
    (19.0, 89.0, "Northern Bay of Bengal"),
]

# Fast surface-threshold watch board (same cells as the frontend alerts page).
# Thresholds mirror the page copy: SST >= 31 C heatwave, wind >= 17 m/s
# cyclone strength, significant wave height >= 3 m high seas.
SCAN_POINTS = [
    {"region": "Bay of Bengal (central)", "lat": 15.2, "lon": 88.6},
    {"region": "Bay of Bengal (head)", "lat": 20.5, "lon": 88.0},
    {"region": "Arabian Sea (east)", "lat": 18.2, "lon": 70.5},
    {"region": "Arabian Sea (west)", "lat": 14.0, "lon": 60.0},
    {"region": "Andaman Sea", "lat": 11.5, "lon": 94.0},
    {"region": "Lakshadweep Sea", "lat": 9.5, "lon": 74.0},
]


def evaluate_surface_triggers(surface: dict) -> list[dict]:
    """Surface-threshold triggers from one live surface dict (no model needed)."""
    triggers = []
    try:
        sst = surface.get("sst")
        if sst is not None and float(sst) >= 31:
            triggers.append({
                "kind": "marine_heatwave",
                "event_type": "heatwave",
                "severity": "severe" if float(sst) >= 32 else "warning",
                "headline": f"Marine heatwave conditions (SST {float(sst):.1f} C)",
                "detail": f"Sea surface temperature reached {float(sst):.1f} C. "
                          f"Sustained values above 31 C raise coral-bleaching and "
                          f"fish-mortality risk.",
            })
    except (TypeError, ValueError):
        pass
    try:
        wu = surface.get("wind_u")
        wv = surface.get("wind_v")
        if wu is not None and wv is not None:
            import math
            spd = math.hypot(float(wu), float(wv))
            if spd >= 17:
                triggers.append({
                    "kind": "cyclonic_winds",
                    "event_type": "cyclonic_winds",
                    "severity": "severe" if spd >= 25 else "warning",
                    "headline": f"Cyclone-strength winds ({spd:.1f} m/s)",
                    "detail": f"10 m winds of {spd:.1f} m/s drive storm surge, "
                              f"upwelling and dangerous seas.",
                })
    except (TypeError, ValueError):
        pass
    return triggers


def email_configured() -> bool:
    return bool(settings.EMAIL_HOST_USER and settings.EMAIL_HOST_PASSWORD)


def detect_calamity(predictions: list[dict]) -> dict | None:
    """Return the worst calamity event in enriched predictions, or None.

    Expected input: items with `depth_m`, `anomaly_c`, `anomaly_severity`,
    `anomaly_label`, `temperature_c`, `climatology_c`.
    """
    worst = None
    for item in predictions or []:
        try:
            depth = int(item.get("depth_m", 9999))
        except (TypeError, ValueError):
            continue
        if depth > CALAMITY_MAX_DEPTH_M:
            continue
        severity = str(item.get("anomaly_severity") or "")
        if severity == "critical":
            event_type = "heatwave"
        elif severity == "upwelling":
            event_type = "upwelling"
        else:
            continue
        try:
            anomaly = float(item.get("anomaly_c", 0.0))
        except (TypeError, ValueError):
            anomaly = 0.0
        score = abs(anomaly)
        if worst is None or score > worst["score"]:
            worst = {
                "score": score,
                "event_type": event_type,
                "depth_m": depth,
                "anomaly_c": round(anomaly, 2),
                "temperature_c": item.get("temperature_c"),
                "climatology_c": item.get("climatology_c"),
                "label": item.get("anomaly_label", event_type),
                "description": item.get("anomaly_description", ""),
            }
    if worst is not None:
        worst.pop("score", None)
    return worst


def _cooldown_key(email: str, event: dict, lat: float, lon: float) -> dict:
    return {
        "email": email,
        "event_type": event["event_type"],
        "latitude": round(float(lat), 1),
        "longitude": round(float(lon), 1),
        "sent_at__gte": timezone.now() - timedelta(hours=ALERT_COOLDOWN_HOURS),
    }


def already_alerted(email: str, event: dict, lat: float, lon: float) -> bool:
    return AlertLog.objects.filter(**_cooldown_key(email, event, lat, lon)).exists()


def compose_email(event: dict, lat: float, lon: float, date_iso: str | None) -> tuple[str, str]:
    if event["event_type"] == "heatwave":
        subject = (
            f"OceanDepth ALERT: Subsurface Marine Heatwave "
            f"({event['anomaly_c']:+.2f} C) near {lat:.1f}N, {lon:.1f}E"
        )
        body = (
            f"Dear scientist,\n\n"
            f"OceanDepth AI detected a SUBSURFACE MARINE HEATWAVE at "
            f"{lat:.1f}N, {lon:.1f}E (date: {date_iso or 'today'}).\n\n"
            f"- Strongest anomaly: {event['anomaly_c']:+.2f} C at {event['depth_m']} m "
            f"(predicted {event['temperature_c']} C vs 30-year NOAA normal "
            f"{event['climatology_c']} C)\n"
            f"- Classification: {event['label']}\n"
            f"- {event['description']}\n\n"
            f"Possible impacts: coral bleaching risk, fishery shifts, and rapid "
            f"intensification fuel if a tropical cyclone passes over this cell.\n\n"
            f"Open your dashboard to inspect the full temperature profile and "
            f"download the last 24h of live surface data.\n\n"
            f"— OceanDepth AI calamity watch\n"
            f"(You receive this because you are subscribed to alerts. "
            f"Unsubscribe anytime via POST /api/alerts/unsubscribe/.)"
        )
    else:
        subject = (
            f"OceanDepth WATCH: Strong Upwelling / Cold Eddy "
            f"({event['anomaly_c']:+.2f} C) near {lat:.1f}N, {lon:.1f}E"
        )
        body = (
            f"Dear scientist,\n\n"
            f"OceanDepth AI detected strong subsurface cooling (upwelling / "
            f"cold-core eddy) at {lat:.1f}N, {lon:.1f}E (date: {date_iso or 'today'}).\n\n"
            f"- Strongest anomaly: {event['anomaly_c']:+.2f} C at {event['depth_m']} m "
            f"(predicted {event['temperature_c']} C vs 30-year NOAA normal "
            f"{event['climatology_c']} C)\n"
            f"- Classification: {event['label']}\n"
            f"- {event['description']}\n\n"
            f"Nutrient-rich upwelled water often boosts productivity — worth a "
            f"look for fishery and biogeochemistry teams.\n\n"
            f"— OceanDepth AI calamity watch\n"
            f"(Unsubscribe anytime via POST /api/alerts/unsubscribe/.)"
        )
    return subject, body


def send_calamity_email(to_email: str, event: dict, lat: float, lon: float,
                        date_iso: str | None = None) -> bool:
    """Send one alert mail. Returns True if sent (or skipped as duplicate)."""
    if already_alerted(to_email, event, lat, lon):
        return True
    if not email_configured():
        logger.warning("Calamity detected but Gmail SMTP is not configured; skipping mail.")
        return False
    subject, body = compose_email(event, lat, lon, date_iso)
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to_email], fail_silently=False)
    except Exception:
        logger.exception("Failed to send calamity alert to %s", to_email)
        return False
    AlertLog.objects.create(
        email=to_email,
        event_type=event["event_type"],
        latitude=round(float(lat), 1),
        longitude=round(float(lon), 1),
        max_anomaly_c=event["anomaly_c"],
    )
    return True


def requester_email(request) -> str | None:
    """Email of the logged-in caller (Supabase JWT claim preferred)."""
    claims = getattr(request, "supabase_claims", None) or {}
    email = (claims.get("email") or "").strip()
    if email:
        return email
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        return (getattr(user, "email", "") or "").strip() or None
    return None


def maybe_alert_requesting_user(request, lat: float, lon: float,
                                predictions: list[dict], date_iso: str | None = None) -> dict | None:
    """Email the logged-in user who just queried, if their cell is calamitous.

    Never raises — alerting must not break the prediction response.
    Returns the event dict if an alert was sent (or skipped as duplicate).
    """
    try:
        event = detect_calamity(predictions)
        if event is None:
            return None
        email = requester_email(request)
        if not email:
            return None
        # Respect explicit opt-out: a matching inactive subscription blocks mail.
        existing = AlertSubscription.objects.filter(
            email__iexact=email, active=False,
            latitude__gte=float(lat) - 5.0, latitude__lte=float(lat) + 5.0,
            longitude__gte=float(lon) - 5.0, longitude__lte=float(lon) + 5.0,
        ).first()
        if existing is not None:
            return None
        if event["event_type"] == "upwelling":
            # Upwelling watch mails go only to users who asked for them.
            wanted = AlertSubscription.objects.filter(
                email__iexact=email, active=True, alert_upwelling=True,
            ).exists()
            if not wanted:
                return event
        sent = send_calamity_email(email, event, lat, lon, date_iso)
        event["alert_sent"] = sent
        event["alert_to"] = email
        return event
    except Exception:
        logger.exception("Calamity alert hook failed silently.")
        return None


def compose_surface_email(kind: str, headline: str, detail: str,
                           lat: float, lon: float, region: str) -> tuple[str, str]:
    subject = f"OceanDepth ALERT: {headline} — {region} ({lat:.1f}N, {lon:.1f}E)"
    body = (
        f"Dear scientist,\n\n"
        f"OceanDepth AI live watch detected an event at {region} "
        f"({lat:.1f}N, {lon:.1f}E):\n\n"
        f"- {headline}\n"
        f"- {detail}\n\n"
        f"Open your dashboard to inspect live conditions and download the "
        f"last 24h of surface data.\n\n"
        f"— OceanDepth AI calamity watch\n"
        f"(Unsubscribe anytime via POST /api/alerts/unsubscribe/.)"
    )
    return subject, body


def send_surface_email(to_email: str, kind: str, event_type: str, headline: str,
                       detail: str, lat: float, lon: float, region: str,
                       anomaly_c: float = 0.0) -> bool:
    """Mail one surface-threshold trigger. Deduped like model alerts."""
    event = {"event_type": event_type}
    if already_alerted(to_email, event, lat, lon):
        return True
    if not email_configured():
        logger.warning("Surface alert detected but Gmail SMTP is not configured.")
        return False
    subject, body = compose_surface_email(kind, headline, detail, lat, lon, region)
    try:
        from django.conf import settings as _settings
        from django.core.mail import send_mail as _send
        _send(subject, body, _settings.DEFAULT_FROM_EMAIL, [to_email], fail_silently=False)
    except Exception:
        logger.exception("Failed to send surface alert to %s", to_email)
        return False
    AlertLog.objects.create(
        email=to_email,
        event_type=event_type,
        latitude=round(float(lat), 1),
        longitude=round(float(lon), 1),
        max_anomaly_c=anomaly_c,
    )
    return True


def fast_surface_scan() -> dict:
    """Screen the 6 watch cells with LIVE surface data and mail subscribers.

    No model inference — fast enough for the 'Run check now' button
    (~5s for all cells in parallel). Returns a summary dict.
    """
    from concurrent.futures import ThreadPoolExecutor
    from . import live_satellite

    def _read(point: dict) -> dict:
        try:
            live = live_satellite.fetch_live_surface(point["lat"], point["lon"])
            return {**point, "surface": live["surface"], "ok": True}
        except Exception as exc:
            return {**point, "surface": {}, "ok": False, "error": str(exc)}

    with ThreadPoolExecutor(max_workers=6) as pool:
        readings = list(pool.map(_read, SCAN_POINTS))

    new_alerts = []
    mailed = 0
    subscribers = AlertSubscription.objects.filter(active=True).count()
    for reading in readings:
        if not reading["ok"]:
            continue
        for trig in evaluate_surface_triggers(reading["surface"]):
            new_alerts.append({
                "headline": trig["headline"],
                "region": reading["region"],
                "severity": trig["severity"],
            })
            for sub in AlertSubscription.objects.filter(active=True):
                try:
                    if (abs(float(sub.latitude) - reading["lat"]) <= float(sub.radius_deg)
                            and abs(float(sub.longitude) - reading["lon"]) <= float(sub.radius_deg)):
                        if send_surface_email(
                            sub.email, trig["kind"], trig["event_type"],
                            trig["headline"], trig["detail"],
                            reading["lat"], reading["lon"], reading["region"],
                        ):
                            mailed += 1
                except (TypeError, ValueError):
                    continue

    return {
        "scanned": len(readings),
        "created": mailed,
        "recipients": subscribers,
        "newAlerts": new_alerts,
        "emailReady": email_configured(),
    }


def subscribers_near(lat: float, lon: float, event_type: str) -> list[AlertSubscription]:
    """Active subscribers whose watch cell covers (lat, lon) for this event."""
    subs = AlertSubscription.objects.filter(active=True)
    if event_type == "heatwave":
        subs = subs.filter(alert_heatwave=True)
    elif event_type == "upwelling":
        subs = subs.filter(alert_upwelling=True)
    near = []
    for sub in subs:
        try:
            if (abs(float(sub.latitude) - float(lat)) <= float(sub.radius_deg)
                    and abs(float(sub.longitude) - float(lon)) <= float(sub.radius_deg)):
                near.append(sub)
        except (TypeError, ValueError):
            continue
    return near
