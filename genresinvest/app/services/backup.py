"""Kopie zapasowe: spójna kopia bazy (SQLite Online Backup API) + archiwum dokumentów w pliku ZIP.

* automatycznie co ``backup_interval_hours`` (sprawdzane przy starcie i co godzinę),
* ręcznie z panelu administratora,
* rotacja — zostaje ``backup_keep`` najnowszych kopii automatycznych (ręczne nie są usuwane),
* przywracanie — przed podmianą bazy tworzona jest kopia bezpieczeństwa „przed_przywroceniem”.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import sqlite3
import tempfile
import threading
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from .. import APP_VERSION, SCHEMA_VERSION
from ..config import Settings
from ..db import database, write_lock

log = logging.getLogger(__name__)

NAME_RE = re.compile(r"^gri_backup_\d{8}_\d{6}_(auto|manual|pre-restore)\.zip$")


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def create_backup(settings: Settings, kind: str = "manual") -> Path:
    if kind not in ("auto", "manual", "pre-restore"):
        raise ValueError("kind")
    settings.backups_dir.mkdir(parents=True, exist_ok=True)
    name = f"gri_backup_{_timestamp()}_{kind}.zip"
    target = settings.backups_dir / name
    with write_lock, tempfile.TemporaryDirectory() as tmp:
        db_copy = Path(tmp) / "genresinvest.db"
        src = sqlite3.connect(str(settings.db_path))
        dst = sqlite3.connect(str(db_copy))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        check = sqlite3.connect(str(db_copy))
        try:
            if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Kopia bazy nie przeszła testu integralności")
        finally:
            check.close()
        db_hash = hashlib.sha256(db_copy.read_bytes()).hexdigest()
        manifest = {
            "app_version": APP_VERSION,
            "schema_version": SCHEMA_VERSION,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "kind": kind,
            "db_sha256": db_hash,
            "includes_documents": settings.backup_include_documents,
        }
        partial = target.with_suffix(".zip.part")
        with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(db_copy, "genresinvest.db")
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            if settings.backup_include_documents and settings.documents_dir.is_dir():
                for f in settings.documents_dir.rglob("*"):
                    if f.is_file() and not f.name.startswith(".tmp_"):
                        zf.write(f, f"documents/{f.relative_to(settings.documents_dir).as_posix()}")
        partial.replace(target)
    log.info("Utworzono kopię zapasową %s", target.name)
    if kind == "auto":
        rotate(settings)
    return target


def rotate(settings: Settings) -> None:
    autos = sorted(settings.backups_dir.glob("gri_backup_*_auto.zip"))
    for old in autos[: max(0, len(autos) - settings.backup_keep)]:
        old.unlink(missing_ok=True)
        log.info("Rotacja: usunięto starą kopię %s", old.name)


def list_backups(settings: Settings) -> list[dict]:
    items = []
    for f in sorted(settings.backups_dir.glob("gri_backup_*.zip"), reverse=True):
        if not NAME_RE.match(f.name):
            continue
        stat = f.stat()
        items.append(
            {
                "name": f.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                "kind": f.stem.rsplit("_", 1)[-1],
            }
        )
    return items


def backup_path(settings: Settings, name: str) -> Path:
    if not NAME_RE.match(name):
        raise ValueError("Nieprawidłowa nazwa kopii")
    path = settings.backups_dir / name
    if not path.is_file():
        raise FileNotFoundError(name)
    return path


def last_backup_time(settings: Settings) -> datetime | None:
    items = list_backups(settings)
    return datetime.fromisoformat(items[0]["created_at"]) if items else None


def validate_archive(path: Path) -> dict:
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if "genresinvest.db" not in names or "manifest.json" not in names:
            raise ValueError("Archiwum nie jest kopią GenResInvest")
        for n in names:
            if n.startswith("/") or ".." in Path(n).parts:
                raise ValueError("Niebezpieczna ścieżka w archiwum")
        manifest = json.loads(zf.read("manifest.json"))
        if int(manifest.get("schema_version", 0)) > SCHEMA_VERSION:
            raise ValueError("Kopia pochodzi z nowszej wersji programu")
        if hashlib.sha256(zf.read("genresinvest.db")).hexdigest() != manifest.get("db_sha256"):
            raise ValueError("Kopia jest uszkodzona (niezgodna suma kontrolna bazy)")
        return manifest


def restore_backup(settings: Settings, path: Path) -> Path:
    """Przywraca bazę i dokumenty z kopii. Zwraca ścieżkę kopii bezpieczeństwa sprzed przywrócenia."""
    manifest = validate_archive(path)
    safety = create_backup(settings, "pre-restore")
    with write_lock, tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(path) as zf:
            zf.extractall(tmp)
        restored_db = Path(tmp) / "genresinvest.db"
        con = sqlite3.connect(str(restored_db))
        try:
            if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Baza w kopii nie przeszła testu integralności")
        finally:
            con.close()
        # Przywrócenie przez Online Backup API: bezpieczne przy otwartych połączeniach i trybie WAL
        # (bez ręcznego kasowania plików -wal/-shm, które mogłoby uszkodzić bazę).
        src = sqlite3.connect(str(restored_db))
        dst = sqlite3.connect(str(settings.db_path), timeout=30)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        docs_src = Path(tmp) / "documents"
        if manifest.get("includes_documents") and docs_src.is_dir():
            for f in docs_src.rglob("*"):
                if f.is_file():
                    dest = settings.documents_dir / f.relative_to(docs_src)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dest)
        database.init(settings.db_path)
    log.warning("Przywrócono kopię %s (kopia bezpieczeństwa: %s)", path.name, safety.name)
    return safety


class BackupScheduler:
    """Wątek w tle: co godzinę sprawdza, czy minął interwał od ostatniej kopii automatycznej."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def due(self) -> bool:
        autos = sorted(self.settings.backups_dir.glob("gri_backup_*_auto.zip"))
        if not autos:
            return True
        last = datetime.fromtimestamp(autos[-1].stat().st_mtime)
        return datetime.now() - last >= timedelta(hours=self.settings.backup_interval_hours)

    def run_once(self) -> None:
        try:
            if self.settings.backup_interval_hours > 0 and self.due():
                create_backup(self.settings, "auto")
        except Exception:  # noqa: BLE001 — błąd kopii nie może zatrzymać serwera
            log.exception("Automatyczna kopia zapasowa nie powiodła się")

    def start(self) -> None:
        def loop() -> None:
            self.run_once()
            while not self._stop.wait(3600):
                self.run_once()

        self._thread = threading.Thread(target=loop, name="backup-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
