"""Montaż samouczka: klatki z nagrywarki + kursor, podświetlenie kliknięć, strzałki, ramki, plansze,
polskie napisy (ASS), lektor i epicki podkład z duckingiem. Wynik: MP4 H.264 1920×1080 30 kl./s, AAC.

python compose.py [--chapters 1-4] [--scale 0.5] [--out plik.mp4] [--crf 20]
"""
import argparse, json, math, os, re, subprocess, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
W, H, FPS, SR = 1920, 1080, 30, 44100
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
XFADE = 0.22
GREEN, GREEN_D, INK, CREAM = (31, 107, 69), (16, 63, 41), (22, 30, 25), (246, 248, 243)


def font(sz, bold=True): return ImageFont.truetype(FB if bold else FR, sz)


def hexrgb(h): h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def ease(u): u = min(1, max(0, u)); return 4 * u * u * u if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


# ----------------------------------------------------------------- sprite'y
def cursor_sprite():
    S = 4; im = Image.new("RGBA", (40 * S, 52 * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    pts = [(2, 2), (2, 38), (11, 30), (17, 46), (23, 43), (17, 28), (29, 28)]
    pts = [(x * S, y * S) for x, y in pts]
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).polygon([(x + 3 * S, y + 4 * S) for x, y in pts], fill=(0, 0, 0, 110))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(3 * S))); d = ImageDraw.Draw(im)
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(20, 20, 20, 255), width=int(2.4 * S))
    return im.resize((40, 52), Image.LANCZOS)


def halo_sprite(r, color, alpha):
    S = 4; im = Image.new("RGBA", (2 * r * S + 8, 2 * r * S + 8), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse((4, 4, 4 + 2 * r * S, 4 + 2 * r * S), fill=color + (alpha,))
    return im.resize((2 * r + 2, 2 * r + 2), Image.LANCZOS)


def ring_sprite(r, color, alpha, width):
    S = 4; im = Image.new("RGBA", (2 * r * S + 8, 2 * r * S + 8), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse((4, 4, 4 + 2 * r * S, 4 + 2 * r * S), outline=color + (alpha,), width=width * S)
    return im.resize((2 * r + 2, 2 * r + 2), Image.LANCZOS)


CURSOR = cursor_sprite()
HALO = halo_sprite(30, (255, 214, 0), 105)
RINGS = {k: ring_sprite(16 + int(42 * k / 14), (255, 122, 0), int(240 * (1 - k / 15)), 5) for k in range(15)}


def bubble(text, color, size=30):
    f = font(size); tw, th = f.getbbox(text)[2], f.getbbox("Ąg")[3]
    pw, ph = tw + 44, th + 26
    S = 2; im = Image.new("RGBA", ((pw + 24) * S, (ph + 24) * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((12 * S, 16 * S, (12 + pw) * S, (16 + ph) * S), 16 * S, fill=(0, 0, 0, 90))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(6 * S))); d = ImageDraw.Draw(im)
    d.rounded_rectangle((12 * S, 12 * S, (12 + pw) * S, (12 + ph) * S), 16 * S, fill=color + (255,), outline=(255, 255, 255, 255), width=3 * S)
    im = im.resize((pw + 24, ph + 24), Image.LANCZOS); d = ImageDraw.Draw(im)
    d.text((12 + 22, 12 + 11), text, font=f, fill=(255, 255, 255, 255))
    return im


def arrow_sprite(ev):
    """Strzałka (grot przy elemencie) + dymek z podpisem; zwraca (sprite, x0, y0, (dx, dy) kierunek)."""
    r, col = ev["r"], hexrgb(ev["color"])
    cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
    side = ev.get("side", "auto")
    if side == "auto":
        if r["w"] > 1000: side = "below" if r["y"] + r["h"] < H - 300 else "above"
        elif cx > W * 0.55: side = "left"
        else: side = "right"
    L = 170
    if side == "left": tip = (r["x"] - 8, cy); ang = math.radians(200)
    elif side == "right": tip = (r["x"] + r["w"] + 8, cy); ang = math.radians(-20)
    elif side == "below": tip = (min(max(cx, 300), W - 300), r["y"] + r["h"] + 8); ang = math.radians(70)
    else: tip = (min(max(cx, 300), W - 300), r["y"] - 8); ang = math.radians(-70)
    tip = (min(max(tip[0], 40), W - 40), min(max(tip[1], 60), H - 60))
    tail = (tip[0] + L * math.cos(ang), tip[1] + L * math.sin(ang))
    b = bubble(ev["label"], col)
    bw, bh = b.size
    bx = tail[0] - (bw if math.cos(ang) < -0.3 else 0 if math.cos(ang) > 0.3 else bw / 2)
    by = tail[1] - bh / 2 + (bh / 2 - 8 if math.sin(ang) > 0.5 else -bh / 2 + 8 if math.sin(ang) < -0.5 else 0)
    bx = min(max(bx, 10), W - bw - 10); by = min(max(by, 70), H - bh - 150)
    S = 3; layer = Image.new("RGBA", (W * S // 2, H * S // 2), (0, 0, 0, 0))   # połowa kadru ×3 = 1,5× rozdzielczości
    k = S / 2
    def P(p): return (p[0] * k, p[1] * k)
    d = ImageDraw.Draw(layer)
    ux, uy = math.cos(ang), math.sin(ang)        # od grotu do ogona
    head = 40; base = (tip[0] + ux * head, tip[1] + uy * head)
    nx, ny = -uy, ux
    tri = [tip, (base[0] + nx * 24, base[1] + ny * 24), (base[0] - nx * 24, base[1] - ny * 24)]
    for wdt, c in ((26, (255, 255, 255, 255)), (16, col + (255,))):
        d.line([P(base), P(tail)], fill=c, width=int(wdt * k))
    d.polygon([P(p) for p in [(tip[0] - ux * 5, tip[1] - uy * 5), (tri[1][0] + nx * 6 + ux * 4, tri[1][1] + ny * 6 + uy * 4), (tri[2][0] - nx * 6 + ux * 4, tri[2][1] - ny * 6 + uy * 4)]], fill=(255, 255, 255, 255))
    d.polygon([P(p) for p in tri], fill=col + (255,))
    layer = layer.resize((W, H), Image.LANCZOS)
    sh = layer.split()[3].filter(ImageFilter.GaussianBlur(5)).point(lambda a: a * 0.45)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); shadow.putalpha(sh)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0)); out.alpha_composite(shadow, (3, 5)); out.alpha_composite(layer)
    out.alpha_composite(b, (int(bx), int(by)))
    bb = out.getbbox() or (0, 0, 1, 1)
    return out.crop(bb), bb[0], bb[1], (-ux, -uy)


def box_sprite(ev):
    r, col = ev["r"], hexrgb(ev["color"])
    pad = 8; x0, y0 = max(4, r["x"] - pad), max(4, r["y"] - pad); x1, y1 = min(W - 4, r["x"] + r["w"] + pad), min(H - 4, r["y"] + r["h"] + pad)
    y1 = min(y1, H - 150)            # ramka nie wchodzi pod napisy
    if x1 - x0 < 20 or y1 - y0 < 20: return Image.new("RGBA", (1, 1), (0, 0, 0, 0)), 0, 0
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, y0, x1, y1), 14, outline=col + (255,), width=12)
    glow = im.filter(ImageFilter.GaussianBlur(9))
    im2 = Image.new("RGBA", (W, H), (0, 0, 0, 0)); im2.alpha_composite(glow); im2.alpha_composite(glow)
    d2 = ImageDraw.Draw(im2); d2.rounded_rectangle((x0, y0, x1, y1), 14, outline=(255, 255, 255, 255), width=8)
    d2.rounded_rectangle((x0 + 2, y0 + 2, x1 - 2, y1 - 2), 12, outline=col + (255,), width=5)
    if ev.get("label"):
        b = bubble(ev["label"], col, 28)
        by = y0 - b.size[1] + 10 if y0 - b.size[1] + 10 > 64 else min(y1 - 10, H - b.size[1] - 150)
        im2.alpha_composite(b, (int(min(max(x0 - 6, 8), W - b.size[0] - 8)), int(by)))
    bb = im2.getbbox() or (0, 0, 1, 1)
    return im2.crop(bb), bb[0], bb[1]


# ----------------------------------------------------------------- plansze
def blurred_bg(img):
    if img is None: img = Image.new("RGB", (W, H), CREAM)
    bg = img.convert("RGB").resize((W // 8, H // 8)).filter(ImageFilter.GaussianBlur(3)).resize((W, H), Image.BICUBIC)
    return Image.blend(bg, Image.new("RGB", (W, H), CREAM), 0.80).convert("RGBA")


def logo(d, x, y, s):
    d.rounded_rectangle((x, y, x + s, y + s), int(s * 0.24), fill=GREEN)
    f = font(int(s * 0.36)); tw = f.getbbox("RiC")[2]
    d.text((x + (s - tw) / 2, y + s * 0.29), "RiC", font=f, fill=(255, 255, 255))


def card_image(bg, kind, ch=None, total=16):
    im = blurred_bg(bg); d = ImageDraw.Draw(im)
    for i, c in enumerate(["#FF1F8E", "#FF7A00", "#FFC400", "#3BE000", "#00B8FF", "#8B3DFF"]):   # jaskrawy pasek akcentu
        d.rectangle((i * W / 6, H - 14, (i + 1) * W / 6, H), fill=hexrgb(c))
    if kind == "open":
        logo(d, 160, 300, 150)
        d.text((350, 300), "ResInvest ERP", font=font(104), fill=INK)
        d.text((354, 428), "Pełny samouczek programu", font=font(54, False), fill=GREEN_D)
        d.text((160, 560), "Obrót i magazynowanie biomasy drzewnej · wersja 3.9", font=font(34, False), fill=(70, 84, 76))
        d.text((160, 640), "16 rozdziałów · krok po kroku · lektor i napisy PL", font=font(30), fill=(120, 134, 126))
    elif kind == "chapter":
        d.text((160, 250), f"{ch['no']:02d}", font=font(220), fill=GREEN)
        d.text((165, 505), f"ROZDZIAŁ {ch['no']} Z {total}", font=font(34), fill=(255, 122, 0))
        title = ch["title"]; f = font(78)
        while f.getbbox(title)[2] > W - 320 and f.size > 48: f = font(f.size - 4)
        d.text((160, 560), title, font=f, fill=INK)
        d.rounded_rectangle((165, 700, 165 + 600, 712), 6, fill=(220, 228, 222))
        d.rounded_rectangle((165, 700, 165 + 600 * ch["no"] / total, 712), 6, fill=GREEN)
        logo(d, W - 260, 120, 110)
    else:
        logo(d, W / 2 - 90, 250, 180)
        f = font(96); t = "ResInvest ERP"; d.text(((W - f.getbbox(t)[2]) / 2, 470), t, font=f, fill=INK)
        f = font(56, False); t = "Biomasa pod kontrolą"; d.text(((W - f.getbbox(t)[2]) / 2, 600), t, font=f, fill=GREEN_D)
        f = font(34, False); t = "Dziękujemy za uwagę — powodzenia na magazynie."; d.text(((W - f.getbbox(t)[2]) / 2, 700), t, font=f, fill=(90, 104, 96))
    return im


def chip_image(ch, total):
    f = font(24); t = f"{ch['no']:02d}/{total} · {ch['title']}"
    tw = f.getbbox(t)[2]; im = Image.new("RGBA", (tw + 40, 46), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, tw + 39, 45), 22, fill=(255, 255, 255, 235), outline=GREEN + (255,), width=2)
    d.text((20, 9), t, font=f, fill=GREEN_D)
    return im


# ----------------------------------------------------------------- oś zdarzeń rozdziału
class Chapter:
    def __init__(self, ch, total):
        self.ch = ch; d = os.path.join(HERE, "cap", f"{ch['no']:02d}")
        ev = json.load(open(os.path.join(d, "events.json")))
        self.dir = d; self.events = ev["events"]
        self.shots = [(e["t"], e["f"]) for e in self.events if e["type"] == "shot"]
        self.moves = [e for e in self.events if e["type"] == "move"]
        self.clicks = [e["t"] for e in self.events if e["type"] == "click"]
        self.overlays = [e for e in self.events if e["type"] in ("arrow", "box")]
        self.chip = chip_image(ch, total)
        self._cache = {}; self._spr = {}

    def load(self, f):
        if f not in self._cache:
            if len(self._cache) > 6: self._cache.pop(next(iter(self._cache)))
            self._cache[f] = Image.open(os.path.join(self.dir, f)).convert("RGBA")
        return self._cache[f]

    def base(self, t):
        """Klatka programu w chwili t; po zmianie ekranu (klik, przejście) — płynne przenikanie 0,2 s."""
        if not self.shots: return Image.new("RGBA", (W, H), CREAM + (255,))
        i = 0
        while i + 1 < len(self.shots) and self.shots[i + 1][0] <= t + 1e-6: i += 1
        cur = self.load(self.shots[i][1])
        if i > 0:
            t_cur, t_prev = self.shots[i][0], self.shots[i - 1][0]
            u = (t - t_cur) / XFADE
            if t_cur - t_prev > 0.1 and 0 <= u < 1:      # nie przy przewijaniu i wpisywaniu (tam klatki są gęste)
                return Image.blend(self.load(self.shots[i - 1][1]), cur, ease(u))
        return cur

    def first(self):
        return Image.open(os.path.join(self.dir, self.shots[0][1])) if self.shots else None

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

    def sprite(self, i, e):
        if i not in self._spr: self._spr[i] = arrow_sprite(e) if e["type"] == "arrow" else box_sprite(e) + ((0, 0),)
        return self._spr[i]


def render(args):
    tl = json.load(open(os.path.join(HERE, "timing.json"), encoding="utf-8"))
    total_ch = len(tl["chapters"])
    sel = [c for c in tl["chapters"] if args.chapters is None or c["no"] in args.chapters]
    t0 = 0.0 if (args.chapters is None or 1 in args.chapters) else sel[0]["start"]
    t1 = sel[-1]["end"]
    chs = {c["no"]: Chapter(c, total_ch) for c in sel}
    cards = {}
    first_img = {c["no"]: chs[c["no"]].first() for c in sel}
    open_card = card_image(first_img.get(2) or first_img[sel[0]["no"]], "open") if t0 == 0 else None
    outro = card_image(first_img.get(16), "outro") if any(c["no"] == total_ch for c in sel) else None
    sc = args.scale; OW, OH = int(W * sc) // 2 * 2, int(H * sc) // 2 * 2

    # ---------- napisy przesunięte do początku fragmentu
    ass_src = open(os.path.join(HERE, "subs.ass"), encoding="utf-8").read()
    def shift(m):
        def tsec(s): h, mi, se = s.split(":"); return int(h) * 3600 + int(mi) * 60 + float(se)
        def fmt(x): x = max(0, x); h, x = divmod(x, 3600); mi, x = divmod(x, 60); return f"{int(h)}:{int(mi):02d}:{x:05.2f}"
        a, b = tsec(m[1]) - t0, tsec(m[2]) - t0
        if b <= 0 or a >= t1 - t0: return ""
        return f"Dialogue: 0,{fmt(a)},{fmt(b)},{m[3]}"
    ass = re.sub(r"Dialogue: 0,([\d:.]+),([\d:.]+),(.*)", shift, ass_src)
    ass_path = os.path.join(HERE, "_subs_part.ass"); open(ass_path, "w", encoding="utf-8").write(ass)

    # ---------- dźwięk: podkład z duckingiem pod lektorem + lektor (loudnorm −16 LUFS)
    n = int((t1 - t0) * SR)
    with wave.open(os.path.join(HERE, "music.wav")) as w:
        w.setpos(int(t0 * SR)); mus = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768
    mus = np.pad(mus, ((0, max(0, n - len(mus))), (0, 0)))[:n]
    env = np.full(n, 10 ** (-3 / 20), dtype=np.float32)
    tt = np.arange(n) / SR + t0
    for c in sel:
        a, b = c["voiceAt"] - 0.35, c["voiceAt"] + c["voiceDur"] + 0.25
        g = np.clip(np.minimum((tt - a) / 0.6, (b - tt) / 0.9), 0, 1)
        env *= 1 - g * (1 - 10 ** (-12 / 20))
    mix = mus * env[:, None]
    for c in sel:
        if not c["mp3"]: continue
        raw = subprocess.run([FFMPEG, "-v", "error", "-i", c["mp3"], "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SR), "-ac", "2", "-f", "f32le", "-"], capture_output=True).stdout
        v = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2); s = int((c["voiceAt"] - t0) * SR)
        m = min(len(v), n - s); mix[s:s + m] += v[:m]
    pk = np.abs(mix).max()
    if pk > 0.95: mix *= 0.95 / pk
    wav_path = os.path.join(HERE, "_mix.wav")
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())

    # ---------- wideo: klatki do ffmpeg
    out = args.out or os.path.join(HERE, "ResInvest_ERP_samouczek.mp4")
    vf = (f"scale={OW}:{OH}:flags=lanczos," if sc != 1 else "") + f"ass={ass_path}"
    cmd = [FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", wav_path, "-vf", vf, "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf), "-pix_fmt", "yuv420p",
           "-g", "60", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    nframes = int(round((t1 - t0) * FPS))
    starts, cur = {}, (W * 0.5, H * 0.55)        # kursor zaczyna rozdział tam, gdzie skończył poprzedni
    for c in sel:
        starts[c["no"]] = cur
        if chs[c["no"]].moves: cur = (chs[c["no"]].moves[-1]["x"], chs[c["no"]].moves[-1]["y"])
    for k in range(nframes):
        t = t0 + k / FPS
        c = next((x for x in sel if x["start"] <= t < x["end"]), sel[-1])
        C = chs[c["no"]]; ct = t - c["voiceAt"]           # czas treści (0 = początek lektora)
        if t < tl["open"] and open_card is not None:
            a = min(1, (tl["open"] - t) / 0.6, t / 0.5)      # wejście z bieli, przejście w planszę rozdziału 1
            nxt = cards.setdefault(c["no"], card_image(C.first(), "chapter", c, total_ch)) if t > tl["open"] - 0.6 else Image.new("RGBA", (W, H), CREAM + (255,))
            fr = Image.blend(nxt, open_card, a) if a < 1 else open_card.copy()
        else:
            fr = C.base(max(ct, 0)).copy()
            pos = C.cursor(max(ct, 0), starts[c["no"]])
            # strzałki i ramki
            for i, e in enumerate(C.overlays):
                if not (e["t0"] <= ct < e["t1"]): continue
                spr = C.sprite(i, e); im, x, y, dirv = spr
                age, left = ct - e["t0"], e["t1"] - ct
                al = min(1, age / 0.25, left / 0.25)
                if e["type"] == "arrow":
                    bob = 9 * math.sin(2 * math.pi * 1.6 * age); x += dirv[0] * -bob; y += dirv[1] * -bob
                else:
                    al *= 0.8 + 0.2 * math.sin(2 * math.pi * 1.2 * age)
                if al < 1: im = im.copy(); im.putalpha(im.split()[3].point(lambda v, a=al: int(v * a)))
                fr.alpha_composite(im, (int(x), int(y)))
            # podświetlenie kliknięć i kursor
            fr.alpha_composite(HALO, (int(pos[0] - 31), int(pos[1] - 31)))
            for tc in C.clicks:
                if 0 <= ct - tc < 0.5:
                    rg = RINGS[min(14, int((ct - tc) / 0.5 * 15))]; fr.alpha_composite(rg, (int(pos[0] - rg.size[0] / 2), int(pos[1] - rg.size[1] / 2)))
            fr.alpha_composite(CURSOR, (int(pos[0] - 3), int(pos[1] - 3)))
            fr.alpha_composite(C.chip, (W - C.chip.size[0] - 18, H - 64))
            # plansza rozdziału (na początku) i plansza końcowa
            card_t = t - c["start"]
            if card_t < c["card"]:
                cd = cards.setdefault(c["no"], card_image(C.first(), "chapter", c, total_ch))
                a = 1 if card_t < c["card"] - 0.5 else (c["card"] - card_t) / 0.5
                a = min(a, 1 if c["no"] == 1 and t0 == 0 else card_t / 0.3)
                fr = Image.blend(fr, cd, max(0, min(1, a))) if a < 1 else cd.copy()
            if outro is not None and c["no"] == total_ch and t > c["end"] - 5.0:
                a = min(1, (t - (c["end"] - 5.0)) / 0.8); fr = Image.blend(fr, outro, a) if a < 1 else outro.copy()
        ff.stdin.write(fr.convert("RGB").tobytes())
        if k % 900 == 0: print(f"  {t:7.1f} s / {t1:.1f} s", flush=True)
    ff.stdin.close(); ff.wait()
    print("zapisano", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--chapters", default=None)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--crf", type=int, default=20)
    ap.add_argument("--preset", default="medium")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    if a.chapters:
        lo, _, hi = a.chapters.partition("-"); a.chapters = list(range(int(lo), int(hi or lo) + 1))
    render(a)
