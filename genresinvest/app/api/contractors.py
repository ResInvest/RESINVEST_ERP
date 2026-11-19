"""Kartoteka kontrahentów (Zleceniobiorców) + import/eksport CSV."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Query, Request, UploadFile
from sqlalchemy import func, or_, select

from .. import audit
from ..db import write_lock
from ..errors import AppError, Conflict, NotFound, check_version
from ..models import Contractor, Order
from ..schemas import ContractorIn, ContractorOut, Message, Page
from ..security import EditorUser, ReaderUser, client_ip
from ..services import importexport
from .deps import DB, Paging, file_response

router = APIRouter(prefix="/contractors", tags=["Kontrahenci"])

FIELDS = ("name", "street", "postal_code", "city", "country", "nip", "phone", "email", "contact_person", "notes", "is_active")


def _state(c: Contractor) -> dict:
    return {f: getattr(c, f) for f in FIELDS}


def _check_unique_nip(db, nip: str | None, exclude_id: int | None = None) -> None:  # noqa: ANN001
    if not nip:
        return
    stmt = select(Contractor).where(Contractor.nip == nip)
    if exclude_id:
        stmt = stmt.where(Contractor.id != exclude_id)
    other = db.scalar(stmt)
    if other:
        raise Conflict(f"Kontrahent z NIP {nip} już istnieje: {other.name}", "nip")


@router.get("", response_model=Page)
def list_contractors(
    db: DB, _: ReaderUser, paging: Paging,
    q: Annotated[str | None, Query(max_length=100)] = None,
    active: bool | None = None,
) -> Page:
    stmt = select(Contractor)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Contractor.name.ilike(like), Contractor.nip.ilike(like.replace("-", "")),
                              Contractor.city.ilike(like), Contractor.phone.ilike(like)))
    if active is not None:
        stmt = stmt.where(Contractor.is_active == active)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Contractor.name).offset(paging.offset).limit(paging.page_size)).all()
    return Page(items=[ContractorOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.get("/export.csv")
def export_csv(db: DB, _: ReaderUser):
    return file_response(importexport.export_contractors_csv(db), "kontrahenci.csv", "text/csv; charset=utf-8")


@router.post("/import")
async def import_csv(
    request: Request, db: DB, user: EditorUser,
    file: Annotated[UploadFile, File(description="Plik CSV (UTF-8 lub Windows-1250, separator ; lub ,)")],
    dry_run: bool = True,
) -> dict:
    raw = await file.read()
    try:
        return importexport.import_contractors_csv(db, raw, user, dry_run, client_ip(request))
    except ValueError as exc:
        raise AppError(str(exc), 422) from exc


@router.get("/{contractor_id}", response_model=ContractorOut)
def get_contractor(contractor_id: int, db: DB, _: ReaderUser) -> Contractor:
    c = db.get(Contractor, contractor_id)
    if c is None:
        raise NotFound("Nie znaleziono kontrahenta")
    return c


@router.post("", response_model=ContractorOut, status_code=201)
def create_contractor(data: ContractorIn, request: Request, db: DB, user: EditorUser) -> Contractor:
    with write_lock:
        _check_unique_nip(db, data.nip)
        duplicate = db.scalar(select(Contractor).where(func.lower(Contractor.name) == data.name.lower(), Contractor.nip.is_(None)))
        if duplicate and not data.nip:
            raise Conflict(f"Kontrahent „{duplicate.name}” już istnieje", "name")
        c = Contractor(**data.model_dump(exclude={"row_version"}), created_by_id=user.id, updated_by_id=user.id)
        db.add(c)
        db.flush()
        audit.record(db, user, "create", "contractor", c.id, f"Dodano kontrahenta {c.name}", {"dane": _state(c)}, client_ip(request))
        db.commit()
        return c


@router.put("/{contractor_id}", response_model=ContractorOut)
def update_contractor(contractor_id: int, data: ContractorIn, request: Request, db: DB, user: EditorUser) -> Contractor:
    with write_lock:
        c = db.get(Contractor, contractor_id)
        if c is None:
            raise NotFound("Nie znaleziono kontrahenta")
        check_version(c.row_version, data.row_version)
        _check_unique_nip(db, data.nip, c.id)
        before = _state(c)
        for k, val in data.model_dump(exclude={"row_version"}).items():
            setattr(c, k, val)
        c.row_version += 1
        c.updated_by_id = user.id
        changes = audit.diff(before, _state(c))
        audit.record(db, user, "update", "contractor", c.id, f"Zmieniono kontrahenta {c.name}", {"zmiany": changes}, client_ip(request))
        db.commit()
        return c


@router.delete("/{contractor_id}", response_model=Message)
def delete_contractor(contractor_id: int, request: Request, db: DB, user: EditorUser) -> Message:
    """Kontrahent użyty w zleceniach jest tylko dezaktywowany (historia pozostaje spójna)."""
    with write_lock:
        c = db.get(Contractor, contractor_id)
        if c is None:
            raise NotFound("Nie znaleziono kontrahenta")
        used = db.scalar(select(func.count()).select_from(Order).where(Order.contractor_id == c.id))
        if used:
            c.is_active = False
            c.row_version += 1
            audit.record(db, user, "deactivate", "contractor", c.id, f"Dezaktywowano kontrahenta {c.name} (użyty w {used} zleceniach)", ip=client_ip(request))
            db.commit()
            return Message(message=f"Kontrahent jest użyty w {used} zleceniach — został dezaktywowany")
        audit.record(db, user, "delete", "contractor", c.id, f"Usunięto kontrahenta {c.name}", {"dane": _state(c)}, client_ip(request))
        db.delete(c)
        db.commit()
        return Message(message="Kontrahent został usunięty")
