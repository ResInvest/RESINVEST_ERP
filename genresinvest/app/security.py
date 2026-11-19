"""Uwierzytelnianie i autoryzacja.

* Hasła: PBKDF2-HMAC-SHA256 (biblioteka standardowa), 390 000 iteracji, sól 16 B, porównanie stałoczasowe.
* Sesje: losowy token 32 B w ciasteczku HttpOnly + SameSite=Strict; w bazie przechowywany wyłącznie
  skrót SHA-256 tokenu (wyciek bazy nie daje dostępu do sesji). Wylogowanie = usunięcie sesji.
* CSRF: żądania modyfikujące wymagają nagłówka ``X-GRI-Request: 1`` (formularz z obcej strony go nie wyśle).
* Role: admin (wszystko), user (zlecenia, kartoteki, słowniki, raporty), viewer (podgląd i pobieranie).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import User, UserSession, utcnow

PBKDF2_ITERATIONS = 390_000
SESSION_COOKIE = "gri_session"
CSRF_HEADER = "X-GRI-Request"
MIN_PASSWORD_LENGTH = 10


def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations, base64.b64encode(salt).decode(), base64.b64encode(dk).decode()
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iterations, salt_b64, hash_b64 = encoded.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(iterations)
        )
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"Hasło musi mieć co najmniej {MIN_PASSWORD_LENGTH} znaków")
    if not any(c.isdigit() for c in password) or not any(c.isalpha() for c in password):
        problems.append("Hasło musi zawierać litery i cyfry")
    if len(password) > 128:
        problems.append("Hasło jest za długie (maks. 128 znaków)")
    return problems


def generate_password(length: int = 14) -> str:
    alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if not password_problems(pwd):
            return pwd


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def create_session(db: Session, user: User, hours: int, ip: str | None, user_agent: str | None) -> str:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    db.add(
        UserSession(
            token_hash=token_hash(token),
            user_id=user.id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(hours=hours),
            ip=ip,
            user_agent=(user_agent or "")[:255],
        )
    )
    db.execute(delete(UserSession).where(UserSession.expires_at < now))
    return token


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def get_current_user(request: Request, db: Annotated[Session, Depends(get_db)]) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Zaloguj się")
    session = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    now = utcnow()
    if session is None or session.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesja wygasła — zaloguj się ponownie")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Konto jest nieaktywne")
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Brak nagłówka zabezpieczającego żądanie")
    if now - session.last_seen_at > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: str):
    def checker(user: CurrentUser) -> User:
        if user.must_change_password and roles != ("*",):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Najpierw zmień hasło startowe")
        if roles != ("*",) and user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Brak uprawnień do tej operacji")
        return user

    return checker


ReaderUser = Annotated[User, Depends(require_roles("admin", "user", "viewer"))]
EditorUser = Annotated[User, Depends(require_roles("admin", "user"))]
AdminUser = Annotated[User, Depends(require_roles("admin"))]


def is_locked(user: User) -> bool:
    return user.locked_until is not None and user.locked_until > utcnow()


def register_failed_login(user: User, max_attempts: int, lock_minutes: int) -> None:
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= max_attempts:
        user.locked_until = utcnow() + timedelta(minutes=lock_minutes)
        user.failed_logins = 0


def register_successful_login(user: User) -> None:
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = utcnow()


def seconds_until(dt: datetime) -> int:
    return max(0, int((dt - utcnow()).total_seconds()))
