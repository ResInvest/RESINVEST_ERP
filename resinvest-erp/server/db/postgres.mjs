/* =========================================================================
   ResInvest ERP Serwer — silnik PostgreSQL (tryb firmowy: centralna baza danych).

   Ten sam interfejs co `node:sqlite` (exec / prepare → get / all / run / iterate), więc
   rdzeń serwera (Store) wykonuje dokładnie te same polecenia i tę samą logikę transakcji:
   * polecenia SQL są tłumaczone na dialekt PostgreSQL (toPg): parametry ? → $n, aliasy
     z wielkimi literami w cudzysłowach, INSERT OR IGNORE → ON CONFLICT DO NOTHING,
     BEGIN IMMEDIATE → BEGIN, numer nowego wiersza → RETURNING,
   * wywołania są synchroniczne: wątek główny czeka (Atomics.wait) na wynik z wątku roboczego
     utrzymującego jedno połączenie — kolejność poleceń i transakcji jest ścisła,
   * zerwane połączenie: poza transakcją ponowne połączenie i (dla poleceń bezpiecznych do
     powtórzenia) ponowienie; w transakcji — błąd i wycofanie (nic nie zapisano) albo, gdy
     wynik zatwierdzenia jest nieznany, sprawdzenie w dzienniku (Store.saveState),
   * blokada doradcza „jeden serwer zapisujący na bazę” chroni przed dwoma serwerami
     pracującymi na tej samej bazie (każdy trzyma stan w pamięci).
   ========================================================================= */
import { Worker, MessageChannel, receiveMessageOnPort } from "node:worker_threads";
import { createHash } from "node:crypto";
import { PG_DDL, SERIALS } from "./schema.mjs";

const WORKER = new URL("./pg-worker.mjs", import.meta.url);
/** Stały identyfikator blokad doradczych ResInvest ERP („RIWE”). */
export const LOCK_CLASS = 0x52495745;
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
/** Zegar monotoniczny do limitów czasu (niezależny od zmiany czasu systemowego). */
const clock = () => performance.now();
const sleep = ms => { Atomics.wait(sleepBuf, 0, 0, ms); };

/* ---------------- tłumaczenie poleceń SQLite → PostgreSQL ---------------- */
const cache = new Map();
/** Zamiana znaków ? na $1…$n z pominięciem literałów tekstowych i identyfikatorów w cudzysłowach. */
function placeholders(sql) {
  let out = "", n = 0, q = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (q) { out += ch; if (ch === q) { if (sql[i + 1] === q) { out += sql[++i]; } else q = null; } continue; }
    if (ch === "'" || ch === '"') { q = ch; out += ch; continue; }
    out += ch === "?" ? "$" + (++n) : ch;
  }
  return { text: out, count: n };
}
export function toPg(sql) {
  let hit = cache.get(sql);
  if (hit) return hit;
  let s = String(sql).trim().replace(/;\s*$/, "");
  let returning = null;
  if (/^BEGIN\s+IMMEDIATE$/i.test(s)) s = "BEGIN";
  const ign = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(s);
  if (ign) s = s.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO") + " ON CONFLICT DO NOTHING";
  // aliasy kolumn pisane camelCase (userId, createdAt…) — PostgreSQL bez cudzysłowów zamienia je na małe;
  // słowa kluczowe pisane wielkimi literami (AS IDENTITY) zostają bez zmian
  s = s.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, (m, a) => /^[a-z]/.test(a) && /[A-Z]/.test(a) ? `AS "${a}"` : m);
  const ins = /^INSERT\s+INTO\s+([a-z_]+)\b/i.exec(s);
  if (ins && SERIALS[ins[1].toLowerCase()] && !/\bRETURNING\b/i.test(s)) { returning = SERIALS[ins[1].toLowerCase()]; s += ` RETURNING ${returning}`; }
  const p = placeholders(s);
  hit = { text: p.text, params: p.count, returning, name: "riw_" + createHash("sha1").update(p.text).digest("hex").slice(0, 24), readOnly: /^(SELECT|SHOW|FETCH)\b/i.test(p.text) && !/\bFOR\s+UPDATE\b/i.test(p.text), begin: /^BEGIN\b/i.test(p.text), end: /^(COMMIT|ROLLBACK|END)\b/i.test(p.text) };
  cache.set(sql, hit);
  return hit;
}

export class PgError extends Error {
  constructor(info) {
    super(info.message);
    this.name = "PgError"; this.code = info.code || ""; this.detail = info.detail || ""; this.constraint = info.constraint || "";
    this.connectionLost = !!info.connection; this.notSent = !!info.notSent;
  }
}

class PgStatement {
  constructor(db, sql) { this.db = db; this.q = toPg(sql); }
  _run(args) {
    if (args.length !== this.q.params) throw new Error(`Liczba parametrów (${args.length}) nie zgadza się z poleceniem (${this.q.params}): ${this.q.text.slice(0, 120)}`);
    return this.db._query(this.q, args.map(v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? v.toString() : v));
  }
  get(...args) { return this._run(args).rows[0]; }
  all(...args) { return this._run(args).rows; }
  iterate(...args) { return this._run(args).rows[Symbol.iterator](); }
  run(...args) {
    const r = this._run(args);
    const out = { changes: r.rowCount || 0, lastInsertRowid: 0 };
    if (this.q.returning && r.rows[0]) out.lastInsertRowid = r.rows[0][this.q.returning];
    return out;
  }
}

export class PgDb {
  /**
   * @param conn { client: opcje pg.Client (connectionString | host/port/database/user/password, ssl, application_name,
   *               connectionTimeoutMillis), schema, statementTimeoutMs, callTimeoutMs, reconnectSeconds }
   */
  constructor(conn, log) {
    this.dialect = "postgres";
    this.conn = conn; this.log = log || (() => {});
    this.callTimeoutMs = conn.callTimeoutMs || 120000;
    this.reconnectSeconds = conn.reconnectSeconds === undefined ? 20 : conn.reconnectSeconds;
    this.inTx = false; this.connected = false; this.closed = false; this.writerLock = false; this.reconnects = 0;
    this._spawn();
    this._connect();
    if (this.info.num < 140000) { const v = this.info.ver; this.close(); throw new Error(`ResInvest ERP wymaga PostgreSQL 14 lub nowszego (serwer bazy: ${v}).`); }
  }
  _spawn() {
    const sab = new SharedArrayBuffer(4);
    const { port1, port2 } = new MessageChannel();
    this.flag = new Int32Array(sab); this.port = port1;
    this.worker = new Worker(WORKER, { workerData: { sab, port: port2, conn: this.conn }, transferList: [port2] });
    this.worker.on("error", e => { this.connected = false; this.workerError = e; });
    this.worker.unref(); port1.unref();
  }
  /** Wywołanie synchroniczne: polecenie → wątek roboczy → oczekiwanie na wynik. */
  _call(msg, timeoutMs) {
    if (this.closed) throw new PgError({ message: "Połączenie z bazą jest zamknięte", connection: true, notSent: true });
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage(msg);
    const deadline = clock() + (timeoutMs || this.callTimeoutMs);
    let m;
    for (;;) {
      const left = deadline - clock();
      const w = left > 0 ? Atomics.wait(this.flag, 0, 0, Math.min(left, 1000)) : "timed-out";
      m = receiveMessageOnPort(this.port);
      if (m) break;
      if (this.workerError) { const e = this.workerError; this.workerError = null; this._respawn(); throw new PgError({ message: "Wątek połączenia z bazą zakończył pracę: " + e.message, connection: true }); }
      if (w === "timed-out" && left <= 0) { this._respawn(); throw new PgError({ message: `Baza PostgreSQL nie odpowiedziała w ciągu ${Math.round((timeoutMs || this.callTimeoutMs) / 1000)} s`, connection: true, code: "TIMEOUT" }); }
      if (w === "not-equal") Atomics.store(this.flag, 0, 0);   // sygnał przyszedł przed wiadomością — czekaj dalej
    }
    const r = m.message;
    if (!r.ok) throw new PgError(r.error);
    return r.value;
  }
  _respawn() {
    this.connected = false;
    try { this.worker.terminate(); } catch (e) { /* wątek już zakończony */ }
    this._spawn();
  }
  _connect() {
    this.info = this._call({ op: "connect" }, (this.conn.client.connectionTimeoutMillis || 15000) + 5000);
    this.connected = true; this.inTx = false;
    return this.info;
  }
  /**
   * Ponowne połączenie (do `reconnectSeconds`), np. po restarcie bazy lub chwilowej przerwie w sieci.
   * Blokada serwera zapisującego jest odzyskiwana; gdy przejął ją inny serwer — błąd (ten proces nie może dalej zapisywać).
   */
  reconnect() {
    const until = clock() + this.reconnectSeconds * 1000;
    let wait = 250, last = null;
    for (;;) {
      try {
        this._connect(); this.reconnects++;
        this.log("WARN", `Połączenie z bazą PostgreSQL odzyskane (${this.describe()})`);
        break;
      } catch (e) {
        last = e;
        if (clock() + wait > until) throw new PgError({ message: `Brak połączenia z bazą PostgreSQL: ${e.message}`, connection: true, notSent: true, code: e.code });
        sleep(wait); wait = Math.min(wait * 2, 2000);
      }
    }
    if (this.writerLock) {
      const r = this._lock();
      if (!r.ok) { this.fenced = true; const e = new PgError({ message: "Po ponownym połączeniu bazę obsługuje inny serwer ResInvest ERP — ten proces nie może dalej zapisywać.", code: "RIW_FENCED" }); e.fatal = true; throw e; }
    }
    return last;
  }
  /** Po błędzie połączenia w transakcji: przywraca połączenie, żeby można było sprawdzić wynik. true = połączono. */
  recover() {
    this.inTx = false;
    if (this.connected) return true;
    try { this.reconnect(); return true; } catch (e) { if (e.fatal) throw e; return false; }
  }
  _query(q, values) {
    const msg = values ? { op: "query", text: q.text, values, name: q.name } : { op: "query", text: q.text };
    if (this.fenced) { const e = new PgError({ message: "Bazę obsługuje inny serwer ResInvest ERP — ten proces nie może zapisywać. Zatrzymaj ten serwer.", code: "RIW_FENCED" }); e.fatal = true; throw e; }
    try {
      if (!this.connected && /^ROLLBACK\b/i.test(q.text)) { this.inTx = false; return { rows: [], rowCount: 0 }; }   // transakcja przepadła z połączeniem
      if (!this.connected && !this.inTx) this.reconnect();
      const r = this._call(msg);
      if (q.begin) this.inTx = true; else if (q.end) this.inTx = false;
      return r;
    } catch (e) {
      if (!(e instanceof PgError) || !e.connectionLost) { if (q.end) this.inTx = false; throw e; }
      this.connected = false;
      if (this.inTx || q.end) { this.inTx = false; throw e; }                    // transakcja przepadła razem z połączeniem
      if (!(e.notSent || q.readOnly || q.begin)) throw e;                         // zapis o nieznanym wyniku — nie powtarzamy
      this.reconnect();
      const r = this._call(msg);
      if (q.begin) this.inTx = true;
      return r;
    }
  }
  exec(sql) { return this._query(toPg(sql), null); }
  prepare(sql) { return new PgStatement(this, sql); }
  /** Kilka poleceń w jednej wymianie z wątkiem roboczym (mniej przełączeń; używane przy przenoszeniu danych). */
  batch(list) { return this._call({ op: "batch", list }); }
  hasTable(name) { return !!this.prepare("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?").get(name); }
  /** Schemat tworzony w jednej transakcji z blokadą — równoczesny start serwera i narzędzia nie koliduje. */
  ensureSchema() {
    this.txBatch([{ text: `SELECT pg_advisory_xact_lock(${LOCK_CLASS}, 1)` }, ...PG_DDL.map(text => ({ text }))]);
  }
  /** Lista poleceń w jednej transakcji; błąd = wycofanie całości. */
  txBatch(list) {
    try { const r = this.batch([{ text: "BEGIN" }, ...list, { text: "COMMIT" }]); this.inTx = false; return r; }
    catch (e) { this.inTx = false; if (!e.connectionLost) { try { this._call({ op: "query", text: "ROLLBACK" }); } catch (x) { /* połączenie zerwane — transakcja i tak wycofana */ } } else this.connected = false; throw e; }
  }
  _lock() {
    const r = this._call({ op: "query", text: `SELECT pg_try_advisory_lock(${LOCK_CLASS}, hashtext(current_schema())) AS ok` });
    return { ok: !!r.rows[0].ok };
  }
  /**
   * Blokada „jeden serwer zapisujący”: trzymana przez cały czas pracy serwera (zwalnia ją zamknięcie połączenia).
   * Druga instancja serwera na tej samej bazie dostaje odmowę z informacją, kto trzyma blokadę.
   */
  acquireWriterLock() {
    const r = this._lock();
    if (r.ok) { this.writerLock = true; return { ok: true }; }
    let holder = "";
    try {
      const h = this._call({ op: "query", text: `SELECT a.application_name AS app, COALESCE(a.client_addr::text, 'lokalnie') AS addr, a.backend_start::text AS since FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.classid = ${LOCK_CLASS} AND l.granted AND l.objsubid = 2 AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database()) LIMIT 1` }).rows[0];
      if (h) holder = `${h.app || "?"} z adresu ${h.addr}, połączony od ${String(h.since).slice(0, 19)}`;
    } catch (e) { /* brak uprawnień do pg_stat_activity — komunikat bez szczegółów */ }
    return { ok: false, holder };
  }
  describe() { const i = this.info || {}; return `PostgreSQL ${i.ver || "?"} · ${i.host || "gniazdo lokalne"}:${i.port || ""}/${i.db || "?"} (schemat ${i.schema || "?"}, użytkownik ${i.usr || "?"})`; }
  close() {
    if (this.closed) return;
    try { this._call({ op: "close" }, 5000); } catch (e) { /* połączenie już zerwane */ }
    this.closed = true; this.connected = false;
    try { this.worker.terminate(); } catch (e) { /* wątek już zakończony */ }
    try { this.port.close(); } catch (e) { /* kanał już zamknięty */ }
  }
}
