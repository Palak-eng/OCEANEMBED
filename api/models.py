from django.db import models


class AlertSubscription(models.Model):
    """A logged-in user who wants Gmail calamity alerts for an ocean location.

    Email comes from the Supabase JWT claim (or Django user) at subscribe time.
    `radius_deg` defines how close a detected event must be to (latitude,
    longitude) to trigger an email. `alert_heatwave` / `alert_upwelling`
    let scientists pick which diasaster types they care about.
    """

    email = models.EmailField(db_index=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_deg = models.FloatField(default=2.0)
    alert_heatwave = models.BooleanField(default=True)
    alert_upwelling = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["email", "latitude", "longitude"],
                name="unique_alert_subscription",
            )
        ]

    def __str__(self):
        return f"{self.email} @ ({self.latitude}, {self.longitude})"


class AlertLog(models.Model):
    """One sent alert — used to dedupe so scientists get max 1 email per event/day."""

    email = models.EmailField(db_index=True)
    event_type = models.CharField(max_length=32)  # "heatwave" | "upwelling"
    latitude = models.FloatField()
    longitude = models.FloatField()
    max_anomaly_c = models.FloatField()
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["email", "event_type", "sent_at"]),
        ]

    def __str__(self):
        return f"{self.event_type} -> {self.email} ({self.latitude}, {self.longitude})"
