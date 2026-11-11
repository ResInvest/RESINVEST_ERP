/* Testy modułów serwera wydzielonych w 3.15:  node --test tests/server-modules315.test.mjs
   * server/http/rate-limit.mjs — okno przesuwne, osobne klucze, czyszczenie wg najdłuższego używanego okna,
   * server/env-file.mjs — wartości w cudzysłowie, zastępowanie wpisów (także zakomentowanych), zapis atomowy, odmowa. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWindowLimiter } from "../server/http/rate-limit.mjs";
import { envValue, setEnvLine, writeEnvKeys } from "../server/env-file.mjs";

test("ogranicznik: przekroczenie progu w oknie, osobne klucze, wygaśnięcie po czasie", () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    const L = createWindowLimiter();
    for (let i = 0; i < 3; i++) assert.equal(L.hit("ip:a", 3, 15), false, `próba ${i + 1}`);
    assert.equal(L.hit("ip:a", 3, 15), true, "czwarta próba w oknie — blokada");
    assert.equal(L.hit("ip:b", 3, 15), false, "inny adres liczony osobno");
    mock.timers.tick(15 * 60000 + 1);
    assert.equal(L.hit("ip:a", 3, 15), false, "po upływie okna — znowu dozwolone");
  } finally { mock.timers.reset(); }
});

test("ogranicznik: czyszczenie usuwa tylko klucze bez zdarzeń w najdłuższym używanym oknie", () => {
  mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  try {
    const L = createWindowLimiter();
    L.hit("ip:x", 10, 15);
    L.hit("mail:u1", 10, 60);                    // okno godzinne (wysyłka e-mail)
    mock.timers.tick(20 * 60000);
    L.prune();
    assert.equal(L.size(), 2, "po 20 min zdarzenie e-mail jest w oknie 60 min, a klucz ip:x nie jest jeszcze usuwany");
    mock.timers.tick(41 * 60000);
    L.prune();
    assert.equal(L.size(), 0, "po 61 min — oba klucze usunięte");
    // limit e-mail nie zostaje „wyczyszczony” przedwcześnie
    for (let i = 0; i < 2; i++) L.hit("mail:u2", 2, 60);
    mock.timers.tick(30 * 60000); L.prune();
    assert.equal(L.hit("mail:u2", 2, 60), true, "trzecia wysyłka w ciągu godziny — blokada mimo czyszczenia");
  } finally { mock.timers.reset(); }
});

test("server.env: wartości, cudzysłowy i odmowa niedozwolonych znaków", () => {
  assert.equal(envValue("smtp.gmail.com"), "smtp.gmail.com");
  assert.equal(envValue("Ala ma kota"), '"Ala ma kota"');
  assert.equal(envValue('a"b c'), "'a\"b c'");
  assert.equal(envValue("a\"b'c d"), null);
  assert.equal(envValue("x\ny"), null);
  assert.equal(envValue(null), "");
});

test("server.env: zastępuje aktywny wpis, potem zakomentowany, inaczej dopisuje; „$” w wartości bez znaczenia specjalnego", () => {
  let t = "# nagłówek\r\nSMTP_HOST=stary\r\n# SMTP_PORT=25\r\n";
  t = setEnvLine(t, "SMTP_HOST", "nowy");
  t = setEnvLine(t, "SMTP_PORT", "587");
  t = setEnvLine(t, "SMTP_PASS", "a$1$&b");
  assert.match(t, /^SMTP_HOST=nowy$/m);
  assert.match(t, /^SMTP_PORT=587$/m);
  assert.doesNotMatch(t, /# SMTP_PORT/);
  assert.match(t, /^SMTP_PASS=a\$1\$&b$/m);
  assert.equal((t.match(/SMTP_HOST=/g) || []).length, 1);
});

test("server.env: zapis do pliku (CRLF, bez pliku tymczasowego), błąd = plik bez zmian", () => {
  const dir = mkdtempSync(join(tmpdir(), "riw-env-"));
  try {
    const f = writeEnvKeys(dir, { DB_DRIVER: "postgres", PG_DATABASE: "resinvest" });
    const a = readFileSync(f, "utf8");
    assert.match(a, /^DB_DRIVER=postgres\r$/m);
    assert.ok(!/[^\r]\n/.test(a), "wszystkie wiersze zakończone CRLF");
    assert.equal(existsSync(f + ".tmp"), false);
    writeEnvKeys(dir, { DB_DRIVER: "sqlite" });
    assert.match(readFileSync(f, "utf8"), /^DB_DRIVER=sqlite\r$/m);
    assert.match(readFileSync(f, "utf8"), /^PG_DATABASE=resinvest\r$/m, "inne klucze zachowane");
    const before = readFileSync(f, "utf8");
    assert.throws(() => writeEnvKeys(dir, { SMTP_HOST: "ok", SMTP_PASS: "zła\nwartość" }), e => e.key === "SMTP_PASS");
    assert.equal(readFileSync(f, "utf8"), before, "nic nie zapisano");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
