/* Test E2E odtwarzania intro (prawdziwa ścieżka wideo + dźwięk + zwalnianie zasobów).
   Chromium z Playwright nie ma kodeka H.264 — test tworzy wariant programu z tym samym filmem w WebM (VP9 + Opus)
   i sprawdza ten sam kod intro.js. Wymaga ffmpeg: FFMPEG=/ścieżka/ffmpeg (bez niej test jest pomijany).
   Uruchomienie z katalogu resinvest-erp:  FFMPEG=ffmpeg NODE_PATH=$(npm root -g) node tests/e2e-intro.cjs */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
if (!process.env.FFMPEG) { console.log("POMINIĘTO: ustaw FFMPEG=<ścieżka do ffmpeg>"); process.exit(0); }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "riw-intro-"));
execFileSync(process.env.FFMPEG, ["-v", "error", "-y", "-i", path.join(ROOT, "app/assets/intro.mp4"), "-c:v", "libvpx-vp9", "-b:v", "1M", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-b:a", "96k", path.join(TMP, "intro.webm")]);
{
  let h = fs.readFileSync(path.join(ROOT, process.env.RIW_HTML || "ResInvest_ERP.html"), "utf8");
  const w = "data:video/webm;base64," + fs.readFileSync(path.join(TMP, "intro.webm")).toString("base64");
  const i = h.indexOf('var INTRO_SRC = "') + 'var INTRO_SRC = "'.length, j = h.indexOf('"', i);
  fs.writeFileSync(path.join(TMP, "app.html"), h.slice(0, i) + w + h.slice(j));
}
const FILE = "file://" + path.join(TMP, "app.html");
const results = [];
const ok = (n, c, d) => { results.push(!!c); console.log((c ? "✔ " : "✘ ") + n + (c ? "" : "  → " + JSON.stringify(d))); };
(async () => {
  for (const policy of ["no-user-gesture-required", "document-user-activation-required"]) {
    console.log("== autoplay:", policy);
    const b = await chromium.launch({ args: ["--autoplay-policy=" + policy] });
    const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); } catch (e) {} });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(FILE);
    await p.waitForFunction(() => { const v = document.querySelector("#splash video"); return v && v.currentTime > 0.3; }, null, { timeout: 8000 }).catch(() => {});
    const s = await p.evaluate(() => { const v = document.querySelector("#splash video"); return { t: +v.currentTime.toFixed(2), muted: v.muted, paused: v.paused, w: v.videoWidth, blob: v.src.startsWith("blob:"), audible: RIW_DEBUG.intro.audible, blocked: RIW_DEBUG.intro.blocked, playing: document.querySelector("#splash").classList.contains("is-playing") }; });
    if (policy === "no-user-gesture-required") ok("film gra z dźwiękiem od startu (obraz + audio jednym play)", s.t > 0.3 && !s.muted && !s.paused && s.w === 1280 && s.blob && s.audible, s);
    else ok("blokada dźwięku: film gra wyciszony + komunikat; gest włącza dźwięk", s.t > 0.3 && s.muted && s.blocked && await p.isVisible("[data-note]"), s);
    if (policy !== "no-user-gesture-required") { await p.mouse.click(600, 500); await p.waitForTimeout(400); const a = await p.evaluate(() => ({ muted: document.querySelector("#splash video").muted, audible: RIW_DEBUG.intro.audible })); ok("pierwsze kliknięcie włącza dźwięk", !a.muted && a.audible, a); }
    await p.click("[data-music]"); const m1 = await p.evaluate(() => ({ muted: document.querySelector("#splash video").muted, label: document.querySelector("[data-music]").textContent.trim(), st: document.querySelector("[data-music]").dataset.state }));
    ok("Wycisz → film wyciszony, przycisk „Wyłącz wyciszenie” (ikona stanu)", m1.muted && m1.label === "Wyłącz wyciszenie" && m1.st === "muted", m1);
    await p.click("[data-music]"); const m2 = await p.evaluate(() => ({ muted: document.querySelector("#splash video").muted, label: document.querySelector("[data-music]").textContent.trim() }));
    ok("Wyłącz wyciszenie → dźwięk wraca, przycisk „Wycisz”", !m2.muted && m2.label === "Wycisz", m2);
    if (policy === "no-user-gesture-required") {
      // naturalny koniec filmu → ekran logowania, zasoby zwolnione
      await p.evaluate(() => { const v = document.querySelector("#splash video"); v.currentTime = Math.max(0, v.duration - 0.3); });
      await p.waitForSelector("#splash", { state: "detached", timeout: 6000 });
    } else { await p.click("[data-skip]"); await p.waitForSelector("#splash", { state: "detached", timeout: 3000 }); }
    const d = await p.evaluate(() => ({ result: RIW_DEBUG.intro.result, disposed: RIW_DEBUG.intro.disposed, videos: document.querySelectorAll("video").length, login: !!document.querySelector("#login-form"), blob: RIW_DEBUG.introModule._blob }));
    ok(`${d.result === "end" ? "koniec filmu" : "Pomiń intro"} → ekran logowania, odtwarzacz odmontowany, Blob/URL/nasłuchiwacze zwolnione`, d.login && d.videos === 0 && d.blob === null && Object.values(d.disposed).every(Boolean), d);
    // ponowne odtworzenie z Administracji (bufor odtwarzany z danych programu)
    const r = await p.evaluate(() => Intro.play({ force: true }) && true); await p.waitForFunction(() => { const v = document.querySelector("#splash video"); return v && v.currentTime > 0.2; }, null, { timeout: 8000 }).catch(() => {});
    ok("ponowne odtworzenie działa po zwolnieniu zasobów", await p.evaluate(() => !!document.querySelector("#splash video") && document.querySelector("#splash video").currentTime > 0.2), r);
    await p.keyboard.press("Escape"); await p.waitForSelector("#splash", { state: "detached", timeout: 3000 });
    ok("Esc pomija intro", await p.evaluate(() => RIW_DEBUG.intro.result === "skip"));
    ok("konsola bez wyjątków", errs.length === 0, errs);
    await b.close();
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  const bad = results.filter(x => !x).length;
  console.log(`\nWYNIK: ${results.length - bad}/${results.length} OK`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
