from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from app.config import settings
from app.routers.integrations import router as integrations_router
from app.routers.linkedin import router as linkedin_router
from app.routers.publish import router as publish_router

app = FastAPI(
    title="Marketing Dashboard API",
    version="0.1.0",
    description="Backend API for the AI-powered Marketing Dashboard",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Health"])
async def health_check():
    """Returns service health status."""
    return {"status": "healthy"}


app.include_router(linkedin_router, prefix="/api/v1")
app.include_router(integrations_router, prefix="/api/v1")
app.include_router(publish_router, prefix="/api/v1")

# Lambda adapter -- exported as `handler` so the HTTP Lambda can use
# `app.main.handler` as its entry point. `lifespan="off"` skips ASGI
# lifespan events that don't make sense in Lambda's request-scoped runtime.
handler = Mangum(app, lifespan="off")
