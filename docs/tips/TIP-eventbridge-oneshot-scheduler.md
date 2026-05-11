I have everything I need. Producing the TIP now.

---

# Technical Implementation Plan — One-shot AWS EventBridge Scheduled Publishing for LinkedIn

## 1. Issue Summary

Today, scheduled LinkedIn publishing on `/publish` works via a polling sweeper: the Publish page does a client-side `setDoc` to `users/{uid}/scheduledPosts/{auto}`, and a Cloud Scheduler cron drives `POST /api/v1/publish/scheduled/run` every minute, draining due rows. This couples publish latency to the sweep cadence and requires an always-on cron.

This change moves to **Pattern B (one-shot)**: when a user clicks Schedule, the backend creates a per-post AWS EventBridge Scheduler entry that fires once at `scheduledForMs` and directly invokes a dedicated scheduler Lambda. The scheduler Lambda imports the per-post publish worker and posts that single record. EventBridge auto-deletes the schedule after firing via `ActionAfterCompletion="DELETE"`. Two Lambdas share one container image:

- `marketing-dashboard-http` — Mangum wraps `app.main:app`, fronted by a Lambda Function URL.
- `marketing-dashboard-scheduler` — imports `app.lambda_scheduler:handler`, no HTTP wrapper.

The existing `POST /api/v1/publish/scheduled/run` and the synchronous `POST /api/v1/publish/linkedin/now` continue to work unchanged (refactored to share the new pure publish-one worker). The change is additive on the publish surface and replaces only the schedule-write path on the frontend.

## 2. Root Cause / Motivation

- The current sweeper-only design wastes invocations, has up to ~1 minute publish latency, and creates Cloud Scheduler infrastructure cost even when zero posts are scheduled.
- Moving to a one-shot schedule per post fires at exact `scheduledForMs`, scales to zero when nothing is queued, and prepares the backend for a Lambda deployment posture.
- The scheduler Lambda is invoked directly (Lambda → Lambda) rather than through HTTP so we never roundtrip through Mangum/CORS for scheduler work — fewer moving parts, no shared-secret exchange.

## 3. Database Schema Changes

### 3.1 New field on `users/{uid}/scheduledPosts/{scheduledPostId}`

Add one **optional** field. No migration of historic rows is needed (it is read-tolerant and absent means "no associated EventBridge schedule").

| Field | Type | Description |
|---|---|---|
| `eventBridgeScheduleName` | `string \| null` | Deterministic EventBridge schedule name (format: `publish-{scheduledPostId}`). `null` when the backend ran in local-dev no-op mode (AWS env vars unset). Used by the future `delete_schedule` / `update_schedule` helpers and for diagnostic surfacing. |

### 3.2 No new indexes required

The existing composite collection-group index `(status ASC, scheduledForMs ASC)` on `scheduledPosts` already supports the existing sweeper path. The new endpoint only does direct writes by document path, no queries.

### 3.3 Security rules

No change. Writes happen server-side under Firebase Admin credentials (rules are bypassed for backend writes). Reads are still gated by `users/{uid}/**`.

## 4. API Endpoint Changes

### 4.1 New endpoint: `POST /api/v1/publish/schedule`

- **Location:** `backend/app/routers/publish.py`
- **Auth:** `Authorization: Bearer <Firebase ID token>` via `verify_firebase_id_token` dependency. The decoded `uid` must equal `body.userId` (else `403 uid_mismatch`).
- **Request body (Pydantic model `ScheduleRequest`):**

```python
class SchedulePlatform(str, Enum):
    LINKEDIN = "linkedin"

class ScheduleContentSnapshot(BaseModel):
    """Per-platform copy captured at schedule time. Currently only `linkedin`
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
```

- **Validation:** `scheduled_for_ms > now_ms + 60_000` (60-second floor). On violation return `HTTP 422 {"detail": "scheduled_too_soon"}`.
- **Flow:**
  1. Verify Firebase ID token → `uid`; if `uid != body.user_id` → `HTTPException(403, "uid_mismatch")`.
  2. Validate `scheduled_for_ms > _now_ms() + 60_000` else `HTTPException(422, "scheduled_too_soon")`.
  3. Validate `content_snapshot.linkedin` is a non-empty stripped string when `linkedin` is in `platforms` else `HTTPException(422, "missing_linkedin_snapshot")`.
  4. Generate Firestore doc reference: `db.collection("users").document(uid).collection("scheduledPosts").document()` → capture `scheduled_post_id = ref.id`.
  5. Call `eventbridge_scheduler.create_one_shot_schedule(scheduled_post_id, uid, fire_at_ms=scheduled_for_ms)`.
     - If env vars `SCHEDULER_LAMBDA_ARN` and `EVENTBRIDGE_INVOKER_ROLE_ARN` are BOTH set (prod mode) AND boto3 raises → do NOT write the Firestore doc; return `HTTPException(502, "schedule_provisioning_failed")`. (Atomic-ish guarantee.)
     - Else if either env var is unset (local-dev no-op) → service returns `None`; proceed without an EventBridge entry; `eventBridgeScheduleName` is written as `None`.
  6. Write the Firestore doc with `ref.set({...})` (single transaction not required; this is the first write).
  7. Return `{"success": True, "scheduledPostId": scheduled_post_id, "eventBridgeScheduleName": schedule_name_or_none}`.

- **Firestore document shape written:**

```python
{
    "ideaId": body.idea_id,
    "angleId": body.angle_id,
    "ideaTopic": body.idea_topic,
    "angleTitle": body.angle_title,
    "articleTitle": body.article_title,
    "platforms": [p.value for p in body.platforms],   # ["linkedin"]
    "scheduledForMs": body.scheduled_for_ms,
    "scheduledForIso": datetime.fromtimestamp(body.scheduled_for_ms / 1000, tz=timezone.utc).isoformat(),
    "status": "scheduled",
    "contentSnapshot": {"linkedin": body.content_snapshot.linkedin},
    "visibility": body.visibility,
    "attemptCount": 0,
    "eventBridgeScheduleName": schedule_name_or_none,
    "createdAt": firestore.SERVER_TIMESTAMP,
    "updatedAt": firestore.SERVER_TIMESTAMP,
}
```

- **Response shape (HTTP 200):**

```json
{
  "success": true,
  "scheduledPostId": "abc123",
  "eventBridgeScheduleName": "publish-abc123"
}
```

- **Error responses:**
  - `401 missing_or_malformed_authorization` / `invalid_id_token` (from `verify_firebase_id_token`)
  - `403 uid_mismatch`
  - `422 scheduled_too_soon` or `missing_linkedin_snapshot`
  - `502 schedule_provisioning_failed` (only when AWS env is configured AND the EventBridge call failed; Firestore doc is not written in this branch)

### 4.2 Existing endpoints — unchanged contract

- `POST /api/v1/publish/linkedin/now` — unchanged.
- `POST /api/v1/publish/scheduled/run` — unchanged contract; internals refactored to call the new `scheduler_worker.publish_one`.

## 5. File System Changes

### 5.1 Files to CREATE

```
backend/app/services/scheduler_worker.py          — pure per-post publish worker (extracted from publish.py)
backend/app/services/eventbridge_scheduler.py      — boto3 wrapper: create/delete/update one-shot schedules
backend/app/services/secrets_loader.py             — Secrets Manager → os.environ hydrator (called from config.py)
backend/app/lambda_scheduler.py                    — AWS Lambda handler for the scheduler Lambda (calls publish_one)
backend/Dockerfile.lambda                          — Lambda container image (public.ecr.aws/lambda/python:3.11, arm64)
frontend/tests/publish/schedule.spec.ts            — (optional Playwright placeholder if test scaffolding already exists; otherwise skip)
```

### 5.2 Files to MODIFY

```
backend/requirements.txt                           — add mangum>=0.17 and boto3>=1.34
backend/app/main.py                                — add `handler = Mangum(app, lifespan="off")`; include publish_router
backend/app/config.py                              — call secrets_loader.load_secrets_into_env() at module import (before Settings())
backend/app/routers/publish.py                     — refactor: extract per-post logic to scheduler_worker; add POST /publish/schedule endpoint
backend/.env.example                               — add SCHEDULER_LAMBDA_ARN, EVENTBRIDGE_INVOKER_ROLE_ARN, EVENTBRIDGE_SCHEDULE_GROUP_NAME, AWS_REGION, SECRETS_MANAGER_SECRET_ID
frontend/src/lib/publish.ts                        — add scheduleLinkedInPost() wrapper
frontend/src/app/(app)/publish/page.tsx            — replace direct Firestore setDoc in schedulePost() with scheduleLinkedInPost() call
specs/automation.md                                — rewrite §5; new "Planned: safety-net sweeper" subsection; update §1, §3 table, Testing Requirements
specs/backend.md                                   — document new endpoint + Mangum + new services + new env vars
specs/database.md                                  — add eventBridgeScheduleName field
specs/architecture.md                              — update §9 Deployment + add EventBridge to §2 diagram + §8.3
```

### 5.3 Files explicitly NOT touched

```
backend/Dockerfile                                 — local-dev image; unchanged
backend/app/routers/linkedin.py                    — OAuth flow; unchanged
backend/app/services/linkedin_publisher.py         — publisher already framework-agnostic; unchanged
backend/app/auth.py                                — unchanged
frontend/src/app/(app)/notifications/page.tsx      — unchanged (reads same Firestore shape)
```

---

## 6. Detailed Change Specifications (numbered for the developer)

### Change 1 — Refactor `backend/app/routers/publish.py`: extract `publish_one` into `scheduler_worker.py`

Create `backend/app/services/scheduler_worker.py` with:

```python
"""Per-post publish worker shared by the HTTP scheduler route and the
EventBridge-driven Lambda. This module is intentionally framework-agnostic:
it never raises HTTPException and returns a plain dict the caller can log
or translate."""

from __future__ import annotations

import time
from typing import Any, Literal

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

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
    slug — NEVER the post text or token material.
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
    failure_update = {
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
```

Then refactor `backend/app/routers/publish.py`:
- Replace lines 302–446 (the body of `run_scheduled_publish` AFTER the zombie sweep) with a per-row loop that calls `await scheduler_worker.publish_one(user_id, scheduled_id)` and accumulates results.
- Keep `_sweep_zombie_publishing`, `_verify_scheduler_secret`, `_user_id_from_reference`, `_PUBLISHING_ZOMBIE_TIMEOUT_MS`, and `_now_ms` in `publish.py` — they are scheduler-route-level concerns, not per-post worker concerns.
- The collection-group query stays in the route handler. Drop the now-duplicated `_claim_row`, `_resolve_text`, `_resolve_visibility`, `_platforms_list` from `publish.py` and import the platform-list helper from `scheduler_worker` if still needed (it is not — `publish_one` now owns platform dispatch).

Net behavior of `POST /api/v1/publish/scheduled/run` after refactor:
1. `_verify_scheduler_secret(...)` → unchanged.
2. `_sweep_zombie_publishing(db, now_ms=now_ms)` → unchanged.
3. Collection-group due query → unchanged.
4. For each due row: `outcome = await scheduler_worker.publish_one(user_id_from_reference, snapshot.id)`. Map `outcome["status"]` to the result list shape the route already returns (`{"scheduledPostId", "userId", "status", "postUrn?", "postUrl?", "error?"}`).
5. Same `{"processed", "published", "failed", "results"}` envelope returned.

### Change 2 — Add Mangum and boto3

Edit `backend/requirements.txt`:

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
python-dotenv==1.0.1
pydantic==2.7.1
pydantic-settings==2.2.1
cryptography==42.0.8
firebase-admin==6.5.0
httpx==0.27.0
mangum>=0.17,<0.18
boto3>=1.34,<2.0
```

Edit `backend/app/main.py` — append at the bottom (after `app.include_router(...)` lines), and add the new publish router include:

```python
from app.routers.publish import router as publish_router

# ... existing CORS + /health + linkedin + integrations registration ...

app.include_router(publish_router, prefix="/api/v1")

# Lambda adapter — exported as `handler` so the HTTP Lambda can use
# `app.main.handler` as its entry point. `lifespan="off"` skips ASGI lifespan
# events that don't make sense in Lambda's request-scoped runtime.
from mangum import Mangum
handler = Mangum(app, lifespan="off")
```

Note: the publish router was previously not registered in `main.py` (review the current file — `publish.py` exists but is not yet wired). The developer must add the `include_router` line so both the existing `/publish/linkedin/now`, the existing `/publish/scheduled/run`, AND the new `/publish/schedule` are reachable.

### Change 3 — Scheduler Lambda handler

Create `backend/app/lambda_scheduler.py`:

```python
"""AWS Lambda handler for the scheduler Lambda.

Triggered directly by EventBridge Scheduler with an input payload of the
form ``{"scheduledPostId": str, "userId": str}``. Imports the pure per-post
publish worker and never goes through HTTP.

Logging contract: only the scheduledPostId, userId, and outcome slug are
ever logged. Never log the post text or token material.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.services.scheduler_worker import publish_one


def _normalize_event(event: Any) -> dict[str, Any]:
    """EventBridge Scheduler delivers the configured ``Input`` JSON as the
    full event. Defensive: handle both ``{"scheduledPostId": ...}`` and
    SQS/EventBridge envelopes if a future caller wraps it."""
    if isinstance(event, dict):
        if "scheduledPostId" in event and "userId" in event:
            return event
        # EventBridge `detail` envelope (defensive — not used in Pattern B today)
        detail = event.get("detail")
        if isinstance(detail, dict) and "scheduledPostId" in detail:
            return detail
    if isinstance(event, str):
        try:
            parsed = json.loads(event)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def handler(event: Any, context: Any) -> dict[str, Any]:
    """Lambda entry point.

    Returns the outcome dict from ``publish_one``. EventBridge Scheduler
    will mark the schedule deleted (via ``ActionAfterCompletion=DELETE``)
    regardless of return value — there is no retry attempt on the schedule
    side. Any retry is owned by the future safety-net sweeper.
    """
    payload = _normalize_event(event)
    scheduled_post_id = str(payload.get("scheduledPostId") or "").strip()
    user_id = str(payload.get("userId") or "").strip()

    if not scheduled_post_id or not user_id:
        print(f"[lambda_scheduler] invalid_input: missing scheduledPostId or userId")
        return {"status": "skipped", "reason": "invalid_input"}

    try:
        outcome = asyncio.run(publish_one(user_id=user_id, scheduled_post_id=scheduled_post_id))
    except Exception as exc:
        # publish_one is documented as never raising; this is a defensive
        # catch-all so a Lambda crash does not surface as an opaque 500.
        print(f"[lambda_scheduler] unexpected_exception: {type(exc).__name__}")
        return {"status": "failed", "scheduledPostId": scheduled_post_id, "userId": user_id, "error": "unknown"}

    # Outcome dict already has the right shape; safe to return as-is.
    return outcome
```

### Change 4 — EventBridge Scheduler service

Create `backend/app/services/eventbridge_scheduler.py`:

```python
"""Boto3 wrapper for AWS EventBridge Scheduler one-shot schedules.

Each scheduled LinkedIn post gets exactly one schedule entry. The schedule
fires once at `scheduledForMs`, invokes the scheduler Lambda directly with
``{"scheduledPostId": ..., "userId": ...}``, and auto-deletes after firing
via ``ActionAfterCompletion="DELETE"``.

Local-dev fallback: if SCHEDULER_LAMBDA_ARN or EVENTBRIDGE_INVOKER_ROLE_ARN
is unset, all functions log a warning and no-op. This lets uvicorn-on-laptop
work without AWS credentials.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

# boto3 is imported lazily inside each function so the module can still be
# imported in environments without AWS credentials (e.g., unit tests).


def _schedule_name(scheduled_post_id: str) -> str:
    """Deterministic schedule name. EventBridge Scheduler names must match
    ``[0-9a-zA-Z-_.]+`` and be 1..64 chars. Firestore auto-ids are 20 chars
    of [A-Za-z0-9] so ``publish-<id>`` is always valid."""
    return f"publish-{scheduled_post_id}"


def _aws_config_ready() -> tuple[str | None, str | None]:
    """Return (lambda_arn, role_arn) if both are set, else (None, None) for
    local-dev no-op mode."""
    lambda_arn = (os.environ.get("SCHEDULER_LAMBDA_ARN") or "").strip()
    role_arn = (os.environ.get("EVENTBRIDGE_INVOKER_ROLE_ARN") or "").strip()
    if not lambda_arn or not role_arn:
        return None, None
    return lambda_arn, role_arn


def _group_name() -> str:
    """Schedule group. Defaults to `default` if unset."""
    return (os.environ.get("EVENTBRIDGE_SCHEDULE_GROUP_NAME") or "default").strip() or "default"


def _at_expression(fire_at_ms: int) -> str:
    """Convert epoch-ms to EventBridge `at(...)` syntax in UTC.

    Format: ``at(YYYY-MM-DDTHH:MM:SS)`` — no offset, no fractional seconds.
    """
    dt_utc = datetime.fromtimestamp(fire_at_ms / 1000, tz=timezone.utc)
    return f"at({dt_utc.strftime('%Y-%m-%dT%H:%M:%S')})"


def create_one_shot_schedule(
    scheduled_post_id: str,
    user_id: str,
    fire_at_ms: int,
) -> str | None:
    """Create a one-shot schedule that fires at ``fire_at_ms`` UTC.

    Returns the schedule name on success, ``None`` if AWS env is not
    configured (local dev) — the caller still writes the Firestore row.

    Raises (and the caller catches) if AWS is configured but the boto3
    call fails — see the "atomic-ish" handling in the route.
    """
    lambda_arn, role_arn = _aws_config_ready()
    if not lambda_arn or not role_arn:
        print(f"[eventbridge_scheduler] no-op (AWS env unset) for {scheduled_post_id}")
        return None

    import boto3  # lazy import

    client = boto3.client("scheduler", region_name=os.environ.get("AWS_REGION") or None)
    name = _schedule_name(scheduled_post_id)

    response = client.create_schedule(
        Name=name,
        GroupName=_group_name(),
        ScheduleExpression=_at_expression(fire_at_ms),
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "OFF"},
        ActionAfterCompletion="DELETE",
        State="ENABLED",
        Target={
            "Arn": lambda_arn,
            "RoleArn": role_arn,
            "Input": json.dumps({"scheduledPostId": scheduled_post_id, "userId": user_id}),
            # No DLQ wired in Pattern B; the safety-net sweeper (planned) is
            # the recovery mechanism.
            "RetryPolicy": {
                "MaximumRetryAttempts": 0,
            },
        },
    )
    print(f"[eventbridge_scheduler] created {name} ({response.get('ScheduleArn', 'arn?')})")
    return name


def delete_schedule(scheduled_post_id: str) -> None:
    """Best-effort delete by deterministic schedule name.

    Catches ``ResourceNotFoundException`` (schedule already auto-deleted or
    never existed) and logs a warning. Other boto3 exceptions are also
    caught so an account-deletion or cancel-UI flow is never blocked by a
    transient AWS error.
    """
    lambda_arn, role_arn = _aws_config_ready()
    if not lambda_arn or not role_arn:
        print(f"[eventbridge_scheduler] no-op delete for {scheduled_post_id}")
        return

    import boto3
    from botocore.exceptions import ClientError

    client = boto3.client("scheduler", region_name=os.environ.get("AWS_REGION") or None)
    name = _schedule_name(scheduled_post_id)
    try:
        client.delete_schedule(Name=name, GroupName=_group_name())
        print(f"[eventbridge_scheduler] deleted {name}")
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code", "")
        if code == "ResourceNotFoundException":
            print(f"[eventbridge_scheduler] delete: {name} not found (already gone)")
            return
        print(f"[eventbridge_scheduler] delete failed for {name}: {code}")
    except Exception as exc:
        print(f"[eventbridge_scheduler] delete error for {name}: {type(exc).__name__}")


def update_schedule(
    scheduled_post_id: str,
    user_id: str,
    new_fire_at_ms: int,
) -> None:
    """Implemented as delete-then-create for the future reschedule UI.

    Pattern B has no UI consumer yet — this helper is exported for the
    upcoming reschedule/cancel UI work documented in
    ``specs/automation.md`` Known Gaps.
    """
    delete_schedule(scheduled_post_id)
    create_one_shot_schedule(scheduled_post_id, user_id, new_fire_at_ms)
```

### Change 5 — `POST /api/v1/publish/schedule` route

Append to `backend/app/routers/publish.py`:

```python
from datetime import datetime, timezone
from enum import Enum
from pydantic import ConfigDict
from app.services import eventbridge_scheduler
from app.services.scheduler_worker import publish_one  # imported here so the
                                                         # refactored /scheduled/run can use it


class SchedulePlatform(str, Enum):
    LINKEDIN = "linkedin"


class ScheduleContentSnapshot(BaseModel):
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
      * If AWS env is configured AND the EventBridge call raises → no
        Firestore write, HTTP 502 ``schedule_provisioning_failed``.
      * If AWS env is NOT configured (local dev) → Firestore row is still
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
        # Defensive — Pattern B only ships LinkedIn today.
        raise HTTPException(status_code=422, detail="unsupported_platform")

    db = get_firestore_client()
    ref = db.collection("users").document(verified_uid).collection("scheduledPosts").document()
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
        print(f"[publish.schedule] EventBridge provisioning failed for {scheduled_post_id}: {type(exc).__name__}")
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
        "eventBridgeScheduleName": schedule_name,   # None in local-dev no-op mode
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
        print(f"[publish.schedule] Firestore write failed for {scheduled_post_id}: {type(exc).__name__}")
        raise HTTPException(status_code=500, detail="schedule_write_failed") from exc

    return {
        "success": True,
        "scheduledPostId": scheduled_post_id,
        "eventBridgeScheduleName": schedule_name,
    }
```

### Change 6 — Lambda container Dockerfile

Create `backend/Dockerfile.lambda`:

```dockerfile
# AWS Lambda container image for the marketing-dashboard backend.
# One image, two functions:
#   marketing-dashboard-http       CMD: ["app.main.handler"]
#   marketing-dashboard-scheduler  CMD: ["app.lambda_scheduler.handler"]
# CMD is set per-function in Lambda configuration (Console / CLI), NOT here.
#
# Build (arm64):
#   docker buildx build --platform linux/arm64 -f backend/Dockerfile.lambda \
#     -t marketing-dashboard:latest backend/
#
# This file is intentionally separate from `backend/Dockerfile` so the
# local-dev uvicorn flow keeps working unchanged.

FROM public.ecr.aws/lambda/python:3.11

# Copy and install dependencies into Lambda's task root.
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Copy application code.
COPY app/ ${LAMBDA_TASK_ROOT}/app/

# No CMD here — set per-function in Lambda config:
#   - HTTP Lambda:      app.main.handler
#   - Scheduler Lambda: app.lambda_scheduler.handler
```

Note: Lambda configuration (set in console / CLI by the user, NOT in code):
- Architecture: arm64
- Memory: 512 MB recommended for HTTP, 256 MB for scheduler
- Timeout: 30 s HTTP, 60 s scheduler
- HTTP Lambda needs a Function URL with auth `NONE` (CORS still enforced by FastAPI)

### Change 7 — Secrets Manager loader

Create `backend/app/services/secrets_loader.py`:

```python
"""Hydrate environment variables from AWS Secrets Manager at process start.

Why: Lambda functions read most config from environment variables, but the
Firebase service-account JSON and the LinkedIn client secret are too long
for Lambda's per-variable size limit and too sensitive to leave plain in
the function config. We store them in one Secrets Manager secret as a JSON
blob and hydrate them into os.environ before anything else imports config.

Behavior:
  * Reads SECRETS_MANAGER_SECRET_ID. Unset → return immediately (local dev).
  * Fetches the secret value as JSON. Each top-level key is set into
    os.environ ONLY IF the key is not already set (explicit env vars win).
  * All failures are caught and logged — never crash the process.

Called from app.config at module import, BEFORE Settings() is instantiated.
"""

from __future__ import annotations

import json
import os


def load_secrets_into_env() -> None:
    secret_id = (os.environ.get("SECRETS_MANAGER_SECRET_ID") or "").strip()
    if not secret_id:
        return

    try:
        import boto3  # lazy import — local dev without boto3 still works
        from botocore.exceptions import ClientError

        client = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION") or None)
        response = client.get_secret_value(SecretId=secret_id)
    except Exception as exc:
        print(f"[secrets_loader] fetch failed for {secret_id}: {type(exc).__name__}")
        return

    raw = response.get("SecretString")
    if not raw:
        print(f"[secrets_loader] {secret_id} has no SecretString")
        return

    try:
        parsed = json.loads(raw)
    except Exception:
        print(f"[secrets_loader] {secret_id} is not valid JSON; skipping")
        return

    if not isinstance(parsed, dict):
        print(f"[secrets_loader] {secret_id} did not deserialize to an object; skipping")
        return

    applied = 0
    for key, value in parsed.items():
        if not isinstance(key, str) or not key:
            continue
        if key in os.environ:
            continue  # explicit env var wins
        if value is None:
            continue
        os.environ[key] = value if isinstance(value, str) else json.dumps(value)
        applied += 1

    print(f"[secrets_loader] hydrated {applied} env vars from {secret_id}")
```

Edit `backend/app/config.py` — call the loader BEFORE the `Settings()` instantiation:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.services.secrets_loader import load_secrets_into_env

# Hydrate environment variables from Secrets Manager BEFORE Settings reads
# from the environment. No-op in local dev (when SECRETS_MANAGER_SECRET_ID
# is unset).
load_secrets_into_env()


class Settings(BaseSettings):
    # ... existing fields unchanged ...
```

Critically: `secrets_loader` must NOT import `app.config` (no circular import). It only touches `os.environ` and `boto3`.

### Change 8 — Frontend client wrapper

Append to `frontend/src/lib/publish.ts`:

```ts
export type ScheduleLinkedInArgs = {
  userId: string;
  scheduledForMs: number;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  articleTitle: string;
  contentSnapshotLinkedIn: string;
  visibility?: PublishVisibility;
};

export type ScheduleSuccess = {
  success: true;
  scheduledPostId: string;
  eventBridgeScheduleName: string | null;
};

export type ScheduleFailure = {
  success: false;
  error: string;
  status: number;
};

export type ScheduleResult = ScheduleSuccess | ScheduleFailure;

/**
 * Server-side schedule a LinkedIn publish via the FastAPI backend. The
 * backend writes the scheduledPosts row AND provisions the one-shot
 * EventBridge schedule. Never throws.
 */
export async function scheduleLinkedInPost(
  args: ScheduleLinkedInArgs,
): Promise<ScheduleResult> {
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser ?? null;
  if (!currentUser) {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken();
  } catch {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  const baseUrl = getBackendApiBaseUrl();
  const body = {
    userId: args.userId,
    scheduledForMs: args.scheduledForMs,
    platforms: ['linkedin'],
    ideaId: args.ideaId,
    angleId: args.angleId,
    ideaTopic: args.ideaTopic,
    angleTitle: args.angleTitle,
    articleTitle: args.articleTitle,
    contentSnapshot: { linkedin: args.contentSnapshotLinkedIn },
    visibility: args.visibility ?? 'PUBLIC',
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/publish/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { success: false, error: 'network', status: 0 };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    return { success: false, error: 'network', status: 0 };
  }

  if (response.ok && parsed && parsed.success === true) {
    return {
      success: true,
      scheduledPostId: asString(parsed.scheduledPostId),
      eventBridgeScheduleName:
        typeof parsed.eventBridgeScheduleName === 'string'
          ? parsed.eventBridgeScheduleName
          : null,
    };
  }

  const detail =
    typeof parsed?.detail === 'string'
      ? parsed.detail
      : typeof parsed?.error === 'string'
      ? parsed.error
      : 'unknown';
  return { success: false, error: detail, status: response.status || 0 };
}
```

### Change 9 — Update the Publish page to call the new wrapper

In `frontend/src/app/(app)/publish/page.tsx`:

- **Add the import** at the top (line 14 area):
  ```ts
  import { publishLinkedInNow, scheduleLinkedInPost } from '@/lib/publish';
  ```

- **Replace the body of `schedulePost`** (current location: lines 592–659). Keep the same outer signature and the same input-validation pre-checks (lines 593–615 — sign-in guard, firebase guard, date parse, future-time guard). Replace the Firestore write block (lines 617–656) with:

```ts
    const platformLabel = formatPlatformLabel(platform);
    setSchedulingByKey((previous) => ({ ...previous, [scheduleKey]: true }));
    try {
      // Capture the platform copy AT schedule time so a later edit to the
      // adaptation doc cannot change what the scheduler posts.
      const editingTextForCard = asTrimmedString(draftByKey[scheduleKey]);
      const persistedText = asTrimmedString(adaptation.platforms[platform]);
      const snapshotText = editingByKey[scheduleKey] && editingTextForCard
        ? editingTextForCard
        : persistedText;

      if (!snapshotText) {
        setNotice({ tone: 'error', message: `No ${platformLabel} content captured to schedule.` });
        return;
      }

      // LinkedIn is the only platform currently routed through the server.
      // Non-LinkedIn schedules continue to use the legacy direct-Firestore path
      // until those publishers ship (see specs/automation.md Known Gaps).
      if (platform !== 'linkedin') {
        const scheduledDocRef = doc(collection(db, 'users', currentUid, 'scheduledPosts'));
        await setDoc(scheduledDocRef, {
          ideaId: adaptation.ideaId,
          angleId: adaptation.angleId,
          ideaTopic: articleTitle,
          angleTitle: angleLabel,
          articleTitle,
          platforms: [platform],
          scheduledForMs,
          scheduledForIso: new Date(scheduledForMs).toISOString(),
          status: 'scheduled',
          contentSnapshot: { [platform]: snapshotText },
          visibility: 'PUBLIC',
          attemptCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: false });
        setNotice({
          tone: 'success',
          message: `Scheduled ${platformLabel} reminder "${articleTitle}" for ${new Date(scheduledForMs).toLocaleString()}.`,
        });
        return;
      }

      const result = await scheduleLinkedInPost({
        userId: currentUid,
        scheduledForMs,
        ideaId: adaptation.ideaId,
        angleId: adaptation.angleId,
        ideaTopic: articleTitle,
        angleTitle: angleLabel,
        articleTitle,
        contentSnapshotLinkedIn: snapshotText,
        visibility: 'PUBLIC',
      });

      if (result.success) {
        setNotice({
          tone: 'success',
          message: `Scheduled LinkedIn post "${articleTitle}" for ${new Date(scheduledForMs).toLocaleString()}. It will fire automatically.`,
        });
        return;
      }

      // Error path — map specific backend slugs to actionable copy.
      if (result.error === 'scheduled_too_soon') {
        setNotice({ tone: 'error', message: 'Pick a time at least one minute in the future.' });
      } else if (result.error === 'missing_linkedin_snapshot') {
        setNotice({ tone: 'error', message: 'LinkedIn copy is empty. Add content before scheduling.' });
      } else if (result.error === 'schedule_provisioning_failed') {
        setNotice({ tone: 'error', message: 'Scheduling backend is temporarily unavailable. Please retry.' });
      } else {
        setNotice({ tone: 'error', message: 'Unable to save the schedule right now. Please try again.' });
      }
    } catch {
      setNotice({ tone: 'error', message: 'Unable to save the schedule right now. Please try again.' });
    } finally {
      setSchedulingByKey((previous) => ({ ...previous, [scheduleKey]: false }));
    }
```

- **Listener (lines 358–407) — unchanged.** It already reads the same Firestore shape; the new `eventBridgeScheduleName` field is additive and not consumed by the UI in this slice.

## 7. Environment & Configuration

### 7.1 New environment variables

Append to `backend/.env.example`:

```bash
# --- AWS / Lambda / EventBridge (Pattern B one-shot scheduler) ---
# All of these are OPTIONAL in local dev. When SCHEDULER_LAMBDA_ARN and
# EVENTBRIDGE_INVOKER_ROLE_ARN are both unset, the eventbridge_scheduler
# service runs in no-op mode (POST /api/v1/publish/schedule still works
# and writes the Firestore row with eventBridgeScheduleName: null).

# AWS region for boto3 clients (scheduler + secretsmanager). Defaults to
# whatever the AWS SDK auto-discovers (Lambda sets this automatically).
# AWS_REGION=us-east-1

# Full ARN of the scheduler Lambda invoked by EventBridge.
# Example: arn:aws:lambda:us-east-1:123456789012:function:marketing-dashboard-scheduler
# SCHEDULER_LAMBDA_ARN=

# IAM role assumed by EventBridge Scheduler to invoke the scheduler Lambda.
# Example: arn:aws:iam::123456789012:role/marketing-dashboard-scheduler-invoker
# EVENTBRIDGE_INVOKER_ROLE_ARN=

# Optional schedule group name. Defaults to "default" if unset.
# EVENTBRIDGE_SCHEDULE_GROUP_NAME=marketing-dashboard

# Secrets Manager secret id (name or ARN) to hydrate into os.environ at
# process startup. Used in Lambda to load FIREBASE_SERVICE_ACCOUNT_JSON,
# ENCRYPTION_KEY, LINKEDIN_CLIENT_SECRET, SCHEDULER_SECRET, etc. without
# storing them plain in Lambda function config.
# SECRETS_MANAGER_SECRET_ID=marketing-dashboard/prod
```

### 7.2 Third-party services

- **AWS EventBridge Scheduler** — the user provisions the schedule group (optional, `default` works), the IAM role for the schedule to assume, and the scheduler Lambda. The developer does not write IaC for these.
- **AWS Secrets Manager** — one JSON secret holds the cross-cutting backend secrets in prod. Local dev keeps using `.env`.
- **AWS Lambda** — two functions (HTTP + scheduler) from one ECR image, arm64.
- **Lambda Function URL** for the HTTP Lambda — replaces the public uvicorn URL. CORS already enforced by FastAPI.

### 7.3 Port/URL changes

- Local dev: no change. `uvicorn app.main:app --reload` on port 8000.
- Production: backend reachable via the HTTP Lambda's Function URL. `NEXT_PUBLIC_API_URL` in the Amplify build env should point at that URL.

## 8. Edge Cases & Risks

1. **AWS env vars missing in prod.** Mitigation: explicit fail-closed in the route — if either env var is set but the boto3 call raises, return 502 and do NOT write the Firestore row. If BOTH env vars are unset, treat as local-dev mode and accept the schedule with `eventBridgeScheduleName: null` (so dev keeps working).
2. **EventBridge succeeds, Firestore write fails.** The route attempts a best-effort `delete_schedule(...)` to avoid a zombie schedule firing on a non-existent row. The Lambda also defends with `publish_one` returning `skipped:missing_doc` if the row is gone.
3. **EventBridge fires before Firestore row is durably visible.** With a 60-second minimum lead, this race is impossible in practice — the schedule cannot fire sooner than the request returns.
4. **Two ticks for one post.** Pattern B fires each schedule exactly once and `ActionAfterCompletion=DELETE` removes the entry; combined with the existing CAS + `postUrn` idempotency short-circuit in `publish_one`, double-posts are impossible.
5. **Schedule naming collision.** Firestore auto-ids are unique; `publish-{scheduled_post_id}` is therefore unique. If a future migration ever generates colliding ids, EventBridge `create_schedule` returns `ConflictException` and the route returns 502 (the operator must investigate).
6. **LinkedIn 401 (token_expired).** Worker writes `status: failed, failureReason: 'token_expired'` and EventBridge deletes the schedule. The user sees the existing "Reconnect LinkedIn" CTA in the Failed Scheduled Posts card. No automatic retry. This matches the documented `automation.md` contract for the existing sweeper path.
7. **Lambda cold start / slow boot crossing `scheduledForMs`.** EventBridge tolerates seconds-level slop. The `publish_one` worker reads `now_ms` only for diagnostic logging — it does not gate publishing on a "due now" check, so a slightly-late fire still publishes.
8. **Mangum + Firebase lazy init.** The Firebase Admin client lazy-initializes on first Firestore call (existing pattern in `firebase_service.py`). On Lambda cold start, the first request pays this once; subsequent invocations reuse the warm client at module scope.
9. **Secrets logging.** `lambda_scheduler` and `publish_one` log only `{scheduledPostId, userId, outcome}`. No post text, no token material. The `secrets_loader` logs only `secret_id` and a count.
10. **Local dev with `NEXT_PUBLIC_API_URL=http://localhost:8000`.** Unchanged — Schedule button calls the local FastAPI, which no-ops the EventBridge call and still writes the row. The existing `POST /api/v1/publish/scheduled/run` sweeper picks the row up.
11. **Account deletion.** `frontend/src/lib/account.ts` deletes `users/{uid}/scheduledPosts/{*}`. EventBridge schedules whose target row was deleted will fire and `publish_one` will return `skipped:missing_doc` (and the schedule auto-deletes). This is acceptable for v1; if the user wants to also nuke the EventBridge schedules at account deletion time, that is a follow-up.
12. **CORS.** No change. FastAPI CORS middleware already allows `FRONTEND_URL`. Lambda Function URL is fronted by FastAPI's CORS layer via Mangum.

## 9. Acceptance Criteria

The Developer agent must verify all of the following before handing back:

### Backend / unit-ish
1. `POST /api/v1/publish/schedule` with a valid Firebase ID token and a future time:
   - Returns 200 with `{success: true, scheduledPostId, eventBridgeScheduleName}`.
   - Writes a Firestore doc at `users/{uid}/scheduledPosts/{scheduledPostId}` with `status: 'scheduled'`, `attemptCount: 0`, `platforms: ['linkedin']`, `contentSnapshot.linkedin === <input>`, `eventBridgeScheduleName === 'publish-<id>'` (when AWS env set) or `null` (when unset).
2. `POST /api/v1/publish/schedule` with `scheduledForMs <= now + 60_000` → HTTP 422 `scheduled_too_soon` and NO Firestore write.
3. `POST /api/v1/publish/schedule` with empty `contentSnapshot.linkedin` → HTTP 422 `missing_linkedin_snapshot` and NO Firestore write.
4. `POST /api/v1/publish/schedule` with no `Authorization` header → HTTP 401.
5. `POST /api/v1/publish/schedule` with `body.userId` ≠ decoded `uid` → HTTP 403 `uid_mismatch`.
6. `POST /api/v1/publish/schedule` with AWS env configured and boto3 mocked to raise → HTTP 502, NO Firestore write.
7. `POST /api/v1/publish/scheduled/run` still functions identically (regression): same envelope shape `{processed, published, failed, results[]}`; zombie sweeper still runs; CAS-claim still works; `postUrn`-idempotency still applies. This is verified by re-running the existing test cases for `/publish/scheduled/run` against the refactored implementation.
8. `scheduler_worker.publish_one(uid, scheduledPostId)` invoked twice for the same row returns `idempotent` on the second call (postUrn already set) and does NOT call LinkedIn a second time.
9. `lambda_scheduler.handler({"scheduledPostId": ..., "userId": ...}, None)` returns a dict whose `status` matches what `publish_one` returned (smoke test by mocking `publish_linkedin_text`).
10. `lambda_scheduler.handler({}, None)` returns `{"status": "skipped", "reason": "invalid_input"}` without raising.
11. `eventbridge_scheduler.create_one_shot_schedule(...)` with no AWS env returns `None` and prints the no-op log line.
12. `eventbridge_scheduler.delete_schedule(...)` against a non-existent schedule swallows `ResourceNotFoundException` (verifiable via mocked boto3 client).
13. `secrets_loader.load_secrets_into_env()` with `SECRETS_MANAGER_SECRET_ID` unset is a no-op and returns immediately.
14. `secrets_loader.load_secrets_into_env()` does NOT overwrite an env var that is already set (explicit-env-wins semantic).
15. `backend/app/main.py` exports `handler` (verifiable via `from app.main import handler`).
16. `backend/Dockerfile.lambda` builds successfully under `docker buildx build --platform linux/arm64 -f backend/Dockerfile.lambda backend/`.

### Frontend / UI
17. Clicking Schedule on a LinkedIn publish card with valid content + a future time + a signed-in user calls `POST /api/v1/publish/schedule` (verifiable in DevTools network tab) and shows the "Scheduled LinkedIn post … for …" success toast.
18. The new doc appears immediately in the "Upcoming Scheduled Posts" panel (existing realtime snapshot listener).
19. Clicking Schedule with a past time produces the "future" validation error before any network call (existing client-side guard at line 613).
20. Clicking Schedule when the backend returns 422 `scheduled_too_soon` shows "Pick a time at least one minute in the future."
21. Non-LinkedIn Schedule buttons (medium / newsletter / blog / twitter) still write directly to Firestore via the legacy path — unchanged behavior — and the resulting doc carries the same shape it did before this change (no `eventBridgeScheduleName` field).
22. `frontend/src/lib/publish.ts` exports `scheduleLinkedInPost` and `publishLinkedInNow` and `npx tsc --noEmit` passes from `frontend/`.

### Specs (must read clean after edits)
23. `specs/automation.md` §5 describes Pattern B (one-shot per-post EventBridge), with the safety-net sweeper called out as planned future work.
24. `specs/automation.md` §1 Schedule a publish reminder describes the server-side write path for LinkedIn and the legacy direct-Firestore path for other platforms.
25. `specs/automation.md` §3 Integration Points table lists `POST /api/v1/publish/schedule`.
26. `specs/automation.md` Testing Requirements covers the new endpoint's success and 422/403/401 paths plus the `eventBridgeScheduleName` field assertion.
27. `specs/backend.md` documents `POST /api/v1/publish/schedule`, the `handler` export, the `scheduler_worker` / `eventbridge_scheduler` / `secrets_loader` modules, and the new env vars.
28. `specs/database.md` adds `eventBridgeScheduleName: string | null` to the `scheduledPosts` schema's "Optional fields" list.
29. `specs/architecture.md` §9 Deployment describes the two-Lambda layout with the shared container image, Function URL fronting, and EventBridge Scheduler. §2 runtime-layers diagram reflects the new flow.

### Branch
30. All work is on branch `aws-lambda-eventbridge-scheduler` off `main`.

### Out of scope (must remain UN-implemented; document only)
31. No safety-net sweeper code. It must appear in `specs/automation.md` under a "Planned" heading only.
32. No reschedule/cancel UI. `update_schedule` and `delete_schedule` are exported and importable but have no caller besides `create_one_shot_schedule` rollback.
33. No non-LinkedIn platform routing through the new endpoint. The endpoint rejects non-LinkedIn `platforms` with HTTP 422 `unsupported_platform`.
34. No Terraform / CDK / SAM. Manual AWS console + CLI setup is performed by the user out-of-band.

---

## Reference paths

Files the developer must touch (all absolute):

- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\routers\publish.py`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\main.py`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\config.py`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\requirements.txt`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\.env.example`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\services\scheduler_worker.py` (new)
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\services\eventbridge_scheduler.py` (new)
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\services\secrets_loader.py` (new)
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\lambda_scheduler.py` (new)
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\Dockerfile.lambda` (new)
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\frontend\src\lib\publish.ts`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\frontend\src\app\(app)\publish\page.tsx`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\specs\automation.md`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\specs\backend.md`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\specs\database.md`
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\specs\architecture.md`

Files read but NOT modified (context for the developer):

- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\services\linkedin_publisher.py` — the `publish_linkedin_text` helper called by `publish_one`. Signature: `async def publish_linkedin_text(*, user_id: str, text: str, visibility: Literal["PUBLIC","CONNECTIONS"] = "PUBLIC") -> PublishOutcome`. Never raises.
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\services\firebase_service.py` — `get_firestore_client()` is the lazy-init entry; safe to call repeatedly.
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\app\auth.py` — `verify_firebase_id_token` dependency raises 401 on malformed/invalid tokens. Use as `Depends(verify_firebase_id_token)`.
- `C:\Users\BLUEK\OneDrive\Documents\GitHub\MarketingDashboard2\backend\Dockerfile` — local-dev image; do NOT modify.

TIP complete. Hand off to Developer.
agentId: afac28a006520e488 (use SendMessage with to: 'afac28a006520e488' to continue this agent)
<usage>total_tokens: 132867
tool_uses: 19
duration_ms: 244222</usage>