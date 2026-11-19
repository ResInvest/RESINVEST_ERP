"""Administracja: użytkownicy, ustawienia, dziennik zdarzeń, kopie zapasowe, import/eksport danych, system."""

from __future__ import annotations

import json
import tempfile
from datetime import date, datetime, time
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, Query, Request, UploadFile
from sqlalchemy import delete, func, or_, select

from .. import APP_NAME, APP_VERSION, SCHEMA_VERSION, audit
from ..db import database, write_lock
from ..errors import AppError, Conflict, NotFound
from ..models import AuditLog, User, UserSession
from ..schemas import Message, Page, SettingsIn, UserIn, UserOut, UserUpdateIn
from ..security import AdminUser, ReaderUser, client_ip, generate_password, hash_password, password_problems
from ..services import backup, importexport, numbering, settings_store
from .deps import DB, AppSettings, Paging, file_response

router = APIRouter(tags=["Administracja"])


# --- Użytkownicy ----------------------------------------------------------------------------------

@router.get("/users", response_model=list[UserOut])
def list_users(db: DB, _: AdminUser) -> Any:
    return db.scalars(select(User).order_by(User.username)).all()


@router.post("/users", status_code=201)
def create_user(data: UserIn, request: Request, db: DB, admin: AdminUser) -> dict:
    with write_lock:
        username = data.username.lower()
        if db.scalar(select(User).where(User.username == username)):
            raise Conflict("Taki login już istnieje", "username")
        password = data.password or generate_password()
        if problems := password_problems(password):
            raise AppError("; ".join(problems), 422, "password")
        user = User(
            username=username, full_name=data.full_name, email=data.email, phone=data.phone, role=data.role,
            is_active=data.is_active, password_hash=hash_password(password), must_change_password=True,
        )
        db.add(user)
        db.flush()
        audit.record(db, admin, "create", "user", user.id, f"Dodano użytkownika {username} ({data.role})", ip=client_ip(request))
        db.commit()
        return {"user": UserOut.model_validate(user).model_dump(mode="json"), "initial_password": None if data.password else password}


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdateIn, request: Request, db: DB, admin: AdminUser) -> Any:
    with write_lock:
        user = db.get(User, user_id)
        if user is None:
            raise NotFound("Nie znaleziono użytkownika")
        if user.id == admin.id and (data.role != "admin" or not data.is_active):
            raise AppError("Nie możesz odebrać sobie roli administratora ani dezaktywować własnego konta", 422, "role")
        before = {"full_name": user.full_name, "email": user.email, "phone": user.phone, "role": user.role, "is_active": user.is_active}
        user.full_name, user.email, user.phone, user.role, user.is_active = (
            data.full_name, data.email, data.phone, data.role, data.is_active,
        )
        if not user.is_active:
            db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        after = {"full_name": user.full_name, "email": user.email, "phone": user.phone, "role": user.role, "is_active": user.is_active}
        audit.record(db, admin, "update", "user", user.id, f"Zmieniono użytkownika {user.username}", {"zmiany": audit.diff(before, after)}, client_ip(request))
        db.commit()
        return user


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: int, request: Request, db: DB, admin: AdminUser) -> dict:
    with write_lock:
        user = db.get(User, user_id)
        if user is None:
            raise NotFound("Nie znaleziono użytkownika")
        password = generate_password()
        user.password_hash = hash_password(password)
        user.must_change_password = True
        user.failed_logins, user.locked_until = 0, None
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        audit.record(db, admin, "reset_password", "user", user.id, f"Zresetowano hasło użytkownika {user.username}", ip=client_ip(request))
        db.commit()
        return {"initial_password": password}


# --- Ustawienia -----------------------------------------------------------------------------------

@router.get("/settings")
def get_settings(db: DB, _: ReaderUser) -> dict:
    return settings_store.get_all(db)


@router.put("/settings")
def put_settings(data: SettingsIn, request: Request, db: DB, admin: AdminUser) -> dict:
    with write_lock:
        before = settings_store.get_all(db)
        if data.numbering is not None:
            try:
                numbering.validate_pattern(data.numbering.pattern)
            except ValueError as exc:
                raise AppError(str(exc), 422, "numbering.pattern") from exc
        for key in settings_store.ALLOWED_KEYS:
            section = getattr(data, key)
            if section is not None:
                settings_store.put(db, key, section.model_dump())
        after = settings_store.get_all(db)
        audit.record(db, admin, "update", "settings", None, "Zmieniono ustawienia", {"zmiany": audit.diff(
            {k: json.dumps(v_, ensure_ascii=False, sort_keys=True) for k, v_ in before.items()},
            {k: json.dumps(v_, ensure_ascii=False, sort_keys=True) for k, v_ in after.items()},
        )}, client_ip(request))
        db.commit()
        return after


# --- Dziennik zdarzeń (historia operacji) ---------------------------------------------------------

@router.get("/audit", response_model=Page)
def list_audit(
    db: DB, _: ReaderUser, paging: Paging,
    date_from: date | None = None, date_to: date | None = None,
    username: Annotated[str | None, Query(max_length=64)] = None,
    entity: Annotated[str | None, Query(max_length=40)] = None,
    action: Annotated[str | None, Query(max_length=40)] = None,
    entity_id: Annotated[str | None, Query(max_length=64)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> Page:
    stmt = select(AuditLog)
    if date_from:
        stmt = stmt.where(AuditLog.ts >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(AuditLog.ts <= datetime.combine(date_to, time.max))
    if username:
        stmt = stmt.where(AuditLog.username == username)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if q:
        stmt = stmt.where(or_(AuditLog.summary.ilike(f"%{q}%"), AuditLog.username.ilike(f"%{q}%")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.id.desc()).offset(paging.offset).limit(paging.page_size)).all()
    items = [
        {"id": r.id, "ts": r.ts, "username": r.username, "action": r.action, "entity": r.entity,
         "entity_id": r.entity_id, "summary": r.summary, "details": r.details, "ip": r.ip}
        for r in rows
    ]
    return Page(items=items, total=total, page=paging.page, page_size=paging.page_size)


# --- Kopie zapasowe -------------------------------------------------------------------------------

@router.get("/backups")
def list_backups(_: AdminUser, settings: AppSettings) -> dict:
    return {
        "items": backup.list_backups(settings),
        "keep": settings.backup_keep,
        "interval_hours": settings.backup_interval_hours,
        "directory": str(settings.backups_dir),
    }


@router.post("/backups", status_code=201)
def create_backup(request: Request, db: DB, admin: AdminUser, settings: AppSettings) -> dict:
    path = backup.create_backup(settings, "manual")
    audit.record(db, admin, "backup", "system", None, f"Utworzono kopię zapasową {path.name}", ip=client_ip(request))
    db.commit()
    return {"name": path.name, "size_bytes": path.stat().st_size}


@router.get("/backups/{name}/download")
def download_backup(name: str, _: AdminUser, settings: AppSettings):
    try:
        path = backup.backup_path(settings, name)
    except (ValueError, FileNotFoundError) as exc:
        raise NotFound("Nie znaleziono kopii") from exc
    return file_response(path.read_bytes(), path.name, "application/zip")


@router.post("/backups/{name}/restore", response_model=Message)
def restore_backup(name: str, request: Request, admin: AdminUser, settings: AppSettings) -> Message:
    try:
        path = backup.backup_path(settings, name)
        safety = backup.restore_backup(settings, path)
    except (ValueError, FileNotFoundError) as exc:
        raise AppError(str(exc), 422) from exc
    with database.session() as db:
        audit.record(db, admin, "restore", "system", None, f"Przywrócono kopię {name} (kopia bezpieczeństwa: {safety.name})", ip=client_ip(request))
        db.commit()
    return Message(message=f"Przywrócono kopię {name}. Kopia sprzed przywrócenia: {safety.name}")


@router.post("/backups/upload-restore", response_model=Message)
async def upload_and_restore(request: Request, admin: AdminUser, settings: AppSettings,
                             file: Annotated[UploadFile, File()]) -> Message:
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024 * 1024:
        raise AppError("Plik jest za duży", 413)
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = Path(tmp.name)
    try:
        safety = backup.restore_backup(settings, tmp_path)
    except (ValueError, OSError) as exc:
        raise AppError(f"Nie można przywrócić: {exc}", 422) from exc
    finally:
        tmp_path.unlink(missing_ok=True)
    with database.session() as db:
        audit.record(db, admin, "restore", "system", None, f"Przywrócono kopię z pliku {file.filename}", ip=client_ip(request))
        db.commit()
    return Message(message=f"Przywrócono dane z pliku. Kopia sprzed przywrócenia: {safety.name}")


# --- Import / eksport danych ----------------------------------------------------------------------

@router.get("/data/export.json")
def export_data(db: DB, _: AdminUser):
    payload = json.dumps(importexport.export_json(db), ensure_ascii=False, indent=2, default=str).encode("utf-8")
    return file_response(payload, f"genresinvest_kartoteki_{date.today()}.json", "application/json")


@router.post("/data/import.json")
async def import_data(request: Request, db: DB, admin: AdminUser, file: Annotated[UploadFile, File()]) -> dict:
    raw = await file.read()
    try:
        data = json.loads(raw.decode("utf-8-sig"))
        return importexport.import_json(db, data, admin, client_ip(request))
    except (ValueError, UnicodeDecodeError) as exc:
        raise AppError(f"Nieprawidłowy plik: {exc}", 422) from exc


# --- System ---------------------------------------------------------------------------------------

@router.get("/system/info")
def system_info(_: ReaderUser, settings: AppSettings) -> dict:
    last = backup.last_backup_time(settings)
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "schema_version": SCHEMA_VERSION,
        "data_dir": str(settings.data_dir),
        "last_backup": last.isoformat(timespec="seconds") if last else None,
    }
