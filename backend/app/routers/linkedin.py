from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.services.linkedin_oauth_service import linkedin_oauth_service

router = APIRouter(tags=["LinkedIn"])


class LinkedInStartRequest(BaseModel):
    user_id: str = Field(alias="userId", min_length=1)
    redirect_after: str | None = Field(alias="redirectAfter", default=None)


@router.post("/auth/linkedin/start")
async def start_linkedin_auth(request: LinkedInStartRequest) -> dict[str, object]:
    try:
        return await linkedin_oauth_service.start_authorization(
            user_id=request.user_id,
            redirect_after=request.redirect_after,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/auth/linkedin/callback")
async def linkedin_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(alias="error_description", default=None),
):
    try:
        redirect_url, _connection = await linkedin_oauth_service.complete_authorization(
            code=code,
            raw_state=state,
            error=error,
            error_description=error_description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return RedirectResponse(url=redirect_url, status_code=302)