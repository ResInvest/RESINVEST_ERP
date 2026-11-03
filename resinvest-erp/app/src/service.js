/* =========================================================================
   ResInvest ERP 3.2 — warstwa S: usługa aplikacyjna (komendy)

   Jedyne wejście do zmian danych — identyczne w trybie lokalnym (przeglądarka)
   i serwerowym (Node + SQLite):
     Service.exec(state, "op.commit", { draft }, ctx) → wynik silnika
   * `ctx.user` pochodzi WYŁĄCZNIE z sesji (serwer / moduł logowania), nigdy z argumentów,
   * uprawnienie komendy jest sprawdzane tutaj i ponownie w silniku,
   * komenda pracuje na KOPII stanu — host zapisuje ją tylko przy { ok: true }
     (zapis „wszystko albo nic”),
   * `args.source` to kanoniczny (polski) opis miejsca w programie do audytu.
   Konta i hasła NIE są częścią stanu — obsługuje je moduł Auth hosta.
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  if (!R.Planner && typeof require === "function") require("./planner.js");
  if (!R.Notify && typeof require === "function") require("./notify.js");
  const t = (s, p) => R.I18N.t(s, p);
  const N_ = s => s;
  const str = v => String(v == null ? "" : v).trim();

  /** Stan zastępowany w całości (import kopii, dane przykładowe): kontrola kształtu + migracja + zachowanie kont. */
  function replaceState(s, next, ctx, action, detail) {
    const m = R.migrate(next);
    if (m.error) return { ok: false, error: m.error };
    const n = m.state;
    const errs = R.validateStateShape(n);
    if (errs.length) return { ok: false, error: t("Kopia odrzucona: {e}", { e: errs.slice(0, 3).join("; ") }) };
    // zalogowany administrator musi istnieć w nowych danych (inaczej system byłby bez dostępu)
    const liveAdmin = u => u.role === "admin" && R.statusOf(u) === "ACTIVE";
    if (!n.users.some(u => u.id === ctx.user.id && liveAdmin(u)) && !n.users.some(u => u.login === ctx.user.login && liveAdmin(u))) {
      const me = R.clone(R.byId(s.users, ctx.user.id));
      if (me) { if (!R.byId(n.warehouses, me.whId)) me.whId = (n.warehouses[0] || {}).id; n.users.push(me); }
    }
    const before = { rewizja: s.rev, operacje: s.operations.length };
    n.rev = Math.max(s.rev, n.rev || 0) + 1;
    Object.keys(s).forEach(k => delete s[k]);
    Object.assign(s, n);
    // dane wczytane świadomie (import kopii, dane przykładowe) — start programu ich nie czyści
    s.meta = Object.assign({}, s.meta, { keepSample: true });
    R.audit(s, ctx, { entity: "system", entityId: action, opNo: action, event: action, action: detail, before, after: { rewizja: s.rev, operacje: s.operations.length, migracja: m.from !== m.to ? `${m.from} → ${m.to}` : "" } });
    return { ok: true, migrated: m.from !== m.to, notes: m.notes };
  }

  const COMMANDS = {
    /* ---- operacje ---- */
    "draft.save": { perm: "op.create", run: (s, a, c) => R.saveDraft(s, a.draft, c) },
    "draft.delete": { run: (s, a, c) => R.deleteDraft(s, a.id, c) },
    /**
     * Zatwierdzenie operacji. Obieg zatwierdzania wyłączony (domyślnie) — każdy z uprawnieniem do wprowadzania;
     * włączony (`config.requireApproval`) — tylko z „op.approve”, pozostali przekazują operację (op.submit).
     */
    "op.commit": { perm: "op.create", run: (s, a, c) => {
      if (s.config.requireApproval && !R.can(c.user, "op.approve")) return { ok: false, error: t("Obieg zatwierdzania jest włączony — przekaż operację do zatwierdzenia"), code: "FORBIDDEN" };
      return R.commitOperation(s, a.draft, c);
    } },
    "op.submit": { perm: "op.create", run: (s, a, c) => R.submitOperation(s, a.draft, c) },
    "op.approve": { perm: "op.approve", run: (s, a, c) => R.approvePending(s, a.id, a.draft || null, c) },
    "op.reject": { perm: "op.approve", run: (s, a, c) => R.rejectPending(s, a.id, a.reason, c) },
    "op.correct": { perm: "documents.correct", run: (s, a, c) => R.correctOperation(s, a.opId, a.draft, a.reason, c, { corrKey: a.corrKey || null }) },
    "op.reverseCorrection": { perm: "documents.correct", run: (s, a, c) => R.reverseCorrection(s, a.opId, a.corrNo, a.reason, c) },
    /** Przyjęcie MM (tryb dwuetapowy) — użytkownik magazynu docelowego; ilość faktyczna, tonaż, przyczyna różnicy. */
    "mm.receive": { perm: "mm.receive", run: (s, a, c) => R.receiveTransfer(s, str(a.opId), a.receipt || {}, c) },
    "op.cancel": { perm: "documents.cancel", run: (s, a, c) => R.cancelOperation(s, a.opId, c, a.reason, { ack: !!a.ack }) },
    /** Usunięcie dokumentu (soft delete z odwróceniem ruchów) — Administrator / Kierownik, powód wymagany. */
    "op.delete": { perm: "documents.delete", run: (s, a, c) => R.deleteOperation(s, str(a.opId), c, a.reason) },
    "print.register": { perm: "report.view", run: (s, a, c) => R.registerPrint(s, c, { kind: a.kind, title: a.title, range: a.range, wh: a.wh, format: a.format }) },
    /* ---- planer zakupów (plan dnia magazynu; wykonanie liczy się z operacji) ---- */
    "plan.set": { perm: "planner.edit", run: (s, a, c) => R.Planner.setPlan(s, a, c) },
    /* ---- powiadomienia ---- */
    "notify.prefs": { run: (s, a, c) => R.Notify.setMine(s, { events: a.events, email: a.email }, c) },
    "notify.allow": { perm: "notifications.manage", run: (s, a, c) => R.Notify.allow(s, a.userId, a.events, c) },
    "notice.read": { run: (s, a, c) => R.Notify.markRead(s, a.ids === "all" ? "all" : a.ids, c) },
    /* ---- inwentaryzacja ---- */
    "inv.open": { perm: "inv.open", run: (s, a, c) => R.Inventory.open(s, a.ym, c) },
    "inv.generate": { perm: "inv.count", run: (s, a, c) => R.Inventory.generate(s, a.ym, c) },
    "inv.setCount": { perm: "inv.count", run: (s, a, c) => R.Inventory.setCount(s, a.ym, a.productId, a.text, c) },
    "inv.close": { perm: "inv.close", run: (s, a, c) => R.Inventory.close(s, a.ym, c) },
    /** Kontrola przełomu miesiąca — idempotentna, uruchamiana przy starcie (każdy zalogowany). */
    "inv.autoClose": { run: (s, a, c) => ({ ok: true, done: R.Inventory.autoClose(s, Object.assign({}, c, { source: N_("Automat: początek kolejnego miesiąca") })) }) },
    /* ---- kartoteki ---- */
    "template.save": { perm: "op.create", run: (s, a, c) => R.Templates.save(s, a.rec || {}, c) },
    "template.remove": { perm: "op.create", run: (s, a, c) => R.Templates.remove(s, str(a.id), c) },
    "fleet.save": { perm: "fleet.edit", run: (s, a, c) => R.Fleet.save(s, a.kind, a.rec, c) },
    "fleet.remove": { perm: "fleet.edit", run: (s, a, c) => R.Fleet.remove(s, a.kind, a.id, c) },
    "master.save": { perm: "master.edit", run: (s, a, c) => R.Master.save(s, a.kind, a.rec, c) },
    "master.remove": { perm: "master.edit", run: (s, a, c) => R.Master.remove(s, a.kind, a.id, c) },
    /* ---- użytkownicy (profil; hasło — Auth hosta) ---- */
    "user.save": { perm: "users.manage", run: (s, a, c) => R.Users.save(s, a.rec, c) },
    "user.remove": { perm: "users.manage", run: (s, a, c) => R.Users.remove(s, a.id, c) },
    "me.prefs": { run: (s, a, c) => R.Users.setPrefs(s, { lang: a.lang, theme: a.theme }, c) },
    "me.warehouse": { run: (s, a, c) => R.Users.setMyWarehouse(s, a.whId, c) },
    /* ---- role, uprawnienia, konfiguracja (administrator) ---- */
    "roles.save": { perm: "roles.assign", run: (s, a, c) => R.Roles.save(s, str(a.role), a.perms, c) },
    "roles.reset": { perm: "roles.assign", run: (s, a, c) => R.Roles.reset(s, str(a.role), c) },
    "settings.save": { perm: "settings.edit", run: (s, a, c) => R.Settings.save(s, a.settings || {}, c) },
    /* ---- dane ---- */
    "data.backupLogged": { perm: "data.backup", run: (s, a, c) => { s.rev += 1; R.audit(s, c, { entity: "system", entityId: "backup", opNo: N_("kopia"), event: "backup", action: N_("Pobranie kopii zapasowej"), before: null, after: { rewizja: s.rev, format: str(a.format) || "json" } }); return { ok: true }; } },
    "data.import": { perm: "data.import", run: (s, a, c) => replaceState(s, a.state, c, "import", N_("Import kopii zapasowej")) },
    "data.reset": { perm: "data.import", run: (s, a, c) => replaceState(s, R.Seed.build(c.today), c, "reset", N_("Przywrócenie danych przykładowych")) },
    /** Start pracy „na czysto”: zostają kartoteki, konta i flota; znikają operacje, księga, okresy (tylko Administrator). */
    "data.clean": { perm: "users.manage", run: (s, a, c) => {
      if (str(a.confirm) !== "WYCZYŚĆ") return { ok: false, error: t("Wpisz WYCZYŚĆ, aby potwierdzić") };
      const n = R.clone(s);
      Object.assign(n, { operations: [], drafts: [], ledger: [], inventory: [], seq: {} });
      n.meta = Object.assign({}, n.meta, { lastMonthCheck: R.Dates.ym(c.today), cleanedAt: new Date().toISOString() });
      n.audit = s.audit.filter(x => x.event === "user" || x.event === "register");
      return replaceState(s, n, c, "clean", N_("Start pracy na czysto — usunięto operacje i dokumenty"));
    } }
  };

  /**
   * Widok danych dla użytkownika — izolacja magazynów (serwer wysyła do przeglądarki WYŁĄCZNIE ten widok).
   * Role globalne (ADMINISTRATOR, AUDYTOR) — całość; pozostałe — magazyn domyślny i przydzielone:
   * operacje (magazyn źródłowy lub docelowy MM), księga, inwentaryzacja, robocze, flota (magazyn lub wspólna),
   * dziennik zmian (wpisy magazynu lub własne), użytkownicy dzielący magazyn.
   */
  function project(state, user) {
    const u = user && R.byId(state.users, user.id);
    if (!u) return null;
    const acc = R.whAccess(u);
    // skrzynka powiadomień — tylko własne (także dla ról globalnych)
    const mine = (state.notices || []).filter(n => n.userId === u.id);
    // szablony operacji: wspólne (dostępne magazyny) i własne prywatne
    const templates = R.Templates.visible(state, u);
    if (acc === null) return Object.assign({}, state, { notices: R.can(u, "notifications.manage") ? state.notices || [] : mine, templates });
    const A = new Set(acc), inA = w => A.has(w);
    const out = Object.assign({}, state);
    out.operations = state.operations.filter(o => inA(o.whId) || (o.toWhId && inA(o.toWhId)));
    const opIds = new Set(out.operations.map(o => o.id));
    out.ledger = state.ledger.filter(l => inA(l.whId) || (l.opId && opIds.has(l.opId)));
    out.drafts = state.drafts.filter(d => d.userId === u.id || (d.status === "PENDING" && inA(d.whId)));
    out.inventory = state.inventory.filter(p => inA(p.whId));
    out.plans = (state.plans || []).filter(p => inA(p.whId));
    out.audit = state.audit.filter(a => a.userId === u.id || (a.whId && inA(a.whId) && a.entity !== "user" && a.entity !== "role" && a.entity !== "system"));
    const fl = state.fleet || {};
    out.fleet = Object.fromEntries(Object.entries(fl).map(([k, v]) => [k, Array.isArray(v) ? v.filter(x => !x.whId || inA(x.whId)) : v]));
    out.users = state.users.filter(x => x.id === u.id || R.whAccess(x) === null && x.role === "admin" || (x.warehouseIds || [x.whId]).concat(x.whId).some(inA))
      .map(x => x.id === u.id ? x : { id: x.id, name: x.name, firstName: x.firstName, lastName: x.lastName, login: x.login, email: x.email, role: x.role, whId: x.whId, warehouseIds: x.warehouseIds, status: x.status, active: x.active });
    out.notices = mine;
    out.templates = templates;
    out.projected = true;
    return out;
  }

  const Service = {
    COMMANDS,
    has(cmd) { return Object.prototype.hasOwnProperty.call(COMMANDS, cmd); },
    /** Czy komenda zmienia stan tylko przy sukcesie — zawsze tak; host zapisuje przy ok. */
    exec(state, cmd, args, ctx) {
      const c = COMMANDS[cmd];
      if (!c) return { ok: false, error: t("Nieznana komenda: {c}", { c: cmd }), code: "UNKNOWN" };
      if (!ctx || !ctx.user) return { ok: false, error: t("Brak zalogowanego użytkownika"), code: "AUTH" };
      R.applyRoles(state);
      const user = R.byId(state.users, ctx.user.id);
      if (!user || R.statusOf(user) !== "ACTIVE") return { ok: false, error: t("Twoje konto jest nieaktywne."), code: "AUTH" };
      if (c.perm && !R.can(user, c.perm)) return { ok: false, error: t("Nie masz uprawnień do wykonania tej operacji."), detail: c.perm, code: "FORBIDDEN" };
      const a = Object.assign({}, args || {});
      const full = Object.assign({}, ctx, { user, source: str(a.source).slice(0, 120) || ctx.source || N_("Aplikacja") });
      try {
        const notify = R.Notify && R.Notify.COMMANDS.includes(cmd);
        const before = notify ? R.Notify.beforeOf(state, cmd, a) : null;
        const res = c.run(state, a, full) || { ok: false, error: t("Operacja odrzucona") };
        // powiadomienia powstają w tej samej zmianie danych (zapis „wszystko albo nic”)
        if (notify && res.ok) { const list = R.Notify.afterCommand(state, cmd, a, res, full, before); if (list.length) res.notices = list.map(n => n.id); }
        return res;
      } catch (e) {
        return { ok: false, error: t("Błąd wewnętrzny — nic nie zapisano: {m}", { m: e.message }), code: "INTERNAL" };
      }
    },
    /**
     * Wykonanie „wszystko albo nic”: komenda pracuje na kopii; przy sukcesie zwraca nowy stan.
     * { res, state: nowy|null } — host utrwala `state` jedną transakcją.
     */
    run(state, cmd, args, ctx, preCloned) {
      // preCloned: gotowa kopia robocza (serwer odtwarza ją z zapisanego JSON — bez drugiej serializacji)
      const work = preCloned || R.clone(state), rev0 = work.rev;
      const res = this.exec(work, cmd, args, ctx);
      if (!res || !res.ok || work.rev === rev0) return { res, state: null };
      return { res, state: work };
    },
    replaceState,
    /** Rejestracja z ekranu logowania (bez sesji) — tylko gdy włączona w konfiguracji; konto czeka na administratora. */
    register(state, rec, today, meta, opts = {}, preCloned) {
      const work = preCloned || R.clone(state), rev0 = work.rev;
      const ctx = Object.assign({ today, source: N_("Rejestracja"), emailUnverified: !!opts.emailUnverified }, meta || {});
      const res = R.Users.register(work, rec || {}, ctx);
      // administratorzy dostają powiadomienie od razu (OFFLINE) albo po potwierdzeniu adresu (FIRMOWY — robi to serwer)
      if (res.ok && !opts.emailUnverified && R.Notify) res.notices = R.Notify.forRegistration(work, res.rec, Object.assign({}, ctx, { user: null })).map(n => n.id);
      return res.ok && work.rev !== rev0 ? { res, state: work } : { res, state: null };
    },
    /** Zmiana stanu wykonywana przez hosta poza sesją (aktywacja zaproszenia, wpis audytu). */
    apply(state, fn, preCloned) {
      const work = preCloned || R.clone(state), rev0 = work.rev;
      R.applyRoles(work);
      const res = fn(work) || { ok: false };
      return res.ok && work.rev !== rev0 ? { res, state: work } : { res, state: null };
    },
    project
  };

  R.Service = Service;
  root.RIW_Service = Service;
  if (typeof module !== "undefined" && module.exports) module.exports = Service;
})(typeof globalThis !== "undefined" ? globalThis : this);
