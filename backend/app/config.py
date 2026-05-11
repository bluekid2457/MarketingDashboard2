from pydantic_settings import BaseSettings, SettingsConfigDict

from app.services.secrets_loader import load_secrets_into_env

# Hydrate environment variables from Secrets Manager BEFORE Settings reads
# from the environment. No-op in local dev (when SECRETS_MANAGER_SECRET_ID
# is unset).
load_secrets_into_env()


class Settings(BaseSettings):
    secret_key: str = "changeme"
    encryption_key: str = "changeme"
    frontend_url: str = "http://localhost:3000"
    backend_url: str = "http://localhost:8000"
    debug: bool = False

    firebase_project_id: str | None = None
    firebase_client_email: str | None = None
    firebase_private_key: str | None = None
    firebase_service_account_json: str | None = None
    firebase_credentials_path: str | None = None

    linkedin_client_id: str | None = None
    linkedin_client_secret: str | None = None
    linkedin_redirect_uri: str | None = None
    linkedin_scopes: str = "openid profile email w_member_social"

    # Shared secret required by POST /api/v1/publish/scheduled/run. Set in
    # production via secret manager -- when unset, the route fails closed with
    # a 503 (`scheduler_disabled`).
    scheduler_secret: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def resolved_linkedin_redirect_uri(self) -> str:
        configured = (self.linkedin_redirect_uri or "").strip()
        if configured:
            return configured
        return f"{self.backend_url.rstrip('/')}" + "/api/v1/auth/linkedin/callback"


settings = Settings()
