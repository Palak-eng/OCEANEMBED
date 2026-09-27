from django.contrib.auth.models import User
from django.test import Client, TestCase

from .models import AlertSubscription


class HealthTests(TestCase):
    def test_health_check(self):
        response = Client().get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "oceandepth-backend"})


class PredictAuthTests(TestCase):
    def test_predict_requires_auth(self):
        response = Client().post(
            "/api/predict/",
            {"latitude": 15.2, "longitude": 68.0, "date": "2026-09-27"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_predict_rejects_out_of_region(self):
        user = User.objects.create_user(username="tester", email="t@example.com", password="x")
        client = Client()
        client.force_login(user)
        response = client.post(
            "/api/predict/",
            {"latitude": 60.0, "longitude": 68.0, "date": "2026-09-27"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("latitude", response.json()["error"])


class AlertSubscriptionTests(TestCase):
    def test_subscribe_roundtrip(self):
        user = User.objects.create_user(username="alerter", email="a@example.com", password="x")
        client = Client()
        client.force_login(user)

        first = client.post(
            "/api/alerts/subscribe/",
            {"latitude": 15.2, "longitude": 88.6},
            content_type="application/json",
        )
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json()["gmail_configured"] in (True, False))
        self.assertEqual(AlertSubscription.objects.filter(email="a@example.com").count(), 1)

        # Resubscribing the same cell updates instead of duplicating.
        second = client.post(
            "/api/alerts/subscribe/",
            {"latitude": 15.2, "longitude": 88.6},
            content_type="application/json",
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(AlertSubscription.objects.filter(email="a@example.com").count(), 1)

        mine = client.get("/api/alerts/mine/")
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(mine.json()["subscription"]["email"], "a@example.com")
