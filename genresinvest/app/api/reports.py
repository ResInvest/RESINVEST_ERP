"""Raporty i eksport rejestru zleceń."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from .. import validators as v
from ..errors import AppError
from ..models import Contractor, Order
from ..security import ReaderUser
from ..services import reports
from .deps import DB, file_response

router = APIRouter(prefix="/reports", tags=["Raporty"])


def _range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = date.today()
    start = date_from or date(today.year, today.month, 1)
    end = date_to or today
    if end < start:
        raise AppError("Data „do” jest wcześniejsza niż „od”", 422, "date_to")
    return start, end


@router.get("/dashboard")
def dashboard(db: DB, _: ReaderUser) -> dict:
    today = date.today()
    month_start = date(today.year, today.month, 1)
    month = db.execute(
        select(Order.status, func.count(), func.coalesce(func.sum(Order.total_net_gr), 0))
        .where(Order.issue_date >= month_start).group_by(Order.status)
    ).all()
    stats = {s: {"count": c, "value": v.gr_to_decimal_str(int(val))} for s, c, val in month}
    return {
        "month": {"from": month_start, "to": today, "by_status": stats},
        "drafts_total": db.scalar(select(func.count()).select_from(Order).where(Order.status == "draft")) or 0,
        "contractors_active": db.scalar(select(func.count()).select_from(Contractor).where(Contractor.is_active.is_(True))) or 0,
        "orders_total": db.scalar(select(func.count()).select_from(Order)) or 0,
    }


@router.get("/yearly")
def yearly(db: DB, _: ReaderUser, year: Annotated[int, Query(ge=2000, le=2100)]) -> dict:
    return reports.yearly_summary(db, year)


@router.get("/contractors")
def contractors(db: DB, _: ReaderUser, date_from: date | None = None, date_to: date | None = None,
                status: Annotated[str, Query(pattern=r"^(draft|issued|cancelled)(,(draft|issued|cancelled))*$")] = "issued") -> dict:
    start, end = _range(date_from, date_to)
    return {"date_from": start, "date_to": end, "rows": reports.by_contractor(db, start, end, status)}


@router.get("/routes")
def routes(db: DB, _: ReaderUser, date_from: date | None = None, date_to: date | None = None) -> dict:
    start, end = _range(date_from, date_to)
    return {"date_from": start, "date_to": end, "rows": reports.by_route(db, start, end)}


@router.get("/export")
def export(
    db: DB, _: ReaderUser,
    format: Literal["csv", "xlsx"] = "xlsx",  # noqa: A002
    q: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[str | None, Query(pattern=r"^(draft|issued|cancelled)(,(draft|issued|cancelled))*$")] = None,
    contractor_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    rows = reports.export_rows(db, q=q, status=status, contractor_id=contractor_id, date_from=date_from, date_to=date_to)
    suffix = f"{date_from or 'poczatek'}_{date_to or date.today()}"
    if format == "csv":
        return file_response(reports.to_csv(reports.EXPORT_HEADERS, rows), f"rejestr_zlecen_{suffix}.csv", "text/csv; charset=utf-8")
    data = reports.to_xlsx(reports.EXPORT_HEADERS, rows)
    return file_response(data, f"rejestr_zlecen_{suffix}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
