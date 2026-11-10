/* =========================================================================
   ResInvest ERP Serwer — wybór silnika bazy danych.

   DB_DRIVER=sqlite    (domyślnie) — plik <dane>\resinvest.sqlite, jak w 3.10–3.14: tryb jednostanowiskowy,
                        awaryjny i punkt powrotu po wycofaniu migracji,
   DB_DRIVER=postgres  — tryb firmowy: centralna baza PostgreSQL (DATABASE_URL albo DB_HOST / DB_PORT /
                        DB_NAME / DB_USER / DB_PASSWORD w server.env — poza repozytorium i poza przeglądarką).
   ========================================================================= */
import { readFileSync } from "node:fs";
import { SqliteDb } from "./sqlite.mjs";
import { PgDb } from "./postgres.mjs";

const num = (v, def) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; };

/** Ustawienia bazy z pliku server.env / zmiennych procesu. Błąd konfiguracji = wyjątek z czytelnym opisem (bez hasła). */
export function databaseConfig(env = {}) {
  const driver = String(env.DB_DRIVER || "sqlite").trim().toLowerCase();
  if (driver === "sqlite" || driver === "") return { driver: "sqlite" };
  if (driver !== "postgres" && driver !== "postgresql" && driver !== "pg") throw new Error(`DB_DRIVER: nieznany silnik bazy „${driver}” (dozwolone: sqlite, postgres)`);
  const client = { application_name: String(env.DB_APP_NAME || "resinvest-erp").slice(0, 60), connectionTimeoutMillis: num(env.DB_CONNECT_TIMEOUT_MS, 15000), keepAlive: true };
  if (env.DATABASE_URL) client.connectionString = String(env.DATABASE_URL).trim();
  else {
    if (!env.DB_NAME || !env.DB_USER) throw new Error("DB_DRIVER=postgres: ustaw DATABASE_URL albo DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD w server.env");
    Object.assign(client, { host: String(env.DB_HOST || "127.0.0.1"), port: num(env.DB_PORT, 5432), database: String(env.DB_NAME), user: String(env.DB_USER), password: String(env.DB_PASSWORD || "") });
  }
  const ssl = String(env.DB_SSL || "").trim().toLowerCase();
  if (ssl === "disable" || ssl === "off" || ssl === "false") client.ssl = false;
  else if (ssl === "require") client.ssl = { rejectUnauthorized: false };
  else if (ssl === "verify-full" || ssl === "verify") {
    client.ssl = { rejectUnauthorized: true };
    if (env.DB_SSL_CA) client.ssl.ca = readFileSync(String(env.DB_SSL_CA), "utf8");
  } else if (ssl) throw new Error("DB_SSL: dozwolone wartości to disable, require, verify-full");
  const schema = String(env.DB_SCHEMA || "").trim();
  if (schema && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("DB_SCHEMA: dozwolone małe litery, cyfry i podkreślenie");
  return { driver: "postgres", client, schema, statementTimeoutMs: num(env.DB_STATEMENT_TIMEOUT_MS, 60000), callTimeoutMs: num(env.DB_CALL_TIMEOUT_MS, 120000), reconnectSeconds: num(env.DB_RECONNECT_SECONDS, 20) };
}

/** Otwiera bazę wskazaną konfiguracją. `file` — ścieżka pliku SQLite (używana tylko przez silnik sqlite). */
export function openDatabase(dbCfg, { file, log } = {}) {
  if (!dbCfg || dbCfg.driver === "sqlite") return new SqliteDb(file);
  return new PgDb(dbCfg, log);
}
export { SqliteDb, PgDb };
