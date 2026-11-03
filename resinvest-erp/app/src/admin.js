/* =========================================================================
   ResInvest ERP 3.2 — kartoteki (produkty, kontrahenci, magazyny),
   użytkownicy (zaproszenia, statusy, magazyny), role i uprawnienia,
   dziennik audytu, mój profil, administracja (kopie, konfiguracja dostępu,
   preferencje, narzędzia trybu lokalnego).
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, I18N, t, tp, N_, esc, $, $$, ic, download, Toast, Modal, Store, LocalBackend, ServerBackend, App, Auth, Prefs, THEME_LIST, Views, initials, lsGet, lsSet, ssGet, ssSet, DRAFT_KEY, pwField, bindEyes, pwMeter, bindMeter, opPartnerId, searchInput, bindSearch } = UI;
  const { fmt, fmtQ, money, Units, Dates, Stock } = R;
  const AuthLib = root.RIW_Auth;
  const th = s => esc(t(s));
  const SRC_MASTER = N_("Kartoteki"), SRC_USERS = N_("Administracja — użytkownicy");

  /** Pole formularza okna edycji z miejscem na komunikat walidacji. */
  const ff = (k, label, ctrl, help, span) => `<div class="field ${span || ""}" data-ff="${k}"><label for="me-${k}">${esc(label)}</label>${ctrl}<div class="msg hidden" data-fmsg="${k}"></div>${help ? `<div class="help">${esc(help)}</div>` : ""}</div>`;
  const opts = (arr, v) => arr.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const showErrors = (m, res) => {
    $$("[data-fmsg]", m.el).forEach(x => x.classList.add("hidden"));
    for (const [k, msg] of Object.entries(res.errors || {})) { const x = $(`[data-fmsg="${k}"]`, m.el); if (x) { x.textContent = msg; x.classList.remove("hidden"); } }
  };
  const activeBadge = a => a === false ? `<span class="badge">${th("nieaktywny")}</span>` : `<span class="badge ok">${th("aktywny")}</span>`;

  /* ================================================================== */
  /* Kartoteki                                                            */
  /* ================================================================== */
  const Master = {
    edit(kind, id) {
      const S = Store.state, rec = id ? R.clone(R.byId(S[kind], id)) : ({ products: { code: "", name: "", cat: "zrebka", unit: "MP", units: ["MP", "t"], active: true }, partners: { name: "", role: "supplier", kind: "firma", city: "", address: "", nip: "", phone: "", email: "", lesnictwa: [], active: true }, warehouses: { code: "", name: "", address: "", active: true }, extraTypes: { name: "", desc: "", unit: "", rate: null, active: true } })[kind];
      let body = "";
      if (kind === "products") {
        const used = id && R.Master.usedProduct(S, id);
        const allowedNow = Units.allowed(rec), num = v => v != null && v !== "" ? fmtQ(v, 4) : "";
        body = `<div class="fgrid">${ff("code", t("Kod"), `<input class="ctrl" id="me-code" value="${esc(rec.code)}" maxlength="12" autocapitalize="characters">`)}
          ${ff("name", t("Nazwa"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}">`)}
          ${ff("cat", t("Grupa"), `<select class="ctrl" id="me-cat">${opts(Object.entries(R.PRODUCT_CATS).map(([k, v]) => [k, t(v)]), rec.cat)}</select>`, t("Grupa porządkuje kartotekę; do produkcji zrębki służą produkty z grupy „Drewno”."))}
          ${ff("unit", t("Jednostka magazynowa (stan)"), `<select class="ctrl" id="me-unit" ${used ? "disabled" : ""}>${opts(Units.LIST.map(u => [u, Units.label(u)]), rec.unit)}</select>`, used ? t("Produkt ma ruchy w księdze — jednostki magazynowej nie można zmienić") : t("W tej jednostce prowadzony jest stan magazynu i księga."))}
          <div class="field span-all" data-ff="units"><label>${th("Dozwolone jednostki na dokumentach (zakup, sprzedaż, MM)")}</label><div class="row wrap">${Units.LIST.map(u => `<label class="inline-opt"><input type="checkbox" data-unit-ok="${u}" ${(Array.isArray(rec.units) ? rec.units : allowedNow).includes(u) ? "checked" : ""}> ${esc(Units.label(u))}</label>`).join("")}</div><div class="msg hidden" data-fmsg="units"></div>
            <div class="help">${th("Jednostka magazynowa jest zawsze dozwolona. Przeliczenie między jednostkami — według przeliczników poniżej.")}</div></div>
          ${ff("tPerUnit", t("Masa 1 jednostki magazynowej [t]"), `<input class="ctrl num-in" id="me-tPerUnit" inputmode="decimal" value="${esc(num(rec.tPerUnit))}" placeholder="${esc(t("domyślnie z konfiguracji"))}">`, t("Dla m³ i MP. Domyślnie: drewno {a} t/m³, zrębka {b} t/MP.", { a: fmt(S.config.woodTPerM3, 3), b: fmt(S.config.mp_t, 2) }))}
          ${ff("tPerM3", t("Gęstość: t na 1 m³"), `<input class="ctrl num-in" id="me-tPerM3" inputmode="decimal" value="${esc(num(rec.tPerM3))}" placeholder="${esc(t("np. {x}", { x: fmt(0.6, 2) }))}">`, t("Dla produktów prowadzonych w tonach, które mają być kupowane także w m³ lub MP (np. łupina)."))}
          ${ff("mpPerM3", t("MP z 1 m³"), `<input class="ctrl num-in" id="me-mpPerM3" inputmode="decimal" value="${esc(num(rec.mpPerM3))}" placeholder="${esc(fmtQ(S.config.m3_mp))}">`, t("Przelicznik m³ ↔ MP dla tego produktu (domyślnie {k}).", { k: fmtQ(S.config.m3_mp) }))}
          ${ff("active", t("Status"), `<select class="ctrl" id="me-active">${opts([["true", t("aktywny")], ["false", t("nieaktywny")]], String(rec.active !== false))}</select>`)}</div>`;
      } else if (kind === "partners") {
        body = `<div class="fgrid">${ff("name", t("Nazwa"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}">`, "", "span-all")}
          ${ff("role", t("Rola"), `<select class="ctrl" id="me-role">${opts(Object.entries(R.PARTNER_ROLES).map(([k, v]) => [k, t(v)]), rec.role)}</select>`)}
          ${ff("kind", t("Grupa dostawcy"), `<select class="ctrl" id="me-kind">${opts(Object.entries(R.SUPPLIER_KINDS).map(([k, v]) => [k, t(v.label)]), rec.kind || "firma")}</select>`, t("Firma → podstawa domyślnie KZR, nadleśnictwo → Deklaracja."))}
          ${ff("nip", "NIP", `<input class="ctrl" id="me-nip" value="${esc(rec.nip || "")}" inputmode="numeric" placeholder="${esc(t("np. {x}", { x: "6310000000" }))}">`)}
          ${ff("city", t("Miejscowość"), `<input class="ctrl" id="me-city" value="${esc(rec.city || "")}">`)}
          ${ff("address", t("Adres"), `<input class="ctrl" id="me-address" value="${esc(rec.address || "")}">`, "", "span-all")}
          ${ff("phone", t("Telefon"), `<input class="ctrl" id="me-phone" value="${esc(rec.phone || "")}" inputmode="tel">`)}
          ${ff("email", t("E-mail"), `<input class="ctrl" id="me-email" type="email" value="${esc(rec.email || "")}">`)}
          ${ff("lesnictwa", t("Leśnictwa (dla nadleśnictwa, oddzielone przecinkami)"), `<input class="ctrl" id="me-lesnictwa" value="${esc((rec.lesnictwa || []).join(", "))}">`, "", "span-all")}
          ${ff("active", t("Status"), `<select class="ctrl" id="me-active">${opts([["true", t("aktywny")], ["false", t("nieaktywny")]], String(rec.active !== false))}</select>`, t("Nieaktywny kontrahent nie pojawia się w nowych operacjach; historia zostaje."))}</div>`;
      } else if (kind === "extraTypes") {
        body = `<div class="fgrid">${ff("name", t("Nazwa"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}" placeholder="${esc(t("np. {x}", { x: t("Holowanie") }))}">`, "", "span-all")}
          ${ff("desc", t("Opis"), `<input class="ctrl" id="me-desc" value="${esc(rec.desc || "")}" maxlength="300">`, "", "span-all")}
          ${ff("unit", t("Jednostka (opcjonalnie)"), `<select class="ctrl" id="me-unit">${opts(Object.entries(R.EXTRA_UNITS).map(([k, v]) => [k, t(v)]), rec.unit || "")}</select>`, t("Przy jednostce i stawce koszt w operacji = ilość × stawka (można też wpisać kwotę)."))}
          ${ff("rate", t("Stawka domyślna [zł] (opcjonalnie)"), `<input class="ctrl num-in" id="me-rate" inputmode="decimal" value="${esc(rec.rate != null ? fmt(rec.rate, 2) : "")}" placeholder="${esc(t("np. {x}", { x: fmt(180, 2) }))}">`)}
          ${ff("active", t("Status"), `<select class="ctrl" id="me-active">${opts([["true", t("aktywna")], ["false", t("nieaktywna")]], String(rec.active !== false))}</select>`, t("Nieaktywna pozycja nie pojawia się w nowych operacjach; historia zostaje."))}</div>`;
      } else {
        body = `<div class="fgrid">${ff("code", t("Kod"), `<input class="ctrl" id="me-code" value="${esc(rec.code)}" maxlength="12" autocapitalize="characters">`)}
          ${ff("name", t("Nazwa"), `<input class="ctrl" id="me-name" value="${esc(rec.name)}">`)}
          ${ff("address", t("Adres"), `<input class="ctrl" id="me-address" value="${esc(rec.address || "")}">`, "", "span-all")}
          ${ff("active", t("Status"), `<select class="ctrl" id="me-active">${opts([["true", t("aktywny")], ["false", t("nieaktywny")]], String(rec.active !== false))}</select>`, t("Magazyn można dezaktywować, gdy ma zerowe stany i nie ma przypisanych aktywnych użytkowników."))}</div>`;
      }
      const label = t(R.Master.KINDS[kind].label).toLowerCase();
      const m = Modal.open({ title: `${id ? t("Edycja") : t("Nowy")}: ${label}`, id: "master-edit", wide: kind === "partners", body,
        footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" data-yes>${ic("check", 15)} ${th("Zapisz")}</button>` });
      const us = $("#me-unit", m.el), cs = $("#me-cat", m.el);
      if (kind === "products" && us) {
        // nowa pozycja: grupa podpowiada jednostkę; jednostka magazynowa zawsze zaznaczona jako dozwolona
        const syncUnit = () => { $$("[data-unit-ok]", m.el).forEach(x => { if (x.dataset.unitOk === us.value) { x.checked = true; x.disabled = true; } else x.disabled = false; }); $("[data-ff=tPerM3]", m.el).classList.toggle("hidden", us.value !== "t"); $("[data-ff=tPerUnit]", m.el).classList.toggle("hidden", us.value === "t"); };
        us.addEventListener("change", syncUnit);
        if (!id && cs) cs.addEventListener("change", () => { us.value = R.CAT_UNIT[cs.value] || us.value; syncUnit(); });
        syncUnit();
      }
      const syncKind = () => { const r = $("#me-role", m.el), k = $("[data-ff=kind]", m.el); if (r && k) k.classList.toggle("hidden", r.value === "buyer"); };
      const rs = $("#me-role", m.el); if (rs) { rs.onchange = syncKind; syncKind(); }
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const next = Object.assign({}, rec, id ? { id } : {});
        for (const f of R.Master.KINDS[kind].fields) { const el = $("#me-" + f, m.el); if (el && !el.disabled) next[f] = el.value; }
        next.active = next.active === true || next.active === "true";
        if (kind === "products") { if ($("#me-unit", m.el).disabled) next.unit = rec.unit; next.units = $$("[data-unit-ok]", m.el).filter(x => x.checked).map(x => x.dataset.unitOk); }
        const res = await Store.exec("master.save", { kind, rec: next }, SRC_MASTER);
        if (!res.ok) { showErrors(m, res); Toast.err(t("Nie zapisano"), res.error); return; }
        m.close(); Toast.ok(t("Zapisano"), res.rec.name); App.render();
      };
    }
  };
  const masterPerm = kind => kind === "warehouses" ? "warehouses.edit" : "master.edit";
  const addBtn = (kind, label) => App.can(masterPerm(kind)) ? `<button class="btn primary" type="button" data-madd="${kind}">${ic("plus", 15)} ${th(label)}</button>` : `<span class="badge">${th("tylko podgląd — edycja: Kierownik / Administrator")}</span>`;
  const editBtn = (kind, id) => App.can(masterPerm(kind)) ? `<button class="btn sm" type="button" data-medit="${kind}|${esc(id)}">${ic("edit", 13)} ${th("Edytuj")}</button> <button class="btn sm danger" type="button" data-mdel="${kind}|${esc(id)}" title="${esc(t("Usuń"))}" aria-label="${esc(t("Usuń"))}">${ic("trash", 13)}</button>` : "";
  function bindMaster(page) {
    $$("[data-madd]", page).forEach(b => b.onclick = () => Master.edit(b.dataset.madd, null));
    $$("[data-mdel]", page).forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const [k, id] = b.dataset.mdel.split("|"), rec = R.byId(Store.state[k], id);
      const r = await Modal.confirm({ title: t("Usunąć: {n}?", { n: rec ? rec.name : "" }), text: t("Usunąć można tylko rekord, który nie występuje w żadnym dokumencie. Rekord z historią dezaktywuj — historia zostaje."), ok: t("Usuń"), danger: true });
      if (!r.ok) return;
      const res = await Store.exec("master.remove", { kind: k, id }, SRC_MASTER);
      if (res.ok) Toast.ok(t("Usunięto"), rec ? rec.name : ""); else Toast.err(t("Nie usunięto"), res.error);
      App.render();
    });
    $$("[data-medit]", page).forEach(b => b.onclick = e => { e.stopPropagation(); const [k, id] = b.dataset.medit.split("|"); Master.edit(k, id); });
  }

  Views.produkty = {
    html() {
      const S = Store.state, cfg = S.config, stock = Stock.byProduct(S, null);
      return `<div class="page-head"><div class="titles"><h2>${th("Produkty")}</h2><p>${th("Kartoteka produktów: każdy produkt ma własną jednostkę magazynową (m³, MP lub t), listę jednostek dozwolonych na dokumentach i przeliczniki. Jednostki magazynowej nie zmienia się po pierwszym ruchu w księdze — dozwolone jednostki i przeliczniki można zmieniać zawsze.")}</p></div>
          <div class="actions">${addBtn("products", N_("Nowy produkt"))}</div></div>
        <div class="card"><div class="tbl-wrap"><table class="tbl" id="products-table"><thead><tr><th>${th("Kod")}</th><th>${th("Nazwa")}</th><th>${th("Kategoria")}</th><th>${th("Jedn. magazynowa")}</th><th>${th("Dozwolone jednostki")}</th><th class="r">${th("Masa ≈ t / jedn.")}</th><th class="r">${th("Energia ≈ GJ / jedn.")}</th><th>${th("Przeliczniki")}</th><th class="r">${th("Stan firmy")}</th><th>${th("Status")}</th><th></th></tr></thead><tbody>
          ${S.products.map(p => { const m = Units.massPerUnit(p, cfg); return `<tr class="${p.active === false ? "void" : ""}"><td class="mono">${esc(p.code)}</td><td><b>${esc(p.name)}</b></td><td>${esc(t(R.PRODUCT_CATS[p.cat] || p.cat))}</td><td>${Units.label(p.unit)}</td><td>${Units.allowed(p).map(Units.label).join(", ")}</td><td class="r">${fmt(m, 3)}</td><td class="r">${fmt(m * cfg.t_gj, 2)}</td><td>${esc(Units.allowed(p).length < 2 ? t("brak (tylko {u})", { u: Units.label(p.unit) }) : [Units.allowed(p).includes("m3") && Units.allowed(p).includes("MP") ? `1 m³ = ${fmtQ(Units.factors(p, cfg).k)} MP` : "", Units.factors(p, cfg).tm3 ? `1 m³ ≈ ${fmt(Units.factors(p, cfg).tm3, 3)} t` : ""].filter(Boolean).join(" · "))}</td><td class="r">${esc(App.qtyNative(stock.get(p.id) || 0, p.id))}</td><td>${activeBadge(p.active)}</td><td class="r">${editBtn("products", p.id)}</td></tr>`; }).join("")}</tbody></table></div></div>
        <div class="card mt4"><div class="card-h"><h3>${th("Przeliczniki (config/app.config.json)")}</h3></div><div class="card-b"><dl class="money-list" style="max-width:560px"><dt>${th("1 m³ drewna")}</dt><dd>${fmtQ(cfg.m3_mp)} MP</dd><dt>1 MP</dt><dd>${fmtQ(1 / cfg.m3_mp, 3)} m³ · ${fmt(cfg.mp_t, 2)} t</dd><dt>${th("1 m³ drewna (masa)")}</dt><dd>${fmt(cfg.woodTPerM3, 3)} t</dd><dt>1 t</dt><dd>${fmt(cfg.t_gj, 1)} GJ</dd></dl></div></div>`;
    },
    bind(page) { bindMaster(page); }
  };

  /** Kartoteki → Dodatkowe operacje (rodzaje prac towarzyszących produkcji, z bazy — nie na stałe w programie). */
  Views.dodatkowe = {
    html() {
      const S = Store.state, list = S.extraTypes || [];
      const use = new Map();
      for (const op of S.operations) if (op.status !== "CANCELLED") for (const x of op.extras || []) { const u = use.get(x.typeId) || { n: 0, cost: 0, last: "" }; u.n++; u.cost += x.cost; if (op.date > u.last) u.last = op.date; use.set(x.typeId, u); }
      return `<div class="page-head"><div class="titles"><h2>${th("Dodatkowe operacje")}</h2><p>${th("Kartoteka rodzajów operacji dodatkowych (np. holowanie, podgarnianie pryzm, praca ładowarką). Wybierasz je w każdej operacji (zakup, sprzedaż, produkcja, MM) po zaznaczeniu „Dodaj operację dodatkową”. Pozycji użytych w dokumentach nie usuwa się — tylko dezaktywuje.")}</p></div>
          <div class="actions">${addBtn("extraTypes", N_("Nowa operacja dodatkowa"))}</div></div>
        <div class="card"><div class="tbl-wrap"><table class="tbl" id="extra-types-table"><thead><tr><th>ID</th><th>${th("Nazwa")}</th><th>${th("Opis")}</th><th>${th("Jednostka")}</th><th class="r">${th("Stawka domyślna")}</th><th>${th("Status")}</th><th class="r">${th("Użycia")}</th><th class="r">${th("Koszt łącznie")}</th><th>${th("Utworzono")}</th><th>${th("Zmieniono")}</th><th></th></tr></thead><tbody>
          ${list.length ? list.map(x => { const u = use.get(x.id) || { n: 0, cost: 0 }; return `<tr class="${x.active === false ? "void" : ""}" data-xt="${esc(x.id)}"><td class="mono small">${esc(x.id)}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.desc || "—")}</td><td>${esc(t(R.EXTRA_UNITS[x.unit || ""] || x.unit))}</td><td class="r">${x.rate != null ? esc(money(x.rate)) : "—"}</td><td>${x.active === false ? `<span class="badge">${th("nieaktywna")}</span>` : `<span class="badge ok">${th("aktywna")}</span>`}</td><td class="r">${u.n}</td><td class="r">${esc(money(u.cost))}</td><td class="nowrap">${esc(Dates.ts(x.createdAt))}</td><td class="nowrap">${esc(Dates.ts(x.updatedAt))}</td><td class="r">${editBtn("extraTypes", x.id)}</td></tr>`; }).join("")
            : `<tr><td colspan="11" class="empty">${th("Brak pozycji — dodaj pierwszą operację dodatkową.")}</td></tr>`}</tbody></table></div></div>`;
    },
    bind(page) { bindMaster(page); }
  };

  Views.kontrahenci = {
    html() {
      const S = Store.state;
      const f = App.tabs.partners || (App.tabs.partners = { role: "", q: "", show: "active" });
      const stats = new Map();
      for (const op of S.operations) { if (op.status === "CANCELLED") continue; const pid = opPartnerId(op); if (!pid) continue; const s = stats.get(pid) || { n: 0, buy: 0, sell: 0, last: "" }; s.n++; s.buy += op.type === "ZAKUP" ? op.totals.purchaseCost : 0; s.sell += op.totals.revenue; if (op.date > s.last) s.last = op.date; stats.set(pid, s); }
      const q = f.q.trim().toLowerCase();
      const rows = S.partners.filter(p => (!f.role || p.role === f.role || p.role === "both") && (f.show === "all" || p.active !== false) && (!q || [p.name, p.city, p.nip].join(" ").toLowerCase().includes(q)));
      return `<div class="page-head"><div class="titles"><h2>${th("Kontrahenci")}</h2><p>${th("Dostawcy i odbiorcy z obrotem (bez dokumentów anulowanych). Kliknij „Raport”, aby zobaczyć raport roczny z filtrem kontrahenta.")}</p></div>
          <div class="actions">${addBtn("partners", N_("Nowy kontrahent"))}</div></div>
        <div class="card"><div class="toolbar"><div class="field"><label for="pa-role">${th("Rola")}</label><select class="ctrl" id="pa-role"><option value="">${th("Wszyscy")}</option><option value="supplier" ${f.role === "supplier" ? "selected" : ""}>${th("Dostawcy")}</option><option value="buyer" ${f.role === "buyer" ? "selected" : ""}>${th("Odbiorcy")}</option></select></div>
          <div class="field"><label for="pa-show">${th("Status")}</label><select class="ctrl" id="pa-show"><option value="active" ${f.show === "active" ? "selected" : ""}>${th("aktywni")}</option><option value="all" ${f.show === "all" ? "selected" : ""}>${th("wszyscy")}</option></select></div>
          <div class="field grow"><label for="pa-q">${th("Szukaj")}</label><input class="ctrl" type="search" id="pa-q" value="${esc(f.q)}" placeholder="${th("nazwa, miejscowość, NIP…")}"></div></div>
          <div class="tbl-wrap"><table class="tbl" id="partners-table"><thead><tr><th>${th("Nazwa")}</th><th>${th("Rola")}</th><th>${th("Grupa dostawcy")}</th><th>${th("Miejscowość")}</th><th>NIP</th><th class="r">${th("Operacje")}</th><th class="r">${th("Zakupy")}</th><th class="r">${th("Sprzedaż")}</th><th>${th("Ostatnia operacja")}</th><th></th></tr></thead><tbody>
            ${rows.map(p => { const s = stats.get(p.id) || { n: 0, buy: 0, sell: 0, last: "" }; return `<tr class="${p.active === false ? "void" : ""}"><td><b>${esc(p.name)}</b></td><td>${esc(t(R.PARTNER_ROLES[p.role]))}</td><td>${p.role === "buyer" ? "—" : esc(t(R.SUPPLIER_KINDS[R.partnerKind(p)].label))}${p.lesnictwa && p.lesnictwa.length ? `<br><small class="dim">${esc(t("leśnictwa: {x}", { x: p.lesnictwa.join(", ") }))}</small>` : ""}${p.createdBy ? `<br><small class="dim">${esc(t("dodał: {u}", { u: p.createdBy }))}</small>` : ""}</td><td>${esc(p.city || "")}</td><td class="mono">${esc(p.nip || "")}</td><td class="r">${s.n}</td><td class="r">${esc(money(s.buy))}</td><td class="r">${esc(money(s.sell))}</td><td>${esc(Dates.pl(s.last) || "—")}</td><td class="r nowrap"><button class="btn sm" type="button" data-prep="${esc(p.id)}">${th("Raport")}</button> ${editBtn("partners", p.id)}</td></tr>`; }).join("")}</tbody></table></div></div>`;
    },
    bind(page) {
      const f = App.tabs.partners;
      $("#pa-role", page).onchange = e => { f.role = e.target.value; App.render(); };
      $("#pa-show", page).onchange = e => { f.show = e.target.value; App.render(); };
      $("#pa-q", page).oninput = e => { f.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => { App.render(); const x = $("#pa-q"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); };
      $$("[data-prep]", page).forEach(b => b.onclick = () => { const rf = root.RIWViews.Reports.f(); rf.partnerId = b.dataset.prep; rf.mode = "year"; rf.year = App.today().slice(0, 4); App.go("raporty"); });
      bindMaster(page);
    }
  };

  Views.magazyny = {
    html() {
      const S = Store.state;
      return `<div class="page-head"><div class="titles"><h2>${th("Magazyny")}</h2><p>${th("Magazyny firmy z przypisanymi kierownikami, magazynierami i flotą, stanem i zamkniętymi okresami. Ludzi przydziela się w module Użytkownicy, pojazdy i rębaki — w module Flota.")}</p></div>
          <div class="actions">${addBtn("warehouses", N_("Nowy magazyn"))}</div></div>
        <div class="grid g2">${S.warehouses.map(w => {
          const m = Stock.byProduct(S, w.id), per = {};
          for (const [pid, q] of m) { const p = App.product(pid); if (Math.abs(q) > R.EPS) per[p.unit] = R.rq((per[p.unit] || 0) + q); }
          return `<div class="card" data-wh="${esc(w.id)}"><div class="card-h"><h3>${esc(w.name)}</h3><span class="sub">${esc(w.code)}</span>${activeBadge(w.active)}<span class="spacer"></span>${editBtn("warehouses", w.id)}</div><div class="card-b">
            <dl class="money-list"><dt>${th("Adres")}</dt><dd>${esc(w.address || "")}</dd><dt>${th("Stan wg jednostek")}</dt><dd>${esc(Object.entries(per).map(([u, q]) => `${fmtQ(q)} ${Units.label(u)}`).join(" · ") || "—")}</dd>
            <dt>${th("Zamknięte do")}</dt><dd>${esc(R.lockedMonth(S, w.id) || "—")}</dd>${["kierownik", "magazynier", "obserwator", "admin"].map(r => { const us = S.users.filter(u => u.role === r && R.statusOf(u) === "ACTIVE" && (R.whAccess(u) || [u.whId]).includes(w.id)); return us.length ? `<dt>${esc(t(R.ROLES[r].label))}</dt><dd>${esc(us.map(u => u.name).join(", "))}</dd>` : ""; }).join("")}
            <dt>${th("Pojazdy")}</dt><dd>${esc(S.fleet.vehicles.filter(v => v.whId === w.id).map(v => `${v.reg}`).join(", ") || "—")}</dd>
            <dt>${th("Kierowcy")}</dt><dd>${esc(S.fleet.drivers.filter(v => v.whId === w.id).map(v => v.name).join(", ") || "—")}</dd>
            <dt>${th("Rębaki i operatorzy")}</dt><dd>${esc(S.fleet.chippers.filter(v => v.whId === w.id).map(v => v.name).concat(S.fleet.operators.filter(v => v.whId === w.id).map(v => v.name)).join(", ") || "—")}</dd>
            <dt>${th("Operacje")}</dt><dd>${S.operations.filter(o => o.whId === w.id).length}</dd></dl></div></div>`; }).join("")}</div>`;
    },
    bind(page) { bindMaster(page); }
  };

  /* ================================================================== */
  /* Użytkownicy                                                          */
  /* ================================================================== */
  const ST_BADGE = { ACTIVE: "ok", INVITED: "info", SUSPENDED: "warn", DISABLED: "" };
  const statusChip = u => { const st = R.statusOf(u); return `<span class="badge ${ST_BADGE[st]}" data-ustatus="${st}">${esc(t(R.USER_STATUS[st]))}${u.selfRegistered && st === "INVITED" ? " · " + esc(t("rejestracja")) : ""}${u.emailUnverified ? " · " + esc(t("e-mail niepotwierdzony")) : ""}</span>`; };
  const roleChip = role => `<span class="badge role-${esc(role)}" title="${esc((R.ROLES[role] || {}).code || "")}">${esc(App.roleLabel(role))}</span>`;
  const whList = u => { const acc = R.whAccess(u); return acc === null ? t("wszystkie magazyny") : acc.map(App.whName).join(", "); };
  /** Wynik wysyłki e-mail → komunikat dla administratora. */
  const mailToast = (mail, okTitle, who) => {
    if (!mail) return;
    if (mail.ok) Toast.ok(okTitle, mail.transport === "file" ? t("{w} — poczta nieskonfigurowana: wiadomość zapisano w folderze serwera (mail-outbox).", { w: who }) : who);
    else Toast.err(t("E-mail nie został wysłany"), `${who}: ${mail.error} ${t("Konto pozostaje nieaktywne — użyj „Wyślij ponownie zaproszenie”.")}`);
  };
  const Users = {
    async accounts() {
      if (Store.mode === "server") return ServerBackend.accounts();
      const out = {}; for (const u of Store.state.users) out[u.id] = AuthLib.LocalAuth.info(u.id); return out;
    },
    /**
     * Dodawanie / edycja konta. FIRMOWY: nowe konto przez zaproszenie e-mail (albo hasło tymczasowe);
     * OFFLINE: hasło tymczasowe (brak poczty). Bez uprawnienia users.manage — podgląd.
     */
    edit(id, how = {}) {
      const S = Store.state, isNew = !id, srv = Store.mode === "server", manage = App.can("users.manage");
      const base = id ? R.clone(R.byId(S.users, id)) : null;
      if (id && !base) return Toast.err(t("Nie znaleziono użytkownika"));
      const rec = base || { firstName: "", lastName: "", email: "", role: "magazynier", whId: App.user().whId, warehouseIds: [App.user().whId], status: "ACTIVE", lang: "", phone: "" };
      if (!rec.firstName && !rec.lastName && rec.name) { const p = String(rec.name).split(/\s+/); rec.firstName = p[0]; rec.lastName = p.slice(1).join(" "); }
      const self = id === Store.userId, st = R.statusOf(rec), approving = !!(rec.selfRegistered && st === "INVITED" && how.approve);
      const ro = !manage ? "disabled" : "";
      const domains = (S.config.companyDomains || []).map(d => "@" + d).join(", ");
      const whs = S.warehouses.filter(w => w.active !== false || w.id === rec.whId || (rec.warehouseIds || []).includes(w.id));
      const statusOpts = [["ACTIVE", t(R.USER_STATUS.ACTIVE)], ["SUSPENDED", t(R.USER_STATUS.SUSPENDED)], ["DISABLED", t(R.USER_STATUS.DISABLED)]].concat(st === "INVITED" ? [["INVITED", t(R.USER_STATUS.INVITED)]] : []);
      const body = `<div class="fgrid">
        ${approving ? `<div class="span-all info-line">${ic("user", 15)}<span>${esc(t("Zgłoszenie z rejestracji ({d}). Nadaj rolę i magazyn — zapis ze statusem „aktywny” aktywuje konto.", { d: Dates.ts(rec.registeredAt) }))}</span></div>` : ""}
        ${ff("firstName", t("Imię"), `<input class="ctrl" id="me-firstName" value="${esc(rec.firstName || "")}" autocomplete="off" ${ro}>`)}
        ${ff("lastName", t("Nazwisko"), `<input class="ctrl" id="me-lastName" value="${esc(rec.lastName || "")}" autocomplete="off" ${ro}>`)}
        ${ff("email", t("E-mail służbowy (login)"), `<input class="ctrl" id="me-email" type="email" value="${esc(rec.email || rec.login || "")}" autocapitalize="off" spellcheck="false" autocomplete="off" placeholder="${esc(t("imie.nazwisko@resinvest.group"))}" ${ro}>`, (domains ? t("Dozwolone domeny: {d}", { d: domains }) : "") + (!isNew && srv ? " " + t("Zmiana adresu wymaga potwierdzenia linkiem z nowej skrzynki.") : ""), "span-all")}
        ${ff("role", t("Rola"), `<select class="ctrl" id="me-role" ${self || !manage ? "disabled" : ""}>${opts(Object.entries(R.ROLES).filter(([k]) => k !== "admin" || App.user().role === "admin" || rec.role === "admin").map(([k, v]) => [k, `${t(v.label)} (${v.code})`]), approving && rec.role === "obserwator" ? "magazynier" : rec.role)}</select>`, self ? t("Nie możesz zmienić własnej roli") : `<span data-role-help>${esc(t(R.ROLE_INFO[rec.role] || ""))}</span>`)}
        ${ff("whId", t("Magazyn domyślny"), `<select class="ctrl" id="me-whId" ${ro}>${opts(whs.map(w => [w.id, w.name]), rec.whId)}</select>`)}
        <div class="field span-all" data-ff="warehouseIds" id="me-whs-box"><label>${th("Dostępne magazyny")}</label><div class="row wrap">${whs.map(w => `<label class="inline-opt"><input type="checkbox" data-whacc="${esc(w.id)}" ${(rec.warehouseIds || []).includes(w.id) || w.id === rec.whId ? "checked" : ""} ${ro}> ${esc(w.name)}</label>`).join("")}</div>
          <div class="msg hidden" data-fmsg="warehouseIds"></div><div class="help" id="me-whs-help">${th("Dane pozostałych magazynów są dla tej osoby niewidoczne (izolacja po stronie serwera).")}</div></div>
        ${ff("phone", t("Telefon"), `<input class="ctrl" id="me-phone" type="tel" value="${esc(rec.phone || "")}" ${ro}>`)}
        ${ff("lang", t("Język interfejsu"), `<select class="ctrl" id="me-lang" ${ro}>${opts([["", t("wybór użytkownika / przeglądarki")]].concat(Object.values(I18N.LANGS).map(L => [L.code, L.label])), rec.lang)}</select>`)}
        ${isNew ? "" : ff("status", t("Status"), `<select class="ctrl" id="me-status" ${self || !manage ? "disabled" : ""}>${opts(statusOpts, approving ? "ACTIVE" : st)}</select>`, self ? t("Nie możesz zablokować ani dezaktywować własnego konta") : t("Zawieszone i dezaktywowane konto nie loguje się; historia operacji zostaje."))}
        ${isNew ? `<div class="span-all">${srv ? `<h4 class="mini-h">${th("Sposób aktywacji")}</h4>
            <label class="inline-opt"><input type="radio" name="me-how" value="invite" checked> ${th("Wyślij zaproszenie e-mail — pracownik sam ustawi hasło (zalecane)")}</label><br>
            <label class="inline-opt"><input type="radio" name="me-how" value="password"> ${th("Ustaw hasło tymczasowe (zmiana przy pierwszym logowaniu)")}</label>`
            : `<h4 class="mini-h">${th("Hasło tymczasowe")}</h4><p class="help">${th("Tryb OFFLINE: bez poczty — przekaż hasło osobiście; użytkownik zmieni je przy pierwszym logowaniu.")}</p>`}</div>
          <div class="span-all fgrid ${srv ? "hidden" : ""}" id="me-pw-box"><div data-ff="password">${pwField("me-pw", t("Hasło"), "new-password")}${pwMeter("me-pw-meter")}<div class="msg hidden" data-fmsg="password"></div></div>
          <div>${pwField("me-pw2", t("Powtórz hasło"), "new-password")}</div></div>` : ""}
      </div>`;
      const title = isNew ? t("Dodaj użytkownika") : approving ? t("Zatwierdzenie rejestracji: {l}", { l: rec.login }) : manage ? t("Edycja użytkownika {l}", { l: rec.login }) : t("Użytkownik {l}", { l: rec.login });
      const saveLabel = isNew ? (srv ? t("Wyślij zaproszenie") : t("Utwórz konto")) : approving ? t("Zatwierdź i aktywuj") : t("Zapisz");
      const m = Modal.open({ title, id: "user-edit", wide: true, body,
        footer: `<button class="btn ghost" type="button" data-no>${manage ? th("Anuluj") : th("Zamknij")}</button>${manage ? `<button class="btn primary" type="button" data-yes>${ic(isNew && srv ? "up" : "check", 15)} <span data-yes-label>${esc(saveLabel)}</span></button>` : ""}` });
      bindEyes(m.el);
      const pw = $("#me-pw", m.el); if (pw) bindMeter(pw, $("#me-pw-meter", m.el));
      const rl = $("#me-role", m.el), wh = $("#me-whId", m.el);
      // zmiana magazynu domyślnego przenosi dostęp: poprzedni domyślny odznaczany, chyba że administrator zaznaczył go ręcznie
      const manual = new Set(); let prevWh = wh.value;
      $$("[data-whacc]", m.el).forEach(x => x.addEventListener("change", () => manual.add(x.dataset.whacc)));
      const sync = () => {
        const global = (R.ROLES[rl.value] || {}).global;
        $("#me-whs-box", m.el).classList.toggle("hidden", !!global);
        if (prevWh !== wh.value) { const old = $(`[data-whacc="${prevWh}"]`, m.el); if (old && !manual.has(prevWh)) old.checked = false; prevWh = wh.value; }
        const cb = $(`[data-whacc="${wh.value}"]`, m.el); if (cb) { cb.checked = true; }
        $$("[data-whacc]", m.el).forEach(x => { x.disabled = !manage || x.dataset.whacc === wh.value; });
        const h = $("[data-role-help]", m.el); if (h) h.textContent = t(R.ROLE_INFO[rl.value] || "");
      };
      rl.onchange = sync; wh.onchange = sync; sync();
      $$("[name=me-how]", m.el).forEach(r => r.onchange = () => {
        const byPw = $("[name=me-how]:checked", m.el).value === "password";
        $("#me-pw-box", m.el).classList.toggle("hidden", !byPw);
        $("[data-yes-label]", m.el).textContent = byPw ? t("Utwórz konto") : t("Wyślij zaproszenie");
      });
      $("[data-no]", m.el).onclick = () => m.close();
      const yes = $("[data-yes]", m.el);
      if (yes) yes.onclick = async () => {
        const email = $("#me-email", m.el).value.trim().toLowerCase();
        const next = Object.assign({}, isNew ? {} : rec, { firstName: $("#me-firstName", m.el).value.trim(), lastName: $("#me-lastName", m.el).value.trim(), email, login: email, role: rl.value, whId: wh.value,
          warehouseIds: $$("[data-whacc]", m.el).filter(x => x.checked).map(x => x.dataset.whacc), lang: $("#me-lang", m.el).value, phone: $("#me-phone", m.el).value });
        delete next.name;
        if (!isNew) { next.status = $("#me-status", m.el).value; delete next.active; }
        yes.disabled = true;
        let res, mail = null;
        try {
          if (isNew && srv && $("[name=me-how]:checked", m.el).value === "invite") {
            const r = await ServerBackend.invite(next);
            res = r.res || r; mail = r.mail;
          } else if (isNew) {
            const p1 = $("#me-pw", m.el).value;
            if (p1 !== $("#me-pw2", m.el).value) { showErrors(m, { errors: { password: t("Hasła nie są takie same") } }); return; }
            res = await Store.backend.createUser(Object.assign(next, { status: "ACTIVE" }), p1);
          } else res = await Store.exec("user.save", { rec: next }, SRC_USERS);
        } finally { yes.disabled = false; }
        if (!res || !res.ok) { showErrors(m, res || {}); Toast.err(t("Nie zapisano"), (res && res.error) || ""); return; }
        m.close();
        const who = res.rec ? `${res.rec.name} (${res.rec.login})` : "";
        if (mail) mailToast(mail, t("Zaproszenie wysłane"), who);
        else Toast.ok(isNew ? t("Utworzono konto") : approving ? t("Konto aktywowane") : t("Zapisano"), who);
        App.render();
      };
      if (manage) $("#me-firstName", m.el).focus();
    },
    /** Szybka zmiana statusu z tabeli (aktywuj / zawieś / dezaktywuj). */
    async setStatus(id, status) {
      const u = R.byId(Store.state.users, id);
      const txt = { ACTIVE: t("Aktywować konto {l}?", { l: u.login }), SUSPENDED: t("Zawiesić konto {l}? Logowanie zostanie zablokowane do czasu ponownej aktywacji.", { l: u.login }), DISABLED: t("Dezaktywować konto {l}? Użytkownik zostanie wylogowany; historia operacji zostaje.", { l: u.login }) }[status];
      const r = await Modal.confirm({ title: t("Status konta"), text: txt, ok: { ACTIVE: t("Aktywuj"), SUSPENDED: t("Zawieś"), DISABLED: t("Dezaktywuj") }[status], danger: status !== "ACTIVE" });
      if (!r.ok) return;
      const res = await Store.exec("user.save", { rec: Object.assign({}, u, { status }) }, SRC_USERS);
      if (!res.ok) return Toast.err(t("Nie zapisano"), res.error);
      Toast.ok(t("Status konta: {s}", { s: t(R.USER_STATUS[status]) }), u.login); App.render();
    },
    async resend(id) {
      const u = R.byId(Store.state.users, id);
      const r = await ServerBackend.resendInvite(id);
      if (!r || !r.ok) return Toast.err(t("Nie wysłano"), r && r.error);
      mailToast(r.mail, u.emailUnverified ? t("Wysłano prośbę o potwierdzenie adresu") : t("Zaproszenie wysłane ponownie"), u.login); App.render();
    },
    async resetLink(id) {
      const u = R.byId(Store.state.users, id);
      const c = await Modal.confirm({ title: t("Reset hasła"), text: t("Wysłać do {l} link do ustawienia nowego hasła (ważny 1 godzinę)? Obecne hasło działa do czasu jego zmiany.", { l: u.login }), ok: t("Wyślij link") });
      if (!c.ok) return;
      const r = await ServerBackend.sendResetLink(id);
      if (!r || !r.ok) return Toast.err(t("Nie wysłano"), r && r.error);
      mailToast(r.mail, t("Wysłano link do resetu hasła"), u.login);
    },
    async remove(id) {
      const u = R.byId(Store.state.users, id), req = u.selfRegistered && R.statusOf(u) === "INVITED";
      const r = await Modal.confirm({ title: req ? t("Odrzucić zgłoszenie {l}?", { l: u.login }) : t("Usunąć konto {l}?", { l: u.login }), text: req ? t("Zgłoszenie i hasło zostaną usunięte. Osoba może zarejestrować się ponownie.") : t("Usunąć można tylko konto bez historii (np. zaproszenie wysłane omyłkowo). Konto z historią dezaktywuj — historia zostaje."), ok: req ? t("Odrzuć zgłoszenie") : t("Usuń konto"), danger: true });
      if (!r.ok) return;
      const res = await Store.backend.removeUser(id);
      if (!res || !res.ok) return Toast.err(t("Nie usunięto"), res && res.error);
      Toast.ok(req ? t("Zgłoszenie odrzucone") : t("Konto usunięte"), u.login); App.render();
    },
    resetPassword(id) {
      const u = R.byId(Store.state.users, id);
      const m = Modal.open({ title: t("Nowe hasło: {n}", { n: u.name }), id: "pw-reset",
        body: `<div class="stack">${pwField("rp-pw", t("Nowe hasło"), "new-password")}${pwMeter("rp-meter")}${pwField("rp-pw2", t("Powtórz hasło"), "new-password")}
          <label class="inline-opt"><input type="checkbox" id="rp-must" checked> ${th("Wymuś zmianę hasła przy następnym logowaniu")}</label><div class="msg hidden" id="rp-msg"></div></div>`,
        footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" data-yes>${th("Ustaw hasło")}</button>` });
      bindEyes(m.el); bindMeter($("#rp-pw", m.el), $("#rp-meter", m.el));
      $("[data-no]", m.el).onclick = () => m.close();
      $("[data-yes]", m.el).onclick = async () => {
        const msg = $("#rp-msg", m.el), fail = x => { msg.textContent = x; msg.classList.remove("hidden"); };
        if ($("#rp-pw", m.el).value.trim() !== $("#rp-pw2", m.el).value.trim()) return fail(t("Hasła nie są takie same"));
        const r = await Store.backend.setPassword(id, $("#rp-pw", m.el).value.trim(), $("#rp-must", m.el).checked);
        if (!r || !r.ok) return fail((r && r.error) || t("Nie udało się ustawić hasła"));
        m.close(); Toast.ok(t("Hasło ustawione"), u.login); App.render();
      };
    }
  };
  Views.uzytkownicy = {
    html() {
      const S = Store.state, f = App.tabs.users || (App.tabs.users = { wh: "", role: "", status: "", q: "" }), manage = App.can("users.manage"), srv = Store.mode === "server";
      const reqs = S.users.filter(u => u.selfRegistered && R.statusOf(u) === "INVITED");
      const list = S.users.filter(u => !(u.selfRegistered && R.statusOf(u) === "INVITED") && (!f.wh || R.canAccessWh(u, f.wh)) && (!f.role || u.role === f.role) && (!f.status || R.statusOf(u) === f.status)
        && (!f.q || `${u.name} ${u.login} ${u.phone || ""}`.toLowerCase().includes(f.q.toLowerCase())))
        .sort((a, b) => (a.whId + a.role + a.name).localeCompare(b.whId + b.role + b.name));
      const act = u => {
        if (!manage) return `<button class="btn sm" type="button" data-uedit="${esc(u.id)}">${th("Szczegóły")}</button>`;
        const st = R.statusOf(u), self = u.id === Store.userId, b = [];
        b.push(`<button class="btn sm" type="button" data-uedit="${esc(u.id)}">${ic("edit", 13)} ${th("Edytuj")}</button>`);
        if (!self && st !== "ACTIVE" && st !== "INVITED") b.push(`<button class="btn sm" type="button" data-ustat="${esc(u.id)}|ACTIVE">${th("Aktywuj")}</button>`);
        if (!self && st === "ACTIVE") b.push(`<button class="btn sm" type="button" data-ustat="${esc(u.id)}|SUSPENDED">${th("Zawieś")}</button>`, `<button class="btn sm danger" type="button" data-ustat="${esc(u.id)}|DISABLED">${th("Dezaktywuj")}</button>`);
        if (srv && (st === "INVITED" || u.emailUnverified)) b.push(`<button class="btn sm" type="button" data-uresend="${esc(u.id)}">${ic("up", 13)} ${th("Wyślij ponownie zaproszenie")}</button>`);
        if (srv && st === "ACTIVE") b.push(`<button class="btn sm icon" type="button" data-ulink="${esc(u.id)}" title="${esc(t("Reset hasła (link e-mail)"))}" aria-label="${esc(t("Reset hasła (link e-mail)"))}">${ic("key", 14)}</button>`);
        if (st !== "INVITED") b.push(`<button class="btn sm icon" type="button" data-upw="${esc(u.id)}" title="${esc(t("Ustaw hasło tymczasowe"))}" aria-label="${esc(t("Ustaw hasło tymczasowe"))}">${ic("lock", 14)}</button>`);
        b.push(`<button class="btn sm icon hidden" type="button" data-unlock="${esc(u.id)}" title="${esc(t("Odblokuj"))}" aria-label="${esc(t("Odblokuj"))}">${ic("check", 14)}</button>`);
        b.push(`<a class="btn sm icon" href="#/audyt?user=${esc(u.id)}" title="${esc(t("Zobacz historię"))}" aria-label="${esc(t("Zobacz historię"))}">${ic("clock", 14)}</a>`);
        if (!self && st === "INVITED") b.push(`<button class="btn sm icon danger" type="button" data-udel="${esc(u.id)}" title="${esc(t("Usuń konto"))}" aria-label="${esc(t("Usuń konto"))}">${ic("trash", 14)}</button>`);
        return b.join(" ");
      };
      const row = u => `<tr data-user="${esc(u.id)}" class="${R.statusOf(u) === "DISABLED" ? "void" : ""}"><td><div class="row"><span class="avatar">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b>${u.phone ? `<br><small class="dim">${esc(u.phone)}</small>` : ""}</div></div></td><td class="mono small">${esc(u.login)}</td><td>${roleChip(u.role)}</td><td>${esc(App.whName(u.whId))}${(R.whAccess(u) || []).length > 1 || R.whAccess(u) === null ? `<br><small class="dim">${esc(whList(u))}</small>` : ""}</td><td>${statusChip(u)}<div data-acc="${esc(u.id)}"></div></td><td data-last="${esc(u.id)}">—</td>
            <td class="r"><div class="row wrap" style="justify-content:flex-end;gap:4px">${act(u)}</div></td></tr>`;
      return `<div class="page-head"><div class="titles"><h2>${th("Użytkownicy")}</h2><p>${th("Konta pracowników (logowanie e-mailem służbowym), role, magazyn domyślny i dostępne magazyny, statusy. Nowego pracownika dodaje się zaproszeniem e-mail. Konto z historią dezaktywuje się — historia zostaje.")}</p></div>
          <div class="actions">${manage ? `<button class="btn primary" type="button" id="user-add">${ic("plus", 15)} ${th("Dodaj użytkownika")}</button>` : `<span class="badge">${th("tylko podgląd")}</span>`}<a class="btn" href="#/role">${ic("shield", 15)} ${th("Role i uprawnienia")}</a></div></div>
        ${reqs.length && manage ? `<div class="card mb4 queue-card" id="reg-requests"><div class="card-h"><h3>${ic("user", 16)} ${th("Zgłoszenia rejestracji")}</h3><span class="sub">${esc(t("konta oczekujące na nadanie roli i magazynu"))}</span></div><div class="tbl-wrap"><table class="tbl" id="reg-table"><thead><tr><th>${th("Imię i nazwisko")}</th><th>${th("E-mail")}</th><th>${th("Telefon")}</th><th>${th("Zgłoszono")}</th><th></th></tr></thead><tbody>
          ${reqs.map(u => `<tr data-reg="${esc(u.id)}"><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.login)}${srv ? (u.emailUnverified ? ` <span class="badge warn" data-unverified>${th("e-mail niepotwierdzony")}</span>` : ` <span class="badge ok">${th("e-mail potwierdzony")}</span>`) : ""}</td><td>${esc(u.phone || "—")}</td><td>${esc(Dates.ts(u.registeredAt))}</td><td class="r nowrap"><button class="btn sm primary" type="button" data-uapprove="${esc(u.id)}" ${srv && u.emailUnverified ? `disabled title="${th("Czeka na potwierdzenie adresu e-mail")}"` : ""}>${ic("check", 13)} ${th("Nadaj rolę i aktywuj")}</button>${srv && u.emailUnverified ? ` <button class="btn sm" type="button" data-uresend="${esc(u.id)}">${ic("up", 13)} ${th("Wyślij link ponownie")}</button>` : ""} <button class="btn sm danger" type="button" data-udel="${esc(u.id)}">${ic("x", 13)} ${th("Odrzuć")}</button></td></tr>`).join("")}</tbody></table></div></div>` : ""}
        <div class="card"><div class="toolbar">
          <div class="field"><label for="uf-wh">${th("Magazyn")}</label><select class="ctrl" id="uf-wh"><option value="">${th("Wszystkie")}</option>${S.warehouses.map(w => `<option value="${esc(w.id)}" ${f.wh === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="uf-role">${th("Rola")}</label><select class="ctrl" id="uf-role"><option value="">${th("Wszystkie")}</option>${Object.entries(R.ROLES).map(([k, v]) => `<option value="${k}" ${f.role === k ? "selected" : ""}>${esc(t(v.label))}</option>`).join("")}</select></div>
          <div class="field"><label for="uf-status">${th("Status")}</label><select class="ctrl" id="uf-status"><option value="">${th("Wszystkie")}</option>${Object.entries(R.USER_STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${esc(t(v))}</option>`).join("")}</select></div>
          ${searchInput("uf-q", f.q, t("nazwisko, e-mail, telefon…"))}</div>
          <div class="tbl-wrap"><table class="tbl" id="users-table"><thead><tr><th>${th("Użytkownik")}</th><th>${th("E-mail")}</th><th>${th("Rola")}</th><th>${th("Magazyn")}</th><th>${th("Status")}</th><th>${th("Ostatnie logowanie")}</th><th class="r">${th("Akcje")}</th></tr></thead>
          <tbody id="users-body">${list.map(row).join("") || `<tr><td colspan="7" class="empty">${th("Brak wpisów.")}</td></tr>`}</tbody></table></div></div>
        <p class="help mt3">${esc(srv ? t("Tryb FIRMOWY: zaproszenia, reset hasła i potwierdzenie adresu wysyła serwer (e-mail). Link zaproszenia jest ważny 72 h, resetu — 1 h; każdy działa jednorazowo.") : t("Tryb OFFLINE: bez poczty — administrator ustawia hasło tymczasowe, użytkownik zmienia je przy pierwszym logowaniu."))}</p>`;
    },
    async bind(page, params) {
      const add = $("#user-add", page); if (add) add.onclick = () => Users.edit(null);
      const f = App.tabs.users;
      const on = (sel, k) => { const el = $(sel, page); if (el) el.onchange = e => { f[k] = e.target.value; App.render(); }; };
      on("#uf-wh", "wh"); on("#uf-role", "role"); on("#uf-status", "status");
      bindSearch(page, "#uf-q", f, "q", this);
      $$("[data-uapprove]", page).forEach(b => b.onclick = () => Users.edit(b.dataset.uapprove, { approve: true }));
      $$("[data-udel]", page).forEach(b => b.onclick = () => Users.remove(b.dataset.udel));
      $$("[data-uedit]", page).forEach(b => b.onclick = () => Users.edit(b.dataset.uedit));
      $$("[data-ustat]", page).forEach(b => b.onclick = () => { const [id, st] = b.dataset.ustat.split("|"); Users.setStatus(id, st); });
      $$("[data-uresend]", page).forEach(b => b.onclick = () => Users.resend(b.dataset.uresend));
      $$("[data-ulink]", page).forEach(b => b.onclick = () => Users.resetLink(b.dataset.ulink));
      $$("[data-upw]", page).forEach(b => b.onclick = () => Users.resetPassword(b.dataset.upw));
      $$("[data-unlock]", page).forEach(b => b.onclick = async () => { const r = await Store.backend.unlock(b.dataset.unlock); if (r && r.ok) { Toast.ok(t("Konto odblokowane")); App.render(); } else Toast.err(t("Nie odblokowano"), r && r.error); });
      if (params && params.id && this._opened !== params.id) { this._opened = params.id; Users.edit(params.id); }
      if (!params || !params.id) this._opened = null;
      const acc = await Users.accounts();
      for (const u of Store.state.users) {
        const a = acc[u.id] || { hasPassword: false }, cell = $(`[data-acc="${u.id}"]`, page), last = $(`[data-last="${u.id}"]`, page);
        if (!cell) continue;
        const locked = a.lockedUntil && Date.parse(a.lockedUntil) > Date.now(), st = R.statusOf(u);
        const tag = st === "INVITED" ? (a.invite ? (a.invite.expired ? `<span class="badge warn">${th("zaproszenie wygasło")}</span>` : `<small class="dim">${esc(t("zaproszenie ważne do {d}", { d: Dates.ts(a.invite.expiresAt) }))}</small>`) : Store.mode === "server" && !u.selfRegistered ? `<span class="badge warn">${th("zaproszenie niewysłane")}</span>` : "")
          : !a.hasPassword && App.can("users.manage") ? `<span class="badge warn">${th("brak hasła")}</span>` : locked ? `<span class="badge err">${th("zablokowane")}</span>` : a.mustChange ? `<small class="dim">${th("hasło do zmiany")}</small>` : a.demo ? `<small class="dim">${th("hasło demonstracyjne")}</small>` : "";
        cell.innerHTML = tag;
        if (last) last.textContent = a.lastLogin ? Dates.ts(a.lastLogin) : "—";
        const ub = $(`[data-unlock="${u.id}"]`, page); if (ub) ub.classList.toggle("hidden", !locked);
      }
    }
  };

  /* ================================================================== */
  /* Role i uprawnienia                                                   */
  /* ================================================================== */
  const PERM_GROUPS = [
    [N_("Operacje"), ["receipts.create", "issues.create", "production.create", "mm.create", "mm.receive", "op.approve"]],
    [N_("Korekty i anulowania"), ["documents.cancel", "documents.correct", "purchases.correct", "sales.correct", "production.correct", "inventory.correct"]],
    [N_("Inwentaryzacja"), ["inv.open", "inv.count", "inv.close"]],
    [N_("Kartoteki"), ["fleet.edit", "master.edit", "warehouses.edit"]],
    [N_("Odczyt i raporty"), ["report.view", "reports.export", "history.read", "audit.read"]],
    [N_("Administracja"), ["users.read", "users.manage", "roles.assign", "settings.edit", "data.backup", "data.import"]]
  ];
  Views.role = {
    html() {
      const S = Store.state, edit = App.can("roles.assign");
      const cnt = k => S.users.filter(u => u.role === k && R.statusOf(u) === "ACTIVE").length;
      const card = ([k, v]) => {
        const perms = R.permsOf(k), custom = Array.isArray((S.rolePerms || {})[k]), locked = k === "admin" || !edit;
        return `<div class="card" data-role-card="${k}"><div class="card-h"><h3>${roleChip(k)} <span class="mono small">${esc(v.code)}</span></h3><span class="sub">${esc(v.global ? t("wszystkie magazyny") : t("przydzielone magazyny"))} · ${esc(tp("{n} osoba|{n} osoby|{n} osób", cnt(k)))}${custom ? " · " + esc(t("zmienione przez administratora")) : ""}</span></div>
          <div class="card-b"><p class="muted">${esc(t(R.ROLE_INFO[k]))}</p>
          ${k === "admin" ? `<div class="info-line">${ic("shield", 15)}<span>${th("ADMINISTRATOR ma zawsze pełne uprawnienia. Rolę nadaje i odbiera wyłącznie administrator; ostatniego aktywnego administratora nie można zdegradować ani dezaktywować.")}</span></div>`
          : `<div class="perm-groups">${PERM_GROUPS.map(([g, list]) => `<fieldset class="perm-group"><legend>${esc(t(g))}</legend>${list.map(p => `<label class="inline-opt" title="${esc(p)}"><input type="checkbox" data-perm="${k}|${p}" ${perms.includes(p) ? "checked" : ""} ${locked ? "disabled" : ""}> ${esc(t(R.PERMS[p]))}</label>`).join("")}</fieldset>`).join("")}</div>
          ${edit ? `<div class="row wrap mt3"><button class="btn primary sm" type="button" data-rsave="${k}">${ic("check", 13)} ${th("Zapisz uprawnienia")}</button>${custom ? `<button class="btn sm" type="button" data-rreset="${k}">${th("Przywróć domyślne")}</button>` : ""}</div>` : ""}`}</div></div>`;
      };
      return `<div class="page-head"><div class="titles"><h2>${th("Role i uprawnienia")}</h2><p>${th("Uprawnienia są sprawdzane na serwerze przy każdej komendzie — ukrycie przycisku nie jest zabezpieczeniem. Zmiana zestawu uprawnień roli obowiązuje od razu dla wszystkich jej użytkowników i trafia do dziennika audytu.")}</p></div>
          <div class="actions"><a class="btn" href="#/uzytkownicy">${ic("users", 15)} ${th("Użytkownicy")}</a></div></div>
        <div class="grid g2" id="roles-grid">${Object.entries(R.ROLES).map(card).join("")}</div>
        <div class="card mt4" id="permissions"><div class="card-h"><h3>${th("Macierz uprawnień")}</h3><span class="sub">${th("stan bieżący (z uwzględnieniem zmian administratora)")}</span></div><div class="tbl-wrap"><table class="tbl" id="perm-table"><thead><tr><th>${th("Uprawnienie")}</th>${Object.values(R.ROLES).map(r => `<th class="c">${esc(t(r.label))}<br><small class="dim mono">${esc(r.code)}</small></th>`).join("")}</tr></thead><tbody>
          ${Object.keys(R.PERMS).map(p => `<tr><td><span class="mono">${esc(p)}</span><br><small class="dim">${esc(t(R.PERMS[p]))}</small></td>${Object.keys(R.ROLES).map(k => `<td class="c">${R.can({ role: k }, p) ? `<span class="badge ok">${ic("check", 12)}</span>` : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    },
    bind(page) {
      $$("[data-rsave]", page).forEach(b => b.onclick = async () => {
        const role = b.dataset.rsave, perms = $$(`[data-perm^="${role}|"]`, page).filter(x => x.checked).map(x => x.dataset.perm.split("|")[1]);
        const res = await Store.exec("roles.save", { role, perms }, N_("Administracja — role"));
        if (!res.ok) return Toast.err(t("Nie zapisano"), res.error);
        Toast.ok(res.unchanged ? t("Bez zmian") : t("Zapisano uprawnienia roli {r}", { r: R.ROLES[role].code })); App.render();
      });
      $$("[data-rreset]", page).forEach(b => b.onclick = async () => {
        const res = await Store.exec("roles.reset", { role: b.dataset.rreset }, N_("Administracja — role"));
        if (!res.ok) return Toast.err(t("Nie zapisano"), res.error);
        Toast.ok(t("Przywrócono domyślne uprawnienia")); App.render();
      });
    }
  };

  /* ================================================================== */
  /* Dziennik audytu (administrator, audytor)                             */
  /* ================================================================== */
  Views.audyt = {
    extra: null,
    f(params) {
      const f = App.tabs.audit || (App.tabs.audit = { tab: "events", from: Dates.addDays(App.today(), -30), to: "", code: "", user: "", wh: "", q: "", limit: 300 });
      if (params && params.user && f._u !== params.user) { f.user = params.user; f._u = params.user; f.from = "2000-01-01"; }
      return f;
    },
    rows() {
      const S = Store.state, f = this.f(), q = f.q.trim().toLowerCase();
      return S.audit.filter(a => (!f.from || a.ts.slice(0, 10) >= f.from) && (!f.to || a.ts.slice(0, 10) <= f.to) && (!f.code || a.code === f.code) && (!f.user || a.userId === f.user || a.entityId === f.user) && (!f.wh || a.whId === f.wh) &&
        (!q || [a.code, R.auditText(a), a.source, a.opNo, a.userName, a.ip, a.ua, a.reason].join(" ").toLowerCase().includes(q))).slice().sort((a, b) => a.ts < b.ts ? 1 : -1);
    },
    html(params) {
      const S = Store.state, f = this.f(params), srv = Store.mode === "server";
      const codes = [...new Set(S.audit.map(a => a.code).filter(Boolean))].sort();
      const tabs = [["events", t("Zdarzenia")], ["logins", t("Logowania")]].concat(srv ? [["mail", t("Wiadomości e-mail")]] : []);
      const sel = (id, label, list, v) => `<div class="field"><label for="${id}">${esc(label)}</label><select class="ctrl" id="${id}">${list.map(([k, l]) => `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
      let body = "";
      if (f.tab === "events") {
        const rows = this.rows(), shown = rows.slice(0, f.limit);
        body = `<div class="toolbar">
            <div class="field"><label for="au-from">${th("Od")}</label><input class="ctrl" type="date" id="au-from" value="${esc(f.from)}"></div>
            <div class="field"><label for="au-to">${th("Do")}</label><input class="ctrl" type="date" id="au-to" value="${esc(f.to)}"></div>
            ${sel("au-code", t("Zdarzenie"), [["", t("Wszystkie")]].concat(codes.map(c => [c, c])), f.code)}
            ${sel("au-user", t("Użytkownik"), [["", t("Wszyscy")], ["system", t("System")]].concat(S.users.map(u => [u.id, u.name])), f.user)}
            ${sel("au-wh", t("Magazyn"), [["", t("Wszystkie")]].concat(S.warehouses.map(w => [w.id, w.name])), f.wh)}
            ${searchInput("au-q", f.q, t("kod, akcja, IP, przeglądarka…"))}
            ${App.can("reports.export") || App.can("audit.read") ? `<button class="btn" type="button" id="au-csv">${ic("dl", 15)} CSV</button>` : ""}</div>
          ${shown.length ? `<div class="tbl-wrap"><table class="tbl dense" id="audit-admin-table"><thead><tr><th>${th("Czas")}</th><th>${th("Kto")}</th><th>${th("Zdarzenie")}</th><th>${th("Akcja")}</th><th>${th("Obiekt")}</th><th>${th("Magazyn")}</th><th>${th("Adres IP")}</th><th>${th("Przeglądarka")}</th><th>${th("Przed / po")}</th></tr></thead><tbody>
            ${shown.map(a => `<tr><td class="nowrap">${esc(Dates.ts(a.ts, true))}</td><td>${esc(a.userName === "System" ? t("System") : a.userName)}</td><td>${a.code ? `<span class="badge mono">${esc(a.code)}</span>` : `<small class="dim">${esc(a.entity || "")}</small>`}</td><td>${esc(R.auditText(a))}${a.reason ? `<br><small class="dim">${esc(t("powód: {r}", { r: R.trReason(a.reason) }))}</small>` : ""}</td><td class="mono small">${esc(a.opNo || a.entityId || "")}</td><td>${esc(a.whId ? App.whName(a.whId) : "—")}</td><td class="mono small">${esc(a.ip || "—")}</td><td class="small" title="${esc(a.ua || "")}">${esc(String(a.ua || "—").slice(0, 40))}</td>
              <td>${a.before || a.after ? `<details class="audit"><summary>${th("pokaż")}</summary><div class="grid g2 mt2"><div><small class="dim">${th("Przed")}</small><pre class="json">${esc(JSON.stringify(a.before, null, 1))}</pre></div><div><small class="dim">${th("Po")}</small><pre class="json">${esc(JSON.stringify(a.after, null, 1))}</pre></div></div></details>` : ""}</td></tr>`).join("")}</tbody></table></div>
            <div class="toolbar" style="border:0"><span class="dim">${esc(tp("{n} wpis|{n} wpisy|{n} wpisów", rows.length))}</span>${rows.length > shown.length ? `<button class="btn sm" type="button" id="au-more">${th("Pokaż więcej")}</button>` : ""}</div>` : `<div class="empty">${th("Brak wpisów dla filtrów.")}</div>`}`;
      } else body = `<div id="au-extra"><div class="empty">…</div></div>`;
      return `<div class="page-head"><div class="titles"><h2>${th("Dziennik audytu")}</h2><p>${th("Wszystkie zmiany danych i operacje administracyjne (konta, role, uprawnienia, statusy, zaproszenia, hasła) z autorem, czasem, adresem IP i przeglądarką. Wpisów nie można edytować ani usuwać.")}</p></div></div>
        <div class="seg mb3" role="tablist">${tabs.map(([k, l]) => `<button type="button" data-autab="${k}" aria-pressed="${f.tab === k}">${esc(l)}</button>`).join("")}</div>
        <div class="card">${body}</div>`;
    },
    async bind(page) {
      const f = this.f();
      $$("[data-autab]", page).forEach(b => b.onclick = () => { f.tab = b.dataset.autab; App.render(); });
      const on = (id, k) => { const el = $(id, page); if (el) el.onchange = e => { f[k] = e.target.value; f.limit = 300; App.render(); }; };
      on("#au-from", "from"); on("#au-to", "to"); on("#au-code", "code"); on("#au-user", "user"); on("#au-wh", "wh");
      if ($("#au-q", page)) bindSearch(page, "#au-q", f, "q", this);
      const more = $("#au-more", page); if (more) more.onclick = () => { f.limit += 500; App.render(); };
      const csv = $("#au-csv", page);
      if (csv) csv.onclick = () => download(`resinvest_audyt_${f.from || "start"}_${f.to || App.today()}.csv`, UI.toCSV([t("Czas"), t("Kto"), t("Zdarzenie"), t("Akcja"), t("Obiekt"), t("Magazyn"), t("Adres IP"), t("Przeglądarka"), t("Źródło")],
        this.rows().map(a => [a.ts, a.userName, a.code || "", R.auditText(a), a.opNo || a.entityId || "", a.whId ? App.whName(a.whId) : "", a.ip || "", a.ua || "", t(a.source || "")])), "text/csv");
      if (f.tab === "events") return;
      const box = $("#au-extra", page);
      let rows;
      if (Store.mode === "server") { const r = await ServerBackend.auditExtra(); if (!r || !r.ok) { box.innerHTML = `<div class="empty">${esc((r && r.error) || t("Brak danych"))}</div>`; return; } this.extra = r; }
      if (f.tab === "logins") {
        rows = Store.mode === "server" ? this.extra.log : await Store.backend.loginLog();
        box.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl dense" id="login-log-table"><thead><tr><th>${th("Czas")}</th><th>${th("E-mail")}</th><th>${th("Wynik")}</th><th>${th("Szczegóły")}</th>${Store.mode === "server" ? `<th>${th("Adres IP")}</th>` : ""}</tr></thead><tbody>
          ${rows.slice(0, 500).map(x => `<tr><td class="nowrap">${esc(Dates.ts(String(x.ts), true))}</td><td class="mono">${esc(x.login || (R.byId(Store.state.users, x.userId) || {}).login || "")}</td><td>${x.ok ? `<span class="badge ok">${th("OK")}</span>` : `<span class="badge err">${th("odrzucone")}</span>`}</td><td>${esc(t(x.reason || ""))}</td>${Store.mode === "server" ? `<td class="mono">${esc(x.ip || "")}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak wpisów.")}</div>`;
      } else {
        const mc = this.extra.mailConfig || {};
        rows = this.extra.mail || [];
        box.innerHTML = `<div class="card-b"><dl class="money-list"><dt>${th("Transport")}</dt><dd>${esc(mc.transport || "—")}${mc.configured ? "" : " · " + esc(t("brak klucza — wysyłka nie działa"))}</dd>${mc.smtp ? `<dt>${th("Serwer SMTP")}</dt><dd class="mono" id="mail-smtp">${esc(mc.smtp.host)}:${esc(String(mc.smtp.port))} · ${esc(mc.smtp.secure === "ssl" ? "SSL/TLS" : mc.smtp.secure === "starttls" ? "STARTTLS" : t("bez szyfrowania"))}${mc.smtp.user ? " · " + esc(mc.smtp.user) : ""}</dd>` : ""}${mc.problem ? `<dt>${th("Do uzupełnienia")}</dt><dd class="mono small" id="mail-problem">${esc(mc.problem)}</dd>` : ""}<dt>${th("Nadawca")}</dt><dd>${esc(mc.from || "—")}</dd>${mc.outDir ? `<dt>${th("Folder wiadomości")}</dt><dd class="mono small">${esc(mc.outDir)}</dd>` : ""}</dl></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl dense" id="mail-log-table"><thead><tr><th>${th("Czas")}</th><th>${th("Szablon")}</th><th>${th("Adresat")}</th><th>${th("Wynik")}</th><th>${th("Błąd")}</th></tr></thead><tbody>
          ${rows.map(x => `<tr><td class="nowrap">${esc(Dates.ts(String(x.ts), true))}</td><td class="mono">${esc(x.template)}</td><td class="mono">${esc(x.to)}</td><td>${x.status === "SENT" ? `<span class="badge ok">${th("wysłano")}</span>` : x.status === "QUEUED" || x.status === "SENDING" ? `<span class="badge info">${th("w kolejce")}</span>` : x.status === "FAILED" ? `<span class="badge warn">${th("nieudana — ponowienie")}</span>` : `<span class="badge err">${th("błąd")}</span>`}</td><td class="small">${esc(x.error || "")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${th("Brak wysłanych wiadomości.")}</div>`}`;
      }
    }
  };

  /* ================================================================== */
  /* Mój profil                                                           */
  /* ================================================================== */
  Views.profil = {
    html() {
      const u = App.user(), S = Store.state;
      const mine = S.audit.filter(a => a.userId === u.id).slice(-10).reverse();
      return `<div class="page-head"><div class="titles"><h2>${th("Mój profil i ustawienia")}</h2><p>${th("Język i motyw zapisują się w Twoim profilu — działają na każdym komputerze po zalogowaniu.")}</p></div></div>
        <div class="grid g2">
          <div class="card"><div class="card-h"><h3>${th("Konto")}</h3></div><div class="card-b">
            <div class="row mb4"><span class="avatar lg">${esc(initials(u.name))}</span><div><b style="font-size:var(--t-lg)">${esc(u.name)}</b><div class="dim">${esc(u.login)} · ${esc(App.roleLabel(u.role))}</div></div></div>
            <dl class="money-list"><dt>${th("Rola")}</dt><dd>${esc(App.roleLabel(u.role))} <span class="mono small dim">${esc((R.ROLES[u.role] || {}).code || "")}</span></dd><dt>${th("Magazyn domyślny")}</dt><dd>${esc(App.whName(u.whId))}</dd><dt>${th("Dostępne magazyny")}</dt><dd>${esc(whList(u))}</dd><dt>${th("E-mail")}</dt><dd>${esc(u.email || "—")}</dd><dt>${th("Tryb pracy")}</dt><dd><b class="mode-tag">${esc(App.modeLabel())}</b> ${esc(Store.mode === "server" ? t("serwer (wielostanowiskowy)") : t("lokalny (ta przeglądarka)"))}</dd><dt>${th("Wylogowanie po bezczynności")}</dt><dd>${esc(t("{n} min", { n: AuthLib.POLICY.idleMinutes }))}</dd></dl>
            <div class="row wrap mt4"><button class="btn" type="button" id="pf-pw">${ic("key", 15)} ${th("Zmień hasło")}</button><button class="btn danger" type="button" id="pf-logout">${ic("logout", 15)} ${th("Wyloguj")}</button></div></div></div>
          <div class="card"><div class="card-h"><h3>${th("Wygląd i język")}</h3></div><div class="card-b">
            <div class="set-list">
              <div class="set-row"><div class="sl"><b>${th("Język")}</b><small>${th("Interfejs, raporty, wydruki i PDF")}</small></div>
                <div class="seg" role="group" aria-label="${th("Język")}">${Object.values(I18N.LANGS).map(L => `<button type="button" data-plang="${L.code}" aria-pressed="${L.code === I18N.lang}">${esc(L.label)}</button>`).join("")}</div></div>
              <div class="set-row" style="display:block"><div class="sl mb3"><b>${th("Motyw")}</b><small>${th("Skrót klawiszowy: Ctrl+D")}</small></div>
                <div class="theme-cards">${THEME_LIST.map(x => `<button class="theme-card" type="button" data-ptheme="${x.id}" aria-pressed="${x.id === Prefs.theme}"><div class="sw" style="background:${x.sw[1]}"><i style="background:${x.sw[0]}"></i><i style="background:linear-gradient(90deg,${x.sw[2]} 0 30%,${x.sw[1]} 30%)"></i></div><b>${esc(t(x.label))}</b></button>`).join("")}</div></div>
              <div class="set-row"><div class="sl"><b>${th("Samouczek pod polami formularza")}</b><small>${th("Podpowiedzi „Co / Po co” w Nowej operacji")}</small></div><label class="inline-opt"><input type="checkbox" id="pf-tut" ${lsGet("riw.tutorial", "1") !== "0" ? "checked" : ""}> ${th("włączony")}</label></div>
            </div></div></div>
        </div>
        <div class="card mt4"><div class="card-h"><h3>${th("Moja ostatnia aktywność")}</h3></div><div class="card-b"><ul class="timeline">${mine.map(a => `<li>${UI.auditLine(a)}</li>`).join("") || `<li class="dim">${th("Brak wpisów.")}</li>`}</ul></div></div>`;
    },
    bind(page) {
      $("#pf-pw", page).onclick = () => Auth.changePasswordDialog();
      $("#pf-logout", page).onclick = () => App.logout();
      $$("[data-plang]", page).forEach(b => b.onclick = () => Prefs.setLang(b.dataset.plang));
      $$("[data-ptheme]", page).forEach(b => b.onclick = async () => { await Prefs.setTheme(b.dataset.ptheme); App.render(); });
      $("#pf-tut", page).onchange = e => { lsSet("riw.tutorial", e.target.checked ? "1" : "0"); document.body.classList.toggle("no-tutorial", !e.target.checked); };
    }
  };

  /* ================================================================== */
  /* Administracja                                                        */
  /* ================================================================== */
  Views.administracja = {
    html() {
      const S = Store.state, srv = Store.mode === "server";
      const intro = root.Intro, today = ssGet("riw.today", "");
      const size = Store.backend.sizeBytes();
      return `<div class="page-head"><div class="titles"><h2>${th("Administracja")}</h2><p>${th("Kopie zapasowe, import danych, preferencje programu i informacje o systemie. Konta i hasła — moduł Użytkownicy.")}</p></div>
          ${App.can("users.read") ? `<div class="actions"><a class="btn" href="#/uzytkownicy">${ic("users", 15)} ${th("Użytkownicy")}</a></div>` : ""}</div>
        <div class="grid g2">
          <div class="card"><div class="card-h"><h3>${th("Kopia zapasowa i import")}</h3></div><div class="card-b stack">
            <p class="muted">${th("Pełna kopia danych (operacje, dokumenty, korekty, anulowania, księga, inwentaryzacja, flota, kartoteki, audyt) w pliku JSON. Hasła nie trafiają do kopii. Wczytanie kopii zastępuje bieżące dane po kontroli struktury i migracji do bieżącej wersji.")}</p>
            <div class="row wrap"><button class="btn primary" type="button" id="bk-export" ${App.can("data.backup") ? "" : "disabled"}>${ic("dl", 15)} ${th("Pobierz kopię (JSON)")}</button>
              <button class="btn" type="button" id="bk-import" ${App.can("data.import") ? "" : "disabled"}>${ic("up", 15)} ${th("Wczytaj kopię")}</button>
              <input type="file" id="bk-file" accept="application/json,.json" class="hidden"></div>
            <p class="help">${esc(t("Wymagana rola: Administrator. Rozmiar danych: {kb} kB (rewizja {rev}, schemat {s}).", { kb: fmt(size / 1024, 1), rev: S.rev, s: S.schema }))}</p></div></div>
          ${App.can("settings.edit") ? `<div class="card" id="access-card"><div class="card-h"><h3>${th("Konfiguracja dostępu")}</h3></div><div class="card-b stack">
            <label class="inline-opt"><input type="checkbox" id="cfg-approval" ${S.config.requireApproval ? "checked" : ""}> ${th("Obieg zatwierdzania operacji")}</label>
            <p class="help">${th("Wyłączony (domyślnie): osoba z uprawnieniem do wprowadzania zatwierdza operację sama. Włączony: operacje osób bez uprawnienia „op.approve” czekają na zatwierdzenie kierownika magazynu.")}</p>
            <div class="field"><label for="cfg-mmmode">${th("Przesunięcia międzymagazynowe (MM)")}</label>
              <select class="ctrl" id="cfg-mmmode">${Object.entries(R.MM_MODES).map(([k, l]) => `<option value="${k}" ${R.mmMode(S.config) === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div>
            <p class="help">${th("Dwuetapowy (domyślnie): wysłanie zmniejsza stan źródła, dokument ma status „W drodze”, a stan magazynu docelowego rośnie dopiero po „Przyjmij MM” (z ilością faktyczną i przyczyną różnicy). Zmiana dotyczy nowych dokumentów — MM już wysłane zachowują swój tryb.")}</p>
            <div class="field"><label for="cfg-docno">${th("Numeracja dokumentów magazynowych")}</label>
              <select class="ctrl" id="cfg-docno">${Object.entries(R.DOC_NUMBERING).map(([k, l]) => `<option value="${k}" ${(R.unifiedNumbering(S) ? "wz" : "types") === k ? "selected" : ""}>${th(l)}</option>`).join("")}</select></div>
            <p class="help">${th("Jedna seria WZ (domyślnie): każda transakcja — zakup, sprzedaż, produkcja, MM, korekta, inwentaryzacja, bilans otwarcia — dostaje kolejny numer WZ/NNN/MM/RRRR. Numery nadane wcześniej nie zmieniają się.")}</p>
            <label class="inline-opt"><input type="checkbox" id="cfg-selfreg" ${S.config.allowSelfRegistration ? "checked" : ""}> ${th("Samodzielna rejestracja z ekranu logowania")}</label>
            <p class="help">${th("Wyłączona (zalecane): konta zakłada wyłącznie administrator — zaproszeniem e-mail. Włączona: zgłoszenie czeka na nadanie roli i magazynu przez administratora.")}</p>
            <p class="help">${esc(t("Dozwolone domeny e-mail: {d} (config/app.config.json).", { d: (S.config.companyDomains || []).map(d => "@" + d).join(", ") }))}</p>
            <div><a class="btn sm" href="#/role">${ic("shield", 13)} ${th("Role i uprawnienia")}</a> <a class="btn sm" href="#/audyt">${ic("clock", 13)} ${th("Dziennik audytu")}</a></div></div></div>` : ""}
          ${srv ? `<div class="card"><div class="card-h"><h3>${th("Kopie serwera (SQLite)")}</h3><span class="spacer"></span><button class="btn sm" type="button" id="srv-bk" ${App.can("data.backup") ? "" : "disabled"}>${ic("db", 13)} ${th("Utwórz kopię teraz")}</button></div><div id="srv-bk-list"><div class="empty">…</div></div></div>` : ""}
          ${App.can("users.manage") ? `<div class="card" id="clean-card"><div class="card-h"><h3>${th("Start pracy na czysto")}</h3></div><div class="card-b stack">
            <p class="muted">${th("Usuwa operacje, dokumenty, księgę, wersje robocze i okresy inwentaryzacji — zostają magazyny, produkty, kontrahenci, flota i konta użytkowników. Użyj przed rozpoczęciem pracy na prawdziwych danych (po szkoleniu na danych przykładowych). Przed wyczyszczeniem pobierz kopię.")}</p>
            <div><button class="btn danger" type="button" id="dm-clean">${ic("trash", 15)} ${th("Wyczyść operacje i rozpocznij pracę")}</button></div></div></div>` : ""}
          <div class="card"><div class="card-h"><h3>${th("Preferencje programu")}</h3></div><div class="card-b stack">
            <label class="inline-opt"><input type="checkbox" id="pf-intro" ${intro && intro.enabled() ? "checked" : ""}> ${th("Intro przy uruchomieniu")}</label>
            <label class="inline-opt"><input type="checkbox" id="pf-music" ${intro && intro.musicOn() ? "checked" : ""}> ${th("Muzyka w intro (domyślnie włączona)")}</label>
            <div><button class="btn" type="button" id="pf-play">${ic("play", 15)} ${th("Odtwórz intro")}</button></div></div></div>
          ${srv ? "" : `<div class="card"><div class="card-h"><h3>${th("Narzędzia trybu lokalnego")}</h3></div><div class="card-b stack">
            <div class="field"><label for="dm-today">${th("Data systemowa (pusta = dzisiejsza)")}</label><input class="ctrl" type="date" id="dm-today" value="${esc(today)}"><div class="help">${th("Pozwala sprawdzić przełom miesiąca bez czekania. Obowiązuje w tej karcie.")}</div></div>
            <div class="row wrap"><button class="btn" type="button" id="dm-apply">${th("Zastosuj datę")}</button><button class="btn" type="button" id="dm-roll">${th("Kontrola przełomu miesiąca")}</button></div>
            <p class="help">${esc(t("Ostatnia kontrola przełomu: {d}.", { d: S.meta.lastMonthCheck || "—" }))}</p>
            <div class="dd-sep"></div>
            <p class="muted">${th("Przywraca dane przykładowe (bilans otwarcia 01.08.2026, operacje wzorcowe, MM, korekta i anulowanie). Obecne dane zostaną zastąpione — konta i hasła pozostają.")}</p>
            <div><button class="btn danger" type="button" id="dm-reset" ${App.can("data.import") ? "" : "disabled"}>${th("Przywróć dane przykładowe")}</button></div></div></div>`}
        </div>
        <div class="card mt4"><div class="card-h"><h3>${th("O programie")}</h3></div><div class="card-b">
          <dl class="money-list" style="max-width:720px"><dt>${th("Wersja")}</dt><dd>${esc(R.VERSION)} · ${esc(t("schemat {s}", { s: R.SCHEMA }))}</dd>
          <dt>${th("Tryb pracy")}</dt><dd><b class="mode-tag">${esc(App.modeLabel())}</b> ${esc(srv ? t("serwer — dane w bazie SQLite, wielu użytkowników") : Store.memoryOnly ? t("lokalny — tylko pamięć (zapis zablokowany)") : t("lokalny — dane w tej przeglądarce"))}</dd>
          ${srv && ServerBackend.info ? `<dt>${th("Serwer")}</dt><dd>${esc(ServerBackend.info.version || "")} · ${esc(ServerBackend.info.host || location.host)}</dd>` : ""}
          <dt>${th("Przeliczniki")}</dt><dd>1 m³ = ${fmtQ(S.config.m3_mp)} MP · 1 MP = ${fmt(S.config.mp_t, 2)} t · 1 t = ${fmt(S.config.t_gj, 1)} GJ</dd><dt>${th("Cena za rąbanie")}</dt><dd>${esc(t("{m} zł/MP (domyślnie)", { m: fmt(S.config.chipRateDefault) }))}</dd>
          <dt>${th("Blokada zapisu między kartami")}</dt><dd>${esc(srv ? t("transakcje bazy danych na serwerze") : root.navigator && navigator.locks ? t("Web Locks — aktywna") : t("niedostępna w tej przeglądarce"))}</dd><dt>PDF</dt><dd>${th("generator wbudowany, czcionka ResInvestDocSans (OFL)")}</dd></dl>
          ${srv ? "" : `<p class="help mt3">${th("Tryb lokalny służy do pracy na jednym stanowisku i do pokazu. Do pracy wielu osób zainstaluj ResInvest ERP Serwer (instalator Windows) — dane w bazie SQLite, kopie automatyczne, logowanie z sesją serwerową.")}</p>`}</div></div>`;
    },
    async bind(page) {
      const intro = root.Intro;
      $("#pf-intro", page).onchange = e => intro && intro.setEnabled(e.target.checked);
      $("#pf-music", page).onchange = e => intro && intro.setMusic(e.target.checked);
      $("#pf-play", page).onclick = () => intro && intro.play({ force: true });
      const setCfg = async (key, val) => {
        const res = await Store.exec("settings.save", { settings: { [key]: val } }, N_("Administracja"));
        if (!res.ok) { Toast.err(t("Nie zapisano"), res.error); } else Toast.ok(t("Zapisano konfigurację"));
        App.render();
      };
      const ca = $("#cfg-approval", page); if (ca) ca.onchange = e => setCfg("requireApproval", e.target.checked);
      const cm = $("#cfg-mmmode", page); if (cm) cm.onchange = e => setCfg("mmMode", e.target.value);
      const cd = $("#cfg-docno", page); if (cd) cd.onchange = e => setCfg("docNumbering", e.target.value);
      const cs = $("#cfg-selfreg", page); if (cs) cs.onchange = e => setCfg("allowSelfRegistration", e.target.checked);
      $("#bk-export", page).onclick = async () => {
        download(`resinvest_kopia_${App.today()}.json`, JSON.stringify(Store.state, null, 1), "application/json");
        await Store.exec("data.backupLogged", { format: "json" }, N_("Administracja"));
      };
      $("#bk-import", page).onclick = () => $("#bk-file", page).click();
      $("#bk-file", page).onchange = async e => {
        const file = e.target.files[0]; e.target.value = "";
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch (x) { Toast.err(t("Plik nie jest poprawnym JSON")); return; }
        const mg = R.migrate(data);
        const errs = mg.error ? [mg.error] : R.validateStateShape(mg.state);
        if (errs.length) { Toast.err(t("Kopia odrzucona"), errs.slice(0, 3).join("; ")); return; }
        const r = await Modal.confirm({ title: t("Wczytać kopię?"), text: t("Kopia: {n} operacji, {l} zapisów księgi, rewizja {r}. Bieżące dane zostaną zastąpione.", { n: mg.state.operations.length, l: mg.state.ledger.length, r: mg.state.rev }), ok: t("Wczytaj"), danger: true });
        if (!r.ok) return;
        const res = await Store.exec("data.import", { state: data }, N_("Administracja"));
        if (res.ok) { Toast.ok(t("Kopia wczytana"), res.migrated ? t("Dane zmigrowane do bieżącej wersji.") : ""); UI.Form.draft = null; ssSet(DRAFT_KEY, null); if (Store.mode === "local") await AuthLib.LocalAuth.ensureDemo(Store.state); App.render(); } else Toast.err(t("Import nieudany"), res.error);
      };
      const ap = $("#dm-apply", page); if (ap) ap.onclick = () => { const v = $("#dm-today", page).value; ssSet("riw.today", v || null); Toast.info(t("Data systemowa"), v || t("dzisiejsza")); App.render(); };
      const roll = $("#dm-roll", page);
      if (roll) roll.onclick = async () => {
        const res = await Store.exec("inv.autoClose", {}, N_("Automat: początek kolejnego miesiąca"));
        const done = res.done || [];
        Toast.info(t("Kontrola przełomu miesiąca"), done.length ? done.map(d => `${d.ym}: ${d.ok ? t("zamknięto") + (d.docNo ? " (" + d.docNo + ")" : "") : d.error}`).join(" · ") : t("Brak otwartych okresów z poprzednich miesięcy lub kontrola już wykonana w tym miesiącu."));
        App.render();
      };
      const cl = $("#dm-clean", page);
      if (cl) cl.onclick = async () => {
        const r = await Modal.confirm({ title: t("Wyczyścić wszystkie operacje?"), text: t("Tej czynności nie można cofnąć (poza wczytaniem kopii). Wpisz WYCZYŚĆ, aby potwierdzić."), ok: t("Wyczyść"), danger: true, input: { label: t("Potwierdzenie"), placeholder: "WYCZYŚĆ", required: true } });
        if (!r.ok) return;
        const res = await Store.exec("data.clean", { confirm: String(r.value).toUpperCase() }, N_("Administracja"));
        if (res.ok) { UI.Form.draft = null; ssSet(DRAFT_KEY, null); Toast.ok(t("Dane wyczyszczone — można rozpocząć pracę")); App.render(); } else Toast.err(t("Nie wyczyszczono"), res.error);
      };
      const rs = $("#dm-reset", page);
      if (rs) rs.onclick = async () => {
        const r = await Modal.confirm({ title: t("Przywrócić dane przykładowe?"), text: t("Wszystkie operacje, dokumenty, okresy i zmiany kartotek w tej przeglądarce zostaną zastąpione danymi startowymi."), ok: t("Przywróć"), danger: true });
        if (!r.ok) return;
        const res = await Store.exec("data.reset", {}, N_("Administracja"));
        if (res.ok) { UI.Form.draft = null; ssSet(DRAFT_KEY, null); await AuthLib.LocalAuth.ensureDemo(Store.state); Toast.ok(t("Przywrócono dane przykładowe")); App.render(); } else Toast.err(t("Nie przywrócono"), res.error);
      };
      if (Store.mode === "server") {
        const list = async () => {
          const r = await ServerBackend.backups(), box = $("#srv-bk-list", page);
          if (!box) return;
          box.innerHTML = r && r.ok && r.backups.length ? `<div class="tbl-wrap"><table class="tbl" id="srv-bk-table"><thead><tr><th>${th("Plik")}</th><th>${th("Utworzono")}</th><th class="r">${th("Rozmiar")}</th><th></th></tr></thead><tbody>${r.backups.map(b => `<tr><td class="mono">${esc(b.name)}</td><td>${esc(Dates.ts(b.created))}</td><td class="r">${fmt(b.size / 1024, 0)} kB</td><td class="r">${App.can("data.backup") ? `<a class="btn sm" href="/api/backups/${encodeURIComponent(b.name)}" download>${ic("dl", 13)} ${th("Pobierz")}</a>` : ""}</td></tr>`).join("")}</tbody></table></div>
            <div class="card-b"><p class="help">${esc(t("Kopie automatyczne: codziennie, przechowywane {d} dni. Folder: {f}", { d: r.keepDays, f: r.dir }))}</p></div>` : `<div class="empty">${esc((r && r.error) || t("Brak kopii."))}</div>`;
        };
        const b = $("#srv-bk", page); if (b) b.onclick = async () => { const r = await ServerBackend.backupNow(); if (r && r.ok) Toast.ok(t("Utworzono kopię"), r.name); else Toast.err(t("Nie utworzono kopii"), r && r.error); list(); };
        list();
      }
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
