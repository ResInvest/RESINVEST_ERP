"""Walidacja i normalizacja danych biznesowych (wspólna dla API, importu i testów)."""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

NIP_WEIGHTS = (6, 5, 7, 2, 3, 4, 5, 6, 7)
POSTAL_RE = re.compile(r"^\d{2}-\d{3}$")
PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_AMOUNT_GR = 99_999_999_99  # 99 999 999,99 zł


def normalize_nip(value: str | None) -> str | None:
    """Zwraca 10 cyfr NIP (bez kresek, spacji i prefiksu PL) albo None dla pustej wartości."""
    if value is None:
        return None
    digits = re.sub(r"[\s\-]", "", value.strip().upper())
    if digits.startswith("PL"):
        digits = digits[2:]
    return digits or None


def is_valid_nip(value: str | None) -> bool:
    nip = normalize_nip(value)
    if nip is None or not re.fullmatch(r"\d{10}", nip):
        return False
    checksum = sum(int(d) * w for d, w in zip(nip[:9], NIP_WEIGHTS)) % 11
    return checksum != 10 and checksum == int(nip[9])


def format_nip(nip: str | None) -> str:
    return nip or ""


def normalize_postal_code(value: str | None) -> str:
    v = (value or "").strip()
    if re.fullmatch(r"\d{5}", v):
        v = f"{v[:2]}-{v[2:]}"
    return v


def is_valid_postal_code(value: str, country: str = "PL") -> bool:
    if country != "PL":
        return 2 <= len(value) <= 12
    return bool(POSTAL_RE.match(value))


def normalize_phone(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def is_valid_phone(value: str) -> bool:
    if not PHONE_RE.match(value):
        return False
    return 7 <= len(re.sub(r"\D", "", value)) <= 15


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value)) and len(value) <= 160


def parse_amount_to_gr(value: str | int | float | Decimal) -> int:
    """'900', '900,5', '1 234,56', 900.5 → grosze. Odrzuca >2 miejsc po przecinku i wartości ≤ 0."""
    if isinstance(value, bool):
        raise ValueError("Nieprawidłowa kwota")
    if isinstance(value, (int, Decimal)):
        dec = Decimal(value)
    elif isinstance(value, float):
        dec = Decimal(str(value))
    else:
        text = re.sub(r"[\s ]", "", str(value)).replace("zł", "").replace("PLN", "")
        if text.count(",") == 1 and "." in text:  # 1.234,56
            text = text.replace(".", "")
        text = text.replace(",", ".")
        try:
            dec = Decimal(text)
        except InvalidOperation as exc:
            raise ValueError("Nieprawidłowa kwota") from exc
    if not dec.is_finite():
        raise ValueError("Nieprawidłowa kwota")
    if dec.as_tuple().exponent < -2 and dec != dec.quantize(Decimal("0.01")):  # type: ignore[operator]
        raise ValueError("Kwota może mieć najwyżej 2 miejsca po przecinku")
    gr = int((dec * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if gr <= 0:
        raise ValueError("Kwota musi być większa od zera")
    if gr > MAX_AMOUNT_GR:
        raise ValueError("Kwota jest zbyt duża")
    return gr


def parse_quantity_to_milli(value: str | int | float | Decimal | None) -> int | None:
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    text = str(value).replace(",", ".").replace(" ", "")
    try:
        dec = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError("Nieprawidłowa ilość") from exc
    if not dec.is_finite() or dec <= 0:
        raise ValueError("Ilość musi być większa od zera")
    if dec != dec.quantize(Decimal("0.001")):
        raise ValueError("Ilość może mieć najwyżej 3 miejsca po przecinku")
    milli = int(dec * 1000)
    if milli > 10_000_000_000:
        raise ValueError("Ilość jest zbyt duża")
    return milli


def gr_to_decimal_str(gr: int | None) -> str | None:
    if gr is None:
        return None
    return f"{Decimal(gr) / 100:.2f}"


def milli_to_str(milli: int | None) -> str | None:
    if milli is None:
        return None
    dec = (Decimal(milli) / 1000).normalize()
    return format(dec, "f")


def format_pln(gr: int) -> str:
    """12345678 → '123 456,78' (polski format, spacja niełamliwa jako separator tysięcy)."""
    zl, grosze = divmod(abs(gr), 100)
    groups = f"{zl:,}".replace(",", " ")
    sign = "-" if gr < 0 else ""
    return f"{sign}{groups},{grosze:02d}"


def format_quantity(milli: int) -> str:
    return (milli_to_str(milli) or "").replace(".", ",")


def clean_text(value: str | None, max_len: int) -> str:
    """Usuwa znaki sterujące (poza nową linią/tabulatorem) i przycina spacje."""
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32)
    text = text.strip()
    if len(text) > max_len:
        raise ValueError(f"Tekst jest za długi (maks. {max_len} znaków)")
    return text
