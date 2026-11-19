"""Zlecenia: rejestr z filtrami, CRUD szkiców, wystawianie, korekty, anulowanie, dokumenty PDF/DOCX."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .. import validators as v
from ..errors import AppError, NotFound
from ..models import Document, Order, OrderRevision
from ..schemas import CancelIn, IssueIn, Message, OrderIn, OrderListItem, OrderOut, Page
from ..security import EditorUser, ReaderUser, client_ip
from ..services import orders as svc
from ..services.documents import store
from ..services.reports import order_filters
from .deps import DB, AppSettings, Paging, file_response

router = APIRouter(prefix="/orders", tags=["Zlecenia"])

Fmt = Literal["pdf", "docx"]
SORTS = {
    "date_desc": (Order.issue_date.desc(), Order.id.desc()),
    "date_asc": (Order.issue_date.asc(), Order.id.asc()),
    "number": (Order.period_key.desc(), Order.seq.desc()),
    "updated": (Order.updated_at.desc(),),
}


def _out(order: Order) -> OrderOut:
    return OrderOut(**svc.to_dict(order))


@router.get("", response_model=Page)
def list_orders(
    db: DB, _: ReaderUser, paging: Paging,
    q: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[str | None, Query(pattern=r"^(draft|issued|cancelled)(,(draft|issued|cancelled))*$")] = None,
    contractor_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: Literal["date_desc", "date_asc", "number", "updated"] = "date_desc",
) -> Page:
    stmt = order_filters(select(Order), q, status, contractor_id, date_from, date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(selectinload(Order.items)).order_by(*SORTS[sort]).offset(paging.offset).limit(paging.page_size)
    ).all()
    items = [
        OrderListItem(
            id=o.id, number=o.number, status=o.status, revision=o.revision, issue_date=o.issue_date,
            contractor_id=o.contractor_id, contractor_name=(o.contractor_snapshot or {}).get("name", ""),
            service_short=o.service_short,
            items_summary="; ".join(f"{i.route}: {v.format_pln(i.net_amount_gr)} {i.unit}" for i in o.items),
            total_net=v.gr_to_decimal_str(o.total_net_gr), created_at=o.created_at, updated_at=o.updated_at,
        )
        for o in rows
    ]
    return Page(items=items, total=total, page=paging.page, page_size=paging.page_size)


@router.post("", response_model=OrderOut, status_code=201)
def create_order(data: OrderIn, request: Request, db: DB, user: EditorUser) -> OrderOut:
    return _out(svc.create_draft(db, data, user, client_ip(request)))


@router.post("/preview")
def preview_unsaved(data: OrderIn, db: DB, _: ReaderUser, format: Fmt = "pdf"):  # noqa: A002
    """Podgląd dokumentu z danych formularza — bez zapisu w bazie (znak wodny PROJEKT)."""
    order = svc.build_preview_order(db, data)
    rendered = store.render(db, svc.to_dict(order), format)
    return file_response(rendered.data, rendered.file_name, rendered.mime, inline=format == "pdf")


@router.get("/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: DB, _: ReaderUser) -> OrderOut:
    return _out(svc.get_order(db, order_id))


@router.put("/{order_id}", response_model=OrderOut)
def update_order(order_id: int, data: OrderIn, request: Request, db: DB, user: EditorUser) -> OrderOut:
    order = svc.get_order(db, order_id)
    return _out(svc.update_order(db, order, data, user, client_ip(request)))


@router.delete("/{order_id}", response_model=Message)
def delete_order(order_id: int, request: Request, db: DB, user: EditorUser) -> Message:
    svc.delete_draft(db, svc.get_order(db, order_id), user, client_ip(request))
    return Message(message="Szkic został usunięty")


@router.post("/{order_id}/issue", response_model=OrderOut)
def issue_order(order_id: int, request: Request, db: DB, user: EditorUser, data: IssueIn | None = None) -> OrderOut:
    order = svc.issue_order(db, svc.get_order(db, order_id), user, client_ip(request), data.row_version if data else None)
    return _out(order)


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(order_id: int, data: CancelIn, request: Request, db: DB, user: EditorUser) -> OrderOut:
    order = svc.cancel_order(db, svc.get_order(db, order_id), data.reason, user, client_ip(request), data.row_version)
    return _out(order)


@router.post("/{order_id}/duplicate", response_model=OrderOut, status_code=201)
def duplicate_order(order_id: int, request: Request, db: DB, user: EditorUser) -> OrderOut:
    return _out(svc.duplicate_order(db, svc.get_order(db, order_id), user, client_ip(request)))


@router.get("/{order_id}/revisions")
def list_revisions(order_id: int, db: DB, _: ReaderUser) -> list[dict]:
    svc.get_order(db, order_id)
    rows = db.scalars(select(OrderRevision).where(OrderRevision.order_id == order_id).order_by(OrderRevision.id)).all()
    return [
        {"id": r.id, "revision": r.revision, "kind": r.kind, "reason": r.reason, "created_at": r.created_at,
         "created_by": r.created_by_name, "snapshot": r.snapshot}
        for r in rows
    ]


@router.get("/{order_id}/documents")
def list_documents(order_id: int, db: DB, _: ReaderUser) -> list[dict]:
    svc.get_order(db, order_id)
    rows = db.scalars(select(Document).where(Document.order_id == order_id).order_by(Document.revision.desc(), Document.format)).all()
    return [
        {"id": d.id, "revision": d.revision, "format": d.format, "file_name": d.file_name, "size_bytes": d.size_bytes,
         "sha256": d.sha256, "created_at": d.created_at}
        for d in rows
    ]


@router.get("/{order_id}/document")
def download_document(
    order_id: int, db: DB, user: ReaderUser, settings: AppSettings, format: Fmt = "pdf", inline: bool = False,  # noqa: A002
):
    """Dokument bieżącej rewizji. Dla wystawionych — plik archiwalny (tworzony przy pierwszym pobraniu)."""
    order = svc.get_order(db, order_id)
    rendered = store.get_or_create(db, settings.documents_dir, order, format, user)
    return file_response(rendered.data, rendered.file_name, rendered.mime, inline=inline and format == "pdf")


@router.get("/documents/{document_id}/download")
def download_archived(document_id: int, db: DB, _: ReaderUser, settings: AppSettings, inline: bool = False):
    doc = db.get(Document, document_id)
    if doc is None:
        raise NotFound("Nie znaleziono dokumentu")
    try:
        rendered = store.read_archived(db, settings.documents_dir, doc)
    except FileNotFoundError as exc:
        raise AppError("Plik archiwalny nie istnieje na dysku — przywróć go z kopii zapasowej", 410) from exc
    except ValueError as exc:
        raise AppError(str(exc), 409) from exc
    return file_response(rendered.data, rendered.file_name, rendered.mime, inline=inline and doc.format == "pdf")
