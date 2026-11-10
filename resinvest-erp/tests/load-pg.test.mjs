/* Obciążenie i współbieżność: wielu zalogowanych użytkowników zapisuje i czyta równocześnie przez HTTP.
   Sprawdzane: brak utraconych zapisów, ciągła i niepowtarzalna numeracja dokumentów, zgodność stanów magazynowych
   z sumą operacji, spójność dziennika po obciążeniu. Ten sam test wykonywany jest na SQLite (punkt odniesienia)
   i na PostgreSQL; czasy trafiają do wyniku testu (diagnostyka). RIW_LOAD_CLIENTS / RIW_LOAD_OPS zmieniają skalę. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pgAvailable, createDb, dropAll, tmp, runNode, startServer, client } from "./support/helpers.mjs";
import { R } from "../server/core.mjs";

const HAVE_PG = await pgAvailable();
const CLIENTS = Number(process.env.RIW_LOAD_CLIENTS) || 24, OPS = Number(process.env.RIW_LOAD_OPS) || 12, TODAY = "2026-11-09";
const USERS = [["magazyn@resinvest.group", "Test-Admin#2026"], ["anna.gorska@resinvest.group", "Test-User#2026"], ["adrian.wojciechowski@resinvest.group", "Test-User#2026"]];
const purchase = (qty, note) => R.Seed.draftOf(TODAY, { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: String(qty), unit: "MP", price: "56" }, transport: { mode: "none", place: "RiC Zabrze" }, notes: note });
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
after(dropAll);

async function load(t, driver) {
  const dir = tmp("load-" + driver), db = driver === "postgres" ? await createDb("load") : null;
  const env = db ? { DB_DRIVER: "postgres", DATABASE_URL: db.url } : { DB_DRIVER: "sqlite" };
  assert.equal(runNode(["tests/support/seed-db.mjs", dir, driver, db ? db.url : ""]).code, 0);
  const srv = await startServer(dir, env); assert.equal(srv.up, true, srv.logs());
  try {
    const sessions = [];
    for (let i = 0; i < CLIENTS; i++) { const c = client(srv.base), u = USERS[i % USERS.length]; assert.equal((await c.login(u[0], u[1])).status, 200); sessions.push(c); }
    const s0 = (await sessions[0].get("/api/state")).data.state;
    const ops0 = s0.operations.length, stock0 = R.Stock.balance(s0, "wh_zab", "pr_zr_tow");
    const lat = { write: [], read: [] }, numbers = [], errors = [];
    const t0 = performance.now();
    await Promise.all(sessions.map(async (c, ci) => {
      let rev = s0.rev;
      for (let k = 0; k < OPS; k++) {
        let a = performance.now();
        const r = await c.cmd("op.commit", { draft: purchase(1 + (ci + k) % 5, `obciążenie ${ci}/${k}`) }, rev);
        lat.write.push(performance.now() - a);
        if (r.status !== 200 || !r.data.res.ok) errors.push(`${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); else { numbers.push(r.data.res.op.no); rev = r.data.rev || rev; }
        a = performance.now();
        const g = await c.get("/api/state?since=" + rev); lat.read.push(performance.now() - a);
        if (g.status !== 200) errors.push("odczyt " + g.status); else rev = g.data.rev;
      }
    }));
    const sec = (performance.now() - t0) / 1000, total = CLIENTS * OPS;
    assert.deepEqual(errors, [], "wszystkie zapisy i odczyty udane");
    assert.equal(numbers.length, total); assert.equal(new Set(numbers).size, total, "numery dokumentów niepowtarzalne");
    const s1 = (await sessions[0].get("/api/state")).data.state;
    assert.equal(s1.operations.length, ops0 + total, "żaden zapis nie zginął"); assert.equal(s1.rev, s0.rev + total, "każdy zapis = jedna rewizja");
    let sum = 0; for (let ci = 0; ci < CLIENTS; ci++) for (let k = 0; k < OPS; k++) sum += 1 + (ci + k) % 5;
    assert.equal(Math.round((R.Stock.balance(s1, "wh_zab", "pr_zr_tow") - stock0) * 1000) / 1000, sum, "stan magazynu = suma przyjęć");
    const seq = numbers.map(n => Number(/\/(\d+)\//.exec(n)[1])).sort((a, b) => a - b);
    assert.equal(seq[seq.length - 1] - seq[0], total - 1, "numeracja ciągła, bez luk");
    const chk = runNode(["server/riw-server.mjs", "--check"], { env: Object.assign({ RIW_DATA: dir }, env) }); assert.equal(chk.code, 0, chk.out);
    const cj = JSON.parse(chk.out.slice(chk.out.indexOf("{"))); assert.equal(cj.rev, s1.rev);
    const res = { silnik: driver, klienci: CLIENTS, zapisy: total, odczyty: lat.read.length, czas_s: +sec.toFixed(2), zapisy_na_s: +(total / sec).toFixed(1),
      zapis_ms: { mediana: +pct(lat.write, 0.5).toFixed(1), p95: +pct(lat.write, 0.95).toFixed(1), max: +Math.max(...lat.write).toFixed(1) },
      odczyt_ms: { mediana: +pct(lat.read, 0.5).toFixed(1), p95: +pct(lat.read, 0.95).toFixed(1) } };
    t.diagnostic("OBCIAZENIE " + JSON.stringify(res));
    return res;
  } finally { await srv.stop(); }
}

test(`SQLite (punkt odniesienia): ${CLIENTS} użytkowników × ${OPS} zapisów równocześnie`, async t => { await load(t, "sqlite"); });
test(`PostgreSQL: ${CLIENTS} użytkowników × ${OPS} zapisów równocześnie`, { skip: HAVE_PG ? false : "brak RIW_TEST_PG_URL" }, async t => { await load(t, "postgres"); });
