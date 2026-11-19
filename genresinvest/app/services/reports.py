"""Raporty miesięczne / roczne oraz eksport rejestru zleceń (CSV, XLSX)."""

from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import validators as v
from ..models import Order, OrderItem

MONTHS_PL = [
    "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
    "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
]


def order_filters(
    stmt: Select,
    q: str | None = None,
    status: str | None = None,
    contractor_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Select:
    if status:
        stmt = stmt.where(Order.status.in_(status.split(",")))
    if contractor_id:
        stmt = stmt.where(Order.contractor_id == contractor_id)
    if date_from:
        stmt = stmt.where(Order.issue_date >= date_from)
    if date_to:
        stmt = stmt.where(Order.issue_date <= date_to)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Order.number.ilike(like),
                Order.service_short.ilike(like),
                Order.cargo_type.ilike(like),
                Order.loading_term.ilike(like),
                Order.notes.ilike(like),
                func.json_extract(Order.contractor_snapshot, "$.name").ilike(like),
                func.json_extract(Order.contractor_snapshot, "$.nip").ilike(like),
                Order.id.in_(select(OrderItem.order_id).where(OrderItem.route.ilike(like))),
            )
        )
    return stmt


def yearly_summary(db: Session, year: int) -> dict[str, Any]:
    start, end = date(year, 1, 1), date(year, 12, 31)
    rows = db.execute(
        select(
            func.strftime("%m", Order.issue_date).label("m"),
            Order.status,
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_net_gr), 0),
            func.sum(case((Order.total_net_gr.is_(None), 1), else_=0)),
        )
        .where(Order.issue_date.between(start, end))
        .group_by("m", Order.status)
    ).all()
    months = [
        {"month": i + 1, "name": MONTHS_PL[i], "issued": 0, "cancelled": 0, "draft": 0, "value_gr": 0, "without_value": 0}
        for i in range(12)
    ]
    for m, status, count, value, without in rows:
        rec = months[int(m) - 1]
        rec[status] = count
        if status == "issued":
            rec["value_gr"] = int(value or 0)
            rec["without_value"] = int(without or 0)
    totals = {k: sum(r[k] for r in months) for k in ("issued", "cancelled", "draft", "value_gr", "without_value")}
    for rec in [*months, totals]:
        rec["value"] = v.gr_to_decimal_str(rec.pop("value_gr"))
    return {"year": year, "months": months, "totals": totals}


def by_contractor(db: Session, date_from: date, date_to: date, status: str = "issued") -> list[dict[str, Any]]:
    name = func.json_extract(Order.contractor_snapshot, "$.name")
    rows = db.execute(
        select(
            Order.contractor_id,
            func.max(name),
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_net_gr), 0),
            func.min(Order.issue_date),
            func.max(Order.issue_date),
        )
        .where(Order.issue_date.between(date_from, date_to), Order.status.in_(status.split(",")))
        .group_by(Order.contractor_id)
        .order_by(func.count(Order.id).desc())
    ).all()
    return [
        {
            "contractor_id": cid,
            "contractor_name": cname,
            "orders": cnt,
            "value": v.gr_to_decimal_str(int(val or 0)),
            "first_date": first,
            "last_date": last,
        }
        for cid, cname, cnt, val, first, last in rows
    ]


def by_route(db: Session, date_from: date, date_to: date) -> list[dict[str, Any]]:
    rows = db.execute(
        select(
            OrderItem.route,
            OrderItem.unit,
            func.count(OrderItem.id),
            func.min(OrderItem.net_amount_gr),
            func.max(OrderItem.net_amount_gr),
            func.avg(OrderItem.net_amount_gr),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.issue_date.between(date_from, date_to), Order.status == "issued")
        .group_by(OrderItem.route, OrderItem.unit)
        .order_by(func.count(OrderItem.id).desc())
    ).all()
    return [
        {
            "route": r,
            "unit": u,
            "count": c,
            "min": v.gr_to_decimal_str(mn),
            "max": v.gr_to_decimal_str(mx),
            "avg": v.gr_to_decimal_str(int(round(avg or 0))),
        }
        for r, u, c, mn, mx, avg in rows
    ]


EXPORT_HEADERS = [
    "Numer", "Status", "Rewizja", "Data", "Miejsce", "Kontrahent", "NIP", "Krótki opis usługi",
    "Rodzaj towaru", "Pozycje cenowe", "Wartość netto [zł]", "Płatność [dni]", "Termin załadunku",
    "Prowadzi", "Utworzono", "Powód anulowania",
]

STATUS_PL = {"draft": "Szkic", "issued": "Wystawione", "cancelled": "Anulowane"}


def export_rows(db: Session, **filters: Any) -> list[list[Any]]:
    stmt = order_filters(select(Order).options(selectinload(Order.items)), **filters).order_by(
        Order.issue_date, Order.id
    )
    rows = []
    for o in db.scalars(stmt):
        items = "; ".join(
            f"{i.route}: {v.format_pln(i.net_amount_gr)} {i.unit}"
            + (f" × {v.format_quantity(i.quantity_milli)}" if i.quantity_milli else "")
            for i in o.items
        )
        rows.append(
            [
                o.number or "", STATUS_PL.get(o.status, o.status), o.revision, o.issue_date.isoformat(), o.issue_place,
                (o.contractor_snapshot or {}).get("name", ""), (o.contractor_snapshot or {}).get("nip") or "",
                o.service_short, o.cargo_type, items,
                (v.gr_to_decimal_str(o.total_net_gr) or "").replace(".", ","), o.payment_days, o.loading_term,
                o.handler_name, o.created_at.strftime("%Y-%m-%d %H:%M"), o.cancel_reason or "",
            ]
        )
    return rows


def to_csv(headers: list[str], rows: list[list[Any]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow(["" if x is None else _csv_safe(x) for x in row])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _csv_safe(value: Any) -> Any:
    """Ochrona przed wstrzyknięciem formuł w Excelu (CSV injection)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@") and not value[1:2].isdigit():
        return "'" + value
    return value


def to_xlsx(headers: list[str], rows: list[list[Any]], sheet: str = "Zlecenia") -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = sheet[:31]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0A1A21")
    for row in rows:
        ws.append([_csv_safe(x) if isinstance(x, str) else x for x in row])
    for idx, header in enumerate(headers, start=1):
        width = max([len(str(header))] + [len(str(r[idx - 1])) for r in rows[:500]]) + 2
        ws.column_dimensions[get_column_letter(idx)].width = min(60, width)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
