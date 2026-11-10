/* Ochrona przed utratą danych przy zerwaniu połączenia W TRAKCIE zapisu komendy (PostgreSQL):
   * połączenie zerwane przed zatwierdzeniem → baza wycofuje transakcję, serwer zgłasza błąd, stan w pamięci bez zmian,
   * zatwierdzenie wykonane, ale potwierdzenie nie dotarło → serwer sprawdza dziennik i uznaje zapis (bez duplikatu),
   * po obu zdarzeniach kolejne komendy działają, a łańcuch dziennika jest spójny. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pgAvailable, createDb, dropAll, tmp } from "./support/helpers.mjs";
import { Store, loadConfig, R } from "../server/core.mjs";
import { PgDb, PgError } from "../server/db/postgres.mjs";

const HAVE_PG = await pgAvailable();
const skip = HAVE_PG ? false : "brak RIW_TEST_PG_URL — testy PostgreSQL pominięte";
const TODAY = "2026-11-09";
let store, side, cfg, logs = [];
const purchase = qty => R.Seed.draftOf(TODAY, { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: String(qty), unit: "MP", price: "56" }, transport: { mode: "none", place: "RiC Zabrze" } });
const commit = qty => store.execute("u_admin", "op.commit", { draft: purchase(qty) }, "pl", {});
const dbRev = () => side.prepare("SELECT rev FROM state WHERE id = 1").get().rev;
const dbOps = () => side.prepare("SELECT COUNT(*) AS n FROM rows WHERE coll = 'operations'").get().n;
const dbJournal = () => side.prepare("SELECT COUNT(*) AS n FROM journal").get().n;
/** Jednorazowa podmiana COMMIT w połączeniu serwera. */
function onCommit(fn) {
  const orig = store.db.exec.bind(store.db);
  store.db.exec = sql => { if (sql === "COMMIT") { store.db.exec = orig; return fn(orig); } return orig(sql); };
}
const killServerConnection = () => side.prepare("SELECT pg_terminate_backend(?::int) AS ok").get(store.db.info.pid);

before(async () => {
  if (!HAVE_PG) return;
  const db = await createDb("resil");
  cfg = loadConfig({ dataDir: tmp("resil"), todayOverride: TODAY }); cfg.backup.copyTo = []; cfg.database = db.cfg;
  store = new Store(cfg, (lvl, m) => logs.push(`${lvl} ${m}`));
  assert.equal(store.setup({ name: "Administrator Testowy", email: "magazyn@resinvest.group", password: "Test-Admin#2026", sample: true }).ok, true);
  side = new PgDb(db.cfg);
});
after(async () => { if (store) store.close(); if (side) side.close(); await dropAll(); });

test("zerwanie przed zatwierdzeniem: nic nie zapisano, błąd dla użytkownika, stan serwera bez zmian", { skip }, () => {
  const rev = store.state.rev, ops = dbOps(), jn = dbJournal(), head = store.journalHead;
  onCommit(orig => { killServerConnection(); return orig("COMMIT"); });
  const r = commit(10);
  assert.equal(r.ok, false); assert.equal(r.code, "DB"); assert.match(r.error, /nic nie zapisano/);
  assert.equal(store.state.rev, rev); assert.equal(store.journalHead, head);
  assert.deepEqual([dbRev(), dbOps(), dbJournal()], [rev, ops, jn], "baza wycofała całą transakcję");
  const ok = commit(10); assert.equal(ok.ok, true, ok.error);
  assert.deepEqual([dbRev(), dbOps(), dbJournal()], [rev + 1, ops + 1, jn + 1]);
});

test("zatwierdzone, ale bez potwierdzenia: zapis rozpoznany w dzienniku, brak duplikatu, stan zgodny z bazą", { skip }, () => {
  const rev = store.state.rev, ops = dbOps(), jn = dbJournal();
  onCommit(orig => { orig("COMMIT"); killServerConnection(); store.db.connected = false; throw new PgError({ message: "Connection terminated unexpectedly", connection: true }); });
  const r = commit(11);
  assert.equal(r.ok, true, r.error); assert.match(r.op.no, /\/11\/2026$/);
  assert.equal(store.state.rev, rev + 1);
  assert.deepEqual([dbRev(), dbOps(), dbJournal()], [rev + 1, ops + 1, jn + 1], "dokładnie jeden zapis");
  assert.ok(logs.some(l => /potwierdzony w dzienniku po zerwaniu połączenia/.test(l)));
  assert.equal(commit(12).ok, true);
  assert.deepEqual([dbRev(), dbOps(), dbJournal()], [rev + 2, ops + 2, jn + 2]);
});

test("zerwanie między komendami i w trakcie odczytu: przezroczyste ponowne połączenie", { skip }, () => {
  killServerConnection();
  assert.equal(store.hasAccounts(), true);
  killServerConnection();
  assert.equal(commit(13).ok, true);
  assert.ok(store.db.reconnects >= 2);
});

test("po awariach: ponowne wczytanie bazy daje ten sam stan, łańcuch dziennika i sumy kontrolne poprawne", { skip }, () => {
  const mem = { rev: store.state.rev, head: store.journalHead, sha: store.stateSha, ops: store.state.operations.length, json: JSON.stringify(store.state) };
  const again = new Store(cfg, () => {});
  try {
    assert.equal(again.integrity.ok, true, again.integrity.notes.join("; "));
    assert.deepEqual({ rev: again.state.rev, head: again.journalHead, sha: again.stateSha, ops: again.state.operations.length, json: JSON.stringify(again.state) }, mem);
  } finally { again.close(); }
});

test("baza niedostępna dłużej niż limit: komenda kończy się błędem bez zapisu, po powrocie bazy praca trwa", { skip }, () => {
  const rev = store.state.rev, good = store.db.conn, saved = store.db.reconnectSeconds;
  store.db.reconnectSeconds = 1;
  store.db.conn = Object.assign({}, good, { client: Object.assign({}, good.client, { connectionString: good.client.connectionString.replace(/:\d+\//, ":1/"), connectionTimeoutMillis: 500 }) });
  killServerConnection(); store.db._respawn();
  const r = commit(14);
  assert.equal(r.ok, false); assert.equal(r.code, "DB"); assert.equal(store.state.rev, rev); assert.equal(dbRev(), rev);
  store.db.conn = good; store.db.reconnectSeconds = saved; store.db._respawn();
  const ok = commit(14); assert.equal(ok.ok, true, ok.error); assert.equal(dbRev(), rev + 1);
});

test("wynik zapisu nieznany i baza niedostępna: serwer nie zgaduje — informuje użytkownika, a przed kolejną operacją wczytuje stan z bazy", { skip }, () => {
  const rev = store.state.rev, ops = dbOps(), good = store.db.conn, saved = store.db.reconnectSeconds;
  onCommit(orig => {
    orig("COMMIT");                                                               // zapis zatwierdzony w bazie…
    store.db.reconnectSeconds = 1;                                                // …ale potwierdzenie nie dociera, a baza przestaje odpowiadać
    store.db.conn = Object.assign({}, good, { client: Object.assign({}, good.client, { connectionString: good.client.connectionString.replace(/:\d+\//, ":1/"), connectionTimeoutMillis: 500 }) });
    killServerConnection(); store.db._respawn();
    throw new PgError({ message: "Connection terminated unexpectedly", connection: true });
  });
  const r = commit(15);
  assert.equal(r.ok, false); assert.equal(r.code, "DB_UNCERTAIN"); assert.match(r.error, /sprawdź, czy operacja została zapisana/);
  assert.equal(store.state.rev, rev, "stan w pamięci jeszcze sprzed zapisu"); assert.equal(dbRev(), rev + 1, "w bazie zapis jest");
  const down = commit(16); assert.equal(down.ok, false, "baza nadal niedostępna — żadnej operacji na nieaktualnym stanie"); assert.equal(dbRev(), rev + 1);
  store.db.conn = good; store.db.reconnectSeconds = saved; store.db._respawn();
  const ok = commit(16); assert.equal(ok.ok, true, ok.error);
  assert.equal(store.state.rev, rev + 2); assert.deepEqual([dbRev(), dbOps()], [rev + 2, ops + 2], "zapis sprzed awarii zachowany, nowy dopisany");
  assert.ok(logs.some(l => /Stan wczytany ponownie z bazy/.test(l)));
  const again = new Store(cfg, () => {});
  try { assert.equal(again.integrity.ok, true); assert.equal(JSON.stringify(again.state), JSON.stringify(store.state)); } finally { again.close(); }
});
