"""Hydrate environment variables from AWS Secrets Manager at process start.

Why: Lambda functions read most config from environment variables, but the
Firebase service-account JSON and the LinkedIn client secret are too long
for Lambda's per-variable size limit and too sensitive to leave plain in
the function config. We store them in one Secrets Manager secret as a JSON
blob and hydrate them into os.environ before anything else imports config.

Behavior:
  * Reads SECRETS_MANAGER_SECRET_ID. Unset -> return immediately (local dev).
  * Fetches the secret value as JSON. Each top-level key is set into
    os.environ ONLY IF the key is not already set (explicit env vars win).
  * All failures are caught and logged -- never crash the process.

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
        import boto3  # lazy import -- local dev without boto3 still works

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
