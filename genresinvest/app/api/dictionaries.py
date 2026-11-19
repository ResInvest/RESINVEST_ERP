"""Słowniki: opisy usług, ceny netto (trasy/stawki), osoby prowadzące, jednostki."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from .. import audit
from .. import validators as v
from ..db import write_lock
from ..errors import Conflict, NotFound
from ..models import Handler, OrderItem, PriceTemplate, ServiceTemplate
from ..schemas import (
    HandlerIn,
    HandlerOut,
    Message,
    PriceTemplateIn,
    PriceTemplateOut,
    ServiceTemplateIn,
    ServiceTemplateOut,
)
from ..security import EditorUser, ReaderUser, client_ip
from ..services import settings_store
from .deps import DB

router = APIRouter(tags=["Słowniki"])

Q = Annotated[str | None, Query(max_length=100)]
Limit = Annotated[int, Query(ge=1, le=500)]


# --- Opisy usług ----------------------------------------------------------------------------------

@router.get("/services", response_model=list[ServiceTemplateOut])
def list_services(db: DB, _: ReaderUser, q: Q = None, active: bool | None = None, limit: Limit = 100) -> Any:
    stmt = select(ServiceTemplate)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(ServiceTemplate.short_description.ilike(like), ServiceTemplate.cargo_type.ilike(like)))
    if active is not None:
        stmt = stmt.where(ServiceTemplate.is_active == active)
    return db.scalars(stmt.order_by(ServiceTemplate.usage_count.desc(), ServiceTemplate.short_description).limit(limit)).all()


@router.post("/services", response_model=ServiceTemplateOut, status_code=201)
def create_service(data: ServiceTemplateIn, request: Request, db: DB, user: EditorUser) -> Any:
    with write_lock:
        if db.scalar(select(ServiceTemplate).where(ServiceTemplate.short_description == data.short_description)):
            raise Conflict("Taki opis usługi już istnieje", "short_description")
        s = ServiceTemplate(**data.model_dump())
        db.add(s)
        db.flush()
        audit.record(db, user, "create", "service", s.id, f"Dodano opis usługi: {s.short_description}", ip=client_ip(request))
        db.commit()
        return s


@router.put("/services/{item_id}", response_model=ServiceTemplateOut)
def update_service(item_id: int, data: ServiceTemplateIn, request: Request, db: DB, user: EditorUser) -> Any:
    with write_lock:
        s = db.get(ServiceTemplate, item_id)
        if s is None:
            raise NotFound()
        dup = db.scalar(select(ServiceTemplate).where(ServiceTemplate.short_description == data.short_description, ServiceTemplate.id != item_id))
        if dup:
            raise Conflict("Taki opis usługi już istnieje", "short_description")
        before = {k: getattr(s, k) for k in data.model_dump()}
        for k, val in data.model_dump().items():
            setattr(s, k, val)
        audit.record(db, user, "update", "service", s.id, "Zmieniono opis usługi", {"zmiany": audit.diff(before, data.model_dump())}, client_ip(request))
        db.commit()
        return s


@router.delete("/services/{item_id}", response_model=Message)
def delete_service(item_id: int, request: Request, db: DB, user: EditorUser) -> Message:
    with write_lock:
        s = db.get(ServiceTemplate, item_id)
        if s is None:
            raise NotFound()
        audit.record(db, user, "delete", "service", s.id, f"Usunięto opis usługi: {s.short_description}", ip=client_ip(request))
        db.delete(s)  # słownik — zlecenia przechowują własną kopię tekstu
        db.commit()
        return Message(message="Usunięto")


# --- Ceny netto -----------------------------------------------------------------------------------

def _price_out(p: PriceTemplate) -> PriceTemplateOut:
    return PriceTemplateOut(
        id=p.id, route=p.route, net_amount=v.gr_to_decimal_str(p.net_amount_gr) or "0.00",
        unit=p.unit, is_active=p.is_active, usage_count=p.usage_count,
    )


@router.get("/prices", response_model=list[PriceTemplateOut])
def list_prices(db: DB, _: ReaderUser, q: Q = None, active: bool | None = None, limit: Limit = 100) -> Any:
    stmt = select(PriceTemplate)
    if q:
        stmt = stmt.where(PriceTemplate.route.ilike(f"%{q}%"))
    if active is not None:
        stmt = stmt.where(PriceTemplate.is_active == active)
    rows = db.scalars(stmt.order_by(PriceTemplate.usage_count.desc(), PriceTemplate.route).limit(limit)).all()
    return [_price_out(p) for p in rows]


@router.post("/prices", response_model=PriceTemplateOut, status_code=201)
def create_price(data: PriceTemplateIn, request: Request, db: DB, user: EditorUser) -> Any:
    with write_lock:
        gr = v.parse_amount_to_gr(data.net_amount)
        if db.scalar(select(PriceTemplate).where(PriceTemplate.route == data.route, PriceTemplate.net_amount_gr == gr, PriceTemplate.unit == data.unit)):
            raise Conflict("Taka pozycja cenowa już istnieje", "route")
        p = PriceTemplate(route=data.route, net_amount_gr=gr, unit=data.unit, is_active=data.is_active)
        db.add(p)
        db.flush()
        audit.record(db, user, "create", "price", p.id, f"Dodano cenę: {p.route} {data.net_amount} {p.unit}", ip=client_ip(request))
        db.commit()
        return _price_out(p)


@router.put("/prices/{item_id}", response_model=PriceTemplateOut)
def update_price(item_id: int, data: PriceTemplateIn, request: Request, db: DB, user: EditorUser) -> Any:
    with write_lock:
        p = db.get(PriceTemplate, item_id)
        if p is None:
            raise NotFound()
        gr = v.parse_amount_to_gr(data.net_amount)
        dup = db.scalar(select(PriceTemplate).where(
            PriceTemplate.route == data.route, PriceTemplate.net_amount_gr == gr, PriceTemplate.unit == data.unit, PriceTemplate.id != item_id))
        if dup:
            raise Conflict("Taka pozycja cenowa już istnieje", "route")
        before = _price_out(p).model_dump()
        p.route, p.net_amount_gr, p.unit, p.is_active = data.route, gr, data.unit, data.is_active
        audit.record(db, user, "update", "price", p.id, "Zmieniono cenę", {"zmiany": audit.diff(before, _price_out(p).model_dump())}, client_ip(request))
        db.commit()
        return _price_out(p)


@router.delete("/prices/{item_id}", response_model=Message)
def delete_price(item_id: int, request: Request, db: DB, user: EditorUser) -> Message:
    with write_lock:
        p = db.get(PriceTemplate, item_id)
        if p is None:
            raise NotFound()
        audit.record(db, user, "delete", "price", p.id, f"Usunięto cenę: {p.route}", ip=client_ip(request))
        db.delete(p)
        db.commit()
        return Message(message="Usunięto")


@router.get("/units", response_model=list[str])
def list_units(db: DB, _: ReaderUser) -> list[str]:
    configured = settings_store.get(db, "defaults")["units"]
    used = db.scalars(select(OrderItem.unit).distinct()).all() + db.scalars(select(PriceTemplate.unit).distinct()).all()
    seen: list[str] = []
    for u in [*configured, *used]:
        if u and u not in seen:
            seen.append(u)
    return seen


# --- Osoby prowadzące -----------------------------------------------------------------------------

@router.get("/handlers", response_model=list[HandlerOut])
def list_handlers(db: DB, _: ReaderUser, q: Q = None, active: bool | None = None, limit: Limit = 100) -> Any:
    stmt = select(Handler)
    if q:
        stmt = stmt.where(or_(Handler.full_name.ilike(f"%{q}%"), Handler.phone.ilike(f"%{q}%")))
    if active is not None:
        stmt = stmt.where(Handler.is_active == active)
    return db.scalars(stmt.order_by(Handler.usage_count.desc(), Handler.full_name).limit(limit)).all()


@router.post("/handlers", response_model=HandlerOut, status_code=201)
def create_handler(data: HandlerIn, request: Request, db: DB, user: EditorUser) -> Any:
    with write_lock:
        if db.scalar(select(Handler).where(Handler.full_name == data.full_name, Handler.phone == data.phone)):
            raise Conflict("Taka osoba już istnieje", "full_name")
        h = Handler(**data.model_dump())
        db.add(h)
        db.flush()
        audit.record(db, user, "create", "handler", h.id, f"Dodano osobę prowadzącą: {h.full_name}", ip=client_ip(request))
        db.commit()
        return h


@router.put("/handlers/{item_id}", response_model=HandlerOut)
def update_handler(item_id: int, data: HandlerIn, request: Request, db: DB, user: EditorUser) -> Any:
    with write_lock:
        h = db.get(Handler, item_id)
        if h is None:
            raise NotFound()
        dup = db.scalar(select(Handler).where(Handler.full_name == data.full_name, Handler.phone == data.phone, Handler.id != item_id))
        if dup:
            raise Conflict("Taka osoba już istnieje", "full_name")
        before = {k: getattr(h, k) for k in data.model_dump()}
        for k, val in data.model_dump().items():
            setattr(h, k, val)
        audit.record(db, user, "update", "handler", h.id, "Zmieniono osobę prowadzącą", {"zmiany": audit.diff(before, data.model_dump())}, client_ip(request))
        db.commit()
        return h


@router.delete("/handlers/{item_id}", response_model=Message)
def delete_handler(item_id: int, request: Request, db: DB, user: EditorUser) -> Message:
    with write_lock:
        h = db.get(Handler, item_id)
        if h is None:
            raise NotFound()
        audit.record(db, user, "delete", "handler", h.id, f"Usunięto osobę prowadzącą: {h.full_name}", ip=client_ip(request))
        db.delete(h)
        db.commit()
        return Message(message="Usunięto")
