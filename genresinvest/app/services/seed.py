"""Pierwsze uruchomienie: konto administratora + dane startowe (kartoteki ze wzorów zleceń)."""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import Settings, install_dir
from ..models import Contractor, Handler, Order, PriceTemplate, ServiceTemplate, User
from ..schemas import OrderIn
from ..security import generate_password, hash_password
from . import orders as order_service

log = logging.getLogger(__name__)


def sample_data_dir() -> Path:
    from ..config import app_root, is_frozen

    return (app_root().parent / "sample_data") if is_frozen() else install_dir() / "sample_data"


def ensure_admin(db: Session, settings: Settings) -> str | None:
    """Tworzy konto ``admin`` przy pustej bazie. Zwraca hasło startowe (do wyświetlenia raz)."""
    if db.scalar(select(func.count()).select_from(User)):
        return None
    password = settings.initial_admin_password or generate_password()
    db.add(
        User(
            username="admin",
            full_name="Administrator",
            role="admin",
            password_hash=hash_password(password),
            must_change_password=True,
        )
    )
    audit.record(db, None, "create", "user", "admin", "Utworzono konto administratora (pierwsze uruchomienie)")
    db.commit()
    note = settings.data_dir / "HASLO_STARTOWE_ADMINA.txt"
    note.write_text(
        "GenResInvest 1.0 — pierwsze logowanie\n\n"
        f"Login: admin\nHasło startowe: {password}\n\n"
        "Po zalogowaniu program wymusi zmianę hasła. Usuń ten plik po pierwszym logowaniu.\n",
        encoding="utf-8",
    )
    log.warning("Utworzono konto admin. Hasło startowe zapisano w %s", note)
    return password


def load_start_data(db: Session) -> int:
    """Wczytuje ``sample_data/dane_startowe.json`` do pustych kartotek (raz)."""
    if db.scalar(select(func.count()).select_from(Contractor)):
        return 0
    path = sample_data_dir() / "dane_startowe.json"
    if not path.is_file():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    for c in data.get("contractors", []):
        db.add(Contractor(**c))
    for s in data.get("services", []):
        db.add(ServiceTemplate(**s))
    for p in data.get("prices", []):
        db.add(PriceTemplate(route=p["route"], net_amount_gr=int(round(float(p["net_amount"]) * 100)), unit=p["unit"]))
    for h in data.get("handlers", []):
        db.add(Handler(**h))
    audit.record(db, None, "import", "data", None, "Wczytano dane startowe (kartoteki ze wzorów zleceń)")
    db.commit()
    return len(data.get("contractors", []))


def create_demo_orders(db: Session, count: int = 24) -> int:
    """Dane testowe do raportów: zlecenia z ostatnich miesięcy (część wystawiona, część anulowana)."""
    admin = db.scalar(select(User).where(User.role == "admin"))
    contractors = db.scalars(select(Contractor)).all()
    service = db.scalar(select(ServiceTemplate))
    handler = db.scalar(select(Handler))
    if not (admin and contractors and service and handler):
        raise RuntimeError("Najpierw wczytaj dane startowe")
    if db.scalar(select(func.count()).select_from(Order)):
        return 0
    today = date.today()
    routes = [("Zabrze - Chorzów", "900.00", "zł/fracht"), ("Gliwice - Katowice", "35.50", "zł/t"), ("Bytom - Sosnowiec", "1100.00", "zł/fracht")]
    created = 0
    for i in range(count):
        route = routes[i % len(routes)]
        payload = OrderIn(
            contractor_id=contractors[i % len(contractors)].id,
            issue_date=today - timedelta(days=12 * i),
            issue_place="Katowice",
            service_short=service.short_description,
            service_detailed=service.detailed_description,
            cargo_type=service.cargo_type,
            origin_point="jak wyżej",
            destination_point="jak wyżej",
            loading_term=(today - timedelta(days=12 * i)).strftime("%m.%Y"),
            payment_days=14,
            handler_id=handler.id,
            handler_name=handler.full_name,
            handler_phone=handler.phone,
            items=[{"route": route[0], "net_amount": route[1], "unit": route[2], "quantity": str(5 + i % 7) if i % 3 else None}],
            save_to_dictionaries=False,
        )
        order = order_service.create_draft(db, payload, admin, "seed")
        if i % 6 != 5:
            order_service.issue_order(db, order, admin, "seed")
            if i % 8 == 7:
                order_service.cancel_order(db, order, "Dane testowe — anulowanie", admin, "seed", None)
        created += 1
    return created
