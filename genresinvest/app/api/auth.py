"""Logowanie, wylogowanie, bieżący użytkownik, zmiana hasła."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from .. import audit
from ..models import User, UserSession
from ..schemas import ChangePasswordIn, LoginIn, Message, UserOut
from ..security import (
    SESSION_COOKIE,
    CurrentUser,
    client_ip,
    create_session,
    hash_password,
    is_locked,
    password_problems,
    register_failed_login,
    register_successful_login,
    seconds_until,
    token_hash,
    verify_password,
)
from .deps import DB, AppSettings

router = APIRouter(prefix="/auth", tags=["Autoryzacja"])

# Stały skrót do porównania, gdy użytkownik nie istnieje (ten sam czas odpowiedzi — brak enumeracji kont).
_DUMMY_HASH = hash_password("dummy-password-0", iterations=390_000)


@router.post("/login", response_model=UserOut)
def login(data: LoginIn, request: Request, response: Response, db: DB, settings: AppSettings) -> User:
    user = db.scalar(select(User).where(User.username == data.username.strip().lower()))
    ip = client_ip(request)
    if user is not None and is_locked(user):
        minutes = seconds_until(user.locked_until) // 60 + 1  # type: ignore[arg-type]
        raise HTTPException(status.HTTP_423_LOCKED, f"Konto zablokowane po nieudanych próbach. Spróbuj za {minutes} min.")
    valid = verify_password(data.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not valid or not user.is_active:
        if user is not None:
            register_failed_login(user, settings.login_max_attempts, settings.login_lock_minutes)
            audit.record(db, user, "login_failed", "user", user.id, "Nieudane logowanie", ip=ip)
            db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Nieprawidłowy login lub hasło")
    register_successful_login(user)
    token = create_session(db, user, settings.session_hours, ip, request.headers.get("user-agent"))
    audit.record(db, user, "login", "user", user.id, "Zalogowano", ip=ip)
    db.commit()
    response.set_cookie(
        SESSION_COOKIE, token, max_age=settings.session_hours * 3600, httponly=True,
        samesite="strict", secure=settings.secure_cookies, path="/",
    )
    return user


@router.post("/logout", response_model=Message)
def logout(request: Request, response: Response, db: DB, user: CurrentUser) -> Message:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == token_hash(token)))
    audit.record(db, user, "logout", "user", user.id, "Wylogowano", ip=client_ip(request))
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return Message(message="Wylogowano")


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.post("/change-password", response_model=Message)
def change_password(data: ChangePasswordIn, request: Request, db: DB, user: CurrentUser) -> Message:
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(422, detail="Obecne hasło jest nieprawidłowe")
    problems = password_problems(data.new_password)
    if data.new_password == data.current_password:
        problems.append("Nowe hasło musi różnić się od obecnego")
    if problems:
        raise HTTPException(422, detail="; ".join(problems))
    user.password_hash = hash_password(data.new_password)
    user.must_change_password = False
    # Wyloguj pozostałe sesje użytkownika (bezpieczeństwo po zmianie hasła).
    current = token_hash(request.cookies.get(SESSION_COOKIE, ""))
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.token_hash != current))
    audit.record(db, user, "change_password", "user", user.id, "Zmieniono hasło", ip=client_ip(request))
    db.commit()
    return Message(message="Hasło zostało zmienione")
