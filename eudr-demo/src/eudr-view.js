/* eudr-view.js */
/* =========================================================================
   ResInvest ERP 3.12 (demo EUDR) — zakładka „EUDR — wylesianie”
   Przegląd · Rejestr transakcji · Dostawcy · Działki · Raporty · Ustawienia · Plan wdrożenia
   * odczyt: uprawnienie report.view (izolacja magazynów jak w całym programie),
   * numery referencyjne i dane transakcji: eudr.edit (magazynier, kierownik),
   * dostawcy, działki, ustawienia: eudr.manage (kierownik, administrator).
   Wszystkie zmiany idą komendami usługi (Store.exec) — zapis „wszystko albo nic” z audytem.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, tp, esc, $, $$, ic, Store, App, Views, Modal, Toast, toCSV, csvNum, download } = UI;
  const { fmtQ, Dates } = R;
  const E = R.EUDR;
  const th = s => esc(t(s));
  const tr = x => R.I18N.tr(x);
  const unitL = u => u === "m3" ? "m³" : u;
  const q = (v, d = 1) => v === null || v === undefined ? "—" : fmtQ(v, d);
  const SRC = "EUDR — wylesianie";

  const TABS = [["przeglad", "Przegląd", "home"], ["rejestr", "Rejestr transakcji", "list"], ["dostawcy", "Dostawcy", "users"], ["dzialki", "Działki", "pin"], ["raporty", "Raporty i eksport", "chart"], ["ustawienia", "Ustawienia", "settings"], ["plan", "Plan wdrożenia", "clipboard"]];
  function F() {
    const f = App.tabs.eudr || (App.tabs.eudr = { tab: "przeglad", mode: "month", ym: Dates.ym(App.today()), year: App.today().slice(0, 4), side: "", status: "", scope: "all" });
    return f;
  }
  function range(f) {
    if (f.mode === "year") return { from: `${f.year}-01-01`, to: `${f.year}-12-31`, label: t("rok {y}", { y: f.year }) };
    if (f.mode === "all") return { from: "", to: "", label: t("cały okres") };
    return { from: Dates.monthStart(f.ym), to: Dates.monthEnd(f.ym), label: Dates.label(f.ym) };
  }
  function whIds(f) {
    if (f.scope === "wh") return [App.wh().id];
    const acc = R.whAccess(App.user());
    return acc === null ? null : acc;
  }
  const badge = s => `<span class="badge ${E.STATUS[s].cls}">${th(E.STATUS[s].label)}</span>`;
  const sideBadge = r => r.side === "IN" ? `<span class="badge info">${th("Zakup")}</span>` : `<span class="badge gold">${th("Sprzedaż")}</span>`;
  const roleShort = r => t((E.OUR_ROLES[r] || {}).short || r);
  const exec = async (cmd, args, ok) => {
    const res = await Store.exec(cmd, args, SRC);
    if (res && res.ok) { Toast.ok(ok, (res.warnings || []).join(" ")); App.render(); }
    else Toast.err(t("Nie zapisano"), (res && (res.errors || [res.error]).join(" · ")) || "");
    return res;
  };

  /* ---------------------------------------------------------------- */
  /* Przegląd                                                          */
  /* ---------------------------------------------------------------- */
  function overview(f) {
    const S = Store.state, D = E.data(S), rg = range(f), rep = E.report(S, { from: rg.from, to: rg.to, whIds: whIds(f) });
    const days = Math.round((Date.parse(rep.applyFrom + "T00:00:00Z") - Date.parse(App.today() + "T00:00:00Z")) / 864e5);
    const pct = (a, b) => b ? Math.round(a / b * 100) : 100;
    const inOk = rep.IN.OK.count + rep.IN.UWAGI.count, outOk = rep.OUT.OK.count + rep.OUT.UWAGI.count;
    const kpi = (id, icon, title, value, sub, tone) => `<div class="kpi2" id="${id}"><div class="k-h"><span class="k-i ${tone || ""}">${ic(icon, 17)}</span><span class="k-t">${esc(title)}</span></div><div class="k-v">${value}</div><div class="k-s"><span>${sub}</span></div></div>`;
    const hero = `<section class="eudr-hero"><div class="eudr-hero-t"><span class="eudr-tag">${ic("leaf", 14)} EUDR · (UE) 2023/1115 · zm. (UE) 2025/2650</span>
        <h2>${days > 0 ? esc(t("Stosowanie od {d} — zostało {n} dni", { d: Dates.pl(rep.applyFrom), n: days })) : esc(t("EUDR stosuje się od {d}", { d: Dates.pl(rep.applyFrom) }))}</h2>
        <p>${th("Drewno opałowe, zrębka i trociny (dział 44, poz. 4401 i 4403) są objęte rozporządzeniem. Od tej daty każdy zakup musi mieć numer referencyjny oświadczenia o należytej staranności (DDS) albo identyfikator deklaracji uproszczonej, a sprzedaż — wskazanie pochodzenia.")}</p></div>
      <div class="eudr-ring" style="--p:${rep.readyPct}"><b>${rep.readyPct}%</b><span>${th("gotowość")}</span></div></section>`;
    const kpis = `<div class="kpi2-grid mt4">${[
      kpi("eu-k-in", "inbox", t("Zakupy z kompletnymi danymi"), `${inOk}<u>/ ${rep.IN.count}</u>`, esc(t("{p}% · braki: {n}", { p: pct(inOk, rep.IN.count), n: rep.IN.BRAKI.count })), rep.IN.BRAKI.count ? "warn" : ""),
      kpi("eu-k-out", "out", t("Sprzedaż z numerami dla odbiorcy"), `${outOk}<u>/ ${rep.OUT.count}</u>`, esc(t("{p}% · braki: {n}", { p: pct(outOk, rep.OUT.count), n: rep.OUT.BRAKI.count })), rep.OUT.BRAKI.count ? "warn" : "info"),
      kpi("eu-k-sup", "users", t("Dostawcy zweryfikowani"), `${rep.suppliers.verified}<u>/ ${rep.suppliers.total}</u>`, th("profil EUDR: rola, kraj, identyfikator"), "gold"),
      kpi("eu-k-geo", "pin", t("Działki w ewidencji"), String(rep.plots), th("geolokalizacja: punkt albo wielokąt"), "info")
    ].join("")}</div>`;
    const todo = [];
    if (!D.settings.registered) todo.push({ cls: "warn", tab: "ustawienia", title: t("Rejestracja w systemie informacyjnym UE (TRACES)"), text: t("Załóż konto firmy i wpisz identyfikator operatora (EORI) w ustawieniach EUDR.") });
    const unv = rep.suppliers.total - rep.suppliers.verified;
    if (unv) todo.push({ cls: "warn", tab: "dostawcy", title: tp("{n} dostawca bez weryfikacji|{n} dostawców bez weryfikacji|{n} dostawców bez weryfikacji", unv), text: t("Ustal rolę dostawcy w łańcuchu i sposób przekazywania numerów DDS.") });
    for (const r of rep.missing.slice(0, 6)) todo.push({ cls: "err", op: r.opId, side: r.side, title: `${r.no} · ${r.partnerName}`, text: r.checks.filter(c => c.lvl === "err").map(c => tr(c.msg)).join(" · ") });
    if (rep.missing.length > 6) todo.push({ cls: "", tab: "rejestr", title: t("…i {n} kolejnych braków", { n: rep.missing.length - 6 }), text: t("Pełna lista w rejestrze transakcji (filtr: Braki).") });
    if (!todo.length) todo.push({ cls: "ok", tab: "rejestr", title: t("Brak zaległości w okresie"), text: t("Wszystkie transakcje objęte EUDR mają wymagane dane.") });
    const icon = c => c === "ok" ? "check" : c === "err" ? "alert" : "bell";
    const todoCard = `<div class="card" id="eudr-todo"><div class="card-h"><h3>${th("Do załatwienia")}</h3><span class="sub">${esc(rg.label)}</span></div><div class="card-b"><div class="alerts">${todo.map(a => `<a class="alert-item ${a.cls}" href="#/eudr" ${a.op ? `data-eu-open="${esc(a.op)}" data-eu-side="${esc(a.side)}"` : `data-eu-tab="${esc(a.tab)}"`}><span class="ai">${ic(icon(a.cls), 16)}</span><span><b>${esc(a.title)}</b>${esc(a.text)}</span></a>`).join("")}</div></div></div>`;
    const sc = (k, title, who, what) => `<div class="eudr-sc"><span class="eudr-sc-k">${k}</span><div><b>${th(title)}</b><small>${th(who)}</small><p>${th(what)}</p></div></div>`;
    const scen = `<div class="card" id="eudr-scen"><div class="card-h"><h3>${th("Co EUDR oznacza dla ResInvest Commodities")}</h3></div><div class="card-b eudr-scs">
        ${sc("A", "Zakup drewna z nadleśnictwa (Lasy Państwowe)", "nadleśnictwo = operator (składa DDS) · ResInvest = pierwszy podmiot dalszy / handlowiec", "Odbierz numer referencyjny DDS (i numer weryfikacyjny) z dokumentu sprzedaży drewna i wpisz go przy PZ. Przechowuj 5 lat.")}
        ${sc("B", "Zakup zrębki lub drewna od firmy", "firma = podmiot dalszy albo handlowiec", "Ustal, czy dostawca jest pierwszy w łańcuchu. Zalecane: numery DDS z łańcucha — odbiorcy energetyczni będą o nie pytać.")}
        ${sc("C", "Zakup od prywatnego właściciela lasu", "mikro / mały producent pierwotny — jednorazowa deklaracja uproszczona", "Wpisz identyfikator deklaracji w profilu dostawcy — obejmie wszystkie jego dostawy.")}
        ${sc("D", "Wycinka inwestycyjna, zakup na pniu, import spoza UE", "ResInvest = operator", "Własne oświadczenie DDS w systemie UE przed wprowadzeniem do obrotu: gatunek, ilość, geolokalizacja działek, okres pozyskania, dokumenty legalności, ocena ryzyka.")}
        ${sc("E", "Sprzedaż zrębki do elektrociepłowni", "ResInvest = sprzedawca w łańcuchu", "Przekaż odbiorcy numery referencyjne źródeł (z transakcji albo z puli magazynu) — program wskazuje je przy każdej WZ.")}
      </div></div>`;
    return `${hero}${kpis}<div class="dash-row">${todoCard}${scen}</div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Rejestr transakcji                                                */
  /* ---------------------------------------------------------------- */
  function periodBar(f, extra) {
    return `<div class="toolbar eudr-bar"><div class="field"><label for="eu-mode">${th("Zakres")}</label><select class="ctrl" id="eu-mode">${[["month", "Miesiąc"], ["year", "Rok"], ["all", "Cały okres"]].map(([k, l]) => `<option value="${k}" ${f.mode === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div>
      ${f.mode === "month" ? `<div class="field"><label for="eu-ym">${th("Miesiąc")}</label><input class="ctrl" type="month" id="eu-ym" value="${esc(f.ym)}"></div>` : ""}
      ${f.mode === "year" ? `<div class="field"><label for="eu-year">${th("Rok")}</label><input class="ctrl" type="number" min="2024" max="2100" id="eu-year" value="${esc(f.year)}"></div>` : ""}
      <div class="field"><label for="eu-scope">${th("Magazyny")}</label><select class="ctrl" id="eu-scope"><option value="all" ${f.scope === "all" ? "selected" : ""}>${th("Wszystkie dostępne")}</option><option value="wh" ${f.scope === "wh" ? "selected" : ""}>${esc(App.wh().name)}</option></select></div>${extra || ""}</div>`;
  }
  function registerTab(f) {
    const rg = range(f), rows = E.register(Store.state, { from: rg.from, to: rg.to, whIds: whIds(f), side: f.side || undefined, status: f.status || undefined });
    const extra = `<div class="field"><label for="eu-side">${th("Kierunek")}</label><select class="ctrl" id="eu-side"><option value="">${th("Zakup i sprzedaż")}</option><option value="IN" ${f.side === "IN" ? "selected" : ""}>${th("Zakup / surowiec")}</option><option value="OUT" ${f.side === "OUT" ? "selected" : ""}>${th("Sprzedaż")}</option></select></div>
      <div class="field"><label for="eu-status">${th("Status")}</label><select class="ctrl" id="eu-status"><option value="">${th("Wszystkie")}</option>${Object.entries(E.STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${th(v.label)}</option>`).join("")}</select></div>
      <span class="spacer"></span><button class="btn" type="button" id="eu-csv">${ic("dl", 14)} CSV</button>${App.can("eudr.edit") ? `<button class="btn" type="button" id="eu-import">${ic("up", 14)} ${th("Import numerów")}</button>` : ""}`;
    const refs = r => r.refs.length ? `<span class="mono small">${esc(r.refs[0].ref)}</span>${r.refs.length > 1 ? ` <span class="badge">+${r.refs.length - 1}</span>` : ""}` : `<span class="dim">—</span>`;
    const body = rows.length ? `<div class="tbl-wrap"><table class="tbl stack" id="eu-reg"><thead><tr><th>${th("Data")}</th><th>${th("Nr dokumentu")}</th><th>${th("Kierunek")}</th><th>${th("Kontrahent")}</th><th>${th("Towar / kod CN")}</th><th class="r">${th("Ilość")}</th><th class="r">MP · m³ · t</th><th>${th("Rola ResInvest")}</th><th>${th("Status")}</th><th>${th("Numery referencyjne")}</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="clickable${r.status === "BRAKI" ? " eu-miss" : ""}" data-eu-open="${esc(r.opId)}" data-eu-side="${r.side}"><td data-l="${th("Data")}" class="nowrap">${esc(Dates.pl(r.date))}${r.beforeApply ? `<div class="dim small">${th("przed 30.12.2026")}</div>` : ""}</td><td data-l="${th("Nr dokumentu")}" class="mono nowrap">${esc(r.no)}</td><td data-l="${th("Kierunek")}">${sideBadge(r)}</td>
        <td data-l="${th("Kontrahent")}">${esc(r.partnerName || "—")}<div class="dim small">${esc(r.whName)}</div></td><td data-l="${th("Towar / kod CN")}">${esc(r.productName)}<div class="dim small mono">${esc(r.cn || "—")}</div></td>
        <td data-l="${th("Ilość")}" class="r">${esc(fmtQ(r.qty))} ${esc(unitL(r.unit))}</td><td data-l="MP · m³ · t" class="r small">${esc(q(r.mp, 0))} · ${esc(q(r.m3, 1))} · ${esc(q(r.t, 1))}</td>
        <td data-l="${th("Rola ResInvest")}" class="small">${esc(roleShort(r.role))}</td><td data-l="${th("Status")}">${badge(r.status)}</td><td data-l="${th("Numery referencyjne")}">${refs(r)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak transakcji w wybranym zakresie.")}</div>`;
    return `<div class="card">${periodBar(f, extra)}<div class="card-b eu-reg-sum">${Object.entries(E.STATUS).map(([k, v]) => `<span class="chip">${badge(k)} ${rows.filter(r => r.status === k).length}</span>`).join("")}<span class="dim small">${esc(range(f).label)} · ${esc(tp("{n} pozycja|{n} pozycje|{n} pozycji", rows.length))}</span></div>${body}</div>`;
  }

  /** Edytor numerów referencyjnych (wiersze: numer, numer weryfikacyjny, rodzaj). */
  const refRow = (r = {}) => `<div class="eu-ref"><input class="ctrl mono" data-k="ref" placeholder="${th("np. 26PLABCD123456")}" value="${esc(r.ref || "")}" aria-label="${th("Numer referencyjny")}"><input class="ctrl mono" data-k="ver" placeholder="${th("nr weryfikacyjny")}" value="${esc(r.ver || "")}" aria-label="${th("Numer weryfikacyjny")}">
    <select class="ctrl" data-k="kind" aria-label="${th("Rodzaj numeru")}">${Object.entries(E.REF_KINDS).map(([k, l]) => `<option value="${k}" ${r.kind === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select><button class="icon-btn" type="button" data-ref-del aria-label="${th("Usuń numer")}">${ic("trash", 15)}</button></div>`;
  const readRefs = scope => $$(".eu-ref", scope).map(x => ({ ref: $('[data-k="ref"]', x).value, ver: $('[data-k="ver"]', x).value, kind: $('[data-k="kind"]', x).value }));
  function bindRefs(scope) {
    const host = $("#eu-refs", scope); if (!host) return;
    const wire = () => $$("[data-ref-del]", host).forEach(b => b.onclick = () => { b.closest(".eu-ref").remove(); });
    $("#eu-ref-add", scope).onclick = () => { host.insertAdjacentHTML("beforeend", refRow()); wire(); $$('.eu-ref [data-k="ref"]', host).pop().focus(); };
    wire();
  }
  const checksHtml = ev => ev.checks.length ? `<ul class="eu-checks">${ev.checks.map(c => `<li class="${c.lvl}">${ic(c.lvl === "err" ? "alert" : c.lvl === "warn" ? "bell" : "check", 14)} ${esc(tr(c.msg))}</li>`).join("")}</ul>` : `<div class="info-line">${ic("check", 15)}<span>${th("Dane kompletne.")}</span></div>`;

  function openRecord(opId, side) {
    const S = Store.state, op = R.byId(S.operations, opId);
    if (!op) return;
    const ev = side === "OUT" ? E.evaluateSale(S, op) : E.evaluateInput(S, op);
    if (!ev) return;
    const rec = E.record(S, opId) || {}, D = E.data(S), can = App.can("eudr.edit");
    const dis = can ? "" : "disabled";
    const head = `<div class="eu-head">${badge(ev.status)} <span class="chip">${esc(roleShort(ev.role))}</span> <span class="dim">${esc(t((E.OUR_ROLES[ev.role] || {}).label || ""))}</span></div>
      <dl class="eu-dl"><dt>${th("Kontrahent")}</dt><dd>${esc(ev.partnerName || "—")}</dd><dt>${th("Towar")}</dt><dd>${esc(ev.productName)} · ${esc(fmtQ(ev.qty))} ${esc(unitL(ev.unit))} (${esc(q(ev.mp, 0))} MP · ${esc(q(ev.m3, 1))} m³ · ${esc(q(ev.t, 1))} t)</dd><dt>${th("Kod CN")}</dt><dd class="mono">${esc(ev.cn || "—")}</dd></dl>${checksHtml(ev)}`;
    let body;
    if (side === "OUT") {
      const T = ev.trace, method = { OP: t("z tej samej transakcji (zakup / produkcja w lesie)"), POOL: t("pula magazynu — przyjęcia z ostatnich {d} dni", { d: T.info.days || D.settings.lookbackDays }), MANUAL: t("wskazane ręcznie") }[T.method];
      body = `${head}<h4 class="mini-h">${th("Numery do przekazania odbiorcy")}</h4><p class="help">${esc(t("Sposób ustalenia: {m}.", { m: method }))}</p>
        ${ev.refs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${th("Numer referencyjny")}</th><th>${th("Nr weryfikacyjny")}</th><th>${th("Źródło")}</th></tr></thead><tbody>${ev.refs.map(r => `<tr><td class="mono">${esc(r.ref)}</td><td class="mono">${esc(r.ver || "—")}</td><td class="small">${esc([r.fromNo, r.fromPartner, r.from].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody></table></div>
          <div class="row-gap mt2"><button class="btn sm" type="button" id="eu-copy">${ic("clipboard", 13)} ${th("Kopiuj numery")}</button><button class="btn sm" type="button" id="eu-txt">${ic("dl", 13)} ${th("Informacja EUDR do WZ (TXT)")}</button></div>` : `<div class="empty">${th("Brak numerów do przekazania.")}</div>`}
        ${T.sources.length ? `<h4 class="mini-h">${th("Transakcje źródłowe")}</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${th("Data")}</th><th>${th("Nr")}</th><th>${th("Dostawca")}</th><th>${th("Status")}</th></tr></thead><tbody>${T.sources.map(s => `<tr class="clickable" data-eu-src="${esc(s.opId)}"><td>${esc(Dates.pl(s.date))}</td><td class="mono">${esc(s.no)}</td><td>${esc(s.partnerName)}</td><td>${badge(s.status)}</td></tr>`).join("")}</tbody></table></div>` : ""}
        <h4 class="mini-h">${th("Wskazanie ręczne")}</h4><label class="inline-opt"><input type="checkbox" id="eu-manual" ${rec.traceMode === "manual" ? "checked" : ""} ${dis}> ${th("Użyj wyłącznie numerów wpisanych poniżej (np. odbiorca wymaga numerów z konkretnych dostaw)")}</label>
        <div id="eu-refs" class="mt2">${(rec.refs || []).map(refRow).join("")}</div>${can ? `<button class="btn sm ghost mt2" type="button" id="eu-ref-add">${ic("plus", 13)} ${th("Dodaj numer")}</button>` : ""}`;
    } else {
      const op_ = ev.role === "OPERATOR", prof = ev.partnerId ? E.supplierProfile(S, ev.partnerId) : null;
      const plots = D.plots.map(p => `<label class="eu-plot"><input type="checkbox" value="${esc(p.id)}" ${(rec.plotIds || []).includes(p.id) ? "checked" : ""} ${dis}> <span><b>${esc([p.ndl && `Nadl. ${p.ndl}`, p.lesnictwo && `leśn. ${p.lesnictwo}`].filter(Boolean).join(" · ") || p.address)}</b><small>${esc([p.address, p.areaHa ? `${fmtQ(p.areaHa)} ha` : "", p.polygon ? t("wielokąt") : p.lat != null ? `${p.lat}, ${p.lon}` : ""].filter(Boolean).join(" · "))}</small></span></label>`).join("") || `<div class="dim small">${th("Brak działek — dodaj je w zakładce Działki.")}</div>`;
      body = `${head}${prof ? `<div class="info-line mt2">${ic("users", 15)}<span>${esc(t("Dostawca: {r} · kraj {c} · ryzyko {k}", { r: t(E.SUPPLIER_ROLES[prof.role].short), c: prof.country, k: prof.risk === "LOW" ? t("niskie") : t("standardowe") }))}${prof.declarationId ? esc(" · " + t("deklaracja {d}", { d: prof.declarationId })) : ""}${prof.verifiedAt ? "" : " · " + th("profil niezweryfikowany")}</span></div>` : ""}
        <h4 class="mini-h">${th(op_ ? "Numery referencyjne z łańcucha (opcjonalnie)" : "Numery referencyjne DDS od dostawcy")}</h4><div id="eu-refs">${(rec.refs || []).map(refRow).join("") || (can ? refRow() : "")}</div>${can ? `<button class="btn sm ghost mt2" type="button" id="eu-ref-add">${ic("plus", 13)} ${th("Dodaj numer")}</button>` : ""}
        ${op_ ? `<h4 class="mini-h">${th("Własne oświadczenie DDS (ResInvest jako operator)")}</h4><div class="form-grid eu-grid"><div class="field"><label for="eu-dds">${th("Numer referencyjny DDS")}</label><input class="ctrl mono" id="eu-dds" value="${esc((rec.ownDds || {}).ref || "")}" ${dis}></div>
            <div class="field"><label for="eu-ddsv">${th("Numer weryfikacyjny")}</label><input class="ctrl mono" id="eu-ddsv" value="${esc((rec.ownDds || {}).ver || "")}" ${dis}></div>
            <div class="field"><label for="eu-ddss">${th("Status")}</label><select class="ctrl" id="eu-ddss" ${dis}><option value="DRAFT">${th("Projekt")}</option><option value="SUBMITTED" ${(rec.ownDds || {}).status === "SUBMITTED" ? "selected" : ""}>${th("Złożone w systemie UE")}</option></select></div></div>` : ""}
        <h4 class="mini-h">${th("Pochodzenie")}</h4><div class="form-grid eu-grid">
          <div class="field"><label for="eu-sp">${th("Gatunek drewna")}${op_ ? " *" : ""}</label><input class="ctrl" id="eu-sp" list="eu-species" value="${esc(rec.species || "")}" ${dis}><datalist id="eu-species">${E.SPECIES.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div>
          <div class="field"><label for="eu-hf">${th("Pozyskanie od")}${op_ ? " *" : ""}</label><input class="ctrl" type="date" id="eu-hf" value="${esc(rec.harvestFrom || "")}" max="${esc(op.date)}" ${dis}></div>
          <div class="field"><label for="eu-ht">${th("Pozyskanie do")}${op_ ? " *" : ""}</label><input class="ctrl" type="date" id="eu-ht" value="${esc(rec.harvestTo || "")}" max="${esc(op.date)}" ${dis}></div>
          <div class="field"><label for="eu-cn">${th("Kod CN (zmiana)")}</label><input class="ctrl mono" id="eu-cn" value="${esc(rec.cn || "")}" placeholder="${esc(ev.cn)}" ${dis}></div></div>
        <div class="field mt2"><span class="lbl">${th("Działki (geolokalizacja)")}${op_ ? " *" : ""}</span><div class="eu-plots" id="eu-plots">${plots}</div></div>
        ${op_ ? `<div class="field mt2"><label for="eu-docs">${th("Dokumenty legalności pozyskania (jeden w wierszu)")} *</label><textarea class="ctrl" id="eu-docs" rows="3" ${dis}>${esc((rec.docs || []).join("\n"))}</textarea></div>
          <div class="form-grid eu-grid mt2"><div class="field"><label for="eu-risk">${th("Ocena ryzyka")}</label><select class="ctrl" id="eu-risk" ${dis}><option value="">—</option>${Object.entries(E.RISK_LEVELS).map(([k, l]) => `<option value="${k}" ${rec.riskLevel === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div>
            <div class="field grow"><label for="eu-rn">${th("Uzasadnienie oceny")}</label><input class="ctrl" id="eu-rn" value="${esc(rec.riskNote || "")}" ${dis}></div></div>` : ""}`;
    }
    body += `<div class="field mt3"><label for="eu-note">${th("Uwagi")}</label><input class="ctrl" id="eu-note" value="${esc(rec.note || "")}" ${dis}></div>${rec.updatedAt ? `<p class="help mt2">${esc(t("Ostatnia zmiana: {d} · {u}", { d: Dates.ts(rec.updatedAt), u: rec.updatedBy || "" }))}</p>` : ""}`;
    const m = Modal.open({ id: "eu-rec", wide: true, title: t("EUDR — {no}", { no: op.no }), sub: esc(`${side === "OUT" ? t("Sprzedaż") : t("Zakup / surowiec")} · ${Dates.pl(op.date)}`), body,
      footer: `${side === "IN" && ev.role === "OPERATOR" ? `<button class="btn ghost" type="button" data-dds>${ic("dl", 14)} ${th("Projekt DDS (JSON)")}</button>` : ""}<button class="btn ghost" type="button" data-op>${th("Dokument")}</button><span class="spacer"></span><button class="btn ghost" type="button" data-x2>${th("Zamknij")}</button>${can ? `<button class="btn primary" type="button" data-save>${th("Zapisz dane EUDR")}</button>` : ""}` });
    bindRefs(m.el);
    $("[data-x2]", m.el).onclick = () => m.close();
    $("[data-op]", m.el).onclick = () => UI.OpDetail.open(op.id);
    $$("[data-eu-src]", m.el).forEach(tr_ => tr_.onclick = () => { m.close(); openRecord(tr_.dataset.euSrc, "IN"); });
    const dds = $("[data-dds]", m.el); if (dds) dds.onclick = () => download(`DDS-projekt-${op.no.replace(/\W+/g, "-")}.json`, JSON.stringify(E.ddsDraft(Store.state, op.id), null, 2), "application/json");
    const refsTxt = () => ev.refs.map(r => `${r.ref}${r.ver ? ` (weryfikacja: ${r.ver})` : ""}`).join("\n");
    const cp = $("#eu-copy", m.el); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(refsTxt()); Toast.ok(t("Skopiowano numery")); } catch (e) { Toast.err(t("Schowek niedostępny"), e.message); } };
    const tx = $("#eu-txt", m.el); if (tx) tx.onclick = () => download(`EUDR-${op.no.replace(/\W+/g, "-")}.txt`, [`Informacja EUDR do dokumentu ${op.no} z dnia ${Dates.pl(op.date)}`, `Sprzedawca: ResInvest Commodities · Odbiorca: ${ev.partnerName}`, `Towar: ${ev.productName}, ${fmtQ(ev.qty)} ${unitL(ev.unit)} (≈ ${q(ev.t, 2)} t), kod CN ${ev.cn}`, "", "Numery referencyjne oświadczeń o należytej staranności (DDS) / identyfikatory deklaracji:", refsTxt(), "", "Rozporządzenie (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650."].join("\r\n"), "text/plain;charset=utf-8");
    const sv = $("[data-save]", m.el);
    if (sv) sv.onclick = async () => {
      const v = id => { const el = $(id, m.el); return el ? el.value : undefined; };
      const recIn = Object.assign({}, rec, { refs: readRefs(m.el), note: v("#eu-note") });
      if (side === "OUT") recIn.traceMode = $("#eu-manual", m.el).checked ? "manual" : "auto";
      else {
        Object.assign(recIn, { species: v("#eu-sp"), harvestFrom: v("#eu-hf"), harvestTo: v("#eu-ht"), cn: v("#eu-cn"), plotIds: $$("#eu-plots input:checked", m.el).map(i => i.value) });
        if ($("#eu-dds", m.el)) Object.assign(recIn, { ownDds: { ref: v("#eu-dds"), ver: v("#eu-ddsv"), status: v("#eu-ddss") }, docs: v("#eu-docs").split(/\r?\n/).map(s => s.trim()).filter(Boolean), riskLevel: v("#eu-risk"), riskNote: v("#eu-rn") });
      }
      delete recIn.history;
      sv.disabled = true;
      const res = await exec("eudr.record.save", { opId: op.id, rec: recIn }, t("Zapisano dane EUDR"));
      sv.disabled = false;
      if (res && res.ok) m.close();
    };
  }

  /** Import numerów: CSV/tekst „nr dokumentu;numer referencyjny;numer weryfikacyjny”. */
  function openImport() {
    const m = Modal.open({ id: "eu-imp", wide: true, title: t("Import numerów referencyjnych"), sub: esc(t("np. zestawienie numerów DDS z nadleśnictwa")),
      body: `<p class="help">${th("Jeden wiersz: numer dokumentu w programie; numer referencyjny; numer weryfikacyjny (opcjonalnie). Separator: średnik, przecinek albo tabulator. Pierwszy wiersz z nagłówkiem jest pomijany.")}</p>
        <div class="field mt2"><label for="eu-imp-file">${th("Plik CSV")}</label><input class="ctrl" type="file" id="eu-imp-file" accept=".csv,.txt,text/csv,text/plain"></div>
        <div class="field mt2"><label for="eu-imp-t">${th("albo wklej wiersze")}</label><textarea class="ctrl mono" id="eu-imp-t" rows="8" placeholder="WZ/016/10/2026;26PLKK0000123A;KX4P2M7Q"></textarea></div><div id="eu-imp-msg" class="mt2"></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>${th("Anuluj")}</button><button class="btn primary" type="button" data-go>${th("Importuj")}</button>` });
    $("[data-x2]", m.el).onclick = () => m.close();
    $("#eu-imp-file", m.el).onchange = async e => { const f = e.target.files[0]; if (f) $("#eu-imp-t", m.el).value = (await f.text()).replace(/^﻿/, ""); };
    $("[data-go]", m.el).onclick = async () => {
      const rows = $("#eu-imp-t", m.el).value.split(/\r?\n/).map(l => l.split(/[;\t,]/).map(s => s.trim())).filter(c => c[0] && c[1] && !/^nr|^numer|^dokument/i.test(c[0])).map(c => ({ docNo: c[0], ref: c[1], ver: c[2] || "" }));
      const res = await Store.exec("eudr.refs.import", { rows }, SRC);
      const msg = $("#eu-imp-msg", m.el);
      if (res && res.ok) { Toast.ok(t("Zaimportowano numery"), t("{n} nowych numerów w {o} transakcjach", { n: res.added, o: res.matched })); if (!res.unmatched.length && !res.bad.length) { m.close(); App.render(); return; } App.render(); }
      msg.innerHTML = `<div class="info-line ${res && res.ok ? "warn" : "err"}">${ic("alert", 15)}<span>${esc(res && res.ok ? t("Pominięto — brak dokumentu: {u}{b}", { u: res.unmatched.join(", ") || "—", b: res.bad.length ? " · " + res.bad.join("; ") : "" }) : (res && res.error) || "")}</span></div>`;
    };
  }

  /* ---------------------------------------------------------------- */
  /* Dostawcy                                                          */
  /* ---------------------------------------------------------------- */
  function suppliersTab(f) {
    const S = Store.state, rg = range(f), reg = E.register(S, { from: rg.from, to: rg.to, whIds: whIds(f), side: "IN" });
    const list = S.partners.filter(p => ["supplier", "both"].includes(p.role) && p.active !== false).map(p => Object.assign(E.supplierProfile(S, p.id), { rows: reg.filter(r => r.partnerId === p.id) }));
    return `<div class="card">${periodBar(f)}<div class="tbl-wrap"><table class="tbl stack" id="eu-sup"><thead><tr><th>${th("Dostawca")}</th><th>${th("Rola w łańcuchu EUDR")}</th><th>${th("Kraj / ryzyko")}</th><th>${th("Identyfikator deklaracji")}</th><th>${th("Weryfikacja")}</th><th class="r">${th("Transakcje")}</th><th class="r">${th("Braki")}</th><th></th></tr></thead><tbody>
      ${list.map(p => `<tr><td data-l="${th("Dostawca")}"><b>${esc(p.name)}</b><div class="dim small">${esc([p.kind === "nadlesnictwo" ? t("Nadleśnictwo") : t("Firma"), p.city].filter(Boolean).join(" · "))}</div></td><td data-l="${th("Rola w łańcuchu EUDR")}">${esc(t(E.SUPPLIER_ROLES[p.role].short))}${p.saved ? "" : ` <span class="badge">${th("domyślnie")}</span>`}</td>
        <td data-l="${th("Kraj / ryzyko")}">${esc(p.country)} · <span class="badge ${p.risk === "LOW" ? "ok" : "warn"}">${th(p.risk === "LOW" ? "niskie" : "standardowe")}</span></td><td data-l="${th("Identyfikator deklaracji")}" class="mono small">${esc(p.declarationId || "—")}</td>
        <td data-l="${th("Weryfikacja")}">${p.verifiedAt ? `<span class="badge ok">${esc(Dates.pl(p.verifiedAt))}</span><div class="dim small">${esc(p.verifiedBy)}</div>` : `<span class="badge warn">${th("brak")}</span>`}</td>
        <td data-l="${th("Transakcje")}" class="r">${p.rows.length}</td><td data-l="${th("Braki")}" class="r">${p.rows.filter(r => r.status === "BRAKI").length || "—"}</td>
        <td class="r">${App.can("eudr.manage") ? `<button class="btn sm" type="button" data-eu-sup="${esc(p.partnerId)}">${th("Profil EUDR")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function openSupplier(id) {
    const p = E.supplierProfile(Store.state, id);
    const m = Modal.open({ id: "eu-sup-dlg", wide: true, title: t("Profil EUDR — {n}", { n: p.name }),
      body: `<div class="form-grid eu-grid"><div class="field grow"><label for="es-role">${th("Rola dostawcy w łańcuchu")}</label><select class="ctrl" id="es-role">${Object.entries(E.SUPPLIER_ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${th(v.label)}</option>`).join("")}</select></div>
          <div class="field"><label for="es-c">${th("Kraj (ISO)")}</label><input class="ctrl" id="es-c" maxlength="2" value="${esc(p.country)}"></div>
          <div class="field"><label for="es-d">${th("Identyfikator deklaracji uproszczonej")}</label><input class="ctrl mono" id="es-d" value="${esc(p.declarationId)}"></div></div>
        <div class="field mt2"><label for="es-k">${th("Kontakt / sposób przekazywania numerów")}</label><input class="ctrl" id="es-k" value="${esc(p.contact)}"></div>
        <div class="field mt2"><label for="es-n">${th("Uwagi")}</label><input class="ctrl" id="es-n" value="${esc(p.note)}"></div>
        <label class="inline-opt mt3"><input type="checkbox" id="es-v" ${p.verifiedAt ? "checked" : ""}> ${th("Zweryfikowano (dokumenty dostawcy, rola w łańcuchu, kraj)")}</label>`,
      footer: `<button class="btn ghost" type="button" data-x2>${th("Anuluj")}</button><button class="btn primary" type="button" data-save>${th("Zapisz")}</button>` });
    $("[data-x2]", m.el).onclick = () => m.close();
    $("[data-save]", m.el).onclick = async () => {
      const res = await exec("eudr.supplier.save", { partnerId: id, rec: { role: $("#es-role", m.el).value, country: $("#es-c", m.el).value, declarationId: $("#es-d", m.el).value, contact: $("#es-k", m.el).value, note: $("#es-n", m.el).value, verified: $("#es-v", m.el).checked } }, t("Zapisano profil dostawcy"));
      if (res && res.ok) m.close();
    };
  }

  /* ---------------------------------------------------------------- */
  /* Działki                                                           */
  /* ---------------------------------------------------------------- */
  function plotsTab() {
    const D = E.data(Store.state), can = App.can("eudr.manage");
    const osm = p => p.lat != null ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(p.lat)}&mlon=${encodeURIComponent(p.lon)}#map=15/${encodeURIComponent(p.lat)}/${encodeURIComponent(p.lon)}` : "";
    return `<div class="card"><div class="card-h"><h3>${th("Działki — geolokalizacja miejsc pozyskania")}</h3><span class="sub">${th("WGS84 · punkt (do 4 ha) albo wielokąt GeoJSON")}</span><span class="spacer"></span>
        <button class="btn" type="button" id="eu-geo">${ic("dl", 14)} GeoJSON</button>${can ? `<button class="btn primary" type="button" id="eu-plot-add">${ic("plus", 14)} ${th("Nowa działka")}</button>` : ""}</div>
      ${D.plots.length ? `<div class="tbl-wrap"><table class="tbl stack" id="eu-plots-t"><thead><tr><th>${th("Nadleśnictwo / leśnictwo")}</th><th>${th("Adres leśny / lokalizacja")}</th><th class="r">${th("Pow. ha")}</th><th>${th("Geometria")}</th><th>${th("Uwagi")}</th><th></th></tr></thead><tbody>
        ${D.plots.map(p => `<tr><td data-l="${th("Nadleśnictwo / leśnictwo")}">${esc([p.ndl && `Nadl. ${p.ndl}`, p.lesnictwo && `leśn. ${p.lesnictwo}`].filter(Boolean).join(" · ") || "—")}</td><td data-l="${th("Adres leśny / lokalizacja")}">${esc(p.address || "—")}</td><td data-l="${th("Pow. ha")}" class="r">${esc(p.areaHa != null ? fmtQ(p.areaHa) : "—")}</td>
          <td data-l="${th("Geometria")}">${p.polygon ? `<span class="badge info">${th("wielokąt")}</span>` : `<span class="mono small">${esc(`${p.lat}, ${p.lon}`)}</span>`} ${osm(p) ? `<a class="small" href="${esc(osm(p))}" target="_blank" rel="noopener noreferrer">${th("mapa")}</a>` : ""}</td><td data-l="${th("Uwagi")}" class="small">${esc(p.note || "")}</td>
          <td class="r">${can ? `<div class="row-actions"><button class="btn sm" type="button" data-plot-edit="${esc(p.id)}">${th("Edytuj")}</button><button class="btn sm ghost" type="button" data-plot-del="${esc(p.id)}" aria-label="${th("Usuń")}">${ic("trash", 14)}</button></div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak działek.")}</div>`}</div>`;
  }
  function openPlot(id) {
    const S = Store.state, p = E.data(S).plots.find(x => x.id === id) || {};
    const ndls = S.partners.filter(x => R.partnerKind(x) === "nadlesnictwo");
    const les = [...new Set([].concat(...ndls.map(x => x.lesnictwa || [])))];
    const m = Modal.open({ id: "eu-plot-dlg", wide: true, title: id ? t("Działka — edycja") : t("Nowa działka"),
      body: `<div class="form-grid eu-grid"><div class="field"><label for="ep-n">${th("Nadleśnictwo")}</label><input class="ctrl" id="ep-n" list="ep-nl" value="${esc(p.ndl || "")}"><datalist id="ep-nl">${ndls.map(x => `<option value="${esc(R.ndlName(x))}">`).join("")}</datalist></div>
          <div class="field"><label for="ep-l">${th("Leśnictwo")}</label><input class="ctrl" id="ep-l" list="ep-ll" value="${esc(p.lesnictwo || "")}"><datalist id="ep-ll">${les.map(x => `<option value="${esc(x)}">`).join("")}</datalist></div>
          <div class="field grow"><label for="ep-a">${th("Adres leśny (oddział / pododdział) albo działka ewidencyjna")}</label><input class="ctrl" id="ep-a" value="${esc(p.address || "")}"></div></div>
        <div class="form-grid eu-grid mt2"><div class="field"><label for="ep-lat">${th("Szerokość (N)")}</label><input class="ctrl mono" id="ep-lat" inputmode="decimal" value="${esc(p.lat != null ? String(p.lat).replace(".", ",") : "")}"></div>
          <div class="field"><label for="ep-lon">${th("Długość (E)")}</label><input class="ctrl mono" id="ep-lon" inputmode="decimal" value="${esc(p.lon != null ? String(p.lon).replace(".", ",") : "")}"></div>
          <div class="field"><label for="ep-ha">${th("Powierzchnia [ha]")}</label><input class="ctrl" id="ep-ha" inputmode="decimal" value="${esc(p.areaHa != null ? String(p.areaHa).replace(".", ",") : "")}"></div>
          <div class="field"><span class="lbl">&nbsp;</span><button class="btn" type="button" id="ep-gps">${ic("pin", 14)} ${th("Moja lokalizacja")}</button></div></div>
        <div class="field mt2"><label for="ep-poly">${th("Wielokąt GeoJSON (wymagany powyżej 4 ha)")}</label><textarea class="ctrl mono" id="ep-poly" rows="4" placeholder='{"type":"Polygon","coordinates":[[[18.69,50.29],…]]}'>${esc(p.polygon || "")}</textarea></div>
        <div class="field mt2"><label for="ep-note">${th("Uwagi")}</label><input class="ctrl" id="ep-note" value="${esc(p.note || "")}"></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>${th("Anuluj")}</button><button class="btn primary" type="button" data-save>${th("Zapisz")}</button>` });
    $("[data-x2]", m.el).onclick = () => m.close();
    $("#ep-gps", m.el).onclick = () => {
      if (!navigator.geolocation) { Toast.err(t("Lokalizacja niedostępna")); return; }
      navigator.geolocation.getCurrentPosition(pos => { $("#ep-lat", m.el).value = pos.coords.latitude.toFixed(6).replace(".", ","); $("#ep-lon", m.el).value = pos.coords.longitude.toFixed(6).replace(".", ","); }, e => Toast.err(t("Lokalizacja niedostępna"), e.message), { enableHighAccuracy: true, timeout: 10000 });
    };
    $("[data-save]", m.el).onclick = async () => {
      const v = s => $(s, m.el).value;
      const res = await exec("eudr.plot.save", { rec: { id: id || "", ndl: v("#ep-n"), lesnictwo: v("#ep-l"), address: v("#ep-a"), lat: v("#ep-lat"), lon: v("#ep-lon"), areaHa: v("#ep-ha"), polygon: v("#ep-poly"), note: v("#ep-note") } }, t("Zapisano działkę"));
      if (res && res.ok) m.close();
    };
  }

  /* ---------------------------------------------------------------- */
  /* Raporty i eksport                                                 */
  /* ---------------------------------------------------------------- */
  function reportsTab(f) {
    const S = Store.state, rg = range(f), rep = E.report(S, { from: rg.from, to: rg.to, whIds: whIds(f) });
    const row = (side, k) => { const x = rep[side][k]; return `<tr><td>${badge(k)}</td><td class="r">${x.count}</td><td class="r">${esc(q(x.sum.mp, 0))}</td><td class="r">${esc(q(x.sum.m3, 1))}</td><td class="r">${esc(q(x.sum.t, 1))}</td></tr>`; };
    const tbl = (side, title) => `<div class="card"><div class="card-h"><h3>${th(title)}</h3><span class="sub">${esc(rg.label)}</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${th("Status")}</th><th class="r">${th("Transakcje")}</th><th class="r">MP</th><th class="r">m³</th><th class="r">t</th></tr></thead><tbody>${["OK", "UWAGI", "BRAKI"].map(k => row(side, k)).join("")}</tbody></table></div></div>`;
    const year = f.mode === "year" ? f.year : (f.mode === "month" ? f.ym.slice(0, 4) : App.today().slice(0, 4));
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter(m => Dates.monthStart(m) <= App.today());
    const monthRows = months.map(m => { const r = E.report(S, { from: Dates.monthStart(m), to: Dates.monthEnd(m), whIds: whIds(f) }); return `<tr><td>${esc(Dates.label(m))}</td><td class="r">${r.IN.count}</td><td class="r">${r.IN.BRAKI.count || "—"}</td><td class="r">${r.OUT.count}</td><td class="r">${r.OUT.BRAKI.count || "—"}</td><td class="r"><b>${r.readyPct}%</b></td></tr>`; }).join("");
    return `<div class="card">${periodBar(f, `<span class="spacer"></span><button class="btn" type="button" id="eu-csv">${ic("dl", 14)} ${th("Rejestr CSV")}</button><button class="btn" type="button" id="eu-geo">${ic("dl", 14)} GeoJSON</button><button class="btn" type="button" id="eu-json">${ic("dl", 14)} ${th("Kopia danych EUDR (JSON)")}</button>`)}</div>
      <div class="dash-row">${tbl("IN", "Zakupy / surowiec")}${tbl("OUT", "Sprzedaż")}</div>
      <div class="card mt4"><div class="card-h"><h3>${esc(t("Zestawienie miesięczne {y}", { y: year }))}</h3><span class="sub">${th("gotowość = transakcje objęte EUDR bez braków")}</span></div><div class="tbl-wrap"><table class="tbl" id="eu-months"><thead><tr><th>${th("Miesiąc")}</th><th class="r">${th("Zakupy")}</th><th class="r">${th("braki")}</th><th class="r">${th("Sprzedaż")}</th><th class="r">${th("braki")}</th><th class="r">${th("Gotowość")}</th></tr></thead><tbody>${monthRows}</tbody></table></div></div>
      <p class="help mt3">${esc(t("Poza zakresem EUDR w okresie: {n} pozycji (produkty spoza załącznika I, np. łupina nerkowca; PKS — do weryfikacji kodu CN).", { n: rep.outOfScope }))}</p>`;
  }

  /* ---------------------------------------------------------------- */
  /* Ustawienia                                                        */
  /* ---------------------------------------------------------------- */
  function settingsTab() {
    const S = Store.state, st = E.data(S).settings, can = App.can("eudr.manage"), dis = can ? "" : "disabled";
    return `<div class="card"><div class="card-h"><h3>${th("Ustawienia EUDR")}</h3>${can ? "" : `<span class="sub">${th("tylko odczyt — zmiany: kierownik lub administrator")}</span>`}</div><div class="card-b">
      <div class="form-grid eu-grid"><div class="field"><label for="eu-af">${th("Stosowanie EUDR od")}</label><input class="ctrl" type="date" id="eu-af" value="${esc(st.applyFrom)}" ${dis}></div>
        <div class="field"><label for="eu-cs">${th("Wielkość przedsiębiorstwa")}</label><select class="ctrl" id="eu-cs" ${dis}>${Object.entries(E.COMPANY_SIZES).map(([k, l]) => `<option value="${k}" ${st.companySize === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div>
        <div class="field"><label for="eu-lb">${th("Okres puli magazynu [dni]")}</label><input class="ctrl" id="eu-lb" inputmode="numeric" value="${esc(st.lookbackDays)}" ${dis}></div>
        <div class="field"><label for="eu-op">${th("Identyfikator operatora (EORI)")}</label><input class="ctrl mono" id="eu-op" value="${esc(st.operatorId)}" ${dis}></div></div>
      <label class="inline-opt mt3"><input type="checkbox" id="eu-reg" ${st.registered ? "checked" : ""} ${dis}> ${th("Firma zarejestrowana w systemie informacyjnym UE (TRACES)")}</label>
      <p class="help mt2">${th("Termin: 30.12.2026 dla dużych i średnich firm oraz dla sektora drzewnego objętego wcześniej EUTR; 30.06.2027 dla pozostałych mikro i małych firm. Okres puli — ile dni wstecz program szuka przyjęć, z których pochodzi towar sprzedawany ze stanu.")}</p>
      <h4 class="mini-h">${th("Zakres produktów")}</h4><div class="tbl-wrap"><table class="tbl" id="eu-prod"><thead><tr><th>${th("Produkt")}</th><th>${th("Kategoria")}</th><th class="c">${th("Objęty EUDR")}</th><th>${th("Kod CN")}</th></tr></thead><tbody>
        ${S.products.map(p => { const sc = E.productScope(S, p.id); return `<tr data-prod="${esc(p.id)}"><td>${esc(p.name)}</td><td>${th(R.PRODUCT_CATS[p.cat] || p.cat)}</td><td class="c"><input type="checkbox" data-k="in" ${sc.inScope ? "checked" : ""} ${dis} aria-label="${th("Objęty EUDR")}"></td><td><input class="ctrl sm mono" data-k="cn" value="${esc(sc.cn)}" ${dis} aria-label="${th("Kod CN")}"></td></tr>`; }).join("")}</tbody></table></div>
      ${can ? `<div class="row-gap mt3"><button class="btn primary" type="button" id="eu-set-save">${th("Zapisz ustawienia")}</button></div>` : ""}</div></div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Plan wdrożenia (stan liczony z danych)                            */
  /* ---------------------------------------------------------------- */
  function planTab() {
    const S = Store.state, D = E.data(S), from = Dates.addDays(App.today(), -90), rep = E.report(S, { from, to: App.today() });
    const pct = (a, b) => b ? Math.round(a / b * 100) : 100;
    const steps = [
      [D.settings.registered, "Rejestracja w systemie informacyjnym UE (TRACES), identyfikator EORI", "Administrator / zarząd", "do 30.11.2026"],
      [rep.suppliers.total > 0 && rep.suppliers.verified === rep.suppliers.total, `Profile EUDR dostawców — zweryfikowano ${rep.suppliers.verified} z ${rep.suppliers.total}`, "Kierownik zakupów", "do 15.12.2026"],
      [rep.IN.BRAKI.count === 0, `Numery DDS przy zakupach (90 dni): ${pct(rep.IN.count - rep.IN.BRAKI.count, rep.IN.count)}% bez braków`, "Magazynier przy PZ", "na bieżąco od 01.12.2026"],
      [D.plots.length > 0, `Działki i geolokalizacja (${D.plots.length} w ewidencji) — obowiązkowe przy wycince / zakupie na pniu`, "Kierownik", "przed pierwszą wycinką"],
      [rep.OUT.BRAKI.count === 0, `Numery dla odbiorców przy WZ (90 dni): ${pct(rep.OUT.count - rep.OUT.BRAKI.count, rep.OUT.count)}% bez braków`, "Sprzedaż / magazyn", "od 30.12.2026"],
      [false, "Procedura należytej staranności (opis systemu, odpowiedzialni, przegląd raz w roku) i szkolenie magazynierów", "Zarząd", "do 20.12.2026"],
      [false, "Archiwizacja 5 lat: kopie zapasowe danych EUDR i dokumentów źródłowych (Administracja → Kopia)", "Administrator", "stale"]
    ];
    return `<div class="card"><div class="card-h"><h3>${th("Plan wdrożenia EUDR w ResInvest Commodities")}</h3><span class="sub">${th("stan liczony z danych programu")}</span></div><div class="card-b"><ol class="eu-plan">
      ${steps.map(([ok, txt, who, when], i) => `<li class="${ok ? "ok" : ""}"><span class="n">${ok ? ic("check", 14) : i + 1}</span><div><b>${esc(txt)}</b><small>${esc(who)} · ${esc(when)}</small></div></li>`).join("")}</ol></div></div>`;
  }

  /* ---------------------------------------------------------------- */
  Views.eudr = {
    html(params) {
      const f = F();
      if (params && params.tab && TABS.some(x => x[0] === params.tab)) f.tab = params.tab;
      const tabs = `<div class="tabs eu-tabs" role="tablist">${TABS.map(([k, l, i]) => `<button class="tab" type="button" role="tab" data-eu-tab="${k}" aria-selected="${f.tab === k}">${ic(i, 14)} ${th(l)}</button>`).join("")}</div>`;
      const body = f.tab === "rejestr" ? registerTab(f) : f.tab === "dostawcy" ? suppliersTab(f) : f.tab === "dzialki" ? plotsTab() : f.tab === "raporty" ? reportsTab(f) : f.tab === "ustawienia" ? settingsTab() : f.tab === "plan" ? planTab() : overview(f);
      return `<div class="eudr" id="eudr">${tabs}${f.tab === "przeglad" ? `<div class="mb3">${periodBar(f)}</div>` : ""}${body}
        <p class="help mt4 eu-legal">${th("Demonstracja ResInvest ERP 3.12 · Rozporządzenie (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650. Program wspiera ewidencję — nie zastępuje oświadczeń składanych w systemie informacyjnym UE ani porady prawnej.")}</p></div>`;
    },
    bind(page) {
      const f = F(), go = () => App.render();
      $$("[data-eu-tab]", page).forEach(b => b.onclick = e => { e.preventDefault(); f.tab = b.dataset.euTab; if (location.hash !== "#/eudr") location.hash = "#/eudr"; go(); });
      $$("[data-eu-open]", page).forEach(el => el.onclick = e => { e.preventDefault(); openRecord(el.dataset.euOpen, el.dataset.euSide); });
      const on = (id, k, cast) => { const el = $(id, page); if (el) el.onchange = () => { f[k] = cast ? cast(el.value) : el.value; go(); }; };
      on("#eu-mode", "mode"); on("#eu-ym", "ym"); on("#eu-year", "year"); on("#eu-scope", "scope"); on("#eu-side", "side"); on("#eu-status", "status");
      const csv = $("#eu-csv", page); if (csv) csv.onclick = () => { const rg = range(f); download(`EUDR-rejestr-${f.mode === "month" ? f.ym : f.mode === "year" ? f.year : "calosc"}.csv`, toCSV(E.CSV_HEAD, E.csvRows(Store.state, { from: rg.from, to: rg.to, whIds: whIds(f) }).map(r => r.map(c => typeof c === "number" ? csvNum(c) : c === null ? "" : UI.Premium.safeCell(c)))), "text/csv;charset=utf-8"); };
      const geo = $("#eu-geo", page); if (geo) geo.onclick = () => download("EUDR-dzialki.geojson", JSON.stringify(E.geojson(Store.state), null, 2), "application/geo+json");
      const js = $("#eu-json", page); if (js) js.onclick = () => download(`EUDR-dane-${App.today()}.json`, JSON.stringify(E.data(Store.state), null, 2), "application/json");
      const imp = $("#eu-import", page); if (imp) imp.onclick = openImport;
      $$("[data-eu-sup]", page).forEach(b => b.onclick = () => openSupplier(b.dataset.euSup));
      const pa = $("#eu-plot-add", page); if (pa) pa.onclick = () => openPlot("");
      $$("[data-plot-edit]", page).forEach(b => b.onclick = () => openPlot(b.dataset.plotEdit));
      $$("[data-plot-del]", page).forEach(b => b.onclick = async () => { const c = await Modal.confirm({ title: t("Usunąć działkę?"), text: t("Działka zniknie z ewidencji EUDR. Zmiana trafi do dziennika audytu."), ok: t("Usuń"), danger: true }); if (c.ok) exec("eudr.plot.remove", { id: b.dataset.plotDel }, t("Usunięto działkę")); });
      const ss = $("#eu-set-save", page);
      if (ss) ss.onclick = () => {
        const products = {}; $$("#eu-prod [data-prod]", page).forEach(tr_ => { products[tr_.dataset.prod] = { inScope: $('[data-k="in"]', tr_).checked, cn: $('[data-k="cn"]', tr_).value }; });
        exec("eudr.settings.save", { settings: { applyFrom: $("#eu-af", page).value, companySize: $("#eu-cs", page).value, lookbackDays: $("#eu-lb", page).value, operatorId: $("#eu-op", page).value, registered: $("#eu-reg", page).checked, products } }, t("Zapisano ustawienia EUDR"));
      };
    }
  };
  UI.EUDRView = { openRecord, openSupplier, openPlot };
})(typeof globalThis !== "undefined" ? globalThis : this);
