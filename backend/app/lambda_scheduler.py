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
        # EventBridge `detail` envelope (defensive -- not used in Pattern B today)
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
    regardless of return value -- there is no retry attempt on the schedule
    side. Any retry is owned by the future safety-net sweeper.
    """
    payload = _normalize_event(event)
    scheduled_post_id = str(payload.get("scheduledPostId") or "").strip()
    user_id = str(payload.get("userId") or "").strip()

    if not scheduled_post_id or not user_id:
        print("[lambda_scheduler] invalid_input: missing scheduledPostId or userId")
        return {"status": "skipped", "reason": "invalid_input"}

    try:
        outcome = asyncio.run(publish_one(user_id=user_id, scheduled_post_id=scheduled_post_id))
    except Exception as exc:
        # publish_one is documented as never raising; this is a defensive
        # catch-all so a Lambda crash does not surface as an opaque 500.
        print(f"[lambda_scheduler] unexpected_exception: {type(exc).__name__}")
        return {
            "status": "failed",
            "scheduledPostId": scheduled_post_id,
            "userId": user_id,
            "error": "unknown",
        }

    # Outcome dict already has the right shape; safe to return as-is.
    return outcome
