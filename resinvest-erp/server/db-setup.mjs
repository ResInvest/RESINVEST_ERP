/* =========================================================================
   ResInvest ERP Serwer — przygotowanie bazy PostgreSQL i przeniesienie danych (instalator, strona „Baza danych”).

   Uruchamiane przez instalator po skopiowaniu plików (serwer zatrzymany):
     riw-server.mjs --data <katalog danych> --db-setup <plik.json>
   Plik JSON (tymczasowy, usuwany przez instalator — hasła nie trafiają do wiersza poleceń ani do dziennika):
     { mode: "postgres" | "sqlite", host, port, database, user, password, adminUser, adminPassword, ssl, resultFile }

   Kroki (mode = postgres):
     1. z hasłem administratora PostgreSQL: konto programu (bez uprawnień administratora) i baza programu —
        tworzone, gdy ich nie ma; puste hasło konta programu = hasło losowe (zapisywane tylko w server.env),
     2. próba połączenia kontem programu (PostgreSQL 14+),
     3. zapis DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD / DB_SSL do <dane>\server.env,
     4. dane:
        * serwer już pracuje na PostgreSQL → bez zmian,
        * jest baza SQLite z danymi, a PostgreSQL jest pusty → migracja (server/migrate.mjs: jedna transakcja,
          kontrola każdej tabeli przed zatwierdzeniem, plik SQLite tylko czytany) → DB_DRIVER=postgres,
        * w PostgreSQL są już te same dane co w SQLite (np. ponowna instalacja) → DB_DRIVER=postgres,
        * w PostgreSQL są inne dane → nic nie jest nadpisywane, serwer zostaje na SQLite (decyzja administratora),
        * brak danych SQLite (nowa instalacja) → DB_DRIVER=postgres (konto startowe powstanie przy pierwszym starcie).
     Każdy błąd zostawia serwer na dotychczasowej bazie — dane nie są tracone, program działa dalej.

   Kody wyjścia: 0 — gotowe, 2 — błędne dane albo brak połączenia, 3 — migracja nieudana (serwer na SQLite),
                 4 — w PostgreSQL są inne dane (serwer na SQLite, nic nie nadpisano).
   ========================================================================= */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadEnv } from "./core.mjs";
import { databaseConfig } from "./db/index.mjs";
import { PgDb } from "./db/postgres.mjs";
import { pgCounts } from "./db/transfer.mjs";
import { migrateToPostgres, verifyAgainstPostgres } from "./migrate.mjs";

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** Wartość do pliku KLUCZ=wartość (jak zapis poczty w riw-server.mjs): cudzysłów, gdy potrzebny; null = niedozwolone znaki. */
function envValue(v) {
  const x = String(v == null ? "" : v);
  if (/[\r\n]/.test(x)) return null;
  if (!/[\s#"']/.test(x)) return x;
  if (!x.includes('"')) return `"${x}"`;
  if (!x.includes("'")) return `'${x}'`;
  return null;
}
function setEnvLine(text, key, value) {
  const re = new RegExp(`^[ \\t]*(?:#[ \\t]*)?${key}[ \\t]*=.*$`, "m");
  const active = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, "m");
  const line = `${key}=${value}`;
  if (active.test(text)) return text.replace(active, () => line);
  if (re.test(text)) return text.replace(re, () => line);
  return `${text.replace(/\s*$/, "")}\r\n${line}\r\n`;
}
/** Zapis kluczy do <dane>\server.env (plik tymczasowy → zmiana nazwy: plik nigdy nie jest zapisany w połowie). */
export function writeEnvKeys(dataDir, values) {
  const file = join(dataDir, "server.env");
  let text = existsSync(file) ? readFileSync(file, "utf8") : "# ResInvest ERP Serwer — ustawienia administratora\r\n";
  for (const [k, v] of Object.entries(values)) {
    const ev = envValue(v);
    if (ev === null) throw new Error(`Wartość ${k} zawiera niedozwolone znaki (znak nowej linii albo oba rodzaje cudzysłowów)`);
    text = setEnvLine(text, k, ev);
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file + ".tmp", text.replace(/\r?\n/g, "\r\n")); renameSync(file + ".tmp", file);
  return file;
}

/**
 * Czy plik SQLite zawiera dane programu. Otwarcie w trybie niezmiennym (immutable): bez plików -wal / -shm obok bazy —
 * źródło zostaje nietknięte. Niepusty plik -wal (serwer przerwany przed zapisem punktu kontrolnego) = są dane;
 * migracja i tak pracuje na kopii bazy razem z plikiem -wal.
 */
function hasSqliteData(file) {
  if (!existsSync(file)) return false;
  if (existsSync(file + "-wal") && statSync(file + "-wal").size > 0) return true;
  const url = pathToFileURL(file); url.searchParams.set("immutable", "1");
  const db = new DatabaseSync(url, { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'state'").get()) return false;
    return !!db.prepare("SELECT 1 AS x FROM state WHERE id = 1").get();
  } finally { db.close(); }
}
const clientOf = (b, user, password, database) => {
  const c = { host: b.host, port: b.port, database, user, password, application_name: "resinvest-erp-setup", connectionTimeoutMillis: 15000 };
  if (b.ssl === "disable") c.ssl = false; else if (b.ssl === "require") c.ssl = { rejectUnauthorized: false }; else if (b.ssl === "verify-full") c.ssl = { rejectUnauthorized: true };
  return c;
};

/** Konto i baza programu (konto administratora PostgreSQL). Zwraca opis wykonanych czynności. */
function provision(b, password) {
  const out = [];
  const adm = new PgDb({ client: clientOf(b, b.adminUser, b.adminPassword, b.adminDatabase || "postgres"), reconnectSeconds: 0 });
  try {
    const role = adm.prepare("SELECT rolsuper AS su FROM pg_roles WHERE rolname = ?").get(b.user);
    if (role && role.su) throw new Error(`Konto „${b.user}” ma uprawnienia administratora PostgreSQL — program wymaga zwykłego konta. Wpisz inną nazwę konta programu.`);
    // CREATE ROLE / ALTER ROLE nie przyjmują parametrów — nazwa i hasło cytowane przez samą bazę (format %I / %L)
    const ddl = adm.prepare(role
      ? "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ?::text, ?::text) AS sql"
      : "SELECT format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', ?::text, ?::text) AS sql").get(b.user, password).sql;
    adm.exec(ddl);
    out.push(role ? `konto ${b.user}: hasło ustawione` : `konto ${b.user}: utworzone`);
    const db = adm.prepare("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ?").get(b.database);
    if (!db) {
      adm.exec(adm.prepare("SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', ?::text, ?::text) AS sql").get(b.database, b.user).sql);
      out.push(`baza ${b.database}: utworzona (właściciel ${b.user})`);
    } else if (db.owner !== b.user) {
      throw new Error(`Baza „${b.database}” istnieje i należy do konta „${db.owner}”. Wpisz inną nazwę bazy albo konto „${db.owner}” jako konto programu.`);
    } else out.push(`baza ${b.database}: istnieje`);
  } finally { adm.close(); }
  return out;
}

/**
 * Przygotowanie bazy. `cfg` — konfiguracja serwera (loadConfig), `b` — dane z kreatora.
 * @returns { code, lines[] } — kod wyjścia i komunikat dla administratora (bez haseł).
 */
export function dbSetup(cfg, b, log = () => {}) {
  const lines = [];
  const mode = String(b.mode || "postgres").toLowerCase();
  if (mode === "sqlite") {
    writeEnvKeys(cfg.dataDir, { DB_DRIVER: "sqlite" });
    return { code: 0, lines: ["Baza danych: SQLite (plik lokalny na tym komputerze). Przejście na PostgreSQL: ponowna instalacja albo docs\\POSTGRESQL.md."] };
  }
  if (mode !== "postgres") return { code: 2, lines: ["Błąd: nieznany tryb bazy „" + mode + "”"] };
  const s = {
    host: String(b.host || "127.0.0.1").trim(), port: Number(b.port) || 5432,
    database: String(b.database || "resinvest").trim().toLowerCase(), user: String(b.user || "resinvest_app").trim().toLowerCase(),
    adminUser: String(b.adminUser || "postgres").trim(), adminPassword: String(b.adminPassword || ""), adminDatabase: String(b.adminDatabase || "postgres"),
    ssl: ["disable", "require", "verify-full"].includes(b.ssl) ? b.ssl : ""
  };
  if (!/^[A-Za-z0-9.:_-]{1,253}$/.test(s.host)) return { code: 2, lines: ["Błąd: nieprawidłowy adres serwera PostgreSQL"] };
  if (!(s.port > 0 && s.port < 65536)) return { code: 2, lines: ["Błąd: nieprawidłowy port PostgreSQL"] };
  if (!IDENT.test(s.database) || !IDENT.test(s.user)) return { code: 2, lines: ["Błąd: nazwa bazy i konta programu — małe litery, cyfry i podkreślenie (np. resinvest, resinvest_app)"] };
  let password = String(b.password || "");
  if (!password && !s.adminPassword) return { code: 2, lines: ["Błąd: wpisz hasło konta programu albo hasło administratora PostgreSQL (wtedy konto i baza zostaną utworzone, a hasło konta programu wygenerowane)."] };
  if (!password) password = "Riw-" + randomBytes(24).toString("base64url");
  if (envValue(password) === null) return { code: 2, lines: ["Błąd: hasło konta programu nie może zawierać znaku nowej linii ani jednocześnie obu rodzajów cudzysłowów"] };

  // 1. konto i baza programu
  if (s.adminPassword) {
    try { for (const l of provision(s, password)) lines.push("PostgreSQL: " + l); }
    catch (e) { return { code: 2, lines: lines.concat("Błąd przygotowania bazy (konto administratora " + s.adminUser + "): " + e.message) }; }
  }
  // 2. połączenie kontem programu
  const values = { DB_HOST: s.host, DB_PORT: String(s.port), DB_NAME: s.database, DB_USER: s.user, DB_PASSWORD: password, DB_SSL: s.ssl };
  let pgCfg;
  try {
    pgCfg = databaseConfig(Object.assign({}, values, { DB_DRIVER: "postgres" }));
    const pg = new PgDb(Object.assign({}, pgCfg, { reconnectSeconds: 0 }));
    try { lines.push("Połączenie: " + pg.describe()); pg.ensureSchema(); } finally { pg.close(); }
  } catch (e) {
    return { code: 2, lines: lines.concat("Błąd połączenia kontem programu (" + s.user + "@" + s.host + ":" + s.port + "/" + s.database + "): " + e.message) };
  }
  // 3. dane połączenia do server.env (silnik bazy przełączany dopiero po udanej migracji)
  const envFile = writeEnvKeys(cfg.dataDir, values);
  lines.push("Zapisano dane połączenia: " + envFile);

  // 4. dane
  let current = "sqlite";
  try { current = databaseConfig(loadEnv(cfg.dataDir).env).driver; } catch (e) { /* błędna konfiguracja = traktuj jak SQLite */ }
  const sqliteFile = join(cfg.dataDir, "resinvest.sqlite");
  const pg = new PgDb(Object.assign({}, pgCfg, { reconnectSeconds: 0 }));
  let counts;
  try { counts = pgCounts(pg); } finally { pg.close(); }
  const pgHasData = Object.values(counts).some(n => n > 0);
  const switchTo = msg => { writeEnvKeys(cfg.dataDir, { DB_DRIVER: "postgres" }); lines.push(msg, "Serwer pracuje teraz na PostgreSQL (DB_DRIVER=postgres)."); return { code: 0, lines }; };

  if (current === "postgres" && pgHasData) return switchTo("Serwer już pracował na PostgreSQL — dane bez zmian.");
  if (!hasSqliteData(sqliteFile)) return switchTo(pgHasData ? "Baza PostgreSQL zawiera dane programu — serwer użyje ich." : "Nowa baza PostgreSQL — konto administratora programu powstanie przy pierwszym uruchomieniu serwera.");
  if (pgHasData) {
    const v = verifyAgainstPostgres(cfg, sqliteFile, pgCfg);
    if (v.ok) return switchTo("Dane w PostgreSQL są identyczne z bazą SQLite (wcześniejsza migracja).");
    lines.push("UWAGA: baza PostgreSQL zawiera INNE dane niż baza SQLite tego serwera — nic nie zostało nadpisane.",
      "Serwer pracuje dalej na SQLite. Wybierz pustą bazę PostgreSQL albo przenieś dane narzędziem: ResInvestERP-Migracja.cmd (docs\\POSTGRESQL.md).");
    return { code: 4, lines };
  }
  log("INFO", "Migracja SQLite → PostgreSQL z instalatora: " + sqliteFile);
  const r = migrateToPostgres(cfg, sqliteFile, pgCfg, { log });
  if (!r.ok) {
    lines.push("MIGRACJA NIEUDANA: " + r.error, "Serwer pracuje dalej na SQLite — plik bazy nie został zmieniony, dane są bezpieczne.", "Raport: " + (r.reportFile || "—"));
    return { code: 3, lines };
  }
  const t = r.target.summary;
  lines.push(`Migracja zakończona: ${Object.values(r.target.tables).reduce((a, x) => a + x.count, 0)} wierszy, rewizja ${t.rev}, dziennik zmian ${t.journalCount} wpisów, operacje ${t.collections.operations} — zgodność wszystkich tabel potwierdzona.`,
    "Plik SQLite pozostaje bez zmian (punkt powrotu): " + sqliteFile, "Raport: " + r.reportFile);
  return switchTo("Dane przeniesione do PostgreSQL.");
}
