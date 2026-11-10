/* Testy E2E ResInvest ERP 3.14 (Chromium):
   * serwer: sprzedaż koleją z nowym odbiorcą wpisanym ręcznie i operacją dodatkową „za tonę” (ilość = tony załadowane),
     skan dołączony w formularzu (wysłany po zapisaniu), skany w szczegółach operacji (dodanie, miniatura, pobranie, usunięcie),
     plik w folderze „SKANY <MIESIĄC> <ROK>” i w kopii,
   * tryb lokalny: skany w bazie przeglądarki, kopia ZIP z folderami miesięcy, telefon bez przewijania poziomego.
   Uruchomienie z katalogu resinvest-erp:  node tests/e2e314.cjs   (zrzuty: SHOTS=<katalog>) */
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const FILE = "file://" + path.join(ROOT, "ResInvest_ERP.html");
const SHOTS = process.env.SHOTS || "";
const results = [], errors = [];
const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? "✔" : "✘"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); };
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png") }) : null;
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nb = s => String(s || "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const combo = (page, sel, v) => page.evaluate(([s, v]) => RIW_DEBUG.combo(s, v), [sel, v]);
const tick = (page, id) => page.click(`label.opt:has(#${id})`);
const fillTab = async (page, sel, v) => { await page.fill(sel, v); await page.press(sel, "Tab"); await page.waitForTimeout(80); };
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(3000, 9), Buffer.from([0xFF, 0xD9])]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
/** Prawdziwy obraz PNG 40×30 (miniatura w przeglądarce musi się wyświetlić). */
const PNG = (() => {
  const zlib = require("zlib"), w = 40, h = 30, crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, (_, x) => [30 + x * 5, 107, 69 + y * 4]).flat())])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
})();
const watch = page => { page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/favicon|Failed to load resource|401|403/.test(m.text())) errors.push(m.text()); }); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riw-e2e314-"));
  const port = await freePort(), BASE = `http://127.0.0.1:${port}`, data = path.join(dir, "data");
  const cfg = path.join(dir, "server.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ port, host: "127.0.0.1", dataDir: data }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|RIW_|COMPANY_DOMAINS|BACKUP_COPY_TO)/.test(k)));
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(ROOT, "server", "riw-server.mjs")], { env: Object.assign(env, { RIW_CONFIG: cfg, RIW_TODAY: "2026-09-23", EMAIL_TRANSPORT: "file" }), stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch (e) {} await sleep(100); }
  await fetch(BASE + "/api/setup", { method: "POST", headers: { "Content-Type": "application/json", "X-RIW": "1" }, body: JSON.stringify({ name: "Mateusz Roesner", email: "magazyn@resinvest.group", password: "Biomasa2026", sample: true }) });
  const browser = await chromium.launch();
  try {
    /* ---------------- serwer ---------------- */
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pl-PL", acceptDownloads: true });
    await ctx.addInitScript(() => { try { localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    let page = await ctx.newPage(); watch(page);
    await page.goto(BASE + "/"); await page.waitForSelector("#login-form");
    await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "Biomasa2026"); await page.click("#lg-submit");
    await page.waitForSelector("#nav .nav-item", { timeout: 10000 });
    await page.evaluate(() => { location.hash = "#/nowa?preset=wz"; }); await page.waitForSelector("#opf");
    await combo(page, "#f-sale-productId", "pr_zr_lesna"); await page.waitForTimeout(150);
    await fillTab(page, "#f-sale-qty", "300"); await fillTab(page, "#f-sale-price", "80");
    // odbiorca wpisany z klawiatury (nie ma go w kartotece)
    await page.fill("#f-sale-buyerId", "Ciepłownia Kolejowa S.A."); await page.press("#f-sale-buyerId", "Tab"); await page.waitForTimeout(200);
    check("Odbiorca wpisany ręcznie zostaje w polu (nowy kontrahent przy zatwierdzeniu)", (await page.inputValue("#f-sale-buyerId")) === "Ciepłownia Kolejowa S.A." && (await page.evaluate(() => RIWForm.draft.sale.buyerName)) === "Ciepłownia Kolejowa S.A.");
    await tick(page, "f-mode-train"); await page.waitForSelector("#f-transport-train-wagonCount");
    await fillTab(page, "#f-transport-train-wagonCount", "3"); await fillTab(page, "#f-transport-train-sameT", "59,4");
    await fillTab(page, "#f-transport-train-price", "25");
    await page.click('label.opt:has([data-bind="extras.enabled"])'); await page.waitForSelector("#f-extras-items-0-typeId");
    await combo(page, "#f-extras-items-0-typeId", "xt_wagony"); await page.waitForTimeout(200);
    const autoTrain = await page.evaluate(() => RIWForm.draft.extras.items[0].qtySource);
    check("Pociąg + rodzaj „za tonę” → ilość = tony załadowane (zaznaczone automatycznie, 178,2 t)", autoTrain === "train" && nb(await page.textContent('[data-out="extras.items.0.qty"]')) === "178,2 t", { autoTrain, out: await page.textContent('[data-out="extras.items.0.qty"]').catch(() => "") });
    await fillTab(page, "#f-extras-items-0-rate", "12");
    // skan dołączony w formularzu — wysyłany po zapisaniu
    await page.setInputFiles("#fs-file", { name: "kwit wagowy.png", mimeType: "image/png", buffer: PNG }); await page.waitForTimeout(250);
    check("Formularz: skan czeka na liście do wysłania po zapisaniu", nb(await page.textContent("#fs-list")).includes("kwit wagowy.png"));
    await shot(page, "314-formularz-pociag");
    const n0 = await page.evaluate(() => RIW_DEBUG.store.state.operations.length);
    await page.click("#summary [data-save]"); await page.waitForSelector("#confirm-op", { timeout: 5000 }); await page.click("#confirm-yes");
    await page.waitForFunction(n => RIW_DEBUG.store.state.operations.length > n, n0, { timeout: 8000 }).catch(() => {});
    await page.waitForSelector("#op-detail #op-scans .scan-item", { timeout: 8000 }).catch(() => {});
    const op = await page.evaluate(() => { const s = RIW_DEBUG.store.state, op = s.operations[s.operations.length - 1]; return { id: op.id, date: op.date, buyer: (s.partners.find(p => p.id === op.sale.buyerId) || {}).name, extra: op.extras[0], scans: (op.scans || []).map(x => x.file) }; });
    check("Zapisano: nowy odbiorca w kartotece, operacja dodatkowa 178,2 t × 12 zł = 2 138,40 zł", op.buyer === "Ciepłownia Kolejowa S.A." && op.extra && op.extra.qty === 178.2 && op.extra.cost === 2138.4, op);
    check("Skan z formularza wysłany po zapisaniu: plik w folderze SKANY WRZESIEŃ 2026 i w kopii", op.scans.length === 1 && /^SKANY WRZESIEŃ 2026\//.test(op.scans[0]) && fs.existsSync(path.join(data, "skany", op.scans[0])) && fs.existsSync(path.join(data, "backups", "skany", op.scans[0])), op.scans);
    // szczegóły operacji: dodanie PDF, miniatura zdjęcia, pobranie, usunięcie
    await page.selectOption("#scan-kind", "KWIT");
    await page.setInputFiles("#scan-file", { name: "kwit wywozowy.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.waitForFunction(() => document.querySelectorAll("#op-scans .scan-item").length === 2, null, { timeout: 8000 }).catch(() => {});
    const panel = nb(await page.textContent("#op-scans"));
    check("Szczegóły operacji: dwa skany w grupach „Kwit wywozowy” i „Inne/Kwit”, rozmiar, autor, folder", (await page.$$("#op-scans .scan-item")).length === 2 && panel.includes("Kwit wywozowy") && panel.includes("SKANY WRZESIEŃ 2026"), panel.slice(0, 300));
    await page.waitForFunction(() => { const i = document.querySelector("#op-scans img[data-thumb]"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
    check("Miniatura zdjęcia ładuje się z serwera (40 × 30 px)", await page.evaluate(() => { const i = document.querySelector("#op-scans img[data-thumb]"); return !!(i && /\/api\/scans\/file\?/.test(i.src) && i.naturalWidth === 40); }));
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }).catch(() => null), page.click("#op-scans [data-scan-dl] >> nth=0")]);
    check("Pobranie skanu", !!dl && /\.(png|jpg|pdf)$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());
    await shot(page, "314-skany-operacji");
    await page.click("#op-scans [data-scan-del] >> nth=0"); await page.waitForSelector("#cf-in"); await page.fill("#cf-in", "test usuwania"); await page.click("[data-yes]");
    await page.waitForFunction(() => document.querySelectorAll("#op-scans .scan-item").length === 1, null, { timeout: 5000 }).catch(() => {});
    check("Usunięcie skanu: znika z operacji, plik zostaje w folderze", (await page.$$("#op-scans .scan-item")).length === 1 && op.scans.every(f => fs.existsSync(path.join(data, "skany", f))));
    await ctx.close();

    /* ---------------- tryb lokalny (przeglądarka) ---------------- */
    ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "pl-PL", acceptDownloads: true });
    await ctx.addInitScript(() => { try { sessionStorage.setItem("riw.today", "2026-09-23"); localStorage.setItem("riw.lang", "pl"); localStorage.setItem("riw.sample", "1"); localStorage.setItem("riw.intro", "0"); } catch (e) {} });
    page = await ctx.newPage(); watch(page);
    await page.goto(FILE); await page.waitForSelector("#login-form");
    await page.fill("#lg-login", "magazyn@resinvest.group"); await page.fill("#lg-pass", "demo1234"); await page.click("#lg-submit"); await page.waitForSelector("#nav .nav-item");
    const lop = await page.evaluate(() => RIW_DEBUG.store.state.operations.find(o => o.whId === "wh_zab" && o.status !== "CANCELLED").id);
    await page.evaluate(id => OpDetail.open(id), lop); await page.waitForSelector("#op-scans #scan-file");
    await page.setInputFiles("#scan-file", [{ name: "zrebka.jpg", mimeType: "image/jpeg", buffer: JPG }, { name: "pz.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await page.waitForFunction(() => document.querySelectorAll("#op-scans .scan-item").length === 2, null, { timeout: 8000 }).catch(() => {});
    const local = await page.evaluate(id => (RIW_DEBUG.store.state.operations.find(o => o.id === id).scans || []).map(s => s.file), lop);
    check("Tryb lokalny: skany zapisane w bazie przeglądarki, ścieżki „SKANY <MIESIĄC> <ROK>/…”", local.length === 2 && local.every(f => /^SKANY [A-ZĄĆĘŁŃÓŚŹŻ]+ \d{4}\//.test(f)), local);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { location.hash = "#/administracja"; }); await page.waitForSelector("#bk-scans");
    const [zip] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }).catch(() => null), page.click("#bk-scans")]);
    let zipOk = false;
    if (zip) { const p = path.join(dir, "skany.zip"); await zip.saveAs(p); const b = fs.readFileSync(p); zipOk = b.subarray(0, 2).toString() === "PK" && b.includes(Buffer.from("SKANY ")); }
    check("Tryb lokalny: kopia skanów ZIP z folderami miesięcy", zipOk, zip && zip.suggestedFilename());
    // telefon: szczegóły operacji ze skanami bez przewijania poziomego
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(id => OpDetail.open(id), lop); await page.waitForSelector("#op-scans .scan-item");
    check("Telefon: panel skanów bez przewijania poziomego", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#op-scans").scrollWidth <= document.querySelector("#op-scans").clientWidth + 1));
    await shot(page, "314-telefon-skany");
    await ctx.close();
    check("Konsola przeglądarki bez wyjątków", errors.length === 0, errors.slice(0, 5));
  } catch (e) { console.error(e); results.push(false); }
  finally { await browser.close(); proc.kill("SIGTERM"); fs.rmSync(dir, { recursive: true, force: true }); }
  const ok = results.filter(Boolean).length;
  console.log(`\nWYNIK: ${ok}/${results.length} ${ok === results.length ? "OK" : "BŁĘDY"}`);
  process.exit(ok === results.length ? 0 : 1);
})();
