#!/usr/bin/env node
// @ts-check
/* =========================================================================
   ResInvest ERP — AI Document Scanner Test (serwer testowy)

   Uruchomienie:  node server/scanner-server.mjs [--provider mock|anthropic|auto] [--port 8095] [--data <katalog>]
   Domyślnie:     http://127.0.0.1:8095 (tylko ten komputer)

   Moduł eksperymentalny — działa obok ResInvest ERP, NIE łączy się z jego bazą,
   nie tworzy dokumentów PZ/WZ, ruchów magazynowych ani transportów. Wyniki trafiają
   wyłącznie do izolowanego katalogu danych testowych (domyślnie data-test/).

   API (JSON):
     GET    /api/health                  stan serwera
     GET    /api/status                  provider, limity, schemat pól (bez sekretów)
     POST   /api/scan?hint=WZ&name=a.jpg treść = bajty obrazu (Content-Type: image/*)
     GET    /api/scans                   lista wyników testowych
     GET    /api/scans/:id               wynik
     GET    /api/scans/:id/image         obraz dokumentu
     GET    /api/scans/:id/export        wynik do pobrania (JSON)
     PATCH  /api/scans/:id               korekta ręczna { rev, docType?, fields?, reviewer?, markReviewed? }
     DELETE /api/scans/:id               usunięcie wyniku testowego
   ========================================================================= */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, createReadStream, readdirSync } from "node:fs";
import { join, extname, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, MODULE_ROOT } from "../src/config.mjs";
import { createProviders } from "../src/providers/index.mjs";
import { ProviderError } from "../src/providers/provider.mjs";
import { ScanStore, StoreError, isValidId } from "../src/store.mjs";
import { loadMasterData } from "../src/master-data.mjs";
import { analyzeDocument, applyCorrection, InputError } from "../src/analyze.mjs";
import { FIELDS, DOC_TYPES, FIELDS_BY_TYPE, SCHEMA_VERSION } from "../src/schema.mjs";
import { SUPPORTED_MIME } from "../src/image.mjs";

export const MODULE_VERSION = JSON.parse(readFileSync(join(MODULE_ROOT, "package.json"), "utf8")).version;

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon"
};
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin"
};

/**
 * @param {{ cfg: import("../src/config.mjs").ScannerConfig, env: Record<string, string|undefined>, deps?: { fixturesDir?: string, anthropicClient?: any }, log?: (line: string) => void }} opts
 */
export function createScannerServer(opts) {
  const { cfg, env } = opts;
  const log = opts.log || (line => console.log(line));
  const providers = createProviders(cfg, env, opts.deps || {});
  const provider = providers.active;
  const store = new ScanStore(cfg.dataDir);
  let masterData = null;
  try { masterData = loadMasterData(cfg.erpMasterDataFile); }
  catch (e) { log(`[uwaga] Nie wczytano kartotek ERP (${cfg.erpMasterDataFile}): ${e instanceof Error ? e.message : e}`); }
  const ctx = { provider, store, masterData, cfg };
  const publicDir = existsSync(join(MODULE_ROOT, "dist", "index.html")) && !process.env.SCANNER_USE_PUBLIC ? join(MODULE_ROOT, "dist") : join(MODULE_ROOT, "public");
  const samplesDir = join(MODULE_ROOT, "samples");
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function rateLimited(ip) {
    const now = Date.now(), win = 60_000;
    const arr = (hits.get(ip) || []).filter(t => now - t < win);
    if (arr.length >= cfg.rateLimitPerMinute) { hits.set(ip, arr); return true; }
    arr.push(now); hits.set(ip, arr);
    return false;
  }

  function send(res, status, body, headers = {}) {
    const isBuf = Buffer.isBuffer(body);
    const data = isBuf ? body : Buffer.from(JSON.stringify(body));
    res.writeHead(status, Object.assign({}, SECURITY_HEADERS, {
      "Content-Type": isBuf ? "application/octet-stream" : "application/json; charset=utf-8",
      "Content-Length": data.length, "Cache-Control": "no-store"
    }, headers));
    res.end(data);
  }
  const fail = (res, status, error, extra = {}) => send(res, status, Object.assign({ ok: false, error }, extra));

  function readBody(req, limit) {
    return new Promise((resolveBody, reject) => {
      const declared = Number(req.headers["content-length"] || 0);
      if (declared > limit) { reject(new InputError(`Plik jest za duży (maks. ${Math.round(limit / 1024 / 1024)} MB).`, 413)); req.resume(); return; }
      const chunks = []; let size = 0, done = false;
      req.on("data", c => {
        if (done) return;
        size += c.length;
        if (size > limit) { done = true; reject(new InputError(`Plik jest za duży (maks. ${Math.round(limit / 1024 / 1024)} MB).`, 413)); req.resume(); return; }
        chunks.push(c);
      });
      req.on("end", () => { if (!done) { done = true; resolveBody(Buffer.concat(chunks)); } });
      req.on("error", e => { if (!done) { done = true; reject(e); } });
    });
  }

  function cookie(req, name) {
    const m = String(req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function tokenOk(given) {
    if (!cfg.accessToken) return true;
    if (!given) return false;
    const a = Buffer.from(String(given)), b = Buffer.from(cfg.accessToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  /** Żądania zmieniające dane: tylko z tej samej strony (ochrona przed CSRF). */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  function serveStatic(req, res, pathname) {
    let base = publicDir, rel = pathname === "/" ? "index.html" : pathname.slice(1);
    if (rel.startsWith("samples/")) { base = samplesDir; rel = rel.slice("samples/".length); if (extname(rel) !== ".png") return fail(res, 404, "Nie znaleziono."); }
    const file = resolve(base, decodeURIComponent(rel));
    if (!file.startsWith(resolve(base) + sep) || !existsSync(file) || !statSync(file).isFile()) return fail(res, 404, "Nie znaleziono.");
    const type = STATIC_TYPES[extname(file)] || "application/octet-stream";
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, { "Content-Type": type, "Content-Length": statSync(file).size, "Cache-Control": type.startsWith("text/html") ? "no-store" : "no-cache" }));
    createReadStream(file).pipe(res);
  }

  /** Przykładowe dokumenty (samples/*.png) — etykieta z nazwy pliku. */
  function listSamples() {
    const labels = [[/^wz-/, "WZ"], [/^pz-/, "PZ"], [/^kwit-wywozowy/, "Kwit wywozowy"], [/^kwit-wagowy-uszkodzony/, "Kwit wagowy (uszkodzony)"], [/^kwit-wagowy/, "Kwit wagowy"]];
    if (!existsSync(samplesDir)) return [];
    return readdirSync(samplesDir).filter(f => f.endsWith(".png")).sort((a, b) => {
      const ia = labels.findIndex(([re]) => /** @type {RegExp} */ (re).test(a)), ib = labels.findIndex(([re]) => /** @type {RegExp} */ (re).test(b));
      return ia - ib || a.localeCompare(b);
    }).map(file => { const l = labels.find(([re]) => /** @type {RegExp} */ (re).test(file)); return { file, label: l ? String(l[1]) : file }; });
  }

  function publicStatus() {
    return {
      ok: true, module: "AI Document Scanner Test", version: MODULE_VERSION, testOnly: true,
      notice: "Tryb testowy: wyniki nie są dokumentami ResInvest ERP i nie zmieniają stanów magazynowych.",
      provider: provider.status(),
      providers: Object.values(providers.all).map(p => p.status()),
      limits: { maxUploadBytes: cfg.maxUploadBytes, minSide: cfg.minSide, maxSide: cfg.maxSide, mime: SUPPORTED_MIME, clientMaxSide: 2400 },
      schema: { version: SCHEMA_VERSION, docTypes: DOC_TYPES, fields: FIELDS.map(f => ({ key: f.key, label: f.label, kind: f.kind })), fieldsByType: FIELDS_BY_TYPE },
      erpMasterData: masterData ? { loaded: true, file: masterData.source.split(/[\\/]/).pop(), products: masterData.products.length, partners: masterData.partners.length, vehicles: masterData.vehicles.length, drivers: masterData.drivers.length } : { loaded: false },
      samples: listSamples(),
      authRequired: !!cfg.accessToken
    };
  }

  async function handle(req, res) {
    const url = new URL(req.url || "/", "http://local");
    const p = url.pathname;
    const ip = req.socket.remoteAddress || "?";

    if (cfg.accessToken) {
      const qt = url.searchParams.get("token");
      if (qt && tokenOk(qt) && req.method === "GET" && !p.startsWith("/api/")) {
        res.writeHead(302, Object.assign({}, SECURITY_HEADERS, { Location: p, "Set-Cookie": `scanner_token=${encodeURIComponent(qt)}; HttpOnly; SameSite=Strict; Path=/` }));
        return res.end();
      }
      if (!tokenOk(req.headers["x-scanner-token"] || cookie(req, "scanner_token"))) return fail(res, 401, "Wymagany token dostępu (SCANNER_ACCESS_TOKEN). Otwórz adres z ?token=…");
    }

    if (!p.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Metoda niedozwolona.");
      return serveStatic(req, res, p);
    }
    if (req.method !== "GET" && !sameOrigin(req)) return fail(res, 403, "Żądanie z innej strony zostało odrzucone.");

    if (p === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, module: "ai-document-scanner-test", version: MODULE_VERSION, testOnly: true, erpConnected: false });
    if (p === "/api/status" && req.method === "GET") return send(res, 200, publicStatus());

    if (p === "/api/scan" && req.method === "POST") {
      const ct = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!ct.startsWith("image/")) return fail(res, 415, "Prześlij obraz (Content-Type: image/jpeg, image/png, image/webp lub image/gif).");
      if (rateLimited(ip)) return fail(res, 429, `Za dużo analiz w ciągu minuty (limit ${cfg.rateLimitPerMinute}). Odczekaj chwilę.`);
      const buffer = await readBody(req, cfg.maxUploadBytes);
      const ac = new AbortController();
      res.on("close", () => { if (!res.writableEnded) ac.abort(); });
      const rec = await analyzeDocument(ctx, { buffer, originalName: url.searchParams.get("name"), hintType: url.searchParams.get("hint"), signal: ac.signal });
      log(`[skan] ${rec.id} typ=${rec.result.docType.value} provider=${rec.provider.name}${rec.provider.simulated ? " (symulacja)" : ""} ${rec.provider.ms ?? "?"} ms`);
      return send(res, 201, { ok: true, scan: rec });
    }

    if (p === "/api/scans" && req.method === "GET") return send(res, 200, { ok: true, scans: store.list(Math.min(500, Number(url.searchParams.get("limit")) || 100)) });

    const m = p.match(/^\/api\/scans\/([^/]+)(\/image|\/export)?$/);
    if (m) {
      const id = m[1];
      if (!isValidId(id)) return fail(res, 400, "Nieprawidłowy identyfikator wyniku.");
      if (m[2] === "/image" && req.method === "GET") {
        const img = store.imagePath(id);
        const data = readFileSync(img.path);
        return send(res, 200, data, { "Content-Type": img.mime, "Cache-Control": "private, max-age=3600" });
      }
      if (m[2] === "/export" && req.method === "GET") {
        const rec = store.get(id);
        const body = Buffer.from(JSON.stringify(Object.assign({ _uwaga: "Wynik TESTOWY modułu AI Document Scanner Test — nie jest dokumentem ResInvest ERP." }, rec), null, 2));
        return send(res, 200, body, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${id}.json"` });
      }
      if (!m[2] && req.method === "GET") return send(res, 200, { ok: true, scan: store.get(id) });
      if (!m[2] && req.method === "PATCH") {
        if (!String(req.headers["content-type"] || "").startsWith("application/json")) return fail(res, 415, "Oczekiwano JSON.");
        let body;
        try { body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8") || "{}"); } catch { return fail(res, 400, "Niepoprawny JSON."); }
        const rec = await applyCorrection(ctx, id, body);
        log(`[korekta] ${id} rev=${rec.rev} korekt=${rec.corrections.length}`);
        return send(res, 200, { ok: true, scan: rec });
      }
      if (!m[2] && req.method === "DELETE") return send(res, 200, Object.assign({ ok: true }, await store.remove(id)));
    }
    return fail(res, 404, "Nie znaleziono.");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e => {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof InputError || e instanceof StoreError) return fail(res, e.status, e.message);
      if (e instanceof ProviderError) { log(`[provider] ${e.code}: ${e.message}`); return fail(res, e.status, e.message, { code: e.code, retryable: e.retryable }); }
      log(`[błąd] ${e && e.stack ? e.stack : e}`);
      return fail(res, 500, "Błąd wewnętrzny serwera testowego.");
    });
  });
  server.requestTimeout = 300_000;
  return { server, ctx, providers };
}

/* ---------------- uruchomienie z wiersza poleceń ---------------- */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) { console.error(`Wymagany Node.js 22.13+ (jest ${process.versions.node}).`); process.exit(1); }
  const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  let loaded;
  try {
    loaded = loadConfig({ provider: /** @type {any} */ (arg("--provider")), port: arg("--port") ? Number(arg("--port")) : undefined, dataDir: arg("--data") });
  } catch (e) { console.error("Błąd konfiguracji: " + (e instanceof Error ? e.message : e)); process.exit(1); }
  const { cfg, env } = loaded;
  const { server, providers } = createScannerServer({ cfg, env });
  server.listen(cfg.port, cfg.host, () => {
    const st = providers.active.status();
    console.log("=====================================================================");
    console.log(" ResInvest ERP — AI Document Scanner Test  v" + MODULE_VERSION + "  (TRYB TESTOWY)");
    console.log(` Adres:     http://${cfg.host === "0.0.0.0" ? "localhost" : cfg.host}:${cfg.port}`);
    console.log(` Provider:  ${st.label}${st.model ? " · model " + st.model : ""}`);
    if (!st.configured) console.log(` UWAGA:     ${st.reason}`);
    console.log(` Dane test: ${cfg.dataDir}`);
    console.log(" Brak połączenia z bazą ResInvest ERP — nic nie jest księgowane.");
    console.log("=====================================================================");
  });
}
