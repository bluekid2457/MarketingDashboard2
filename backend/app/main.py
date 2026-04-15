from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

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


# Router inclusion placeholder
# from app.routers import some_router
# app.include_router(some_router.router, prefix="/api/v1")
