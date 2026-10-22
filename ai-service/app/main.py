from fastapi import FastAPI, Request # type: ignore
from fastapi.responses import JSONResponse
from app.core.config import get_settings

from app.routers import (
    resume,
    github,
    scoring,
    interview,
    integrity,
    feedback
)

app = FastAPI(
    title="AI Recruitment AI Service"
)


@app.middleware("http")
async def verify_internal_secret(request: Request, call_next):
    if request.url.path in {"/", "/docs", "/openapi.json"} or request.method == "OPTIONS":
        return await call_next(request)

    if request.url.path.startswith("/ai"):
        settings = get_settings()
        secret = request.headers.get("X-Internal-Secret")
        if not secret or secret != settings.INTERNAL_SERVICE_KEY:
            return JSONResponse(
                status_code=403,
                content={"detail": "Forbidden: Invalid or missing internal service secret"},
            )

    return await call_next(request)


app.include_router(
    resume.router,
    prefix="/ai"
)

app.include_router(
    github.router,
    prefix="/ai"
)

app.include_router(
    scoring.router,
    prefix="/ai"
)

app.include_router(
    interview.router,
    prefix="/ai"
)

app.include_router(
    integrity.router,
    prefix="/ai"
)
app.include_router(
    feedback.router,
    prefix="/ai"
)


@app.get("/")
def root():

    return {
        "message":
        "Hirelens AI Service Running"
    }
