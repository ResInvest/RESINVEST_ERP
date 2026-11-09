/* Testy serwera — skany dokumentów i zdjęcia (3.14):  node --test tests/scans314.test.mjs
   * wysłanie pliku → folder „SKANY <MIESIĄC> <ROK>” w danych + natychmiastowa kopia w backups/skany + metadane w operacji,
   * odczyt (podgląd / pobranie), izolacja magazynów, uprawnienia, typ po sygnaturze (HTML/EXE odrzucone), limit 25 MB,
   * dołączenie skanu z pominięciem wysyłki pliku zablokowane, usunięcie (plik zostaje), kopia skanów przy kopii bazy
   * także w folderze firmy (BACKUP_COPY_TO), restart serwera — skany na miejscu. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "riw-scans-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(4000, 7), Buffer.from([0xFF, 0xD9])]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function withServer(dataDir, share, fn) {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const cfgFile = join(TMP, "server.config.json");
  writeFileSync(cfgFile, JSON.stringify({ port, host: "127.0.0.1", dataDir }));
  const env = Object.assign({}, process.env, { RIW_TODAY: "2026-09-23", RIW_CONFIG: cfgFile, EMAIL_TRANSPORT: "file", BACKUP_COPY_TO: share });
  delete env.COMPANY_DOMAINS;
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server", "riw-server.mjs")], { env, stdio: "ignore" });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(base + "/api/health")).ok; } catch (e) {} if (!up) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(up, "serwer wystartował");
    const mk = () => {
      let cookie = "";
      const call = async (method, path, body, headers = {}) => {
        const raw = Buffer.isBuffer(body);
        const r = await fetch(base + path, { method, headers: Object.assign({ "X-RIW": "1" }, raw ? {} : { "Content-Type": "application/json" }, cookie ? { Cookie: cookie } : {}, headers), body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
        const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
        const ct = r.headers.get("content-type") || "";
        return { status: r.status, headers: r.headers, json: ct.includes("json") ? await r.json().catch(() => null) : null, buf: ct.includes("json") ? null : Buffer.from(await r.arrayBuffer()) };
      };
      return { get: (p, h) => call("GET", p, undefined, h), post: (p, b, h) => call("POST", p, b, h) };
    };
    await fn(mk, base);
  } finally { await new Promise(res => { if (proc.exitCode !== null) return res(); proc.once("exit", res); proc.kill("SIGTERM"); }); }
}

test("skany na serwerze: folder miesiąca, kopia, odczyt, bezpieczeństwo, usunięcie, kopia w folderze firmy, restart", async () => {
  const data = join(TMP, "data"), share = join(TMP, "udzial");
  let opId, opDate, scanId, rel;
  await withServer(data, share, async mk => {
    const admin = mk();
    assert.equal((await admin.post("/api/setup", { name: "Mateusz Roesner", email: "magazyn@resinvest.group", password: "Biomasa2026", sample: true })).status, 200);
    assert.equal((await admin.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" })).status, 200);
    const st = (await admin.get("/api/state")).json.state;
    const op = st.operations.find(o => o.whId === "wh_zab" && o.status !== "CANCELLED");
    opId = op.id; opDate = op.date;
    // wysłanie zdjęcia z wagi
    const up = await admin.post(`/api/scans?opId=${opId}&kind=WAGA&name=${encodeURIComponent("waga ciężarówki.jpg")}`, JPG, { "Content-Type": "image/jpeg" });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    scanId = up.json.scan.id; rel = up.json.scan.file;
    const MONTHS = { "08": "SIERPIEŃ", "09": "WRZESIEŃ", "07": "LIPIEC" };
    assert.ok(rel.startsWith(`SKANY ${MONTHS[opDate.slice(5, 7)]} ${opDate.slice(0, 4)}/`), rel);
    assert.ok(existsSync(join(data, "skany", rel)), "plik w folderze skanów");
    assert.ok(existsSync(join(data, "backups", "skany", rel)), "natychmiastowa kopia w backups/skany");
    assert.deepEqual(readFileSync(join(data, "skany", rel)), JPG);
    assert.equal(up.json.scan.name, "waga ciężarówki.jpg");
    assert.match(up.json.scan.sha, /^[0-9a-f]{64}$/);
    // PDF jako kwit wywozowy
    const pdf = await admin.post(`/api/scans?opId=${opId}&kind=KWIT&name=kwit.pdf`, PDF, { "Content-Type": "application/pdf" });
    assert.equal(pdf.status, 200); assert.match(pdf.json.scan.file, /\.pdf$/);
    // odczyt
    const g = await admin.get(`/api/scans/file?opId=${opId}&id=${scanId}`);
    assert.equal(g.status, 200); assert.equal(g.headers.get("content-type"), "image/jpeg"); assert.deepEqual(g.buf, JPG);
    assert.equal(g.headers.get("x-content-type-options"), "nosniff");
    assert.match(g.headers.get("content-disposition"), /^inline/);
    assert.match((await admin.get(`/api/scans/file?opId=${opId}&id=${scanId}&download=1`)).headers.get("content-disposition"), /^attachment/);
    // HTML udający obraz, EXE, pusty plik, zły rodzaj — odrzucone; nic nie zostaje w folderze
    const n0 = readdirSync(join(data, "skany")).flatMap(f => readdirSync(join(data, "skany", f))).length;
    assert.equal((await admin.post(`/api/scans?opId=${opId}&kind=WZ&name=x.jpg`, Buffer.from("<html><script>alert(1)</script></html>"), { "Content-Type": "image/jpeg" })).status, 415);
    assert.equal((await admin.post(`/api/scans?opId=${opId}&kind=WZ&name=x.exe`, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]), { "Content-Type": "application/octet-stream" })).status, 415);
    assert.equal((await admin.post(`/api/scans?opId=${opId}&kind=ZLY&name=x.jpg`, JPG, { "Content-Type": "image/jpeg" })).status, 400);
    assert.equal((await admin.post(`/api/scans?opId=op_brak&kind=WZ&name=x.jpg`, JPG, { "Content-Type": "image/jpeg" })).status, 404);
    // limit rozmiaru 25 MB
    const big = Buffer.concat([JPG.subarray(0, 12), Buffer.alloc(26 * 1024 * 1024)]);
    assert.equal((await admin.post(`/api/scans?opId=${opId}&kind=WZ&name=duzy.jpg`, big, { "Content-Type": "image/jpeg" })).status, 413);
    const n1 = readdirSync(join(data, "skany")).flatMap(f => readdirSync(join(data, "skany", f))).length;
    assert.equal(n1, n0, "odrzucone pliki nie zostały zapisane");
    // dołączenie metadanych bez wysłania pliku (np. ścieżka do pliku systemowego) — zablokowane
    const fake = await admin.post("/api/cmd", { cmd: "scan.attach", args: { opId, scan: { id: "sc_fake00001", kind: "WZ", file: "SKANY MAJ 2026/x.jpg", type: "image/jpeg", size: 10 } } });
    assert.equal(fake.status, 403);
    // podgląd nieistniejącego / obcego id
    assert.equal((await admin.get(`/api/scans/file?opId=${opId}&id=../../server.env`)).status, 404);
    // magazynier innego magazynu nie widzi pliku
    const users = (await admin.get("/api/state")).json.state.users;
    const bra = users.find(u => u.whId === "wh_bra" && u.role === "magazynier");
    assert.equal((await admin.post("/api/users/password", { userId: bra.id, password: "Magazyn2026x" })).status, 200);
    const m = mk();
    assert.equal((await m.post("/api/auth/login", { login: bra.login, password: "Magazyn2026x" })).status, 200);
    const mustChange = await m.post("/api/auth/password", { old: "Magazyn2026x", new: "Magazyn2027y" });
    assert.equal(mustChange.status, 200, JSON.stringify(mustChange.json));
    assert.equal((await m.post("/api/auth/login", { login: bra.login, password: "Magazyn2027y" })).status, 200);
    assert.equal((await m.get(`/api/scans/file?opId=${opId}&id=${scanId}`)).status, 403);
    assert.equal((await m.post(`/api/scans?opId=${opId}&kind=WZ&name=a.jpg`, JPG, { "Content-Type": "image/jpeg" })).status, 403);
    // usunięcie z operacji (administrator) — plik zostaje w folderze i w kopii
    const del = await admin.post("/api/cmd", { cmd: "scan.remove", args: { opId, scanId: pdf.json.scan.id, reason: "duplikat" } });
    assert.equal(del.json.res.ok, true, JSON.stringify(del.json));
    assert.ok(existsSync(join(data, "skany", pdf.json.scan.file)));
    // kopia bazy → kopia skanów także w folderze firmy
    const b = await admin.post("/api/backups", {});
    assert.equal(b.status, 200);
    assert.ok(existsSync(join(share, "skany", rel)), "skan w folderze firmy (BACKUP_COPY_TO/skany)");
    assert.ok(existsSync(join(share, "skany", pdf.json.scan.file)));
  });
  // restart — skany na miejscu, plik do odczytu
  await withServer(data, share, async mk => {
    const admin = mk();
    assert.equal((await admin.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" })).status, 200);
    const op = (await admin.get("/api/state")).json.state.operations.find(o => o.id === opId);
    assert.equal(op.scans.filter(s => !s.deletedAt).length, 1);
    assert.equal(op.scans.length, 2);
    assert.deepEqual((await admin.get(`/api/scans/file?opId=${opId}&id=${scanId}`)).buf, JPG);
  });
});

test("wczytanie zapisu w przeglądarce (tryb serwera): kopia JSON → data.import, skany zachowane, sfałszowana ścieżka pliku zablokowana", async () => {
  const data = join(TMP, "data-import"), share = join(TMP, "udzial-import");
  await withServer(data, share, async mk => {
    assert.ok(existsSync(join(data, "skany")), "folder skanów od pierwszego uruchomienia (nowa baza)");
    const admin = mk();
    assert.equal((await admin.post("/api/setup", { name: "Mateusz Roesner", email: "magazyn@resinvest.group", password: "Biomasa2026", sample: true })).status, 200);
    assert.equal((await admin.post("/api/auth/login", { login: "magazyn@resinvest.group", password: "Biomasa2026" })).status, 200);
    const st = (await admin.get("/api/state")).json.state;
    const op = st.operations.find(o => o.whId === "wh_zab" && o.status !== "CANCELLED");
    const up = await admin.post(`/api/scans?opId=${op.id}&kind=WZ&name=wz.jpg`, JPG, { "Content-Type": "image/jpeg" });
    assert.equal(up.status, 200);
    // kopia: dokładnie to, co pobiera przycisk „Pobierz kopię (JSON)” (stan widoczny w przeglądarce)
    const backup = (await admin.get("/api/state")).json.state;
    const nOps = backup.operations.length;
    // praca po kopii — zostanie zastąpiona wczytaniem
    const extra = await admin.post("/api/cmd", { cmd: "data.clean", args: { confirm: "WYCZYŚĆ" } });
    assert.equal(extra.json.res.ok, true, JSON.stringify(extra.json));
    assert.equal((await admin.get("/api/state")).json.state.operations.length, 0);
    // wczytanie kopii
    const imp = await admin.post("/api/cmd", { cmd: "data.import", args: { state: backup } });
    assert.equal(imp.status, 200); assert.equal(imp.json.res.ok, true, JSON.stringify(imp.json.res));
    const after = (await admin.get("/api/state")).json.state;
    assert.equal(after.operations.length, nOps, "wszystkie operacje z kopii");
    const back = after.operations.find(o => o.id === op.id);
    assert.equal(back.scans.length, 1);
    assert.deepEqual((await admin.get(`/api/scans/file?opId=${op.id}&id=${up.json.scan.id}`)).buf, JPG, "skan z kopii otwiera się (plik został w folderze)");
    // kopia ze zmienioną ścieżką pliku skanu (np. do pliku konfiguracji) — wczytanie odrzucone albo plik niedostępny
    const evil = JSON.parse(JSON.stringify(backup));
    evil.operations.find(o => o.id === op.id).scans[0].file = "../server.env";
    const bad = await admin.post("/api/cmd", { cmd: "data.import", args: { state: evil } });
    assert.equal(bad.json.res.ok, false, "kopia ze sfałszowaną ścieżką odrzucona");
    assert.match(JSON.stringify(bad.json.res), /Nieprawidłowe dane skanów/);
    assert.deepEqual((await admin.get(`/api/scans/file?opId=${op.id}&id=${up.json.scan.id}`)).buf, JPG, "dane bez zmian po odrzuceniu");
    // odczyt stanu dalej działa i ma komplet operacji
    assert.equal((await admin.get("/api/state")).json.state.operations.length, nOps);
  });
});
