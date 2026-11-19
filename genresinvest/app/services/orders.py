"""Silnik zleceń: tworzenie szkicu, wystawienie (numer + migawki), korekty, anulowanie, duplikowanie.

Cykl życia::

    draft ──issue──▶ issued ──update(+powód)──▶ issued (rewizja+1, korekta)
      │                 └──cancel(+powód)──▶ cancelled
      └──delete (tylko szkic)

Każde przejście zapisuje dziennik zdarzeń; wystawienie, korekta i anulowanie zapisują pełną migawkę
w ``order_revisions`` (historia nie do nadpisania).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from .. import validators as v
from ..db import write_lock
from ..errors import AppError, Conflict, NotFound, check_version
from ..models import (
    Contractor,
    Handler,
    Order,
    OrderItem,
    OrderRevision,
    PriceTemplate,
    ServiceTemplate,
    User,
    utcnow,
)
from ..schemas import OrderIn
from . import numbering, settings_store


def contractor_snapshot(c: Contractor) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "street": c.street,
        "postal_code": c.postal_code,
        "city": c.city,
        "country": c.country,
        "nip": c.nip,
        "phone": c.phone,
    }


def issuer_snapshot(db: Session) -> dict[str, Any]:
    return dict(settings_store.get(db, "company"))


def item_value_gr(item: OrderItem) -> int | None:
    if item.quantity_milli is None:
        return None
    return (item.net_amount_gr * item.quantity_milli + 500) // 1000


def compute_total(order: Order) -> int | None:
    values = [item_value_gr(i) for i in order.items]
    if not values or any(x is None for x in values):
        return None
    return sum(values)  # type: ignore[arg-type]


def to_dict(order: Order) -> dict[str, Any]:
    """Pełna reprezentacja zlecenia (API, migawki rewizji, generatory dokumentów)."""
    items = []
    for it in order.items:
        val = item_value_gr(it)
        items.append(
            {
                "position": it.position,
                "route": it.route,
                "net_amount": v.gr_to_decimal_str(it.net_amount_gr),
                "unit": it.unit,
                "quantity": v.milli_to_str(it.quantity_milli),
                "value": v.gr_to_decimal_str(val),
            }
        )
    return {
        "id": order.id,
        "number": order.number,
        "status": order.status,
        "revision": order.revision,
        "row_version": order.row_version,
        "issue_date": order.issue_date,
        "issue_place": order.issue_place,
        "contractor_id": order.contractor_id,
        "contractor": order.contractor_snapshot or {},
        "issuer": order.issuer_snapshot or {},
        "contractor_contact_name": order.contractor_contact_name,
        "contractor_contact_phone": order.contractor_contact_phone,
        "service_short": order.service_short,
        "service_detailed": order.service_detailed,
        "cargo_type": order.cargo_type,
        "origin_point": order.origin_point,
        "destination_point": order.destination_point,
        "loading_term": order.loading_term,
        "payment_days": order.payment_days,
        "handler_id": order.handler_id,
        "handler_name": order.handler_name,
        "handler_phone": order.handler_phone,
        "notes": order.notes,
        "total_net": v.gr_to_decimal_str(order.total_net_gr),
        "currency": order.currency,
        "items": items,
        "issued_at": order.issued_at,
        "cancelled_at": order.cancelled_at,
        "cancel_reason": order.cancel_reason,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "created_by": order.created_by.full_name if order.created_by else None,
    }


def snapshot_json(order: Order) -> dict[str, Any]:
    data = to_dict(order)
    for key in ("issue_date", "issued_at", "cancelled_at", "created_at", "updated_at"):
        if data.get(key) is not None:
            data[key] = data[key].isoformat()
    return data


def get_order(db: Session, order_id: int) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise NotFound("Nie znaleziono zlecenia")
    return order


def _apply_payload(db: Session, order: Order, data: OrderIn, user: User) -> None:
    contractor = db.get(Contractor, data.contractor_id)
    if contractor is None:
        raise AppError("Wybrany kontrahent nie istnieje", 422, "contractor_id")
    if not contractor.is_active and order.contractor_id != contractor.id:
        raise AppError("Kontrahent jest nieaktywny — aktywuj go w kartotece", 422, "contractor_id")
    if data.handler_id is not None and db.get(Handler, data.handler_id) is None:
        raise AppError("Wybrana osoba prowadząca nie istnieje", 422, "handler_name")

    order.contractor_id = contractor.id
    order.contractor = contractor
    order.contractor_snapshot = contractor_snapshot(contractor)
    for field in (
        "issue_date", "issue_place", "contractor_contact_name", "contractor_contact_phone", "service_short",
        "service_detailed", "cargo_type", "origin_point", "destination_point", "loading_term", "payment_days",
        "handler_id", "handler_name", "handler_phone", "notes",
    ):
        setattr(order, field, getattr(data, field))
    if not order.contractor_contact_phone and contractor.phone:
        order.contractor_contact_phone = contractor.phone

    order.items.clear()
    db.flush()
    for pos, item in enumerate(data.items, start=1):
        order.items.append(
            OrderItem(
                position=pos,
                route=v.clean_text(item.route, 200),
                net_amount_gr=v.parse_amount_to_gr(item.net_amount),
                unit=v.clean_text(item.unit, 40),
                quantity_milli=v.parse_quantity_to_milli(item.quantity),
            )
        )
    order.total_net_gr = compute_total(order)
    order.updated_by_id = user.id

    if data.save_to_dictionaries:
        _learn_dictionaries(db, data)


def _learn_dictionaries(db: Session, data: OrderIn) -> None:
    """„Dopisz, gdy jeszcze nie ma” — nowe opisy usług, ceny i osoby trafiają do słowników."""
    svc = db.scalar(select(ServiceTemplate).where(ServiceTemplate.short_description == data.service_short))
    if svc is None:
        db.add(
            ServiceTemplate(
                short_description=data.service_short,
                detailed_description=data.service_detailed,
                cargo_type=data.cargo_type,
                usage_count=1,
            )
        )
    else:
        svc.usage_count += 1
    for item in data.items:
        gr = v.parse_amount_to_gr(item.net_amount)
        price = db.scalar(
            select(PriceTemplate).where(
                PriceTemplate.route == item.route, PriceTemplate.net_amount_gr == gr, PriceTemplate.unit == item.unit
            )
        )
        if price is None:
            db.add(PriceTemplate(route=item.route, net_amount_gr=gr, unit=item.unit, usage_count=1))
        else:
            price.usage_count += 1
    if data.handler_id is None and data.handler_name:
        handler = db.scalar(
            select(Handler).where(Handler.full_name == data.handler_name, Handler.phone == data.handler_phone)
        )
        if handler is None:
            db.add(Handler(full_name=data.handler_name, phone=data.handler_phone, usage_count=1))
        else:
            handler.usage_count += 1
    elif data.handler_id is not None:
        handler = db.get(Handler, data.handler_id)
        if handler:
            handler.usage_count += 1
    db.flush()


def create_draft(db: Session, data: OrderIn, user: User, ip: str | None) -> Order:
    with write_lock:
        order = Order(status="draft", revision=0, created_by_id=user.id, currency="PLN")
        db.add(order)
        _apply_payload(db, order, data, user)
        db.flush()
        audit.record(db, user, "create", "order", order.id, f"Utworzono szkic zlecenia dla {order.contractor_snapshot['name']}", ip=ip)
        db.commit()
        return order


def update_order(db: Session, order: Order, data: OrderIn, user: User, ip: str | None) -> Order:
    with write_lock:
        db.refresh(order)
        check_version(order.row_version, data.row_version)
        if order.status == "cancelled":
            raise Conflict("Zlecenie jest anulowane — nie można go zmienić")
        before = snapshot_json(order)
        if order.status == "issued":
            reason = (data.correction_reason or "").strip()
            if len(reason) < 5:
                raise AppError("Podaj powód korekty (min. 5 znaków)", 422, "correction_reason")
            _apply_payload(db, order, data, user)
            order.issuer_snapshot = issuer_snapshot(db)
            order.revision += 1
            order.row_version += 1
            db.flush()
            after = snapshot_json(order)
            changes = audit.diff(_flat(before), _flat(after))
            if not changes:
                raise AppError("Korekta nie zawiera żadnych zmian", 422)
            _add_revision(db, order, "correction", reason, user)
            audit.record(
                db, user, "correction", "order", order.id,
                f"Korekta nr {order.revision - 1} zlecenia {order.number}: {reason}",
                {"zmiany": changes}, ip,
            )
        else:
            _apply_payload(db, order, data, user)
            order.row_version += 1
            db.flush()
            changes = audit.diff(_flat(before), _flat(snapshot_json(order)))
            audit.record(db, user, "update", "order", order.id, "Zmieniono szkic zlecenia", {"zmiany": changes}, ip)
        db.commit()
        return order


def _flat(snap: dict[str, Any]) -> dict[str, Any]:
    ignore = {"row_version", "updated_at", "revision", "issuer"}
    flat = {k: val for k, val in snap.items() if k not in ignore and not isinstance(val, (dict, list))}
    flat["kontrahent"] = (snap.get("contractor") or {}).get("name")
    flat["pozycje"] = "; ".join(
        f"{i['route']}: {i['net_amount']} {i['unit']}" + (f" × {i['quantity']}" if i.get("quantity") else "")
        for i in snap.get("items", [])
    )
    return flat


def _add_revision(db: Session, order: Order, kind: str, reason: str | None, user: User) -> None:
    db.add(
        OrderRevision(
            order_id=order.id,
            revision=order.revision,
            kind=kind,
            reason=reason,
            snapshot=snapshot_json(order),
            created_by_id=user.id,
            created_by_name=user.full_name,
        )
    )


def issue_order(db: Session, order: Order, user: User, ip: str | None, row_version: int | None = None) -> Order:
    with write_lock:
        db.refresh(order)
        check_version(order.row_version, row_version)
        if order.status != "draft":
            raise Conflict("Zlecenie zostało już wystawione")
        contractor = db.get(Contractor, order.contractor_id)
        if contractor is None:
            raise AppError("Kontrahent zlecenia nie istnieje", 422, "contractor_id")
        cfg = settings_store.get(db, "numbering")
        number, key, seq = numbering.next_number(db, order.issue_date, cfg)
        if db.scalar(select(func.count()).select_from(Order).where(Order.number == number)):
            raise Conflict(f"Numer {number} jest już zajęty — sprawdź ustawienia numeracji")
        order.number, order.period_key, order.seq = number, key, seq
        order.status = "issued"
        order.revision = 1
        order.row_version += 1
        order.issued_at = utcnow()
        order.issued_by_id = user.id
        order.contractor_snapshot = contractor_snapshot(contractor)
        order.issuer_snapshot = issuer_snapshot(db)
        db.flush()
        _add_revision(db, order, "issue", None, user)
        audit.record(db, user, "issue", "order", order.id, f"Wystawiono zlecenie {number} dla {contractor.name}", ip=ip)
        db.commit()
        return order


def cancel_order(db: Session, order: Order, reason: str, user: User, ip: str | None, row_version: int | None) -> Order:
    with write_lock:
        db.refresh(order)
        check_version(order.row_version, row_version)
        if order.status != "issued":
            raise Conflict("Anulować można tylko wystawione zlecenie (szkic można usunąć)")
        order.status = "cancelled"
        order.cancelled_at = utcnow()
        order.cancelled_by_id = user.id
        order.cancel_reason = reason
        order.row_version += 1
        db.flush()
        _add_revision(db, order, "cancel", reason, user)
        audit.record(db, user, "cancel", "order", order.id, f"Anulowano zlecenie {order.number}: {reason}", ip=ip)
        db.commit()
        return order


def delete_draft(db: Session, order: Order, user: User, ip: str | None) -> None:
    with write_lock:
        if order.status != "draft":
            raise Conflict("Usunąć można tylko szkic. Wystawione zlecenie można anulować.")
        snap = snapshot_json(order)
        db.delete(order)
        audit.record(db, user, "delete", "order", order.id, "Usunięto szkic zlecenia", {"szkic": snap}, ip)
        db.commit()


def duplicate_order(db: Session, order: Order, user: User, ip: str | None) -> Order:
    with write_lock:
        copy = Order(
            status="draft",
            revision=0,
            created_by_id=user.id,
            updated_by_id=user.id,
            issue_date=date.today(),
            currency=order.currency,
        )
        for field in (
            "issue_place", "contractor_id", "contractor_snapshot", "contractor_contact_name",
            "contractor_contact_phone", "service_short", "service_detailed", "cargo_type", "origin_point",
            "destination_point", "loading_term", "payment_days", "handler_id", "handler_name", "handler_phone", "notes",
        ):
            setattr(copy, field, getattr(order, field))
        contractor = db.get(Contractor, order.contractor_id)
        if contractor is not None:
            copy.contractor_snapshot = contractor_snapshot(contractor)
        for it in order.items:
            copy.items.append(
                OrderItem(
                    position=it.position, route=it.route, net_amount_gr=it.net_amount_gr,
                    unit=it.unit, quantity_milli=it.quantity_milli,
                )
            )
        copy.total_net_gr = compute_total(copy)
        db.add(copy)
        db.flush()
        audit.record(db, user, "duplicate", "order", copy.id, f"Utworzono szkic na podstawie zlecenia {order.number or order.id}", ip=ip)
        db.commit()
        return copy


def build_preview_order(db: Session, data: OrderIn) -> Order:
    """Obiekt zlecenia w pamięci (bez zapisu) — do podglądu dokumentu przed zapisaniem."""
    contractor = db.get(Contractor, data.contractor_id)
    if contractor is None:
        raise AppError("Wybierz kontrahenta", 422, "contractor_id")
    order = Order(status="draft", revision=0, currency="PLN")
    order.contractor_snapshot = contractor_snapshot(contractor)
    order.issuer_snapshot = issuer_snapshot(db)
    for field in (
        "issue_date", "issue_place", "contractor_contact_name", "contractor_contact_phone", "service_short",
        "service_detailed", "cargo_type", "origin_point", "destination_point", "loading_term", "payment_days",
        "handler_id", "handler_name", "handler_phone", "notes",
    ):
        setattr(order, field, getattr(data, field))
    if not order.contractor_contact_phone and contractor.phone:
        order.contractor_contact_phone = contractor.phone
    order.items = [
        OrderItem(
            position=pos, route=i.route, net_amount_gr=v.parse_amount_to_gr(i.net_amount),
            unit=i.unit, quantity_milli=v.parse_quantity_to_milli(i.quantity),
        )
        for pos, i in enumerate(data.items, start=1)
    ]
    order.total_net_gr = compute_total(order)
    return order
