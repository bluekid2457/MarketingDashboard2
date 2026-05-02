import secrets
import time
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse

import httpx

from app.config import settings
from app.services.integration_connection_service import integration_connection_service

LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
LINKEDIN_ACCESS_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo"


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


linkedin_oauth_service = LinkedInOAuthService()