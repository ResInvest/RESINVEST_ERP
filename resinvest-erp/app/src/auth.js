/* =========================================================================
   ResInvest ERP 3.2 — warstwa A0: logowanie w trybie lokalnym (jedno stanowisko)

   * Hasła: PBKDF2-SHA256 (Web Crypto; awaryjnie implementacja JS), sól 16 B,
     120 000 iteracji. Hasła nigdy nie są zapisywane ani logowane jawnie.
   * Blokada konta po 5 nieudanych próbach na 15 minut (konfigurowalne),
     wylogowanie po 30 min bezczynności, wymuszenie zmiany hasła.
   * Dziennik logowań (udane i nieudane) — ostatnie 500 wpisów.
   * Konta (skróty haseł) są przechowywane osobno od danych magazynowych
     (klucz riw.v3.auth) i nie trafiają do kopii zapasowej JSON.
   W trybie serwerowym ten moduł nie jest używany — hasła i sesje obsługuje
   serwer (scrypt, sesje HttpOnly) — patrz server/auth.mjs.
   ========================================================================= */
(function (root) {
  "use strict";
  const t = (s, p) => root.RIW_I18N.t(s, p);
  const N_ = s => s;

  /* ---------------- SHA-256 / HMAC / PBKDF2 (awaryjnie, bez Web Crypto) ---------------- */
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(bytes) {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
    m.set(bytes); m[l] = 0x80;
    const bits = l * 8; m[n - 4] = bits >>> 24; m[n - 3] = bits >>> 16; m[n - 2] = bits >>> 8; m[n - 1] = bits; m[n - 5] = Math.floor(bits / 2 ** 32);
    const W = new Uint32Array(64);
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const a = W[i - 15], b = W[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) { out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = H[i] >>> 16; out[i * 4 + 2] = H[i] >>> 8; out[i * 4 + 3] = H[i]; }
    return out;
  }
  function hmacFactory(key) {
    let k = key.length > 64 ? sha256(key) : key;
    const ik = new Uint8Array(64), ok = new Uint8Array(64);
    for (let i = 0; i < 64; i++) { const x = i < k.length ? k[i] : 0; ik[i] = x ^ 0x36; ok[i] = x ^ 0x5c; }
    return msg => { const a = new Uint8Array(64 + msg.length); a.set(ik); a.set(msg, 64); const inner = sha256(a); const b = new Uint8Array(96); b.set(ok); b.set(inner, 64); return sha256(b); };
  }
  function pbkdf2Js(pass, salt, iter, len = 32) {
    const hmac = hmacFactory(pass), out = new Uint8Array(len);
    for (let block = 1, pos = 0; pos < len; block++) {
      const s = new Uint8Array(salt.length + 4); s.set(salt); s[salt.length] = block >>> 24; s[salt.length + 1] = block >>> 16; s[salt.length + 2] = block >>> 8; s[salt.length + 3] = block;
      let u = hmac(s); const acc = u.slice();
      for (let i = 1; i < iter; i++) { u = hmac(u); for (let j = 0; j < 32; j++) acc[j] ^= u[j]; }
      out.set(acc.slice(0, Math.min(32, len - pos)), pos); pos += 32;
    }
    return out;
  }
  const enc = s => new TextEncoder().encode(String(s));
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  const unhex = h => new Uint8Array(String(h).match(/../g).map(x => parseInt(x, 16)));
  const randomBytes = n => { const a = new Uint8Array(n); (root.crypto && root.crypto.getRandomValues ? root.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); })); return a; };
  async function pbkdf2(pass, salt, iter) {
    const subtle = root.crypto && root.crypto.subtle;
    if (subtle) {
      try {
        const key = await subtle.importKey("raw", enc(pass), "PBKDF2", false, ["deriveBits"]);
        return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
      } catch (e) { /* kontekst bez Web Crypto — wersja JS */ }
    }
    return pbkdf2Js(enc(pass), salt, iter);
  }
  /** Porównanie w stałym czasie (bez wczesnego wyjścia). */
  const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

  /* ---------------- polityka haseł (wspólna z serwerem) ---------------- */
  const POLICY = { minLength: 8, maxFailed: 5, lockMinutes: 15, idleMinutes: 30, iterations: 120000 };
  function passwordProblems(pw, login) {
    const p = String(pw || ""), out = [];
    if (p.length < POLICY.minLength) out.push(t("co najmniej {n} znaków", { n: POLICY.minLength }));
    if (!/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(p) || !/\d/.test(p)) out.push(t("litery i cyfry"));
    const lg = String(login || "").toLowerCase().split("@")[0];   // e-mail: sprawdzana część przed „@”
    if (lg.length >= 3 && p.toLowerCase().includes(lg)) out.push(t("nie może zawierać loginu"));
    if (p.length > 128) out.push(t("maksymalnie 128 znaków"));
    return out;
  }
  function passwordError(pw, login) {
    const p = passwordProblems(pw, login);
    return p.length ? t("Hasło musi mieć: {x}", { x: p.join(", ") }) : null;
  }
  async function hashPassword(pw, iter = POLICY.iterations) {
    const salt = randomBytes(16);
    return { algo: "pbkdf2-sha256", iter, salt: hex(salt), hash: hex(await pbkdf2(pw, salt, iter)) };
  }
  async function verifyPassword(pw, rec) {
    if (!rec || rec.algo !== "pbkdf2-sha256") return false;
    return same(hex(await pbkdf2(pw, unhex(rec.salt), rec.iter)), rec.hash);
  }

  /* ---------------- tryb lokalny: konta w przeglądarce ---------------- */
  const AUTH_KEY = "riw.v3.auth", SESSION_KEY = "riw.v3.session";
  /** Konta danych przykładowych (tryb lokalny / demonstracyjny) — hasło startowe „demo1234”. */
  const DEMO_PASSWORD = "demo1234";
  const DEMO_LOGINS = ["magazyn@resinvest.group", "anna.gorska@resinvest.group", "adrian.wojciechowski@resinvest.group", "tomasz.zajac@resinvest.group",
    "pawel.kaczmarek@resinvest.group", "michal.lewandowski@resinvest.group", "karolina.wisniewska@resinvest.group", "beata.nowak@resinvest.group", "ewa.krawczyk@resinvest.group"];

  const LocalAuth = {
    store: null, memory: null,
    read() {
      if (this.store) return this.store;
      let s = null;
      try { s = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) { s = null; }
      if (!s || typeof s !== "object" || !s.accounts) s = { v: 1, accounts: {}, log: [] };
      return (this.store = s);
    },
    write() { try { localStorage.setItem(AUTH_KEY, JSON.stringify(this.store)); } catch (e) { /* tryb bez zapisu */ } },
    log(entry) { const s = this.read(); s.log.push(Object.assign({ ts: new Date().toISOString() }, entry)); if (s.log.length > 500) s.log = s.log.slice(-500); this.write(); },
    /** Konta danych przykładowych dostają hasło startowe przy pierwszym uruchomieniu. */
    async ensureDemo(state) {
      if (!state || !state.meta || !state.meta.sample) return;            // tylko dane przykładowe (nie czysta baza firmy)
      const s = this.read(); let changed = false;
      for (const u of state.users) {
        if (s.accounts[u.id] || !DEMO_LOGINS.includes(u.login)) continue;
        s.accounts[u.id] = Object.assign(await hashPassword(DEMO_PASSWORD, 20000), { mustChange: false, failed: 0, lockedUntil: null, changedAt: null, demo: true });
        changed = true;
      }
      if (changed) this.write();
    },
    /**
     * Konto startowe administratora (pierwsze uruchomienie, hasło z konfiguracji): tylko gdy konto nie ma jeszcze hasła;
     * przy pierwszym logowaniu program wymusza zmianę hasła.
     */
    async ensureStartup(state, login, pw) {
      const u = state.users.find(x => String(x.login).toLowerCase() === String(login).toLowerCase());
      const s = this.read();
      if (!u || !pw) return false;
      // konto z hasłem demonstracyjnym w danych firmy (pozostałość po danych przykładowych) → hasło startowe z konfiguracji
      const stale = s.accounts[u.id] && s.accounts[u.id].demo && !(state.meta && state.meta.sample);
      if (s.accounts[u.id] && !stale) return false;
      s.accounts[u.id] = Object.assign(await hashPassword(pw), { mustChange: true, failed: 0, lockedUntil: null, changedAt: null, startup: true });
      this.write();
      this.log({ login: u.login, userId: u.id, ok: true, reason: N_("konto startowe administratora") });
      return true;
    },
    /** Hasło konta z konfiguracji instalacji (konto testowe / startowe administratora). */
    async setConfigPassword(state, userId, pw, mustChange) {
      const u = state.users.find(x => x.id === userId); if (!u) return false;
      const s = this.read();
      s.accounts[userId] = Object.assign(await hashPassword(pw, 20000), { mustChange: !!mustChange, failed: 0, lockedUntil: null, changedAt: null, startup: !!mustChange, config: true });
      this.write();
      this.log({ login: u.login, userId, ok: true, reason: N_("konto z konfiguracji instalacji") });
      return true;
    },
    hasPassword(userId) { return !!this.read().accounts[userId]; },
    info(userId) { const a = this.read().accounts[userId]; return a ? { hasPassword: true, mustChange: !!a.mustChange, failed: a.failed || 0, lockedUntil: a.lockedUntil || null, lastLogin: a.lastLogin || null, changedAt: a.changedAt || null, demo: !!a.demo, startup: !!a.startup && !a.lastLogin } : { hasPassword: false }; },
    async login(state, login, password) {
      const L = String(login || "").trim().toLowerCase();
      const u = state.users.find(x => String(x.login).toLowerCase() === L || String(x.email || "").toLowerCase() === L);
      const s = this.read();
      const fail = (code, reason) => { this.log({ login: L, userId: u ? u.id : null, ok: false, reason }); return { ok: false, code, error: code === "LOCKED" ? reason : t("Nieprawidłowy e-mail lub hasło.") }; };
      if (!L || !password) return { ok: false, code: "EMPTY", error: t("Podaj e-mail służbowy i hasło") };
      if (!u) return fail("BAD", N_("nieznany login"));
      const acc = s.accounts[u.id];
      if (!acc) return fail("BAD", N_("konto bez hasła"));
      if (acc.lockedUntil && Date.parse(acc.lockedUntil) > Date.now()) {
        const min = Math.ceil((Date.parse(acc.lockedUntil) - Date.now()) / 60000);
        return fail("LOCKED", t("Konto zablokowane po nieudanych próbach logowania. Spróbuj za {n} min albo poproś administratora o odblokowanie.", { n: min }));
      }
      if (!(await verifyPassword(password, acc))) {
        acc.failed = (acc.failed || 0) + 1;
        if (acc.failed >= POLICY.maxFailed) { acc.lockedUntil = new Date(Date.now() + POLICY.lockMinutes * 60000).toISOString(); acc.failed = 0; }
        this.write();
        return fail("BAD", N_("błędne hasło"));
      }
      const st = root.RIW.statusOf(u);
      if (st === "INVITED") { this.log({ login: L, userId: u.id, ok: false, reason: N_("konto nieaktywowane") }); return { ok: false, code: "INVITED", error: u.selfRegistered ? t("Konto oczekuje na zatwierdzenie przez administratora. Otrzymasz dostęp po nadaniu roli i magazynu.") : t("Twoje konto nie zostało jeszcze aktywowane.") }; }
      if (st !== "ACTIVE") { this.log({ login: L, userId: u.id, ok: false, reason: st === "SUSPENDED" ? N_("konto zawieszone") : N_("konto dezaktywowane") }); return { ok: false, code: "INACTIVE", error: t("Twoje konto jest nieaktywne.") }; }
      acc.failed = 0; acc.lockedUntil = null; acc.lastLogin = new Date().toISOString();
      this.write();
      this.log({ login: L, userId: u.id, ok: true, reason: "" });
      this.startSession(u.id);
      return { ok: true, userId: u.id, mustChange: !!acc.mustChange };
    },
    startSession(userId) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId, at: Date.now(), last: Date.now() })); } catch (e) { this.memory = { userId, at: Date.now(), last: Date.now() }; } },
    session() {
      let s = this.memory;
      try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") || this.memory; } catch (e) {}
      if (!s) return null;
      if (Date.now() - s.last > POLICY.idleMinutes * 60000) { this.logout("timeout"); return null; }
      return s;
    },
    touch() { const s = this.session(); if (s) { s.last = Date.now(); try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { this.memory = s; } } },
    logout(reason) {
      const s = this.memory || (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } })();
      if (s && reason) this.log({ login: "", userId: s.userId, ok: true, reason: reason === "timeout" ? N_("wylogowanie po bezczynności") : N_("wylogowanie") });
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
      this.memory = null;
    },
    async changePassword(state, userId, oldPw, newPw) {
      const u = state.users.find(x => x.id === userId), acc = this.read().accounts[userId];
      if (!u || !acc) return { ok: false, error: t("Nie znaleziono konta") };
      if (!(await verifyPassword(oldPw, acc))) return { ok: false, field: "old", error: t("Obecne hasło jest nieprawidłowe") };
      const e = passwordError(newPw, u.login);
      if (e) return { ok: false, field: "new", error: e };
      if (await verifyPassword(newPw, acc)) return { ok: false, field: "new", error: t("Nowe hasło musi być inne niż obecne") };
      this.read().accounts[userId] = Object.assign(await hashPassword(newPw), { mustChange: false, failed: 0, lockedUntil: null, changedAt: new Date().toISOString(), lastLogin: acc.lastLogin });
      this.write();
      this.log({ login: u.login, userId, ok: true, reason: N_("zmiana hasła") });
      return { ok: true };
    },
    /** Hasło podane przy rejestracji (konto oczekuje na zatwierdzenie przez administratora). */
    async setInitial(state, userId, pw) {
      const u = state.users.find(x => x.id === userId);
      if (!u) return { ok: false, error: t("Nie znaleziono użytkownika") };
      const e = passwordError(pw, u.login);
      if (e) return { ok: false, field: "password", error: e };
      this.read().accounts[userId] = Object.assign(await hashPassword(pw), { mustChange: false, failed: 0, lockedUntil: null, changedAt: new Date().toISOString(), lastLogin: null });
      this.write();
      this.log({ login: u.login, userId, ok: true, reason: N_("rejestracja konta") });
      return { ok: true };
    },
    /** Usunięcie konta (usunięty użytkownik). */
    drop(userId) { const s = this.read(); if (s.accounts[userId]) { delete s.accounts[userId]; this.write(); } },
    /** Administrator ustawia hasło (nowe konto albo reset) — użytkownik zmieni je przy logowaniu. */
    async setPassword(state, adminUser, userId, newPw, mustChange = true) {
      const u = state.users.find(x => x.id === userId);
      if (!u) return { ok: false, error: t("Nie znaleziono użytkownika") };
      if (!root.RIW.can(adminUser, "users.manage")) return { ok: false, error: t("Zarządzanie użytkownikami wymaga roli Administrator") };
      const e = passwordError(newPw, u.login);
      if (e) return { ok: false, field: "password", error: e };
      const prev = this.read().accounts[userId];
      this.read().accounts[userId] = Object.assign(await hashPassword(newPw), { mustChange: !!mustChange, failed: 0, lockedUntil: null, changedAt: new Date().toISOString(), lastLogin: prev ? prev.lastLogin : null });
      this.write();
      this.log({ login: u.login, userId, ok: true, reason: N_("hasło ustawione przez administratora") });
      return { ok: true };
    },
    unlock(adminUser, userId) {
      if (!root.RIW.can(adminUser, "users.manage")) return { ok: false, error: t("Zarządzanie użytkownikami wymaga roli Administrator") };
      const acc = this.read().accounts[userId];
      if (!acc) return { ok: false, error: t("Nie znaleziono konta") };
      acc.failed = 0; acc.lockedUntil = null; this.write();
      return { ok: true };
    },
    loginLog() { return this.read().log.slice().reverse(); }
  };

  root.RIW_Auth = { POLICY, passwordProblems, passwordError, hashPassword, verifyPassword, pbkdf2Js, sha256, hex, LocalAuth, DEMO_PASSWORD, DEMO_LOGINS, AUTH_KEY, SESSION_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = root.RIW_Auth;
})(typeof globalThis !== "undefined" ? globalThis : this);
