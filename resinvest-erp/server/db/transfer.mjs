/* =========================================================================
   ResInvest ERP Serwer — przenoszenie danych między SQLite a PostgreSQL.

   * importSqliteIntoPg — cała baza SQLite → PostgreSQL w JEDNEJ transakcji (wszystko albo nic);
     identyfikatory, kolejność, sumy kontrolne i dziennik zmian przenoszone bez przeliczania,
   * exportPgToSqlite   — spójny obraz bazy PostgreSQL (REPEATABLE READ) → plik .sqlite w formacie
     serwera: kopia zapasowa, przywracanie i wycofanie migracji używają jednego formatu pliku,
   * fingerprint        — liczba wierszy i skrót SHA-256 każdej tabeli, liczone tak samo po obu stronach
     (porównanie „przed i po” niezależne od silnika bazy).

   Plik źródłowy SQLite jest otwierany wyłącznie do odczytu — narzędzie migracji pracuje dodatkowo
   na kopii roboczej, więc oryginał nie jest dotykany.
   ========================================================================= */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { TABLES, PG_DDL, PG_TYPE, SQLITE_DDL, OUTBOX_EXTRA } from "./schema.mjs";
import { LOCK_CLASS } from "./postgres.mjs";

/** Wartości kolumn nieobecnych w starszych bazach SQLite (kolejka poczty sprzed 3.5). */
const DEFAULTS = { outbox: { kind: "auth", attempts: 0 } };
const sha = s => createHash("sha256").update(s).digest("hex");
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Znak NUL w tekście: PostgreSQL go nie przechowuje, a sterownik node:sqlite zwraca taki tekst tylko do znaku NUL
 * (tak też widzi go serwer pracujący na SQLite). Przenoszona jest więc wartość widoczna dla programu; liczba takich
 * wartości trafia do raportu (countNul). Poniższe czyszczenie to dodatkowe zabezpieczenie.
 */
function clean(v, stats) {
  if (typeof v === "string" && v.includes("\u0000")) { if (stats) stats.nul++; return v.replaceAll("\u0000", ""); }
  return v;
}
function norm(type, v, stats) {
  if (v === null || v === undefined) return null;
  if (type === "t") return clean(typeof v === "string" ? v : String(v), stats);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error("Wartość nieliczbowa w kolumnie liczbowej: " + String(v).slice(0, 40));
  if (type === "i" && !Number.isSafeInteger(n)) throw new Error("Liczba całkowita poza zakresem: " + v);
  return n;
}
const sqliteCols = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
const sqliteHas = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

/** Wiersze tabeli SQLite w układzie kolumn schematu (brakujące kolumny → wartość domyślna). */
function* sqliteRows(db, t, stats) {
  if (!sqliteHas(db, t.name)) return;
  const have = sqliteCols(db, t.name);
  const sel = t.cols.filter(([c]) => have.has(c)).map(([c]) => `"${c}"`).join(", ");
  for (const r of db.prepare(`SELECT ${sel} FROM "${t.name}"`).iterate())
    yield t.cols.map(([c, type]) => norm(type, have.has(c) ? r[c] : ((DEFAULTS[t.name] || {})[c] ?? null), stats));
}

/** Skrót tabeli: wiersze uporządkowane po kluczu (porównanie w JS — niezależne od sortowania w bazie). */
function tableDigest(t, rowsIter) {
  const keyIdx = t.key.map(k => t.cols.findIndex(([c]) => c === k));
  const list = [];
  for (const row of rowsIter) list.push([keyIdx.map(i => row[i]), sha(JSON.stringify(row))]);
  list.sort((a, b) => { for (let i = 0; i < a[0].length; i++) { const c = cmp(a[0][i], b[0][i]); if (c) return c; } return 0; });
  const h = createHash("sha256");
  for (const [, s] of list) h.update(s);
  return { count: list.length, sha256: h.digest("hex") };
}

/** Liczba wartości tekstowych zawierających znak NUL (sprawdzane na surowych bajtach). */
export function countNul(db) {
  const raw = db.raw || db; let n = 0;
  for (const t of TABLES) {
    if (!sqliteHas(raw, t.name)) continue;
    const have = sqliteCols(raw, t.name);
    for (const [c, type] of t.cols) if (type === "t" && have.has(c)) n += raw.prepare(`SELECT COUNT(*) AS n FROM "${t.name}" WHERE instr(CAST("${c}" AS BLOB), x'00') > 0`).get().n;
  }
  return n;
}
/** Odcisk bazy SQLite: { tabela: { count, sha256 } } + liczba wartości tekstowych ze znakiem NUL. */
export function fingerprintSqlite(db) {
  const raw = db.raw || db, stats = { nul: 0 }, out = {};
  for (const t of TABLES) out[t.name] = tableDigest(t, sqliteRows(raw, t, stats));
  return { tables: out, nul: stats.nul + countNul(raw) };
}

/** Wiersze tabeli PostgreSQL porcjami (kursor w bieżącej transakcji). */
function* pgRows(pg, t, chunk = 2000) {
  const cur = "riw_cur_" + t.name;
  pg.exec(`DECLARE ${cur} NO SCROLL CURSOR FOR SELECT ${t.cols.map(([c]) => `"${c}"`).join(", ")} FROM "${t.name}"`);
  try {
    for (;;) {
      const rows = pg._query({ text: `FETCH ${chunk} FROM ${cur}` }, null).rows;
      for (const r of rows) yield t.cols.map(([c, type]) => norm(type, r[c]));
      if (rows.length < chunk) break;
    }
  } finally { try { pg.exec(`CLOSE ${cur}`); } catch (e) { /* transakcja przerwana — kursor zamknięty razem z nią */ } }
}
function pgSnapshot(pg, fn) {
  pg.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try { const r = fn(); pg.exec("COMMIT"); return r; }
  catch (e) { try { pg.exec("ROLLBACK"); } catch (x) { /* połączenie zerwane */ } throw e; }
}
/** Odcisk bazy PostgreSQL (jeden spójny obraz danych). */
export function fingerprintPg(pg) { return pgSnapshot(pg, () => pgDigests(pg)); }
/** Odcisk tabel w bieżącej transakcji (także: kontrola importu przed zatwierdzeniem). */
function pgDigests(pg) {
  const out = {};
  for (const t of TABLES) out[t.name] = pg.hasTable(t.name) ? tableDigest(t, pgRows(pg, t)) : tableDigest(t, []);
  return { tables: out, nul: 0 };
}
/** Porównanie odcisków: lista różnic (pusta = dane identyczne). */
export function diffFingerprints(a, b) {
  const diff = [];
  for (const t of TABLES) {
    const x = a.tables[t.name], y = b.tables[t.name];
    if (x.count !== y.count || x.sha256 !== y.sha256) diff.push({ table: t.name, source: x, target: y });
  }
  return diff;
}

/** Liczba wierszy w tabelach PostgreSQL (0 dla brakujących tabel). */
export function pgCounts(pg) {
  const out = {};
  for (const t of TABLES) out[t.name] = pg.hasTable(t.name) ? pg.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n : 0;
  return out;
}

/**
 * Import bazy SQLite do PostgreSQL. Jedna transakcja: przerwanie w dowolnym miejscu zostawia bazę docelową bez zmian.
 * Baza docelowa z danymi wymaga `replace: true` (tabele są wtedy tworzone od nowa).
 * `verify` (odcisk źródła z fingerprintSqlite): dane w PostgreSQL są porównywane ze źródłem PRZED zatwierdzeniem —
 * jakakolwiek różnica wycofuje cały import.
 * @returns { tables: { nazwa: liczba wierszy }, nul, ms, verified }
 */
export function importSqliteIntoPg(pg, sqliteFile, { replace = false, log = () => {}, verify = null } = {}) {
  if (!existsSync(sqliteFile)) throw new Error("Brak pliku SQLite: " + sqliteFile);
  const src = new DatabaseSync(sqliteFile, { readOnly: true });
  const t0 = performance.now(), stats = { nul: 0 }, counts = {};
  let verified = null;
  try {
    if (!sqliteHas(src, "state")) throw new Error("Plik nie jest bazą ResInvest ERP (brak tabeli state): " + sqliteFile);
    pg.exec("BEGIN");
    try {
      pg.exec(`SELECT pg_advisory_xact_lock(${LOCK_CLASS}, 1)`);
      const existing = pgCounts(pg), used = Object.entries(existing).filter(([, n]) => n > 0);
      if (used.length && !replace) throw new Error(`Baza PostgreSQL zawiera już dane (${used.map(([k, n]) => `${k}: ${n}`).join(", ")}). Import przerwany — nic nie zmieniono. Zastąpienie danych wymaga jawnej opcji --replace.`);
      for (const t of [...TABLES].reverse()) pg.exec(`DROP TABLE IF EXISTS "${t.name}" CASCADE`);
      for (const ddl of PG_DDL) pg.exec(ddl);
      for (const t of TABLES) {
        const names = t.cols.map(([c]) => `"${c}"`).join(", ");
        const text = `INSERT INTO "${t.name}"(${names}) SELECT * FROM unnest(${t.cols.map(([, type], i) => `$${i + 1}::${PG_TYPE[type]}[]`).join(", ")})`;
        let cols = t.cols.map(() => []), n = 0, bytes = 0, total = 0;
        const flush = () => { if (!n) return; pg._query({ text }, cols); total += n; cols = t.cols.map(() => []); n = 0; bytes = 0; };
        for (const row of sqliteRows(src, t, stats)) {
          for (let i = 0; i < row.length; i++) { cols[i].push(row[i]); if (typeof row[i] === "string") bytes += row[i].length; }
          if (++n >= 1000 || bytes > 4e6) flush();
        }
        flush();
        counts[t.name] = total;
        if (t.serial && total) {
          // numeracja: następny numer = większy z (najwyższy identyfikator, licznik AUTOINCREMENT w SQLite)
          const seqRow = sqliteHas(src, "sqlite_sequence") ? src.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(t.name) : null;
          const top = Math.max(Number(seqRow ? seqRow.seq : 0) || 0, pg.prepare(`SELECT COALESCE(MAX("${t.serial}"), 0) AS m FROM "${t.name}"`).get().m);
          if (top > 0) pg.prepare(`SELECT setval(pg_get_serial_sequence('${t.name}', '${t.serial}'), ?, true)`).get(top);
        }
        log("INFO", `Import ${t.name}: ${total}`);
      }
      if (verify) {
        verified = pgDigests(pg);
        const diff = diffFingerprints(verify, verified);
        if (diff.length) throw new Error("Kontrola zgodności po imporcie nieudana (import wycofany, baza docelowa bez zmian): " + diff.map(d => `${d.table}: źródło ${d.source.count} wierszy / cel ${d.target.count}`).join("; "));
      }
      pg.exec("COMMIT");
    } catch (e) { try { pg.exec("ROLLBACK"); } catch (x) { /* połączenie zerwane — transakcja wycofana przez bazę */ } throw e; }
  } finally { src.close(); }
  return { tables: counts, nul: stats.nul, ms: Math.round(performance.now() - t0), verified };
}

/**
 * Spójny obraz bazy PostgreSQL zapisany jako plik SQLite w formacie serwera (te same tabele, wyzwalacze, numeracja).
 * Plik powstaje pod nazwą tymczasową i jest przemianowywany po pełnym zapisie — nigdy nie jest „w połowie”.
 */
export function exportPgToSqlite(pg, file) {
  if (existsSync(file)) throw new Error("Plik już istnieje: " + file);
  const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`, t0 = performance.now(), counts = {};
  const out = new DatabaseSync(tmp);
  let done = false;
  try {
    out.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;" + SQLITE_DDL);
    for (const [c, def] of OUTBOX_EXTRA) out.exec(`ALTER TABLE outbox ADD COLUMN ${c} ${def}`);
    out.exec("CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_at)");
    pgSnapshot(pg, () => {
      out.exec("BEGIN IMMEDIATE");
      for (const t of TABLES) {
        const ins = out.prepare(`INSERT INTO "${t.name}"(${t.cols.map(([c]) => `"${c}"`).join(", ")}) VALUES (${t.cols.map(() => "?").join(", ")})`);
        let n = 0;
        if (pg.hasTable(t.name)) for (const row of pgRows(pg, t)) { ins.run(...row); n++; }
        counts[t.name] = n;
        if (t.serial && n) {
          const last = pg.prepare(`SELECT last_value AS v, is_called AS c FROM ${pg.prepare(`SELECT pg_get_serial_sequence('${t.name}', '${t.serial}') AS s`).get().s}`).get();
          if (last && last.c) out.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?").run(last.v, t.name);
        }
      }
      out.exec("COMMIT");
    });
    const chk = out.prepare("PRAGMA integrity_check").get();
    if (!chk || Object.values(chk)[0] !== "ok") throw new Error("Kontrola pliku kopii nieudana: " + JSON.stringify(chk));
    done = true;
  } finally {
    try { out.close(); } catch (e) { /* plik już zamknięty */ }
    if (!done) { try { unlinkSync(tmp); } catch (e) { /* brak pliku tymczasowego */ } }
  }
  renameSync(tmp, file);
  return { tables: counts, ms: Math.round(performance.now() - t0) };
}
