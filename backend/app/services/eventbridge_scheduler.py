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

    Format: ``at(YYYY-MM-DDTHH:MM:SS)`` -- no offset, no fractional seconds.
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
    configured (local dev) -- the caller still writes the Firestore row.

    Raises (and the caller catches) if AWS is configured but the boto3
    call fails -- see the "atomic-ish" handling in the route.
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

    Pattern B has no UI consumer yet -- this helper is exported for the
    upcoming reschedule/cancel UI work documented in
    ``specs/automation.md`` Known Gaps.
    """
    delete_schedule(scheduled_post_id)
    create_one_shot_schedule(scheduled_post_id, user_id, new_fire_at_ms)
