# PyInstaller — budowa GenResInvest.exe (uruchamiać przez installer/build.ps1 na Windows)
# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

ROOT = Path(SPECPATH).parent

a = Analysis(
    [str(ROOT / "run.py")],
    pathex=[str(ROOT)],
    datas=[
        (str(ROOT / "app" / "static"), "app/static"),
        (str(ROOT / "app" / "assets"), "app/assets"),
        (str(ROOT / "sample_data"), "sample_data"),
    ],
    hiddenimports=[
        "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "multipart", "python_multipart",
        "app.api.admin", "app.api.auth", "app.api.contractors", "app.api.dictionaries", "app.api.orders", "app.api.reports",
        "openpyxl", "docx", "reportlab.graphics.barcode",
    ],
    excludes=["tkinter", "pytest", "IPython", "matplotlib", "numpy"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="GenResInvest",
    console=True,           # okno serwera: zamknięcie okna = zatrzymanie programu
    icon=str(ROOT / "installer" / "genresinvest.ico"),
    version=str(ROOT / "installer" / "version_info.txt"),
)
coll = COLLECT(exe, a.binaries, a.datas, name="GenResInvest")
