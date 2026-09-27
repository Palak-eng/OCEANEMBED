from django.urls import path

from . import supabase_auth, views

urlpatterns = [
    path("", views.api_index, name="api-index"),
    path("health/", views.health_check, name="health-check"),
    path("auth/csrf/", views.csrf_token, name="csrf-token"),
    path("auth/send-email-otp/", views.send_email_otp, name="send-email-otp"),
    path("auth/verify-email-otp/", views.verify_email_otp, name="verify-email-otp"),
    path("auth/signup/", views.signup, name="signup"),
    path("auth/login/", views.login_user, name="login"),
    path("auth/forgot-username/", views.forgot_username, name="forgot-username"),
    path("auth/forgot-password/", views.forgot_password, name="forgot-password"),
    path("auth/logout/", views.logout_user, name="logout"),
    path("auth/me/", views.current_user, name="current-user"),
    path("auth/supabase-me/", supabase_auth.supabase_me, name="supabase-me"),
    path("model/status/", views.model_status, name="model-status"),
    path("metrics/", views.skill_metrics, name="skill-metrics"),
    path("datasets/", views.datasets, name="datasets"),
    path("predict/", views.predict_temperature, name="predict-temperature"),
    path("satellite/live/", views.live_satellite_reading, name="live_satellite"),
    path("history/", views.history_24h, name="history-24h"),
    path("alerts/subscribe/", views.subscribe_alerts, name="alerts-subscribe"),
    path("alerts/unsubscribe/", views.unsubscribe_alerts, name="alerts-unsubscribe"),
    path("alerts/mine/", views.my_alert_subscription, name="alerts-mine"),
    path("alerts/recent/", views.recent_alerts, name="alerts-recent"),
    path("alerts/scan/", views.scan_alerts_now, name="alerts-scan"),
    path("argo/floats/", views.argo_benchmark_floats, name="argo-benchmark-floats"),
    path("argo/floats/<str:float_id>/", views.argo_benchmark_floats, name="argo-benchmark-float-detail"),
]
