"""Firebase Authorization-header verification dependency.

Used by request handlers that need a verified Firebase Auth user id (the
`uid` claim from a Firebase ID token). The frontend obtains the ID token via
`firebase.auth.currentUser.getIdToken()` and passes it as
``Authorization: Bearer <token>``.

The dependency never logs the raw token; on errors it returns a generic
HTTPException with a short, non-sensitive error code.
"""

from __future__ import annotations

from fastapi import Header, HTTPException

from app.config import settings
from app.services.firebase_service import get_firestore_client


def _extract_bearer(authorization: str | None) -> str:
    """Return the bearer token from an Authorization header, or raise 401.

    The check is intentionally strict: the header must start with the
    case-insensitive prefix ``Bearer`` followed by a single space and a
    non-empty token. Anything else surfaces as a 401 so callers cannot
    accidentally send (e.g.) a base64-encoded basic-auth value.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="missing_or_malformed_authorization")

    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="missing_or_malformed_authorization")

    token = parts[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="missing_or_malformed_authorization")

    return token


async def verify_firebase_id_token(authorization: str | None = Header(None)) -> str:
    """Verify a Firebase ID token and return the authenticated `uid`.

    Used as a FastAPI dependency:

        @router.post("/something")
        async def handler(uid: str = Depends(verify_firebase_id_token)) -> ...

    Raises ``HTTPException(401)`` for any missing/malformed/invalid token.
    """
    token = _extract_bearer(authorization)

    # Touching the Firestore client lazy-inits the Firebase Admin app exactly
    # the same way the rest of the backend already does — so we don't need to
    # reimplement credential discovery here.
    get_firestore_client()

    try:
        # Imported inline so that test environments that don't have valid
        # service-account creds can still import the module.
        from firebase_admin import auth as firebase_auth

        decoded = firebase_auth.verify_id_token(token, check_revoked=False)
    except Exception as exc:  # pragma: no cover - surfaced as a generic 401
        if settings.debug:
            # Truncated class name only — never the token text.
            err_class = type(exc).__name__[:64]
            # Local stderr only via FastAPI's standard logging path.
            print(f"[auth] verify_id_token rejected: {err_class}")
        raise HTTPException(status_code=401, detail="invalid_id_token") from exc

    uid = str(decoded.get("uid") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="invalid_id_token")

    return uid
