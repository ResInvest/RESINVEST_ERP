"""Buduje jeden plik dist/GenResInvest.html (program offline: bez serwera, bez internetu).

Składa: src/index.html + src/styles.css + src/js/*.js (w kolejności nazw) + biblioteki z vendor/
+ zasoby z ../app/assets (papier firmowy DOCX, nagłówek JPG, czcionki — podzbiór znaków PL/EU).

Użycie:  python standalone/build.py
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ASSETS = ROOT / "app" / "assets"
OUT = HERE / "dist" / "GenResInvest.html"

sys.path.insert(0, str(ROOT))
from app import APP_VERSION  # noqa: E402

# Znaki potrzebne w dokumentach: łacina + rozszerzona (PL, CZ, DE…), typografia, symbole.
UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + list(range(0x2010, 0x2028))
    + [0x2030, 0x2039, 0x203A, 0x20AC, 0x2116, 0x2122, 0x2190, 0x2192, 0x2212, 0x00D7, 0x2264, 0x2265, 0x2248]
)


def font_b64(path: Path) -> str:
    raw = path.read_bytes()
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont

        font = TTFont(io.BytesIO(raw))
        opts = subset.Options()
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        opts.glyph_names = False
        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=UNICODES)
        sub.subset(font)
        out = io.BytesIO()
        font.save(out)
        raw = out.getvalue()
    except ImportError:
        print("  (fonttools niedostępne — osadzam pełne czcionki)")
    return base64.b64encode(raw).decode()


def main() -> None:
    src = HERE / "src"
    html = (src / "index.html").read_text(encoding="utf-8")
    css = (src / "styles.css").read_text(encoding="utf-8")
    js_files = sorted((src / "js").glob("*.js"))
    app_js = "\n".join(f"// ---- {f.name} ----\n{f.read_text(encoding='utf-8')}" for f in js_files)
    vendor = "\n".join((HERE / "vendor" / n).read_text(encoding="utf-8") for n in ("fflate.umd.js", "jspdf.umd.min.js"))
    assets = {
        "letterhead": base64.b64encode((ASSETS / "letterhead.docx").read_bytes()).decode(),
        "header": base64.b64encode((ASSETS / "header.jpg").read_bytes()).decode(),
        "fontRegular": font_b64(ASSETS / "fonts" / "LiberationSans-Regular.ttf"),
        "fontBold": font_b64(ASSETS / "fonts" / "LiberationSans-Bold.ttf"),
        "logo": base64.b64encode((ROOT / "app" / "static" / "img" / "logo.png").read_bytes()).decode(),
        "logoLight": base64.b64encode((ROOT / "app" / "static" / "img" / "logo-light.png").read_bytes()).decode(),
        "icon": base64.b64encode((ROOT / "app" / "static" / "img" / "icon-192.png").read_bytes()).decode(),
    }
    build = {"version": APP_VERSION, "date": date.today().isoformat(),
             "hash": hashlib.sha256((app_js + css).encode()).hexdigest()[:10]}
    assets_js = "const ASSETS = " + json.dumps(assets) + ";\nconst BUILD = " + json.dumps(build) + ";"
    out = (
        html.replace("/*__CSS__*/", css)
        .replace("/*__VENDOR__*/", vendor.replace("</script", "<\\/script"))
        .replace("/*__ASSETS__*/", assets_js)
        .replace("/*__APP__*/", app_js.replace("</script", "<\\/script"))
        .replace("__ICON__", assets["icon"])
        .replace("__VERSION__", APP_VERSION)
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(f"Zbudowano {OUT} ({OUT.stat().st_size / 1024 / 1024:.2f} MB, build {build['hash']})")


if __name__ == "__main__":
    main()
