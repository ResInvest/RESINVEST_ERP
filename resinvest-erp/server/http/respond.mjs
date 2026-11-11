/* =========================================================================
   ResInvest ERP Serwer — warstwa HTTP: odpowiedzi, nagłówki bezpieczeństwa, odczyt treści żądania.
   Bez wiedzy o danych programu: widok stanu przychodzi gotowy (znacznik VIEW, server/http/state-view.mjs).
   ========================================================================= */
import { gzipSync, gzip } from "node:zlib";

// connect-src data: — intro zamienia osadzony film na Blob przez fetch(data:) (bez połączeń sieciowych; 3.13)
export const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
/** Znacznik: obiekt odpowiedzi z gotowym fragmentem stanu (pełny widok albo same zmiany od `since`) — patrz send(). */
export const VIEW = Symbol("stateView");

/** Odpowiedzi HTTP; `log` — dziennik serwera (błąd kompresji). */
export function createResponder(log) {
  function send(req, res, status, body, type = "application/json; charset=utf-8", extra = {}) {
    const view = body && typeof body === "object" && !Buffer.isBuffer(body) ? body[VIEW] : null;
    const wantGz = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    let data;
    if (view) {
      const rest = JSON.stringify(Object.assign({}, body)).slice(1, -1);          // pola odpowiedzi poza stanem (ok, res, mail…)
      if (rest === '"ok":true' && wantGz) {                                          // odczyt stanu — gotowa, zapamiętana kompresja
        if (view.gz) data = view.gz;
        else {
          // 3.14: pełny stan (MB) kompresowany w wątku roboczym — serwer w tym czasie obsługuje innych; równoczesne prośby
          // o ten sam widok czekają na jedną kompresję (wcześniej gzipSync blokował serwer przy otwieraniu programu przez wiele osób)
          if (!view.gzWait) view.gzWait = new Promise((ok, fail) => gzip(Buffer.from("{" + rest + "," + view.body + "}"), { level: 1 }, (e, out) => e ? fail(e) : ok(out)));
          view.gzWait.then(out => { view.gz = out; send(req, res, status, body, type, extra); }, e => {
            log("ERROR", "Kompresja stanu: " + e.message); view.gzWait = null;
            const raw = "{" + rest + "," + view.body + "}";               // bez kompresji (awaryjnie)
            res.writeHead(status, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, SEC_HEADERS, extra, { "Content-Length": Buffer.byteLength(raw) })); res.end(raw);
          });
          return;
        }
      } else data = "{" + (rest ? rest + "," : "") + view.body + "}";
    } else data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const headers = Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, SEC_HEADERS, extra);
    if (data === (view && view.gz)) headers["Content-Encoding"] = "gzip";
    else if (data.length > 2048 && wantGz) { data = gzipSync(data, { level: 1 }); headers["Content-Encoding"] = "gzip"; }
    headers["Content-Length"] = Buffer.byteLength(data);
    res.writeHead(status, headers); res.end(data);
  }
  const json = (req, res, status, obj, extra) => send(req, res, status, obj, "application/json; charset=utf-8", extra);
  return { send, json };
}

/** Treść żądania JSON z limitem rozmiaru. */
export function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > limit) { reject(new Error("too large")); req.resume(); return; }
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
/** 3.14: surowa treść żądania (pliki skanów) z limitem rozmiaru; przekroczenie → błąd „too large”. */
export function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > limit) { reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" })); req.resume(); return; }
    const chunks = []; let n = 0, done = false;
    req.on("data", c => { if (done) return; n += c.length; if (n > limit) { done = true; reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" })); req.resume(); } else chunks.push(c); });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", e => { if (!done) { done = true; reject(e); } });
  });
}
export const cookies = req => Object.fromEntries(String(req.headers.cookie || "").split(";").map(x => x.trim().split("=")).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
export const ipOf = req => (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
