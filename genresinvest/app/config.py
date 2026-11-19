"""Konfiguracja środowiska.

Kolejność (od najważniejszej): zmienne środowiskowe ``GRI_*`` → plik ``.env`` w katalogu danych
→ plik ``.env`` obok programu → wartości domyślne. Bez zewnętrznych zależności (parser .env jest wbudowany),
żeby instalator Windows był mały i niezawodny.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path


def is_frozen() -> bool:
    """True, gdy program działa jako plik .exe zbudowany PyInstallerem."""
    return bool(getattr(sys, "frozen", False))


def app_root() -> Path:
    """Katalog z zasobami programu (assets, static) — także w wersji .exe."""
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "app"
    return Path(__file__).resolve().parent


def install_dir() -> Path:
    """Katalog instalacji (obok .exe) albo katalog projektu w trybie deweloperskim."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def default_data_dir() -> Path:
    if is_frozen() and os.name == "nt":
        base = os.environ.get("PROGRAMDATA") or os.environ.get("LOCALAPPDATA") or str(install_dir())
        return Path(base) / "GenResInvest"
    return install_dir() / "data"


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _to_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "tak", "on"}


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: Path = field(default_factory=default_data_dir)
    session_hours: int = 12
    backup_keep: int = 30
    backup_interval_hours: int = 24
    backup_include_documents: bool = True
    open_browser: bool = True
    log_level: str = "INFO"
    initial_admin_password: str | None = None
    secure_cookies: bool = False
    login_max_attempts: int = 5
    login_lock_minutes: int = 15

    @property
    def db_path(self) -> Path:
        return self.data_dir / "genresinvest.db"

    @property
    def documents_dir(self) -> Path:
        return self.data_dir / "documents"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.documents_dir, self.backups_dir, self.logs_dir):
            d.mkdir(parents=True, exist_ok=True)


def load_settings(overrides: dict[str, object] | None = None) -> Settings:
    """Buduje konfigurację z plików .env i zmiennych środowiskowych."""
    env: dict[str, str] = {}
    env.update(_parse_env_file(install_dir() / ".env"))
    preliminary_dir = os.environ.get("GRI_DATA_DIR") or env.get("GRI_DATA_DIR")
    data_dir = Path(preliminary_dir).expanduser() if preliminary_dir else default_data_dir()
    env.update(_parse_env_file(data_dir / ".env"))
    env.update({k: v for k, v in os.environ.items() if k.startswith("GRI_")})

    kwargs: dict[str, object] = {"data_dir": Path(env.get("GRI_DATA_DIR", str(data_dir))).expanduser()}
    mapping: dict[str, tuple[str, type]] = {
        "GRI_HOST": ("host", str),
        "GRI_PORT": ("port", int),
        "GRI_SESSION_HOURS": ("session_hours", int),
        "GRI_BACKUP_KEEP": ("backup_keep", int),
        "GRI_BACKUP_INTERVAL_HOURS": ("backup_interval_hours", int),
        "GRI_BACKUP_INCLUDE_DOCUMENTS": ("backup_include_documents", bool),
        "GRI_OPEN_BROWSER": ("open_browser", bool),
        "GRI_LOG_LEVEL": ("log_level", str),
        "GRI_ADMIN_PASSWORD": ("initial_admin_password", str),
        "GRI_SECURE_COOKIES": ("secure_cookies", bool),
        "GRI_LOGIN_MAX_ATTEMPTS": ("login_max_attempts", int),
        "GRI_LOGIN_LOCK_MINUTES": ("login_lock_minutes", int),
    }
    for key, (attr, typ) in mapping.items():
        if key in env and env[key] != "":
            raw = env[key]
            kwargs[attr] = _to_bool(raw) if typ is bool else typ(raw)
    if overrides:
        kwargs.update(overrides)
    return Settings(**kwargs)  # type: ignore[arg-type]
