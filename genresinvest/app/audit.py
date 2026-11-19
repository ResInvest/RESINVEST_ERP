"""Dziennik zdarzeń (historia operacji). Zapis w tej samej transakcji co zmiana danych."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import AuditLog, User


def record(
    db: Session,
    user: User | None,
    action: str,
    entity: str,
    entity_id: Any = None,
    summary: str = "",
    details: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else "system",
            action=action,
            entity=entity,
            entity_id=None if entity_id is None else str(entity_id),
            summary=summary[:500],
            details=details,
            ip=ip,
        )
    )


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Zwraca tylko zmienione pola w formie {pole: {"było": x, "jest": y}}."""
    changes: dict[str, dict[str, Any]] = {}
    for key in sorted(set(before) | set(after)):
        if before.get(key) != after.get(key):
            changes[key] = {"było": before.get(key), "jest": after.get(key)}
    return changes
