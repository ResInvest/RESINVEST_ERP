"""Numeracja zleceń bez luk i duplikatów.

Numer nadawany jest dopiero przy *wystawieniu* (szkice nie zużywają numerów). Licznik per okres
(miesiąc lub rok) jest zwiększany w tej samej transakcji co wystawienie, pod blokadą zapisu, a
unikalność gwarantuje dodatkowo ograniczenie UNIQUE w bazie.
"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy.orm import Session

from ..models import NumberCounter

TOKEN_RE = re.compile(r"\{(SEQ|MM|YYYY|YY)\}")


def period_key(issue_date: date, reset: str) -> str:
    return f"{issue_date.year:04d}" if reset == "yearly" else f"{issue_date.year:04d}-{issue_date.month:02d}"


def validate_pattern(pattern: str) -> None:
    if "{SEQ}" not in pattern:
        raise ValueError("Wzór numeru musi zawierać {SEQ}")
    leftovers = TOKEN_RE.sub("", pattern)
    if "{" in leftovers or "}" in leftovers:
        raise ValueError("Dozwolone znaczniki: {SEQ}, {MM}, {YYYY}, {YY}")
    if len(pattern) > 50:
        raise ValueError("Wzór numeru jest za długi")


def render_number(pattern: str, seq: int, digits: int, issue_date: date) -> str:
    values = {
        "SEQ": str(seq).zfill(max(1, digits)),
        "MM": f"{issue_date.month:02d}",
        "YYYY": f"{issue_date.year:04d}",
        "YY": f"{issue_date.year % 100:02d}",
    }
    return TOKEN_RE.sub(lambda m: values[m.group(1)], pattern)


def next_number(db: Session, issue_date: date, numbering: dict) -> tuple[str, str, int]:
    """Rezerwuje kolejny numer. Wywoływać w transakcji wystawienia (pod ``write_lock``)."""
    key = period_key(issue_date, numbering.get("reset", "monthly"))
    counter = db.get(NumberCounter, key)
    if counter is None:
        counter = NumberCounter(period_key=key, last_seq=0)
        db.add(counter)
    counter.last_seq += 1
    db.flush()
    number = render_number(numbering["pattern"], counter.last_seq, int(numbering.get("seq_digits", 3)), issue_date)
    return number, key, counter.last_seq
