from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.integration_connection_service import integration_connection_service
from app.services.provider_registry import get_provider_definition, list_provider_definitions

router = APIRouter(tags=["Integrations"])


class DisconnectRequest(BaseModel):
    user_id: str = Field(alias="userId", min_length=1)


class ManualTokenStoreRequest(BaseModel):
    user_id: str = Field(alias="userId", min_length=1)
    auth_type: str = Field(alias="authType", default="oauth2", min_length=1)
    access_token: str | None = Field(alias="accessToken", default=None)
    refresh_token: str | None = Field(alias="refreshToken", default=None)
    id_token: str | None = Field(alias="idToken", default=None)
    token_type: str | None = Field(alias="tokenType", default=None)
    expires_at_ms: int | None = Field(alias="expiresAtMs", default=None)
    expires_in: int | None = Field(alias="expiresIn", default=None)
    scopes: list[str] = Field(default_factory=list)
    account_id: str | None = Field(alias="accountId", default=None)
    account_urn: str | None = Field(alias="accountUrn", default=None)
    display_name: str | None = Field(alias="displayName", default=None)
    email: str | None = None
    picture_url: str | None = Field(alias="pictureUrl", default=None)
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.get("/integrations/providers")
async def list_providers() -> dict[str, object]:
    return {"providers": [definition.to_public_dict() for definition in list_provider_definitions()]}


@router.get("/integrations/status")
async def list_integration_status(user_id: str = Query(alias="userId", min_length=1)) -> dict[str, object]:
    return {"connections": integration_connection_service.list_connections(user_id)}


@router.get("/integrations/{provider}/status")
async def provider_status(provider: str, user_id: str = Query(alias="userId", min_length=1)) -> dict[str, object]:
    try:
        connection = integration_connection_service.get_connection(user_id, provider)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"connection": connection}


@router.post("/integrations/{provider}/tokens")
async def store_provider_tokens(provider: str, request: ManualTokenStoreRequest) -> dict[str, object]:
    try:
        get_provider_definition(provider)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not any([request.access_token, request.refresh_token, request.id_token]):
        raise HTTPException(status_code=400, detail="At least one token value must be provided.")

    expires_at_ms = request.expires_at_ms
    if expires_at_ms is None and request.expires_in is not None:
        expires_at_ms = int(__import__("time").time() * 1000) + (request.expires_in * 1000)

    connection = integration_connection_service.store_manual_tokens(
        user_id=request.user_id,
        provider=provider,
        auth_type=request.auth_type,
        access_token=request.access_token,
        refresh_token=request.refresh_token,
        id_token=request.id_token,
        token_type=request.token_type,
        scopes=[scope.strip() for scope in request.scopes if scope.strip()],
        expires_at_ms=expires_at_ms,
        account_id=request.account_id,
        account_urn=request.account_urn,
        display_name=request.display_name,
        email=request.email,
        picture_url=request.picture_url,
        metadata=request.metadata,
    )
    return {"connection": connection}


@router.post("/integrations/{provider}/disconnect")
async def disconnect_provider(provider: str, request: DisconnectRequest) -> dict[str, object]:
    try:
        connection = integration_connection_service.disconnect(request.user_id, provider)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"connection": connection}