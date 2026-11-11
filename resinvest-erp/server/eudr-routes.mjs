/* =========================================================================
   ResInvest ERP Serwer 3.16 — trasy HTTP modułu EUDR:
     POST /api/eudr/files            plik dokumentu EUDR (surowa treść; nowy dokument albo nowa wersja istniejącego)
     GET  /api/eudr/files            podgląd / pobranie pliku (wersja v; domyślnie ostatnia)
     GET  /api/eudr/traces/info      konfiguracja środowisk systemu EUDR (bez wartości kluczy)
     POST /api/eudr/traces/tests     Centrum testów — testy w bieżącym środowisku, zapis historii
     POST /api/eudr/traces/submit    złożenie DDS (submitDds) dla wpisu rejestru — środowisko wpisu = bieżące środowisko
     POST /api/eudr/traces/status    odczyt statusu / numeru referencyjnego (getDds; nie wcześniej niż po 1 godzinie)
   Pliki zapisywane w folderze skanów serwera (SKANY <MIESIĄC> <ROK>/EUDR_…) z kopią w backups/skany.
   ========================================================================= */
import { createHash } from "node:crypto";
import { statSync, createReadStream, unlinkSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createTracesClient } from "./eudr-traces.mjs";

export function createEudrRoutes({ store, R, cfg, env, log, json, readRaw, readBody, broadcast, statePayload, sinceOf, metaOf, SEC_HEADERS }) {
  const E = R.Eudr;
  const traces = createTracesClient({ env, appConfig: globalThis.RIW_CONFIG || {}, log });
  const deny = (req, res, msg) => json(req, res, 403, { ok: false, code: "FORBIDDEN", error: msg || "Brak uprawnień EUDR do tej czynności." });
  const exec = (user, cmd, args, req) => {
    const r = store.execute(user.id, cmd, Object.assign({ source: "EUDR (serwer)" }, args), "pl", metaOf(req));
    const changed = !!r.__changed; delete r.__changed; delete r.before;
    if (changed) broadcast(store.state.rev, user.id);
    return { r, changed };
  };
  const copyBackup = rel => { for (const d of (cfg.backup && cfg.backup.copyTo) || []) { try { const dst = join(d, "skany", rel); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(store.scanPath(rel), dst); } catch (e) { log("WARN", `Kopia pliku EUDR ${rel}: ${e.message}`); } } };

  return async function handle(req, res, path, method, url, user) {
    if (!path.startsWith("/api/eudr/")) return false;
    R.applyRoles(store.state);
    const st = store.state;
    /* ---- pliki dokumentów ---- */
    if (path === "/api/eudr/files" && method === "POST") {
      if (!E.allowed(st, user, "doc.add")) { req.resume(); return deny(req, res), true; }
      let meta = {};
      try { meta = JSON.parse(String(url.searchParams.get("meta") || "{}")); } catch (e) { req.resume(); return json(req, res, 400, { ok: false, error: "Nieprawidłowe dane dokumentu" }), true; }
      const name = String(url.searchParams.get("name") || "dokument").slice(0, 160);
      let buf;
      try { buf = await readRaw(req, E.FILE_MAX); }
      catch (e) { return json(req, res, e.code === "TOO_LARGE" ? 413 : 400, { ok: false, error: e.code === "TOO_LARGE" ? `Plik jest za duży (najwięcej ${E.FILE_MAX / 1048576} MB)` : "Nie udało się odebrać pliku" }), true; }
      const type = E.sniff(buf, name);
      if (!type || !E.FILE_TYPES[type]) return json(req, res, 415, { ok: false, error: "Dozwolone pliki: PDF, JPG, PNG, WEBP, TIFF, GeoJSON, JSON, XML, CSV, TXT" }), true;
      const id = R.uid("ef").replace(/[^a-z0-9_]/gi, "").toLowerCase();
      const rel = `${R.scanFolder(store.today())}/EUDR_${String(meta.type || "dok").replace(/[^a-z_]/gi, "").slice(0, 20)}_${id}.${E.FILE_TYPES[type]}`;
      try { await store.saveScan(rel, buf); }
      catch (e) { log("ERROR", `Zapis pliku EUDR ${rel}: ${e.message}`); return json(req, res, 500, { ok: false, error: "Nie udało się zapisać pliku na serwerze" }), true; }
      const sha = createHash("sha256").update(buf).digest("hex");
      const args = Object.assign({}, meta, { file: { key: rel, name, type, size: buf.length, sha } });
      delete args.noFile;
      const { r, changed } = exec(user, "eudr.doc.save", args, req);
      if (!r.ok) { try { unlinkSync(store.scanPath(rel)); } catch (e) { /* plik zostaje w kopii */ } return json(req, res, r.code === "FORBIDDEN" ? 403 : 400, { ok: false, error: r.error, errors: r.errors }), true; }
      if ((cfg.backup.copyTo || []).length) setImmediate(() => copyBackup(rel));
      const since = sinceOf(url.searchParams.get("haveRev"));
      return json(req, res, 200, Object.assign({ ok: true, doc: r.doc }, changed && since != null ? statePayload(user.id, since) : {})), true;
    }
    if (path === "/api/eudr/files" && method === "GET") {
      const d = R.byId(st.eudrDocs || [], String(url.searchParams.get("id") || ""));
      if (!d || !E.allowed(st, user, "view")) return json(req, res, 404, { ok: false, error: "Nie znaleziono dokumentu" }), true;
      if ((d.lotIds || []).length && !d.lotIds.some(id => { const l = R.byId(st.eudrLots, id); return !l || R.canAccessWh(user, l.whId); })) return deny(req, res, "Brak dostępu do magazynu partii"), true;
      const v = Number(url.searchParams.get("v")) || d.versions.length, f = d.versions[v - 1];
      if (!f || f.local) return json(req, res, 404, { ok: false, error: "Plik nie jest zapisany na serwerze" }), true;
      const p = store.scanPath(f.key);
      let s = null; try { s = p && statSync(p); } catch (e) { /* brak pliku */ }
      if (!s) return json(req, res, 404, { ok: false, error: "Plik nie istnieje w folderze serwera (sprawdź kopię w backups\\skany)" }), true;
      // podgląd w przeglądarce tylko dla PDF i obrazów; pliki tekstowe zawsze do pobrania
      const dl = url.searchParams.get("download") === "1" || !/^(application\/pdf|image\/)/.test(f.type);
      res.writeHead(200, Object.assign({}, SEC_HEADERS, { "Content-Type": f.type, "Content-Length": s.size, "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="${f.key.split("/").pop()}"; filename*=UTF-8''${encodeURIComponent(f.name)}` }));
      createReadStream(p).pipe(res);
      return true;
    }
    /* ---- system EUDR (TRACES) ---- */
    if (path === "/api/eudr/traces/info" && method === "GET") {
      if (!E.allowed(st, user, "view")) return deny(req, res), true;
      return json(req, res, 200, { ok: true, env: E.envOf(st), info: traces.info() }), true;
    }
    if (path === "/api/eudr/traces/tests" && method === "POST") {
      if (!E.allowed(st, user, "tests.run")) return deny(req, res), true;
      const b = await readBody(req, 64 * 1024);
      const envName = E.envOf(st);
      const keys = Array.isArray(b.keys) && b.keys.length ? b.keys.filter(k => E.TESTS.some(t => t.key === k)) : E.TESTS.map(t => t.key);
      if (envName === "PRODUCTION" && b.confirm !== "PRODUKCJA" && keys.some(k => ["echo", "clock", "retrieve"].includes(k))) return json(req, res, 400, { ok: false, code: "CONFIRM", error: "Testy połączenia w trybie produkcyjnym wymagają potwierdzenia (wpisz PRODUKCJA)" }), true;
      const results = [];
      for (const k of keys) {
        const t0 = Date.now();
        const r = await traces.runTest(envName, k, { confirm: b.confirm }) || Object.assign({ key: k, ms: Date.now() - t0 }, E.localTest(st, k, { today: store.today() }));
        results.push(r);
      }
      const { r } = exec(user, "eudr.tests.record", { results, mode: "server" }, req);
      if (!r.ok) return json(req, res, 400, { ok: false, error: r.error }), true;
      return json(req, res, 200, Object.assign({ ok: true, run: r.run }, statePayload(user.id, sinceOf(b.haveRev)))), true;
    }
    if (path === "/api/eudr/traces/submit" && method === "POST") {
      if (!E.allowed(st, user, "dds.edit")) return deny(req, res), true;
      const b = await readBody(req, 64 * 1024);
      const d = R.byId(st.eudrDds || [], String(b.id || ""));
      if (!d) return json(req, res, 404, { ok: false, error: "Nie znaleziono wpisu DDS" }), true;
      const envName = E.envOf(st);
      if (d.env !== envName) return json(req, res, 400, { ok: false, error: `Wpis należy do środowiska ${d.env} — aktywne jest ${envName}. Danych testowych nie wysyła się do produkcji.` }), true;
      if (d.kind !== "OWN") return json(req, res, 400, { ok: false, error: "Wysłać można tylko własne oświadczenie (rodzaj „Własne DDS”)" }), true;
      if (d.uuid) return json(req, res, 400, { ok: false, error: "Oświadczenie zostało już złożone — sprawdź jego status" }), true;
      if (envName === "PRODUCTION" && b.confirm !== "PRODUKCJA") return json(req, res, 400, { ok: false, code: "CONFIRM", error: "Złożenie oświadczenia w systemie produkcyjnym wymaga potwierdzenia (wpisz PRODUKCJA)" }), true;
      const ds = E.dataset(st, d.lotIds, { activityType: b.activityType, countryOfActivity: b.countryOfActivity, internalRef: d.internalRef || d.no, confidential: !!b.confidential });
      if (ds.errors.length) return json(req, res, 400, { ok: false, error: "Zestaw danych niekompletny", errors: ds.errors }), true;
      const lotErr = d.lotIds.map(id => R.byId(st.eudrLots, id)).filter(l => l && l.status !== "VERIFIED").map(l => l.no);
      if (lotErr.length) return json(req, res, 400, { ok: false, error: `Partie niedopuszczone w panelu należytej staranności: ${lotErr.join(", ")}` }), true;
      const r = await traces.submitDds(envName, E.submitXml(ds), { confirm: b.confirm });
      if (!r.ok) {
        exec(user, "eudr.dds.save", { id: d.id, statusInfo: `Błąd wysyłki: ${r.error}`.slice(0, 600) }, req);
        return json(req, res, 502, { ok: false, error: r.error, code: r.code }), true;
      }
      const { r: saved } = exec(user, "eudr.dds.save", { id: d.id, uuid: r.uuid, status: "SUBMITTED", date: store.today(), internalRef: ds.internalReferenceNumber, statusInfo: `Złożono ${new Date().toISOString()}` }, req);
      return json(req, res, 200, Object.assign({ ok: saved.ok, uuid: r.uuid, dds: saved.dds }, statePayload(user.id, sinceOf(b.haveRev)))), true;
    }
    if (path === "/api/eudr/traces/status" && method === "POST") {
      if (!E.allowed(st, user, "dds.edit")) return deny(req, res), true;
      const b = await readBody(req, 64 * 1024);
      const d = R.byId(st.eudrDds || [], String(b.id || ""));
      if (!d || !d.uuid) return json(req, res, 404, { ok: false, error: "Wpis nie ma identyfikatora złożenia (UUID)" }), true;
      const envName = E.envOf(st);
      if (d.env !== envName) return json(req, res, 400, { ok: false, error: `Wpis należy do środowiska ${d.env}` }), true;
      const sub = (d.history || []).find(h => h.status === "SUBMITTED");
      if (sub && Date.now() - Date.parse(sub.at) < 3600 * 1000) return json(req, res, 429, { ok: false, error: "Status sprawdza się nie wcześniej niż po 1 godzinie od złożenia (zalecenie Komisji)" }), true;
      if (envName === "PRODUCTION" && b.confirm !== "PRODUKCJA") return json(req, res, 400, { ok: false, code: "CONFIRM", error: "Odczyt w systemie produkcyjnym wymaga potwierdzenia (wpisz PRODUKCJA)" }), true;
      const r = await traces.getDds(envName, [d.uuid], { confirm: b.confirm });
      if (!r.ok) return json(req, res, 502, { ok: false, error: r.error }), true;
      const o = r.list.find(x => x.uuid === d.uuid) || r.list[0];
      if (!o) return json(req, res, 404, { ok: false, error: "System EUDR nie zwrócił oświadczenia" }), true;
      const args = { id: d.id, statusInfo: o.info || "" };
      if (E.DDS_STATUS[o.status]) args.status = o.status;
      if (o.referenceNumber) args.referenceNumber = o.referenceNumber;
      if (o.verificationNumber) args.verificationNumber = o.verificationNumber;
      const { r: saved } = exec(user, "eudr.dds.save", args, req);
      return json(req, res, saved.ok ? 200 : 400, Object.assign({ ok: saved.ok, error: saved.error, overview: o, dds: saved.dds }, statePayload(user.id, sinceOf(b.haveRev)))), true;
    }
    return json(req, res, 404, { ok: false, error: "Nieznana trasa EUDR" }), true;
  };
}
