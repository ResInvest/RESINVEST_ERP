/* Nagrywarka samouczka ResInvest ERP (wersja 2).
   Steruje programem w Chromium (jasny motyw „Perła”, okno 1600×900 CSS px). Klatki zapisywane w skali 1,8
   (2880×1620 — zapas ostrości dla wirtualnej kamery), współrzędne zdarzeń w kadrze 1920×1080 (skala 1,2).
   Oś zdarzeń w czasie wirtualnym: ruchy kursora, kliknięcia, strzałki, ramki (także kolumn tabel).
   Tempo: beat(i) = początek zdania i lektora. Gdy akcje trwają dłużej niż zdanie, LEKTOR CZEKA (pauza przed
   zdaniem i — tylko na granicy zdań wykrytej w nagraniu); obraz nigdy nie jest przyspieszany ani ucinany.
   Przesunięcia zdań zapisywane w events.json (shifts) — timing.py --final buduje z nich ostateczną oś.
   Uruchomienie: NODE_PATH=$(npm root -g) node rec.cjs [numery rozdziałów, np. 1 4 5] */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const HERE = __dirname, CAP = path.join(HERE, "cap");
const APP = "file://" + path.resolve(__dirname, "../../ResInvest_ERP.html");
const TL = JSON.parse(fs.readFileSync(path.join(HERE, "timing.json"), "utf8"));
const DPR = 1.8, K = 1.2, VW = 1600, VH = 900;      // DPR — skala zrzutów, K — skala współrzędnych kadru 1920×1080
const ONLY = process.argv.slice(2).map(Number).filter(Boolean);
const C = { pink: "#FF1F8E", orange: "#FF7A00", lime: "#3BE000", cyan: "#00B8FF", violet: "#8B3DFF", yellow: "#FFC400" };

class Rec {
  constructor(page, ch) {
    this.p = page; this.ch = ch; this.T = 0; this.k = 1; this.n = 0; this.ev = []; this.miss = []; this.shift = 0; this.shiftAt = {};
    this.dir = path.join(CAP, String(ch.no).padStart(2, "0"));
    fs.rmSync(this.dir, { recursive: true, force: true }); fs.mkdirSync(this.dir, { recursive: true });
  }
  sent(i) { const s = this.ch.sentences; return i < s.length ? s[i] : { t: this.ch.voiceDur, snap: true, end: true }; }
  /**
   * Zdanie i lektora. Akcje przed czasem — czekają na lektora. Akcje spóźnione — lektor czeka (pauza przed zdaniem i,
   * gdy jego początek leży na pauzie w nagraniu); bez przyspieszania obrazu.
   */
  async beat(i, off = 0) {
    const s = this.sent(i), target = s.t + this.shift + off;
    if (this.T > target + 0.12) {
      if (s.snap && !s.end && i > 0) { this.shift += this.T - target + 0.15; this.shiftAt[i] = +this.shift.toFixed(3); }
    } else this.T = Math.max(this.T, target);
  }
  wait(s) { this.T += s; }
  async shot() {
    const f = `${String(this.n++).padStart(4, "0")}.jpg`;
    await this.p.screenshot({ path: path.join(this.dir, f), type: "jpeg", quality: 90 });
    this.ev.push({ t: +this.T.toFixed(3), type: "shot", f });
  }
  async settle(ms = 280) { await this.p.waitForTimeout(ms); }
  /** Prostokąt elementu w pikselach kadru (null, gdy brak). */
  async rect(sel) {
    const r = await this.p.evaluate(s => { const e = typeof s === "string" ? document.querySelector(s) : null; if (!e) return null; const b = e.getBoundingClientRect(); return b.width || b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null; }, sel).catch(() => null);
    if (!r) { this.miss.push(sel); return null; }
    return { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };
  }
  /** Prostokąt kolumny n tabeli (nagłówek + widoczna część kolumny), kolumna przewinięta w kadr. */
  async colRect(tbl, n) {
    const r = await this.p.evaluate(([s, n]) => {
      const t = document.querySelector(s); if (!t) return null;
      const th = t.querySelectorAll("thead th")[n - 1]; if (!th) return null;
      let b = th.getBoundingClientRect();
      if (b.right > innerWidth - 8 || b.left < 250) { th.scrollIntoView({ inline: "center", block: "nearest" }); b = th.getBoundingClientRect(); }
      const tb = t.getBoundingClientRect(), bottom = Math.min(tb.bottom, innerHeight - 8);
      return { x: b.left, y: b.top, w: b.width, h: Math.max(b.height, bottom - b.top) };
    }, [tbl, n]).catch(() => null);
    if (!r) { this.miss.push(`${tbl} kolumna ${n}`); return null; }
    return { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };
  }
  /** Kolumna tabeli: kursor na nagłówek, ramka na całą kolumnę z podpisem. */
  async col(tbl, n, label, opt = {}) {
    await this.reveal(`${tbl} thead`, 0.22);
    let r = await this.colRect(tbl, n); if (!r) return;
    await this.shot();
    const hx = r.x + r.w / 2, hy = r.y + 16 * K;
    const dur = (opt.move ?? 0.6) * this.k;
    this.ev.push({ t: +this.T.toFixed(3), type: "move", x: Math.round(hx), y: Math.round(hy), d: dur }); this.T += dur;
    this.ev.push({ type: "box", t0: +this.T.toFixed(3), t1: +(this.T + (opt.dur ?? 2.6)).toFixed(3), r, color: opt.color || C.orange, label, col: true });
    if (opt.hold !== 0) this.T += opt.hold ?? 1.2;
  }
  /** Zakładka: strzałka z podpisem i kliknięcie. */
  async tab(sel, label, opt = {}) {
    await this.arrow(sel, label, { color: opt.color || C.cyan, dur: opt.dur ?? 2.2, side: opt.side, cam: false });
    await this.click(sel, { settle: opt.settle ?? 600 });
  }
  /** Seria krótkich strzałek na kolejnych elementach (np. przyciski górnego paska) z ruchem kursora. */
  async tour(items, opt = {}) {
    for (const [sel, label, color] of items) {
      const r = await this.move(sel, { dur: opt.move ?? 0.55 }); if (!r) continue;
      await this.arrow(sel, label, { color: color || C.pink, dur: opt.dur ?? 1.8, side: opt.side, cam: opt.cam });
      this.T += opt.gap ?? 1.15;
    }
  }
  /** Płynne przewinięcie najbliższego przewijalnego kontenera, tak by element był w kadrze (ok. 38% wysokości). */
  async reveal(sel, frac = 0.38, dur = 0.7) {
    const plan = await this.p.evaluate(([s, frac]) => {
      const e = document.querySelector(s); if (!e) return null;
      let sc = e.parentElement;
      while (sc && sc !== document.body) { const cs = getComputedStyle(sc); if (/(auto|scroll)/.test(cs.overflowY) && sc.scrollHeight > sc.clientHeight + 2) break; sc = sc.parentElement; }
      const win = !sc || sc === document.body;
      const b = e.getBoundingClientRect(), vh = win ? innerHeight : sc.clientHeight, top0 = win ? 0 : sc.getBoundingClientRect().top;
      const rel = b.top - top0, cur = win ? scrollY : sc.scrollTop, max = (win ? document.documentElement.scrollHeight - innerHeight : sc.scrollHeight - sc.clientHeight);
      if (rel > 80 && rel + Math.min(b.height, vh * 0.5) < vh - 70) return { skip: true };
      const to = Math.max(0, Math.min(max, cur + rel - vh * frac));
      window.__sc = win ? null : sc;
      return { from: cur, to };
    }, [sel, frac]).catch(() => null);
    if (!plan || plan.skip || Math.abs(plan.to - plan.from) < 4) return;
    await this.scrollAnim(plan.from, plan.to, dur);
  }
  async scrollBy(dy, dur = 0.8) {
    const from = await this.p.evaluate(() => { window.__sc = null; return scrollY; });
    const max = await this.p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await this.scrollAnim(from, Math.max(0, Math.min(max, from + dy)), dur);
  }
  async scrollTop(dur = 0.6) { const from = await this.p.evaluate(() => { window.__sc = null; return scrollY; }); if (from > 2) await this.scrollAnim(from, 0, dur); }
  async scrollAnim(from, to, dur) {
    this.cutOverlays();
    const steps = Math.max(8, Math.round(dur * 30));
    for (let k = 1; k <= steps; k++) {
      const u = k / steps, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      await this.p.evaluate(y => { if (window.__sc) window.__sc.scrollTop = y; else window.scrollTo(0, y); }, from + (to - from) * e);
      this.T += dur / steps; await this.shot();
    }
    await this.settle(120); await this.shot();
  }
  cutOverlays() { for (const e of this.ev) if ((e.type === "arrow" || e.type === "box") && e.t1 > this.T) e.t1 = Math.max(e.t0 + 0.3, this.T); }
  /** Ruch kursora do elementu (płynny, krzywa Béziera w montażu). */
  async move(sel, opt = {}) {
    if (opt.reveal !== false) await this.reveal(sel);
    const r = await this.rect(sel); if (!r) return null;
    const x = r.x + r.w * (opt.fx ?? 0.5), y = r.y + r.h * (opt.fy ?? 0.5);
    const dur = (opt.dur ?? 0.75) * this.k;
    this.ev.push({ t: +this.T.toFixed(3), type: "move", x: Math.round(x), y: Math.round(y), d: dur });
    this.T += dur;
    await this.p.hover(sel, { timeout: 1500 }).catch(() => {}); await this.settle(120); await this.shot();
    return r;
  }
  async click(sel, opt = {}) {
    const r = await this.move(sel, opt); if (!r) return false;
    this.ev.push({ t: +this.T.toFixed(3), type: "click" });
    this.T += 0.12;
    try { await this.p.click(sel, { timeout: 2500, position: opt.pos }); } catch (e) { this.miss.push("click " + sel); }
    await this.settle(opt.settle ?? 380); await this.shot(); this.T += 0.25 * this.k;
    return true;
  }
  async tick(id) { return this.click(`label.opt:has(#${id})`, { fx: 0.12 }); }
  /** Zaznacza opcję tylko wtedy, gdy nie jest zaznaczona (w przeciwnym razie sam ruch kursora). */
  async on(id) {
    const checked = await this.p.evaluate(i => { const e = document.getElementById(i); return e ? e.checked : null; }, id).catch(() => null);
    if (checked === null) { this.miss.push("on " + id); return; }
    if (checked) return this.move(`label.opt:has(#${id})`, { fx: 0.12 });
    return this.tick(id);
  }
  /** Wpisywanie znak po znaku (ok. 14 znaków/s), na koniec Tab — tak jak w pracy. */
  async type(sel, text, opt = {}) {
    if (!(await this.click(sel, { settle: 150 }))) return;
    await this.p.fill(sel, "").catch(() => {});
    const cps = (opt.cps ?? 14) / this.k, step = Math.max(1, Math.round(text.length / 18));
    for (let i = 0; i < text.length; i += step) {
      await this.p.keyboard.type(text.slice(i, i + step));
      this.T += step / cps; await this.shot();
    }
    if (opt.tab !== false) { await this.p.keyboard.press("Tab"); await this.settle(200); this.T += 0.15; await this.shot(); }
  }
  /** Uzupełnienie pola bez animacji (pola drugorzędne — żeby nie wydłużać pokazu). */
  async quiet(sel, v) { try { await this.p.fill(sel, v); await this.p.press(sel, "Tab"); } catch (e) { this.miss.push("quiet " + sel); } await this.settle(60); }
  async select(sel, value, opt = {}) {
    // bez prawdziwego kliknięcia: natywna lista <select> w Chromium blokuje zrzut ekranu
    const r = await this.move(sel, opt); if (!r) return;
    this.ev.push({ t: +this.T.toFixed(3), type: "click" }); this.T += 0.12;
    await this.p.focus(sel).catch(() => {});
    try { await this.p.selectOption(sel, value); } catch (e) { this.miss.push("select " + sel); }
    await this.settle(opt.settle ?? 300); this.T += 0.35; await this.shot();
  }
  /** Jaskrawa strzałka z podpisem (rysowana w montażu). side: strona elementu, z której przychodzi strzałka. */
  async arrow(sel, label, opt = {}) {
    const r = await this.rect(sel); if (!r) return;
    this.ev.push({ type: "arrow", t0: +this.T.toFixed(3), t1: +(this.T + (opt.dur ?? 3.2)).toFixed(3), r, label, color: opt.color || C.pink, side: opt.side || "auto", cam: opt.cam !== false });
    if (opt.hold) this.T += opt.hold;
  }
  async box(sel, opt = {}) {
    const r = await this.rect(sel); if (!r) return;
    this.ev.push({ type: "box", t0: +this.T.toFixed(3), t1: +(this.T + (opt.dur ?? 3)).toFixed(3), r, color: opt.color || C.orange, label: opt.label || "", cam: opt.cam !== false });
    if (opt.hold) this.T += opt.hold;
  }
  async go(route) { await this.p.evaluate(x => { location.hash = "#/" + x; }, route); await this.settle(650); await this.p.evaluate(() => window.scrollTo(0, 0)); }
  /** Menu: krótkie podświetlenie pozycji, kliknięcie (kamera nie zbliża się do menu). */
  async nav(id) {
    const sel = `#nav [data-nav="${id}"]`;
    await this.move(sel, { fx: 0.35 });
    await this.box(sel, { color: C.lime, dur: 1.1, cam: false });
    this.T += 0.35;
    this.ev.push({ t: +this.T.toFixed(3), type: "click" }); this.T += 0.12;
    try { await this.p.click(sel, { timeout: 2500 }); } catch (e) { this.miss.push("nav " + id); }
    await this.p.evaluate(() => window.scrollTo(0, 0)); await this.settle(650); await this.shot(); this.T += 0.45;
  }
  async closeModals() { for (let i = 0; i < 4; i++) { if (!(await this.p.$(".scrim"))) break; await this.p.keyboard.press("Escape"); await this.settle(200); } }
  save() {
    const S = this.ch.sentences.length, shifts = [];
    let cur = 0; for (let i = 0; i < S; i++) { if (this.shiftAt[i] !== undefined) cur = this.shiftAt[i]; shifts.push(+cur.toFixed(3)); }
    const voiceEnd = this.ch.voiceDur + (shifts.length ? shifts[S - 1] : 0);
    const endT = Math.max(this.T, ...this.ev.map(e => e.t1 || e.t || 0));
    if (this.miss.length) console.log(`  ! brak elementów:`, [...new Set(this.miss)].join(" | "));
    fs.writeFileSync(path.join(this.dir, "events.json"), JSON.stringify({ no: this.ch.no, shifts, voiceEnd: +voiceEnd.toFixed(3), endT: +endT.toFixed(3), events: this.ev }, null, 0));
    const added = shifts.length ? shifts[S - 1] : 0;
    console.log(`  rozdział ${this.ch.no}: ${this.n} klatek, akcje do ${endT.toFixed(1)} s, lektor ${this.ch.voiceDur.toFixed(1)} s + pauzy ${added.toFixed(1)} s` + (Object.keys(this.shiftAt).length ? ` (przed zdaniami ${Object.entries(this.shiftAt).map(([i, v]) => i + ": +" + v.toFixed(1)).join(", ")})` : ""));
  }
}

/* ======================= scenariusze rozdziałów (beat(i) = zdanie i lektora, script.json) ======================= */
const SCENES = {
  async 1(R, p) {   // Wstęp i logowanie (zdania 0–7)
    R.k = 0.9;
    await R.shot();
    await R.beat(0); await R.box(".auth-box", { color: C.cyan, dur: 4.5, label: "ResInvest ERP 3.10" });
    await R.beat(4); await R.arrow("#lg-login", "E-mail służbowy", { color: C.pink, side: "left", dur: 2.4 });
    await R.type("#lg-login", "magazyn@resinvest.group", { tab: false });
    await R.arrow("#lg-pass", "Hasło", { color: C.orange, side: "left", dur: 1.8 });
    await R.type("#lg-pass", "demo1234", { tab: false, cps: 10 });
    await R.box("#lg-submit", { color: C.lime, dur: 1.6, label: "Zaloguj" });
    await R.click("#lg-submit", { settle: 1400 });
    await p.waitForSelector("#nav .nav-item", { timeout: 8000 }).catch(() => {});
    await R.settle(400); await R.shot();
    await R.beat(5); await R.tour([["#wh-chip", "Twój magazyn", C.orange], ["#lang-btn", "Język", C.cyan], ["#theme-btn", "Motyw „Perła”", C.pink]], { dur: 2.2, gap: 1.6 });
    await R.beat(6); await R.arrow("#sb-foot", "OFFLINE — jedno stanowisko", { color: C.violet, side: "right", dur: 4.5 });
    await R.beat(7); await R.move("#user-btn", { fx: 0.5 });
    await R.arrow("#user-btn", "Mój profil: zmiana hasła", { color: C.pink, dur: 4 });
  },
  async 2(R, p) {   // Pulpit i nawigacja (0–8)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.box("#kpis", { color: C.cyan, dur: 2.6, label: "Pulpit magazynu" });
    await R.beat(1); await R.move("#kpi-wood"); await R.box("#kpi-wood", { color: C.orange, dur: 2.2, label: "Drewno [m³]" }); R.wait(1.6);
    await R.move("#kpi-chip"); await R.box("#kpi-chip", { color: C.lime, dur: 2.2, label: "Zrębka [MP]" }); R.wait(1.6);
    await R.move("#kpi-ton"); await R.box("#kpi-ton", { color: C.pink, dur: 2.4, label: "≈ tony · GJ" });
    await R.beat(2); await R.reveal("#dash-turnover", 0.25); await R.box("#dash-turnover", { color: C.cyan, dur: 2.8, label: "Obroty wg rodzaju operacji" }); R.wait(2);
    await R.reveal("#dash-trend", 0.25); await R.arrow("#dash-trend", "Sprzedaż i zakupy — ostatnie miesiące", { color: C.orange, dur: 3 });
    await R.beat(3); await R.scrollTop(); await R.box("#nav", { color: C.lime, dur: 3.2, label: "Praca · Ewidencja · Kartoteki · System" });
    for (const id of ["operacje", "stany", "flota", "uzytkownicy"]) await R.move(`#nav [data-nav="${id}"]`, { fx: 0.3, dur: 0.6 });
    await R.beat(4); await R.tour([["#wh-chip", "Magazyn", C.orange], ["#lang-btn", "Język", C.cyan], ["#theme-btn", "Motyw", C.pink], ["#bell-btn", "Powiadomienia", C.violet]], { dur: 1.7, gap: 1.0 });
    await R.beat(5); await R.reveal("#kpi-wood"); await R.arrow("#kpi-wood svg, #kpi-wood", "Linia z ostatnich 30 dni", { color: C.pink, dur: 3.5 });
    await R.beat(6); await R.reveal("#kpi-purchase", 0.3); await R.box("#kpi-purchase", { color: C.orange, dur: 1.8, label: "Zakupy" }); R.wait(1.2);
    await R.box("#kpi-sales", { color: C.lime, dur: 1.8, label: "Sprzedaż" }); R.wait(1.2);
    await R.box("#kpi-prod", { color: C.cyan, dur: 1.8, label: "Produkcja" }); R.wait(1.2);
    await R.reveal("#dash-mode", 0.3); await R.move("#dash-mode"); await R.arrow("#dash-mode", "Okres: dzień · miesiąc · zakres", { color: C.pink, dur: 2.8 });
    await R.beat(7); await R.scrollTop(); await R.move("#top-new"); await R.arrow("#top-new", "Nowa operacja — zawsze pod ręką", { color: C.lime, dur: 3 });
    await R.beat(8); await R.click("#bell-btn", { settle: 700 }); await R.wait(2.4);
    await R.closeModals(); await p.keyboard.press("Escape"); await R.settle(250); await R.shot();
  },
  async 3(R, p) {   // Kartoteki (0–7)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.box("#nav", { color: C.lime, dur: 2.4, label: "Kartoteki", cam: false }); R.wait(0.6); await R.nav("produkty");
    await R.beat(1); await R.col("#products-table", 4, "Jednostka magazynowa", { color: C.orange });
    await R.col("#products-table", 8, "Przeliczniki", { color: C.pink });
    await R.arrow("#products-table tbody tr:first-child", "1 m³ drewna = 4 MP zrębki", { color: C.lime, dur: 3.2 });
    await R.beat(2); await R.nav("kontrahenci"); await R.col("#partners-table", 2, "Dostawca · odbiorca", { color: C.cyan });
    await R.col("#partners-table", 3, "Grupa: nadleśnictwo / firma", { color: C.orange });
    await R.beat(3); await R.nav("magazyny"); await R.box("main .grid", { color: C.lime, dur: 3.6, label: "Place firmy" });
    await R.beat(4); await R.nav("produkty"); await R.col("#products-table", 6, "Masa ≈ t / jedn.", { color: C.orange });
    await R.col("#products-table", 7, "Energia ≈ GJ / jedn.", { color: C.cyan });
    await R.beat(5); await R.col("#products-table", 6, "Kwit wagowy ma pierwszeństwo", { color: C.pink, dur: 3.2 });
    await R.beat(6); await R.nav("kontrahenci"); await R.type("#pa-q", "Nadleśnictwo", { cps: 12, tab: false }); await R.settle(300); await R.shot();
    await R.arrow("#partners-table tbody tr:first-child", "Nadleśnictwo z leśnictwami", { color: C.lime, dur: 3.2 });
    await R.beat(7); await R.nav("dodatkowe"); await R.col("#extra-types-table", 2, "Holowanie · ładowarka · plac", { color: C.orange });
    await R.col("#extra-types-table", 5, "Stawka domyślna", { color: C.pink });
  },
  async 4(R, p) {   // Flota (0–7)
    R.k = 0.8;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("flota");
    await R.tour([['[data-tab="vehicles"]', "Samochody", C.orange], ['[data-tab="drivers"]', "Kierowcy", C.cyan], ['[data-tab="chippers"]', "Rębaki", C.lime], ['[data-tab="operators"]', "Operatorzy", C.pink]], { dur: 1.5, gap: 0.8, cam: false });
    await R.box("#fleet-scope", { color: C.violet, dur: 2.6, label: "Flota własna / firm zewnętrznych" });
    await R.beat(1); await R.click("#fleet-add", { settle: 600 });
    await R.type("#fe-name", "MAN TGS — hakowiec");
    await R.type("#fe-reg", "SK 4411H");
    await R.select("#fe-driverId", "dr_nowak");
    await R.beat(2); await R.arrow("#fe-body", "Zabudowa", { color: C.pink, side: "left", dur: 2.6 });
    await R.select("#fe-body", "hakowiec", { settle: 500 });
    await R.beat(3); await R.arrow("#fe-comp-0-l", "Długość × szerokość × wysokość", { color: C.orange, dur: 3 });
    for (const [i, l] of [[0, "6,5"], [1, "7"]]) { await R.type(`#fe-comp-${i}-l`, l, { cps: 8 }); await R.type(`#fe-comp-${i}-w`, "2,4", { cps: 8 }); await R.type(`#fe-comp-${i}-h`, "2,5", { cps: 8 }); }
    await R.box("#fe-cap", { color: C.lime, dur: 3.2, label: "Pojemność: 81 MP" });
    await R.beat(4); await R.click(".modal [data-yes]", { settle: 700 });
    await R.col("#fleet-table", 4, "Pojemność", { color: C.orange, dur: 3 });
    await R.beat(5); await R.tab('[data-tab="ext_vehicles"]', "Samochody firm zewnętrznych");
    await R.box("#fleet-table", { color: C.cyan, dur: 3.2, label: "Firma + kierowca opisowo" });
    await R.beat(6); await R.tab('[data-tab="vehicles"]', "Samochody własne", { color: C.orange });
    await R.col("#fleet-table", 4, "6,5 × 2,4 × 2,5 + 7 × 2,4 × 2,5 = 81 MP", { color: C.pink, dur: 3.6 });
    await R.beat(7); await R.tab('[data-tab="chippers"]', "Rębaki własne", { color: C.lime });
    await R.box("#fleet-table", { color: C.orange, dur: 3.4, label: "Własny / wynajęty · operator domyślny" });
  },
  async 5(R, p) {   // Zakup z produkcją w lesie (0–10)
    R.k = 0.7;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.click("#top-new", { settle: 700 });
    await R.arrow("#f-type-ZAKUP", "Rodzaj: Zakup", { color: C.orange, dur: 2 });
    await R.click('label.opt:has(#f-type-ZAKUP)', { fx: 0.2 });
    await R.beat(1); await R.arrow("#f-production-enabled", "Produkcja z automatycznym zużyciem", { color: C.pink, side: "right", dur: 2.6 });
    await R.tick("f-production-enabled");
    await R.beat(2); await R.tick("f-skind-nadlesnictwo");
    await R.arrow("#f-purchase-basis", "Podstawa: deklaracja (sama)", { color: C.orange, dur: 2.6 });
    await R.type("#f-purchase-supplierName", "Nadleśnictwo Rudy Raciborskie", { cps: 18 });
    await R.type("#f-purchase-lesnictwo", "Stanica");
    await R.beat(3); await R.arrow("#f-date", "Data przyjęcia", { color: C.pink, dur: 2 });
    await R.type("#f-purchase-qty", "30", { cps: 6 }); await R.type("#f-purchase-price", "230", { cps: 6 });
    await R.arrow("#sum-errs, #sum-badge", "Kontrola — czerwona, dopóki czegoś brakuje", { color: C.pink, side: "left", dur: 3.2 });
    await R.beat(4); await R.reveal("#f-production-chipperId");
    await R.select("#f-production-chipperId", "ch_jenz", { settle: 500 });
    await R.quiet("#f-production-ndl", "Rudy Raciborskie");
    await R.arrow("#f-production-outQty", "Wyliczona zrębka [MP]", { color: C.lime, dur: 2.4 });
    await R.arrow("#f-production-chipCost", "Koszt rąbania", { color: C.orange, dur: 2.2 });
    await R.beat(5); await R.tick("f-mode-own");
    await R.type("#f-transport-own-runCount", "3", { cps: 5 });
    for (let i = 0; i < 3; i++) {
      await R.select(`#f-transport-own-runs-${i}-vehicleId`, ["ve_scania", "ve_volvo", "ve_scania"][i]);
      if (i === 0) { await R.type(`#f-transport-own-runs-${i}-kwit`, `KW 0612/${i + 1}`, { cps: 18 }); await R.type(`#f-transport-own-runs-${i}-kwitM3`, "10", { cps: 8 }); }
      else { await R.quiet(`#f-transport-own-runs-${i}-kwit`, `KW 0612/${i + 1}`); await R.quiet(`#f-transport-own-runs-${i}-kwitM3`, "10"); }
      await R.quiet(`#f-transport-own-runs-${i}-km`, "45");
    }
    await R.reveal("#runs-summary", 0.3); await R.shot(); await R.box("#runs-summary", { color: C.orange, dur: 3.4, label: "m³ × 4 = MP na aucie · zapełnienie [%]" });
    await R.beat(6); await R.arrow("#summary .btn.primary", "Zatwierdź", { color: C.lime, side: "left", dur: 2.2 });
    await R.click("#summary .btn.primary", { settle: 800 });
    await R.box("#confirm-op", { color: C.cyan, dur: 3, label: "Podsumowanie: stany i koszt" });
    await R.click("#confirm-yes", { settle: 1200 });
    await R.box("#op-detail .modal-h", { color: C.pink, dur: 3.2, label: "Numer z serii WZ" });
    await R.beat(7); await R.closeModals(); await R.go("nowa"); await R.shot();
    await R.on("f-type-ZAKUP"); await R.on("f-skind-nadlesnictwo");
    await R.arrow("#f-purchase-supplierName", "Podpowiedzi z kartoteki", { color: C.cyan, dur: 3 });
    await R.beat(8); await R.on("f-production-enabled"); await R.reveal("#f-production-diffReason");
    await R.arrow("#f-production-consumeQty", "Ilość rzeczywista", { color: C.orange, dur: 2.4 });
    await R.arrow("#f-production-diffReason", "Przyczyna różnicy", { color: C.pink, dur: 2.6 });
    await R.beat(9); await R.on("f-mode-own"); await R.reveal("#runs-summary", 0.3); await R.shot();
    await R.box("#runs-summary", { color: C.lime, dur: 3.4, label: "Ile zostało do rozwiezienia" });
    await R.beat(10); await R.reveal("#summary", 0.2); await R.arrow("#summary .btn.mt2", "Zapisz jako roboczy", { color: C.violet, side: "left", dur: 3.4 });
  },
  async 6(R, p) {   // Sprzedaż i transport kilku firm (0–8)
    R.k = 0.7;
    await R.go("pulpit"); await R.go("nowa?preset=wz"); await R.shot();
    await R.beat(0); await R.arrow("#f-sale-productId", "Tylko towary na stanie — z ilością", { color: C.orange, dur: 2.8 });
    await R.select("#f-sale-productId", "pr_zr_lesna");
    await R.box("#f-sale-onStock", { color: C.lime, dur: 2.4, label: "Na stanie" });
    await R.beat(1); await R.select("#f-sale-buyerId", "pa_ec_zab");
    await R.type("#f-sale-qty", "120", { cps: 6 }); await R.type("#f-sale-price", "92", { cps: 6 });
    await R.arrow("#f-sale-weightMode", "Tonaż: AUTO albo z kwitu", { color: C.pink, dur: 2.6 });
    await R.beat(2); await R.tick("f-mode-external");
    await R.arrow("#f-transport-external-companyCount", "Liczba firm do transportu", { color: C.pink, side: "left", dur: 2.6 });
    await R.select("#f-transport-external-companyCount", "2", { settle: 400 });
    await R.type("#f-transport-external-runCount", "3", { cps: 5 });
    await R.beat(3);
    const co = ["ESI Logistics", "ESI Logistics", "DAP Trans"], reg = ["ESI 18734", "ESI 20511", "SZA 7K901"];
    for (let i = 0; i < 3; i++) {
      if (i === 0) { await R.type(`#f-transport-external-runs-${i}-company`, co[i], { cps: 18 }); await R.type(`#f-transport-external-runs-${i}-reg`, reg[i], { cps: 16 }); await R.type(`#f-transport-external-runs-${i}-qty`, "40", { cps: 8 }); }
      else { await R.quiet(`#f-transport-external-runs-${i}-company`, co[i]); await R.quiet(`#f-transport-external-runs-${i}-reg`, reg[i]); await R.quiet(`#f-transport-external-runs-${i}-qty`, "40"); }
      await R.quiet(`#f-transport-external-runs-${i}-km`, String(26 + i * 4));
    }
    await R.shot();
    await R.beat(4); await R.reveal("#runs-summary", 0.3); await R.shot(); await R.box("#runs-summary", { color: C.orange, dur: 4, label: "Przewoźnik · ilość · km · koszt · zapełnienie" });
    await R.beat(5); await R.arrow("#f-transport-external-companyCount", "Jedna firma → wpisujesz raz", { color: C.cyan, side: "left", dur: 3 });
    await R.beat(6); await R.click("#summary .btn.primary", { settle: 800 });
    await R.click("#confirm-yes", { settle: 1200 }); await R.wait(1.2);
    await R.beat(7); await R.closeModals(); await R.go("nowa?preset=wz"); await R.shot();
    await R.select("#f-sale-productId", "pr_zr_lesna"); await R.tick("f-mode-own");
    await R.type("#f-transport-own-runCount", "1", { cps: 5 }); await R.select("#f-transport-own-runs-0-vehicleId", "ve_scania");
    await R.type("#f-transport-own-runs-0-qty", "150", { cps: 8 });
    await R.reveal("#runs-summary", 0.3); await R.shot(); await R.box("#runs-summary", { color: C.pink, dur: 3.2, label: "Ładunek ponad pojemność — ostrzeżenie" });
    await R.beat(8); await R.go("nowa?preset=bezposrednia"); await R.shot();
    await R.box('label.opt:has(#f-sale-direct)', { color: C.lime, dur: 3.6, label: "Sprzedaż bezpośrednia z lasu" });
  },
  async 7(R, p) {   // Produkcja na magazynie i operacje dodatkowe (0–5)
    R.k = 0.75;
    await R.go("pulpit"); await R.go("nowa?preset=produkcja"); await R.shot();
    await R.beat(0); await R.box("#f-type-PRODUKCJA, label.opt:has(#f-type-PRODUKCJA)", { color: C.orange, dur: 2.4, label: "Produkcja na magazynie" });
    await R.beat(1); await R.arrow("#f-production-rawProductId", "Surowiec ze stanu", { color: C.orange, dur: 2.4 });
    await R.box("#f-production-stock", { color: C.lime, dur: 2.2, label: "Stan surowca" });
    await R.select("#f-production-outProductId", "pr_zr_lesna");
    await R.type("#f-production-outQty", "200", { cps: 6 });
    await R.arrow("#f-production-consume", "Zużycie drewna liczy się samo", { color: C.pink, dur: 2.8 });
    await R.beat(2); await R.tick("f-extras-enabled");
    await R.select("#f-extras-items-0-typeId", "xt_holowanie");
    await R.type("#f-extras-items-0-cost", "500", { cps: 6 });
    await R.arrow("#money, #sum-money", "Koszt w wyniku operacji", { color: C.pink, side: "left", dur: 2.8 });
    await R.beat(3); await R.reveal("#f-production-chipperId"); await R.select("#f-production-chipperId", "ch_jenz", { settle: 500 });
    await R.arrow("#f-production-chipperId", "Rębak i operator", { color: C.cyan, dur: 2.6 });
    await R.beat(4); await R.arrow("#f-production-chipRate", "Stawka za MP", { color: C.orange, dur: 2.4 });
    await R.box("#f-production-chipCost", { color: C.lime, dur: 2.4, label: "Koszt rąbania" });
    await R.beat(5); await R.reveal("#summary", 0.2); await R.box("#sum-bal, #sum-flow", { color: C.cyan, dur: 3, label: "+ zrębka · − drewno: w całości albo wcale" });
    await R.click("#summary .btn.primary", { settle: 800 }); await R.wait(0.8);
    await R.click("#confirm-yes", { settle: 1200 }); await R.wait(1.2); await R.closeModals(); await R.shot();
  },
  async 8(R, p) {   // MM (0–5)
    R.k = 0.8;
    await R.go("pulpit"); await R.go("nowa?preset=mm"); await R.shot();
    await R.beat(0); await R.box("#f-type-MM, label.opt:has(#f-type-MM)", { color: C.orange, dur: 2.6, label: "MM — stan firmy bez zmian" });
    await R.beat(1); await R.arrow("#f-mm-fromWhId", "Magazyn źródłowy", { color: C.orange, dur: 2.2 });
    await R.select("#f-mm-toWhId", "wh_bra");
    await R.select("#f-mm-productId", "pr_zr_lesna");
    await R.type("#f-mm-qty", "60", { cps: 6 });
    await R.click("#summary .btn.primary", { settle: 800 }); await R.wait(0.6);
    await R.click("#confirm-yes", { settle: 1200 }); await R.wait(0.8); await R.closeModals();
    await R.nav("mm"); await R.col("#docs-table", 10, "Status: W DRODZE", { color: C.pink, dur: 3 });
    await R.beat(2); await R.arrow("#docs-table tbody tr:first-child", "Magazyn docelowy: „Przyjmij MM”", { color: C.lime, dur: 3.4 });
    await R.col("#docs-table", 11, "Akcje", { color: C.cyan, dur: 2.4 });
    await R.beat(3); await R.go("nowa?preset=mm"); await R.shot(); await R.arrow("#f-mm-weightMode", "Tonaż z wagi albo AUTO", { color: C.cyan, dur: 3 });
    await R.beat(4); await R.reveal("#h-tr", 0.25); await R.box("#h-tr", { color: C.orange, dur: 3.2, label: "Transport: własny · zewnętrzny · kolej" });
    await R.beat(5); await R.go("administracja"); await R.shot(); await R.reveal("#cfg-mmmode", 0.35); await R.arrow("#cfg-mmmode", "MM jedno- albo dwuetapowe", { color: C.violet, dur: 3.4 });
  },
  async 9(R, p) {   // Korekta, anulowanie, historia (0–6)
    R.k = 0.85;
    await R.go("operacje"); await R.shot();
    await R.beat(0); await R.box("#ops-table", { color: C.cyan, dur: 2.6, label: "Niczego się nie wymazuje" });
    await R.beat(1); await R.click("#ops-table tbody tr:first-child", { settle: 700 });
    await R.arrow("#op-detail [data-correct]", "Koryguj", { color: C.orange, dur: 2.2 });
    await R.click("#op-detail [data-correct]", { settle: 900 });
    await R.reveal("#corr-reason"); await R.select("#corr-reason", { index: 1 });
    await R.beat(2); await R.reveal("#corr-preview", 0.25); await R.box("#corr-preview", { color: C.pink, dur: 4, label: "BYŁO / JEST — księgowana tylko różnica" });
    await R.beat(3); await R.closeModals(); await R.go("operacje"); await R.shot();
    await R.click("#ops-table tbody tr:nth-child(2)", { settle: 700 });
    await R.arrow("#op-detail [data-cancel]", "Anuluj — odwraca ruchy nowym wpisem", { color: C.pink, dur: 3.2 });
    await R.beat(4); await R.closeModals(); await R.nav("historia");
    await R.col("#hist-table", 10, "Stan przed", { color: C.orange, dur: 2 }); await R.col("#hist-table", 11, "Zmiana", { color: C.pink, dur: 2 }); await R.col("#hist-table", 12, "Stan po", { color: C.lime, dur: 2 });
    await R.scrollTop(0.4); await R.tour([["#h-user", "Użytkownik", C.cyan], ["#h-partner", "Kontrahent", C.orange], ["#h-type", "Rodzaj ruchu", C.pink]], { dur: 1.6, gap: 0.9 });
    await R.beat(5); await R.go("operacje"); await R.shot(); await R.click("#ops-table tbody tr:first-child", { settle: 700 });
    await R.reveal("#op-events", 0.3); await R.box("#op-events", { color: C.cyan, dur: 3.4, label: "Korekta: numer · autor · data" });
    await R.beat(6); await R.reveal("#op-delete-btn", 0.4); await R.arrow("#op-delete-btn", "Usunięcie — oznaczenie z przyczyną", { color: C.pink, dur: 3.4 });
    await R.wait(0.8); await R.closeModals();
  },
  async 10(R, p) {  // Dokumenty (0–5)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("dokumenty"); await R.col("#docs-table", 1, "Jedna seria WZ", { color: C.orange, dur: 3 });
    await R.col("#docs-table", 2, "Rodzaj ruchu", { color: C.cyan, dur: 2.2 });
    await R.beat(1); await R.tour([["#r-ym", "Miesiąc", C.cyan], ["#r-status", "Status", C.orange], ["#r-q", "Kontrahent", C.pink]], { dur: 1.6, gap: 0.9 });
    await R.beat(2); await R.click("#docs-table tbody tr:first-child [data-preview], #docs-table tbody tr:first-child button", { settle: 900 });
    await R.wait(0.8); await R.box(".modal", { color: C.pink, dur: 3, label: "Podgląd · PDF · e-mail" }); await R.wait(1.6); await R.closeModals();
    await R.beat(3); await R.go("nowa?preset=wz"); await R.shot(); await R.reveal("#f-docNoMode-WZ", 0.4);
    await R.arrow("#f-docNoMode-WZ", "Numer ręczny — bez powtórzeń", { color: C.orange, dur: 3 });
    await R.beat(4); await R.nav("dokumenty"); await R.arrow("#r-aux", "Pokaż dokumenty pomocnicze", { color: C.lime, dur: 2.4 });
    await R.click("#r-aux", { settle: 600 });
    await R.beat(5); await R.scrollTop(0.4); await R.tour([["#reg-csv", "CSV ewidencji", C.orange], ["#reg-xlsx", "Excel", C.lime]], { dur: 2.2, gap: 1.4 });
  },
  async 11(R, p) {  // Stany i inwentaryzacja (0–5)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("stany"); await R.col("main table", 3, "Stan w jednostce magazynowej", { color: C.orange, dur: 2.6 });
    await R.move("#st-to"); await R.arrow("#st-to", "Stan na dowolny dzień", { color: C.pink, dur: 2.6 });
    await R.beat(1); await R.nav("inwentaryzacja"); await R.box("#inv-grid", { color: C.cyan, dur: 3.6, label: "Spis z natury → różnice → zamknięcie" });
    await R.beat(2); await R.arrow("#inv-ym", "Zamknięty miesiąc jest chroniony", { color: C.pink, dur: 3.4 });
    await R.beat(3); await R.nav("stany"); await R.col("main table", 4, "≈ tony", { color: C.lime, dur: 2.2 }); await R.col("main table", 5, "≈ GJ", { color: C.cyan, dur: 2.2 });
    await R.beat(4); await R.nav("inwentaryzacja"); await R.arrow("#inv-open", "Inwentaryzacja w dowolnym dniu", { color: C.orange, dur: 3 });
    await R.beat(5); await R.nav("stany"); await R.col("main table", 6, "Stany wynikają z dokumentów", { color: C.violet, dur: 3 });
  },
  async 12(R, p) {  // Raporty i ewidencja CSV (0–5)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("raporty"); await R.tour([["#r-mode", "Miesiąc albo rok", C.orange], ["#r-wh", "Magazyn · produkt · kontrahent", C.cyan]], { dur: 1.6, gap: 0.6 });
    await R.beat(1); await R.col("#rep-recon", 3, "Stan pocz.", { color: C.cyan, dur: 1.8, hold: 0.9 });
    await R.col("#rep-recon", 4, "Zakup", { color: C.orange, dur: 1.6, hold: 0.7 }); await R.col("#rep-recon", 7, "Sprzedaż", { color: C.lime, dur: 1.6, hold: 0.7 });
    await R.col("#rep-recon", 11, "Stan końc.", { color: C.pink, dur: 1.8, hold: 0.9 }); await R.col("#rep-recon", 14, "Kontrola = księga ruchów", { color: C.lime, dur: 2.8 });
    await R.beat(2); await R.scrollTop(0.5); await R.arrow("#rep-csv", "PDF · Excel · Word", { color: C.cyan, dur: 2.4 }); R.wait(1.4);
    await R.move("#rep-trade"); await R.arrow("#rep-trade", "CSV ewidencji obrotu", { color: C.pink, dur: 3 });
    await R.beat(3); await R.select("#r-mode", "year", { settle: 900 }); await R.box("#rep-recon", { color: C.orange, dur: 3.4, label: "Rok: każdy miesiąc w kolumnie" });
    await R.select("#r-mode", "month", { settle: 900 });
    await R.beat(4); await R.reveal("#rep-transport", 0.3); await R.col("#rep-transport", 1, "Przewoźnik / auto", { color: C.cyan, dur: 2.4 }); await R.col("#rep-transport", 4, "Koszt transportu", { color: C.orange, dur: 2.4 });
    await R.beat(5); await R.scrollTop(0.5); await R.arrow("#rep-title", "Raport e-mailem — PDF w załączniku", { color: C.violet, dur: 3.2 });
  },
  async 13(R, p) {  // Planer (0–5)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("planer"); await R.box("#pl-kpis", { color: C.cyan, dur: 3, label: "Plan ↔ wykonanie" });
    await R.beat(1); await R.col("#pl-week-table", 2, "Plan [MP] — wpisujesz", { color: C.orange, dur: 2.2 });
    await R.type("#plan-2026-09-25", "80", { cps: 5 });
    await R.col("#pl-week-table", 3, "Wykonanie — z dokumentów", { color: C.lime, dur: 2.4 }); await R.col("#pl-week-table", 5, "Tony", { color: C.cyan, dur: 1.6, hold: 0.8 }); await R.col("#pl-week-table", 10, "Kursy", { color: C.pink, dur: 1.8 });
    await R.beat(2); await R.tab('[data-plview="year"]', "Miesiące i rok", { color: C.cyan, settle: 800 }); await R.box("main .card, #pl-year-table", { color: C.orange, dur: 3, label: "Realizacja miesiąc po miesiącu" });
    await R.beat(3); await R.tab('[data-plview="week"]', "Tydzień", { color: C.orange, settle: 700 }); await R.arrow("#pl-wh", "Plan dla każdego magazynu", { color: C.pink, dur: 2.8 });
    await R.beat(4); await R.box("#pl-k-real", { color: C.lime, dur: 3, label: "Realizacja do dzisiaj" });
    await R.beat(5); await R.tab('[data-plview="drivers"]', "Kierowcy i kursy", { color: C.lime, settle: 800 }); await R.box("main .card:last-child, #pl-drivers", { color: C.cyan, dur: 2.8, label: "Kto jeździł i ile kursów" });
    await R.tour([["#pl-csv", "CSV", C.orange], ["#pl-xlsx", "Excel", C.lime], ["#pl-pdf", "PDF", C.pink]], { dur: 1.4, gap: 0.7, cam: false });
  },
  async 14(R, p) {  // Raporty floty i rębaków (0–6)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("flota"); await R.tab('[data-tab="reports"]', "Raporty floty i rębaków", { color: C.orange, settle: 700 });
    await R.arrow("#fr-period", "Dzień · tydzień · miesiąc", { color: C.pink, dur: 2.2 }); await R.select("#fr-period", "month", { settle: 600 });
    await R.beat(1); await R.reveal("#fleet-rep", 0.3); await R.col("#fleet-rep", 1, "Pojazd", { color: C.cyan, dur: 1.8, hold: 0.8 });
    await R.col("#fleet-rep", 2, "Kursy", { color: C.orange, dur: 1.6, hold: 0.7 }); await R.col("#fleet-rep", 3, "MP", { color: C.lime, dur: 1.6, hold: 0.7 });
    await R.box("#fleet-rep", { color: C.pink, dur: 2.6, label: "Tony · km · koszt · zapełnienie" });
    await R.beat(2); await R.select("#fr-view", "runs", { settle: 600 }); await R.box("#fleet-rep", { color: C.pink, dur: 2.6, label: "Zapełnienie każdego kursu [%]" });
    await R.select("#fr-view", "drivers", { settle: 600 }); await R.box("#fleet-rep", { color: C.cyan, dur: 2.6, label: "Kierowcy: kursy · MP · tony" });
    await R.beat(3); await R.select("#fr-view", "chippers", { settle: 600 }); await R.col("#fleet-rep", 6, "Zrębka [MP]", { color: C.lime, dur: 2.2 });
    await R.select("#fr-view", "operators", { settle: 600 }); await R.col("#fleet-rep", 5, "Ile zrąbał operator [MP]", { color: C.orange, dur: 2.4 });
    await R.scrollTop(0.4); await R.tour([["#fr-csv", "CSV", C.orange], ["#fr-xlsx", "Excel", C.lime], ["#fr-pdf", "PDF", C.pink]], { dur: 1.3, gap: 0.6, cam: false });
    await R.beat(4); await R.select("#fr-view", "runs", { settle: 600 }); await R.reveal("#fleet-rep", 0.3); await R.box("#fleet-rep", { color: C.lime, dur: 3.6, label: "MP w kursie ÷ pojemność · > 85% zielony" });
    await R.beat(5); await R.box("#fleet-rep tbody", { color: C.pink, dur: 3, label: "Auta niedociążone" });
    await R.beat(6); await R.scrollTop(0.4); await R.arrow("#fl-wh", "Wybrany magazyn albo wszystkie", { color: C.violet, dur: 3 });
  },
  async 15(R, p) {  // Użytkownicy i administracja (0–5)
    R.k = 0.85;
    await R.go("pulpit"); await R.shot();
    await R.beat(0); await R.nav("uzytkownicy"); await R.col("#users-table", 3, "Rola", { color: C.orange, dur: 2.2 }); await R.col("#users-table", 4, "Magazyn", { color: C.cyan, dur: 2.2 });
    await R.beat(1); await R.nav("role"); await R.shot(); await R.box("#perm-table, #roles-grid", { color: C.cyan, dur: 3.2, label: "Kto wprowadza, zatwierdza, koryguje" });
    await R.beat(2); await R.nav("administracja"); await R.box("#access-card", { color: C.lime, dur: 2.6, label: "Numeracja · ustawienia" }); R.wait(1);
    await R.nav("audyt"); await R.col("#audit-admin-table", 2, "Kto", { color: C.orange, dur: 1.8, hold: 0.8 }); await R.col("#audit-admin-table", 9, "Przed / po", { color: C.pink, dur: 2.4 });
    await R.beat(3); await R.nav("uzytkownicy"); await R.col("#users-table", 5, "Ostatni administrator — chroniony", { color: C.pink, dur: 3.2 });
    await R.beat(4); await R.arrow("#user-add", "Zaproszenie e-mail", { color: C.lime, dur: 3 });
    await R.beat(5); await R.nav("administracja"); await R.arrow("#cfg-approval", "Obieg zatwierdzania", { color: C.orange, dur: 3.4 });
  },
  async 16(R, p) {  // Dobre praktyki i zakończenie (0–3)
    R.k = 0.9;
    await R.go("pulpit"); await R.p.evaluate(() => window.scrollTo(0, 0)); await R.shot();
    await R.beat(0); await R.move("#top-new"); await R.arrow("#top-new", "Operacja w dniu zdarzenia", { color: C.lime, dur: 3.2 });
    await R.beat(1); await R.move("#user-btn"); await R.arrow("#user-btn", "Każdy na własnym koncie", { color: C.cyan, dur: 3 });
    await R.beat(2); await R.move("#kpi-wood");
  }
};

(async () => {
  fs.mkdirSync(CAP, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, locale: "pl-PL", acceptDownloads: true });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("tut")) { localStorage.clear(); sessionStorage.setItem("tut", "1"); } localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); localStorage.setItem("riw.sample", "1"); localStorage.setItem("riw.theme", "pearl"); } catch (e) {} });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("dialog", d => { errs.push("dialog: " + d.message()); d.accept().catch(() => {}); });
  await p.clock.setFixedTime(new Date("2026-09-25T09:30:00"));
  await p.goto(APP); await p.waitForSelector("#login-form");
  // kursor przeglądarki ukryty — kursor rysuje montaż
  await p.addStyleTag({ content: "*{cursor:none!important} ::-webkit-scrollbar{width:10px;height:10px} ::-webkit-scrollbar-thumb{background:#c9d3cc;border-radius:6px}" });
  const login = async () => { if (await p.$("#login-form")) { await p.fill("#lg-login", "magazyn@resinvest.group"); await p.fill("#lg-pass", "demo1234"); await p.click("#lg-submit"); await p.waitForSelector("#nav .nav-item"); await p.waitForTimeout(500); } };
  for (const ch of TL.chapters) {
    if (ONLY.length && !ONLY.includes(ch.no)) { if (ch.no === 1) await login(); continue; }
    if (ch.no > 1) await login();
    const R = new Rec(p, ch);
    console.log(`Rozdział ${ch.no}: ${ch.title}`);
    try { await SCENES[ch.no](R, p); } catch (e) { console.log("  ! błąd:", e.message.split("\n")[0]); await R.shot(); }
    R.save();
  }
  console.log("błędy strony:", errs.length ? errs : "brak");
  await b.close();
})();
