"""Archiwum wygenerowanych dokumentów.

Każda rewizja wystawionego zlecenia ma niezmienny plik PDF i DOCX zapisany atomowo
(plik tymczasowy + ``os.replace``) z sumą SHA-256 w bazie. Przy pobieraniu suma jest weryfikowana —
uszkodzony lub podmieniony plik zostaje wykryty i wygenerowany ponownie z migawki rewizji.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db import write_lock
from ...models import Document, Order, User
from .. import settings_store
from ..orders import to_dict
from .content import build_content
from .docx_renderer import render_docx
from .pdf_renderer import render_pdf

log = logging.getLogger(__name__)

MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


@dataclass
class RenderedFile:
    data: bytes
    file_name: str
    mime: str


def render(db: Session, order_data: dict, fmt: str) -> RenderedFile:
    if fmt not in MIME:
        raise ValueError("Nieobsługiwany format")
    content = build_content(order_data, settings_store.get(db, "company"), settings_store.get(db, "documents"))
    data = render_pdf(content) if fmt == "pdf" else render_docx(content)
    return RenderedFile(data=data, file_name=f"{content.file_stem}.{fmt}", mime=MIME[fmt])


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp_", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def get_or_create(db: Session, documents_dir: Path, order: Order, fmt: str, user: User) -> RenderedFile:
    """Zwraca archiwalny plik bieżącej rewizji (tworzy go przy pierwszym pobraniu)."""
    if order.status == "draft":
        return render(db, to_dict(order), fmt)
    with write_lock:
        doc = db.scalar(
            select(Document).where(
                Document.order_id == order.id, Document.revision == order.revision, Document.format == fmt
            )
        )
        # Anulowane zlecenie dostaje osobny plik z oznaczeniem „ANULOWANE”.
        if doc is not None and order.status == "cancelled" and "_ANULOWANE" not in doc.file_name:
            doc = None
            db.query(Document).filter(
                Document.order_id == order.id, Document.revision == order.revision, Document.format == fmt
            ).delete()
            db.flush()
        if doc is not None:
            path = documents_dir / doc.relative_path
            if path.is_file():
                data = path.read_bytes()
                if _sha256(data) == doc.sha256:
                    return RenderedFile(data=data, file_name=doc.file_name, mime=MIME[fmt])
                log.error("Suma kontrolna pliku %s nie zgadza się — generuję ponownie", path)
            else:
                log.error("Brak pliku archiwalnego %s — generuję ponownie", path)
        rendered = render(db, to_dict(order), fmt)
        if order.status == "cancelled":
            rendered.file_name = rendered.file_name.replace(f".{fmt}", f"_ANULOWANE.{fmt}")
        year = order.issue_date.year
        rel = Path(f"{year:04d}") / f"{order.issue_date.month:02d}" / f"{order.id:06d}_r{order.revision}_{rendered.file_name}"
        _atomic_write(documents_dir / rel, rendered.data)
        if doc is None:
            doc = Document(order_id=order.id, revision=order.revision, format=fmt)
            db.add(doc)
        doc.relative_path = rel.as_posix()
        doc.file_name = rendered.file_name
        doc.sha256 = _sha256(rendered.data)
        doc.size_bytes = len(rendered.data)
        doc.created_by_id = user.id
        db.commit()
        return rendered


def read_archived(db: Session, documents_dir: Path, doc: Document) -> RenderedFile:
    path = documents_dir / doc.relative_path
    if not path.is_file():
        raise FileNotFoundError(doc.relative_path)
    data = path.read_bytes()
    if _sha256(data) != doc.sha256:
        raise ValueError("Plik archiwalny jest uszkodzony (niezgodna suma kontrolna)")
    return RenderedFile(data=data, file_name=doc.file_name, mime=MIME[doc.format])
