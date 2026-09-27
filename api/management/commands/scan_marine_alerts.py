"""
Daily cron: scan North Indian Ocean watch cells with LIVE data and Gmail
every subscribed scientist near a detected calamity.

Usage:
    python manage.py scan_marine_alerts
    python manage.py scan_marine_alerts --date 2026-09-27 --dry-run

Schedule (examples):
    # Linux cron — every day 06:00 UTC
    0 6 * * * cd /app && python manage.py scan_marine_alerts >> alerts.log 2>&1
    # Render cron job:  python manage.py scan_marine_alerts

Requires Gmail SMTP env vars (see BACKEND_API.md). With --dry-run nothing
is emailed; detections are printed instead.
"""

from datetime import date

from django.core.management.base import BaseCommand

from api import alerts, climatology, live_satellite, model_service
from api.models import AlertSubscription
from api.views import STANDARD_DEPTHS


class Command(BaseCommand):
    help = "Scan NIO watch cells for marine heatwaves/upwelling and Gmail subscribers."

    def add_arguments(self, parser):
        parser.add_argument("--date", default=None, help="YYYY-MM-DD (default: today)")
        parser.add_argument("--dry-run", action="store_true", help="Detect only, send no mail")

    def handle(self, *args, **options):
        day = options["date"] or date.today().isoformat()
        dry_run = options["dry_run"]

        # Watch cells = built-in sentinels + every active subscriber location.
        cells = [(lat, lon, name) for lat, lon, name in alerts.SENTINEL_CELLS]
        seen = {(round(lat, 1), round(lon, 1)) for lat, lon, _ in cells}
        for sub in AlertSubscription.objects.filter(active=True):
            key = (round(float(sub.latitude), 1), round(float(sub.longitude), 1))
            if key not in seen:
                seen.add(key)
                cells.append((float(sub.latitude), float(sub.longitude), sub.email))

        self.stdout.write(f"Scanning {len(cells)} cells for {day} (dry_run={dry_run})...")
        events = 0
        mailed = 0
        for lat, lon, label in cells:
            try:
                live = live_satellite.fetch_live_surface(lat, lon)
                result = model_service.run_inference(lat, lon, day, STANDARD_DEPTHS, live["surface"])
                if result["mode"] != "ml":
                    continue
                clim = climatology.get_climatology_profile(lat, lon, day, STANDARD_DEPTHS)
                enriched = []
                for item in result["predictions"]:
                    d = int(item["depth_m"])
                    t_pred = float(item["temperature_c"])
                    t_clim = clim.get(d, round(max(4.0, 28.0 - 0.022 * d), 2))
                    delta = round(t_pred - t_clim, 2)
                    diag = climatology.classify_thermal_anomaly(delta)
                    enriched.append({
                        "depth_m": d,
                        "temperature_c": t_pred,
                        "climatology_c": t_clim,
                        "anomaly_c": delta,
                        "anomaly_severity": diag["severity"],
                        "anomaly_label": diag["label"],
                        "anomaly_description": diag["description"],
                    })
                event = alerts.detect_calamity(enriched)
                if event is None:
                    continue
                events += 1
                self.stdout.write(
                    f"  {event['event_type']} {event['anomaly_c']:+.2f}C @ {event['depth_m']}m "
                    f"near {lat:.1f}N,{lon:.1f}E ({label})"
                )
                if dry_run:
                    continue
                for sub in alerts.subscribers_near(lat, lon, event["event_type"]):
                    if alerts.send_calamity_email(sub.email, event, lat, lon, day):
                        mailed += 1
            except Exception as exc:
                self.stderr.write(f"  cell {lat},{lon} failed: {exc}")
                continue

        self.stdout.write(
            self.style.SUCCESS(f"Done: {events} event(s), {mailed} email(s) sent.")
        )
