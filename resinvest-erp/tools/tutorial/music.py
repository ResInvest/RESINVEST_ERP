"""Epicki podkład instrumentalny (własna synteza — bez licencji zewnętrznych).

d-moll, 92 BPM: smyczki (pady), ostinato wiolonczel i basów, taiko/kotły, blacha (narastające akordy),
wysokie smyczki (shimmer), crescendo talerza przed planszami. Natężenie z osi czasu (timing.json):
plansze i otwarcie — pełna orkiestra, pod lektorem — spokojniej (dodatkowo ducking w montażu).
Wynik: music.wav (44,1 kHz, stereo).
"""
import json, os, sys
import numpy as np
from scipy.signal import oaconvolve, butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
SR, BPM = 44100, 92
BEAT = 60 / BPM; BAR = 4 * BEAT
rng = np.random.default_rng(7)

N = {"C": 0, "C#": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "A": 9, "Bb": 10, "B": 11}
def hz(name, octv): return 440 * 2 ** ((N[name] + 12 * (octv + 1) - 69) / 12)

# akordy: (pryma, nuty akordu), 16 taktów: dwa warianty 8-taktowe
PROG = [("D", ["D", "F", "A"]), ("Bb", ["Bb", "D", "F"]), ("F", ["F", "A", "C"]), ("C", ["C", "E", "G"]),
        ("D", ["D", "F", "A"]), ("Bb", ["Bb", "D", "F"]), ("G", ["G", "Bb", "D"]), ("A", ["A", "C#", "E"]),
        ("D", ["D", "F", "A"]), ("F", ["F", "A", "C"]), ("C", ["C", "E", "G"]), ("G", ["G", "Bb", "D"]),
        ("Bb", ["Bb", "D", "F"]), ("F", ["F", "A", "C"]), ("G", ["G", "Bb", "D"]), ("A", ["A", "C#", "E"])]


def saw(f, n, phase0=0.0):
    """Piła z korekcją polyBLEP (mniej aliasingu)."""
    dt = f / SR
    ph = (phase0 + dt * np.arange(n)) % 1.0
    y = 2 * ph - 1
    t1 = ph < dt; x = ph[t1] / dt; y[t1] -= x + x - x * x - 1
    t2 = ph > 1 - dt; x = (ph[t2] - 1) / dt; y[t2] -= x * x + x + x + 1
    return y


def lp(x, fc, order=2):
    sos = butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos")
    return sosfilt(sos, x)


def hp(x, fc, order=2):
    sos = butter(order, fc, "high", fs=SR, output="sos")
    return sosfilt(sos, x)


def env_adsr(n, a, d, s, r_start, r):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    e = np.where(t > r_start, e * np.exp(-(t - r_start) / max(r, 1e-4)), e)
    return e


def pan(x, p):  # p: -1 (L) … +1 (P)
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def strings_pad(chord, octv, n, bright):
    out = np.zeros((2, n))
    for i, name in enumerate(chord):
        f = hz(name, octv + (1 if i == 0 and octv < 4 else 0))
        for k, det in enumerate((-9, -4, 0, 4, 9)):
            v = saw(f * 2 ** (det / 1200), n, rng.random()) * (1 + 0.15 * np.sin(2 * np.pi * (4.8 + k * 0.3) * np.arange(n) / SR))
            out += pan(v, (k - 2) / 2.2)
    out = np.stack([lp(out[0], 1600 + 4200 * bright), lp(out[1], 1600 + 4200 * bright)])
    return out * env_adsr(n, 0.55, 1.2, 0.85, n / SR - 0.9, 0.6) * 0.035


def ostinato(root, n, inten):
    """Ósemki/szesnastki wiolonczel i kontrabasów na prymie (z oktawą i kwintą)."""
    out = np.zeros(n)
    step = BEAT / (4 if inten > 0.8 else 2)
    pat = [0, 0, 12, 0, 0, 7, 12, 0] if inten <= 0.8 else [0, 0, 12, 0, 7, 0, 12, 0, 0, 0, 12, 0, 7, 12, 10, 7]
    base = hz(root, 2)
    L = int(step * SR * 0.92)
    for j, semi in enumerate(pat):
        s = int(j * step * SR)
        if s >= n: break
        m = min(L, n - s)
        f = base * 2 ** (semi / 12)
        v = (saw(f, m) + 0.6 * saw(f * 1.003, m)) * np.exp(-np.arange(m) / SR / (0.09 + 0.05 * inten))
        v *= np.minimum(1, np.arange(m) / (0.004 * SR))
        out[s:s + m] += v * (1.0 if j % 4 == 0 else 0.72)
    return pan(lp(out, 700 + 900 * inten), 0.05) * 0.10


def drum(n_len, big=False):
    m = int(SR * (1.3 if big else 0.75))
    t = np.arange(m) / SR
    f = (48 if big else 62) + (95 if big else 80) * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / (0.55 if big else 0.28))
    noise = lp(rng.standard_normal(m), 1400) * np.exp(-t / 0.035) * 0.5
    return (body + noise) * (1.4 if big else 1.0)


DRUM = drum(0); BOOM = drum(0, True)


def drums(n, inten, bar_i):
    out = np.zeros(n)
    hits = [(0, 1.0)]
    if inten > 0.45: hits += [(2 * BEAT, 0.8)]
    if inten > 0.75: hits += [(1.5 * BEAT, 0.55), (3 * BEAT, 0.7), (3.5 * BEAT, 0.5)]
    if inten > 0.75 and bar_i % 4 == 3: hits += [(3.25 * BEAT, 0.45), (3.5 * BEAT, 0.6), (3.75 * BEAT, 0.75)]
    for t0, g in hits:
        s = int(t0 * SR); w = DRUM if g < 1 or inten < 0.9 or bar_i % 8 else BOOM
        m = min(len(w), n - s)
        if m > 0: out[s:s + m] += w[:m] * g
    return pan(out, 0) * 0.30


def brass(chord, n, inten):
    out = np.zeros(n)
    for i, name in enumerate(chord):
        f = hz(name, 3 if i else 2)
        out += saw(f, n, rng.random()) + saw(f * 1.004, n, rng.random()) * 0.7
    t = np.arange(n) / SR
    swell = np.clip(t / (BAR * 0.7), 0, 1) ** 1.6
    out = lp(out * swell, 500 + 1500 * inten) * env_adsr(n, 0.25, 2, 0.9, n / SR - 0.5, 0.4)
    return pan(out, -0.15) * 0.05


def shimmer(chord, n):
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for i, name in enumerate(chord):
        f = hz(name, 5)
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t + i)
        out += pan(np.sin(2 * np.pi * f * np.cumsum(vib) / SR), (i - 1) * 0.7)
    return out * env_adsr(n, 0.8, 2, 0.8, n / SR - 0.9, 0.7) * 0.03


def swell_cymbal(n):
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 4000) * (t / t[-1]) ** 3
    return np.stack([x, np.roll(x, 37)]) * 0.10


def intensity_curve(tl, total):
    """Natężenie w czasie: 1.0 — otwarcie, plansze, finał; 0.55 — pod lektorem."""
    pts = [(0, 0.85), (tl["open"] - 0.5, 1.0)]
    for c in tl["chapters"]:
        pts += [(c["start"] - 0.8, 0.6), (c["start"] + 0.2, 1.0), (c["voiceAt"] + 0.3, 1.0), (c["voiceAt"] + 2.0, 0.55),
                (c["voiceAt"] + c["voiceDur"] - 0.5, 0.55)]
    pts += [(total - 5.0, 1.0), (total, 1.0)]
    pts.sort()
    xs, ys = zip(*pts)
    return lambda t: float(np.interp(t, xs, ys))


def reverb(x, sec=2.4):
    m = int(SR * sec); t = np.arange(m) / SR
    ir = rng.standard_normal((2, m)) * np.exp(-t / (sec / 6.5))
    ir[:, : int(0.012 * SR)] = 0
    ir = np.stack([lp(ir[0], 6000), lp(ir[1], 6000)]); ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    return np.stack([oaconvolve(x[0], ir[0])[: x.shape[1]], oaconvolve(x[1], ir[1])[: x.shape[1]]])


def main():
    tl = json.load(open(os.path.join(HERE, "timing.json"), encoding="utf-8"))
    total = tl["total"] + 1.0
    n_all = int(total * SR) + int(3 * SR)
    mix = np.zeros((2, n_all), dtype=np.float64)
    inten = intensity_curve(tl, total)
    cards = [c["start"] for c in tl["chapters"]] + [total - 5.0]
    nbars = int(np.ceil(total / BAR))
    for b in range(nbars):
        t0 = b * BAR; s = int(t0 * SR); n = int(BAR * SR) + int(1.0 * SR)
        root, chord = PROG[b % len(PROG)]
        I = inten(t0 + BAR / 2)
        seg = strings_pad(chord, 3, n, I) * (0.8 + 0.4 * I)
        seg += ostinato(root, n, I) * np.clip((I - 0.35) / 0.4, 0.25, 1)
        seg += drums(n, I, b) * np.clip((I - 0.4) / 0.5, 0.15, 1)
        if I > 0.7: seg += brass(chord, n, I) * (I - 0.7) / 0.3
        seg += shimmer(chord, n) * (0.6 + 0.6 * I)
        # crescendo talerza w takcie przed planszą
        if any(0 < c - t0 <= BAR * 1.05 for c in cards):
            k = int(min(BAR, min(c - t0 for c in cards if c - t0 > 0)) * SR)
            seg[:, :k] += swell_cymbal(k)
        e = min(n_all, s + n); mix[:, s:e] += seg[:, : e - s]
        if b % 20 == 0: print(f"takt {b}/{nbars}", flush=True)
    mix = mix[:, : int(total * SR)]
    wet = reverb(mix)
    out = 0.78 * mix + 0.42 * wet
    out = np.stack([hp(out[0], 38) + 0.9 * hp(out[0], 2800), hp(out[1], 38) + 0.9 * hp(out[1], 2800)])  # bez subbasu, jaśniejsza góra
    fade = int(3 * SR); out[:, -fade:] *= np.linspace(1, 0, fade); out[:, : int(0.5 * SR)] *= np.linspace(0, 1, int(0.5 * SR))
    out = np.tanh(out * 1.6) / np.tanh(1.6)
    out /= np.abs(out).max() / 0.89
    pcm = (out.T * 32767).astype(np.int16)
    import wave
    with wave.open(os.path.join(HERE, "music.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print("music.wav", round(total, 1), "s")


if __name__ == "__main__":
    main()
