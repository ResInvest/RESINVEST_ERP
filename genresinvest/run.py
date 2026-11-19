"""Punkt startowy GenResInvest 1.0 (tryb deweloperski i plik .exe Windows).

Przykłady:
    python run.py                      # start serwera (http://127.0.0.1:8765) i otwarcie przeglądarki
    python run.py --host 0.0.0.0       # dostęp z innych komputerów i telefonów w sieci firmowej
    python run.py --demo-orders        # dane testowe do raportów (przykładowe zlecenia)
    python run.py --backup-now         # kopia zapasowa i wyjście
    python run.py --reset-admin        # nowe hasło startowe dla konta admin
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1" if host in ("0.0.0.0", "") else host, port)) == 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="GenResInvest", description="Generator zleceń ResInvest Commodities")
    parser.add_argument("--host", help="adres nasłuchu (domyślnie z konfiguracji, 127.0.0.1)")
    parser.add_argument("--port", type=int, help="port (domyślnie 8765)")
    parser.add_argument("--data-dir", help="katalog danych (baza, dokumenty, kopie)")
    parser.add_argument("--no-browser", action="store_true", help="nie otwieraj przeglądarki")
    parser.add_argument("--demo-orders", action="store_true", help="dodaj przykładowe zlecenia testowe i zakończ")
    parser.add_argument("--backup-now", action="store_true", help="utwórz kopię zapasową i zakończ")
    parser.add_argument("--reset-admin", action="store_true", help="ustaw nowe hasło startowe konta admin i zakończ")
    args = parser.parse_args(argv)

    from pathlib import Path

    from app.config import load_settings

    overrides: dict[str, object] = {}
    if args.host:
        overrides["host"] = args.host
    if args.port:
        overrides["port"] = args.port
    if args.data_dir:
        overrides["data_dir"] = Path(args.data_dir).expanduser()
    if args.no_browser:
        overrides["open_browser"] = False
    settings = load_settings(overrides)
    settings.ensure_dirs()

    if args.demo_orders or args.backup_now or args.reset_admin:
        from app.db import database, session_scope
        from app.main import configure_logging
        from app.services import backup, seed

        configure_logging(settings)
        database.init(settings.db_path)
        with session_scope() as db:
            seed.ensure_admin(db, settings)
            seed.load_start_data(db)
        if args.demo_orders:
            with session_scope() as db:
                print(f"Dodano zleceń testowych: {seed.create_demo_orders(db)}")
        if args.backup_now:
            print(f"Kopia zapasowa: {backup.create_backup(settings, 'manual')}")
        if args.reset_admin:
            from sqlalchemy import select

            from app.models import User
            from app.security import generate_password, hash_password

            with session_scope() as db:
                admin = db.scalar(select(User).where(User.username == "admin"))
                if admin is None:
                    print("Brak konta admin")
                    return 1
                pwd = generate_password()
                admin.password_hash, admin.must_change_password = hash_password(pwd), True
                admin.is_active, admin.failed_logins, admin.locked_until = True, 0, None
                print(f"Nowe hasło startowe konta admin: {pwd}")
        database.dispose()
        return 0

    if _port_in_use(settings.host, settings.port):
        url = f"http://127.0.0.1:{settings.port}/"
        print(f"GenResInvest już działa na porcie {settings.port} — otwieram {url}")
        if settings.open_browser:
            webbrowser.open(url)
        return 0

    import uvicorn

    from app.main import create_app

    app = create_app(settings)
    url = f"http://127.0.0.1:{settings.port}/"
    if settings.open_browser:
        def _open() -> None:
            for _ in range(50):
                if _port_in_use(settings.host, settings.port):
                    webbrowser.open(url)
                    return
                time.sleep(0.2)

        threading.Thread(target=_open, daemon=True).start()
    print(f"GenResInvest 1.0 — {url}  (dane: {settings.data_dir})")
    if settings.host == "0.0.0.0":
        print(f"Dostęp w sieci lokalnej: http://{socket.gethostname()}:{settings.port}/")
    # Jeden proces roboczy: SQLite + blokada zapisu w procesie gwarantują spójność numeracji.
    uvicorn.run(app, host=settings.host, port=settings.port, workers=1, log_config=None, access_log=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
