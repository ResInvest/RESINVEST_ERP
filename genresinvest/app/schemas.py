"""Schematy wejścia/wyjścia API (Pydantic v2) z walidacją biznesową i komunikatami po polsku."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from . import validators as v

class ApiModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


# --- Wspólne --------------------------------------------------------------------------------------

class Page(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int


class Message(BaseModel):
    ok: bool = True
    message: str = ""


# --- Auth / użytkownicy ---------------------------------------------------------------------------

class LoginIn(ApiModel):
    username: Annotated[str, Field(min_length=1, max_length=64)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class ChangePasswordIn(ApiModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Annotated[str, Field(min_length=1, max_length=128)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str
    email: str | None
    phone: str | None
    role: str
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime


class UserIn(ApiModel):
    username: Annotated[str, Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9._-]+$")]
    full_name: Annotated[str, Field(min_length=2, max_length=120)]
    email: Annotated[str | None, Field(max_length=160)] = None
    phone: Annotated[str | None, Field(max_length=40)] = None
    role: Literal["admin", "user", "viewer"] = "user"
    is_active: bool = True
    password: Annotated[str | None, Field(max_length=128)] = None

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        if value and not v.is_valid_email(value):
            raise ValueError("Nieprawidłowy adres e-mail")
        return value or None

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        value = v.normalize_phone(value)
        if value and not v.is_valid_phone(value):
            raise ValueError("Nieprawidłowy numer telefonu")
        return value or None


class UserUpdateIn(UserIn):
    username: Annotated[str | None, Field(max_length=64)] = None  # type: ignore[assignment]


# --- Kontrahenci ----------------------------------------------------------------------------------

class ContractorIn(ApiModel):
    # ``country`` musi być pierwsze — walidacja kodu pocztowego i NIP zależy od kraju.
    country: Annotated[str, Field(min_length=2, max_length=2)] = "PL"
    name: Annotated[str, Field(min_length=2, max_length=200)]
    street: Annotated[str, Field(min_length=2, max_length=200)]
    postal_code: Annotated[str, Field(min_length=2, max_length=16)]
    city: Annotated[str, Field(min_length=2, max_length=120)]
    nip: Annotated[str | None, Field(max_length=20)] = None
    phone: Annotated[str | None, Field(max_length=40)] = None
    email: Annotated[str | None, Field(max_length=160)] = None
    contact_person: Annotated[str | None, Field(max_length=120)] = None
    notes: Annotated[str | None, Field(max_length=2000)] = None
    is_active: bool = True
    row_version: int | None = None

    @field_validator("country")
    @classmethod
    def _country(cls, value: str) -> str:
        value = value.upper()
        if not value.isalpha():
            raise ValueError("Kod kraju: 2 litery, np. PL")
        return value

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        value = v.normalize_phone(value)
        if value and not v.is_valid_phone(value):
            raise ValueError("Nieprawidłowy numer telefonu")
        return value or None

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        if value and not v.is_valid_email(value):
            raise ValueError("Nieprawidłowy adres e-mail")
        return value or None

    @field_validator("postal_code")
    @classmethod
    def _postal(cls, value: str, info: ValidationInfo) -> str:
        value = v.normalize_postal_code(value)
        if not v.is_valid_postal_code(value, info.data.get("country", "PL")):
            raise ValueError("Kod pocztowy w formacie 00-000")
        return value

    @field_validator("nip")
    @classmethod
    def _nip(cls, value: str | None, info: ValidationInfo) -> str | None:
        nip = v.normalize_nip(value)
        if nip and info.data.get("country", "PL") == "PL" and not v.is_valid_nip(nip):
            raise ValueError("Nieprawidłowy NIP (błędna suma kontrolna)")
        return nip


class ContractorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    street: str
    postal_code: str
    city: str
    country: str
    nip: str | None
    phone: str | None
    email: str | None
    contact_person: str | None
    notes: str | None
    is_active: bool
    row_version: int
    created_at: datetime
    updated_at: datetime


# --- Słowniki -------------------------------------------------------------------------------------

class ServiceTemplateIn(ApiModel):
    short_description: Annotated[str, Field(min_length=3, max_length=300)]
    detailed_description: Annotated[str, Field(max_length=2000)] = ""
    cargo_type: Annotated[str, Field(max_length=200)] = ""
    is_active: bool = True


class ServiceTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    short_description: str
    detailed_description: str
    cargo_type: str
    is_active: bool
    usage_count: int


class PriceTemplateIn(ApiModel):
    route: Annotated[str, Field(min_length=1, max_length=200)]
    net_amount: str | float | int
    unit: Annotated[str, Field(min_length=1, max_length=40)] = "zł/fracht"
    is_active: bool = True

    @field_validator("net_amount")
    @classmethod
    def _amount(cls, value: Any) -> str:
        return v.gr_to_decimal_str(v.parse_amount_to_gr(value)) or ""


class PriceTemplateOut(BaseModel):
    id: int
    route: str
    net_amount: str
    unit: str
    is_active: bool
    usage_count: int


class HandlerIn(ApiModel):
    full_name: Annotated[str, Field(min_length=3, max_length=120)]
    phone: Annotated[str, Field(max_length=40)] = ""
    email: Annotated[str | None, Field(max_length=160)] = None
    is_active: bool = True

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        value = v.normalize_phone(value)
        if value and not v.is_valid_phone(value):
            raise ValueError("Nieprawidłowy numer telefonu")
        return value

    @field_validator("email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        if value and not v.is_valid_email(value):
            raise ValueError("Nieprawidłowy adres e-mail")
        return value or None


class HandlerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    phone: str
    email: str | None
    is_active: bool
    usage_count: int


# --- Zlecenia -------------------------------------------------------------------------------------

class OrderItemIn(ApiModel):
    route: Annotated[str, Field(min_length=1, max_length=200)]
    net_amount: str | float | int
    unit: Annotated[str, Field(min_length=1, max_length=40)]
    quantity: str | float | int | None = None

    @field_validator("net_amount")
    @classmethod
    def _amount(cls, value: Any) -> str:
        return v.gr_to_decimal_str(v.parse_amount_to_gr(value)) or ""

    @field_validator("quantity")
    @classmethod
    def _qty(cls, value: Any) -> str | None:
        return v.milli_to_str(v.parse_quantity_to_milli(value))


class OrderIn(ApiModel):
    contractor_id: int
    issue_date: date
    issue_place: Annotated[str, Field(min_length=2, max_length=120)]
    contractor_contact_name: Annotated[str, Field(max_length=120)] = ""
    contractor_contact_phone: Annotated[str, Field(max_length=40)] = ""
    service_short: Annotated[str, Field(min_length=3, max_length=300)]
    service_detailed: Annotated[str, Field(max_length=2000)] = ""
    cargo_type: Annotated[str, Field(max_length=200)] = ""
    origin_point: Annotated[str, Field(max_length=300)] = ""
    destination_point: Annotated[str, Field(max_length=300)] = ""
    loading_term: Annotated[str, Field(min_length=2, max_length=200)]
    payment_days: Annotated[int, Field(ge=0, le=365)] = 14
    handler_id: int | None = None
    handler_name: Annotated[str, Field(min_length=3, max_length=120)]
    handler_phone: Annotated[str, Field(max_length=40)] = ""
    notes: Annotated[str, Field(max_length=2000)] = ""
    items: Annotated[list[OrderItemIn], Field(min_length=1, max_length=20)]
    save_to_dictionaries: bool = True
    row_version: int | None = None
    correction_reason: Annotated[str | None, Field(max_length=500)] = None

    @field_validator("contractor_contact_phone", "handler_phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        value = v.normalize_phone(value)
        if value and not v.is_valid_phone(value):
            raise ValueError("Nieprawidłowy numer telefonu")
        return value

    @field_validator("issue_date")
    @classmethod
    def _date(cls, value: date) -> date:
        if not (2000 <= value.year <= 2100):
            raise ValueError("Data spoza zakresu 2000–2100")
        return value

    @field_validator(
        "service_short", "service_detailed", "cargo_type", "origin_point", "destination_point",
        "loading_term", "notes", "issue_place", "handler_name", "contractor_contact_name",
    )
    @classmethod
    def _clean(cls, value: str) -> str:
        # Długość sprawdza już Field(max_length); tu usuwamy znaki sterujące.
        return v.clean_text(value, 10_000)


class CancelIn(ApiModel):
    reason: Annotated[str, Field(min_length=5, max_length=500)]
    row_version: int | None = None


class IssueIn(ApiModel):
    row_version: int | None = None


class OrderItemOut(BaseModel):
    position: int
    route: str
    net_amount: str
    unit: str
    quantity: str | None
    value: str | None


class OrderOut(BaseModel):
    id: int
    number: str | None
    status: str
    revision: int
    row_version: int
    issue_date: date
    issue_place: str
    contractor_id: int
    contractor: dict[str, Any]
    issuer: dict[str, Any]
    contractor_contact_name: str
    contractor_contact_phone: str
    service_short: str
    service_detailed: str
    cargo_type: str
    origin_point: str
    destination_point: str
    loading_term: str
    payment_days: int
    handler_id: int | None
    handler_name: str
    handler_phone: str
    notes: str
    total_net: str | None
    currency: str
    items: list[OrderItemOut]
    issued_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    created_at: datetime
    updated_at: datetime
    created_by: str | None


class OrderListItem(BaseModel):
    id: int
    number: str | None
    status: str
    revision: int
    issue_date: date
    contractor_id: int
    contractor_name: str
    service_short: str
    items_summary: str
    total_net: str | None
    created_at: datetime
    updated_at: datetime


# --- Ustawienia -----------------------------------------------------------------------------------

class CompanySettings(ApiModel):
    name: Annotated[str, Field(min_length=2, max_length=200)]
    legal_name: Annotated[str, Field(min_length=2, max_length=200)]
    street: Annotated[str, Field(min_length=2, max_length=200)]
    postal_code: Annotated[str, Field(min_length=2, max_length=16)]
    city: Annotated[str, Field(min_length=2, max_length=120)]
    nip: Annotated[str, Field(max_length=20)]
    regon: Annotated[str, Field(max_length=20)] = ""
    krs: Annotated[str, Field(max_length=20)] = ""
    court: Annotated[str, Field(max_length=300)] = ""
    share_capital: Annotated[str, Field(max_length=120)] = ""
    correspondence_address: Annotated[str, Field(max_length=200)] = ""
    website: Annotated[str, Field(max_length=120)] = ""

    @field_validator("nip")
    @classmethod
    def _nip(cls, value: str) -> str:
        nip = v.normalize_nip(value)
        if not nip or not v.is_valid_nip(nip):
            raise ValueError("Nieprawidłowy NIP")
        return nip


class DefaultsSettings(ApiModel):
    issue_place: Annotated[str, Field(min_length=2, max_length=120)]
    payment_days: Annotated[int, Field(ge=0, le=365)]
    units: Annotated[list[Annotated[str, Field(min_length=1, max_length=40)]], Field(min_length=1, max_length=30)]


class NumberingSettings(ApiModel):
    pattern: Annotated[str, Field(min_length=5, max_length=50)]
    seq_digits: Annotated[int, Field(ge=1, le=8)]
    reset: Literal["monthly", "yearly"]


class DocumentSettings(ApiModel):
    title: Annotated[str, Field(min_length=2, max_length=60)]
    payment_text: Annotated[str, Field(min_length=3, max_length=200)]
    closing_clause: Annotated[str, Field(max_length=1500)] = ""

    @field_validator("payment_text")
    @classmethod
    def _payment(cls, value: str) -> str:
        if "{days}" not in value:
            raise ValueError("Tekst płatności musi zawierać {days}")
        return value


class SettingsIn(ApiModel):
    company: CompanySettings | None = None
    defaults: DefaultsSettings | None = None
    numbering: NumberingSettings | None = None
    documents: DocumentSettings | None = None
