"""Fabryka aplikacji FastAPI: API + interfejs (SPA) + zadania w tle."""

from __future__ import annotations

import logging
import logging.handlers
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import APP_NAME, APP_VERSION
from .api import api_router
from .config import Settings, app_root, load_settings
from .db import database, session_scope
from .errors import install_handlers
from .services import seed
from .services.backup import BackupScheduler

log = logging.getLogger("genresinvest")


def configure_logging(settings: Settings) -> None:
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    if any(getattr(h, "_gri", False) for h in root.handlers):
        return
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    file_handler = logging.handlers.RotatingFileHandler(
        settings.logs_dir / "genresinvest.log", maxBytes=5 * 1024 * 1024, backupCount=10, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    file_handler._gri = True  # type: ignore[attr-defined]
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    console._gri = True  # type: ignore[attr-defined]
    root.addHandler(file_handler)
    root.addHandler(console)
    root.setLevel(settings.log_level.upper())


def create_app(settings: Settings | None = None, start_scheduler: bool = True) -> FastAPI:
    settings = settings or load_settings()
    settings.ensure_dirs()
    configure_logging(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # noqa: ANN202
        database.init(settings.db_path)
        with session_scope() as db:
            seed.ensure_admin(db, settings)
            seed.load_start_data(db)
        scheduler = BackupScheduler(settings)
        if start_scheduler:
            scheduler.start()
        log.info("%s %s uruchomiony, dane: %s", APP_NAME, APP_VERSION, settings.data_dir)
        yield
        scheduler.stop()
        database.dispose()

    app = FastAPI(
        title=f"{APP_NAME} API",
        version=APP_VERSION,
        description="Generator zleceń ResInvest Commodities PL S.A. — REST API",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    install_handlers(app)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # noqa: ANN001, ANN202
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if not request.url.path.startswith("/api/docs"):
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; "
                "frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
            )
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.include_router(api_router)

    @app.get("/api/health", include_in_schema=False)
    def health() -> JSONResponse:
        return JSONResponse({"status": "ok", "app": APP_NAME, "version": APP_VERSION})

    static_dir = app_root() / "static"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(static_dir / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.webmanifest", include_in_schema=False)
    def manifest() -> FileResponse:
        return FileResponse(static_dir / "manifest.webmanifest", media_type="application/manifest+json")

    return app
