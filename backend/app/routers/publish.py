"""Direct-publish and scheduled-publish endpoints.

Three surfaces live here:

* ``POST /publish/linkedin/now`` -- synchronous "publish now" for a signed-in
  user. Delegates the LinkedIn UGC call to
  ``app.services.linkedin_publisher.publish_linkedin_text``.
* ``POST /publish/schedule`` -- new in Pattern B: creates a ``scheduledPosts``
  row AND provisions a per-post AWS EventBridge one-shot schedule that
  fires once at ``scheduledForMs`` and invokes the scheduler Lambda.
* ``POST /publish/scheduled/run`` -- legacy server-to-server scheduler tick
  used by Cloud Scheduler (or ``npm run scheduler:tick`` in dev) to drain
  due rows. Kept intact as a safety net while Pattern B is rolled out.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, ConfigDict, Field

from app.auth import verify_firebase_id_token
from app.config import settings
from app.services import eventbridge_scheduler
from app.services.firebase_service import get_firestore_client
from app.services.linkedin_publisher import (
    PublishOutcome,
    publish_linkedin_text,
)
from app.services.scheduler_worker import publish_one

router = APIRouter(tags=["Publish"])


# ---------------------------------------------------------------------------
# /publish/linkedin/now -- thin wrapper around publish_linkedin_text
# ---------------------------------------------------------------------------


class LinkedInPublishRequest(BaseModel):
    """Request body for direct LinkedIn publishing."""

    user_id: str = Field(alias="userId", min_length=1)
    text: str = Field(min_length=1, max_length=3000)
    visibility: Literal["PUBLIC", "CONNECTIONS"] = "PUBLIC"


def _outcome_to_response(outcome: PublishOutcome) -> dict[str, Any]:
    """Translate a PublishOutcome dict into the wire envelope.

    The router historically returned ``{success, postUrn, postUrl}`` on
    success and ``{success: false, error, status, providerError?}`` on
    failure -- both inside an HTTP 200 body so the frontend can branch
    without ``fetch`` throwing. We preserve that contract verbatim here.
    """
    if outcome.get("success") is True:
        return {
            "success": True,
            "postUrn": outcome.get("postUrn", ""),
            "postUrl": outcome.get("postUrl", ""),
        }
    payload: dict[str, Any] = {
        "success": False,
        "error": outcome.get("error", "unknown"),
        "status": outcome.get("status", 500),
    }
    if "providerError" in outcome:
        payload["providerError"] = outcome["providerError"]
    return payload


@router.post("/publish/linkedin/now")
async def publish_linkedin_now(
    body: LinkedInPublishRequest,
    verified_uid: str = Depends(verify_firebase_id_token),
) -> dict[str, Any]:
    """Publish a text-only post to LinkedIn on behalf of the signed-in user.

    Auth: requires a Firebase ID token in ``Authorization: Bearer <token>``.
    The verified `uid` must match `body.user_id`.

    Returns HTTP 200 with a `{success: bool, ...}` envelope for every
    business-logic outcome (including LinkedIn-side errors). True 401/403
    HTTPExceptions are reserved for auth/identity failures.
    """
    if verified_uid != body.user_id:
        raise HTTPException(status_code=403, detail="uid_mismatch")

    outcome = await publish_linkedin_text(
        user_id=body.user_id,
        text=body.text,
        visibility=body.visibility,
    )
    return _outcome_to_response(outcome)


# ---------------------------------------------------------------------------
# /publish/schedule -- Pattern B: one-shot EventBridge schedule per post
# ---------------------------------------------------------------------------


class SchedulePlatform(str, Enum):
    LINKEDIN = "linkedin"


class ScheduleContentSnapshot(BaseModel):
    """Per-platform copy captured at schedule time. Currently only ``linkedin``
    is consumed by the scheduler worker."""

    linkedin: str | None = Field(default=None, max_length=3000)


class ScheduleRequest(BaseModel):
    user_id: str = Field(alias="userId", min_length=1)
    scheduled_for_ms: int = Field(alias="scheduledForMs", gt=0)
    platforms: list[SchedulePlatform] = Field(min_length=1, max_length=1)
    idea_id: str = Field(alias="ideaId", min_length=1)
    angle_id: str = Field(alias="angleId", min_length=1)
    idea_topic: str = Field(alias="ideaTopic", max_length=500)
    angle_title: str = Field(alias="angleTitle", max_length=500)
    article_title: str = Field(alias="articleTitle", max_length=500)
    content_snapshot: ScheduleContentSnapshot = Field(alias="contentSnapshot")
    visibility: Literal["PUBLIC", "CONNECTIONS"] = "PUBLIC"

    model_config = ConfigDict(populate_by_name=True)


_MIN_SCHEDULE_LEAD_MS = 60_000  # 60-second floor enforced server-side.


@router.post("/publish/schedule")
async def schedule_publish(
    body: ScheduleRequest,
    verified_uid: str = Depends(verify_firebase_id_token),
) -> dict[str, Any]:
    """Create a one-shot EventBridge schedule + scheduledPosts row.

    Auth: Firebase ID token; verified `uid` must match `body.user_id`.

    Atomic-ish contract:
      * If AWS env is configured AND the EventBridge call raises -> no
        Firestore write, HTTP 502 ``schedule_provisioning_failed``.
      * If AWS env is NOT configured (local dev) -> Firestore row is still
        written with ``eventBridgeScheduleName: null``; HTTP 200.
    """
    if verified_uid != body.user_id:
        raise HTTPException(status_code=403, detail="uid_mismatch")

    now_ms = _now_ms()
    if body.scheduled_for_ms <= now_ms + _MIN_SCHEDULE_LEAD_MS:
        raise HTTPException(status_code=422, detail="scheduled_too_soon")

    # Validate that the LinkedIn snapshot is present and non-empty.
    if SchedulePlatform.LINKEDIN in body.platforms:
        linkedin_text = (body.content_snapshot.linkedin or "").strip()
        if not linkedin_text:
            raise HTTPException(status_code=422, detail="missing_linkedin_snapshot")
    else:
        # Defensive -- Pattern B only ships LinkedIn today.
        raise HTTPException(status_code=422, detail="unsupported_platform")

    db = get_firestore_client()
    ref = (
        db.collection("users")
        .document(verified_uid)
        .collection("scheduledPosts")
        .document()
    )
    scheduled_post_id = ref.id

    # Provision the EventBridge schedule BEFORE the Firestore write so we
    # can implement the atomic-ish guarantee.
    try:
        schedule_name = eventbridge_scheduler.create_one_shot_schedule(
            scheduled_post_id=scheduled_post_id,
            user_id=verified_uid,
            fire_at_ms=body.scheduled_for_ms,
        )
    except Exception as exc:
        # Only fail-closed if AWS env was actually configured (the service
        # raises a real exception in that case, vs. returning None for
        # local dev).
        print(
            f"[publish.schedule] EventBridge provisioning failed for "
            f"{scheduled_post_id}: {type(exc).__name__}",
        )
        raise HTTPException(status_code=502, detail="schedule_provisioning_failed") from exc

    iso_string = datetime.fromtimestamp(body.scheduled_for_ms / 1000, tz=timezone.utc).isoformat()

    doc_payload: dict[str, Any] = {
        "ideaId": body.idea_id,
        "angleId": body.angle_id,
        "ideaTopic": body.idea_topic,
        "angleTitle": body.angle_title,
        "articleTitle": body.article_title,
        "platforms": [p.value for p in body.platforms],
        "scheduledForMs": body.scheduled_for_ms,
        "scheduledForIso": iso_string,
        "status": "scheduled",
        "contentSnapshot": {"linkedin": linkedin_text},
        "visibility": body.visibility,
        "attemptCount": 0,
        "eventBridgeScheduleName": schedule_name,  # None in local-dev no-op mode
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }

    try:
        ref.set(doc_payload)
    except Exception as exc:
        # The Firestore write failed AFTER EventBridge succeeded. Roll back
        # the schedule (best-effort) so we don't leave a zombie fire that
        # has no row to publish.
        if schedule_name is not None:
            try:
                eventbridge_scheduler.delete_schedule(scheduled_post_id)
            except Exception:
                pass
        print(
            f"[publish.schedule] Firestore write failed for "
            f"{scheduled_post_id}: {type(exc).__name__}",
        )
        raise HTTPException(status_code=500, detail="schedule_write_failed") from exc

    return {
        "success": True,
        "scheduledPostId": scheduled_post_id,
        "eventBridgeScheduleName": schedule_name,
    }


# ---------------------------------------------------------------------------
# /publish/schedule/{id} -- cancel/remove a scheduled post
# ---------------------------------------------------------------------------


@router.delete("/publish/schedule/{scheduled_post_id}")
async def cancel_scheduled_post(
    scheduled_post_id: str,
    verified_uid: str = Depends(verify_firebase_id_token),
) -> dict[str, Any]:
    """Cancel/remove a scheduled post.

    Auth: Firebase ID token. The post is looked up under the verified user's
    ``users/{uid}/scheduledPosts`` collection, so cross-user access is
    structurally impossible (the doc simply won't exist for the other uid).

    Behavior:
      * 404 ``not_found`` if no such doc.
      * 409 ``status_not_cancellable`` if the row is mid-publish or already
        published (``status`` in {publishing, published}). The frontend
        should refresh state instead of letting the user race the publisher.
      * Otherwise: best-effort delete of the EventBridge schedule, then
        delete the Firestore doc. Schedule deletion errors are swallowed
        and logged (the scheduler auto-deletes after firing anyway, so a
        ResourceNotFound is normal for ``failed`` rows).

    Returns ``{success: true, scheduledPostId, eventBridgeScheduleDeleted}``.
    """
    db = get_firestore_client()
    ref = (
        db.collection("users")
        .document(verified_uid)
        .collection("scheduledPosts")
        .document(scheduled_post_id)
    )

    snapshot = ref.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="not_found")

    row = snapshot.to_dict() or {}
    status = str(row.get("status") or "scheduled")
    if status in {"publishing", "published"}:
        raise HTTPException(status_code=409, detail="status_not_cancellable")

    # Best-effort delete of the EventBridge schedule. The service catches
    # ResourceNotFoundException internally; other errors are caught here.
    schedule_deleted = False
    try:
        eventbridge_scheduler.delete_schedule(scheduled_post_id)
        schedule_deleted = True
    except Exception as exc:
        print(
            f"[publish.cancel] EventBridge delete swallowed for "
            f"{scheduled_post_id}: {type(exc).__name__}",
        )

    try:
        ref.delete()
    except Exception as exc:
        print(
            f"[publish.cancel] Firestore delete failed for "
            f"{scheduled_post_id}: {type(exc).__name__}",
        )
        raise HTTPException(status_code=500, detail="firestore_delete_failed") from exc

    return {
        "success": True,
        "scheduledPostId": scheduled_post_id,
        "eventBridgeScheduleDeleted": schedule_deleted,
    }


# ---------------------------------------------------------------------------
# /publish/scheduled/run -- scheduler-driven publish drain (legacy/sweeper)
# ---------------------------------------------------------------------------


class ScheduledRunRequest(BaseModel):
    """Optional body for the scheduler run."""

    limit: int = Field(default=50, ge=1, le=500)
    # Test-only override; production callers should not set this.
    now_ms: int | None = Field(default=None, alias="nowMs")


# Sweeper: any row stuck in `publishing` longer than this is rolled back to
# `scheduled` at the top of the next tick so a single zombie write does not
# permanently block re-attempts.
_PUBLISHING_ZOMBIE_TIMEOUT_MS = 10 * 60 * 1000


def _now_ms() -> int:
    return int(time.time() * 1000)


def _verify_scheduler_secret(provided: str | None) -> None:
    """Reject the request unless the X-Scheduler-Secret header matches.

    Behavior:
      * `SCHEDULER_SECRET` unset -> HTTP 503 ``scheduler_disabled``
        (operator-visible config error; better to fail closed than to fall
        through to a no-op).
      * Header missing or mismatched -> HTTP 401 ``unauthorized_scheduler``.
    """
    expected = (settings.scheduler_secret or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="scheduler_disabled")
    if not provided or provided.strip() != expected:
        raise HTTPException(status_code=401, detail="unauthorized_scheduler")


def _sweep_zombie_publishing(db: Any, *, now_ms: int) -> None:
    """Roll any stuck `publishing` rows back to `scheduled`.

    Uses a collection-group query across every user's ``scheduledPosts``
    subcollection so the operator never has to enumerate users. Failures are
    swallowed (logged-only) so a transient sweep failure does not block the
    rest of the tick.
    """
    threshold = now_ms - _PUBLISHING_ZOMBIE_TIMEOUT_MS
    try:
        query = (
            db.collection_group("scheduledPosts")
            .where(filter=FieldFilter("status", "==", "publishing"))
            .where(filter=FieldFilter("lastAttemptAtMs", "<", threshold))
        )
        for snapshot in query.stream():
            try:
                snapshot.reference.update(
                    {
                        "status": "scheduled",
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                )
            except Exception as exc:  # pragma: no cover - swallow individual write errors
                print(f"[scheduler] zombie-rollback failed for {snapshot.reference.path}: {type(exc).__name__}")
    except Exception as exc:  # pragma: no cover - swallow collection-group errors
        print(f"[scheduler] zombie sweep failed: {type(exc).__name__}")


def _user_id_from_reference(reference: Any) -> str:
    """Extract the parent ``users/{uid}`` document id from a scheduledPost ref.

    A scheduledPost path looks like::

        users/{uid}/scheduledPosts/{id}

    so the parent collection's parent is the ``users/{uid}`` doc.
    """
    parent_collection = getattr(reference, "parent", None)
    if parent_collection is None:
        return ""
    parent_doc = getattr(parent_collection, "parent", None)
    if parent_doc is None:
        return ""
    return getattr(parent_doc, "id", "") or ""


def _outcome_to_run_result(outcome: dict[str, Any]) -> dict[str, Any] | None:
    """Translate a ``publish_one`` outcome dict into the per-row entry the
    legacy ``/publish/scheduled/run`` route returns in its ``results`` list.

    Returns ``None`` for outcomes that should NOT be recorded in the tick
    summary (lost-race CAS losses, non-LinkedIn skips). Otherwise returns
    a dict shaped like the historic envelope:

        {
          "scheduledPostId": ...,
          "userId": ...,
          "status": "published" | "failed",
          "postUrn"?, "postUrl"?, "error"?,
        }
    """
    status_slug = outcome.get("status")
    if status_slug in ("published", "idempotent"):
        return {
            "scheduledPostId": outcome.get("scheduledPostId", ""),
            "userId": outcome.get("userId", ""),
            "status": "published",
            "postUrn": outcome.get("postUrn", ""),
            "postUrl": outcome.get("postUrl", ""),
        }
    if status_slug == "failed":
        return {
            "scheduledPostId": outcome.get("scheduledPostId", ""),
            "userId": outcome.get("userId", ""),
            "status": "failed",
            "error": outcome.get("error", "unknown"),
        }
    # status_slug == "skipped" (or anything else) -- not surfaced.
    return None


@router.post("/publish/scheduled/run")
async def run_scheduled_publish(
    body: ScheduledRunRequest | None = None,
    x_scheduler_secret: str | None = Header(default=None, alias="X-Scheduler-Secret"),
) -> dict[str, Any]:
    """Drain one tick of due rows from `users/{uid}/scheduledPosts`.

    Auth: shared-secret header ``X-Scheduler-Secret`` matched against the
    ``SCHEDULER_SECRET`` env var. No Firebase user identity is involved --
    this is a server-to-server endpoint.

    Returns an idempotency-friendly summary of the tick:

        {
          "processed": N,
          "published": M,
          "failed": K,
          "results": [{ scheduledPostId, userId, status, postUrn?, postUrl?, error? }]
        }

    LinkedIn is the only platform implemented today; non-LinkedIn rows are
    left in ``status: 'scheduled'``.
    """
    _verify_scheduler_secret(x_scheduler_secret)

    request_body = body or ScheduledRunRequest()
    db = get_firestore_client()
    now_ms = request_body.now_ms if request_body.now_ms is not None else _now_ms()
    limit = request_body.limit

    # 1. Sweep zombies -- any `publishing` row stuck for > 10 minutes flips
    # back to `scheduled` so this tick can re-claim it.
    _sweep_zombie_publishing(db, now_ms=now_ms)

    # 2. Collection-group query for due rows.
    due_query = (
        db.collection_group("scheduledPosts")
        .where(filter=FieldFilter("status", "==", "scheduled"))
        .where(filter=FieldFilter("scheduledForMs", "<=", now_ms))
        .order_by("scheduledForMs")
        .limit(limit)
    )

    results: list[dict[str, Any]] = []
    published_count = 0
    failed_count = 0

    try:
        rows = list(due_query.stream())
    except Exception as exc:  # pragma: no cover - surfaced as 500
        # Reading the collection group should not fail under normal use; log
        # the class name (never the secret or row contents) and return a
        # neutral empty tick rather than a 500 so Cloud Scheduler does not
        # treat the tick as broken.
        print(f"[scheduler] due-query failed: {type(exc).__name__}")
        return {"processed": 0, "published": 0, "failed": 0, "results": []}

    for snapshot in rows:
        ref = snapshot.reference
        scheduled_id = snapshot.id
        user_id = _user_id_from_reference(ref)

        # 3. Delegate the per-row workflow to the pure publish_one worker so
        # the EventBridge Lambda and this tick share identical CAS, idempotency,
        # and finalize logic.
        outcome = await publish_one(user_id=user_id, scheduled_post_id=scheduled_id)
        entry = _outcome_to_run_result(outcome)
        if entry is None:
            continue
        if entry["status"] == "published":
            published_count += 1
        elif entry["status"] == "failed":
            failed_count += 1
        results.append(entry)

    return {
        "processed": len(results),
        "published": published_count,
        "failed": failed_count,
        "results": results,
    }
