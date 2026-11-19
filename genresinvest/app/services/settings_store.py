"""Ustawienia aplikacji przechowywane w bazie (dane firmy, wartości domyślne, numeracja)."""

from __future__ import annotations

import copy
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AppSetting

DEFAULTS: dict[str, Any] = {
    "company": {
        "name": "ResInvest Commodities PL",
        "legal_name": "ResInvest Commodities PL S.A.",
        "street": "ul. Gawronów 22",
        "postal_code": "40-527",
        "city": "Katowice",
        "nip": "2060002073",
        "regon": "242858882",
        "krs": "0000411384",
        "court": "Sąd Rejonowy Katowice - Wschód w Katowicach, VIII Wydział Gospodarczy Krajowego Rejestru Sądowego",
        "share_capital": "500 000,00 zł (wpłacony w całości)",
        "correspondence_address": "ul. Legionów 83, pok.1, 43-502 Czechowice-Dziedzice",
        "website": "www.resinvestcommodities.com",
    },
    "defaults": {
        "issue_place": "Katowice",
        "payment_days": 14,
        "units": ["zł/fracht", "zł/t", "zł/km", "zł/kurs", "zł/h", "zł/m³", "zł"],
    },
    "numbering": {
        "pattern": "ZL/{SEQ}/{MM}/{YYYY}",
        "seq_digits": 3,
        "reset": "monthly",  # monthly | yearly
    },
    "documents": {
        "title": "ZLECENIE",
        "payment_text": "Płatność: {days} dni od daty wystawienia faktury",
        "closing_clause": "",
    },
}

ALLOWED_KEYS = tuple(DEFAULTS)


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = value
    return result


def get_all(db: Session) -> dict[str, Any]:
    stored = {row.key: row.value for row in db.scalars(select(AppSetting))}
    return {key: _merge(DEFAULTS[key], stored.get(key) or {}) for key in DEFAULTS}


def get(db: Session, key: str) -> dict[str, Any]:
    row = db.get(AppSetting, key)
    return _merge(DEFAULTS[key], (row.value if row else None) or {})


def put(db: Session, key: str, value: dict[str, Any]) -> dict[str, Any]:
    if key not in DEFAULTS:
        raise KeyError(key)
    merged = _merge(DEFAULTS[key], value)
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=merged))
    else:
        row.value = merged
    return merged
