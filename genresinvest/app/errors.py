"""Wyjątki aplikacyjne i jednolity format odpowiedzi błędu.

Każdy błąd API ma postać: ``{"detail": "komunikat", "errors": [{"field": "items.0.net_amount", "message": "..."}]}``.
Pole ``field`` pozwala interfejsowi ustawić fokus na błędnym polu formularza.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

log = logging.getLogger(__name__)


class AppError(Exception):
    def __init__(self, message: str, status_code: int = 400, field: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.field = field


class NotFound(AppError):
    def __init__(self, what: str = "Nie znaleziono rekordu") -> None:
        super().__init__(what, 404)


class Conflict(AppError):
    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message, 409, field)


def check_version(current: int, sent: int | None) -> None:
    """Blokada optymistyczna — chroni przed nadpisaniem cudzych zmian."""
    if sent is not None and sent != current:
        raise Conflict("Rekord został w międzyczasie zmieniony przez innego użytkownika. Odśwież dane i spróbuj ponownie.")


_PYDANTIC_PL = {
    "missing": "Pole jest wymagane",
    "string_too_short": "Wartość jest za krótka (min. {min_length} zn.)",
    "string_too_long": "Wartość jest za długa (maks. {max_length} zn.)",
    "too_short": "Wymagana co najmniej {min_length} pozycja",
    "too_long": "Dozwolone najwyżej {max_length} pozycji",
    "int_parsing": "Wpisz liczbę całkowitą",
    "date_from_datetime_parsing": "Nieprawidłowa data",
    "date_parsing": "Nieprawidłowa data",
    "greater_than_equal": "Wartość musi być ≥ {ge}",
    "less_than_equal": "Wartość musi być ≤ {le}",
    "extra_forbidden": "Nieznane pole",
    "literal_error": "Niedozwolona wartość",
    "string_pattern_mismatch": "Niedozwolone znaki",
}


def _translate(err: dict) -> str:
    etype = err.get("type", "")
    if etype == "value_error":
        msg = str(err.get("msg", ""))
        return msg.removeprefix("Value error, ")
    template = _PYDANTIC_PL.get(etype)
    if template:
        try:
            return template.format(**(err.get("ctx") or {}))
        except (KeyError, IndexError):
            return template
    return str(err.get("msg", "Nieprawidłowa wartość"))


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        errors = [{"field": exc.field, "message": exc.message}] if exc.field else []
        return JSONResponse({"detail": exc.message, "errors": errors}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = []
        for err in exc.errors():
            loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path")]
            # Pydantic dodaje nazwę typu przy unii (np. "str") — pomijamy ją w ścieżce pola.
            loc = [p for p in loc if p not in ("str", "float", "int", "function-after[_amount(), union[str,float,int]]")]
            errors.append({"field": ".".join(loc) or None, "message": _translate(err)})
        first = errors[0]["message"] if errors else "Nieprawidłowe dane"
        return JSONResponse(
            {"detail": f"Popraw zaznaczone pola: {first}" if len(errors) > 1 else first, "errors": errors},
            status_code=422,
        )

    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse({"detail": exc.detail, "errors": []}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        log.warning("IntegrityError: %s", exc.orig)
        return JSONResponse(
            {"detail": "Operacja narusza spójność danych (duplikat lub powiązany rekord).", "errors": []},
            status_code=409,
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Nieobsłużony błąd: %s", exc)
        return JSONResponse(
            {"detail": "Wystąpił nieoczekiwany błąd serwera. Szczegóły zapisano w dzienniku.", "errors": []},
            status_code=500,
        )
