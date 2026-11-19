"""Warstwa bazy danych: silnik SQLite (WAL, synchronous=FULL), sesje, migracje schematu.

SQLite w trybie WAL zapewnia bezpieczny zapis przy awarii zasilania i równoczesny odczyt przez wielu
użytkowników. Serwer działa jako jeden proces (wielu użytkowników przez przeglądarkę), więc zapis
jest serializowany blokadą aplikacji (``write_lock``) i ``busy_timeout``. Kod nie używa składni
specyficznej dla SQLite poza PRAGMA — migracja na PostgreSQL wymaga tylko zmiany URL.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event, inspect, select
from sqlalchemy.orm import Session, sessionmaker

from . import SCHEMA_VERSION
from .models import Base, SchemaVersion

log = logging.getLogger(__name__)

write_lock = threading.RLock()


class Database:
    def __init__(self) -> None:
        self.engine: Engine | None = None
        self.session_factory: sessionmaker[Session] | None = None
        self.path: Path | None = None

    def init(self, db_path: Path) -> None:
        self.dispose()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(
            f"sqlite:///{db_path.as_posix()}",
            connect_args={"check_same_thread": False, "timeout": 30},
            pool_pre_ping=True,
        )

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=FULL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.close()

        self.engine = engine
        self.session_factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
        self.path = db_path
        migrate(engine)

    def dispose(self) -> None:
        if self.engine is not None:
            self.engine.dispose()
        self.engine = None
        self.session_factory = None

    def session(self) -> Session:
        if self.session_factory is None:
            raise RuntimeError("Baza danych nie została zainicjalizowana")
        return self.session_factory()


database = Database()


def get_db() -> Iterator[Session]:
    """Zależność FastAPI: sesja na żądanie, zamykana zawsze (także po błędzie)."""
    session = database.session()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    session = database.session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# --- Migracje -----------------------------------------------------------------------------------
# Każda migracja to funkcja przyjmująca Engine. Wersja 1 tworzy pełny schemat. Kolejne wersje
# dopisujemy na końcu listy (np. ALTER TABLE) — nigdy nie modyfikujemy już wydanych migracji.

def _m1_initial(engine: Engine) -> None:
    Base.metadata.create_all(engine)


MIGRATIONS: dict[int, Callable[[Engine], None]] = {1: _m1_initial}


def current_version(engine: Engine) -> int:
    if not inspect(engine).has_table("schema_version"):
        return 0
    with Session(engine) as s:
        versions = s.scalars(select(SchemaVersion.version)).all()
        return max(versions) if versions else 0


def migrate(engine: Engine) -> None:
    with write_lock:
        version = current_version(engine)
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"Baza danych ma wersję schematu {version}, a program obsługuje {SCHEMA_VERSION}. "
                "Zaktualizuj program."
            )
        for target in sorted(v for v in MIGRATIONS if v > version):
            log.info("Migracja schematu bazy do wersji %s", target)
            MIGRATIONS[target](engine)
            Base.metadata.create_all(engine, tables=[SchemaVersion.__table__])
            with Session(engine) as s:
                s.add(SchemaVersion(version=target))
                s.commit()
