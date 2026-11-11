#!/usr/bin/env python3
"""Paczka testów automatycznych dla testu odbiorczego na Windows (Test-ResInvestERP.ps1).
Uruchomienie z katalogu resinvest-erp:  python3 installer/test-windows/make-test-pack.py
Wynik: installer/Output/ResInvestERP-testy-<wersja>.zip (źródła potrzebne testom + testy, bez node_modules i danych)."""
import json, os, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
version = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))["version"]
TESTS = ["engine", "features311", "features312", "editions312", "mail313", "features314", "features315", "server-modules315", "yardplan315", "yardplan-server315", "scans314", "smtp", "server", "storage", "auth"]
INCLUDE = ["app/src", "server", "config/app.config.json", "config/server.config.json", "tools/make-edition.mjs",
           "installer/editions", ".env.example", "package.json", "ResInvest_ERP.html", "LICENSE"] + [f"tests/{t}.test.mjs" for t in TESTS]

out = os.path.join(ROOT, "installer", "Output", f"ResInvestERP-testy-{version}.zip")
os.makedirs(os.path.dirname(out), exist_ok=True)
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for item in INCLUDE:
        path = os.path.join(ROOT, item)
        files = [path] if os.path.isfile(path) else [os.path.join(d, f) for d, _, fs in os.walk(path) for f in fs]
        for f in sorted(files):
            z.write(f, os.path.join("resinvest-erp", os.path.relpath(f, ROOT)).replace(os.sep, "/")); n += 1
print(f"{out}  ({n} plików, {os.path.getsize(out) // 1024} kB)")
