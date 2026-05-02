import hashlib
import time
from typing import Any

from firebase_admin import firestore

from app.services.encryption import encryption_service
from app.services.firebase_service import get_firestore_client
from app.services.provider_registry import get_provider_definition, list_provider_definitions


class IntegrationConnectionService:
    def __init__(self) -> None:
        self._db = None

    @property
    def db(self):
        if self._db is None:
            self._db = get_firestore_client()
        return self._db

    def _summary_ref(self, user_id: str, provider: str):
        return self.db.collection("users").document(user_id).collection("integrationConnections").document(provider)

    def _secret_ref(self, user_id: str, provider: str):
        key = f"{user_id}__{provider}"
        return self.db.collection("integrationSecrets").document(key)

    def _state_ref(self, state_hash: str):
        return self.db.collection("integrationAuthStates").document(state_hash)

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _public_summary(self, provider: str, data: dict[str, Any] | None) -> dict[str, Any]:
        definition = get_provider_definition(provider)
        summary = {
            "provider": definition.slug,
            "label": definition.label,
            "authTypes": list(definition.auth_types),
            "supportsDirectPublish": definition.supports_direct_publish,
            "supportsScheduledPublish": definition.supports_scheduled_publish,
            "oauthStrategy": definition.oauth_strategy,
            "supportedContentTypes": list(definition.supported_content_types),
            "status": "not_connected",
        }
        if not data:
            return summary

        summary.update(
            {
                "status": data.get("status") or "not_connected",
                "authType": data.get("authType"),
                "accountId": data.get("accountId"),
                "accountUrn": data.get("accountUrn"),
                "displayName": data.get("displayName"),
                "email": data.get("email"),
                "pictureUrl": data.get("pictureUrl"),
                "scopes": data.get("scopes") or [],
                "connectedAtMs": data.get("connectedAtMs"),
                "updatedAtMs": data.get("updatedAtMs"),
                "tokenExpiresAtMs": data.get("tokenExpiresAtMs"),
                "hasRefreshToken": bool(data.get("hasRefreshToken")),
                "metadata": data.get("metadata") or {},
            },
        )
        return summary

    def list_connections(self, user_id: str) -> list[dict[str, Any]]:
        snapshot = self.db.collection("users").document(user_id).collection("integrationConnections").stream()
        existing = {document.id: document.to_dict() for document in snapshot}
        return [self._public_summary(definition.slug, existing.get(definition.slug)) for definition in list_provider_definitions()]

    def get_connection(self, user_id: str, provider: str) -> dict[str, Any]:
        get_provider_definition(provider)
        snapshot = self._summary_ref(user_id, provider).get()
        return self._public_summary(provider, snapshot.to_dict() if snapshot.exists else None)

    def store_oauth_state(
        self,
        *,
        provider: str,
        user_id: str,
        raw_state: str,
        redirect_after: str | None,
        expires_in_seconds: int = 900,
    ) -> None:
        state_hash = hashlib.sha256(raw_state.encode("utf-8")).hexdigest()
        now_ms = self._now_ms()
        expires_at_ms = now_ms + (expires_in_seconds * 1000)
        self._state_ref(state_hash).set(
            {
                "provider": provider,
                "userId": user_id,
                "redirectAfter": redirect_after,
                "createdAtMs": now_ms,
                "expiresAtMs": expires_at_ms,
                "createdAt": firestore.SERVER_TIMESTAMP,
            },
            merge=False,
        )

    def pop_oauth_state(self, *, provider: str, raw_state: str) -> dict[str, Any]:
        state_hash = hashlib.sha256(raw_state.encode("utf-8")).hexdigest()
        ref = self._state_ref(state_hash)
        snapshot = ref.get()
        if not snapshot.exists:
            raise ValueError("OAuth state not found or already used.")

        payload = snapshot.to_dict() or {}
        ref.delete()

        if payload.get("provider") != provider:
            raise ValueError("OAuth state provider mismatch.")

        expires_at_ms = int(payload.get("expiresAtMs") or 0)
        if expires_at_ms and expires_at_ms < self._now_ms():
            raise ValueError("OAuth state has expired.")

        return payload

    def upsert_connection(
        self,
        *,
        user_id: str,
        provider: str,
        auth_type: str,
        account_id: str | None,
        account_urn: str | None,
        display_name: str | None,
        email: str | None,
        picture_url: str | None,
        scopes: list[str],
        token_expires_at_ms: int | None,
        has_refresh_token: bool,
        metadata: dict[str, Any] | None,
        secret_payload: dict[str, Any] | None,
        status: str = "connected",
    ) -> dict[str, Any]:
        definition = get_provider_definition(provider)
        now_ms = self._now_ms()
        summary_doc = {
            "provider": provider,
            "label": definition.label,
            "status": status,
            "authType": auth_type,
            "accountId": account_id,
            "accountUrn": account_urn,
            "displayName": display_name,
            "email": email,
            "pictureUrl": picture_url,
            "scopes": scopes,
            "tokenExpiresAtMs": token_expires_at_ms,
            "hasRefreshToken": has_refresh_token,
            "metadata": metadata or {},
            "updatedAtMs": now_ms,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }

        existing = self._summary_ref(user_id, provider).get()
        if not existing.exists:
            summary_doc["connectedAtMs"] = now_ms
            summary_doc["connectedAt"] = firestore.SERVER_TIMESTAMP

        self._summary_ref(user_id, provider).set(summary_doc, merge=True)

        if secret_payload is not None:
            encrypted_doc = {
                "provider": provider,
                "userId": user_id,
                "authType": auth_type,
                "updatedAtMs": now_ms,
                "updatedAt": firestore.SERVER_TIMESTAMP,
                "accessTokenEnc": encryption_service.encrypt(secret_payload.get("accessToken")),
                "refreshTokenEnc": encryption_service.encrypt(secret_payload.get("refreshToken")),
                "idTokenEnc": encryption_service.encrypt(secret_payload.get("idToken")),
                "tokenType": secret_payload.get("tokenType"),
                "scope": secret_payload.get("scope"),
                "expiresAtMs": token_expires_at_ms,
                "metadata": secret_payload.get("metadata") or {},
            }
            self._secret_ref(user_id, provider).set(encrypted_doc, merge=True)

        return self.get_connection(user_id, provider)

    def store_manual_tokens(
        self,
        *,
        user_id: str,
        provider: str,
        auth_type: str,
        access_token: str | None,
        refresh_token: str | None,
        id_token: str | None,
        token_type: str | None,
        scopes: list[str],
        expires_at_ms: int | None,
        account_id: str | None,
        account_urn: str | None,
        display_name: str | None,
        email: str | None,
        picture_url: str | None,
        metadata: dict[str, Any] | None,
    ) -> dict[str, Any]:
        return self.upsert_connection(
            user_id=user_id,
            provider=provider,
            auth_type=auth_type,
            account_id=account_id,
            account_urn=account_urn,
            display_name=display_name,
            email=email,
            picture_url=picture_url,
            scopes=scopes,
            token_expires_at_ms=expires_at_ms,
            has_refresh_token=bool(refresh_token),
            metadata=metadata,
            secret_payload={
                "accessToken": access_token,
                "refreshToken": refresh_token,
                "idToken": id_token,
                "tokenType": token_type,
                "scope": " ".join(scopes),
                "metadata": metadata or {},
            },
        )

    def get_decrypted_tokens(self, user_id: str, provider: str) -> dict[str, Any] | None:
        snapshot = self._secret_ref(user_id, provider).get()
        if not snapshot.exists:
            return None

        payload = snapshot.to_dict() or {}
        return {
            "provider": payload.get("provider"),
            "userId": payload.get("userId"),
            "authType": payload.get("authType"),
            "accessToken": encryption_service.decrypt(payload.get("accessTokenEnc")),
            "refreshToken": encryption_service.decrypt(payload.get("refreshTokenEnc")),
            "idToken": encryption_service.decrypt(payload.get("idTokenEnc")),
            "tokenType": payload.get("tokenType"),
            "scope": payload.get("scope"),
            "expiresAtMs": payload.get("expiresAtMs"),
            "metadata": payload.get("metadata") or {},
        }

    def disconnect(self, user_id: str, provider: str) -> dict[str, Any]:
        get_provider_definition(provider)
        now_ms = self._now_ms()
        self._summary_ref(user_id, provider).set(
            {
                "provider": provider,
                "status": "disconnected",
                "updatedAtMs": now_ms,
                "updatedAt": firestore.SERVER_TIMESTAMP,
                "disconnectedAtMs": now_ms,
                "disconnectedAt": firestore.SERVER_TIMESTAMP,
                "hasRefreshToken": False,
                "tokenExpiresAtMs": None,
            },
            merge=True,
        )
        self._secret_ref(user_id, provider).delete()
        return self.get_connection(user_id, provider)


integration_connection_service = IntegrationConnectionService()