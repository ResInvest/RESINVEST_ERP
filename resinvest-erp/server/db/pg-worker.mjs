/* =========================================================================
   ResInvest ERP Serwer — wątek roboczy połączenia z PostgreSQL.

   Sterownik `pg` jest asynchroniczny, a rdzeń serwera (Store) — synchroniczny
   (każda komenda to jedna, niepodzielna sekwencja: silnik → transakcja → stan w pamięci).
   Ten wątek utrzymuje JEDNO połączenie z bazą i wykonuje polecenia przysłane z wątku
   głównego; wątek główny czeka na wynik (Atomics.wait) — patrz postgres.mjs.
   Jedno połączenie = ścisła kolejność poleceń i transakcji, tak jak w SQLite.
   ========================================================================= */
import { workerData } from "node:worker_threads";
import pg from "pg";

const { port, sab, conn } = workerData;
const flag = new Int32Array(sab);
let client = null, broken = null;

/** BIGINT (int8) jako liczba JS — rewizje i identyfikatory mieszczą się w 2^53; wartość spoza zakresu to błąd, nie utrata precyzji. */
const types = {
  getTypeParser(oid, format) {
    if (oid === 20) return v => { if (v === null) return null; const n = Number(v); if (!Number.isSafeInteger(n)) throw new Error("BIGINT poza zakresem bezpiecznych liczb całkowitych: " + v); return n; };
    return pg.types.getTypeParser(oid, format);
  }
};

const CONN_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "08P01"]);
function isConnError(e) {
  if (!e) return false;
  if (CONN_CODES.has(e.code)) return true;
  return /Connection terminated|not queryable|connection error|Client was closed|ECONNRESET|socket hang up|timeout expired/i.test(String(e.message || ""));
}

async function connect() {
  // stare połączenie zamykane bez czekania (zerwane gniazdo mogłoby wstrzymać zakończenie) — gniazdo niszczone od razu
  if (client) { const old = client; try { old.removeAllListeners("error"); old.on("error", () => {}); old.end().catch(() => {}); old.connection.stream.destroy(); } catch (e) { /* stare połączenie już zerwane */ } }
  client = null; broken = null;
  const c = new pg.Client(Object.assign({}, conn.client, { types }));
  c.on("error", e => { if (client === c) broken = e; });
  await c.connect();
  client = c;
  const init = [`SET client_encoding = 'UTF8'`, `SET standard_conforming_strings = on`];
  if (conn.schema) init.push(`SET search_path = ${pg.Client.prototype.escapeIdentifier(conn.schema)}`);
  if (conn.statementTimeoutMs) init.push(`SET statement_timeout = ${Number(conn.statementTimeoutMs) | 0}`);
  init.push(`SET lock_timeout = ${Number(conn.lockTimeoutMs || 15000) | 0}`);
  init.push(`SET idle_in_transaction_session_timeout = ${Number(conn.idleInTxTimeoutMs || 120000) | 0}`);
  await c.query(init.join("; "));
  const v = await c.query("SELECT current_setting('server_version_num')::int AS num, current_setting('server_version') AS ver, current_database() AS db, current_schema() AS schema, current_user AS usr, host(inet_server_addr()) AS host, inet_server_port() AS port, pg_backend_pid() AS pid");
  return v.rows[0];
}

const pick = r => ({ rows: r.rows, rowCount: r.rowCount });
async function query(m) {
  if (!client || broken) { const e = new Error("Brak połączenia z bazą PostgreSQL" + (broken ? ": " + broken.message : "")); e.notSent = true; e.connection = true; throw e; }
  const r = await client.query(m.values ? Object.assign({ text: m.text, values: m.values }, m.name ? { name: m.name } : {}) : m.text);
  return Array.isArray(r) ? pick(r[r.length - 1]) : pick(r);
}

async function handle(m) {
  switch (m.op) {
    case "connect": return connect();
    case "query": return query(m);
    case "batch": { let last = null; for (const q of m.list) last = await query(q); return last; }
    case "close": if (client) { try { await client.end(); } catch (e) { /* już zamknięte */ } client = null; } return true;
    default: throw new Error("Nieznane polecenie wątku bazy: " + m.op);
  }
}

port.on("message", async m => {
  let out;
  try { out = { ok: true, value: await handle(m) }; }
  catch (e) {
    const connection = !!(e && (e.connection || isConnError(e) || broken));
    out = { ok: false, error: { message: String((e && e.message) || e), code: (e && e.code) || "", detail: (e && e.detail) || "", constraint: (e && e.constraint) || "", connection, notSent: !!(e && e.notSent) } };
  }
  port.postMessage(out);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
