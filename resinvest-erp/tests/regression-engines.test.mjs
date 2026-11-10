/* Regresja: ten sam scenariusz pracy magazynu na SQLite i na PostgreSQL musi dać identyczne wyniki komend,
   identyczny stan (SHA-256), identyczne tabele state / rows / journal (z łańcuchem skrótów) i identyczne stany magazynowe. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pgAvailable, createDb, dropAll, tmp, scenario, runNode } from "./support/helpers.mjs";

const HAVE_PG = await pgAvailable();
const skip = HAVE_PG ? false : "brak RIW_TEST_PG_URL — testy PostgreSQL pominięte";
let lite, pgRun, pgDir, liteDir, db;
before(async () => {
  if (!HAVE_PG) return;
  db = await createDb("regr"); liteDir = tmp("lite"); pgDir = tmp("pg");
  lite = scenario(liteDir, "sqlite"); pgRun = scenario(pgDir, "postgres", db.url);
});
after(dropAll);

test("scenariusz obejmuje pełny przekrój modułów i reguł magazynowych", { skip }, () => {
  const by = Object.fromEntries(lite.steps.map(s => [s.name, s]));
  assert.ok(lite.steps.length >= 35);
  for (const n of ["zakup+produkcja", "zakup towar", "sprzedaż WZ", "produkcja", "MM wysłanie", "MM przyjęcie", "korekta WZ", "wycofanie korekty", "anulowanie", "wersja robocza — zapis", "kontrahent", "użytkownik", "plan zakupów", "rejestr wydruku", "inwentaryzacja — otwarcie", "inwentaryzacja — zamknięcie"])
    assert.equal(by[n] && by[n].ok, true, `${n}: ${by[n] && by[n].error}`);
  assert.match(by["sprzedaż ponad stan (odmowa)"].error, /Dostępny stan/);
  assert.equal(by["MM przyjęcie obcego magazynu (odmowa)"].code, "FORBIDDEN");
  assert.equal(by["MM drugie przyjęcie (odmowa)"].code, "RECEIVED");
  assert.equal(by["obserwator — zakup (odmowa)"].code, "FORBIDDEN");
  assert.equal(by["magazynier — konto (odmowa)"].code, "FORBIDDEN");
  assert.equal(by["nieznana komenda"].code, "UNKNOWN");
});
test("wyniki wszystkich komend identyczne (numery dokumentów, kody błędów, komunikaty)", { skip }, () => assert.deepEqual(pgRun.steps, lite.steps));
test("stan końcowy identyczny: rewizja, SHA-256 stanu, łańcuch dziennika, liczby rekordów", { skip }, () => {
  assert.deepEqual(pgRun.summary, lite.summary);
  assert.equal(pgRun.summary.integrity, true);
});
test("tabele state / rows / journal identyczne bajt w bajt", { skip }, () => assert.deepEqual(pgRun.tables, lite.tables));
test("stany magazynowe identyczne", { skip }, () => { assert.deepEqual(pgRun.stock, lite.stock); assert.ok(Object.keys(lite.stock).length > 5); });
test("liczba wierszy we wszystkich tabelach identyczna; szybka ścieżka zapisu bez powtórzeń", { skip }, () => { assert.deepEqual(pgRun.counts, lite.counts); assert.equal(pgRun.fallbacks, lite.fallbacks); });
test("kontrola spójności (--check) przechodzi na obu silnikach", { skip }, () => {
  const a = runNode(["server/riw-server.mjs", "--check"], { env: { RIW_DATA: liteDir, DB_DRIVER: "sqlite" } });
  const b = runNode(["server/riw-server.mjs", "--check"], { env: { RIW_DATA: pgDir, DB_DRIVER: "postgres", DATABASE_URL: db.url } });
  assert.equal(a.code, 0, a.err); assert.equal(b.code, 0, b.err);
  const ja = JSON.parse(a.out.slice(a.out.indexOf("{"))), jb = JSON.parse(b.out.slice(b.out.indexOf("{")));
  assert.deepEqual(jb, ja); assert.equal(jb.ok, true);
});
test("kopia zapasowa z PostgreSQL to plik .sqlite identyczny z danymi SQLite", { skip }, () => {
  const a = runNode(["tools/db-migrate.mjs", "verify", "--data", pgDir, "--from", join(pgDir, "backups", pgRun.backup), "--json"], { env: { DB_DRIVER: "postgres", DATABASE_URL: db.url } });
  const j = JSON.parse(a.out);
  // po kopii scenariusz niczego nie zmienia poza znacznikiem last_backup w tabeli meta
  assert.deepEqual(j.diff.map(d => d.table), ["meta"]);
  for (const t of ["state", "rows", "journal", "accounts", "sessions", "login_log", "tokens", "outbox"]) assert.deepEqual(j.source[t], j.target[t], t);
});
