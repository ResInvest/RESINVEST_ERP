"""Montaż samouczka — wersja premium (2).

Wejście: timing_final.json (oś po nagraniu: lektor czeka na akcje), cap/NN (klatki 2880×1620 + events.json),
mp3/ (lektor), music_src/epic1-3.mp3 (podkład), subs.ass (napisy z timing.py --final).

* Obraz nigdy nie jest przyspieszany: rozdział trwa tyle, ile akcje albo lektor (dłuższe z dwóch).
* Lektor: zdania rozdzielone w pauzach nagrania; zdanie i startuje o shifts[i] s później (czeka na akcję).
* Wirtualna kamera: płynne zbliżenie (do 1,4×) na omawiany element — strzałka / ramka / kolumna tabeli;
  w czasie zbliżenia reszta ekranu przygaszona (spotlight). Klatki w 1,5× rozdzielczości — zbliżenie ostre.
* Plansze rozdziałów animowane (numer, tytuł, pasek postępu), płynne przenikanie do programu.
* Podkład: 3 utwory, zmiana TYLKO na planszy rozdziału; każdy fragment kończy się naturalnym zakończeniem utworu
  dokładnie na granicy rozdziałów (dopasowanie końca utworu), nowy wchodzi z wyciszenia. Ducking pod lektorem.

python compose2.py --audio                    → _mix.wav (lektor + podkład) i music_plan.txt
python compose2.py --video --chapters 1-5     → _part_01-05.mp4 (obraz + napisy, bez dźwięku)
python compose2.py --final --out plik.mp4     → sklejenie części i dźwięku
"""
import argparse, glob, json, math, os, re, subprocess, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import compose as V      # sprite'y: kursor, dymki, strzałki, ramki, tło plansz, logo, etykieta rozdziału

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = V.FFMPEG
W, H, FPS, SR = 1920, 1080, 30, 44100
SRC = 1.5                      # klatki 2880×1620 = 1,5 × kadr 1920×1080
XFADE = 0.24
ZMAX, ZMIN_USE, TR = 1.38, 1.10, 0.85
SUB_SAFE = 150                 # dolny pas napisów
GREEN, GREEN_D, INK, CREAM = V.GREEN, V.GREEN_D, V.INK, V.CREAM
font, ease = V.font, V.ease


def smooth(u): u = min(1.0, max(0.0, u)); return u * u * u * (u * (u * 6 - 15) + 10)


def load_tl():
    return json.load(open(os.path.join(HERE, "timing_final.json"), encoding="utf-8"))


# =============================================================== kamera
IDENT = (W / 2, H / 2, 1.0)


def union(rs):
    x0 = min(r["x"] for r in rs); y0 = min(r["y"] for r in rs)
    x1 = max(r["x"] + r["w"] for r in rs); y1 = max(r["y"] + r["h"] for r in rs)
    return x0, y0, x1, y1


def framing(rs):
    x0, y0, x1, y1 = union(rs)
    bw, bh = (x1 - x0) + 2 * 90, (y1 - y0) + 2 * 80
    z = min(ZMAX, W / bw, (H - SUB_SAFE - 40) / bh)
    if z < ZMIN_USE: return IDENT
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + (SUB_SAFE / 2) / z     # ognisko nad pasem napisów
    hw, hh = W / (2 * z), H / (2 * z)
    cx = min(max(cx, hw), W - hw); cy = min(max(cy, hh), H - hh)
    return (cx, cy, z)


def lerp_cam(a, b, u):
    u = smooth(u)
    # interpolacja w skali logarytmicznej zbliżenia — ruch wygląda równomiernie
    za, zb = math.log(a[2]), math.log(b[2])
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, math.exp(za + (zb - za) * u))


class Camera:
    """Plan kamery rozdziału: grupy nakładek (strzałki / ramki z cam=true, zachodzące na siebie w czasie)."""

    def __init__(self, overlays, sprite_bbox):
        ov = [(i, e) for i, e in enumerate(overlays) if e.get("cam", True)]
        ov.sort(key=lambda x: x[1]["t0"])
        groups = []
        for i, e in ov:
            if groups and e["t0"] < groups[-1]["t1"] + 0.6:
                g = groups[-1]; g["t1"] = max(g["t1"], e["t1"]); g["idx"].append(i)
            else: groups.append({"t0": e["t0"], "t1": e["t1"], "idx": [i]})
        for g in groups:
            rs = []
            for i in g["idx"]:
                rs.append(overlays[i]["r"]); bb = sprite_bbox(i)
                if bb: rs.append(bb)
            g["cam"] = framing(rs)
        self.groups = groups
        keys = [(-1e9, IDENT), (-1e9 + 1, IDENT)]       # (czas, kamera) — odcinki stałe i przejścia
        segs = []                                       # (t_a, t_b, cam_a, cam_b)
        cur, t_free = IDENT, -1e9
        for k, g in enumerate(groups):
            target = g["cam"]
            a = max(t_free, g["t0"] - TR); b = g["t0"]
            if b - a < 0.25: a = b - 0.25
            segs.append((a, b, cur, target)); cur = target
            nxt = groups[k + 1] if k + 1 < len(groups) else None
            if target == IDENT:
                t_free = g["t1"]
            elif nxt and nxt["cam"] != IDENT and nxt["t0"] - TR < g["t1"] + TR + 0.5:
                t_free = g["t1"]                         # płynnie do następnego ujęcia
            else:
                segs.append((g["t1"], g["t1"] + TR, cur, IDENT)); cur = IDENT; t_free = g["t1"] + TR
        self.segs = segs

    def at(self, t):
        cam = IDENT
        for a, b, ca, cb in self.segs:
            if t < a: return cam if cam is not None else ca
            if t <= b: return lerp_cam(ca, cb, (t - a) / max(1e-6, b - a))
            cam = cb
        return cam

    def spot(self, t):
        """Siła przygaszenia otoczenia 0…0,42 (tylko w czasie grupy)."""
        a = 0.0
        for g in self.groups:
            u = min((t - (g["t0"] - 0.35)) / 0.45, ((g["t1"] + 0.35) - t) / 0.5)
            if u > 0: a = max(a, 0.42 * smooth(min(1, u)))
        return a


def to_screen(cam, x, y):
    cx, cy, z = cam
    return (x - (cx - W / (2 * z))) * z, (y - (cy - H / (2 * z))) * z


def rect_screen(cam, r):
    x, y = to_screen(cam, r["x"], r["y"])
    return {"x": x, "y": y, "w": r["w"] * cam[2], "h": r["h"] * cam[2]}


def cam_key(cam): return (round(cam[0], 1), round(cam[1], 1), round(cam[2], 3))


# =============================================================== plansze (animowane)
_bg_cache = {}


def card_bg(img, key):
    if key not in _bg_cache: _bg_cache[key] = V.blurred_bg(img)
    return _bg_cache[key]


def accent(d):
    for i, c in enumerate(["#FF1F8E", "#FF7A00", "#FFC400", "#3BE000", "#00B8FF", "#8B3DFF"]):
        d.rectangle((i * W / 6, H - 14, (i + 1) * W / 6, H), fill=V.hexrgb(c))


def text_layer(txt, f, fill, alpha):
    bb = f.getbbox(txt); im = Image.new("RGBA", (bb[2] + 8, bb[3] + 12), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((0, 0), txt, font=f, fill=fill + (int(255 * alpha),))
    return im


def chapter_card(bg, ch, total, u):
    """u — czas od początku planszy [s]."""
    im = bg.copy(); d = ImageDraw.Draw(im); accent(d)
    V.logo(d, W - 260, 120, 110)
    a1 = smooth(u / 0.55)                                   # numer: skala 0,82 → 1 + wejście
    num = f"{ch['no']:02d}"; fN = font(220)
    nl = text_layer(num, fN, GREEN, a1)
    s = 0.82 + 0.18 * a1
    nl = nl.resize((max(1, int(nl.size[0] * s)), max(1, int(nl.size[1] * s))), Image.LANCZOS)
    im.alpha_composite(nl, (160, int(250 + (1 - s) * 120)))
    a2 = smooth((u - 0.18) / 0.5)
    if a2 > 0: im.alpha_composite(text_layer(f"ROZDZIAŁ {ch['no']} Z {total}", font(34), (255, 122, 0), a2), (int(165 - 60 * (1 - a2)), 505))
    a3 = smooth((u - 0.32) / 0.6)
    if a3 > 0:
        f = font(78); title = ch["title"]
        while f.getbbox(title)[2] > W - 320 and f.size > 48: f = font(f.size - 4)
        im.alpha_composite(text_layer(title, f, INK, a3), (160, int(560 + 40 * (1 - a3))))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((165, 700, 165 + 600, 712), 6, fill=(220, 228, 222))
    a4 = smooth((u - 0.45) / 1.0)
    frac = ((ch["no"] - 1) + a4) / total
    d.rounded_rectangle((165, 700, 165 + max(12, 600 * frac), 712), 6, fill=GREEN)
    return im


def open_card(bg, u):
    im = bg.copy(); d = ImageDraw.Draw(im); accent(d)
    a = smooth(u / 0.8)
    lg = Image.new("RGBA", (170, 170), (0, 0, 0, 0)); V.logo(ImageDraw.Draw(lg), 10, 10, 150)
    if a < 1: lg.putalpha(lg.split()[3].point(lambda v: int(v * a)))
    im.alpha_composite(lg, (150, int(290 + 30 * (1 - a))))
    for (txt, f, col, x, y, t0) in [("ResInvest ERP", font(104), INK, 350, 300, 0.25), ("Pełny samouczek programu", font(54, False), GREEN_D, 354, 428, 0.55),
                                     ("Obrót i magazynowanie biomasy drzewnej · wersja 3.10", font(34, False), (70, 84, 76), 160, 560, 0.85),
                                     ("16 rozdziałów · krok po kroku · lektor i napisy PL", font(30), (120, 134, 126), 160, 640, 1.1)]:
        b = smooth((u - t0) / 0.7)
        if b > 0: im.alpha_composite(text_layer(txt, f, col, b), (int(x + 50 * (1 - b)), y))
    return im


def outro_card(bg, u):
    im = bg.copy(); d = ImageDraw.Draw(im); accent(d)
    a = smooth(u / 0.9)
    lg = Image.new("RGBA", (200, 200), (0, 0, 0, 0)); V.logo(ImageDraw.Draw(lg), 10, 10, 180)
    if a < 1: lg.putalpha(lg.split()[3].point(lambda v: int(v * a)))
    im.alpha_composite(lg, (int(W / 2 - 100), 240))
    for (txt, f, col, y, t0) in [("ResInvest ERP", font(96), INK, 470, 0.3), ("Biomasa pod kontrolą", font(56, False), GREEN_D, 600, 0.6),
                                 ("Dziękujemy za uwagę — powodzenia na magazynie.", font(34, False), (90, 104, 96), 700, 0.9)]:
        b = smooth((u - t0) / 0.8)
        if b > 0: L = text_layer(txt, f, col, b); im.alpha_composite(L, (int((W - L.size[0]) / 2), int(y + 30 * (1 - b))))
    return im


# =============================================================== rozdział: klatki, kursor, nakładki
class Chapter:
    def __init__(self, ch, total):
        self.ch = ch; d = os.path.join(HERE, "cap", f"{ch['no']:02d}")
        ev = json.load(open(os.path.join(d, "events.json")))
        self.dir = d; self.events = ev["events"]
        self.shots = [(e["t"], e["f"]) for e in self.events if e["type"] == "shot"]
        self.moves = [e for e in self.events if e["type"] == "move"]
        self.clicks = [e["t"] for e in self.events if e["type"] == "click"]
        self.overlays = [e for e in self.events if e["type"] in ("arrow", "box")]
        self.chip = V.chip_image(ch, total)
        self._img = {}; self._low = {}; self._spr = {}; self._hole = {}
        self.cam = Camera(self.overlays, self.page_bbox)

    def page_bbox(self, i):
        e = self.overlays[i]
        if e["type"] != "arrow": return None
        im, x, y, _ = V.arrow_sprite(e)
        return {"x": x, "y": y, "w": im.size[0], "h": im.size[1]}

    def hi(self, f):
        if f not in self._img:
            if len(self._img) > 5: self._img.pop(next(iter(self._img)))
            self._img[f] = Image.open(os.path.join(self.dir, f)).convert("RGB")
        return self._img[f]

    def view(self, f, cam):
        """Klatka programu w kadrze kamery (1920×1080)."""
        if cam_key(cam) == cam_key(IDENT):
            if f not in self._low:
                if len(self._low) > 8: self._low.pop(next(iter(self._low)))
                self._low[f] = self.hi(f).resize((W, H), Image.LANCZOS)
            return self._low[f]
        cx, cy, z = cam; w, h = W / z, H / z
        box = ((cx - w / 2) * SRC, (cy - h / 2) * SRC, (cx + w / 2) * SRC, (cy + h / 2) * SRC)
        return self.hi(f).resize((W, H), Image.BICUBIC, box=box)

    def base(self, t, cam):
        if not self.shots: return Image.new("RGB", (W, H), CREAM)
        i = 0
        while i + 1 < len(self.shots) and self.shots[i + 1][0] <= t + 1e-6: i += 1
        cur = self.view(self.shots[i][1], cam)
        if i > 0:
            t_cur, t_prev = self.shots[i][0], self.shots[i - 1][0]
            u = (t - t_cur) / XFADE
            if t_cur - t_prev > 0.1 and 0 <= u < 1:
                return Image.blend(self.view(self.shots[i - 1][1], cam), cur, ease(u))
        return cur

    def first(self):
        return Image.open(os.path.join(self.dir, self.shots[0][1])).convert("RGB").resize((W, H), Image.LANCZOS) if self.shots else None

    def cursor(self, t, start):
        x, y = start; px, py = start
        for m in self.moves:
            if m["t"] > t: break
            px, py = x, y
            u = (t - m["t"]) / m["d"] if m["d"] > 0 else 1
            if u >= 1: x, y = m["x"], m["y"]; continue
            e = ease(u); dx, dy = m["x"] - px, m["y"] - py; dist = math.hypot(dx, dy)
            arc = math.sin(math.pi * e) * min(70, dist * 0.12)
            nx, ny = (-dy / dist, dx / dist) if dist > 1 else (0, 0)
            return px + dx * e + nx * arc, py + dy * e + ny * arc
        return x, y

    def sprite(self, i, cam):
        key = (i, cam_key(cam))
        if key not in self._spr:
            if len(self._spr) > 40: self._spr.pop(next(iter(self._spr)))
            e = dict(self.overlays[i]); e["r"] = rect_screen(cam, e["r"])
            self._spr[key] = V.arrow_sprite(e) if e["type"] == "arrow" else V.box_sprite(e) + ((0, 0),)
        return self._spr[key]

    def hole(self, i, cam):
        """Maska „okna” spotlightu dla nakładki i (1 = pełna jasność)."""
        key = (i, cam_key(cam))
        if key not in self._hole:
            if len(self._hole) > 12: self._hole.pop(next(iter(self._hole)))
            r = rect_screen(cam, self.overlays[i]["r"]); pad = 18
            m = Image.new("L", (W // 4, H // 4), 0)
            ImageDraw.Draw(m).rounded_rectangle(((r["x"] - pad) / 4, (r["y"] - pad) / 4, (r["x"] + r["w"] + pad) / 4, (r["y"] + r["h"] + pad) / 4), 5, fill=255)
            m = m.filter(ImageFilter.GaussianBlur(5)).resize((W, H), Image.BILINEAR)
            self._hole[key] = np.asarray(m, dtype=np.float32) / 255.0
        return self._hole[key]


# =============================================================== dźwięk
def decode(path, extra=()):
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, *extra, "-ar", str(SR), "-ac", "2", "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


NO_MUSIC = False
TRACKS = [  # (plik, początek [s], koniec dźwięku [s]) — cisza na początku / końcu pominięta
    ("epic1.mp3", 0.94, 189.6), ("epic2.mp3", 0.0, 143.6), ("epic3.mp3", 0.0, 314.8)]


def plan_music(tl):
    """Podział rozdziałów na fragmenty muzyki: kolejne utwory 1 → 2 → 3 → 1 → 2 …; fragment kończy się naturalnym
    zakończeniem utworu na początku planszy kolejnego rozdziału. Programowanie dynamiczne: jak najmniej niewykorzystanego
    początku utworu, fragmenty nie krótsze niż 70 s."""
    starts = [0.0] + [c["start"] for c in tl["chapters"][1:]] + [tl["total"]]
    n = len(starts) - 1
    lens = [b - s for _, s, b in TRACKS]
    INF = 1e18
    best = {}
    def f(i, j):
        if i == n: return 0.0, []
        if (i, j) in best: return best[(i, j)]
        res = (INF, [])
        for k in range(i + 1, n + 1):
            L = starts[k] - starts[i]
            U = lens[j % 3] - 0.5
            if L > U: break
            if L < 70 and k < n: continue
            cost = (0 if i == 0 else (U - L) ** 1.15) + (0 if k == n else 25)   # otwarcie: od początku utworu
            sub, path = f(k, j + 1)
            if cost + sub < res[0]: res = (cost + sub, [(i, k, j % 3)] + path)
        best[(i, j)] = res
        return res
    cost, path = f(0, 0)
    if cost >= INF: raise SystemExit("Nie da się dopasować muzyki do rozdziałów")
    return [(starts[i], starts[k], tr, i + 1, k) for i, k, tr in path]


def build_audio(tl):
    total = tl["total"]; n = int(total * SR) + SR
    # ---- podkład
    srcs = []
    for fn, a, b in ([] if NO_MUSIC else TRACKS):
        x = decode(os.path.join(HERE, "music_src", fn), ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"])
        srcs.append(x[int(a * SR):int(b * SR)])
    mus = np.zeros((n, 2), dtype=np.float32)
    plan = [] if NO_MUSIC else plan_music(tl)
    lines = []
    for (t0, t1, tr, c0, c1) in plan:
        x = srcs[tr]; L = t1 - t0
        TAIL = 1.2 if t1 < total - 0.01 else 0.0           # naturalne wybrzmienie wchodzi 1,2 s w planszę
        seg_len = L + TAIL
        first = t0 == 0.0
        off = 0.0 if first else max(0.0, len(x) / SR - seg_len)   # koniec utworu = koniec fragmentu; otwarcie — od początku
        piece = x[int(off * SR):int(off * SR) + int(seg_len * SR)].copy()
        if first and len(x) / SR - seg_len > 2.0:          # otwarcie krótsze od utworu: wyciszenie 3,5 s kończy się na planszy
            fo = int(3.5 * SR); piece[-fo:] *= (np.linspace(1, 0, fo, dtype=np.float32) ** 1.6)[:, None]
        fi = int(2.2 * SR) if off > 0.5 else int(0.15 * SR) # wejście z wyciszenia (gdy start w środku utworu)
        piece[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)[:, None]
        s = int(t0 * SR); m = min(len(piece), n - s); mus[s:s + m] += piece[:m]
        how = "od początku, wyciszenie na planszy" if first and off == 0 and len(x) / SR - seg_len > 2.0 else "do naturalnego końca utworu"
        lines.append(f"{t0:7.1f}–{t1:7.1f} s  rozdziały {c0}–{c1}: {TRACKS[tr][0]} od {off:5.1f} s, {how} ({L:5.1f} s)")
    # ---- lektor: zdania z pauzami
    voice = np.zeros((n, 2), dtype=np.float32); speech = []
    for c in tl["chapters"]:
        if not c["mp3"]: continue
        v = decode(c["mp3"], ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"])
        cuts = [s["cut"] for s in c["sentences"]] + [len(v) / SR]
        for i, s in enumerate(c["sentences"]):
            a, b = int(cuts[i] * SR), int(cuts[i + 1] * SR)
            piece = v[a:b].copy(); fl = min(len(piece) // 2, int(0.012 * SR))
            if fl > 0: piece[:fl] *= np.linspace(0, 1, fl, dtype=np.float32)[:, None]; piece[-fl:] *= np.linspace(1, 0, fl, dtype=np.float32)[:, None]
            at = c["voiceAt"] + cuts[i] + s["shift"]
            p0 = int(at * SR); m = min(len(piece), n - p0); voice[p0:p0 + m] += piece[:m]
            speech.append((at, at + (b - a) / SR))
    # ---- ducking: −12 dB pod lektorem, −3 dB poza nim; muzyka wraca w dłuższych pauzach
    env = np.full(n, 10 ** (-3 / 20), dtype=np.float32)
    tt = np.arange(n, dtype=np.float32) / SR
    merged = []
    for a, b in sorted(speech):
        if merged and a - merged[-1][1] < 1.6: merged[-1][1] = max(merged[-1][1], b)
        else: merged.append([a, b])
    duck = np.zeros(n, dtype=np.float32)
    for a, b in merged:
        i0, i1 = max(0, int((a - 0.9) * SR)), min(n, int((b + 1.4) * SR))
        seg = tt[i0:i1]
        g = np.clip(np.minimum((seg - (a - 0.35)) / 0.6, ((b + 0.25) - seg) / 0.9), 0, 1)
        duck[i0:i1] = np.maximum(duck[i0:i1], g)
    env *= 1 - duck * (1 - 10 ** (-12 / 20))
    mix = mus * env[:, None] + voice
    end = int(total * SR); mix = mix[:end]
    fo = int(3.0 * SR); mix[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)[:, None]
    pk = np.abs(mix).max()
    if pk > 0.97: mix *= 0.97 / pk
    with wave.open(os.path.join(HERE, "_mix.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    open(os.path.join(HERE, "music_plan.txt"), "w").write(("\n".join(lines) if lines else "bez podkładu — tylko lektor") + "\n")
    print("\n".join(lines)); print(f"dźwięk: {total:.1f} s → _mix.wav")


# =============================================================== obraz
HALO, RINGS, CURSOR = V.HALO, V.RINGS, V.CURSOR


def render_video(tl, chapters_sel, out):
    total_ch = len(tl["chapters"])
    sel = [c for c in tl["chapters"] if chapters_sel is None or c["no"] in chapters_sel]
    t0 = 0.0 if sel[0]["no"] == 1 else sel[0]["start"]
    t1 = sel[-1]["end"]
    chs = {c["no"]: Chapter(c, total_ch) for c in sel}
    allc = {c["no"]: c for c in tl["chapters"]}
    # napisy przesunięte do początku części
    ass_src = open(os.path.join(HERE, "subs.ass"), encoding="utf-8").read()
    def shift(m):
        def tsec(s): h, mi, se = s.split(":"); return int(h) * 3600 + int(mi) * 60 + float(se)
        def fmt(x): x = max(0, x); h, x = divmod(x, 3600); mi, x = divmod(x, 60); return f"{int(h)}:{int(mi):02d}:{x:05.2f}"
        a, b = tsec(m[1]) - t0, tsec(m[2]) - t0
        if b <= 0 or a >= t1 - t0: return ""
        return f"Dialogue: 0,{fmt(a)},{fmt(b)},{m[3]}"
    ass = re.sub(r"Dialogue: 0,([\d:.]+),([\d:.]+),(.*)", shift, ass_src)
    ass_path = os.path.join(HERE, f"_subs_{sel[0]['no']:02d}.ass"); open(ass_path, "w", encoding="utf-8").write(ass)
    cmd = [FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-vf", f"ass={ass_path}", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-g", "60", "-an", out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    # kursor zaczyna rozdział tam, gdzie skończył poprzedni (także między częściami)
    starts, cur = {}, (W * 0.5, H * 0.55)
    for c in tl["chapters"]:
        starts[c["no"]] = cur
        evf = os.path.join(HERE, "cap", f"{c['no']:02d}", "events.json")
        mv = [e for e in json.load(open(evf))["events"] if e["type"] == "move"]
        if mv: cur = (mv[-1]["x"], mv[-1]["y"])
    f0, f1 = int(round(t0 * FPS)), int(round(t1 * FPS))
    first_img = {no: C.first() for no, C in chs.items()}
    for k in range(f0, f1):
        t = k / FPS
        c = sel[0] if t < sel[0]["start"] else next((x for x in sel if x["start"] <= t < x["end"]), sel[-1])   # plansza otwarcia → rozdział 1
        C = chs[c["no"]]; ct = t - c["voiceAt"]
        if c["no"] == 1 and t < tl["open"]:
            bgk = ("open",); bg = card_bg(first_img.get(1), bgk)
            fr = open_card(bg, t)
            if t > tl["open"] - 0.6:
                nxt = chapter_card(card_bg(first_img[1], ("ch", 1)), c, total_ch, t - (tl["open"] - 0.6))
                fr = Image.blend(fr, nxt, smooth((t - (tl["open"] - 0.6)) / 0.6))
            if t < 0.5: fr = Image.blend(Image.new("RGBA", (W, H), CREAM + (255,)), fr, smooth(t / 0.5))
            ff.stdin.write(fr.convert("RGB").tobytes()); continue
        cam = C.cam.at(max(ct, 0))
        fr = C.base(max(ct, 0), cam)
        # spotlight: przygaszenie poza omawianym elementem
        A = C.cam.spot(ct)
        if A > 0.01:
            act = [i for i, e in enumerate(C.overlays) if e.get("cam", True) and e["t0"] - 0.35 <= ct <= e["t1"] + 0.35]
            if act:
                holes = None
                for i in act:
                    e = C.overlays[i]; w8 = smooth(min((ct - (e["t0"] - 0.35)) / 0.35, ((e["t1"] + 0.35) - ct) / 0.35, 1))
                    hm = C.hole(i, cam) * w8
                    holes = hm if holes is None else np.maximum(holes, hm)
                arr = np.asarray(fr, dtype=np.float32)
                mul = 1 - A * (1 - holes)
                fr = Image.fromarray((arr * mul[:, :, None]).astype(np.uint8))
        fr = fr.convert("RGBA")
        # strzałki i ramki (w kadrze kamery)
        for i, e in enumerate(C.overlays):
            if not (e["t0"] <= ct < e["t1"]): continue
            im, x, y, dirv = C.sprite(i, cam)
            age, left = ct - e["t0"], e["t1"] - ct
            al = min(1, age / 0.25, left / 0.25)
            if e["type"] == "arrow":
                bob = 9 * math.sin(2 * math.pi * 1.6 * age); x += dirv[0] * -bob; y += dirv[1] * -bob
            else:
                al *= 0.85 + 0.15 * math.sin(2 * math.pi * 1.2 * age)
            if al < 1: im = im.copy(); im.putalpha(im.split()[3].point(lambda v, a=al: int(v * a)))
            fr.alpha_composite(im, (int(x), int(y)))
        # kursor, podświetlenie kliknięć
        px, py = C.cursor(max(ct, 0), starts[c["no"]]); px, py = to_screen(cam, px, py)
        fr.alpha_composite(HALO, (int(px - 31), int(py - 31)))
        for tc in C.clicks:
            if 0 <= ct - tc < 0.5:
                rg = RINGS[min(14, int((ct - tc) / 0.5 * 15))]; fr.alpha_composite(rg, (int(px - rg.size[0] / 2), int(py - rg.size[1] / 2)))
        fr.alpha_composite(CURSOR, (int(px - 3), int(py - 3)))
        fr.alpha_composite(C.chip, (W - C.chip.size[0] - 18, H - 64))
        # plansza rozdziału
        card_t = t - c["start"]
        if card_t < c["card"] and not (c["no"] == 1 and t < tl["open"]):
            cd = chapter_card(card_bg(first_img[c["no"]], ("ch", c["no"])), c, total_ch, card_t + (0 if c["no"] > 1 else 0.6))
            a = 1 if card_t < c["card"] - 0.55 else smooth((c["card"] - card_t) / 0.55)
            if c["no"] > 1: a = min(a, smooth(card_t / 0.35))
            fr = Image.blend(fr, cd, max(0, min(1, a))) if a < 1 else cd
        if c["no"] == total_ch and t > c["end"] - 5.0:
            oc = outro_card(card_bg(first_img[c["no"]], ("outro",)), t - (c["end"] - 5.0))
            a = smooth((t - (c["end"] - 5.0)) / 0.9); fr = Image.blend(fr, oc, a) if a < 1 else oc
        ff.stdin.write(fr.convert("RGB").tobytes())
        if k % 900 == 0: print(f"  {t:7.1f} s / {t1:.1f} s", flush=True)
    ff.stdin.close(); ff.wait()
    print("zapisano", out)


def final(out):
    parts = sorted(glob.glob(os.path.join(HERE, "_part_*.mp4")))
    lst = os.path.join(HERE, "_parts.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-i", os.path.join(HERE, "_mix.wav"),
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out], check=True)
    print("zapisano", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", action="store_true"); ap.add_argument("--video", action="store_true"); ap.add_argument("--final", action="store_true")
    ap.add_argument("--chapters", default=None); ap.add_argument("--out", default=None)
    ap.add_argument("--no-music", action="store_true", help="tylko lektor, bez podkładu")
    a = ap.parse_args()
    NO_MUSIC = a.no_music
    tl = load_tl()
    if a.audio: build_audio(tl)
    if a.video:
        sel = None
        if a.chapters: lo, _, hi = a.chapters.partition("-"); sel = list(range(int(lo), int(hi or lo) + 1))
        out = a.out or os.path.join(HERE, f"_part_{(sel or [1])[0]:02d}-{(sel or [16])[-1]:02d}.mp4")
        render_video(tl, sel, out)
    if a.final: final(a.out or os.path.join(HERE, "ResInvest_ERP_samouczek_1080p.mp4"))
