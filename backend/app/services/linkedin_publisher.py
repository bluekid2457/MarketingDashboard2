"""Shared LinkedIn UGC publisher.

This module owns the actual outbound call to LinkedIn's ``v2/ugcPosts``
endpoint. It is intentionally framework-agnostic so it can be invoked from
both:

* the synchronous direct-publish route ``POST /api/v1/publish/linkedin/now``
  (a signed-in user clicking "Publish to LinkedIn"), and
* the background scheduler route ``POST /api/v1/publish/scheduled/run``
  (Cloud Scheduler walking due ``users/{uid}/scheduledPosts`` rows).

The function returns a typed dict (a ``PublishOutcome``) and never raises
``HTTPException`` — callers translate the outcome into either a JSON
envelope (router) or a Firestore status update (scheduler).
"""

from __future__ import annotations

import re
from typing import Any, Literal, TypedDict
from urllib.parse import quote

import httpx

from app.services.firebase_service import get_firestore_client
from app.services.integration_connection_service import integration_connection_service

LINKEDIN_UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts"

# Header/field-name patterns to redact from LinkedIn error payloads. Belt
# and braces — the documented error shapes do not contain token material,
# but if a future error body did, we don't want to leak it through this
# pass-through.
_SECRET_FIELD_RE = re.compile(r"(token|secret|authorization)", re.IGNORECASE)
_PROVIDER_ERROR_STRING_CAP = 500

PublishVisibility = Literal["PUBLIC", "CONNECTIONS"]

# Discriminated outcome shape callers must branch on. ``status`` carries the
# semantic HTTP code (matching the existing route contract); ``error`` is one
# of the canonical slugs used in the FailureReason union in the TIP.
FailureReason = Literal[
    "not_connected",
    "missing_author_urn",
    "token_expired",
    "forbidden",
    "rate_limited",
    "invalid_payload",
    "provider_unavailable",
    "timeout",
    "network",
    "unknown",
]


class PublishSuccess(TypedDict):
    success: Literal[True]
    postUrn: str
    postUrl: str


class PublishFailure(TypedDict, total=False):
    success: Literal[False]
    error: FailureReason
    status: int
    providerError: Any


PublishOutcome = PublishSuccess | PublishFailure


# ---------------------------------------------------------------------------
# Internal helpers (mirrored from the original publish router so refactoring
# preserves the over-the-wire shape exactly).
# ---------------------------------------------------------------------------


def _sanitize_provider_error(payload: Any) -> Any:
    """Strip secret-y fields from a LinkedIn error payload."""
    if isinstance(payload, dict):
        return {key: value for key, value in payload.items() if not _SECRET_FIELD_RE.search(str(key))}
    if isinstance(payload, str):
        if len(payload) > _PROVIDER_ERROR_STRING_CAP:
            return payload[:_PROVIDER_ERROR_STRING_CAP]
        return payload
    return payload


def _coerce_provider_error(response: httpx.Response) -> Any:
    try:
        return _sanitize_provider_error(response.json())
    except Exception:
        return _sanitize_provider_error(response.text)


def _failure(*, error: FailureReason, status: int, provider_error: Any = None) -> PublishFailure:
    payload: PublishFailure = {"success": False, "error": error, "status": status}
    if provider_error is not None:
        payload["providerError"] = provider_error
    return payload


def _map_linkedin_error_status(linkedin_status: int) -> tuple[int, FailureReason]:
    """Translate a LinkedIn HTTP status into our (status, error_code) pair."""
    if linkedin_status == 401:
        return 401, "token_expired"
    if linkedin_status == 403:
        return 403, "forbidden"
    if linkedin_status in (400, 422):
        return linkedin_status, "invalid_payload"
    if linkedin_status == 429:
        return 429, "rate_limited"
    if 500 <= linkedin_status < 600:
        return 502, "provider_unavailable"
    return 502, "provider_unavailable"


def _read_publish_author_urn(user_id: str) -> str | None:
    """Fetch the LinkedIn `publishAuthorUrn` from the user's connection summary."""
    db = get_firestore_client()
    snapshot = (
        db.collection("users")
        .document(user_id)
        .collection("integrationConnections")
        .document("linkedin")
        .get()
    )
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    metadata = data.get("metadata") or {}
    urn = metadata.get("publishAuthorUrn")
    if not isinstance(urn, str):
        return None
    urn = urn.strip()
    return urn or None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def publish_linkedin_text(
    *,
    user_id: str,
    text: str,
    visibility: PublishVisibility = "PUBLIC",
) -> PublishOutcome:
    """Publish a text-only post to LinkedIn for ``user_id``.

    Reads the decrypted access token from
    ``integration_connection_service.get_decrypted_access_token`` and the
    publish author URN from ``users/{uid}/integrationConnections/linkedin``.
    Returns a typed outcome — callers should branch on ``outcome['success']``.

    This function NEVER raises. Decryption errors, missing-doc errors,
    Firestore errors, network errors, timeouts, and unknown exceptions all
    surface as a ``PublishFailure`` with a stable ``error`` slug.

    Never logs token material or post text. Callers that want to log the
    outcome should log ``error``/``status`` and the user id only.
    """
    # ------------------------------------------------------------------
    # Token resolution
    # ------------------------------------------------------------------
    try:
        access_token = integration_connection_service.get_decrypted_access_token(
            user_id, "linkedin"
        )
    except Exception:
        # Decryption / Firestore read failures fall through to the not-connected
        # response instead of a 500 — the user-facing remediation is the same
        # ("reconnect LinkedIn in Settings").
        return _failure(error="not_connected", status=412)

    if not access_token:
        return _failure(error="not_connected", status=412)

    # ------------------------------------------------------------------
    # Author URN resolution
    # ------------------------------------------------------------------
    try:
        author_urn = _read_publish_author_urn(user_id)
    except Exception:
        return _failure(error="missing_author_urn", status=422)

    if not author_urn:
        return _failure(error="missing_author_urn", status=422)

    # ------------------------------------------------------------------
    # UGC payload
    # ------------------------------------------------------------------
    ugc_payload = {
        "author": author_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE",
            },
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": visibility,
        },
    }

    # ------------------------------------------------------------------
    # POST to LinkedIn
    # ------------------------------------------------------------------
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                LINKEDIN_UGC_POSTS_URL,
                json=ugc_payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                    "Content-Type": "application/json",
                },
            )
    except httpx.TimeoutException:
        return _failure(error="timeout", status=504)
    except httpx.HTTPError:
        return _failure(error="network", status=502)
    except Exception:
        return _failure(error="unknown", status=500)

    # ------------------------------------------------------------------
    # Success path
    # ------------------------------------------------------------------
    if response.status_code < 300:
        post_urn = ""
        try:
            body_json = response.json()
            if isinstance(body_json, dict):
                candidate = body_json.get("id")
                if isinstance(candidate, str):
                    post_urn = candidate.strip()
        except Exception:
            post_urn = ""

        if not post_urn:
            header_id = response.headers.get("x-restli-id") or response.headers.get("X-Restli-Id")
            if isinstance(header_id, str):
                post_urn = header_id.strip()

        if not post_urn:
            # LinkedIn returned 2xx but we couldn't find an id — surface a
            # success with empty fields so the UI doesn't break, and log a
            # warning so this regression is visible in the backend logs.
            print("[publish.linkedin] WARN: 2xx response missing post URN")
            return {"success": True, "postUrn": "", "postUrl": ""}

        post_url = f"https://www.linkedin.com/feed/update/{quote(post_urn, safe='')}"
        return {"success": True, "postUrn": post_urn, "postUrl": post_url}

    # ------------------------------------------------------------------
    # Failure path — translate LinkedIn HTTP status into our envelope
    # ------------------------------------------------------------------
    out_status, error_code = _map_linkedin_error_status(response.status_code)
    provider_error = _coerce_provider_error(response)
    return _failure(error=error_code, status=out_status, provider_error=provider_error)
