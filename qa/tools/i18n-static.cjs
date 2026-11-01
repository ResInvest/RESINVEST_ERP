// Statyczny test pokrycia: wszystkie literały t()/th()/tp()/N_() w index.html muszą mieć tłumaczenie CS i EN.
"use strict";
const fs = require("fs"), vm = require("vm");
const file = process.argv[2] || "index.html";
const html = fs.readFileSync(file, "utf8");
// słownik: wykonujemy tylko skrypty i18n (i18n.js + i18n.dNN.js)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => /^\s*\/\* i18n[.\w-]*\.js \*\//.test(s));
const ctx = { globalThis: {}, console }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const s of scripts) vm.runInContext(s, ctx);
const I = ctx.RIW_I18N; const en = I.dict.en, cs = I.dict.cs;
const keys = new Set();
const re = /\b(?:t|th|tp|N_|Lx)\(\s*"((?:[^"\\]|\\.)*)"/g;
for (const s of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => !/^\s*\/\* i18n/.test(s))) {
  for (const m of s.matchAll(re)) { try { keys.add(JSON.parse('"' + m[1] + '"')); } catch (e) {} }
}
const missing = [...keys].filter(k => k && /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(k) && (!(k in en) || !(k in cs)));
console.log(JSON.stringify({ scripts: scripts.length, keys: keys.size, missing: missing.length, list: missing }, null, 1));
process.exit(missing.length ? 1 : 0);
