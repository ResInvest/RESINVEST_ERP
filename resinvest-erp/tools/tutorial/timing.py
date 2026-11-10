"""Oś czasu samouczka: rozdziały, plansze, zdania lektora i napisy.

Etap 1 (python timing.py): czas rozdziału = długość nagrania lektora (mp3/), początki zdań z wykrywania ciszy;
  `snap` = początek zdania leży na pauzie w nagraniu (tam wolno wstawić przerwę). Wynik: timing.json dla nagrywarki.
Etap 2 (python timing.py --final): po nagraniu (cap/NN/events.json) — lektor czeka na akcje: zdanie i zaczyna się
  o `shifts[i]` s później, rozdział trwa do końca lektora albo akcji. Wynik: timing_final.json + subs.ass (napisy
  zgodne z przesuniętymi zdaniami). Obraz nigdy nie jest przyspieszany.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
RATE, GAP = 15.5, 0.35          # znaki/s, pauza między zdaniami (szacunek)
OPEN, CARD, TAIL, OUTRO = 5.0, 3.0, 1.2, 5.5   # plansza otwarcia, plansza rozdziału, oddech po lektorze, plansza końcowa

# zapis fonetyczny dla lektora → zapis w napisach
DISPLAY = [("Res-Inwest e-er-pe", "ResInvest ERP"), ("wu-zet", "WZ"), ("em-em", "MM"), ("pe-de-ef", "PDF"),
           ("ce-es-fau", "CSV"), ("gigadżulach", "GJ"), ("osiemdziesięciu pięciu procent", "85%"),
           ("osiemdziesiąt jeden metrów przestrzennych", "81 MP"),
           ("sześć i pół metra na dwa czterdzieści na dwa i pół metra", "6,5 × 2,40 × 2,5 m"),
           ("trzydzieści trzy setne tony", "0,33 t"), ("trzydziestu dni", "30 dni")]


def display(s):
    for a, b in DISPLAY: s = s.replace(a, b)
    return s


FINAL = "--final" in sys.argv


def load_events(no):
    f = os.path.join(HERE, "cap", f"{no:02d}", "events.json")
    if not os.path.exists(f): raise SystemExit(f"brak nagrania rozdziału {no}: {f}")
    return json.load(open(f, encoding="utf-8"))


def duration(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def envelope(path, hop=0.02):
    """Głośność nagrania [dB] w ramkach 20 ms."""
    import numpy as np
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    h = int(16000 * hop); n = len(x) // h
    e = np.sqrt((x[:n * h].reshape(n, h) ** 2).mean(1)) + 1e-9
    return 20 * np.log10(e)


def sentence_starts(sents, total, db, hop=0.02):
    """Początki zdań: szacunek z liczby znaków (tempo dopasowane do długości nagrania), potem dolina głośności
    (pauza / oddech, < −19 dB) najbliższa szacunkowi. Zwraca (początki mowy, punkty cięcia w dolinie, snap)."""
    w = [len(s) / RATE + GAP for s in sents]
    k = total / sum(w)
    starts, cuts, snap = [0.0], [0.0], [True]
    if db is None:
        t = 0.0
        for x in w[:-1]: t += x * k; starts.append(round(t, 2)); cuts.append(round(t, 2)); snap.append(False)
        return starts, cuts, snap
    low = db < -19
    runs, i, n = [], 0, len(db)
    while i < n:                                    # ciągłe odcinki ciszy / oddechu ≥ 60 ms
        if low[i]:
            j = i
            while j < n and low[j]: j += 1
            if j - i >= 3: runs.append((i * hop, j * hop, float(db[i:j].min())))
            i = j
        else: i += 1
    for idx in range(1, len(sents)):
        est = starts[-1] + w[idx - 1] * k
        cand = [(a, b, m) for a, b, m in runs if b > starts[-1] + 0.8 and abs((a + b) / 2 - est) < 1.4]
        if cand:
            a, b, m = max(cand, key=lambda r: min(4.0, -r[2] / 10) + 0.6 * min(0.5, r[1] - r[0]) - 1.6 * abs((r[0] + r[1]) / 2 - est))
            starts.append(round(b, 2)); cuts.append(round((a + b) / 2, 3)); snap.append(True)
        else:
            starts.append(round(est, 2)); cuts.append(round(est, 3)); snap.append(False)
    return starts, cuts, snap


def cues(sent, t0, t1):
    """Dzieli zdanie na napisy ≤ 2 linie po ~44 znaki; czas proporcjonalny do liczby znaków."""
    parts = []
    for s in re.split(r"(?<=[.!?…])\s+", sent.strip()):
        n = -(-len(s) // 80)
        if n <= 1: parts.append(s); continue
        words, size, cur = s.split(), len(s) / n, ""
        for wd in words:
            if cur and len(cur) + len(wd) + 1 > size + 8: parts.append(cur); cur = wd
            else: cur = (cur + " " + wd).strip()
        if cur: parts.append(cur)
    merged = []
    for p in parts:   # krótkie zdanie łączone z poprzednim, jeśli razem mieszczą się w dwóch liniach
        if merged and (len(p) < 28 or len(merged[-1]) < 28) and len(merged[-1]) + len(p) + 1 <= 84: merged[-1] += " " + p
        else: merged.append(p)
    parts = merged
    tot, t, out = sum(len(p) for p in parts), t0, []
    for p in parts:
        d = (t1 - t0) * len(p) / tot
        out.append((t, t + d, p)); t += d
    return out


def wrap2(s):
    if len(s) <= 44: return s
    mid, best = len(s) // 2, None
    for m in re.finditer(" ", s):
        if best is None or abs(m.start() - mid) < abs(best - mid): best = m.start()
    return s[:best] + r"\N" + s[best + 1:]


def ts(x):
    h, x = divmod(x, 3600); m, x = divmod(x, 60)
    return f"{int(h)}:{int(m):02d}:{x:05.2f}"


def main():
    script = json.load(open(os.path.join(HERE, "script.json"), encoding="utf-8"))
    t, chapters, events = OPEN, [], []
    for c in script:
        mp3 = os.path.join(HERE, "mp3", c["file"] + ".mp3")
        has = os.path.exists(mp3)
        sents = c["text"]
        if has:
            dur = duration(mp3); starts, cutp, snaps = sentence_starts(sents, dur, envelope(mp3))
        else:
            dur = sum(len(s) / RATE + GAP for s in sents) - GAP; starts, cutp, snaps = sentence_starts(sents, dur, None)
        rec = load_events(c["no"]) if FINAL else None
        shifts = (rec or {}).get("shifts") or [0.0] * len(sents)
        tail = OUTRO if c is script[-1] else TAIL
        voice_end = dur + (shifts[-1] if shifts else 0)
        content = voice_end + tail
        if rec: content = max(content, rec["endT"] + (OUTRO if c is script[-1] else 0.9))
        ch = {"no": c["no"], "file": c["file"], "title": c["title"], "start": round(t, 2), "card": CARD,
              "voiceAt": round(t + CARD, 2), "voiceDur": round(dur, 2), "voiceEnd": round(voice_end, 2), "mp3": mp3 if has else None,
              "contentDur": round(content, 2), "end": round(t + CARD + content, 2),
              "sentences": [{"t": s, "cut": cu, "snap": sn, "shift": round(sh, 3), "text": x} for s, cu, sn, sh, x in zip(starts, cutp, snaps, shifts, sents)]}
        for i, s in enumerate(ch["sentences"]):
            e = ch["sentences"][i + 1]["t"] - 0.15 if i + 1 < len(sents) else dur      # koniec mowy w nagraniu
            for a, b, p in cues(display(s["text"]), ch["voiceAt"] + s["t"] + s["shift"], ch["voiceAt"] + e + s["shift"]):
                events.append((a, b, p))
        chapters.append(ch); t = ch["end"]
    tl = {"fps": 30, "open": OPEN, "total": round(t, 2), "final": FINAL, "chapters": chapters, "estimated": not all(c["mp3"] for c in chapters)}
    json.dump(tl, open(os.path.join(HERE, "timing_final.json" if FINAL else "timing.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H50141A16,&H50141A16,1,0,0,0,100,100,0,0,3,14,0,2,160,160,46,238

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    with open(os.path.join(HERE, "subs.ass"), "w", encoding="utf-8") as f:
        f.write(head)
        for a, b, p in events:
            f.write(f"Dialogue: 0,{ts(a)},{ts(b)},Sub,,0,0,0,,{{\\fad(120,120)}}{wrap2(p)}\n")
    print(f"{'oś ostateczna' if FINAL else 'oś lektora'}: razem {t/60:.2f} min, rozdziałów {len(chapters)}, napisów {len(events)}, z nagrań: {sum(1 for c in chapters if c['mp3'])}")
    if FINAL:
        for c in chapters: print(f"  {c['no']:2d} {c['title'][:44]:44s} lektor {c['voiceDur']:6.1f} + pauzy {c['voiceEnd'] - c['voiceDur']:4.1f} s → treść {c['contentDur']:6.1f} s")


if __name__ == "__main__":
    main()
