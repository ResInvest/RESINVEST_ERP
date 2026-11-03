/* =========================================================================
   ResInvest ERP 3.5 — Powiadomienia i Poczta (ekrany)
   * Powiadomienia (każdy użytkownik): skrzynka w programie (filtry, przeczytane, przejście
     do operacji), ustawienia „co chcę otrzymywać” (tylko zdarzenia dozwolone przez
     administratora) i kanał e-mail; dla administratora — zgody użytkowników (macierz).
   * Poczta (administrator, notifications.manage): kanał wysyłki, liczniki statusów, dziennik
     wysyłki z błędami i terminem następnej próby, „Ponów”, „Wyślij test do mnie”,
     „Wyślij kolejkę teraz”. W trybie OFFLINE e-maile nie są wysyłane — dziennik pokazuje
     powiadomienia przygotowane w programie.
   * Dzwonek w pasku górnym: liczba nieprzeczytanych i ostatnie powiadomienia.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, I18N, t, tp, N_, esc, $, $$, ic, Toast, Modal, Dropdown, Store, ServerBackend, App, Views, OpDetail } = UI;
  const { Dates } = R;
  const N = R.Notify;
  const th = s => esc(t(s));
  const SRC = N_("Powiadomienia");

  const mine = () => (Store.state.notices || []).filter(n => n.userId === Store.userId).slice().sort((a, b) => a.ts < b.ts ? 1 : -1);
  const unread = () => mine().filter(n => !n.read).length;
  const KIND_ICON = { registration: "user", create: "file", "mm-received": "swap", correction: "edit", cancel: "ban", delete: "trash", approval: "clock", approved: "check", rejected: "x" };
  const KIND_TONE = { registration: "info", correction: "warn", cancel: "err", delete: "err", approval: "warn", approved: "ok", rejected: "err", "mm-received": "info" };
  const evChips = n => (n.events || []).map(e => N.EVENTS[e] ? `<span class="chip">${th(N.EVENTS[e].label)}</span>` : "").join("");

  /** Otwarcie powiadomienia: oznaczenie jako przeczytane i przejście do operacji / kolejki zatwierdzania. */
  async function openNotice(id) {
    const n = (Store.state.notices || []).find(x => x.id === id);
    if (!n) return;
    if (!n.read) await Store.exec("notice.read", { ids: [id] }, SRC, { quiet: true });
    Dropdown.close();
    if (n.opId && R.byId(Store.state.operations, n.opId)) { App.render(); OpDetail.open(n.opId); }
    else if (n.kind === "approval" || n.kind === "rejected") App.go("operacje");
    else if (n.kind === "registration") App.go("uzytkownicy");
    else { App.render(); Toast.info(t("Operacja niedostępna"), t("Dokument nie jest już widoczny w Twoich magazynach.")); }
  }
  const noticeItem = (n, compact) => `<button class="nt-item ${n.read ? "" : "unread"}" type="button" data-notice="${esc(n.id)}">
      <span class="fi ${KIND_TONE[n.kind] || ""}">${ic(KIND_ICON[n.kind] || "bell", 14)}</span>
      <span class="nt-body"><b>${esc(I18N.tr(n.title))}</b>${compact ? "" : `<span class="nt-lines">${(n.lines || []).map(l => `<span>${esc(I18N.tr(l))}</span>`).join("")}</span>`}
        <small class="when">${esc(Dates.ts(n.ts))}${n.by ? " · " + esc(n.by === "System" ? t("System") : n.by) : ""}</small></span>
      ${n.read ? "" : `<span class="nt-dot" title="${th("nieprzeczytane")}"></span>`}</button>`;

  /** Dzwonek w pasku górnym (rysowany przez core.refreshChrome). */
  const Bell = {
    html() { const n = unread(); return `${ic("bell", 17)}${n ? `<span class="bell-cnt" id="bell-cnt">${n > 99 ? "99+" : n}</span>` : ""}`; },
    open(btn) {
      const list = mine().slice(0, 8);
      Dropdown.open(btn, `<div class="dd-label">${th("Powiadomienia")}${unread() ? ` · ${esc(tp("{n} nowe|{n} nowe|{n} nowych", unread()))}` : ""}</div>
        <div class="nt-dd" id="bell-list">${list.length ? list.map(n => noticeItem(n, true)).join("") : `<div class="dd-empty dim">${th("Brak powiadomień.")}</div>`}</div>
        <div class="dd-sep"></div>
        ${unread() ? `<button class="dd-item" type="button" data-readall><span class="ic">${ic("check", 16)}</span>${th("Oznacz wszystkie jako przeczytane")}</button>` : ""}
        <a class="dd-item" href="#/powiadomienia" data-go><span class="ic">${ic("bell", 16)}</span>${th("Wszystkie powiadomienia i ustawienia")}</a>`, el => {
        $$("[data-notice]", el).forEach(b => b.onclick = () => openNotice(b.dataset.notice));
        $$("[data-go]", el).forEach(a => a.onclick = () => Dropdown.close());
        const ra = $("[data-readall]", el);
        if (ra) ra.onclick = async () => { Dropdown.close(); await Store.exec("notice.read", { ids: "all" }, SRC, { quiet: true }); App.render(); };
      });
    }
  };

  /* ================================================================== */
  /* POWIADOMIENIA                                                        */
  /* ================================================================== */
  Views.powiadomienia = {
    html() {
      const f = App.tabs.notices || (App.tabs.notices = { show: "all", event: "", ym: "", tab: "inbox" });
      const u = App.user(), allowed = N.allowedFor(u), enabled = N.enabledFor(u);
      const list = mine().filter(n => (f.show !== "unread" || !n.read) && (!f.event || (n.events || []).includes(f.event)) && (!f.ym || n.ts.startsWith(f.ym)));
      const admin = App.can("notifications.manage");
      const tabs = `<div class="seg mb4" role="group" aria-label="${th("Widok")}" id="nt-tabs">${[["inbox", N_("Skrzynka")], ["settings", N_("Moje ustawienia")]].concat(admin ? [["allow", N_("Zgody użytkowników")]] : []).map(([k, l]) => `<button type="button" data-nttab="${k}" aria-pressed="${f.tab === k}">${th(l)}</button>`).join("")}</div>`;
      const inbox = `<div class="card" id="nt-inbox"><div class="toolbar">
          <div class="field"><label for="nt-show">${th("Pokaż")}</label><select class="ctrl" id="nt-show"><option value="all" ${f.show === "all" ? "selected" : ""}>${th("Wszystkie")}</option><option value="unread" ${f.show === "unread" ? "selected" : ""}>${th("Nieprzeczytane")}</option></select></div>
          <div class="field"><label for="nt-event">${th("Zdarzenie")}</label><select class="ctrl" id="nt-event"><option value="">${th("Wszystkie")}</option>${N.EVENT_IDS.map(e => `<option value="${e}" ${f.event === e ? "selected" : ""}>${th(N.EVENTS[e].label)}</option>`).join("")}</select></div>
          <div class="field"><label for="nt-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="nt-ym" value="${esc(f.ym)}"></div>
          <span class="spacer"></span>${unread() ? `<button class="btn" type="button" id="nt-readall">${ic("check", 15)} ${th("Oznacz wszystkie jako przeczytane")}</button>` : ""}</div>
        <div class="nt-list" id="nt-list">${list.length ? list.map(n => noticeItem(n, false)).join("") : `<div class="empty">${enabled.length ? th("Brak powiadomień dla wybranych filtrów.") : th("Nie masz włączonych powiadomień — wybierz zdarzenia w „Moje ustawienia”.")}</div>`}</div>
        <div class="toolbar" style="border:0"><span class="dim">${esc(tp("{n} powiadomienie|{n} powiadomienia|{n} powiadomień", list.length))} · ${esc(t("nieprzeczytane: {n}", { n: unread() }))}</span></div></div>`;
      const server = Store.mode === "server";
      const settings = `<div class="card" id="nt-settings"><div class="card-h"><h3>${th("Co chcę otrzymywać")}</h3><span class="sub">${th("zmiana zapisuje się od razu")}</span></div>
        <div class="card-b"><p class="help mb3">${th("Powiadomienie przychodzi o zmianach w magazynach, do których masz dostęp — nie o Twoich własnych zmianach. Zdarzenie niedostępne wymaga zgody administratora.")}</p>
          <div class="nt-events" id="nt-events">${N.EVENT_IDS.map(e => { const ok = allowed.includes(e); return `<label class="nt-ev ${ok ? "" : "off"}"><input type="checkbox" data-ev="${e}" ${enabled.includes(e) ? "checked" : ""} ${ok ? "" : "disabled"}>
            <span><b>${th(N.EVENTS[e].label)}</b><small>${th(N.EVENTS[e].desc)}</small>${ok ? "" : `<span class="badge">${th("wymaga zgody administratora")}</span>`}</span></label>`; }).join("")}</div>
          <div class="row-gap mt4"><button class="btn" type="button" id="nt-all" ${allowed.length ? "" : "disabled"}>${th("Włącz wszystkie dozwolone")}</button><button class="btn ghost" type="button" id="nt-none">${th("Wyłącz wszystkie")}</button></div>
          <h4 class="mini-h">${th("Kanał")}</h4>
          <label class="inline-opt"><input type="checkbox" id="nt-email" ${N.wantsEmail(u) ? "checked" : ""}> ${esc(t("Wysyłaj także e-mailem na adres {e}", { e: u.email || u.login }))}</label>
          <p class="help">${server ? th("Powiadomienia zawsze trafiają do skrzynki w programie; e-mail wysyła serwer (kolejka z ponawianiem — błąd poczty nie cofa operacji).") : th("Tryb OFFLINE: powiadomienia trafiają do skrzynki w programie; e-mail wysyła dopiero ResInvest ERP Serwer (tryb FIRMOWY).")}</p></div></div>`;
      return `<div class="page-head"><div class="titles"><h2>${th("Powiadomienia")}</h2><p>${th("Zmiany w Twoich magazynach: nowe dokumenty, przesunięcia MM, korekty, anulowania i usunięcia, operacje do zatwierdzenia. Kliknij powiadomienie — otworzy się operacja.")}</p></div></div>
        ${tabs}${f.tab === "settings" ? settings : f.tab === "allow" && admin ? this.allowHtml() : inbox}`;
    },
    /** Zgody administratora: użytkownicy × zdarzenia (administrator ma zawsze wszystkie). */
    allowHtml() {
      const users = Store.state.users.filter(u => R.statusOf(u) !== "DISABLED" && u.role !== "admin").sort((a, b) => a.name.localeCompare(b.name, "pl"));
      return `<div class="card" id="nt-allow"><div class="card-h"><h3>${th("Zgody na powiadomienia")}</h3><span class="sub">${th("zaznaczenie = użytkownik może włączyć zdarzenie u siebie; odebranie zgody wyłącza wysyłkę")}</span></div>
        <div class="tbl-wrap"><table class="tbl stack nt-matrix" id="nt-allow-table"><thead><tr><th>${th("Użytkownik")}</th>${N.EVENT_IDS.map(e => `<th class="c" title="${esc(t(N.EVENTS[e].desc))}">${th(N.EVENTS[e].label)}</th>`).join("")}<th></th></tr></thead><tbody>
        ${users.map(u => { const a = N.allowedFor(u), en = N.enabledFor(u); return `<tr data-allow-user="${esc(u.id)}"><td data-l="${th("Użytkownik")}"><b>${esc(u.name)}</b><div class="dim small">${esc(App.roleLabel(u.role))} · ${esc(u.login)}</div></td>
          ${N.EVENT_IDS.map(e => `<td data-l="${th(N.EVENTS[e].label)}" class="c"><input type="checkbox" data-allow="${e}" ${a.includes(e) ? "checked" : ""} aria-label="${esc(t("{u}: {e}", { u: u.name, e: t(N.EVENTS[e].label) }))}">${en.includes(e) ? `<small class="pos" title="${th("włączone przez użytkownika")}">●</small>` : ""}</td>`).join("")}
          <td class="r nowrap"><button class="btn sm" type="button" data-allow-all="${esc(u.id)}">${th("Wszystkie")}</button></td></tr>`; }).join("")}</tbody></table></div>
        <p class="help" style="padding:8px 16px">${th("● — zdarzenie włączone przez użytkownika. Administrator ma dostęp do wszystkich zdarzeń. Każda zmiana zgód jest zapisywana w dzienniku audytu.")}</p></div>`;
    },
    bind(page) {
      const f = App.tabs.notices;
      $$("[data-nttab]", page).forEach(b => b.onclick = () => { f.tab = b.dataset.nttab; App.render(); });
      const on = (id, k) => { const el = $(id, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
      on("#nt-show", "show"); on("#nt-event", "event"); on("#nt-ym", "ym");
      $$("[data-notice]", page).forEach(b => b.onclick = () => openNotice(b.dataset.notice));
      const ra = $("#nt-readall", page);
      if (ra) ra.onclick = async () => { const r = await Store.exec("notice.read", { ids: "all" }, SRC); if (r.ok) Toast.ok(t("Oznaczono jako przeczytane"), tp("{n} powiadomienie|{n} powiadomienia|{n} powiadomień", r.count || 0)); App.render(); };
      /* ustawienia własne */
      const save = async (events, email) => {
        const u = App.user();
        const r = await Store.exec("notify.prefs", { events, email: email === undefined ? N.wantsEmail(u) : email }, SRC);
        if (!r.ok) Toast.err(t("Nie zapisano ustawień"), r.error); else if (!r.unchanged) Toast.ok(t("Zapisano ustawienia powiadomień"));
        App.render();
      };
      const chosen = () => $$("[data-ev]", page).filter(x => x.checked).map(x => x.dataset.ev);
      $$("[data-ev]", page).forEach(x => x.onchange = () => save(chosen()));
      const all = $("#nt-all", page); if (all) all.onclick = () => save(N.allowedFor(App.user()));
      const none = $("#nt-none", page); if (none) none.onclick = () => save([]);
      const em = $("#nt-email", page); if (em) em.onchange = () => save(N.enabledFor(App.user()), em.checked);
      /* zgody administratora */
      const allow = async (userId, events) => {
        const r = await Store.exec("notify.allow", { userId, events }, N_("Powiadomienia — zgody"));
        if (!r.ok) Toast.err(t("Nie zapisano zgód"), r.error); else if (!r.unchanged) Toast.ok(t("Zapisano zgody: {u}", { u: (R.byId(Store.state.users, userId) || {}).name || "" }));
        App.render();
      };
      $$("[data-allow-user]", page).forEach(tr => {
        const id = tr.dataset.allowUser;
        $$("[data-allow]", tr).forEach(x => x.onchange = () => allow(id, $$("[data-allow]", tr).filter(c => c.checked).map(c => c.dataset.allow)));
      });
      $$("[data-allow-all]", page).forEach(b => b.onclick = () => allow(b.dataset.allowAll, N.EVENT_IDS.slice()));
    }
  };

  /* ================================================================== */
  /* POCZTA                                                              */
  /* ================================================================== */
  const STATUS = { QUEUED: N_("w kolejce"), SENDING: N_("wysyłanie"), SENT: N_("wysłana"), FAILED: N_("nieudana — ponowienie"), DEAD: N_("porzucona"), LOCAL: N_("OFFLINE — bez wysyłki") };
  const STATUS_TONE = { QUEUED: "info", SENDING: "info", SENT: "ok", FAILED: "warn", DEAD: "err", LOCAL: "" };
  const TEMPLATE = { notice: N_("Powiadomienie"), test: N_("Wiadomość testowa"), document: N_("Dokument / raport (PDF)"), invite: N_("Zaproszenie"), reset: N_("Reset hasła"), confirm: N_("Potwierdzenie adresu"), passwordChanged: N_("Zmiana hasła"), emailChanged: N_("Zmiana adresu e-mail"), deactivated: N_("Dezaktywacja konta") };
  const TRANSPORT = { resend: N_("Resend (API HTTPS)"), agentmail: N_("AgentMail (API HTTPS)"), smtp: N_("SMTP (TLS)"), file: N_("pliki .eml w katalogu danych") };
  const statusBadge = s => `<span class="badge ${STATUS_TONE[s] || ""}" data-mail-status="${esc(s)}">${th(STATUS[s] || s)}</span>`;

  Views.poczta = {
    data: null, loading: false,
    async load() {
      if (Store.mode !== "server") return;
      this.loading = true;
      const f = App.tabs.mail || {};
      const r = await ServerBackend.api("GET", `/api/mail/outbox?status=${encodeURIComponent(f.status || "")}`);
      this.loading = false;
      this.data = r && r.ok ? r : { ok: false, error: (r && r.error) || t("Nieprawidłowa odpowiedź serwera") };
      if (App.route === "poczta") App.render();
    },
    html() {
      const f = App.tabs.mail || (App.tabs.mail = { status: "" });
      const head = `<div class="page-head"><div class="titles"><h2>${th("Poczta")}</h2><p>${th("Dziennik wysyłki wiadomości e-mail: powiadomienia, zaproszenia, reset hasła. Nieudane wiadomości są ponawiane automatycznie (1 min, 5 min, 15 min, 1 h, 6 h), potem porzucane — można je ponowić ręcznie.")}</p></div>
        ${Store.mode === "server" ? `<div class="actions"><button class="btn" type="button" id="mail-refresh">${ic("refresh", 15)} ${th("Odśwież")}</button><button class="btn" type="button" id="mail-drain">${ic("mail", 15)} ${th("Wyślij kolejkę teraz")}</button><button class="btn primary" type="button" id="mail-test">${ic("mail", 15)} ${th("Wyślij test do mnie")}</button></div>` : ""}</div>`;
      if (Store.mode !== "server") return head + this.localHtml();
      if (!this.data) { if (!this.loading) this.load(); return head + `<div class="empty">${th("Wczytywanie…")}</div>`; }
      if (!this.data.ok) return head + `<div class="info-line err">${ic("alert", 15)}<span>${esc(this.data.error)}</span></div>`;
      const d = this.data, mi = d.mail || {}, st = d.stats || {};
      const cnt = k => st[k] || 0;
      const channel = `<div class="card mb4" id="mail-channel"><div class="card-h"><h3>${th("Kanał wysyłki")}</h3></div><div class="card-b">
          <dl class="money-list"><dt>${th("Transport")}</dt><dd><b id="mail-transport">${th(TRANSPORT[mi.transport] || mi.transport || "—")}</b></dd><dt>${th("Nadawca")}</dt><dd>${esc(mi.from || "—")}</dd><dt>${th("Skonfigurowano")}</dt><dd>${mi.configured ? th("tak") : `<span class="neg">${th("nie — brak klucza API / hasła SMTP")}</span>`}</dd></dl>
          ${mi.transport === "file" ? `<div class="info-line warn mt2">${ic("alert", 15)}<span>${esc(t("Wiadomości NIE są wysyłane — zapisywane jako pliki .eml w {d}. Ustaw EMAIL_TRANSPORT i klucz w server.env.", { d: mi.outDir || "mail-outbox" }))}</span></div>` : ""}</div></div>`;
      const tiles = `<div class="grid g4 mb4" id="mail-stats">${["QUEUED", "SENT", "FAILED", "DEAD"].map(k => `<div class="kpi"><div class="k-t">${th(STATUS[k])}</div><div class="k-v">${cnt(k)}</div></div>`).join("")}</div>`;
      const rows = (d.rows || []).map(m => `<tr data-mail-id="${m.id}"><td data-l="${th("Utworzono")}" class="nowrap">${esc(Dates.ts(m.ts))}</td><td data-l="${th("Rodzaj")}">${th(TEMPLATE[m.template] || m.template)}</td><td data-l="${th("Do")}">${esc(m.to)}</td><td data-l="${th("Temat")}">${esc(m.subject || "—")}</td>
        <td data-l="${th("Status")}">${statusBadge(m.status)}</td><td data-l="${th("Próby")}" class="r">${m.attempts || 0}</td><td data-l="${th("Ostatni błąd")}" class="small">${esc(m.error || "")}</td><td data-l="${th("Następna próba")}" class="nowrap">${m.status === "FAILED" && m.nextAt ? esc(Dates.ts(m.nextAt)) : "—"}</td>
        <td class="r">${(m.status === "FAILED" || m.status === "DEAD") && m.retryable ? `<button class="btn sm" type="button" data-retry="${m.id}">${ic("refresh", 13)} ${th("Ponów")}</button>` : ""}</td></tr>`).join("");
      return head + channel + tiles + `<div class="card" id="mail-log"><div class="toolbar">
          <div class="field"><label for="mail-status">${th("Status")}</label><select class="ctrl" id="mail-status"><option value="">${th("Wszystkie")}</option>${["QUEUED", "SENT", "FAILED", "DEAD"].map(s => `<option value="${s}" ${f.status === s ? "selected" : ""}>${th(STATUS[s])}</option>`).join("")}</select></div></div>
        ${rows ? `<div class="tbl-wrap"><table class="tbl stack" id="mail-table"><thead><tr><th>${th("Utworzono")}</th><th>${th("Rodzaj")}</th><th>${th("Do")}</th><th>${th("Temat")}</th><th>${th("Status")}</th><th class="r">${th("Próby")}</th><th>${th("Ostatni błąd")}</th><th>${th("Następna próba")}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${th("Brak wiadomości.")}</div>`}
        <p class="help" style="padding:8px 16px">${th("Treść wysłanej wiadomości jest usuwana z bazy. Wiadomości z jednorazowym linkiem (zaproszenie, reset hasła) nie są przechowywane i nie można ich ponowić — wyślij nowe z modułu Użytkownicy.")}</p></div>`;
    },
    /** Tryb OFFLINE: powiadomienia przygotowane w programie (bez wysyłki e-mail). */
    localHtml() {
      const all = (Store.state.notices || []).slice().sort((a, b) => a.ts < b.ts ? 1 : -1);
      const shown = all.slice(0, 200);
      const user = id => (R.byId(Store.state.users, id) || {});
      return `<div class="info-line mb4" id="mail-offline">${ic("alert", 15)}<span>${th("Tryb OFFLINE (dane w tej przeglądarce): wiadomości e-mail nie są wysyłane. Powiadomienia trafiają do skrzynek użytkowników w programie. Wysyłkę e-mail (Resend / SMTP) wykonuje ResInvest ERP Serwer — tryb FIRMOWY.")}</span></div>
        <div class="grid g4 mb4" id="mail-stats"><div class="kpi"><div class="k-t">${th("Powiadomienia w programie")}</div><div class="k-v">${all.length}</div></div><div class="kpi"><div class="k-t">${th("Nieprzeczytane")}</div><div class="k-v">${all.filter(n => !n.read).length}</div></div><div class="kpi"><div class="k-t">${th("Z prośbą o e-mail")}</div><div class="k-v">${all.filter(n => n.email).length}</div></div><div class="kpi"><div class="k-t">${th("Odbiorcy")}</div><div class="k-v">${new Set(all.map(n => n.userId)).size}</div></div></div>
        <div class="card" id="mail-log">${shown.length ? `<div class="tbl-wrap"><table class="tbl stack" id="mail-table"><thead><tr><th>${th("Utworzono")}</th><th>${th("Do")}</th><th>${th("Temat")}</th><th>${th("Zdarzenie")}</th><th>${th("Przeczytane")}</th><th>${th("E-mail")}</th></tr></thead><tbody>
          ${shown.map(n => `<tr class="${n.opId ? "clickable" : ""}" ${n.opId ? `data-opid="${esc(n.opId)}"` : ""}><td data-l="${th("Utworzono")}" class="nowrap">${esc(Dates.ts(n.ts))}</td><td data-l="${th("Do")}">${esc(user(n.userId).name || n.userId)}<div class="dim small">${esc(user(n.userId).email || "")}</div></td><td data-l="${th("Temat")}">${esc(I18N.tr(n.title))}</td><td data-l="${th("Zdarzenie")}">${evChips(n)}</td><td data-l="${th("Przeczytane")}">${n.read ? th("tak") : `<b>${th("nie")}</b>`}</td><td data-l="${th("E-mail")}">${statusBadge("LOCAL")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak powiadomień.")}</div>`}</div>`;
    },
    bind(page) {
      const f = App.tabs.mail;
      UI.bindOps(page);
      const st = $("#mail-status", page); if (st) st.onchange = e => { f.status = e.target.value; this.data = null; App.render(); };
      const rf = $("#mail-refresh", page); if (rf) rf.onclick = () => { this.data = null; App.render(); };
      const act = async (path, body, okTitle) => {
        const r = await ServerBackend.api("POST", path, body || {});
        if (r && r.ok) Toast.ok(okTitle, r.message || ""); else Toast.err(t("Poczta"), (r && r.error) || t("Nieprawidłowa odpowiedź serwera"));
        this.data = null; App.render();
      };
      const dr = $("#mail-drain", page); if (dr) dr.onclick = () => act("/api/mail/drain", {}, t("Kolejka przetworzona"));
      const ts = $("#mail-test", page); if (ts) ts.onclick = () => act("/api/mail/test", {}, t("Wysłano wiadomość testową"));
      $$("[data-retry]", page).forEach(b => b.onclick = () => act("/api/mail/retry", { id: Number(b.dataset.retry) }, t("Wiadomość ponowiona")));
    }
  };

  Object.assign(UI, { Bell, openNotice, unreadNotices: unread });
})(typeof globalThis !== "undefined" ? globalThis : this);
