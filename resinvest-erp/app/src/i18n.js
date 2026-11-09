/* =========================================================================
   ResInvest ERP — warstwa 0: tłumaczenia (PL · CS · EN)

   Zasady:
   * Językiem źródłowym jest polski — tekst polski jest jednocześnie kluczem.
     t("Zapisz") → „Uložit” (cs) / „Save” (en). Brak tłumaczenia → tekst polski.
   * Parametry: t("Stan {q} {u}", { q: "10", u: "MP" }).
   * Liczba mnoga: tp("{n} błąd|{n} błędy|{n} błędów", n) — formy wg reguł języka.
   * N_("…") oznacza tekst do przetłumaczenia PÓŹNIEJ (słowniki silnika, teksty
     zapisywane w danych w postaci kanonicznej) — zwraca tekst bez zmian.
   * Teksty zapisane w danych (audyt, statusy) są przechowywane po polsku
     (kanonicznie) i tłumaczone przy wyświetlaniu: t(zapisany) albo tr({k, p}).
   * Formatowanie liczb i dat zależy od języka (pl-PL · cs-CZ · en-GB).
   * Moduł działa w przeglądarce i w Node (serwer, testy) — bez DOM.
   Słowniki: app/src/i18n.dNN.js (pary CS/EN, ładowane w kolejności nazw).
   Pokrycie słowników sprawdza test tests/i18n.test.mjs (każdy t/tp/N_ ma CS i EN).
   ========================================================================= */
(function (root) {
  "use strict";

  const LANGS = {
    pl: { code: "pl", label: "Polski", short: "PL", locale: "pl-PL", dec: ",", group: " ", date: "dmy.", plural: "pl" },
    cs: { code: "cs", label: "Čeština", short: "CS", locale: "cs-CZ", dec: ",", group: " ", date: "dmy.", plural: "cs" },
    en: { code: "en", label: "English", short: "EN", locale: "en-GB", dec: ".", group: ",", date: "dmy/", plural: "en" }
  };

  const PLURAL = {
    pl: n => n === 1 ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 1 : 2,
    cs: n => n === 1 ? 0 : (n >= 2 && n <= 4) ? 1 : 2,
    en: n => n === 1 ? 0 : 1
  };

  const fill = (s, p) => !p ? s : s.replace(/\{(\w+)\}/g, (m, k) => (p[k] === undefined || p[k] === null) ? m : String(p[k]));

  const I18N = {
    LANGS,
    lang: "pl",
    dict: { cs: {}, en: {} },
    /** Klucze, dla których zabrakło tłumaczenia (diagnostyka; test pokrycia pilnuje, by było puste). */
    missing: new Set(),

    has(lang) { return !!LANGS[lang]; },
    setLang(lang) { if (LANGS[lang]) this.lang = lang; return this.lang; },
    info(lang) { return LANGS[lang || this.lang] || LANGS.pl; },
    /** Dołącza słownik (pliki i18n.cs.js / i18n.en.js). */
    add(lang, entries) { Object.assign(this.dict[lang] || (this.dict[lang] = {}), entries); },
    /** Dołącza część słownika w postaci par { "tekst PL": ["čeština", "English"] } (pliki i18n.dNN.js). */
    addPairs(pairs) {
      for (const [k, v] of Object.entries(pairs)) { this.dict.cs[k] = v[0]; this.dict.en[k] = v[1]; }
    },

    raw(src, lang) {
      const L = lang || this.lang;
      if (L === "pl" || src === "" || src == null) return src == null ? "" : String(src);
      const d = this.dict[L];
      const v = d && Object.prototype.hasOwnProperty.call(d, src) ? d[src] : undefined;
      if (v === undefined) { this.missing.add(src); return String(src); }
      return v;
    },
    t(src, params, lang) { return fill(this.raw(src, lang), params); },
    tp(src, n, params, lang) {
      const L = lang || this.lang;
      const forms = this.raw(src, L).split("|");
      const idx = Math.min(forms.length - 1, (PLURAL[this.info(L).plural] || PLURAL.pl)(Math.abs(Math.round(n))));
      return fill(forms[idx], Object.assign({ n }, params || {}));
    },
    /** Tekst zapisany w danych: string (kanoniczny PL) albo {k, p} — parametry {t: "…"} też są tłumaczone. */
    tr(v, lang) {
      if (v == null) return "";
      if (typeof v === "string") return this.t(v, null, lang);
      if (typeof v === "object" && typeof v.k === "string") {
        const p = {};
        for (const [k, x] of Object.entries(v.p || {})) p[k] = x && typeof x === "object" && typeof x.t === "string" ? this.t(x.t, null, lang) : x;
        return this.t(v.k, p, lang);
      }
      return String(v);
    },
    /** Kanoniczna (polska) postać tekstu {k, p} — zapisywana w danych obok struktury. */
    canon(v) { return this.tr(v, "pl"); },

    /* ---------- formatowanie zależne od języka ---------- */
    num(intPart, frac, lang) {
      const L = this.info(lang);
      return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, L.group) + (frac ? L.dec + frac : "");
    },
    date(iso, lang) {
      if (!iso) return "";
      const d = String(iso).slice(8, 10), m = String(iso).slice(5, 7), y = String(iso).slice(0, 4);
      return this.info(lang).date === "dmy/" ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
    },
    /** Wybór języka startowego: zapisany w przeglądarce → język przeglądarki → polski. */
    detect(saved, navLang) {
      if (LANGS[saved]) return saved;
      const n = String(navLang || "").slice(0, 2).toLowerCase();
      return LANGS[n] ? n : "pl";
    }
  };

  root.RIW_I18N = I18N;
  root.t = (s, p) => I18N.t(s, p);
  root.tp = (s, n, p) => I18N.tp(s, n, p);
  root.N_ = s => s;
  if (typeof module !== "undefined" && module.exports) module.exports = I18N;
})(typeof globalThis !== "undefined" ? globalThis : this);
