from __future__ import annotations

import zipfile
from io import BytesIO

from docx import Document

from conftest import ADMIN_PASSWORD, NEW_PASSWORD, order_payload


def _contractor_id(client, name="FHU AGRO-TRANS") -> int:
    r = client.get("/api/v1/contractors", params={"q": name})
    assert r.status_code == 200
    return r.json()["items"][0]["id"]


# --- Bezpieczeństwo ---------------------------------------------------------------------------------

def test_requires_login(client):
    assert client.get("/api/v1/orders").status_code == 401


def test_wrong_password_and_lockout(client, settings):
    for _ in range(settings.login_max_attempts):
        r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "zle-haslo"})
        assert r.status_code == 401
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert r.status_code == 423


def test_must_change_password_blocks_work(client):
    client.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert client.get("/api/v1/orders").status_code == 403


def test_csrf_header_required(admin):
    r = admin.post("/api/v1/services", json={"short_description": "Test usługi"}, headers={"X-GRI-Request": ""})
    assert r.status_code == 403


def test_viewer_cannot_edit(admin):
    r = admin.post("/api/v1/users", json={"username": "podglad", "full_name": "Pan Podgląd", "role": "viewer", "password": "Podglad12345"})
    assert r.status_code == 201
    admin.post("/api/v1/auth/logout")
    assert admin.post("/api/v1/auth/login", json={"username": "podglad", "password": "Podglad12345"}).status_code == 200
    admin.post("/api/v1/auth/change-password", json={"current_password": "Podglad12345", "new_password": "Podglad99999x"})
    assert admin.get("/api/v1/orders").status_code == 200
    assert admin.post("/api/v1/services", json={"short_description": "Nowa usługa"}).status_code == 403


# --- Kartoteki --------------------------------------------------------------------------------------

def test_start_data_loaded(admin):
    r = admin.get("/api/v1/contractors")
    names = {c["name"] for c in r.json()["items"]}
    assert {"FHU AGRO-TRANS", "FHU RAGO Ewa Golasz", "VASCO Andrzej Słociński", "SmartTrans Kazimierz Broda"} <= names
    assert admin.get("/api/v1/services").json()[0]["cargo_type"] == "PKS (Łupina ziarna palmowego)"
    assert admin.get("/api/v1/prices").json()[0]["net_amount"] == "900.00"


def test_contractor_validation_reports_fields(admin):
    r = admin.post("/api/v1/contractors", json={"name": "X Sp. z o.o.", "street": "ul. Prosta 1", "postal_code": "40527x", "city": "Katowice", "nip": "1234567890"})
    assert r.status_code == 422
    fields = {e["field"] for e in r.json()["errors"]}
    assert {"postal_code", "nip"} <= fields


def test_contractor_duplicate_nip_and_optimistic_lock(admin):
    r = admin.post("/api/v1/contractors", json={"name": "Duplikat", "street": "ul. A 1", "postal_code": "40-001", "city": "Katowice", "nip": "645-203-77-72"})
    assert r.status_code == 409 and r.json()["errors"][0]["field"] == "nip"
    r = admin.post("/api/v1/contractors", json={"name": "Nowy Przewoźnik", "street": "ul. A 1", "postal_code": "40001", "city": "Katowice", "nip": "7740001454"})
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["postal_code"] == "40-001"
    body = {k: c[k] for k in ("name", "street", "postal_code", "city", "country", "nip")} | {"row_version": c["row_version"]}
    assert admin.put(f"/api/v1/contractors/{c['id']}", json=body | {"city": "Gliwice"}).status_code == 200
    assert admin.put(f"/api/v1/contractors/{c['id']}", json=body | {"city": "Bytom"}).status_code == 409


def test_contractor_csv_roundtrip(admin):
    csv_data = "nazwa;ulica;kod_pocztowy;miejscowosc;nip;telefon\nTRANS-POL;ul. Długa 5;41-500;Chorzów;5260250995;+48 600 100 200\nZły;ul. X;zly;Y;1;\n"
    files = {"file": ("k.csv", csv_data.encode("cp1250"), "text/csv")}
    r = admin.post("/api/v1/contractors/import", params={"dry_run": "true"}, files=files)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["created"] == 1 and rep["skipped"] == 1 and rep["dry_run"]
    assert admin.get("/api/v1/contractors", params={"q": "TRANS-POL"}).json()["total"] == 0
    r = admin.post("/api/v1/contractors/import", params={"dry_run": "false"}, files=files)
    assert r.json()["created"] == 1
    exported = admin.get("/api/v1/contractors/export.csv").content.decode("utf-8-sig")
    assert "TRANS-POL" in exported and exported.startswith("nazwa;")


# --- Zlecenia ---------------------------------------------------------------------------------------

def test_order_lifecycle(admin, settings):
    cid = _contractor_id(admin)
    r = admin.post("/api/v1/orders", json=order_payload(cid, items=[
        {"route": "Zabrze - Chorzów", "net_amount": "900", "unit": "zł/fracht", "quantity": "10"},
        {"route": "Gliwice - Katowice", "net_amount": "35,50", "unit": "zł/t", "quantity": "25,5"},
    ]))
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["status"] == "draft" and order["number"] is None
    assert order["total_net"] == "9905.25"  # 9000 + 905.25

    # nowe pozycje trafiły do słowników („dopisz, gdy nie ma”)
    routes = {p["route"] for p in admin.get("/api/v1/prices").json()}
    assert "Gliwice - Katowice" in routes

    # podgląd szkicu
    r = admin.get(f"/api/v1/orders/{order['id']}/document", params={"format": "pdf"})
    assert r.status_code == 200 and r.content.startswith(b"%PDF")

    # wystawienie → numer
    r = admin.post(f"/api/v1/orders/{order['id']}/issue", json={"row_version": order["row_version"]})
    assert r.status_code == 200, r.text
    issued = r.json()
    assert issued["number"] == "ZL/001/11/2026" and issued["revision"] == 1
    assert issued["issuer"]["nip"] == "2060002073"

    # dokumenty archiwalne + suma kontrolna
    pdf = admin.get(f"/api/v1/orders/{order['id']}/document", params={"format": "pdf"})
    docx = admin.get(f"/api/v1/orders/{order['id']}/document", params={"format": "docx"})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert "ZL-001-11-2026" in pdf.headers["content-disposition"]
    text = "\n".join(p.text for t in Document(BytesIO(docx.content)).tables for row in t.rows for c in row.cells for p in c.paragraphs)
    assert "Zabrze - Chorzów: 900,00 zł/fracht" in text and "FHU AGRO-TRANS" in text
    docs = admin.get(f"/api/v1/orders/{order['id']}/documents").json()
    assert {d["format"] for d in docs} == {"pdf", "docx"}
    assert admin.get(f"/api/v1/orders/documents/{docs[0]['id']}/download").status_code == 200

    # usunąć wystawionego nie można
    assert admin.delete(f"/api/v1/orders/{order['id']}").status_code == 409

    # korekta wymaga powodu
    body = order_payload(cid, row_version=issued["row_version"], loading_term="Grudzień 2026")
    r = admin.put(f"/api/v1/orders/{order['id']}", json=body)
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "correction_reason"
    r = admin.put(f"/api/v1/orders/{order['id']}", json=body | {"correction_reason": "Zmiana terminu załadunku"})
    assert r.status_code == 200, r.text
    corrected = r.json()
    assert corrected["revision"] == 2 and corrected["number"] == "ZL/001/11/2026"
    r = admin.get(f"/api/v1/orders/{order['id']}/document", params={"format": "pdf"})
    assert "korekta1" in r.headers["content-disposition"]
    revs = admin.get(f"/api/v1/orders/{order['id']}/revisions").json()
    assert [x["kind"] for x in revs] == ["issue", "correction"]

    # stara wersja ‒ blokada optymistyczna
    r = admin.put(f"/api/v1/orders/{order['id']}", json=body | {"correction_reason": "Kolejna", "row_version": issued["row_version"]})
    assert r.status_code == 409

    # anulowanie
    r = admin.post(f"/api/v1/orders/{order['id']}/cancel", json={"reason": "Rezygnacja klienta", "row_version": corrected["row_version"]})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    r = admin.get(f"/api/v1/orders/{order['id']}/document", params={"format": "pdf"})
    assert "ANULOWANE" in r.headers["content-disposition"]

    # historia operacji zawiera wszystkie kroki
    actions = {a["action"] for a in admin.get("/api/v1/audit", params={"entity": "order", "entity_id": str(order["id"])}).json()["items"]}
    assert {"create", "issue", "correction", "cancel"} <= actions


def test_numbering_sequential_and_monthly(admin):
    cid = _contractor_id(admin)
    numbers = []
    for day in ("2026-11-01", "2026-11-20", "2026-12-02"):
        o = admin.post("/api/v1/orders", json=order_payload(cid, issue_date=day)).json()
        numbers.append(admin.post(f"/api/v1/orders/{o['id']}/issue").json()["number"])
    assert numbers == ["ZL/001/11/2026", "ZL/002/11/2026", "ZL/001/12/2026"]


def test_order_validation_errors_point_to_fields(admin):
    cid = _contractor_id(admin)
    bad = order_payload(cid, items=[{"route": "", "net_amount": "-1", "unit": "zł/t"}], handler_phone="abc", loading_term="")
    r = admin.post("/api/v1/orders", json=bad)
    assert r.status_code == 422
    fields = {e["field"] for e in r.json()["errors"]}
    assert {"items.0.route", "items.0.net_amount", "handler_phone", "loading_term"} <= fields


def test_preview_unsaved_and_duplicate(admin):
    cid = _contractor_id(admin)
    r = admin.post("/api/v1/orders/preview", params={"format": "docx"}, json=order_payload(cid))
    assert r.status_code == 200 and r.content[:2] == b"PK"
    o = admin.post("/api/v1/orders", json=order_payload(cid)).json()
    d = admin.post(f"/api/v1/orders/{o['id']}/duplicate").json()
    assert d["status"] == "draft" and d["id"] != o["id"] and d["items"][0]["route"] == "Zabrze - Chorzów"
    assert admin.delete(f"/api/v1/orders/{d['id']}").status_code == 200


def test_contractor_change_does_not_alter_issued_order(admin):
    cid = _contractor_id(admin)
    o = admin.post("/api/v1/orders", json=order_payload(cid)).json()
    admin.post(f"/api/v1/orders/{o['id']}/issue")
    c = admin.get(f"/api/v1/contractors/{cid}").json()
    body = {k: c[k] for k in ("name", "street", "postal_code", "city", "country", "nip")} | {"street": "ul. Nowa 99"}
    assert admin.put(f"/api/v1/contractors/{cid}", json=body).status_code == 200
    assert admin.get(f"/api/v1/orders/{o['id']}").json()["contractor"]["street"] == "ul. Bytomska 17"
    # kontrahent użyty w zleceniu → tylko dezaktywacja
    r = admin.delete(f"/api/v1/contractors/{cid}")
    assert "dezaktywowany" in r.json()["message"]


# --- Raporty, ustawienia, kopie --------------------------------------------------------------------

def test_reports_and_export(admin):
    cid = _contractor_id(admin)
    for amount in ("900", "1100"):
        o = admin.post("/api/v1/orders", json=order_payload(cid, items=[{"route": "A - B", "net_amount": amount, "unit": "zł/fracht", "quantity": "2"}])).json()
        admin.post(f"/api/v1/orders/{o['id']}/issue")
    y = admin.get("/api/v1/reports/yearly", params={"year": 2026}).json()
    nov = y["months"][10]
    assert nov["issued"] == 2 and nov["value"] == "4000.00"
    rows = admin.get("/api/v1/reports/contractors", params={"date_from": "2026-11-01", "date_to": "2026-11-30"}).json()["rows"]
    assert rows[0]["orders"] == 2
    x = admin.get("/api/v1/reports/export", params={"format": "xlsx", "date_from": "2026-11-01", "date_to": "2026-11-30"})
    assert x.status_code == 200 and x.content[:2] == b"PK"
    c = admin.get("/api/v1/reports/export", params={"format": "csv"}).content.decode("utf-8-sig")
    assert c.count("ZL/") == 2


def test_settings_numbering_pattern(admin):
    s = admin.get("/api/v1/settings").json()
    r = admin.put("/api/v1/settings", json={"numbering": {"pattern": "ZT/{MM}", "seq_digits": 3, "reset": "monthly"}})
    assert r.status_code == 422
    r = admin.put("/api/v1/settings", json={"numbering": {"pattern": "ZT/{YYYY}/{SEQ}", "seq_digits": 4, "reset": "yearly"}})
    assert r.status_code == 200
    cid = _contractor_id(admin)
    o = admin.post("/api/v1/orders", json=order_payload(cid)).json()
    assert admin.post(f"/api/v1/orders/{o['id']}/issue").json()["number"] == "ZT/2026/0001"
    assert s["company"]["krs"] == "0000411384"


def test_backup_and_restore(admin, settings):
    cid = _contractor_id(admin)
    o = admin.post("/api/v1/orders", json=order_payload(cid)).json()
    admin.post(f"/api/v1/orders/{o['id']}/issue")
    admin.get(f"/api/v1/orders/{o['id']}/document", params={"format": "pdf"})
    r = admin.post("/api/v1/backups")
    assert r.status_code == 201
    name = r.json()["name"]
    with zipfile.ZipFile(settings.backups_dir / name) as zf:
        assert "genresinvest.db" in zf.namelist() and any(n.startswith("documents/") for n in zf.namelist())
    # zmiana po kopii, potem przywrócenie — zmiana znika
    o2 = admin.post("/api/v1/orders", json=order_payload(cid)).json()
    r = admin.post(f"/api/v1/backups/{name}/restore")
    assert r.status_code == 200, r.text
    # sesja przetrwała przywrócenie (była w kopii) — logujemy się ponownie dla pewności
    admin.post("/api/v1/auth/login", json={"username": "admin", "password": NEW_PASSWORD})
    assert admin.get(f"/api/v1/orders/{o2['id']}").status_code == 404
    assert admin.get(f"/api/v1/orders/{o['id']}").json()["status"] == "issued"
    kinds = {b["kind"] for b in admin.get("/api/v1/backups").json()["items"]}
    assert {"manual", "pre-restore"} <= kinds
    assert admin.get("/api/v1/backups/..%2Fsecret.zip/download").status_code == 404


def test_data_json_roundtrip(admin):
    exported = admin.get("/api/v1/data/export.json").json()
    assert exported["format"] == "genresinvest-data" and len(exported["contractors"]) >= 4
    r = admin.post("/api/v1/data/import.json", files={"file": ("d.json", BytesIO(admin.get("/api/v1/data/export.json").content), "application/json")})
    assert r.status_code == 200 and r.json()["contractors"] == 0  # brak duplikatów
