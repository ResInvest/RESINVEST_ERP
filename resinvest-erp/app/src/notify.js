/* =========================================================================
   ResInvest ERP 3.5 — warstwa S: powiadomienia (silnik)

   * Zdarzenia (EVENTS) wynikają z zatwierdzonych zmian: nowa operacja (PZ, WZ, PW, MM,
     operacje dodatkowe), przyjęcie MM, przekazanie do zatwierdzenia i decyzja, korekta,
     anulowanie, usunięcie dokumentu.
   * Odbiorca: konto aktywne, dostęp do magazynu operacji (przy MM — źródło lub cel),
     zdarzenie DOZWOLONE przez administratora i WŁĄCZONE przez użytkownika; autor zmiany
     nie dostaje powiadomienia o własnej zmianie. Jedno powiadomienie na odbiorcę i zmianę.
   * Powiadomienie powstaje w tej samej zmianie danych co operacja (zapis „wszystko albo nic”)
     i trafia do skrzynki w programie (oba tryby pracy). W trybie FIRMOWYM serwer wysyła
     dodatkowo e-mail (kolejka z ponawianiem — server/core.mjs); błąd poczty niczego nie cofa.
   * Treść przechowywana kanonicznie (PL) jako {k, p} — wyświetlana w języku odbiorcy.
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const { byId, uid, clone, audit, Lx, can, canAccessWh, statusOf, Units, OP_TYPES, mmState, ROLES, EPS } = R;
  const I18N = R.I18N;
  const t = (s, p) => I18N.t(s, p);
  const N_ = s => s;
  const str = v => String(v == null ? "" : v).trim();
  const nowIso = ctx => (ctx && ctx.now) || new Date().toISOString();

  /** Zdarzenia, o których można powiadamiać (kolejność = kolejność na ekranie ustawień). */
  const EVENTS = {
    PZ: { label: N_("Przyjęcie / zakup (PZ)"), desc: N_("nowa operacja z dokumentem PZ — także zakup z produkcją") },
    WZ: { label: N_("Wydanie / sprzedaż (WZ)"), desc: N_("sprzedaż z magazynu, sprzedaż wyniku produkcji, sprzedaż bezpośrednia") },
    PW: { label: N_("Produkcja (PW)"), desc: N_("produkcja na magazynie, z zakupu i w lesie") },
    MM: { label: N_("Przesunięcie MM"), desc: N_("wysłanie i przyjęcie MM — magazyn źródłowy i docelowy") },
    EXTRA: { label: N_("Operacje dodatkowe"), desc: N_("operacja z kosztami dodatkowymi (holowanie, praca ładowarką…)") },
    APPROVAL: { label: N_("Do zatwierdzenia"), desc: N_("operacja przekazana do zatwierdzenia — dla zatwierdzających magazyn") },
    DECISION: { label: N_("Decyzja o mojej operacji"), desc: N_("zatwierdzenie albo odrzucenie operacji, którą przekazałem") },
    CORRECTION: { label: N_("Korekta dokumentu"), desc: N_("korekta — numer KOR, powód, pola BYŁO → JEST") },
    CANCEL: { label: N_("Anulowanie dokumentu"), desc: N_("anulowanie operacji — powód, odwrócone ruchy") },
    DELETE: { label: N_("Usunięcie dokumentu"), desc: N_("usunięcie z odwróceniem ruchów — powód") }
  };
  const EVENT_IDS = Object.keys(EVENTS);
  /** Najwięcej powiadomień w danych (najstarsze przeczytane usuwane jako pierwsze). */
  const MAX_NOTICES = 4000;

  /* ---------------- ustawienia ---------------- */
  const valid = list => [...new Set((Array.isArray(list) ? list : []).filter(e => EVENTS[e]))];
  /** Zdarzenia dozwolone przez administratora (administrator — wszystkie). */
  function allowedFor(u) { return !u ? [] : u.role === "admin" ? EVENT_IDS.slice() : valid(u.notifyAllowed); }
  /** Zdarzenia włączone przez użytkownika (tylko dozwolone). */
  function enabledFor(u) { const a = allowedFor(u); return valid(u && u.notify && u.notify.events).filter(e => a.includes(e)); }
  /** Czy użytkownik chce dostawać powiadomienia także e-mailem (domyślnie tak). */
  const wantsEmail = u => !!(u && (!u.notify || u.notify.email !== false) && (u.email || u.login));

  /** Własne ustawienia (każdy zalogowany): włączyć można tylko zdarzenie dozwolone przez administratora. */
  function setMine(state, a, ctx) {
    const u = ctx && ctx.user && byId(state.users, ctx.user.id);
    if (!u) return { ok: false, error: t("Brak zalogowanego użytkownika") };
    const allowed = allowedFor(u);
    const want = valid(a.events);
    const denied = want.filter(e => !allowed.includes(e));
    if (denied.length) return { ok: false, error: t("Zdarzenie „{e}” wymaga zgody administratora", { e: t(EVENTS[denied[0]].label) }), code: "FORBIDDEN" };
    const before = { zdarzenia: enabledFor(u), email: wantsEmail(u) };
    const next = { events: want.filter(e => allowed.includes(e)), email: a.email === undefined ? (u.notify ? u.notify.email !== false : true) : !!a.email && a.email !== "false" };
    if (JSON.stringify(before.zdarzenia.slice().sort()) === JSON.stringify(next.events.slice().sort()) && (!u.notify || u.notify.email !== false) === next.email) return { ok: true, unchanged: true };
    u.notify = next;
    state.rev += 1;
    audit(state, ctx, { entity: "user", entityId: u.id, opNo: u.login, event: "user", code: "NOTIFICATIONS_CHANGED", act: Lx("Zmiana własnych ustawień powiadomień: {l}", { l: u.login }), before, after: { zdarzenia: next.events, email: next.email }, source: (ctx && ctx.source) || N_("Powiadomienia") });
    return { ok: true };
  }
  /** Zgody administratora dla użytkownika. Odebranie zgody wyłącza zdarzenie także w ustawieniach użytkownika. */
  function allow(state, userId, events, ctx) {
    const actor = ctx && ctx.user;
    if (!can(actor, "notifications.manage")) return { ok: false, error: t("Zgody na powiadomienia nadaje administrator"), code: "FORBIDDEN" };
    const u = byId(state.users, str(userId));
    if (!u) return { ok: false, error: t("Nie znaleziono użytkownika") };
    if (u.role === "admin") return { ok: false, error: t("Administrator ma dostęp do wszystkich powiadomień") };
    const next = valid(events), before = valid(u.notifyAllowed);
    if (JSON.stringify(before.slice().sort()) === JSON.stringify(next.slice().sort())) return { ok: true, unchanged: true };
    u.notifyAllowed = next;
    if (u.notify && Array.isArray(u.notify.events)) u.notify.events = u.notify.events.filter(e => next.includes(e));
    state.rev += 1;
    audit(state, ctx, { entity: "user", entityId: u.id, opNo: u.login, event: "user", code: "NOTIFICATIONS_ALLOWED", act: Lx("Zgody na powiadomienia: {l}", { l: u.login }), before: { dozwolone: before }, after: { dozwolone: next }, source: (ctx && ctx.source) || N_("Powiadomienia — zgody") });
    return { ok: true };
  }
  /** Oznaczenie własnych powiadomień jako przeczytanych (`ids` — lista albo "all"). */
  function markRead(state, ids, ctx) {
    const me = ctx && ctx.user && ctx.user.id;
    if (!me) return { ok: false, error: t("Brak zalogowanego użytkownika") };
    const want = ids === "all" ? null : new Set((Array.isArray(ids) ? ids : [ids]).map(String));
    let n = 0;
    // podmiana rekordów (nie zmiana w miejscu) — na serwerze powiadomienia są zamrożone i współdzielone (3.10)
    state.notices = (state.notices || []).map(x => {
      if (x.userId !== me || x.read || (want && !want.has(x.id))) return x;
      n++; return Object.assign(clone(x), { read: true, readAt: nowIso(ctx) });
    });
    if (!n) return { ok: true, unchanged: true, count: 0 };
    state.rev += 1;
    return { ok: true, count: n };
  }

  /* ---------------- treść ---------------- */
  /** Liczba w zapisie polskim (treść kanoniczna) — bez zależności od języka bieżącego żądania. */
  function plNum(n, dec = 3) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const r = R.round(x, dec), [i, f] = Math.abs(r).toFixed(dec).split(".");
    return (r < 0 ? "-" : "") + I18N.num(i, (f || "").replace(/0+$/, ""), "pl");
  }
  const plMoney = n => { const x = R.round(Number(n) || 0, 2), [i, f] = Math.abs(x).toFixed(2).split("."); return (x < 0 ? "-" : "") + I18N.num(i, f, "pl") + " zł"; };
  const plDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : String(d || "");
  const qtyText = (q, u) => q === null || q === undefined ? "" : `${plNum(q)} ${Units.label(u)}`;
  const whName = (state, id) => (byId(state.warehouses, id) || {}).name || "";
  const pName = (state, id) => (byId(state.products, id) || {}).name || "";
  const party = (state, id) => (byId(state.partners, id) || {}).name || "";

  /** Zdarzenia nowej operacji wynikające z jej dokumentów. */
  function opEvents(op) {
    const types = new Set((op.documents || []).map(d => d.type));
    const ev = [];
    if (types.has("PZ")) ev.push("PZ");
    if (types.has("WZ")) ev.push("WZ");
    if (types.has("PW")) ev.push("PW");
    if (op.type === "MM") ev.push("MM");
    if ((op.extras || []).length) ev.push("EXTRA");
    return ev;
  }
  /** Krótki opis: produkt, ilość, kontrahent / magazyn docelowy. */
  function opSummary(state, op) {
    if (op.type === "ZAKUP" && op.purchase) return [pName(state, op.purchase.productId), qtyText(op.purchase.qty, op.purchase.unit), party(state, op.purchase.supplierId) || op.purchase.supplierName].filter(Boolean).join(" · ");
    if (op.type === "PRODUKCJA" && op.production) return [pName(state, op.production.outProductId), qtyText(op.production.outQty, op.production.outUnit)].filter(Boolean).join(" · ");
    if (op.type === "MM" && op.mm) return [pName(state, op.mm.productId), qtyText(op.mm.qty, op.mm.unit), `${whName(state, op.whId)} → ${whName(state, op.toWhId)}`].filter(Boolean).join(" · ");
    if (op.sale) return [pName(state, op.sale.productId), qtyText(op.sale.qty, op.sale.unit), party(state, op.sale.buyerId)].filter(Boolean).join(" · ");
    return "";
  }
  /** Linie treści wspólne dla operacji: magazyn, data, dokumenty, podsumowanie, kwoty, operacje dodatkowe. */
  function opLines(state, op) {
    const L = [];
    L.push(Lx("Magazyn: {w}", { w: whName(state, op.whId) + (op.toWhId ? " → " + whName(state, op.toWhId) : "") }));
    L.push(Lx("Data operacji: {d}", { d: plDate(op.date) }));
    const docs = (op.documents || []).map(d => d.no).filter(Boolean);
    if (docs.length) L.push(Lx("Dokumenty: {d}", { d: docs.join(", ") }));
    const s = opSummary(state, op); if (s) L.push(Lx("Pozycja: {s}", { s }));
    const T = op.totals || {};
    if (T.purchaseCost > EPS) L.push(Lx("Wartość zakupu: {m}", { m: plMoney(T.purchaseCost) }));
    if (T.revenue > EPS) L.push(Lx("Przychód: {m}", { m: plMoney(T.revenue) }));
    if ((op.extras || []).length) L.push(Lx("Operacje dodatkowe: {x}", { x: op.extras.map(x => `${x.typeName} ${plMoney(x.cost)}`).join(", ") }));
    return L;
  }

  /* ---------------- odbiorcy i zapis ---------------- */
  function recipients(state, whIds, events, exceptId) {
    return state.users.filter(u => statusOf(u) === "ACTIVE" && u.id !== exceptId && whIds.some(w => w && canAccessWh(u, w)) && enabledFor(u).some(e => events.includes(e)));
  }
  function push(state, users, base, ctx) {
    if (!users.length) return [];
    if (!Array.isArray(state.notices)) state.notices = [];
    const out = users.map(u => Object.assign({ id: uid("nt"), ts: nowIso(ctx), userId: u.id, read: false, by: ctx && ctx.user ? ctx.user.name : "System", email: wantsEmail(u) }, clone(base), { events: base.events.filter(e => enabledFor(u).includes(e) || e === "DECISION") }));
    state.notices.push(...out);
    prune(state);
    return out;
  }
  /** Limit danych: usuwa najstarsze przeczytane, potem najstarsze. */
  function prune(state) {
    const over = state.notices.length - MAX_NOTICES;
    if (over <= 0) return;
    const readIdx = [];
    state.notices.forEach((n, i) => { if (n.read) readIdx.push(i); });
    const drop = new Set(readIdx.slice(0, over));
    let rest = over - drop.size;
    for (let i = 0; rest > 0 && i < state.notices.length; i++) if (!drop.has(i)) { drop.add(i); rest--; }
    state.notices = state.notices.filter((_, i) => !drop.has(i));
  }

  /** Powiadomienia o operacji (nowa, przyjęcie MM, korekta, anulowanie, usunięcie). */
  function forOperation(state, op, kind, ctx, extra = {}) {
    if (!op) return [];
    const events = kind === "create" ? opEvents(op) : kind === "mm-received" ? ["MM"] : kind === "correction" ? ["CORRECTION"] : kind === "cancel" ? ["CANCEL"] : kind === "delete" ? ["DELETE"] : [];
    if (!events.length) return [];
    const typeLbl = { t: OP_TYPES[op.type] ? OP_TYPES[op.type].label : op.type };
    const title = kind === "create" ? (op.type === "MM" && mmState(op) === "W_DRODZE" ? Lx("Wysłano MM {no} do magazynu {w} — czeka na przyjęcie", { no: op.no, w: whName(state, op.toWhId) }) : Lx("Nowa operacja: {type} {no}", { type: typeLbl, no: op.no }))
      : kind === "mm-received" ? Lx("Przyjęto MM {no} w magazynie {w}", { no: op.no, w: whName(state, op.toWhId) })
        : kind === "correction" ? Lx("Korekta {k} dokumentu {no}", { k: extra.no || "", no: op.no })
          : kind === "cancel" ? Lx("Anulowano operację {no}", { no: op.no }) : Lx("Usunięto dokument {no}", { no: op.no });
    const lines = opLines(state, op);
    if (kind === "mm-received" && op.mm && op.mm.receipt) {
      const rc = op.mm.receipt;
      lines.push(Lx("Przyjęto: {q}", { q: qtyText(rc.qty, rc.unit || op.mm.unit) }));
      if (rc.diff && Math.abs(rc.diff) > EPS) lines.push(Lx("Różnica: {q}", { q: qtyText(rc.diff, op.mm.stockUnit || op.mm.unit) }));
    }
    if (kind === "correction" && extra.correction) {
      const c = extra.correction;
      lines.push(Lx("Powód: {r}", { r: c.reason }));
      for (const ch of (c.changes || []).slice(0, 8)) lines.push(Lx("{f}: {a} → {b}", { f: { t: ch.label }, a: ch.beforeText, b: ch.afterText }));
    }
    if ((kind === "cancel" || kind === "delete") && extra.reason) lines.push(Lx("Powód: {r}", { r: extra.reason }));
    const author = ctx && ctx.user;
    lines.push(Lx("Wprowadził: {u}", { u: author ? author.name : "System" }));
    const whIds = [op.whId, op.toWhId].filter(Boolean);
    return push(state, recipients(state, whIds, events, author && author.id), { kind, events, opId: op.id, opNo: op.no, whId: op.whId, toWhId: op.toWhId || null, title, lines }, ctx);
  }
  /** Operacja przekazana do zatwierdzenia → zatwierdzający magazyn. */
  function forSubmit(state, draft, ctx) {
    if (!draft) return [];
    const approvers = state.users.filter(u => statusOf(u) === "ACTIVE" && u.id !== draft.userId && R.canApprove(u, draft.whId) && enabledFor(u).includes("APPROVAL"));
    return push(state, approvers, {
      kind: "approval", events: ["APPROVAL"], draftId: draft.id, opId: null, opNo: null, whId: draft.whId, toWhId: null,
      title: Lx("Do zatwierdzenia: {type}", { type: { t: OP_TYPES[draft.type] ? OP_TYPES[draft.type].label : draft.type } }),
      lines: [Lx("Magazyn: {w}", { w: whName(state, draft.whId) }), Lx("Pozycja: {s}", { s: draft.summary || "—" }), Lx("Wprowadził: {u}", { u: draft.userName })]
    }, ctx);
  }
  /** Decyzja o przekazanej operacji → autor (zatwierdzenie z numerem albo odrzucenie z powodem). */
  function forDecision(state, authorId, approved, info, ctx) {
    const u = byId(state.users, authorId);
    if (!u || statusOf(u) !== "ACTIVE" || (ctx && ctx.user && ctx.user.id === u.id) || !enabledFor(u).includes("DECISION")) return [];
    const lines = [Lx("Magazyn: {w}", { w: whName(state, info.whId) })];
    if (info.summary) lines.push(Lx("Pozycja: {s}", { s: info.summary }));
    if (!approved && info.reason) lines.push(Lx("Powód: {r}", { r: info.reason }));
    lines.push(Lx(approved ? "Zatwierdził: {u}" : "Odrzucił: {u}", { u: ctx && ctx.user ? ctx.user.name : "System" }));
    return push(state, [u], {
      kind: approved ? "approved" : "rejected", events: ["DECISION"], opId: info.opId || null, opNo: info.opNo || null, draftId: info.draftId || null, whId: info.whId, toWhId: null,
      title: approved ? Lx("Zatwierdzono Twoją operację {no}", { no: info.opNo || "" }) : Lx("Odrzucono Twoją operację: {type}", { type: { t: OP_TYPES[info.type] ? OP_TYPES[info.type].label : info.type || "" } }),
      lines
    }, ctx);
  }

  /** Nowe zgłoszenie rejestracji → aktywni administratorzy (uprawnienie users.manage). */
  function forRegistration(state, reg, ctx) {
    if (!reg) return [];
    const admins = state.users.filter(u => statusOf(u) === "ACTIVE" && u.id !== reg.id && R.can(u, "users.manage"));
    const lines = [Lx("E-mail: {e}", { e: reg.email || reg.login })];
    if (reg.phone) lines.push(Lx("Telefon: {p}", { p: reg.phone }));
    lines.push(Lx("Zatwierdź w: Administracja → Użytkownicy (nadaj rolę i magazyn) albo odrzuć zgłoszenie."));
    return push(state, admins, { kind: "registration", events: [], opId: null, opNo: null, draftId: null, whId: null, toWhId: null, userRef: reg.id,
      title: Lx("Nowe zgłoszenie rejestracji: {n}", { n: reg.name }), lines }, Object.assign({}, ctx, { user: null }));
  }

  /**
   * Wywoływane przez usługę po udanej komendzie (na tej samej kopii stanu, przed zapisem).
   * `before` — stan rekordów potrzebny do decyzji (np. autor przekazanej operacji).
   */
  function afterCommand(state, cmd, args, res, ctx, before) {
    if (!res || !res.ok || res.duplicate || res.unchanged) return [];
    try {
      switch (cmd) {
        case "op.commit": return forOperation(state, res.op, "create", ctx);
        case "op.approve": {
          const out = forOperation(state, res.op, "create", ctx);
          const d = before && before.draft;
          if (d && res.op) out.push(...forDecision(state, d.userId, true, { opId: res.op.id, opNo: res.op.no, whId: d.whId, summary: d.summary, type: d.type }, ctx));
          return out;
        }
        case "op.submit": return forSubmit(state, byId(state.drafts, res.id), ctx);
        case "op.reject": { const d = byId(state.drafts, str(args.id)); return d ? forDecision(state, d.userId, false, { draftId: d.id, whId: d.whId, summary: d.summary, type: d.type, reason: d.rejectReason }, ctx) : []; }
        case "mm.receive": return forOperation(state, res.op, "mm-received", ctx);
        case "op.correct": case "op.reverseCorrection": return forOperation(state, res.op || byId(state.operations, str(args.opId)), "correction", ctx, { no: res.no, correction: res.correction || (res.op && res.op.corrections[res.op.corrections.length - 1]) });
        case "op.cancel": return forOperation(state, res.op || byId(state.operations, str(args.opId)), "cancel", ctx, { reason: str(args.reason) });
        case "op.delete": return forOperation(state, res.op || byId(state.operations, str(args.opId)), "delete", ctx, { reason: str(args.reason) });
        default: return [];
      }
    } catch (e) {
      // zapis do zamrożonego rekordu (serwer, zapis przyrostowy) — komenda powtarza się na pełnej kopii, więc błąd idzie wyżej
      if (e instanceof TypeError && /read[- ]only|not extensible|Cannot (?:assign|add|delete|define|redefine)|frozen/i.test(e.message)) throw e;
      // powiadomienie nigdy nie blokuje operacji — błąd treści zapisuje się w dzienniku konsoli
      if (typeof console !== "undefined") console.error("Powiadomienia:", e);
      return [];
    }
  }
  /** Komendy, po których powstają powiadomienia (usługa zapamiętuje dla nich stan „przed”). */
  const COMMANDS = ["op.commit", "op.approve", "op.submit", "op.reject", "mm.receive", "op.correct", "op.reverseCorrection", "op.cancel", "op.delete"];
  const beforeOf = (state, cmd, args) => cmd === "op.approve" ? { draft: clone(byId(state.drafts, str(args.id)) || null) } : null;

  /** Treść e-maila (PL — dokumenty firmy): temat i linie. */
  function mailContent(n) {
    return { subject: I18N.canon(n.title), lines: (n.lines || []).map(l => I18N.canon(l)) };
  }

  R.Notify = { EVENTS, EVENT_IDS, MAX_NOTICES, allowedFor, enabledFor, wantsEmail, setMine, allow, markRead, opEvents, opSummary, forOperation, forSubmit, forDecision, forRegistration, afterCommand, COMMANDS, beforeOf, mailContent, recipients };
  if (typeof module !== "undefined" && module.exports) module.exports = R.Notify;
})(typeof globalThis !== "undefined" ? globalThis : this);
