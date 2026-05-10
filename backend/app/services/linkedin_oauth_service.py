import hashlib
import secrets
import time
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse

import httpx

from app.config import settings
from app.services.firebase_service import get_firestore_client
from app.services.integration_connection_service import integration_connection_service

LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
LINKEDIN_ACCESS_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo"

# Scope subset sufficient for sign-in. We deliberately do NOT request
# w_member_social during sign-in so users can authenticate without granting
# posting permissions; posting permissions are obtained via the separate
# /auth/linkedin/start "connect" flow on the Settings page.
LINKEDIN_LOGIN_SCOPES = "openid profile email"

# Firestore collection used to track OAuth state for the sign-in flow.
# Distinct from "integrationAuthStates" (used by the connect-for-publishing
# flow) so the two cannot be confused or replayed against each other.
LINKEDIN_LOGIN_STATE_COLLECTION = "linkedinLoginStates"


class LinkedInOAuthService:
    provider = "linkedin"

    def _normalized_scopes(self) -> list[str]:
        return [scope for scope in settings.linkedin_scopes.split() if scope]

    def _ensure_configured(self) -> None:
        if not settings.linkedin_client_id or not settings.linkedin_client_secret:
            raise ValueError("LinkedIn OAuth is not configured. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.")

    def _normalize_redirect_after(self, redirect_after: str | None) -> str:
        if not redirect_after:
            return "/settings"

        trimmed = redirect_after.strip()
        if not trimmed:
            return "/settings"

        if trimmed.startswith("/"):
            return trimmed

        parsed = urlparse(trimmed)
        frontend_origin = urlparse(settings.frontend_url)
        if parsed.scheme in {"http", "https"} and parsed.netloc == frontend_origin.netloc:
            suffix = parsed.path or "/settings"
            if parsed.query:
                suffix = f"{suffix}?{parsed.query}"
            return suffix

        return "/settings"

    def _frontend_redirect_url(self, path: str, status: str, message: str | None = None) -> str:
        params = {"integration": self.provider, "status": status}
        if message:
            params["message"] = message
        target = f"{path}?{urlencode(params)}"
        return urljoin(f"{settings.frontend_url.rstrip('/')}/", target.lstrip("/"))

    async def start_authorization(self, *, user_id: str, redirect_after: str | None) -> dict[str, Any]:
        self._ensure_configured()
        state = secrets.token_urlsafe(32)
        normalized_redirect = self._normalize_redirect_after(redirect_after)
        integration_connection_service.store_oauth_state(
            provider=self.provider,
            user_id=user_id,
            raw_state=state,
            redirect_after=normalized_redirect,
        )

        query = {
            "response_type": "code",
            "client_id": settings.linkedin_client_id,
            "redirect_uri": settings.resolved_linkedin_redirect_uri,
            "state": state,
            "scope": " ".join(self._normalized_scopes()),
        }
        return {
            "provider": self.provider,
            "authorizeUrl": f"{LINKEDIN_AUTHORIZE_URL}?{urlencode(query)}",
            "scopes": self._normalized_scopes(),
        }

    async def _exchange_code(self, code: str) -> dict[str, Any]:
        self._ensure_configured()
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                LINKEDIN_ACCESS_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.linkedin_client_id,
                    "client_secret": settings.linkedin_client_secret,
                    "redirect_uri": settings.resolved_linkedin_redirect_uri,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if response.status_code >= 400:
            try:
                error_payload = response.json()
            except Exception:
                error_payload = {"message": response.text}
            raise ValueError(f"LinkedIn token exchange failed: {error_payload}")

        return response.json()

    async def _fetch_userinfo(self, access_token: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                LINKEDIN_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if response.status_code >= 400:
            try:
                error_payload = response.json()
            except Exception:
                error_payload = {"message": response.text}
            raise ValueError(f"LinkedIn userinfo lookup failed: {error_payload}")

        return response.json()

    async def complete_authorization(
        self,
        *,
        code: str | None,
        raw_state: str | None,
        error: str | None,
        error_description: str | None,
    ) -> tuple[str, dict[str, Any] | None]:
        if not raw_state:
            raise ValueError("LinkedIn callback is missing state.")

        state_payload = integration_connection_service.pop_oauth_state(provider=self.provider, raw_state=raw_state)
        redirect_after = state_payload.get("redirectAfter") or "/settings"

        if error:
            return self._frontend_redirect_url(str(redirect_after), "error", error_description or error), None

        if not code:
            raise ValueError("LinkedIn callback is missing code.")

        token_payload = await self._exchange_code(code)
        access_token = str(token_payload.get("access_token") or "").strip()
        if not access_token:
            raise ValueError("LinkedIn token exchange did not return an access token.")

        profile = await self._fetch_userinfo(access_token)
        member_sub = str(profile.get("sub") or "").strip()
        if not member_sub:
            raise ValueError("LinkedIn userinfo response did not include a member id.")

        expires_in = int(token_payload.get("expires_in") or 0)
        now_ms = int(time.time() * 1000)
        expires_at_ms = now_ms + (expires_in * 1000) if expires_in > 0 else None
        scopes = [scope for scope in str(token_payload.get("scope") or settings.linkedin_scopes).split() if scope]
        author_urn = f"urn:li:person:{member_sub}"

        summary = integration_connection_service.upsert_connection(
            user_id=str(state_payload.get("userId") or "").strip(),
            provider=self.provider,
            auth_type="oauth2",
            account_id=member_sub,
            account_urn=author_urn,
            display_name=str(profile.get("name") or "").strip() or None,
            email=str(profile.get("email") or "").strip() or None,
            picture_url=str(profile.get("picture") or "").strip() or None,
            scopes=scopes,
            token_expires_at_ms=expires_at_ms,
            has_refresh_token=bool(token_payload.get("refresh_token")),
            metadata={
                "publishAuthorUrn": author_urn,
                "oauthProvider": self.provider,
                "supportsDirectPublish": True,
            },
            secret_payload={
                "accessToken": access_token,
                "refreshToken": token_payload.get("refresh_token"),
                "idToken": token_payload.get("id_token"),
                "tokenType": token_payload.get("token_type") or "Bearer",
                "scope": " ".join(scopes),
                "metadata": {"linkedinMemberSub": member_sub},
            },
        )
        return self._frontend_redirect_url(str(redirect_after), "connected"), summary

    # ------------------------------------------------------------------
    # Sign-in (Firebase custom token) flow
    # ------------------------------------------------------------------

    def _login_state_ref(self, state_hash: str):
        return get_firestore_client().collection(LINKEDIN_LOGIN_STATE_COLLECTION).document(state_hash)

    def _login_redirect_target(self) -> str:
        configured = (settings.linkedin_redirect_uri or "").strip()
        if configured:
            # If the user overrode the connect callback, swap the trailing
            # segment so the login callback lives next to it.
            if configured.endswith("/callback"):
                return configured[: -len("/callback")] + "/login/callback"
            if configured.endswith("/auth/linkedin"):
                return configured + "/login/callback"
        return f"{settings.backend_url.rstrip('/')}/api/v1/auth/linkedin/login/callback"

    def _frontend_login_redirect_url(self, *, status: str, token: str | None = None, message: str | None = None) -> str:
        params: dict[str, str] = {"linkedinStatus": status}
        if token:
            params["linkedinToken"] = token
        if message:
            params["linkedinMessage"] = message
        target = f"/login?{urlencode(params)}"
        return urljoin(f"{settings.frontend_url.rstrip('/')}/", target.lstrip("/"))

    async def start_login(self) -> dict[str, Any]:
        """Build the LinkedIn OAuth URL for a sign-in attempt.

        Unlike start_authorization, this flow is not bound to an existing
        Firebase user id — it is the mechanism by which a user FIRST signs
        in (or signs up) via LinkedIn.
        """
        self._ensure_configured()
        state = secrets.token_urlsafe(32)
        state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
        now_ms = int(time.time() * 1000)
        self._login_state_ref(state_hash).set(
            {
                "purpose": "login",
                "createdAtMs": now_ms,
                "expiresAtMs": now_ms + (15 * 60 * 1000),  # 15 minutes
            },
            merge=False,
        )

        query = {
            "response_type": "code",
            "client_id": settings.linkedin_client_id,
            "redirect_uri": self._login_redirect_target(),
            "state": state,
            "scope": LINKEDIN_LOGIN_SCOPES,
        }
        return {
            "provider": self.provider,
            "purpose": "login",
            "authorizeUrl": f"{LINKEDIN_AUTHORIZE_URL}?{urlencode(query)}",
            "scopes": LINKEDIN_LOGIN_SCOPES.split(),
        }

    async def _exchange_login_code(self, code: str) -> dict[str, Any]:
        self._ensure_configured()
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                LINKEDIN_ACCESS_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.linkedin_client_id,
                    "client_secret": settings.linkedin_client_secret,
                    "redirect_uri": self._login_redirect_target(),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if response.status_code >= 400:
            try:
                error_payload = response.json()
            except Exception:
                error_payload = {"message": response.text}
            raise ValueError(f"LinkedIn token exchange failed: {error_payload}")

        return response.json()

    def _pop_login_state(self, raw_state: str) -> dict[str, Any]:
        state_hash = hashlib.sha256(raw_state.encode("utf-8")).hexdigest()
        ref = self._login_state_ref(state_hash)
        snapshot = ref.get()
        if not snapshot.exists:
            raise ValueError("LinkedIn login state not found or already used.")
        payload = snapshot.to_dict() or {}
        ref.delete()
        expires_at_ms = int(payload.get("expiresAtMs") or 0)
        if expires_at_ms and expires_at_ms < int(time.time() * 1000):
            raise ValueError("LinkedIn login state has expired.")
        if payload.get("purpose") != "login":
            raise ValueError("LinkedIn login state purpose mismatch.")
        return payload

    def _ensure_firebase_user(self, *, email: str, display_name: str | None, picture_url: str | None) -> str:
        """Look up a Firebase Auth user by email, creating one if needed.

        Returns the Firebase uid.
        """
        # Import lazily so the module remains importable when firebase_admin
        # is not yet initialized (test contexts, missing creds, etc.).
        from firebase_admin import auth as firebase_auth

        # Make sure the Admin SDK is initialized (firebase_service does this).
        get_firestore_client()

        try:
            user = firebase_auth.get_user_by_email(email)
            updates: dict[str, Any] = {}
            if display_name and user.display_name != display_name:
                updates["display_name"] = display_name
            if picture_url and user.photo_url != picture_url:
                updates["photo_url"] = picture_url
            if updates:
                firebase_auth.update_user(user.uid, **updates)
            return user.uid
        except firebase_auth.UserNotFoundError:
            user = firebase_auth.create_user(
                email=email,
                email_verified=True,
                display_name=display_name or None,
                photo_url=picture_url or None,
            )
            return user.uid

    async def complete_login(
        self,
        *,
        code: str | None,
        raw_state: str | None,
        error: str | None,
        error_description: str | None,
    ) -> str:
        """Complete a LinkedIn sign-in and return a frontend redirect URL.

        On success, the redirect URL carries a Firebase custom token in the
        `linkedinToken` query string; the frontend exchanges it via
        signInWithCustomToken to establish a Firebase session.
        """
        if not raw_state:
            return self._frontend_login_redirect_url(status="error", message="missing_state")

        try:
            self._pop_login_state(raw_state)
        except ValueError as exc:
            return self._frontend_login_redirect_url(status="error", message=str(exc))

        if error:
            return self._frontend_login_redirect_url(status="error", message=error_description or error)

        if not code:
            return self._frontend_login_redirect_url(status="error", message="missing_code")

        try:
            token_payload = await self._exchange_login_code(code)
        except ValueError as exc:
            return self._frontend_login_redirect_url(status="error", message=str(exc))

        access_token = str(token_payload.get("access_token") or "").strip()
        if not access_token:
            return self._frontend_login_redirect_url(status="error", message="no_access_token")

        try:
            profile = await self._fetch_userinfo(access_token)
        except ValueError as exc:
            return self._frontend_login_redirect_url(status="error", message=str(exc))

        email = str(profile.get("email") or "").strip().lower()
        if not email:
            return self._frontend_login_redirect_url(
                status="error",
                message="LinkedIn did not return an email. Make sure your LinkedIn app requests the 'email' scope.",
            )

        display_name = str(profile.get("name") or "").strip() or None
        picture_url = str(profile.get("picture") or "").strip() or None

        try:
            uid = self._ensure_firebase_user(
                email=email,
                display_name=display_name,
                picture_url=picture_url,
            )
        except Exception as exc:  # pragma: no cover - surfaced to the user as a generic message
            return self._frontend_login_redirect_url(
                status="error",
                message=f"firebase_user_setup_failed: {exc}",
            )

        try:
            from firebase_admin import auth as firebase_auth

            custom_token = firebase_auth.create_custom_token(uid).decode("utf-8")
        except Exception as exc:  # pragma: no cover
            return self._frontend_login_redirect_url(
                status="error",
                message=f"custom_token_mint_failed: {exc}",
            )

        return self._frontend_login_redirect_url(status="success", token=custom_token)


linkedin_oauth_service = LinkedInOAuthService()