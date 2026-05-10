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


@router.post("/auth/linkedin/login/start")
async def start_linkedin_login() -> dict[str, object]:
    """Begin a LinkedIn-based sign-in attempt.

    No user_id is required — this endpoint is anonymous and is how a brand
    new visitor (or an existing user who chose "Sign in with LinkedIn")
    enters the application.
    """
    try:
        return await linkedin_oauth_service.start_login()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/auth/linkedin/login/callback")
async def linkedin_login_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(alias="error_description", default=None),
):
    """OAuth redirect target for the LinkedIn sign-in flow.

    Always redirects back to the frontend `/login` page with a status query
    parameter; on success the redirect carries a Firebase custom token that
    the frontend exchanges via signInWithCustomToken.
    """
    redirect_url = await linkedin_oauth_service.complete_login(
        code=code,
        raw_state=state,
        error=error,
        error_description=error_description,
    )
    return RedirectResponse(url=redirect_url, status_code=302)