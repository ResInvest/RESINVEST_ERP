"""Model danych (SQLAlchemy 2.0).

Zasady:
* kwoty pieniężne w groszach (``int``) — brak błędów zaokrągleń float;
* zlecenie po wystawieniu przechowuje *migawki* (snapshot) danych kontrahenta i wystawcy,
  więc późniejsza edycja kartoteki nie zmienia historii dokumentów;
* każda zmiana wystawionego zlecenia to korekta (nowa rewizja + zapis w ``order_revisions``);
* ``row_version`` — blokada optymistyczna przy pracy wielu użytkowników.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


ROLES = ("admin", "user", "viewer")


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(160))
    phone: Mapped[str | None] = mapped_column(String(40))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship()


class Contractor(TimestampMixin, Base):
    """Kontrahent (Zleceniobiorca — przewoźnik / usługodawca)."""

    __tablename__ = "contractors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    street: Mapped[str] = mapped_column(String(200), default="")
    postal_code: Mapped[str] = mapped_column(String(16), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    country: Mapped[str] = mapped_column(String(2), default="PL")
    nip: Mapped[str | None] = mapped_column(String(20), unique=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(160))
    contact_person: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ServiceTemplate(TimestampMixin, Base):
    """Słownik opisów usług (krótki + dokładny opis, rodzaj towaru)."""

    __tablename__ = "service_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    short_description: Mapped[str] = mapped_column(String(300), unique=True)
    detailed_description: Mapped[str] = mapped_column(Text, default="")
    cargo_type: Mapped[str] = mapped_column(String(200), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)


class PriceTemplate(TimestampMixin, Base):
    """Słownik cen netto (trasa/pozycja + stawka + jednostka)."""

    __tablename__ = "price_templates"
    __table_args__ = (UniqueConstraint("route", "net_amount_gr", "unit", name="uq_price_route_amount_unit"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    route: Mapped[str] = mapped_column(String(200), index=True)
    net_amount_gr: Mapped[int] = mapped_column(Integer)
    unit: Mapped[str] = mapped_column(String(40), default="zł/fracht")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)


class Handler(TimestampMixin, Base):
    """Osoby prowadzące sprawę po stronie Zleceniodawcy (ResInvest)."""

    __tablename__ = "handlers"
    __table_args__ = (UniqueConstraint("full_name", "phone", name="uq_handler_name_phone"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str | None] = mapped_column(String(160))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)


ORDER_STATUSES = ("draft", "issued", "cancelled")


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_issue_date", "issue_date"),
        Index("ix_orders_status", "status"),
        UniqueConstraint("period_key", "seq", name="uq_orders_period_seq"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str | None] = mapped_column(String(60), unique=True)
    period_key: Mapped[str | None] = mapped_column(String(10))
    seq: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    row_version: Mapped[int] = mapped_column(Integer, default=1)

    issue_date: Mapped[date] = mapped_column(Date)
    issue_place: Mapped[str] = mapped_column(String(120), default="Katowice")

    contractor_id: Mapped[int] = mapped_column(ForeignKey("contractors.id", ondelete="RESTRICT"), index=True)
    contractor_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    issuer_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    contractor_contact_name: Mapped[str] = mapped_column(String(120), default="")
    contractor_contact_phone: Mapped[str] = mapped_column(String(40), default="")

    service_short: Mapped[str] = mapped_column(String(300))
    service_detailed: Mapped[str] = mapped_column(Text, default="")
    cargo_type: Mapped[str] = mapped_column(String(200), default="")
    origin_point: Mapped[str] = mapped_column(String(300), default="")
    destination_point: Mapped[str] = mapped_column(String(300), default="")
    loading_term: Mapped[str] = mapped_column(String(200), default="")
    payment_days: Mapped[int] = mapped_column(Integer, default=14)

    handler_id: Mapped[int | None] = mapped_column(ForeignKey("handlers.id", ondelete="SET NULL"))
    handler_name: Mapped[str] = mapped_column(String(120), default="")
    handler_phone: Mapped[str] = mapped_column(String(40), default="")

    notes: Mapped[str] = mapped_column(Text, default="")
    total_net_gr: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="PLN")

    issued_at: Mapped[datetime | None] = mapped_column(DateTime)
    issued_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    contractor: Mapped[Contractor] = relationship()
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderItem.position"
    )
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])


class OrderItem(Base):
    """Pozycja cenowa zlecenia (np. „Zabrze - Chorzów: 900,00 zł/fracht”)."""

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    route: Mapped[str] = mapped_column(String(200))
    net_amount_gr: Mapped[int] = mapped_column(Integer)
    unit: Mapped[str] = mapped_column(String(40))
    quantity_milli: Mapped[int | None] = mapped_column(Integer)  # ilość ×1000 (np. 12,5 t → 12500)

    order: Mapped[Order] = relationship(back_populates="items")


class OrderRevision(Base):
    """Pełna migawka zlecenia dla każdej rewizji (wystawienie, korekty, anulowanie)."""

    __tablename__ = "order_revisions"
    __table_args__ = (UniqueConstraint("order_id", "revision", "kind", name="uq_order_revision_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))  # issue | correction | cancel
    reason: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by_name: Mapped[str] = mapped_column(String(120), default="")


class Document(Base):
    """Wygenerowany plik (PDF/DOCX) z sumą kontrolną SHA-256."""

    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("order_id", "revision", "format", name="uq_document_order_rev_fmt"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    format: Mapped[str] = mapped_column(String(8))
    relative_path: Mapped[str] = mapped_column(String(400))
    file_name: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_ts", "ts"), Index("ix_audit_entity", "entity", "entity_id"))

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    username: Mapped[str] = mapped_column(String(64), default="system")
    action: Mapped[str] = mapped_column(String(40))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(String(500), default="")
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))


class AppSetting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class NumberCounter(Base):
    __tablename__ = "number_counters"

    period_key: Mapped[str] = mapped_column(String(10), primary_key=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0)


class SchemaVersion(Base):
    __tablename__ = "schema_version"

    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
