/* =========================================================================
   ResInvest ERP Serwer — rdzeń: baza SQLite, silnik, komendy, konta, kopie.
   Bez zależności zewnętrznych (Node ≥ 22.13: node:sqlite, node:crypto).

   Trwałość (od 3.10 — zapis przyrostowy):
   * tabela `state`   — „rdzeń” stanu (kartoteki, konfiguracja, numeracja; JSON) + suma SHA-256,
   * tabela `rows`    — rekordy rosnących kolekcji (operacje, księga, audyt, powiadomienia, plany, wersje robocze,
                        inwentaryzacje): jeden wiersz na rekord, kolejność `ord`, suma SHA-256 każdego wiersza;
                        zapis komendy dotyczy tylko zmienionych wierszy (czas zapisu nie rośnie z historią),
   * rekordy kolekcji w pamięci są zamrożone (Object.freeze) i współdzielone między wersjami stanu: kopia robocza
     komendy to rdzeń + płytkie tablice; zmiana istniejącego rekordu bez kopii jest wykrywana (TypeError)
     i komenda wykonuje się ponownie na pełnej kopii — wynik zawsze jak przy pełnej kopii,
   * tabela `journal` — dziennik zmian append-only (wyzwalacze blokują UPDATE/DELETE),
                        łańcuch skrótów SHA-256 (wykrycie ręcznej ingerencji),
   * każda komenda: silnik na kopii stanu → jedna transakcja (BEGIN IMMEDIATE)
     zapisuje stan i wpis dziennika → dopiero potem stan w pamięci (wszystko albo nic),
   * WAL + synchronous=FULL, kopie `VACUUM INTO` (spójne, bez zatrzymywania pracy).
   Konta: hasła scrypt (N=2^15), sesje losowe 256 bit (w bazie tylko skrót),
   blokada konta po nieudanych próbach, dziennik logowań.
   Tokeny e-mail (zaproszenie, reset hasła, potwierdzenie adresu): losowe 256 bit,
   w bazie tylko skrót SHA-256, jednorazowe, z terminem ważności; kolejka `outbox`
   zapisuje każdą wysyłkę (bez treści linków).
   Powiadomienia (3.5): kolejka `outbox` ze statusem QUEUED → SENT / FAILED (ponowienia po 1 min,
   5 min, 15 min, 1 h, 6 h) → DEAD; treść usuwana po wysłaniu.
   ========================================================================= */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/* ---------------- silnik aplikacji (ten sam kod co w przeglądarce) ---------------- */
export function loadEngine() {
  const appCfg = JSON.parse(readFileSync(join(ROOT, "config", "app.config.json"), "utf8"));
  globalThis.RIW_CONFIG = Object.fromEntries(Object.entries(appCfg).filter(([k]) => !k.startsWith("_")));
  const src = f => join(ROOT, "app", "src", f);
  const I18N = require(src("i18n.js"));
  for (const f of readdirSync(join(ROOT, "app", "src")).filter(f => /^i18n\.d\d+\.js$/.test(f)).sort()) require(src(f));
  const R = require(src("engine.js"));
  const Service = require(src("service.js"));
  require(src("seed.js"));
  const AuthLib = require(src("auth.js"));
  return { I18N, R, Service, AuthLib };
}
const { I18N, R, Service, AuthLib } = loadEngine();
export { I18N, R, Service, AuthLib };
const t = (s, p) => I18N.t(s, p);
const N_ = s => s;

export const sha256 = s => createHash("sha256").update(s).digest("hex");
const nowIso = () => new Date().toISOString();

/* ---------------- zapis przyrostowy: kolekcje wierszy ---------------- */
/** Kolekcje stanu przechowywane wiersz po wierszu (rosną z historią). Pozostałe pola = „rdzeń”. */
export const ROWS = ["operations", "ledger", "audit", "notices", "plans", "drafts", "inventory"];
const ROWSET = new Set(ROWS);
/** Błąd zapisu do zamrożonego rekordu (komenda zmienia istniejący rekord bez kopii). */
export const FROZEN_WRITE = /read[- ]only|not extensible|Cannot (?:assign|add|delete|define|redefine)|frozen/i;
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
/** Rdzeń stanu: wszystkie pola poza kolekcjami wierszy (te jako null — zachowana kolejność kluczy). */
function coreJsonOf(s) {
  const c = {};
  for (const k of Object.keys(s)) c[k] = ROWSET.has(k) ? null : s[k];
  for (const k of ROWS) if (!(k in c)) c[k] = null;
  return JSON.stringify(c);
}

/* ---------------- zmienne środowiskowe (sekrety — tylko serwer) ---------------- */
/** Plik KLUCZ=wartość (# komentarz). Zmienne procesu mają pierwszeństwo przed plikiem. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}
/** Kolejność: .env (katalog programu) → config/server.env → <dataDir>/server.env → zmienne procesu. */
export function loadEnv(dataDir) {
  const files = [join(ROOT, ".env"), join(ROOT, "config", "server.env"), dataDir ? join(dataDir, "server.env") : null].filter(Boolean);
  const env = {}, used = [];
  for (const f of files) if (existsSync(f)) { Object.assign(env, parseEnv(readFileSync(f, "utf8"))); used.push(f); }
  for (const [k, v] of Object.entries(process.env)) if (/^(RESEND_|AGENTMAIL_|EMAIL_|SMTP_|APP_URL|SUPABASE_)/.test(k)) env[k] = v;
  return { env, files: used };
}

/* ---------------- konfiguracja ---------------- */
export function loadConfig(overrides = {}) {
  const file = process.env.RIW_CONFIG || join(ROOT, "config", "server.config.json");
  const base = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const c = Object.assign({ port: 8080, host: "0.0.0.0", dataDir: "data-server", session: {}, security: {}, backup: {}, tls: {}, todayOverride: "" }, base, overrides);
  c.session = Object.assign({ idleMinutes: 30, absoluteHours: 12 }, base.session, overrides.session);
  c.security = Object.assign({ maxFailed: 5, lockMinutes: 15, ipAttemptsPer15Min: 40 }, base.security, overrides.security);
  c.backup = Object.assign({ hour: 2, keepDays: 30, dir: "" }, base.backup, overrides.backup);
  c.mail = Object.assign({ documentDomains: [] }, base.mail, overrides.mail);
  if (process.env.RIW_PORT) c.port = Number(process.env.RIW_PORT);
  if (process.env.RIW_DATA) c.dataDir = process.env.RIW_DATA;
  if (process.env.RIW_HOST) c.host = process.env.RIW_HOST;
  if (process.env.RIW_TODAY) c.todayOverride = process.env.RIW_TODAY;
  c.dataDir = resolve(ROOT, c.dataDir);
  c.backupDir = c.backup.dir ? resolve(ROOT, c.backup.dir) : join(c.dataDir, "backups");
  return c;
}

/* ---------------- hasła ---------------- */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return { algo: "scrypt", salt: salt.toString("hex"), hash: hash.toString("hex"), params: JSON.stringify({ N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }) };
}
export function verifyPassword(pw, acc) {
  if (!acc || acc.algo !== "scrypt") return false;
  const p = JSON.parse(acc.params || "{}");
  const got = scryptSync(String(pw), Buffer.from(acc.salt, "hex"), SCRYPT.keylen, { N: p.N, r: p.r, p: p.p, maxmem: SCRYPT.maxmem });
  const exp = Buffer.from(acc.hash, "hex");
  return exp.length === got.length && timingSafeEqual(exp, got);
}

/* ---------------- dziennik tekstowy ---------------- */
export function makeLogger(dir) {
  mkdirSync(dir, { recursive: true });
  return (level, msg) => {
    const line = `${nowIso()} [${level}] ${msg}`;
    if (level === "ERROR") console.error(line); else console.log(line);
    try { appendFileSync(join(dir, `server-${nowIso().slice(0, 10)}.log`), line + "\n"); } catch (e) {}
  };
}

/* ======================================================================= */
/* Magazyn danych                                                          */
/* ======================================================================= */
export class Store {
  constructor(cfg, log) {
    this.cfg = cfg; this.log = log || (() => {});
    mkdirSync(cfg.dataDir, { recursive: true });
    mkdirSync(cfg.backupDir, { recursive: true });
    this.file = join(cfg.dataDir, "resinvest.sqlite");
    this.db = new DatabaseSync(this.file);
    this.updateBackup = this.preUpdateBackup();
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), rev INTEGER NOT NULL, schema INTEGER NOT NULL, json TEXT NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows(coll TEXT NOT NULL, id TEXT NOT NULL, ord REAL NOT NULL, json TEXT NOT NULL, sha TEXT NOT NULL, PRIMARY KEY(coll, id)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS rows_ord ON rows(coll, ord);
      CREATE TABLE IF NOT EXISTS journal(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT, user_login TEXT, cmd TEXT NOT NULL, args TEXT NOT NULL, rev_before INTEGER, rev_after INTEGER, state_sha TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal BEGIN SELECT RAISE(ABORT, 'journal is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal BEGIN SELECT RAISE(ABORT, 'journal is append-only'); END;
      CREATE TABLE IF NOT EXISTS accounts(user_id TEXT PRIMARY KEY, algo TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, params TEXT, must_change INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, locked_until TEXT, changed_at TEXT, last_login TEXT);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, ua TEXT);
      CREATE TABLE IF NOT EXISTS login_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, login TEXT, user_id TEXT, ok INTEGER NOT NULL, reason TEXT, ip TEXT);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS tokens(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_by TEXT);
      CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id, kind);
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, template TEXT NOT NULL, to_addr TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL, error TEXT, provider_id TEXT, transport TEXT);`);
    // kolejka wysyłki (3.5): kolumny dodawane do istniejącej tabeli — dane bez zmian
    const cols = new Set(this.db.prepare("PRAGMA table_info(outbox)").all().map(c => c.name));
    for (const [c, def] of [["kind", "TEXT NOT NULL DEFAULT 'auth'"], ["subject", "TEXT"], ["body", "TEXT"], ["attempts", "INTEGER NOT NULL DEFAULT 0"], ["next_at", "TEXT"], ["notice_id", "TEXT"], ["sent_at", "TEXT"], ["updated_at", "TEXT"]])
      if (!cols.has(c)) this.db.exec(`ALTER TABLE outbox ADD COLUMN ${c} ${def}`);
    this.db.exec("CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_at)");
    // wysyłka przerwana zatrzymaniem serwera wraca do kolejki
    this.db.prepare("UPDATE outbox SET status = 'QUEUED' WHERE status = 'SENDING'").run();
    this.db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('created_at', ?)").run(nowIso());
    this.db.prepare("INSERT INTO meta(key, value) VALUES ('app_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(R.VERSION);
    this.state = null; this.integrity = { ok: true, notes: [] };
    this.load();
  }
  /**
   * Aktualizacja programu (nowa wersja na istniejącej bazie): przed jakąkolwiek zmianą tabel lub migracją danych
   * zapisuje pełną kopię bazy „resinvest-…-przed-aktualizacja-<stara wersja>.sqlite”. Bez kopii serwer nie startuje.
   */
  preUpdateBackup() {
    const has = n => !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);
    if (!has("state") || !this.db.prepare("SELECT 1 FROM state WHERE id = 1").get()) return null;   // nowa, pusta baza
    const prev = has("meta") ? ((this.db.prepare("SELECT value FROM meta WHERE key = 'app_version'").get() || {}).value || "") : "";
    if (prev === R.VERSION) return null;
    const cmp = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
    if (prev && cmp(prev, R.VERSION) > 0) this.log("WARN", `Baza była używana przez nowszą wersję ${prev} (uruchomiona: ${R.VERSION}). Zalecany powrót do wersji ${prev}.`);
    const r = this.backup(`przed-aktualizacja-${(prev || "starsza").replace(/[^\w]/g, "_")}`);
    this.log("INFO", `Aktualizacja ${prev || "(wersja sprzed 3.9.1)"} → ${R.VERSION}: kopia bazy przed zmianami: ${r.name}`);
    return Object.assign({ from: prev || "", to: R.VERSION }, r);
  }
  /**
   * Kopia robocza dla komendy „wszystko albo nic”: rdzeń odtworzony z JSON (mały) + płytkie kopie tablic kolekcji
   * (rekordy współdzielone i zamrożone). Dopisanie / usunięcie / podmiana rekordu działa bez kopiowania historii.
   */
  workCopy() {
    const w = JSON.parse(this.coreJson);
    for (const k of ROWS) w[k] = Array.isArray(this.state[k]) ? this.state[k].slice() : [];
    return w;
  }
  /** Pełna, zmienialna kopia stanu (ścieżka zapasowa dla komend zmieniających istniejące rekordy w miejscu). */
  fullCopy() { return R.clone(this.state); }
  today() { return R.Dates.isISO(this.cfg.todayOverride) ? this.cfg.todayOverride : R.Dates.localToday(); }
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { try { this.db.exec("ROLLBACK"); } catch (x) {} throw e; }
  }
  load() {
    const row = this.db.prepare("SELECT rev, json, sha256 FROM state WHERE id = 1").get();
    this.idx = {}; this.ord = {}; this.deltas = []; this.deltaBase = 0; this.stateSha = "";
    for (const k of ROWS) { this.idx[k] = new Map(); this.ord[k] = new Map(); }
    if (!row) { this.state = null; this.coreJson = null; return; }
    if (sha256(row.json) !== row.sha256) { this.integrity.ok = false; this.integrity.notes.push("state checksum mismatch"); this.log("ERROR", "Suma kontrolna stanu nie zgadza się — sprawdź bazę / przywróć kopię."); }
    const storage = (this.db.prepare("SELECT value FROM meta WHERE key = 'storage'").get() || {}).value || "";
    let full = JSON.parse(row.json), bad = 0;
    if (storage === "rows-1") {
      for (const k of ROWS) full[k] = [];
      for (const r of this.db.prepare("SELECT coll, id, ord, json, sha FROM rows ORDER BY coll, ord").iterate()) {
        if (!ROWSET.has(r.coll)) continue;
        if (sha256(r.json) !== r.sha) { bad++; if (bad <= 5) this.integrity.notes.push(`row checksum mismatch ${r.coll}/${r.id}`); }
        full[r.coll].push(JSON.parse(r.json)); this.ord[r.coll].set(r.id, r.ord);
      }
      if (bad) { this.integrity.ok = false; this.log("ERROR", `Suma kontrolna ${bad} rekordów nie zgadza się — sprawdź bazę / przywróć kopię.`); }
      this.stateSha = (this.db.prepare("SELECT value FROM meta WHERE key = 'state_sha'").get() || {}).value || "";
    }
    const m = R.migrate(full);
    if (m.error) throw new Error("Nie można wczytać danych: " + m.error);
    this.verifyJournal();
    if (storage !== "rows-1" || m.from !== m.to) {
      // baza sprzed 3.10 (jeden dokument JSON) albo migracja schematu → pełny zapis wierszy;
      // kopia „przed-aktualizacja” powstała przy otwarciu bazy
      this.state = null; this.coreJson = null;
      this.saveState(m.state, { id: null, login: "system" }, m.from !== m.to ? "system.migrate" : "system.storage", { from: m.from, to: m.to, zapis: "przyrostowy (wiersze)", rekordy: ROWS.reduce((n, k) => n + (m.state[k] || []).length, 0) }, m.state.rev);
      this.log("INFO", storage !== "rows-1" ? `Zapis przyrostowy: dane przeniesione do wierszy (${ROWS.map(k => `${k} ${(m.state[k] || []).length}`).join(", ")})` : `Migracja danych ${m.from} → ${m.to}`);
      return;
    }
    this.state = m.state;
    for (const k of ROWS) { this.state[k] = this.state[k] || []; for (const el of this.state[k]) { this.idx[k].set(el.id, el); deepFreeze(el); } }
    this.coreJson = coreJsonOf(this.state); this.deltaBase = this.state.rev;
  }
  /** Łańcuch skrótów dziennika — każdy wpis zawiera skrót poprzedniego. */
  verifyJournal() {
    let prev = "0".repeat(64), n = 0;
    for (const j of this.db.prepare("SELECT * FROM journal ORDER BY seq").iterate()) {
      const h = sha256([prev, j.ts, j.user_id || "", j.cmd, j.args, j.rev_before, j.rev_after, j.state_sha || ""].join("|"));
      if (j.prev_hash !== prev || j.hash !== h) { this.integrity.ok = false; this.integrity.notes.push(`journal broken at ${j.seq}`); this.log("ERROR", `Dziennik zmian naruszony przy wpisie ${j.seq}`); return false; }
      prev = j.hash; n++;
    }
    this.journalHead = prev; this.journalCount = n;
    return true;
  }
  /**
   * Zapis stanu + wpis dziennika w JEDNEJ transakcji — tylko zmienione rekordy kolekcji (porównanie tożsamości:
   * rekord niezmieniony to ten sam, zamrożony obiekt) i rdzeń. `state_sha` w dzienniku = skrót łańcuchowy zmian.
   */
  saveState(next, user, cmd, argsForJournal, revBefore) {
    const prev = this.state, full = !prev, ts = nowIso();
    const argsTxt = JSON.stringify(argsForJournal == null ? {} : argsForJournal).slice(0, 200000);
    const coreJson = coreJsonOf(next), coreSha = sha256(coreJson);
    const plan = [], digest = [coreSha];
    const delta = { rev: next.rev, up: {}, del: {}, order: false, access: !prev || this.accessKey(prev) !== this.accessKey(next) };
    for (const k of ROWS) {
      const arr = Array.isArray(next[k]) ? next[k] : (next[k] = []);
      if (!full && prev[k] === arr) continue;
      const old = this.idx[k], ordOld = this.ord[k];
      const seen = new Set(), up = [];
      for (let i = 0; i < arr.length; i++) {
        const el = arr[i];
        if (!el || el.id == null) throw new Error(`Rekord bez identyfikatora w kolekcji ${k}`);
        if (seen.has(el.id)) throw new Error(`Powtórzony identyfikator ${el.id} w kolekcji ${k}`);
        seen.add(el.id);
        if (full || old.get(el.id) !== el) up.push(i);
      }
      const del = full ? [] : [...old.keys()].filter(id => !seen.has(id));
      // kolejność: niezmienione rekordy zachowują `ord`; nowe dostają wartość między sąsiadami; inaczej renumeracja
      const ords = new Array(arr.length); let renumber = full, last = -Infinity;
      for (let i = 0; i < arr.length && !renumber; i++) {
        const o = ordOld.get(arr[i].id);
        if (o !== undefined && o > last) { ords[i] = o; last = o; continue; }
        if (o !== undefined) { renumber = true; break; }
        let nextKnown = Infinity;
        for (let j = i + 1; j < arr.length; j++) { const q = ordOld.get(arr[j].id); if (q !== undefined) { nextKnown = q; break; } }
        const v = nextKnown === Infinity ? (last === -Infinity ? 0 : Math.floor(last) + 1) : (last === -Infinity ? nextKnown - 1 : (last + nextKnown) / 2);
        if (!(v > last) || !(v < nextKnown) || nextKnown - last < 1e-6) { renumber = true; break; }
        ords[i] = v; last = v;
      }
      if (renumber) for (let i = 0; i < arr.length; i++) ords[i] = i;
      const upRows = up.map(i => { const json = JSON.stringify(arr[i]); return { i, id: String(arr[i].id), json, sha: sha256(json) }; });
      for (const r of upRows) digest.push(r.sha);
      for (const id of del) digest.push("-" + k + "/" + id);
      plan.push({ k, arr, upRows, del, ords, renumber });
      delta.up[k] = upRows.map(r => r.id); delta.del[k] = del.map(String);
      if (renumber && !full) delta.order = true;
      // nowy rekord przed rekordem już istniejącym (nie dopisany na końcu) zmienia kolejność u klientów
      if (!full && !renumber) {
        let lastOld = -1; for (let i = arr.length - 1; i >= 0; i--) if (ordOld.has(String(arr[i].id))) { lastOld = i; break; }
        if (upRows.some(r => !ordOld.has(r.id) && r.i < lastOld)) delta.order = true;
      }
    }
    const sh = sha256([this.stateSha || "", ...digest].join("|"));
    this.tx(() => {
      const upsert = this.db.prepare("INSERT INTO rows(coll, id, ord, json, sha) VALUES (?, ?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET ord = excluded.ord, json = excluded.json, sha = excluded.sha");
      const delStmt = this.db.prepare("DELETE FROM rows WHERE coll = ? AND id = ?");
      const ordStmt = this.db.prepare("UPDATE rows SET ord = ? WHERE coll = ? AND id = ?");
      if (full) this.db.exec("DELETE FROM rows");
      for (const p of plan) {
        const upSet = new Set(p.upRows.map(r => r.i));
        for (const r of p.upRows) upsert.run(p.k, r.id, p.ords[r.i], r.json, r.sha);
        for (const id of p.del) delStmt.run(p.k, String(id));
        if (p.renumber && !full) for (let i = 0; i < p.arr.length; i++) if (!upSet.has(i)) ordStmt.run(p.ords[i], p.k, String(p.arr[i].id));
      }
      this.db.prepare("INSERT INTO state(id, rev, schema, json, sha256, updated_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, schema = excluded.schema, json = excluded.json, sha256 = excluded.sha256, updated_at = excluded.updated_at")
        .run(next.rev, next.schema, coreJson, coreSha, ts);
      const meta = this.db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      meta.run("storage", "rows-1"); meta.run("state_sha", sh);
      const prevHash = this.journalHead || "0".repeat(64);
      const rb = revBefore == null ? null : revBefore;
      const hash = sha256([prevHash, ts, (user && user.id) || "", cmd, argsTxt, rb, next.rev, sh].join("|"));
      this.db.prepare("INSERT INTO journal(ts, user_id, user_login, cmd, args, rev_before, rev_after, state_sha, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(ts, (user && user.id) || null, (user && user.login) || null, cmd, argsTxt, rb, next.rev, sh, prevHash, hash);
      this.pendingHead = hash;
    });
    // dopiero po udanej transakcji: indeksy, kolejność, zamrożenie nowych rekordów, stan w pamięci
    for (const p of plan) {
      const idx = full ? new Map() : this.idx[p.k], ord = this.ord[p.k];
      if (full || p.renumber) ord.clear();
      for (const id of p.del) { idx.delete(id); ord.delete(id); }
      for (const r of p.upRows) { const el = p.arr[r.i]; idx.set(el.id, el); deepFreeze(el); }
      for (let i = 0; i < p.arr.length; i++) ord.set(String(p.arr[i].id), p.ords[i]);
      this.idx[p.k] = idx;
    }
    this.journalHead = this.pendingHead; this.journalCount = (this.journalCount || 0) + 1;
    this.state = next; this.coreJson = coreJson; this.stateSha = sh;
    if (!full) {
      this.deltas.push(delta);
      if (this.deltas.length > 500) { const cut = this.deltas.splice(0, this.deltas.length - 500); this.deltaBase = cut[cut.length - 1].rev; }
    } else { this.deltas = []; this.deltaBase = next.rev; }
  }
  /** Dane decydujące o widoczności (konta, role, magazyny): ich zmiana wymaga u klientów pełnego odświeżenia. */
  accessKey(s) { return JSON.stringify([s.users, s.rolePerms, s.warehouses]); }
  /**
   * Zmiany od rewizji `since` (dla synchronizacji przeglądarek): { up: {kolekcja: Set id}, del: {…} } albo null,
   * gdy potrzebny pełny stan (brak historii zmian, zmiana uprawnień / kolejności).
   */
  changesSince(since) {
    const cur = this.state && this.state.rev;
    if (!Number.isInteger(since) || since < 0 || since > cur) return null;
    if (since === cur) return { up: {}, del: {} };
    if (since < this.deltaBase) return null;                 // zmiany sprzed startu serwera / przyciętej historii
    const up = {}, del = {};
    for (const d of this.deltas) {
      if (d.rev <= since) continue;
      if (d.access || d.order) return null;
      for (const k of Object.keys(d.up)) for (const id of d.up[k]) { (up[k] = up[k] || new Set()).add(id); if (del[k]) del[k].delete(id); }
      for (const k of Object.keys(d.del)) for (const id of d.del[k]) { (del[k] = del[k] || new Set()).add(id); if (up[k]) up[k].delete(id); }
    }
    return { up, del };
  }


  /** Komenda usługi: silnik na kopii → zapis atomowy → stan w pamięci. */
  execute(userId, cmd, args, lang, meta) {
    if (!Service.has(cmd)) return { ok: false, error: t("Nieznana komenda: {c}", { c: cmd }), code: "UNKNOWN" };
    I18N.setLang(lang || "pl");
    const ctx = Object.assign({ user: { id: userId }, today: this.today() }, meta && { ip: meta.ip || "", ua: String(meta.ua || "").slice(0, 200) });
    const rev0 = this.state.rev;
    const { res, state } = this.runFast(cmd, work => Service.run(this.state, cmd, args, ctx, work));
    if (state) {
      const u = R.byId(state.users, userId) || R.byId(this.state.users, userId);
      const journalArgs = cmd === "data.import" ? { operacje: (args.state && args.state.operations || []).length, rewizja: args.state && args.state.rev } : args;
      try { this.saveState(state, u, cmd, journalArgs, rev0); }
      catch (e) { this.log("ERROR", `Zapis nieudany (${cmd}): ${e.message}`); return { ok: false, error: t("Zapis w bazie nieudany — nic nie zapisano: {m}", { m: e.message }), code: "DB" }; }
      res.__changed = true;
    }
    return res;
  }
  /**
   * Szybka ścieżka komendy: kopia robocza bez kopiowania historii. Gdy kod silnika zmienia istniejący (zamrożony)
   * rekord w miejscu, zapis się nie udaje (TypeError) — komenda jest wtedy powtarzana na pełnej kopii stanu;
   * wynik jest ten sam, różni się tylko czas. Licznik `fallbacks` i dziennik wskazują miejsca do optymalizacji.
   */
  runFast(label, run) {
    let out;
    try { out = run(this.workCopy()); }
    catch (e) { if (!FROZEN_WRITE.test(String(e && e.message))) throw e; out = { res: { ok: false, code: "INTERNAL", error: e.message }, state: null }; }
    if (!out.state && out.res && out.res.code === "INTERNAL" && FROZEN_WRITE.test(String(out.res.error))) {
      this.fallbacks = (this.fallbacks || 0) + 1;
      this.log("INFO", `Komenda ${label}: zmiana istniejącego rekordu — wykonanie na pełnej kopii (${String(out.res.error).slice(0, 160)})`);
      out = run(this.fullCopy());
      if (out.state) this.reuseUnchanged(out.state);
    }
    return out;
  }
  /** Po pełnej kopii: rekordy identyczne z dotychczasowymi zastępuje oryginałami (zapis tylko faktycznie zmienionych). */
  reuseUnchanged(next) {
    for (const k of ROWS) {
      const arr = next[k], idx = this.idx[k];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const o = arr[i] && idx.get(arr[i].id);
        if (o && JSON.stringify(o) === JSON.stringify(arr[i])) arr[i] = o;
      }
    }
  }
  /** Zmiana stanu przez hosta (bez komendy użytkownika): aktywacja, wpis audytu. Zapis atomowy jak execute. */
  applyChange(label, fn, journalArgs, actor) {
    const rev0 = this.state.rev;
    const { res, state } = this.runFast(label, work => Service.apply(this.state, fn, work));
    if (state) {
      try { this.saveState(state, actor || null, label, journalArgs || {}, rev0); }
      catch (e) { this.log("ERROR", `Zapis nieudany (${label}): ${e.message}`); return { ok: false, error: t("Zapis w bazie nieudany — nic nie zapisano: {m}", { m: e.message }), code: "DB" }; }
      res.__changed = true;
    }
    return res;
  }
  /** Wpis dziennika audytu wykonany przez serwer (np. wysyłka e-mail, prośba o reset hasła). */
  auditEvent(rec, meta, actor) {
    return this.applyChange("audit." + String(rec.code || "event").toLowerCase(), s => {
      s.rev += 1;
      R.audit(s, Object.assign({ user: actor ? R.byId(s.users, actor.id) || null : null, source: rec.source || N_("Serwer") }, meta || {}), Object.assign({ entity: "user", event: "user" }, rec));
      return { ok: true };
    }, { code: rec.code, entityId: rec.entityId || "" }, actor);
  }

  /* ---------------- konta ---------------- */
  account(userId) { return this.db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(userId) || null; }
  hasAccounts() { return !!this.db.prepare("SELECT 1 FROM accounts LIMIT 1").get(); }
  setPassword(userId, pw, mustChange) {
    const h = hashPassword(pw), prev = this.account(userId);
    this.db.prepare(`INSERT INTO accounts(user_id, algo, salt, hash, params, must_change, failed, locked_until, changed_at, last_login) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET algo = excluded.algo, salt = excluded.salt, hash = excluded.hash, params = excluded.params, must_change = excluded.must_change, failed = 0, locked_until = NULL, changed_at = excluded.changed_at`)
      .run(userId, h.algo, h.salt, h.hash, h.params, mustChange ? 1 : 0, nowIso(), prev ? prev.last_login : null);
  }
  logLogin(login, userId, ok, reason, ip) {
    this.db.prepare("INSERT INTO login_log(ts, login, user_id, ok, reason, ip) VALUES (?, ?, ?, ?, ?, ?)").run(nowIso(), login || null, userId || null, ok ? 1 : 0, reason || "", ip || "");
  }
  login(login, pw, ip) {
    const L = String(login || "").trim().toLowerCase();
    if (!L || !pw) return { ok: false, code: "EMPTY", error: t("Podaj e-mail służbowy i hasło") };
    const em = R.validateCompanyEmail(L, this.state && this.state.config.companyDomains);
    if (!em.ok) { this.logLogin(L, null, false, N_("adres spoza domeny firmowej"), ip); return { ok: false, code: "DOMAIN", field: "login", error: em.error }; }
    const u = this.state && this.state.users.find(x => String(x.login).toLowerCase() === L || String(x.email || "").toLowerCase() === L);
    const acc = u ? this.account(u.id) : null;
    const bad = reason => { this.logLogin(L, u ? u.id : null, false, reason, ip); return { ok: false, code: "BAD", error: t("Nieprawidłowy e-mail lub hasło.") }; };
    if (u && !acc && R.statusOf(u) === "INVITED") { verifyPassword(pw, { algo: "scrypt", salt: "00", hash: "00".repeat(32), params: JSON.stringify(SCRYPT) }); this.logLogin(L, u.id, false, N_("konto nieaktywowane (zaproszenie)"), ip); return { ok: false, code: "INVITED", error: t("Twoje konto nie zostało jeszcze aktywowane.") }; }
    if (!u || !acc) { verifyPassword(pw, { algo: "scrypt", salt: "00", hash: "00".repeat(32), params: JSON.stringify(SCRYPT) }); return bad(N_("nieznany login")); }
    if (acc.locked_until && Date.parse(acc.locked_until) > Date.now()) {
      this.logLogin(L, u.id, false, N_("konto zablokowane"), ip);
      return { ok: false, code: "LOCKED", error: t("Konto zablokowane po nieudanych próbach logowania. Spróbuj za {n} min albo poproś administratora o odblokowanie.", { n: Math.ceil((Date.parse(acc.locked_until) - Date.now()) / 60000) }) };
    }
    if (!verifyPassword(pw, acc)) {
      const failed = acc.failed + 1, lock = failed >= this.cfg.security.maxFailed;
      this.db.prepare("UPDATE accounts SET failed = ?, locked_until = ? WHERE user_id = ?").run(lock ? 0 : failed, lock ? new Date(Date.now() + this.cfg.security.lockMinutes * 60000).toISOString() : acc.locked_until, u.id);
      return bad(N_("błędne hasło"));
    }
    const st = R.statusOf(u);
    if (st === "INVITED" && u.selfRegistered && u.emailUnverified) { this.logLogin(L, u.id, false, N_("rejestracja — adres e-mail niepotwierdzony"), ip); return { ok: false, code: "UNVERIFIED", error: t("Potwierdź adres e-mail — kliknij link z wiadomości wysłanej po rejestracji. Potem administrator nada rolę i magazyn.") }; }
    if (st === "INVITED") { this.logLogin(L, u.id, false, N_("konto nieaktywowane"), ip); return { ok: false, code: "INVITED", error: u.selfRegistered ? t("Konto oczekuje na zatwierdzenie przez administratora. Otrzymasz dostęp po nadaniu roli i magazynu.") : t("Twoje konto nie zostało jeszcze aktywowane.") }; }
    if (st !== "ACTIVE") { this.logLogin(L, u.id, false, st === "SUSPENDED" ? N_("konto zawieszone") : N_("konto dezaktywowane"), ip); return { ok: false, code: "INACTIVE", error: t("Twoje konto jest nieaktywne.") }; }
    if (u.emailUnverified) { this.logLogin(L, u.id, false, N_("adres e-mail niepotwierdzony"), ip); return { ok: false, code: "UNVERIFIED", error: t("Adres e-mail nie został potwierdzony. Kliknij link z wiadomości albo poproś administratora o ponowne wysłanie.") }; }
    this.db.prepare("UPDATE accounts SET failed = 0, locked_until = NULL, last_login = ? WHERE user_id = ?").run(nowIso(), u.id);
    this.logLogin(L, u.id, true, "", ip);
    return { ok: true, user: u, mustChange: !!acc.must_change };
  }
  /* ---------------- sesje ---------------- */
  createSession(userId, ip, ua) {
    const token = randomBytes(32).toString("base64url"), now = Date.now();
    this.db.prepare("INSERT INTO sessions(token_hash, user_id, created_at, last_seen, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(sha256(token), userId, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + this.cfg.session.absoluteHours * 3600000).toISOString(), ip || "", String(ua || "").slice(0, 200));
    return token;
  }
  session(token) {
    if (!token) return null;
    const s = this.db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(sha256(token));
    if (!s) return null;
    const now = Date.now();
    if (Date.parse(s.expires_at) < now || now - Date.parse(s.last_seen) > this.cfg.session.idleMinutes * 60000) { this.dropSession(token); return null; }
    const u = this.state && R.byId(this.state.users, s.user_id);
    if (!u || R.statusOf(u) !== "ACTIVE" || u.emailUnverified) { this.dropSession(token); return null; }
    if (now - Date.parse(s.last_seen) > 15000) this.db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(new Date(now).toISOString(), s.token_hash);
    return { userId: s.user_id, user: u };
  }
  dropSession(token) { if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token)); }
  dropUserSessions(userId, exceptToken) {
    if (exceptToken) this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, sha256(exceptToken));
    else this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
  purgeSessions() { this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso()); }

  /* ---------------- pierwsze uruchomienie ---------------- */
  /**
   * Pusta baza + konfiguracja `initialAdmin` → konto administratora z hasłem startowym (zmiana wymagana przy pierwszym
   * logowaniu), 3 magazyny, katalog produktów, rejestracja z ekranu logowania włączona. Wykonywane tylko raz.
   */
  bootstrap(init) {
    if (this.hasAccounts() || !init || !init.email) return { ok: false, skipped: true };
    const L = String(init.email).trim().toLowerCase();
    if (!R.EMAIL_RE.test(L)) return { ok: false, error: "initialAdmin.email: nieprawidłowy adres" };
    const pe = AuthLib.passwordError(init.password, L); if (pe) return { ok: false, error: "initialAdmin.password: " + pe };
    const s = R.Seed.minimal({ email: L, name: String(init.name || "Administrator").trim(), today: this.today(), allowSelfRegistration: init.allowSelfRegistration !== false });
    if (!R.companyEmail(s, L)) return { ok: false, error: "initialAdmin.email: adres spoza domen firmowych" };
    s.rev = (s.rev || 0) + 1;
    this.state = null;   // pierwsze uruchomienie: zapis pełny (bez porównania z poprzednim stanem)
    this.saveState(s, { id: "u_admin", login: L }, "system.setup", { sample: false, bootstrap: true }, 0);
    this.setPassword("u_admin", init.password, true);
    this.log("INFO", `Pierwsze uruchomienie: administrator ${L} (hasło startowe z konfiguracji — zmiana wymagana przy pierwszym logowaniu)`);
    return { ok: true };
  }
  setup({ name, email, login, password, sample, lang }) {
    if (this.hasAccounts()) return { ok: false, error: t("Serwer jest już skonfigurowany") };
    const L = String(email || login || "").trim().toLowerCase();
    if (!R.EMAIL_RE.test(L)) return { ok: false, error: t("Podaj adres e-mail") };
    if (String(name || "").trim().length < 3) return { ok: false, error: t("Podaj imię i nazwisko (co najmniej 3 znaki)") };
    const pe = AuthLib.passwordError(password, L); if (pe) return { ok: false, error: pe };
    let s;
    if (sample) {
      s = R.Seed.build(this.today());
      const admin = R.byId(s.users, "u_admin");
      const clash = s.users.find(u => u.login === L && u.id !== "u_admin");
      if (clash) clash.login = clash.email = "demo." + clash.login;
      Object.assign(admin, { login: L, email: L, name: String(name).trim(), lang: lang || "" });
    } else s = R.Seed.minimal({ email: L, name: String(name).trim(), lang, today: this.today() });
    if (!R.companyEmail(s, L)) return { ok: false, error: t("Wymagany e-mail firmowy ({d})", { d: s.config.companyDomains.map(d => "@" + d).join(", ") }) };
    s.rev = (s.rev || 0) + 1;
    this.state = null;   // pierwsze uruchomienie: zapis pełny (bez porównania z poprzednim stanem)
    this.saveState(s, { id: "u_admin", login: L }, "system.setup", { sample: !!sample }, 0);
    this.setPassword("u_admin", password, false);
    if (sample) for (const u of s.users) if (u.id !== "u_admin" && R.statusOf(u) === "ACTIVE") this.setPassword(u.id, AuthLib.DEMO_PASSWORD, true);
    this.log("INFO", `Pierwsze uruchomienie: administrator ${L}, dane przykładowe: ${sample ? "tak" : "nie"}`);
    return { ok: true };
  }

  /** Rejestracja z ekranu logowania: profil „oczekuje na zatwierdzenie” + hasło (bez sesji). */
  register(rec, password, lang, meta) {
    I18N.setLang(lang || "pl");
    const pe = AuthLib.passwordError(password, rec && rec.email); if (pe) return { ok: false, errors: { password: pe }, error: pe };
    const rev0 = this.state.rev;
    // adres potwierdza się linkiem z e-maila; administratorzy dostają powiadomienie po potwierdzeniu
    const { res, state } = this.runFast("auth.register", work => Service.register(this.state, rec, this.today(), meta, { emailUnverified: true }, work));
    if (!state) return res;
    try { this.saveState(state, null, "auth.register", { email: res.rec.login }, rev0); }
    catch (e) { return { ok: false, error: t("Zapis w bazie nieudany — nic nie zapisano: {m}", { m: e.message }) }; }
    this.setPassword(res.rec.id, password, false);
    this.log("INFO", `Rejestracja: ${res.rec.login} — oczekuje na potwierdzenie adresu i zatwierdzenie`);
    return { ok: true, userId: res.rec.id };
  }
  /* ---------------- tokeny e-mail (jednorazowe, w bazie tylko skrót) ---------------- */
  /** Nowy token; poprzednie niewykorzystane tokeny tego rodzaju dla użytkownika tracą ważność. */
  createToken(userId, kind, hours, email, createdBy) {
    const token = randomBytes(32).toString("base64url"), now = Date.now();
    this.tx(() => {
      this.db.prepare("UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL").run(nowIso(), userId, kind);
      this.db.prepare("INSERT INTO tokens(token_hash, user_id, kind, email, created_at, expires_at, used_at, created_by) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
        .run(sha256(token), userId, kind, email || null, new Date(now).toISOString(), new Date(now + hours * 3600000).toISOString(), createdBy || null);
    });
    return token;
  }
  /** Sprawdzenie tokenu bez zużycia. Zwraca { ok, row } albo { ok:false, code: BAD|USED|EXPIRED }. */
  peekToken(token, kind) {
    if (!token || typeof token !== "string" || token.length < 20 || token.length > 100) return { ok: false, code: "BAD" };
    const row = this.db.prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = ?").get(sha256(token), kind);
    if (!row) return { ok: false, code: "BAD" };
    if (row.used_at) return { ok: false, code: "USED" };
    if (Date.parse(row.expires_at) < Date.now()) return { ok: false, code: "EXPIRED" };
    return { ok: true, row };
  }
  /** Zużycie tokenu (atomowo — drugi raz ten sam token nie przejdzie). */
  useToken(token, kind) {
    const p = this.peekToken(token, kind);
    if (!p.ok) return p;
    const r = this.db.prepare("UPDATE tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(nowIso(), p.row.token_hash);
    return r.changes === 1 ? p : { ok: false, code: "USED" };
  }
  dropTokens(userId, kind) { this.db.prepare(`UPDATE tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL${kind ? " AND kind = ?" : ""}`).run(...[nowIso(), userId].concat(kind ? [kind] : [])); }
  tokenInfo(userId) {
    return this.db.prepare("SELECT kind, created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt FROM tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(userId);
  }
  /** Wysyłka natychmiastowa (wiadomości z jednorazowym linkiem) — tylko wpis w dzienniku, bez treści; nie ponawiana. */
  logMail(template, to, userId, r, transport) {
    const ts = nowIso();
    this.db.prepare("INSERT INTO outbox(ts, template, to_addr, user_id, status, error, provider_id, transport, kind, subject, attempts, sent_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auth', ?, 1, ?, ?)")
      .run(ts, template, to, userId || null, r.ok ? "SENT" : "DEAD", r.ok ? null : String(r.error || "").slice(0, 500), r.providerId || r.file || null, transport || "", r.subject || null, r.ok ? ts : null, ts);
  }
  mailLog(limit = 200) { return this.db.prepare("SELECT id, ts, template, to_addr AS \"to\", user_id AS userId, status, error, transport FROM outbox ORDER BY id DESC LIMIT ?").all(limit); }

  /* ---------------- kolejka wysyłki (powiadomienia, wiadomości testowe) ---------------- */
  /** Ponowienia po błędzie: 1 min, 5 min, 15 min, 1 h, 6 h — potem DEAD (ręczne ponowienie przez administratora). */
  static RETRY_MINUTES = [1, 5, 15, 60, 360];
  enqueueMail(template, to, userId, subject, body, noticeId) {
    const ts = nowIso();
    return Number(this.db.prepare("INSERT INTO outbox(ts, template, to_addr, user_id, status, kind, subject, body, attempts, next_at, notice_id, updated_at) VALUES (?, ?, ?, ?, 'QUEUED', ?, ?, ?, 0, ?, ?, ?)")
      .run(ts, template, to, userId || null, template === "notice" ? "notice" : template === "document" ? "document" : "test", String(subject || "").slice(0, 300), JSON.stringify(body), ts, noticeId || null, ts).lastInsertRowid);
  }
  /** Liczba wiadomości z dokumentami wysłanych przez użytkownika od podanej chwili (limit wysyłki). */
  documentsSince(userId, sinceIso) { return this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind = 'document' AND user_id = ? AND ts >= ?").get(userId, sinceIso).n; }
  /** Wiadomości do wysłania teraz — pobranie oznacza je jako SENDING (jeden proces serwera). */
  claimDue(limit = 10) {
    const now = nowIso();
    return this.tx(() => {
      const rows = this.db.prepare("SELECT * FROM outbox WHERE status IN ('QUEUED','FAILED') AND body IS NOT NULL AND (next_at IS NULL OR next_at <= ?) ORDER BY id LIMIT ?").all(now, limit);
      for (const r of rows) this.db.prepare("UPDATE outbox SET status = 'SENDING', updated_at = ? WHERE id = ?").run(now, r.id);
      return rows;
    });
  }
  markSent(id, r, transport) {
    const now = nowIso();
    this.db.prepare("UPDATE outbox SET status = 'SENT', attempts = attempts + 1, error = NULL, body = NULL, provider_id = ?, transport = ?, sent_at = ?, next_at = NULL, updated_at = ? WHERE id = ?")
      .run(r.providerId || r.file || null, transport || "", now, now, id);
  }
  markFailed(id, error, transport) {
    const row = this.db.prepare("SELECT attempts FROM outbox WHERE id = ?").get(id);
    const n = (row ? row.attempts : 0) + 1, wait = Store.RETRY_MINUTES[n - 1];
    const dead = wait === undefined;
    this.db.prepare("UPDATE outbox SET status = ?, attempts = ?, error = ?, transport = ?, next_at = ?, updated_at = ? WHERE id = ?")
      .run(dead ? "DEAD" : "FAILED", n, String(error || "").slice(0, 500), transport || "", dead ? null : new Date(Date.now() + wait * 60000).toISOString(), nowIso(), id);
    return { dead, attempts: n };
  }
  /** Ponowienie ręczne: wiadomość nieudana / porzucona z zachowaną treścią — licznik prób od zera, wysyłka od razu. */
  retryMail(id) {
    const r = this.db.prepare("UPDATE outbox SET status = 'QUEUED', attempts = 0, next_at = ?, updated_at = ? WHERE id = ? AND status IN ('FAILED','DEAD') AND body IS NOT NULL").run(nowIso(), nowIso(), Number(id));
    return r.changes === 1;
  }
  outbox(status, limit = 300) {
    const rows = this.db.prepare(`SELECT id, ts, template, kind, to_addr AS "to", user_id AS userId, status, error, transport, subject, attempts, next_at AS nextAt, sent_at AS sentAt, notice_id AS noticeId, body IS NOT NULL AS retryable FROM outbox ${status ? "WHERE status = ?" : ""} ORDER BY id DESC LIMIT ?`)
      .all(...(status ? [status, limit] : [limit])).map(r => Object.assign(r, { retryable: !!r.retryable }));
    const stats = Object.fromEntries(this.db.prepare("SELECT status, COUNT(*) AS n FROM outbox GROUP BY status").all().map(r => [r.status, r.n]));
    return { rows, stats };
  }
  dropAccount(userId) { this.tx(() => { this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId); this.db.prepare("DELETE FROM accounts WHERE user_id = ?").run(userId); }); }

  /* ---------------- kopie zapasowe ---------------- */
  backup(reason = "manual") {
    const stamp = nowIso().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const name = `resinvest-${stamp}-${reason}.sqlite`, file = join(this.cfg.backupDir, name);
    if (existsSync(file)) return { ok: true, name, file };
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    try { this.db.prepare("INSERT INTO meta(key, value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(nowIso()); } catch (e) { /* baza sprzed tabeli meta */ }
    this.pruneBackups();
    this.log("INFO", `Kopia zapasowa: ${name}`);
    return { ok: true, name, file };
  }
  listBackups() {
    return readdirSync(this.cfg.backupDir).filter(f => /^resinvest-.*\.sqlite$/.test(f))
      .map(f => { const st = statSync(join(this.cfg.backupDir, f)); return { name: f, size: st.size, created: st.mtime.toISOString() }; })
      .sort((a, b) => a.created < b.created ? 1 : -1);
  }
  pruneBackups() {
    const limit = Date.now() - this.cfg.backup.keepDays * 86400000;
    for (const b of this.listBackups()) if (Date.parse(b.created) < limit && /-(auto|daily)\.sqlite$/.test(b.name)) { try { unlinkSync(join(this.cfg.backupDir, b.name)); } catch (e) {} }
  }
  lastBackup() { const r = this.db.prepare("SELECT value FROM meta WHERE key = 'last_backup'").get(); return r ? r.value : null; }
  /** Kopia automatyczna: raz dziennie po wskazanej godzinie, oraz przy starcie, jeśli ostatnia jest starsza niż 24 h. */
  autoBackup(force) {
    if (!this.state) return null;
    const last = this.lastBackup(), now = new Date();
    const due = force ? (!last || Date.now() - Date.parse(last) > 86400000) : (now.getHours() >= this.cfg.backup.hour && (!last || last.slice(0, 10) !== nowIso().slice(0, 10)));
    return due ? this.backup(force ? "auto" : "daily") : null;
  }
  backupPath(name) {
    const f = basename(String(name || ""));
    if (!/^resinvest-[\w-]+\.sqlite$/.test(f)) return null;
    const p = join(this.cfg.backupDir, f);
    return existsSync(p) ? p : null;
  }
  close() { try { this.db.close(); } catch (e) {} }
}
