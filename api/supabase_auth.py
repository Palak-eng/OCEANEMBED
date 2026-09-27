"""Recognise Supabase-authenticated frontend users in Django.

The frontend signs users in with Supabase (email/OTP/Google) and sends the
Supabase access token as ``Authorization: Bearer <token>``. This module
validates the signature against the project's JWKS — accepting RS256, ES256
and EdDSA keys, since newer Supabase projects sign with ES256 — and returns
the user claims. PyJWT is imported lazily so ``manage.py check`` still passes
on machines without the optional dependency installed.
"""

import json
import time
import urllib.request
from functools import wraps

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_GET

_JWKS_CACHE = {"keys": None, "fetched_at": 0.0}


def _jwks_url():
    base = (getattr(settings, "SUPABASE_URL", "") or "").rstrip("/")
    if not base:
        raise ValueError("SUPABASE_URL is not configured on the backend.")
    return f"{base}/auth/v1/.well-known/jwks.json"


def _get_signing_keys():
    ttl = int(getattr(settings, "SUPABASE_JWKS_CACHE_SECONDS", 600) or 600)
    now = time.time()
    if _JWKS_CACHE["keys"] is not None and now - _JWKS_CACHE["fetched_at"] < ttl:
        return _JWKS_CACHE["keys"]
    request = urllib.request.Request(_jwks_url(), headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            document = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise ValueError("Could not reach the Supabase JWKS endpoint.") from exc
    keys = (document.get("keys") or []) if isinstance(document, dict) else []
    if not keys:
        raise ValueError("Supabase JWKS returned no signing keys.")
    _JWKS_CACHE["keys"] = keys
    _JWKS_CACHE["fetched_at"] = now
    return keys


def verify_supabase_token(token):
    """Return the decoded claims for a valid Supabase access token.

    Raises ValueError with a human-readable reason when invalid.
    """
    try:
        import jwt
    except ImportError as exc:
        raise ValueError("PyJWT is not installed (pip install PyJWT[crypto]).") from exc

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise ValueError("Malformed token.") from exc

    kid = header.get("kid")
    keys = _get_signing_keys()
    jwk = next((k for k in keys if k.get("kid") == kid), None) if kid else None
    if jwk is None:
        # Possible key rotation: refresh once before giving up.
        _JWKS_CACHE["keys"] = None
        keys = _get_signing_keys()
        jwk = next((k for k in keys if k.get("kid") == kid), None) if kid else None
    if jwk is None:
        raise ValueError("Unknown signing key.")

    allowed_algs = {"RS256", "ES256", "EdDSA"}
    token_alg = str(header.get("alg") or "")
    jwk_alg = str(jwk.get("alg") or "")
    algorithm = token_alg if token_alg in allowed_algs else jwk_alg
    if algorithm not in allowed_algs:
        kty = str(jwk.get("kty") or "").upper()
        algorithm = {"RSA": "RS256", "EC": "ES256", "OKP": "EdDSA"}.get(kty, "")
    if algorithm not in allowed_algs:
        raise ValueError("Unsupported signing key.")

    try:
        if algorithm == "RS256":
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
        elif algorithm == "ES256":
            public_key = jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk))
        else:
            public_key = jwt.algorithms.OKPAlgorithm.from_jwk(json.dumps(jwk))
    except Exception as exc:
        raise ValueError("Unsupported signing key.") from exc

    base = (getattr(settings, "SUPABASE_URL", "") or "").rstrip("/")
    try:
        return jwt.decode(
            token,
            public_key,
            algorithms=[algorithm],
            audience="authenticated",
            issuer=f"{base}/auth/v1",
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("Session expired, please sign in again.") from exc
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid session token.") from exc


@require_GET
def supabase_me(request):
    """Identify the Supabase-authenticated caller.

    Expects ``Authorization: Bearer <supabase access token>``.
    """
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return JsonResponse(
            {"authenticated": False, "error": "Missing bearer token."}, status=401
        )
    try:
        claims = verify_supabase_token(token)
    except ValueError as exc:
        return JsonResponse({"authenticated": False, "error": str(exc)}, status=401)
    return JsonResponse(
        {
            "authenticated": True,
            "user": {
                "id": claims.get("sub"),
                "email": claims.get("email", ""),
            },
        }
    )


def supabase_jwt_required(view_fn):
    """Decorator: accept Supabase Bearer token *or* Django session auth.

    On success, attaches ``request.supabase_claims`` (dict with ``sub``,
    ``email``, etc.) so downstream code can identify the caller.
    """

    @wraps(view_fn)
    def wrapper(request, *args, **kwargs):
        # Fast path: Django session (used in local dev / admin)
        if request.user.is_authenticated:
            request.supabase_claims = {
                "sub": str(request.user.pk),
                "email": request.user.email or "",
            }
            return view_fn(request, *args, **kwargs)

        # Supabase JWT path
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return JsonResponse(
                {"error": "Authentication required. Sign in via Supabase or Django."},
                status=401,
            )
        try:
            claims = verify_supabase_token(token)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=401)

        request.supabase_claims = claims
        return view_fn(request, *args, **kwargs)

    return wrapper
