"""Import / eksport kartotek: kontrahenci (CSV) i pełne słowniki (JSON)."""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import APP_VERSION, audit
from .. import validators as v
from ..db import write_lock
from ..errors import _translate
from ..models import Contractor, Handler, PriceTemplate, ServiceTemplate, User
from ..schemas import ContractorIn, HandlerIn, PriceTemplateIn, ServiceTemplateIn
from .reports import to_csv

CONTRACTOR_COLUMNS = [
    ("name", "nazwa"), ("street", "ulica"), ("postal_code", "kod_pocztowy"), ("city", "miejscowosc"),
    ("country", "kraj"), ("nip", "nip"), ("phone", "telefon"), ("email", "email"),
    ("contact_person", "osoba_kontaktowa"), ("notes", "uwagi"), ("is_active", "aktywny"),
]
ALIASES = {
    "nazwa": "name", "firma": "name", "name": "name", "nazwa firmy": "name",
    "ulica": "street", "adres": "street", "street": "street",
    "kod_pocztowy": "postal_code", "kod pocztowy": "postal_code", "kod": "postal_code", "postal_code": "postal_code",
    "miejscowosc": "city", "miejscowość": "city", "miasto": "city", "city": "city",
    "kraj": "country", "country": "country", "nip": "nip",
    "telefon": "phone", "tel": "phone", "phone": "phone", "email": "email", "e-mail": "email",
    "osoba_kontaktowa": "contact_person", "osoba kontaktowa": "contact_person", "kontakt": "contact_person",
    "uwagi": "notes", "notes": "notes", "aktywny": "is_active", "is_active": "is_active",
}


def export_contractors_csv(db: Session) -> bytes:
    rows = []
    for c in db.scalars(select(Contractor).order_by(Contractor.name)):
        rows.append([
            c.name, c.street, c.postal_code, c.city, c.country, c.nip or "", c.phone or "", c.email or "",
            c.contact_person or "", c.notes or "", "tak" if c.is_active else "nie",
        ])
    return to_csv([pl for _, pl in CONTRACTOR_COLUMNS], rows)


class _Semicolon(csv.excel):
    delimiter = ";"


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1250"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("Nie rozpoznano kodowania pliku (obsługiwane: UTF-8, Windows-1250)")


def import_contractors_csv(db: Session, raw: bytes, user: User, dry_run: bool, ip: str | None) -> dict[str, Any]:
    if len(raw) > 5 * 1024 * 1024:
        raise ValueError("Plik jest za duży (maks. 5 MB)")
    text = _decode(raw)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t")
    except csv.Error:
        dialect = _Semicolon
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("Plik nie ma wiersza nagłówka")
    mapping = {h: ALIASES.get((h or "").strip().lower()) for h in reader.fieldnames}
    if "name" not in mapping.values():
        raise ValueError("Brak kolumny „nazwa”")

    report: dict[str, Any] = {"created": 0, "updated": 0, "skipped": 0, "errors": [], "dry_run": dry_run}
    with write_lock:
        for line_no, row in enumerate(reader, start=2):
            data: dict[str, Any] = {}
            for header, value in row.items():
                key = mapping.get(header)
                if key:
                    data[key] = (value or "").strip()
            if not any(data.values()):
                continue
            if "is_active" in data:
                data["is_active"] = data["is_active"].lower() not in ("nie", "0", "false", "n")
            data = {k: (val if val != "" else None) for k, val in data.items()}
            data.setdefault("country", "PL")
            if data.get("country") is None:
                data["country"] = "PL"
            try:
                payload = ContractorIn(**{k: val for k, val in data.items() if val is not None})
            except ValidationError as exc:
                msgs = [f"{'.'.join(str(p) for p in e['loc'])}: {_translate(e)}" for e in exc.errors()]
                report["errors"].append({"line": line_no, "name": data.get("name"), "messages": msgs})
                report["skipped"] += 1
                continue
            existing = None
            if payload.nip:
                existing = db.scalar(select(Contractor).where(Contractor.nip == payload.nip))
            if existing is None:
                existing = db.scalar(select(Contractor).where(func.lower(Contractor.name) == payload.name.lower()))
            values = payload.model_dump(exclude={"row_version"})
            if existing is None:
                db.add(Contractor(**values, created_by_id=user.id, updated_by_id=user.id))
                report["created"] += 1
            else:
                for k, val in values.items():
                    setattr(existing, k, val)
                existing.row_version += 1
                existing.updated_by_id = user.id
                report["updated"] += 1
            db.flush()
        if dry_run:
            db.rollback()
        else:
            audit.record(
                db, user, "import", "contractor", None,
                f"Import kontrahentów CSV: nowi {report['created']}, zaktualizowani {report['updated']}, pominięci {report['skipped']}",
                {"errors": report["errors"][:50]}, ip,
            )
            db.commit()
    return report


def export_json(db: Session) -> dict[str, Any]:
    return {
        "format": "genresinvest-data",
        "version": 1,
        "app_version": APP_VERSION,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "contractors": [
            {c[0]: getattr(x, c[0]) for c in CONTRACTOR_COLUMNS}
            for x in db.scalars(select(Contractor).order_by(Contractor.id))
        ],
        "services": [
            {"short_description": s.short_description, "detailed_description": s.detailed_description,
             "cargo_type": s.cargo_type, "is_active": s.is_active}
            for s in db.scalars(select(ServiceTemplate).order_by(ServiceTemplate.id))
        ],
        "prices": [
            {"route": p.route, "net_amount": v.gr_to_decimal_str(p.net_amount_gr), "unit": p.unit, "is_active": p.is_active}
            for p in db.scalars(select(PriceTemplate).order_by(PriceTemplate.id))
        ],
        "handlers": [
            {"full_name": h.full_name, "phone": h.phone, "email": h.email, "is_active": h.is_active}
            for h in db.scalars(select(Handler).order_by(Handler.id))
        ],
    }


def import_json(db: Session, data: dict[str, Any], user: User, ip: str | None) -> dict[str, Any]:
    if data.get("format") != "genresinvest-data":
        raise ValueError("To nie jest plik eksportu GenResInvest")
    report = {"contractors": 0, "services": 0, "prices": 0, "handlers": 0, "errors": []}
    with write_lock:
        for raw in data.get("contractors", []):
            try:
                p = ContractorIn(**{k: val for k, val in raw.items() if val is not None})
            except ValidationError as exc:
                report["errors"].append(f"Kontrahent {raw.get('name')}: {_translate(exc.errors()[0])}")
                continue
            existing = db.scalar(select(Contractor).where(Contractor.nip == p.nip)) if p.nip else None
            existing = existing or db.scalar(select(Contractor).where(func.lower(Contractor.name) == p.name.lower()))
            if existing is None:
                db.add(Contractor(**p.model_dump(exclude={"row_version"}), created_by_id=user.id))
                report["contractors"] += 1
        for raw in data.get("services", []):
            try:
                s = ServiceTemplateIn(**raw)
            except ValidationError as exc:
                report["errors"].append(f"Usługa: {_translate(exc.errors()[0])}")
                continue
            if not db.scalar(select(ServiceTemplate).where(ServiceTemplate.short_description == s.short_description)):
                db.add(ServiceTemplate(**s.model_dump()))
                report["services"] += 1
        for raw in data.get("prices", []):
            try:
                p2 = PriceTemplateIn(**raw)
            except ValidationError as exc:
                report["errors"].append(f"Cena: {_translate(exc.errors()[0])}")
                continue
            gr = v.parse_amount_to_gr(p2.net_amount)
            if not db.scalar(select(PriceTemplate).where(
                PriceTemplate.route == p2.route, PriceTemplate.net_amount_gr == gr, PriceTemplate.unit == p2.unit
            )):
                db.add(PriceTemplate(route=p2.route, net_amount_gr=gr, unit=p2.unit, is_active=p2.is_active))
                report["prices"] += 1
        for raw in data.get("handlers", []):
            try:
                h = HandlerIn(**raw)
            except ValidationError as exc:
                report["errors"].append(f"Osoba: {_translate(exc.errors()[0])}")
                continue
            if not db.scalar(select(Handler).where(Handler.full_name == h.full_name, Handler.phone == h.phone)):
                db.add(Handler(**h.model_dump()))
                report["handlers"] += 1
        db.flush()
        audit.record(db, user, "import", "data", None, f"Import danych JSON: {report}", None, ip)
        db.commit()
    return report
