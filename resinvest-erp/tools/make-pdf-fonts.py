#!/usr/bin/env python3
"""Przygotowuje czcionki do generatora PDF demonstratora (uruchamiane rzadko, wynik jest w repozytorium).

Źródło: Liberation Sans 2.x (SIL Open Font License 1.1, pakiet fonts-liberation).
Wynik:  app/assets/fonts/ResInvestDocSans-{Regular,Bold}.ttf  — podzbiór znaków (łacina + polskie znaki
        + typografia), zmieniona nazwa rodziny zgodnie z OFL (zastrzeżona nazwa „Liberation” nie jest używana),
        app/assets/fonts/metrics.json — mapa Unicode → glif i szerokości (dla tools/build-demo.mjs i testów).

Wymaga: pip install fonttools
Użycie: python3 tools/make-pdf-fonts.py [/katalog/z/LiberationSans-*.ttf]
"""
import json, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

SRC_DIR = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/fonts/truetype/liberation"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "assets", "fonts")
FAMILY = "ResInvestDocSans"
CODEPOINTS = list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + [
    0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026, 0x2030,
    0x2192, 0x2190, 0x2191, 0x2193, 0x2212, 0x2248, 0x2260, 0x2264, 0x2265, 0x20AC, 0x2116, 0x2122, 0x221E]

def build(style):
    src = os.path.join(SRC_DIR, f"LiberationSans-{style}.ttf")
    font = TTFont(src)
    opts = subset.Options()
    opts.name_IDs = ["*"]; opts.notdef_outline = True; opts.recalc_bounds = True
    opts.layout_features = []; opts.hinting = False; opts.glyph_names = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=CODEPOINTS)
    sub.subset(font)
    ps = f"{FAMILY}-{style}"
    for rec in font["name"].names:
        if rec.nameID in (1, 16): rec.string = FAMILY
        elif rec.nameID == 4: rec.string = f"{FAMILY} {style}"
        elif rec.nameID == 6: rec.string = ps
        elif rec.nameID == 3: rec.string = f"{ps};subset for ResInvest ERP demo"
    out = os.path.join(OUT, ps + ".ttf")
    font.save(out)
    font = TTFont(out)
    cmap = font.getBestCmap()
    order = font.getGlyphOrder()
    gid = {g: i for i, g in enumerate(order)}
    hmtx = font["hmtx"]
    head, hhea, os2 = font["head"], font["hhea"], font["OS/2"]
    return {
        "name": ps, "file": ps + ".ttf", "unitsPerEm": head.unitsPerEm,
        "ascent": hhea.ascent, "descent": hhea.descent, "capHeight": getattr(os2, "sCapHeight", 1409),
        "bbox": [head.xMin, head.yMin, head.xMax, head.yMax],
        "cmap": {str(cp): gid[name] for cp, name in sorted(cmap.items())},
        "widths": [hmtx[name][0] for name in order],
    }

metrics = {"regular": build("Regular"), "bold": build("Bold")}
with open(os.path.join(OUT, "metrics.json"), "w", encoding="utf-8") as f:
    json.dump(metrics, f, separators=(",", ":"))
for k, v in metrics.items():
    print(k, v["file"], os.path.getsize(os.path.join(OUT, v["file"])), "B,", len(v["cmap"]), "znaków")
