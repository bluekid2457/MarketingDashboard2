"""Per-post publish worker shared by the HTTP scheduler route and the
EventBridge-driven Lambda. This module is intentionally framework-agnostic:
it never raises HTTPException and returns a plain dict the caller can log
or translate."""

from __future__ import annotations

import time
from typing import Any, Literal

from firebase_admin import firestore

from app.services.firebase_service import get_firestore_client
from app.services.linkedin_publisher import publish_linkedin_text


def _now_ms() -> int:
    return int(time.time() * 1000)


def _resolve_text(row_data: dict[str, Any], platform: str) -> str:
    snapshot = row_data.get("contentSnapshot")
    if isinstance(snapshot, dict):
        candidate = snapshot.get(platform)
        if isinstance(candidate, str):
            return candidate.strip()
    return ""


def _resolve_visibility(row_data: dict[str, Any]) -> Literal["PUBLIC", "CONNECTIONS"]:
    raw = row_data.get("visibility")
    if isinstance(raw, str) and raw.strip().upper() == "CONNECTIONS":
        return "CONNECTIONS"
    return "PUBLIC"


def _claim_row(db: Any, *, reference: Any, now_ms: int) -> dict[str, Any] | None:
    """CAS the row from `scheduled` to `publishing`. Returns the pre-update
    snapshot data on success, ``None`` on lost race / missing row / status
    mismatch."""

    @firestore.transactional
    def _txn(txn, ref):
        snapshot = ref.get(transaction=txn)
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        if data.get("status") != "scheduled":
            return None
        txn.update(ref, {
            "status": "publishing",
            "lastAttemptAtMs": now_ms,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        return data

    transaction = db.transaction()
    try:
        return _txn(transaction, reference)
    except Exception as exc:
        print(f"[scheduler_worker] CAS failed for {reference.path}: {type(exc).__name__}")
        return None


async def publish_one(user_id: str, scheduled_post_id: str) -> dict[str, Any]:
    """Publish a single scheduledPost row.

    Returns one of:
      {"status": "published", "scheduledPostId": ..., "userId": ..., "postUrn": ..., "postUrl": ...}
      {"status": "skipped",   "scheduledPostId": ..., "userId": ..., "reason": "not_due" | "missing_doc" | "lost_race" | "non_linkedin"}
      {"status": "failed",    "scheduledPostId": ..., "userId": ..., "error": "<slug>"}
      {"status": "idempotent","scheduledPostId": ..., "userId": ..., "postUrn": ...}   # row already had a postUrn

    Never raises; all paths return a dict. Logs only the row id + uid + outcome
    slug -- NEVER the post text or token material.
    """
    db = get_firestore_client()
    ref = db.collection("users").document(user_id).collection("scheduledPosts").document(scheduled_post_id)
    now_ms = _now_ms()

    snap = ref.get()
    if not snap.exists:
        print(f"[scheduler_worker] {scheduled_post_id} ({user_id}) -> skipped (missing_doc)")
        return {"status": "skipped", "scheduledPostId": scheduled_post_id, "userId": user_id, "reason": "missing_doc"}

    # 1. CAS to `publishing`
    claimed = _claim_row(db, reference=ref, now_ms=now_ms)
    if claimed is None:
        print(f"[scheduler_worker] {scheduled_post_id} ({user_id}) -> skipped (lost_race)")
        return {"status": "skipped", "scheduledPostId": scheduled_post_id, "userId": user_id, "reason": "lost_race"}

    # 2. Idempotency short-circuit
    existing_urn = claimed.get("postUrn")
    if isinstance(existing_urn, str) and existing_urn.strip():
        try:
            ref.update({"status": "published", "updatedAt": firestore.SERVER_TIMESTAMP})
        except Exception:
            pass
        print(f"[scheduler_worker] {scheduled_post_id} ({user_id}) -> idempotent")
        return {"status": "idempotent", "scheduledPostId": scheduled_post_id, "userId": user_id, "postUrn": existing_urn.strip()}

    # 3. Platform gate
    platforms = claimed.get("platforms") or []
    if "linkedin" not in platforms:
        try:
            ref.update({"status": "scheduled", "updatedAt": firestore.SERVER_TIMESTAMP})
        except Exception:
            pass
        return {"status": "skipped", "scheduledPostId": scheduled_post_id, "userId": user_id, "reason": "non_linkedin"}

    text = _resolve_text(claimed, "linkedin")
    if not text:
        try:
            ref.update({
                "status": "failed",
                "failureReason": "invalid_payload",
                "attemptCount": int(claimed.get("attemptCount") or 0) + 1,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        except Exception:
            pass
        print(f"[scheduler_worker] {scheduled_post_id} ({user_id}) -> failed (invalid_payload)")
        return {"status": "failed", "scheduledPostId": scheduled_post_id, "userId": user_id, "error": "invalid_payload"}

    visibility = _resolve_visibility(claimed)
    outcome = await publish_linkedin_text(user_id=user_id, text=text, visibility=visibility)

    if outcome.get("success") is True:
        post_urn = outcome.get("postUrn", "")
        post_url = outcome.get("postUrl", "")
        try:
            ref.update({
                "status": "published",
                "postUrn": post_urn,
                "postUrl": post_url,
                "publishedAtMs": _now_ms(),
                "attemptCount": int(claimed.get("attemptCount") or 0) + 1,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        except Exception as exc:
            print(f"[scheduler_worker] success-finalize failed for {ref.path}: {type(exc).__name__}")
        print(f"[scheduler_worker] {scheduled_post_id} ({user_id}) -> published")
        return {"status": "published", "scheduledPostId": scheduled_post_id, "userId": user_id, "postUrn": post_urn, "postUrl": post_url}

    failure_reason = outcome.get("error", "unknown")
    failure_update: dict[str, Any] = {
        "status": "failed",
        "failureReason": failure_reason,
        "attemptCount": int(claimed.get("attemptCount") or 0) + 1,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    provider_error = outcome.get("providerError")
    if provider_error is not None:
        failure_update["providerError"] = provider_error
    try:
        ref.update(failure_update)
    except Exception as exc:
        print(f"[scheduler_worker] failure-finalize failed for {ref.path}: {type(exc).__name__}")
    print(f"[scheduler_worker] {scheduled_post_id} ({user_id}) -> failed ({failure_reason})")
    return {"status": "failed", "scheduledPostId": scheduled_post_id, "userId": user_id, "error": failure_reason}
