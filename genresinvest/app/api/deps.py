from __future__ import annotations

from typing import Annotated
from urllib.parse import quote

from fastapi import Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db

DB = Annotated[Session, Depends(get_db)]


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


AppSettings = Annotated[Settings, Depends(get_settings)]


class Pagination:
    def __init__(
        self,
        page: Annotated[int, Query(ge=1, le=100_000)] = 1,
        page_size: Annotated[int, Query(ge=1, le=200)] = 25,
    ) -> None:
        self.page = page
        self.page_size = page_size

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


Paging = Annotated[Pagination, Depends()]


def file_response(data: bytes, file_name: str, mime: str, inline: bool = False) -> Response:
    disposition = "inline" if inline else "attachment"
    ascii_name = file_name.encode("ascii", "ignore").decode() or "plik"
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name)}",
            "Cache-Control": "no-store",
        },
    )
