import base64
import hashlib

from cryptography.fernet import Fernet

from app.config import settings


def _coerce_fernet_key(raw_value: str) -> bytes:
    normalized = raw_value.strip().encode("utf-8")
    try:
        Fernet(normalized)
        return normalized
    except Exception:
        digest = hashlib.sha256(normalized).digest()
        return base64.urlsafe_b64encode(digest)


class EncryptionService:
    def __init__(self, secret: str | None = None) -> None:
        fallback = settings.secret_key if settings.secret_key != "changeme" else "marketing-dashboard-dev-secret"
        active_secret = (secret or settings.encryption_key or fallback).strip() or fallback
        self._fernet = Fernet(_coerce_fernet_key(active_secret))

    def encrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        return self._fernet.encrypt(normalized.encode("utf-8")).decode("utf-8")

    def decrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        return self._fernet.decrypt(normalized.encode("utf-8")).decode("utf-8")


encryption_service = EncryptionService()