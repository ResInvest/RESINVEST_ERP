#!/usr/bin/env node
/*
 * QA first-users: browser daemon (one per simulated user).
 * Starts Chromium (Playwright) in an isolated context and exposes a small HTTP API
 * on 127.0.0.1:<port>, so a tester can act step by step while the session is preserved.
 *
 *   node qa/tools/browser-daemon.cjs --port 9301 --out qa/first-users/run-1/impatient \
 *        [--mobile] [--net slow3g] [--cpu 4]
 *
 * Client: qa/tools/b.sh <port> '<json>'   (see qa/tools/README.md)
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : d; };
const PORT = Number(arg("--port", 9301));
const OUT = path.resolve(arg("--out", "qa/out"));
const MOBILE = !!arg("--mobile", false);
const NET = arg("--net", "none");
const CPU = Number(arg("--cpu", 1));
fs.mkdirSync(OUT, { recursive: true });

const NET_PROFILES = {
  // DevTools "Slow 3G" preset (latency 400 ms*5 RTT factor → 2000 ms, ~500 kbit/s down, ~500 kbit/s up)
  slow3g: { offline: false, latency: 2000, downloadThroughput: (500 * 1024) / 8 * 0.8, uploadThroughput: (500 * 1024) / 8 * 0.8 },
  fast3g: { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (750 * 1024) / 8 * 0.9 },
};

const log = { console: [], pageErrors: [], failedRequests: [], dialogs: [] };
let browser, context, pages = [], active = 0;
const now = () => new Date().toISOString();

async function attach(page) {
  page.on("console", m => { if (["error", "warning"].includes(m.type())) log.console.push({ ts: now(), type: m.type(), text: m.text().slice(0, 500), url: page.url() }); });
  page.on("pageerror", e => log.pageErrors.push({ ts: now(), text: String(e && e.message || e).slice(0, 500), url: page.url() }));
  page.on("requestfailed", r => log.failedRequests.push({ ts: now(), url: r.url().slice(0, 200), failure: r.failure() && r.failure().errorText }));
  page.on("response", r => { if (r.status() >= 400) log.failedRequests.push({ ts: now(), url: r.url().slice(0, 200), status: r.status() }); });
  page.on("dialog", async d => { log.dialogs.push({ ts: now(), type: d.type(), message: d.message() }); try { await d.accept(); } catch (e) { /* ignore */ } });
  if (NET !== "none" || CPU > 1) {
    const cdp = await context.newCDPSession(page);
    if (NET_PROFILES[NET]) { await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", NET_PROFILES[NET]); }
    if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    page.__cdp = cdp;
  }
}

async function start() {
  browser = await chromium.launch();
  const opts = MOBILE
    ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }
    : { viewport: { width: 1366, height: 860 } };
  context = await browser.newContext(Object.assign({ locale: "pl-PL", timezoneId: "Europe/Warsaw" }, opts));
  context.on("page", async p => { if (!pages.includes(p)) { pages.push(p); await attach(p); } });
  const p = await context.newPage();
  if (!pages.includes(p)) { pages.push(p); await attach(p); }
}

const page = () => pages[active];

/** Visible interactive elements with indexes — what a person can see and touch. */
async function observe(pg, maxText) {
  return pg.evaluate((maxText) => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3; };
    document.querySelectorAll("[data-qa-i]").forEach(e => e.removeAttribute("data-qa-i"));
    const sel = "a[href],button,input,select,textarea,[role=button],[role=tab],[role=menuitem],[role=link],[role=checkbox],[onclick],summary,label[for],[tabindex]:not([tabindex='-1'])";
    const els = [...document.querySelectorAll(sel)].filter(vis);
    const items = els.slice(0, 250).map((el, i) => {
      el.setAttribute("data-qa-i", String(i));
      const r = el.getBoundingClientRect();
      const lab = el.labels && el.labels[0] ? el.labels[0].innerText.trim() : "";
      const name = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 80);
      return { i, tag: el.tagName.toLowerCase(), type: el.type || undefined, name, label: lab.slice(0, 60) || undefined, placeholder: el.getAttribute("placeholder") || undefined,
        value: (el.tagName === "INPUT" || el.tagName === "TEXTAREA") ? String(el.value).slice(0, 60) : (el.tagName === "SELECT" ? (el.selectedOptions[0] ? el.selectedOptions[0].text : "") : undefined),
        options: el.tagName === "SELECT" ? [...el.options].slice(0, 30).map(o => o.text.trim()) : undefined,
        disabled: el.disabled || undefined, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], offscreen: (r.top > innerHeight || r.bottom < 0) || undefined };
    });
    const text = document.body ? document.body.innerText.replace(/\n{3,}/g, "\n\n").slice(0, maxText) : "";
    return { url: location.href, title: document.title, viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth, text, items };
  }, maxText || 4000);
}

function target(pg, c) {
  if (c.i !== undefined) return pg.locator(`[data-qa-i="${c.i}"]`).first();
  if (c.selector) return pg.locator(c.selector).first();
  if (c.text) return pg.getByText(c.text, { exact: !!c.exact }).first();
  if (c.role) return pg.getByRole(c.role, { name: c.name }).first();
  if (c.label) return pg.getByLabel(c.label).first();
  throw new Error("brak celu: podaj i / selector / text / role+name / label");
}

async function run(c) {
  const pg = page();
  const t0 = Date.now();
  const timeout = c.timeout || 15000;
  let res = {};
  switch (c.action) {
    case "goto": await pg.goto(c.url, { waitUntil: c.waitUntil || "load", timeout: c.timeout || 300000 }); break;
    case "observe": res = await observe(pg, c.maxText); break;
    case "click": await target(pg, c).click({ timeout, clickCount: c.count || 1, force: !!c.force }); break;
    case "dblclick": await target(pg, c).dblclick({ timeout }); break;
    case "tap": await target(pg, c).tap({ timeout }); break;
    case "fill": await target(pg, c).fill(String(c.value), { timeout }); break;
    case "type": await target(pg, c).pressSequentially(String(c.value), { timeout: Math.max(timeout, 60000), delay: c.delay || 0 }); break;
    case "press": if (c.i !== undefined || c.selector || c.text || c.label) await target(pg, c).press(c.key, { timeout }); else await pg.keyboard.press(c.key); break;
    case "select": await target(pg, c).selectOption(c.value !== undefined ? { label: String(c.value) } : { index: c.index }, { timeout }); break;
    case "check": await target(pg, c).setChecked(c.checked !== false, { timeout }); break;
    case "hover": await target(pg, c).hover({ timeout }); break;
    case "scroll": await pg.mouse.wheel(0, c.dy || 600); break;
    case "screenshot": {
      const file = path.join(OUT, c.name.endsWith(".png") ? c.name : c.name + ".png");
      await pg.screenshot({ path: file, fullPage: !!c.fullPage, timeout: 120000 }); res = { saved: path.relative(process.cwd(), file) }; break;
    }
    case "back": await pg.goBack({ timeout }); break;
    case "reload": await pg.reload({ timeout: c.timeout || 300000 }); break;
    case "wait": await pg.waitForTimeout(Math.min(c.ms || 1000, 120000)); break;
    case "newTab": { const p = await context.newPage(); if (!pages.includes(p)) { pages.push(p); await attach(p); } active = pages.indexOf(p); if (c.url) await p.goto(c.url, { timeout: 300000 }); res = { tab: active }; break; }
    case "switchTab": active = c.tab; await page().bringToFront(); res = { tab: active, url: page().url() }; break;
    case "tabs": res = { active, tabs: pages.map(p => p.url()) }; break;
    case "eval": res = { value: await pg.evaluate(c.js) }; break; // tylko pomiary (np. rozmiar elementu) — nie czytać kodu aplikacji
    case "tapTargets": res = await pg.evaluate(() => [...document.querySelectorAll("a[href],button,input,select,textarea,[role=button]")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0; }).map(e => { const r = e.getBoundingClientRect(); return { name: (e.getAttribute("aria-label") || e.innerText || e.placeholder || e.title || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w < 44 || x.h < 44)); break;
    case "logs": res = JSON.parse(JSON.stringify(log)); if (c.clear) { log.console = []; log.pageErrors = []; log.failedRequests = []; log.dialogs = []; } break;
    case "close": setTimeout(async () => { try { await browser.close(); } finally { process.exit(0); } }, 50); break;
    default: throw new Error("nieznana akcja: " + c.action);
  }
  if (c.settle !== false && !["observe", "logs", "screenshot", "tabs", "close", "eval", "tapTargets"].includes(c.action)) await pg.waitForTimeout(c.settle || 400);
  return Object.assign({ ok: true, ms: Date.now() - t0, url: page().url(), newErrors: log.pageErrors.length + log.console.filter(x => x.type === "error").length }, res);
}

start().then(() => {
  http.createServer((req, res) => {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      let out;
      try { out = await run(JSON.parse(body || "{}")); }
      catch (e) { out = { ok: false, error: String(e && e.message || e).split("\n").slice(0, 4).join(" | "), url: page() && page().url() }; }
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(out));
    });
  }).listen(PORT, "127.0.0.1", () => console.log(`daemon ready :${PORT} mobile=${MOBILE} net=${NET} cpu=${CPU} out=${OUT}`));
}).catch(e => { console.error(e); process.exit(1); });
