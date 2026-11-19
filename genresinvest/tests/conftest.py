from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import load_settings  # noqa: E402
from app.main import create_app  # noqa: E402

ADMIN_PASSWORD = "TestoweHaslo123"
NEW_PASSWORD = "NoweHaslo2026xyz"


@pytest.fixture()
def settings(tmp_path: Path):
    return load_settings({"data_dir": tmp_path / "data", "initial_admin_password": ADMIN_PASSWORD, "open_browser": False})


@pytest.fixture()
def client(settings):
    app = create_app(settings, start_scheduler=False)
    with TestClient(app) as c:
        c.headers.update({"X-GRI-Request": "1"})
        yield c


@pytest.fixture()
def admin(client):
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    assert r.json()["must_change_password"] is True
    r = client.post("/api/v1/auth/change-password", json={"current_password": ADMIN_PASSWORD, "new_password": NEW_PASSWORD})
    assert r.status_code == 200, r.text
    return client


def order_payload(contractor_id: int, **overrides):
    data = {
        "contractor_id": contractor_id,
        "issue_date": "2026-11-13",
        "issue_place": "Katowice",
        "service_short": "Przewóz PKS (Łupina ziarna palmowego) za pomocą auta typu wywrotka.",
        "service_detailed": "Transport PKS (Łupina ziarna palmowego) za pomocą auta typu wywrotka",
        "cargo_type": "PKS (Łupina ziarna palmowego)",
        "origin_point": "jak wyżej",
        "destination_point": "jak wyżej",
        "loading_term": "Listopad 2026",
        "payment_days": 14,
        "handler_name": "Marcin Kwiatkowski",
        "handler_phone": "539 508 380",
        "contractor_contact_phone": "+48 606 403 090",
        "items": [{"route": "Zabrze - Chorzów", "net_amount": "900", "unit": "zł/fracht"}],
    }
    data.update(overrides)
    return data
