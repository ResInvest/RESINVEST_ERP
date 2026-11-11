/* =========================================================================
   ResInvest ERP 3.15 — Plan placu, terminarz pociągów, symulacja i realizacja załadunku, panel operatora (ekrany)

   Ekrany (menu „Plac i kolej”):
     plac      — mapa 2D placu (metry, widok z góry): pryzmy i infrastruktura, przesuwanie / rozmiar / obrót (tryb edycji),
                 zoom i przesuwanie widoku; pasek najbliższego pociągu, panel pociągów, szczegóły zaznaczonej pryzmy,
     pociagi   — terminarz: kalendarz, lista chronologiczna, tabela, panel najbliższego pociągu,
     zaladunek — symulacja (warianty A–D, kalkulator, porównanie), zatwierdzenie = rezerwacja, realizacja, druk / PDF,
     operator  — uproszczony widok dla operatora ładowarki (telefon).
   Cała logika w silniku (R.YardPlan); ekran tylko pokazuje wynik i wysyła komendy (Store.exec).
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, tp, N_, esc, $, $$, ic, Toast, Modal, Store, App, Views } = UI;
  const Y = R.YardPlan, { Dates, fmtQ: fq } = R;
  const th = s => esc(t(s));
  const SRC = N_("Plan placu");
  const tab = (k, d) => App.tabs[k] || (App.tabs[k] = d);
  const whId = () => App.user().whId;
  const fail = res => Toast.err(t("Nie zapisano"), res.error || "");
  const exec = async (cmd, args, okMsg) => { const res = await Store.exec(cmd, args, SRC); if (!res.ok) { if (res.code !== "NOCHANGE") fail(res); } else if (okMsg) Toast.ok(okMsg); return res; };
  const fld = (id, label, inner, cls) => `<div class="field ${cls || ""}"><label for="${id}">${esc(label)}</label>${inner}</div>`;
  const inp = (id, v, attrs) => `<input class="ctrl" id="${id}" value="${esc(v === null || v === undefined ? "" : v)}" ${attrs || ""}>`;
  const sel = (id, opts, v, attrs) => `<select class="ctrl" id="${id}" ${attrs || ""}>${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v === null || v === undefined ? "" : v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const numIn = v => v === null || v === undefined ? "" : fq(v);
  const trainWhen = x => `${Dates.pl(x.loadDate || x.arrivalDate)}${x.loadStart ? " " + x.loadStart : ""}`;
  const tStatus = x => `<span class="badge ts-${esc(x.status)}">${esc(t(Y.TRAIN_STATUS[x.status] || x.status))}</span>`;
  const pStatus = p => `<span class="badge ps-${esc(p.status)}">${esc(t(Y.PLAN_STATUS[p.status] || p.status))}</span>`;
  const pileName = p => p ? `${p.no}${p.name ? " " + p.name : ""}` : "?";
  const products = () => Store.state.products.filter(p => p.active !== false);

  /* ------------------------------------------------------------------ */
  /* Mapa placu (SVG, jednostka = 1 m)                                   */
  /* ------------------------------------------------------------------ */
  const tf = o => `translate(${o.x} ${o.y}) rotate(${o.rot || 0})`;
  function objInner(o, c) {
    const w = o.w, h = o.h, x = -w / 2, y = -h / 2, flip = o.rot > 90 && o.rot <= 270 ? ' transform="rotate(180)"' : "";
    let s = "";
    if (o.kind === "pile") {
      const a = c.alloc.byPile.get(o.id), mark = c.marks && c.marks.get(o.id), q = Y.pileQty(Store.state, o);
      s = (o.shape === "stozek" ? `<ellipse class="pb" rx="${w / 2}" ry="${h / 2}"/>` : `<rect class="pb" x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(h / 2, w / 2, 3)}"/>`)
        + (o.shape !== "stozek" && o.shape !== "prostopadloscian" && w > h ? `<line class="ridge" x1="${x + h / 2}" y1="0" x2="${-x - h / 2}" y2="0"/>` : "")
        + `<g${flip}><text class="yo-t" y="${h > 9 ? -0.8 : 1}">${esc(pileName(o))}</text>${h > 9 ? `<text class="yo-s" y="3.4">${esc(fq(q.qty))} ${esc(R.Units.label(q.unit))}</text>` : ""}
           <text class="yo-d" y="${h / 2 + 3.4}">${esc(`${fq(w)} × ${fq(h)} × ${fq(o.hei)} m`)}</text></g>`
        + (mark ? `<g${flip}><circle class="ym" cx="${x + 5}" cy="0" r="3.6"/><text class="ym-t" x="${x + 5}" y="1.3">${mark.order}</text><text class="ym-q" y="${-h / 2 - 1.6}">${esc(t("pobrać {q} MP", { q: fq(mark.qty) }))}</text></g>` : "");
      if (a && a.color) c.cls = "c-" + a.color;
    } else if (o.kind === "track") {
      s = `<rect class="tb" x="${x}" y="${y}" width="${w}" height="${h}"/><line class="rail" x1="${x}" y1="${-h / 4}" x2="${-x}" y2="${-h / 4}"/><line class="rail" x1="${x}" y1="${h / 4}" x2="${-x}" y2="${h / 4}"/><line class="ties" x1="${x}" y1="0" x2="${-x}" y2="0" style="stroke-width:${h * 0.8}"/>`;
    } else if (o.kind === "sample") {
      s = `<path class="pin" d="M0 ${h / 2} C ${-w * 0.7} ${-h * 0.1} ${-w * 0.6} ${-h * 0.9} 0 ${-h * 0.9} C ${w * 0.6} ${-h * 0.9} ${w * 0.7} ${-h * 0.1} 0 ${h / 2}z"/>`;
    } else if (o.kind === "fence") {
      s = `<line class="fl" x1="${x}" y1="0" x2="${-x}" y2="0"/><rect class="hit" x="${x}" y="-1.5" width="${w}" height="3"/>`;
    } else {
      s = `<rect class="ib" x="${x}" y="${y}" width="${w}" height="${h}" rx="0.6"/>` + (o.kind === "road" ? `<line class="mid" x1="${x}" y1="0" x2="${-x}" y2="0"/>` : "")
        + (o.kind === "gate" ? `<line class="bar" x1="${x}" y1="0" x2="${-x}" y2="0"/>` : "");
    }
    if (o.kind !== "pile") { const lab = o.label || (o.kind === "loading" ? t(Y.INFRA.loading.label) : ""); if (lab) s += `<g${flip}><text class="yi-t ${o.kind === "sample" ? "pin-t" : ""}" y="${o.kind === "sample" ? -h * 0.25 : o.kind === "fence" ? -1.6 : Math.min(1.1, h / 2 - 0.4)}">${esc(lab)}</text></g>`; }
    if (c.edit && c.sel === o.id) {
      s += `<rect class="ysel" x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}"/>` + [[x, y], [-x, y], [-x, -y], [x, -y]].map(([a, b]) => `<rect class="yh" data-h="size" x="${a - 1.3}" y="${b - 1.3}" width="2.6" height="2.6"/>`).join("")
        + `<line class="yrl" x1="0" y1="${y - 1}" x2="0" y2="${y - 6}"/><circle class="yh rot" data-h="rot" cx="0" cy="${y - 6}" r="1.7"/>`;
    } else if (c.sel === o.id) s += `<rect class="ysel" x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}"/>`;
    return s;
  }
  function objSvg(o, c) { c.cls = ""; const inner = objInner(o, c); return `<g class="yo yo-${o.kind} ${c.cls} ${c.dim && c.dim(o) ? "dim" : ""}" data-obj="${esc(o.id)}" transform="${tf(o)}">${inner}</g>`; }
  /** Mapa: opts { view, sel, edit, alloc, marks (Map pileId → { order, qty }), route (lista pileId w kolejności), dim(o) }. */
  function mapSvg(wh, o) {
    const S = Store.state, A = Y.AREA, v = o.view || { x: 0, y: 0, w: A.w, h: A.h }, c = Object.assign({ alloc: Y.allocate(S, wh) }, o);
    const objs = S.yard.filter(x => x.whId === wh), order = { fence: 0, road: 1, track: 2, loading: 3 };
    const sorted = objs.slice().sort((a, b) => (a.kind === "pile" ? 9 : order[a.kind] === undefined ? 5 : order[a.kind]) - (b.kind === "pile" ? 9 : order[b.kind] === undefined ? 5 : order[b.kind]));
    let grid = ""; for (let x = 20; x < A.w; x += 20) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${A.h}"/>`; for (let y = 20; y < A.h; y += 20) grid += `<line x1="0" y1="${y}" x2="${A.w}" y2="${y}"/>`;
    let route = "";
    if (o.route && o.route.length) {
      const P = o.route.map(id => R.byId(S.yard, id)).filter(Boolean), L = P.length ? Y.loadingPoint(S, wh, P[0]) : null;
      if (L) route = P.map((p, i) => `<line class="yr" x1="${p.x}" y1="${p.y}" x2="${L.x}" y2="${L.y}"/>`).join("")
        + `<g transform="translate(${P[0].x} ${P[0].y - P[0].h / 2 - 6})"><rect class="yflag s" x="-9" y="-3" width="18" height="5" rx="1"/><text class="yflag-t" y="0.9">${th("START")}</text></g>`
        + `<g transform="translate(${L.x} ${L.y - L.h / 2 - 3.5})"><rect class="yflag e" x="-13" y="-3" width="26" height="5" rx="1"/><text class="yflag-t" y="0.9">${th("ZAŁADUNEK")}</text></g>`;
    }
    return `<svg id="${o.id || "ymap"}" class="ymap ${o.edit ? "editing" : ""}" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t("Plan placu — widok z góry"))}">
      <rect class="yarea" x="0" y="0" width="${A.w}" height="${A.h}"/><g class="ygrid">${grid}</g>
      <g class="yscale" transform="translate(${A.w - 34} ${A.h - 5})"><line x1="0" y1="0" x2="20" y2="0"/><text x="10" y="-1.4">20 m</text></g>
      ${sorted.map(x => objSvg(x, c)).join("")}${route}</svg>`;
  }
  const legend = () => `<ul class="ylegend">${Object.entries(Y.COLORS).map(([k, l]) => `<li><i class="lg c-${k}"></i>${th(l)}</li>`).join("")}<li><i class="lg lg-load"></i>${th("Miejsce załadunku pociągu")}</li><li><i class="lg lg-pin"></i>${th("Punkt poboru próbek")}</li></ul>`;
  /** Obsługa wskaźnika: wybór, przesuwanie / rozmiar / obrót obiektu (edycja), przesuwanie i zoom widoku. */
  function bindMap(page, T, o) {
    const svg = $("#" + (o.id || "ymap"), page); if (!svg) return;
    const A = Y.AREA, pt = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const setView = () => svg.setAttribute("viewBox", `${T.view.x} ${T.view.y} ${T.view.w} ${T.view.h}`);
    const zoom = (f, cx, cy) => { const v = T.view, w = Math.max(30, Math.min(A.w * 1.25, v.w * f)), k = w / v.w; cx = cx === undefined ? v.x + v.w / 2 : cx; cy = cy === undefined ? v.y + v.h / 2 : cy; T.view = { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: v.h * k }; setView(); };
    let d = null;
    svg.addEventListener("pointerdown", e => {
      const g = e.target.closest("[data-obj]"), h = e.target.closest("[data-h]"), p = pt(e);
      if (g) { const obj = R.byId(Store.state.yard, g.dataset.obj); if (!obj) return; d = { type: o.edit ? (h ? h.dataset.h : "move") : "click", obj: Object.assign({}, obj), g, sx: p.x, sy: p.y, ox: obj.x, oy: obj.y, moved: false }; }
      else d = { type: "pan", cx: e.clientX, cy: e.clientY, vx: T.view.x, vy: T.view.y, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch (x) {}
    });
    svg.addEventListener("pointermove", e => {
      if (!d) return;
      if (d.type === "pan") { const r = svg.getBoundingClientRect(), k = Math.max(T.view.w / r.width, T.view.h / r.height); if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) > 4) d.moved = true; T.view.x = d.vx - (e.clientX - d.cx) * k; T.view.y = d.vy - (e.clientY - d.cy) * k; setView(); return; }
      if (d.type === "click") return;
      const p = pt(e), ob = d.obj;
      if (Math.hypot(p.x - d.sx, p.y - d.sy) > 0.8) d.moved = true;
      if (!d.moved) return;
      if (d.type === "move") { ob.x = Math.max(0, Math.min(A.w, Math.round((d.ox + p.x - d.sx) * 2) / 2)); ob.y = Math.max(0, Math.min(A.h, Math.round((d.oy + p.y - d.sy) * 2) / 2)); }
      else if (d.type === "size") { const a = -(ob.rot || 0) * Math.PI / 180, dx = p.x - ob.x, dy = p.y - ob.y; ob.w = Math.max(1, Math.round(2 * Math.abs(dx * Math.cos(a) - dy * Math.sin(a)))); ob.h = Math.max(1, Math.round(2 * Math.abs(dx * Math.sin(a) + dy * Math.cos(a)))); }
      else if (d.type === "rot") { ob.rot = ((Math.round((Math.atan2(p.y - ob.y, p.x - ob.x) * 180 / Math.PI + 90) / 5) * 5) % 360 + 360) % 360; }
      d.g.setAttribute("transform", tf(ob)); d.g.innerHTML = objInner(ob, { alloc: o.alloc, sel: ob.id, edit: true });
    });
    const up = async () => {
      const x = d; d = null; if (!x) return;
      if (x.type === "pan") { if (!x.moved && o.onSelect) o.onSelect(null); return; }
      if (!x.moved) { if (o.onSelect) o.onSelect(x.obj.id); return; }
      T.sel = x.obj.id;
      await exec("yardobj.move", { id: x.obj.id, x: x.obj.x, y: x.obj.y, w: x.obj.w, h: x.obj.h, rot: x.obj.rot });
      App.render();
    };
    svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", () => { d = null; App.render(); });
    svg.addEventListener("wheel", e => { e.preventDefault(); const p = pt(e); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y); }, { passive: false });
    const b = (id, fn) => { const el = $(id, page); if (el) el.onclick = fn; };
    b("#yz-in", () => zoom(1 / 1.3)); b("#yz-out", () => zoom(1.3)); b("#yz-fit", () => { T.view = { x: 0, y: 0, w: A.w, h: A.h }; setView(); });
  }
  const zoomBtns = () => `<div class="yzoom"><button class="btn sm" type="button" id="yz-in" title="${esc(t("Przybliż"))}">+</button><button class="btn sm" type="button" id="yz-out" title="${esc(t("Oddal"))}">−</button><button class="btn sm" type="button" id="yz-fit">${th("Cały plac")}</button></div>`;

  /* ------------------------------------------------------------------ */
  /* Wspólne: najbliższy pociąg, formularze                              */
  /* ------------------------------------------------------------------ */
  function nextBar(wh, A) {
    const S = Store.state, x = A.next ? R.byId(S.trains, A.next) : null;
    if (!x) return `<div class="ynext none" id="ynext">${ic("calendar", 16)} <span>${th("Brak zaplanowanych pociągów — dodaj termin w terminarzu, a system wyznaczy pryzmy do załadunku.")}</span> <a class="btn sm" href="#/pociagi">${th("Terminarz pociągów")}</a></div>`;
    const T = A.byTrain.get(x.id), days = Math.round((Date.parse(x.loadDate || x.arrivalDate) - Date.parse(App.today())) / 864e5);
    return `<div class="ynext ${T.shortage > 0 ? "short" : ""}" id="ynext"><div><small>${th("Najbliższy pociąg")}</small><b>${esc(x.no)}</b><span>${esc(x.recipient || "")}</span></div>
      <div><small>${th("Termin załadunku")}</small><b>${esc(trainWhen(x))}</b><span>${days === 0 ? th("dziś") : days > 0 ? esc(tp("za {n} dzień|za {n} dni|za {n} dni", days)) : esc(t("{n} dni po terminie", { n: -days }))}</span></div>
      <div><small>${th("Zapotrzebowanie")}</small><b>${esc(fq(T.need))} MP</b><span>${x.reqT ? esc(fq(x.reqT)) + " t" : ""}</span></div>
      <div><small>${th("Przygotowana biomasa")}</small><b class="${T.shortage > 0 ? "neg" : "pos"}" id="ynext-total">${esc(fq(T.total))} MP</b><span>${esc(tp("{n} pryzma|{n} pryzmy|{n} pryzm", T.lines.length))}</span></div>
      ${T.shortage > 0 ? `<div class="yshort" id="ynext-short">${ic("alert", 16)} <b>${esc(t("NIEDOBÓR {q} MP", { q: fq(T.shortage) }))}</b><span>${th("za mało dostępnej zrębki w pryzmach")}</span></div>` : `<div class="yok">${ic("check", 16)} <b>${th("Pokrycie 100%")}</b>${tStatus(x)}</div>`}</div>`;
  }
  function pileForm(p, wh) {
    const S = Store.state, q = Y.queue(S, wh);
    return `<div class="yform">
      ${fld("pf-name", t("Nazwa pryzmy"), inp("pf-name", p.name, 'maxlength="60"'))}
      ${fld("pf-product", t("Rodzaj biomasy"), sel("pf-product", [["", t("— wybierz —")]].concat(products().map(x => [x.id, `${x.name} [${R.Units.label(x.unit)}]`])), p.productId))}
      ${fld("pf-qty", t("Ilość ewidencyjna (jedn. produktu)"), inp("pf-qty", numIn(p.qty), 'inputmode="decimal"'))}
      ${fld("pf-status", t("Status pryzmy"), sel("pf-status", Object.entries(Y.PILE_STATUS).map(([k, l]) => [k, t(l)]), p.status || "AVAILABLE"))}
      ${fld("pf-shape", t("Kształt"), sel("pf-shape", Object.entries(Y.SHAPES).map(([k, x]) => [k, t(x.label)]), p.shape || "pryzma"))}
      ${fld("pf-w", t("Długość [m]"), inp("pf-w", numIn(p.w), 'inputmode="decimal"'))}
      ${fld("pf-h", t("Szerokość [m]"), inp("pf-h", numIn(p.h), 'inputmode="decimal"'))}
      ${fld("pf-hei", t("Wysokość [m]"), inp("pf-hei", numIn(p.hei), 'inputmode="decimal"'))}
      ${fld("pf-topw", t("Szerokość korony [m] (trapez)"), inp("pf-topw", numIn(p.topW), 'inputmode="decimal"'))}
      ${fld("pf-supplier", t("Dostawca"), sel("pf-supplier", [["", "—"]].concat(S.partners.filter(x => x.active !== false).map(x => [x.id, x.name])), p.supplierId))}
      ${fld("pf-pz", t("Numer dokumentu PZ"), inp("pf-pz", p.pzNo, 'maxlength="40"'))}
      ${fld("pf-date", t("Data przyjęcia"), inp("pf-date", p.receivedDate, 'type="date"'))}
      ${fld("pf-moist", t("Wilgotność [%]"), inp("pf-moist", numIn(p.moisture), 'inputmode="decimal"'))}
      ${fld("pf-train", t("Przypisany pociąg (ręcznie)"), sel("pf-train", [["", t("automatycznie wg terminarza")]].concat(q.map(x => [x.id, `${x.no} · ${trainWhen(x)}`])), p.trainId))}
      ${fld("pf-note", t("Uwagi o jakości"), inp("pf-note", p.qualityNote, 'maxlength="200"'), "wide")}</div>`;
  }
  const readPile = sc => { const v = id => $(id, sc).value; return { name: v("#pf-name"), productId: v("#pf-product"), qty: v("#pf-qty"), status: v("#pf-status"), shape: v("#pf-shape"), w: v("#pf-w"), h: v("#pf-h"), hei: v("#pf-hei"), topW: v("#pf-topw"), supplierId: v("#pf-supplier"), pzNo: v("#pf-pz"), receivedDate: v("#pf-date"), moisture: v("#pf-moist"), trainId: v("#pf-train"), qualityNote: v("#pf-note") }; };
  function trainDialog(x, wh) {
    const S = Store.state, isNew = !x; x = x || { arrivalDate: App.today(), status: "PLANNED" };
    const m = Modal.open({ title: isNew ? t("Nowy pociąg w terminarzu") : t("Pociąg {no}", { no: x.no }), wide: true, id: "train-dialog",
      body: `<div class="yform">
        ${fld("tf-no", t("Numer pociągu / transportu"), inp("tf-no", x.no, 'maxlength="40"'))}
        ${fld("tf-buyer", t("Odbiorca"), sel("tf-buyer", [["", t("— wybierz —")]].concat(S.partners.filter(p => p.active !== false && (p.role === "buyer" || p.role === "both" || p.id === x.buyerId)).map(p => [p.id, p.name])), x.buyerId))}
        ${fld("tf-adate", t("Data planowanego przyjazdu"), inp("tf-adate", x.arrivalDate, 'type="date"'))}
        ${fld("tf-atime", t("Godzina przyjazdu"), inp("tf-atime", x.arrivalTime, 'type="time"'))}
        ${fld("tf-ldate", t("Planowana data załadunku"), inp("tf-ldate", x.loadDate, 'type="date"'))}
        ${fld("tf-lstart", t("Rozpoczęcie załadunku"), inp("tf-lstart", x.loadStart, 'type="time"'))}
        ${fld("tf-lend", t("Planowane zakończenie"), inp("tf-lend", x.loadEnd, 'type="time"'))}
        ${fld("tf-qty", t("Wymagana ilość biomasy [MP]"), inp("tf-qty", numIn(x.reqQty), 'inputmode="decimal"'))}
        ${fld("tf-t", t("Wymagana ilość [t]"), inp("tf-t", numIn(x.reqT), 'inputmode="decimal"'))}
        ${fld("tf-product", t("Rodzaj biomasy"), sel("tf-product", [["", t("dowolna zrębka (MP)")]].concat(products().filter(p => p.unit === "MP").map(p => [p.id, p.name])), x.productId))}
        ${fld("tf-order", t("Numer zamówienia"), inp("tf-order", x.orderNo, 'maxlength="60"'))}
        ${fld("tf-status", t("Status realizacji"), sel("tf-status", Y.TRAIN_MANUAL.concat(Y.TRAIN_MANUAL.includes(x.status) ? [] : [x.status]).map(k => [k, t(Y.TRAIN_STATUS[k])]), x.status))}
        ${fld("tf-notes", t("Uwagi"), inp("tf-notes", x.notes, 'maxlength="500"'), "wide")}</div>`,
      footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" id="tf-save">${ic("check", 15)} ${th("Zapisz pociąg")}</button>` });
    $("[data-no]", m.el).onclick = () => m.close();
    $("#tf-save", m.el).onclick = async () => {
      const v = id => $(id, m.el).value;
      const res = await exec("train.save", Object.assign(isNew ? { whId: wh } : { id: x.id }, { no: v("#tf-no"), buyerId: v("#tf-buyer"), arrivalDate: v("#tf-adate"), arrivalTime: v("#tf-atime"), loadDate: v("#tf-ldate"), loadStart: v("#tf-lstart"), loadEnd: v("#tf-lend"), reqQty: v("#tf-qty"), reqT: v("#tf-t"), productId: v("#tf-product"), orderNo: v("#tf-order"), status: v("#tf-status"), notes: v("#tf-notes") }));
      if (!res.ok) return;
      m.close();
      const a = res.allocation;
      if (a.shortage > 0) Toast.warn(t("Pociąg {no}: niedobór {q} MP", { no: res.train.no, q: fq(a.shortage) }), t("Przygotowano {a} z {b} MP — za mało dostępnej zrębki w pryzmach.", { a: fq(a.total), b: fq(a.need) }));
      else Toast.ok(t("Pociąg {no} zapisany", { no: res.train.no }), t("Wyznaczono pryzmy: {l}", { l: a.lines.map(l => `${l.no} ${fq(l.qty)} MP`).join(", ") || "—" }));
      App.render();
    };
  }
  async function removeTrain(x) {
    const c = await Modal.confirm({ title: t("Usunąć pociąg {no} z terminarza?", { no: x.no }), text: t("Projekty symulacji tego pociągu zostaną usunięte, a przypisane pryzmy zwolnione."), ok: t("Usuń"), danger: true });
    if (c.ok && (await exec("train.remove", { id: x.id }, t("Pociąg usunięty z terminarza"))).ok) App.render();
  }

  /* ------------------------------------------------------------------ */
  /* Ekran: Plan placu                                                   */
  /* ------------------------------------------------------------------ */
  Views.plac = {
    T() { return tab("yardmap", { view: { x: 0, y: 0, w: Y.AREA.w, h: Y.AREA.h }, sel: null, edit: false, train: "" }); },
    html() {
      const S = Store.state, T = this.T(), wh = whId(), A = Y.allocate(S, wh), can = App.can("yard.edit"), edit = can && T.edit;
      const selObj = T.sel ? S.yard.find(o => o.id === T.sel && o.whId === wh) : null;
      const hl = T.train && A.byTrain.get(T.train) ? new Set(A.byTrain.get(T.train).lines.map(l => l.pileId)) : null;
      const cons = Y.consistency(S, wh), Q = Y.queue(S, wh);
      let detail;
      if (selObj && selObj.kind === "pile") {
        const q = Y.pileQty(S, selObj), b = A.byPile.get(selObj.id), pr = R.byId(S.products, selObj.productId) || {}, d = Y.distance(S, selObj), u = R.Units.label(q.unit);
        const rows = [[t("Numer i nazwa"), pileName(selObj)], [t("Magazyn"), App.whName(wh)], [t("Rodzaj biomasy"), pr.name || "—"], [t("Dostawca"), (R.byId(S.partners, selObj.supplierId) || {}).name || "—"], [t("Dokument PZ"), selObj.pzNo || "—"], [t("Data przyjęcia"), selObj.receivedDate ? Dates.pl(selObj.receivedDate) : "—"],
          [t("Stan ewidencyjny"), `${fq(q.qty)} ${u}`], [t("W MP / m³"), `${q.mp === null ? "—" : fq(q.mp) + " MP"} · ${q.m3 === null ? "—" : fq(q.m3) + " m³"}`], [t("Masa szacunkowa"), q.t === null ? "—" : fq(q.t) + " t"],
          [t("Wymiary (dł. × szer. × wys.)"), `${fq(selObj.w)} × ${fq(selObj.h)} × ${fq(selObj.hei)} m`], [t("Objętość geometryczna (orientacyjnie)"), `${fq(q.geo)} m³ ${t("nasypowych")}`], [t("Odległość od miejsca załadunku"), d === null ? "—" : fq(d) + " m"],
          [t("Wilgotność / jakość"), `${selObj.moisture === null || selObj.moisture === undefined ? "—" : fq(selObj.moisture) + "%"}${selObj.qualityNote ? " · " + selObj.qualityNote : ""}`],
          [t("Przypisany pociąg"), b.parts.length ? b.parts.map(x => `${(R.byId(S.trains, x.trainId) || {}).no} — ${fq(x.qty)} MP (${x.source === "plan" ? t("rezerwacja planu") : x.source === "manual" ? t("ręcznie") : t("automatycznie")})`).join("; ") : t("brak — pryzma dostępna")],
          [t("Wolne (bez pociągu)"), `${fq(b.free)} ${u}`], [t("Status"), t(Y.PILE_STATUS[selObj.status])], [t("Ostatnia aktualizacja"), `${Dates.ts(selObj.updatedAt)}${selObj.updatedBy ? " · " + selObj.updatedBy : ""}`]];
        detail = `<div class="card-h"><h3><i class="lg c-${b.color}"></i> ${esc(t("Pryzma {n}", { n: pileName(selObj) }))}</h3><span class="sub">${th(Y.COLORS[b.color])}</span><span class="spacer"></span>${can ? `<button class="btn sm danger" type="button" id="yd-del">${ic("trash", 13)} ${th("Usuń pryzmę")}</button>` : ""}</div>
          <div class="card-b"><dl class="ydl" id="pile-detail">${rows.map(([a, v]) => `<dt>${esc(a)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
          ${can ? `<h4 class="mini-h">${th("Edycja pryzmy")}</h4>${pileForm(selObj, wh)}<div class="btn-row mt2"><button class="btn primary" type="button" id="pf-save">${ic("check", 15)} ${th("Zapisz pryzmę")}</button></div>` : ""}</div>`;
      } else if (selObj) {
        detail = `<div class="card-h"><h3>${esc(t(Y.INFRA[selObj.kind].label))}</h3><span class="spacer"></span>${can ? `<button class="btn sm danger" type="button" id="yd-del">${ic("trash", 13)} ${th("Usuń obiekt")}</button>` : ""}</div>
          <div class="card-b">${can ? `<div class="yform">${fld("if-label", t("Opis na mapie"), inp("if-label", selObj.label, 'maxlength="60"'))}${fld("if-w", t("Długość [m]"), inp("if-w", numIn(selObj.w)))}${fld("if-h", t("Szerokość [m]"), inp("if-h", numIn(selObj.h)))}${fld("if-rot", t("Obrót [°]"), inp("if-rot", numIn(selObj.rot)))}</div><div class="btn-row mt2"><button class="btn primary" type="button" id="if-save">${ic("check", 15)} ${th("Zapisz obiekt")}</button></div>` : `<p class="muted">${esc(selObj.label || "")}</p>`}</div>`;
      } else {
        detail = `<div class="card-h"><h3>${th("Zgodność z ewidencją magazynu")}</h3><span class="sub">${th("pryzmy to podział stanu z księgi — kliknij pryzmę na mapie, aby zobaczyć szczegóły")}</span></div>
          <div class="tbl-wrap"><table class="tbl" id="yard-cons"><thead><tr><th>${th("Produkt")}</th><th class="r">${th("Stan w ewidencji")}</th><th class="r">${th("W pryzmach")}</th><th class="r">${th("Poza pryzmami")}</th><th></th></tr></thead><tbody>
          ${cons.length ? cons.map(c => `<tr><td>${esc(c.name)}</td><td class="r">${esc(fq(c.ledger))} ${esc(R.Units.label(c.unit))}</td><td class="r">${esc(fq(c.inPiles))}</td><td class="r ${c.over ? "neg" : ""}">${esc(fq(c.free))}</td><td>${c.over ? `<span class="badge ps-CANCELLED">${th("pryzmy ponad stan — popraw ilości")}</span>` : ""}</td></tr>`).join("") : `<tr><td colspan="5" class="dim">${th("Brak stanów w tym magazynie.")}</td></tr>`}</tbody></table></div>`;
      }
      const side = Q.length ? Q.map((x, i) => { const B = A.byTrain.get(x.id); return `<button type="button" class="ytrain ${T.train === x.id ? "on" : ""} ${i === 0 ? "next" : ""}" data-train="${esc(x.id)}"><span class="yt-h"><i class="lg c-${i === 0 ? "green" : "orange"}"></i><b>${esc(x.no)}</b>${tStatus(x)}</span>
          <span class="yt-s">${esc(trainWhen(x))} · ${esc(x.recipient || "")}</span><span class="yt-q">${esc(fq(B.total))} / ${esc(fq(B.need))} MP${B.shortage > 0 ? ` <em class="neg">${esc(t("brak {q}", { q: fq(B.shortage) }))}</em>` : ""}</span>
          <span class="yt-p">${B.lines.map(l => `${esc((R.byId(S.yard, l.pileId) || {}).no)} ${esc(fq(l.qty))}`).join(" · ") || th("brak pryzm")}</span></button>`; }).join("") : `<p class="muted pad">${th("Brak aktywnych pociągów.")}</p>`;
      return `<div class="page-head"><div class="titles"><h2>${th("Plan placu")}</h2><p>${esc(t("Pryzmy biomasy i infrastruktura placu {w} — widok z góry. Zielone pryzmy system wyznacza na najbliższy pociąg z terminarza.", { w: App.whName(wh) }))}</p></div>
          <div class="actions">${can ? `<button class="btn primary" type="button" id="y-addpile">${ic("plus", 15)} ${th("Nowa pryzma")}</button>
            ${sel("y-addinfra", [["", t("+ Obiekt placu…")]].concat(Object.entries(Y.INFRA).map(([k, x]) => [k, t(x.label)])), "", `aria-label="${esc(t("Dodaj obiekt placu"))}"`)}
            ${Y.infra(S, wh).length ? "" : `<button class="btn" type="button" id="y-template">${ic("layers", 15)} ${th("Układ wzorcowy placu")}</button>`}
            <button class="btn ${edit ? "primary" : ""}" type="button" id="y-edit" aria-pressed="${edit}">${ic("edit", 15)} ${edit ? th("Zakończ edycję układu") : th("Edytuj układ")}</button>` : ""}</div></div>
        ${nextBar(wh, A)}
        <div class="yplan"><div class="card ymap-card">${zoomBtns()}${edit ? `<div class="yhint">${th("Przeciągnij obiekt, aby go przesunąć. Zaznaczony obiekt: narożniki zmieniają wymiary, kółko obraca.")}</div>` : ""}
            ${mapSvg(wh, { view: T.view, sel: T.sel, edit, alloc: A, dim: hl ? o => o.kind === "pile" && !hl.has(o.id) : null })}${legend()}</div>
          <aside class="card yside"><div class="card-h"><h3>${ic("calendar", 16)} ${th("Terminarz pociągów")}</h3><span class="spacer"></span><a class="btn sm" href="#/pociagi">${th("Otwórz")}</a></div><div class="ytrains" id="ytrains">${side}</div></aside></div>
        <div class="card mt4" id="ydetail">${detail}</div>`;
    },
    bind(page) {
      const T = this.T(), wh = whId(), S = Store.state, can = App.can("yard.edit"), A = Y.allocate(S, wh);
      bindMap(page, T, { edit: can && T.edit, alloc: A, onSelect: id => { T.sel = id; App.render(); } });
      const on = (id, fn) => { const el = $(id, page); if (el) el.onclick = fn; };
      on("#y-edit", () => { T.edit = !T.edit; App.render(); });
      on("#y-template", async () => { if ((await exec("yardobj.template", { whId: wh }, t("Wstawiono układ wzorcowy placu"))).ok) App.render(); });
      const cx = Math.round(T.view.x + T.view.w / 2), cy = Math.round(T.view.y + T.view.h / 2);
      on("#y-addpile", () => {
        const m = Modal.open({ title: t("Nowa pryzma"), wide: true, id: "pile-dialog", body: pileForm({ w: 40, h: 12, hei: 4, status: "AVAILABLE", shape: "pryzma", receivedDate: App.today() }, wh) + `<p class="help">${th("Ilość nie może przekroczyć stanu produktu w ewidencji magazynu pomniejszonego o inne pryzmy.")}</p>`,
          footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" id="pf-create">${ic("check", 15)} ${th("Utwórz pryzmę")}</button>` });
        $("[data-no]", m.el).onclick = () => m.close();
        $("#pf-create", m.el).onclick = async () => { const res = await exec("pile.save", Object.assign({ whId: wh, x: Math.max(20, Math.min(Y.AREA.w - 20, cx)), y: Math.max(20, Math.min(Y.AREA.h - 20, cy)), rot: 0 }, readPile(m.el))); if (!res.ok) return; m.close(); T.sel = res.pile.id; Toast.ok(t("Utworzono pryzmę {no}", { no: res.pile.no })); App.render(); };
      });
      const ai = $("#y-addinfra", page); if (ai) ai.onchange = async () => { if (!ai.value) return; const res = await exec("yardobj.save", { whId: wh, kind: ai.value, x: cx, y: cy }); if (res.ok) { T.sel = res.object.id; T.edit = true; } App.render(); };
      on("#pf-save", async () => { if ((await exec("pile.save", Object.assign({ id: T.sel }, readPile(page)), t("Zapisano pryzmę"))).ok) App.render(); });
      on("#if-save", async () => { const v = id => $(id, page).value; const a = await exec("yardobj.save", { id: T.sel, label: v("#if-label"), w: v("#if-w"), h: v("#if-h"), rot: v("#if-rot") }, t("Zapisano obiekt")); if (a.ok) App.render(); });
      on("#yd-del", async () => { const o = R.byId(S.yard, T.sel); const c = await Modal.confirm({ title: o.kind === "pile" ? t("Usunąć pryzmę {no} z planu placu?", { no: o.no }) : t("Usunąć obiekt z planu placu?"), text: o.kind === "pile" ? t("Stan magazynu się nie zmieni — ilość wróci do pozycji „poza pryzmami”.") : t("Obiekt zniknie z mapy."), ok: t("Usuń"), danger: true }); if (c.ok && (await exec("yardobj.remove", { id: o.id })).ok) { T.sel = null; App.render(); } });
      $$("[data-train]", page).forEach(b => b.onclick = () => { T.train = T.train === b.dataset.train ? "" : b.dataset.train; App.render(); });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Ekran: Terminarz pociągów                                           */
  /* ------------------------------------------------------------------ */
  Views.pociagi = {
    T() { return tab("trains", { view: "calendar", ym: Dates.ym(App.today()), all: false }); },
    html() {
      const S = Store.state, T = this.T(), wh = whId(), A = Y.allocate(S, wh), can = App.can("trains.edit");
      const all = Y.trains(S, wh).slice().sort((a, b) => (a.loadDate || a.arrivalDate) < (b.loadDate || b.arrivalDate) ? -1 : 1), list = T.all ? all : all.filter(Y.trainActive);
      const alloc = x => A.byTrain.get(x.id);
      const acts = x => `<a class="btn sm" href="#/zaladunek?train=${esc(x.id)}">${ic("play", 13)} ${th("Symulacja")}</a>${can && x.status !== "DONE" ? ` <button class="btn sm" type="button" data-tedit="${esc(x.id)}">${ic("edit", 13)} ${th("Edytuj")}</button>` : ""}${can && x.status !== "DONE" && x.status !== "LOADING" ? ` <button class="btn sm danger" type="button" data-tdel="${esc(x.id)}">${ic("trash", 13)}</button>` : ""}`;
      const cover = x => { const B = alloc(x); return !B ? (x.loadedQty ? `${fq(x.loadedQty)} MP · ${esc(x.opNo || "")}` : "—") : `${fq(B.total)} / ${fq(B.need)} MP${B.shortage > 0 ? ` <em class="neg">${esc(t("niedobór {q} MP", { q: fq(B.shortage) }))}</em>` : ""}`; };
      let body;
      if (T.view === "calendar") {
        const first = T.ym + "-01", start = Dates.weekStart(first), cells = [];
        for (let i = 0; i < 42; i++) { const d = Dates.addDays(start, i); if (i >= 35 && d.slice(0, 7) !== T.ym) break; cells.push(d); }
        body = `<div class="toolbar"><button class="btn ghost" type="button" id="tc-prev">←</button><b class="ycal-title">${esc(Dates.label(T.ym))}</b><button class="btn ghost" type="button" id="tc-next">→</button><button class="btn ghost" type="button" id="tc-today">${th("Dziś")}</button></div>
          <div class="ycal" id="train-cal">${[N_("Pn"), N_("Wt"), N_("Śr"), N_("Cz"), N_("Pt"), N_("So"), N_("Nd")].map(d => `<div class="ycal-h">${th(d)}</div>`).join("")}
          ${cells.map(d => `<div class="ycal-c ${d.slice(0, 7) !== T.ym ? "out" : ""} ${d === App.today() ? "today" : ""}" data-day="${d}"><span class="ycal-d">${Number(d.slice(8))}</span>${all.filter(x => (x.loadDate || x.arrivalDate) === d).map(x => `<button type="button" class="ycal-t ts-${esc(x.status)} ${A.next === x.id ? "next" : ""}" data-tedit="${esc(x.id)}" title="${esc(`${x.recipient || ""} · ${fq(x.reqQty)} MP · ${t(Y.TRAIN_STATUS[x.status])}`)}">${esc(x.loadStart || "")} ${esc(x.no)}</button>`).join("")}</div>`).join("")}</div>`;
      } else if (T.view === "list") {
        const days = [...new Set(list.map(x => x.loadDate || x.arrivalDate))];
        body = `<div class="ylist" id="train-list">${days.length ? days.map(d => `<div class="ylist-d"><h4>${esc(Dates.pl(d))}</h4>${list.filter(x => (x.loadDate || x.arrivalDate) === d).map(x => { const B = alloc(x); return `<div class="ylist-i ${A.next === x.id ? "next" : ""}"><div><b>${esc(x.no)}</b> ${tStatus(x)}<br><small>${esc(x.recipient || "")}${x.orderNo ? " · " + esc(t("zam. {n}", { n: x.orderNo })) : ""}</small></div>
            <div><small>${th("Przyjazd")}</small><br>${esc(Dates.pl(x.arrivalDate))} ${esc(x.arrivalTime || "")}</div><div><small>${th("Załadunek")}</small><br>${esc(x.loadStart || "—")}–${esc(x.loadEnd || "—")}</div>
            <div><small>${th("Biomasa")}</small><br>${cover(x)}</div><div><small>${th("Pryzmy")}</small><br>${B ? B.lines.map(l => esc((R.byId(S.yard, l.pileId) || {}).no)).join(", ") || "—" : "—"}</div><div class="r">${acts(x)}</div></div>`; }).join("")}</div>`).join("") : `<div class="empty">${th("Brak pociągów w terminarzu.")}</div>`}</div>`;
      } else {
        body = `<div class="tbl-wrap"><table class="tbl" id="train-table"><thead><tr><th>${th("Nr pociągu")}</th><th>${th("Odbiorca")}</th><th>${th("Przyjazd")}</th><th>${th("Załadunek")}</th><th class="r">${th("MP")}</th><th class="r">t</th><th>${th("Rodzaj biomasy")}</th><th>${th("Zamówienie")}</th><th>${th("Przygotowano")}</th><th>${th("Status")}</th><th></th></tr></thead><tbody>
          ${list.length ? list.map(x => `<tr class="${A.next === x.id ? "ynext-row" : ""}"><td class="mono nowrap">${esc(x.no)}</td><td>${esc(x.recipient || "")}</td><td class="nowrap">${esc(Dates.pl(x.arrivalDate))} ${esc(x.arrivalTime || "")}</td><td class="nowrap">${esc(Dates.pl(x.loadDate))} ${esc(x.loadStart || "")}${x.loadEnd ? "–" + esc(x.loadEnd) : ""}</td><td class="r">${esc(fq(x.reqQty))}</td><td class="r">${x.reqT ? esc(fq(x.reqT)) : "—"}</td>
            <td>${esc(x.productId ? (R.byId(S.products, x.productId) || {}).name : t("dowolna zrębka"))}</td><td>${esc(x.orderNo || "—")}</td><td class="nowrap">${cover(x)}</td><td>${tStatus(x)}</td><td class="r nowrap">${acts(x)}</td></tr>`).join("") : `<tr><td colspan="11" class="dim">${th("Brak pociągów w terminarzu.")}</td></tr>`}</tbody></table></div>`;
      }
      return `<div class="page-head"><div class="titles"><h2>${th("Terminarz pociągów")}</h2><p>${esc(t("Planowane transporty kolejowe z magazynu {w}. Po dodaniu terminu system sam wyznacza pryzmy do załadunku i pokazuje niedobór.", { w: App.whName(wh) }))}</p></div>
          <div class="actions">${can ? `<button class="btn primary" type="button" id="t-add">${ic("plus", 15)} ${th("Dodaj pociąg")}</button>` : ""}<a class="btn" href="#/plac">${ic("layers", 15)} ${th("Plan placu")}</a></div></div>
        ${nextBar(wh, A)}
        <div class="card mt4"><div class="toolbar"><div class="seg" role="tablist">${[["calendar", N_("Kalendarz")], ["list", N_("Lista")], ["table", N_("Tabela")]].map(([k, l]) => `<button type="button" role="tab" data-tview="${k}" aria-pressed="${T.view === k}">${th(l)}</button>`).join("")}</div>
          <label class="inline-opt"><input type="checkbox" id="t-all" ${T.all ? "checked" : ""}> ${th("Pokaż zakończone i anulowane")}</label></div>${body}</div>`;
    },
    bind(page) {
      const T = this.T(), wh = whId(), S = Store.state;
      $$("[data-tview]", page).forEach(b => b.onclick = () => { T.view = b.dataset.tview; App.render(); });
      const on = (id, fn) => { const el = $(id, page); if (el) el.onclick = fn; };
      on("#t-add", () => trainDialog(null, wh));
      on("#tc-prev", () => { T.ym = Dates.addMonths(T.ym, -1); App.render(); }); on("#tc-next", () => { T.ym = Dates.addMonths(T.ym, 1); App.render(); }); on("#tc-today", () => { T.ym = Dates.ym(App.today()); App.render(); });
      const al = $("#t-all", page); if (al) al.onchange = () => { T.all = al.checked; App.render(); };
      $$("[data-tedit]", page).forEach(b => b.onclick = e => { e.stopPropagation(); const x = R.byId(S.trains, b.dataset.tedit); if (!x) return; if (App.can("trains.edit") && x.status !== "DONE") trainDialog(x, wh); else location.hash = "#/zaladunek?train=" + x.id; });
      $$("[data-tdel]", page).forEach(b => b.onclick = () => removeTrain(R.byId(S.trains, b.dataset.tdel)));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Ekran: Symulacja i realizacja załadunku                             */
  /* ------------------------------------------------------------------ */
  const CRIT = { time: [N_("najkrótszy czas załadunku"), c => c.timeMin], route: [N_("najkrótsza trasa ładowarki"), c => c.routeM], piles: [N_("najmniej pryzm"), c => c.piles] };
  const hm = min => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
  function planModel(plan, train, c) {
    const S = Store.state, pg = Y.progress(plan);
    return { title: t("Plan załadunku pociągu {no}", { no: train.no }), subtitle: `${plan.name} · ${t(Y.PLAN_STATUS[plan.status])}`, orientation: "portrait", headerRight: App.whName(plan.whId), rangeText: trainWhen(train), whText: App.whName(plan.whId),
      meta: [[t("Pociąg"), train.no], [t("Odbiorca"), train.recipient || "—"], [t("Termin załadunku"), `${trainWhen(train)}${train.loadEnd ? "–" + train.loadEnd : ""}`], [t("Zapotrzebowanie"), `${fq(train.reqQty)} MP${train.reqT ? " · " + fq(train.reqT) + " t" : ""}`], [t("Wariant"), t(Y.STRATEGIES[plan.strategy])]],
      blocks: [{ type: "kpis", items: [[t("Do pobrania"), `${fq(c.mp)} MP`, `${fq(c.m3)} m³`], [t("Masa szacunkowa"), `${fq(c.t)} t`, ""], [t("Wagony"), String(c.wagons), t("śr. {q} MP na wagon", { q: fq(c.perWagon) })], [t("Czas szacunkowy"), hm(c.timeMin), t("{n} cykli ładowarki", { n: c.cycles })]] },
        { type: "h", text: t("Kolejność pobierania biomasy") },
        { type: "table", columns: [{ label: t("Lp."), w: 0.5 }, { label: t("Pryzma"), w: 2 }, { label: t("Pobrać MP"), w: 1, align: "right" }, { label: t("Odległość m"), w: 1, align: "right" }, { label: t("Cykle"), w: 0.8, align: "right" }, { label: t("W pryzmie przed"), w: 1.2, align: "right" }, { label: t("Zostanie"), w: 1, align: "right" }, { label: t("Pobrano MP"), w: 1.1, align: "right" }],
          rows: c.rows.map(r => { const a = plan.actual ? plan.actual.lines.find(l => l.pileId === r.pileId) : null; return [String(r.order), `${r.no} ${r.name}`, fq(r.qty), r.dist === null ? "—" : fq(r.dist), String(r.cycles), fq(r.before), fq(r.after), a && plan.status !== "APPROVED" ? fq(a.qty) : ""]; }),
          foot: [t("Razem"), "", fq(c.mp), "", String(c.cycles), "", "", plan.actual ? fq(pg.done) : ""], empty: t("Brak pryzm w planie."),
          note: t("Czas, liczba cykli i masa są szacunkowe — wynikają z parametrów wpisanych w symulacji (łyżka {b} m³, napełnienie {f}, cykl {c} s, ładowarki: {l}).", { b: fq(plan.params.bucketM3), f: fq(plan.params.fill), c: fq(plan.params.cycleSec), l: plan.params.loaders }) },
        { type: "signatures", labels: [t("Magazynier"), t("Operator ładowarki"), t("Kierownik")] }] };
  }
  Views.zaladunek = {
    T() { return tab("load", { trainId: "", crit: "time", proposals: null, edit: null, planId: "", view: { x: 0, y: 0, w: Y.AREA.w, h: Y.AREA.h } }); },
    html(params) {
      const S = Store.state, T = this.T(), wh = whId();
      if (params && params.train && R.byId(S.trains, params.train) && T.trainId !== params.train) { T.trainId = params.train; T.proposals = null; T.edit = null; T.planId = ""; }
      const trains = Y.trains(S, wh).slice().sort((a, b) => (a.loadDate || "") < (b.loadDate || "") ? 1 : -1);
      if (!trains.some(x => x.id === T.trainId)) { const q = Y.queue(S, wh); T.trainId = q.length ? q[0].id : (trains[0] || {}).id || ""; T.proposals = null; T.edit = null; T.planId = ""; }
      const train = R.byId(S.trains, T.trainId), canRun = App.can("load.run"), canAppr = App.can("trains.edit");
      const head = `<div class="page-head"><div class="titles"><h2>${th("Symulacja i realizacja załadunku")}</h2><p>${th("Wirtualny załadunek pociągu przed rozpoczęciem prac: dobór pryzm, kolejność, trasa ładowarki, wagony i czas. Symulacja nie zmienia stanów — stan zmienia dopiero zakończony załadunek (dokument WZ).")}</p></div>
        <div class="actions"><a class="btn" href="#/pociagi">${ic("calendar", 15)} ${th("Terminarz")}</a><a class="btn" href="#/operator">${ic("phone", 15)} ${th("Panel operatora")}</a></div></div>`;
      if (!train) return head + `<div class="card"><div class="empty">${th("Brak pociągów w terminarzu — dodaj pociąg, aby wykonać symulację.")}</div></div>`;
      const active = Y.trainActive(train), plans = Y.plans(S, train.id), P0 = Y.defaultParams(S.config);
      const calcOf = (lines, params) => Y.calc(S, train, lines, Object.assign({}, P0, params || {}));
      // porównanie wariantów: propozycje (niezapisane) + zapisane projekty
      const rows = (T.proposals || []).map((p, i) => ({ key: "p" + i, name: t(Y.STRATEGIES[p.strategy]), c: calcOf(p.lines, T.pparams), prop: i, strategy: p.strategy }))
        .concat(plans.filter(p => p.status !== "CANCELLED").map(p => ({ key: p.id, name: p.name, c: calcOf(p.lines, p.params), plan: p, strategy: p.strategy })));
      const fn = CRIT[T.crit][1], full = rows.filter(r => r.c.shortage <= 0 && r.c.piles), pool = full.length ? full : rows.filter(r => r.c.piles), best = pool.length ? pool.reduce((a, b) => fn(b.c) < fn(a.c) ? b : a) : null;
      const planActs = p => { const a = [];
        if (canRun && (p.status === "DRAFT" || (p.status === "APPROVED" && canAppr))) a.push(`<button class="btn sm" type="button" data-pedit="${esc(p.id)}">${ic("edit", 13)} ${th("Edytuj")}</button>`);
        if (canAppr && p.status === "DRAFT" && active) a.push(`<button class="btn sm primary" type="button" data-pact="approve" data-id="${esc(p.id)}">${ic("check", 13)} ${th("Zatwierdź plan")}</button>`);
        if (canAppr && p.status === "APPROVED") a.push(`<button class="btn sm" type="button" data-pact="unapprove" data-id="${esc(p.id)}">${ic("undo", 13)} ${th("Cofnij zatwierdzenie")}</button>`);
        if (canRun && p.status === "APPROVED" && !p.handedAt) a.push(`<button class="btn sm" type="button" data-pact="handover" data-id="${esc(p.id)}">${ic("phone", 13)} ${th("Przekaż operatorowi")}</button>`);
        if (["APPROVED", "RUNNING", "PAUSED", "DONE"].includes(p.status)) a.push(`<button class="btn sm ${T.planId === p.id ? "primary" : ""}" type="button" data-prun="${esc(p.id)}">${ic("play", 13)} ${th("Realizacja")}</button>`);
        a.push(`<button class="btn sm" type="button" data-pprint="${esc(p.id)}">${ic("print", 13)}</button><button class="btn sm" type="button" data-ppdf="${esc(p.id)}">${ic("pdf", 13)} PDF</button>`);
        if (canRun && (p.status === "DRAFT" || p.status === "CANCELLED")) a.push(`<button class="btn sm danger" type="button" data-pdel="${esc(p.id)}">${ic("trash", 13)}</button>`);
        return a.join(" "); };
      const cmp = `<div class="card mt4" id="load-variants"><div class="card-h"><h3>${th("Warianty symulacji")}</h3><span class="spacer"></span>
          ${fld("ld-crit", t("Najlepszy wg"), sel("ld-crit", Object.entries(CRIT).map(([k, x]) => [k, t(x[0])]), T.crit), "inline")}
          ${canRun && active ? `<button class="btn primary" type="button" id="ld-propose">${ic("play", 15)} ${th("Wylicz warianty A, B, C")}</button><button class="btn" type="button" id="ld-manual">${ic("plus", 15)} ${th("Wariant D — ręczny")}</button>` : ""}</div>
        <div class="tbl-wrap"><table class="tbl" id="load-table"><thead><tr><th>${th("Wariant")}</th><th>${th("Status")}</th><th class="r">${th("Pryzmy")}</th><th class="r">${th("MP")}</th><th class="r">${th("Niedobór")}</th><th class="r">${th("Trasa ładowarki")}</th><th class="r">${th("Czas (szac.)")}</th><th class="r">${th("Wagony")}</th><th></th></tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr class="${best && best.key === r.key ? "ybest" : ""}" data-var="${esc(r.key)}"><td><b>${esc(r.name)}</b>${best && best.key === r.key ? ` <span class="badge ps-APPROVED">${th("najkorzystniejszy")}</span>` : ""}${r.plan && r.plan.name !== t(Y.STRATEGIES[r.strategy]) ? `<br><small class="dim">${esc(t(Y.STRATEGIES[r.strategy]))}</small>` : ""}</td>
            <td>${r.plan ? pStatus(r.plan) + (r.plan.handedAt ? ` <small class="dim">${th("u operatora")}</small>` : "") : `<span class="dim">${th("propozycja — niezapisana")}</span>`}</td><td class="r">${r.c.piles}</td><td class="r">${esc(fq(r.c.mp))}</td><td class="r ${r.c.shortage > 0 ? "neg" : ""}">${r.c.shortage > 0 ? esc(fq(r.c.shortage)) : "—"}</td><td class="r">${esc(fq(r.c.routeM))} m</td><td class="r">${esc(hm(r.c.timeMin))}</td><td class="r">${r.c.wagons}</td>
            <td class="r nowrap">${r.plan ? planActs(r.plan) : `<button class="btn sm" type="button" data-propedit="${r.prop}">${ic("edit", 13)} ${th("Popraw")}</button> <button class="btn sm primary" type="button" data-propsave="${r.prop}">${ic("check", 13)} ${th("Zapisz projekt")}</button>`}</td></tr>`).join("")
            : `<tr><td colspan="9" class="dim">${th("Brak wariantów — wylicz propozycje systemu albo utwórz wariant ręczny.")}</td></tr>`}</tbody></table></div></div>`;
      // edytor wariantu
      let editor = "", marks = null, route = null;
      const E = T.edit;
      if (E) {
        const c = calcOf(E.lines, E.params), cand = Y.candidates(S, train, E.id).filter(x => !E.lines.some(l => l.pileId === x.pile.id)), freeOf = id => { const x = Y.candidates(S, train, E.id).find(k => k.pile.id === id); return x ? x.free : 0; };
        marks = new Map(E.lines.map((l, i) => [l.pileId, { order: i + 1, qty: l.qty }])); route = E.lines.map(l => l.pileId);
        const PL = [["wagonMP", N_("Ładowność wagonu [MP]")], ["wagons", N_("Liczba wagonów (puste = wylicz)")], ["loaders", N_("Ładowarki")], ["operators", N_("Operatorzy")], ["bucketM3", N_("Pojemność łyżki [m³]")], ["fill", N_("Współczynnik napełnienia")], ["cycleSec", N_("Czas cyklu [s]")], ["speedKmh", N_("Prędkość jazdy [km/h]")], ["switchMin", N_("Zmiana pryzmy [min]")]];
        editor = `<div class="card mt4" id="load-editor"><div class="card-h"><h3>${E.id ? esc(t("Edycja planu: {n}", { n: E.name })) : th("Nowy wariant symulacji")}</h3><span class="sub">${esc(t(Y.STRATEGIES[E.strategy]))}</span><span class="spacer"></span><button class="btn ghost" type="button" id="le-cancel">${th("Zamknij")}</button><button class="btn primary" type="button" id="le-save">${ic("check", 15)} ${th("Zapisz projekt")}</button></div>
          <div class="yedit"><div>
            ${fld("le-name", t("Nazwa wariantu"), inp("le-name", E.name, 'maxlength="60"'))}
            <div class="tbl-wrap"><table class="tbl" id="le-lines"><thead><tr><th>#</th><th>${th("Pryzma")}</th><th class="r">${th("Dostępne MP")}</th><th class="r">${th("Pobrać MP")}</th><th class="r">${th("Zostanie")}</th><th></th></tr></thead><tbody>
              ${E.lines.map((l, i) => { const p = R.byId(S.yard, l.pileId), r = c.rows[i]; return `<tr><td>${i + 1}</td><td>${esc(pileName(p))}<br><small class="dim">${r.dist === null ? "" : esc(t("{d} m od załadunku · {n} cykli", { d: fq(r.dist), n: r.cycles }))}</small></td><td class="r">${esc(fq(freeOf(l.pileId)))}</td><td class="r"><input class="ctrl sm r" data-lq="${i}" inputmode="decimal" value="${esc(fq(l.qty))}"></td><td class="r ${r.after < 0 ? "neg" : ""}">${esc(fq(r.after))}</td>
                <td class="r nowrap"><button class="btn sm" type="button" data-lup="${i}" ${i ? "" : "disabled"}>↑</button><button class="btn sm" type="button" data-ldn="${i}" ${i < E.lines.length - 1 ? "" : "disabled"}>↓</button><button class="btn sm danger" type="button" data-ldel="${i}">${ic("x", 12)}</button></td></tr>`; }).join("") || `<tr><td colspan="6" class="dim">${th("Dodaj pryzmy do planu.")}</td></tr>`}</tbody></table></div>
            <div class="toolbar" style="border:0;padding-left:0">${sel("le-add", [["", t("+ Dodaj pryzmę…")]].concat(cand.map(x => [x.pile.id, `${pileName(x.pile)} — ${fq(x.free)} MP${x.dist === null ? "" : ` · ${fq(x.dist)} m`}`])), "")}</div>
            <h4 class="mini-h">${th("Parametry symulacji (szacunkowe — do zmiany)")}</h4><div class="yform p3">${PL.map(([k, l]) => fld("lp-" + k, t(l), inp("lp-" + k, numIn(E.params[k]), `inputmode="decimal" data-lp="${k}"`))).join("")}</div></div>
            <div><div class="ykpis" id="le-calc">${[[t("Do pobrania"), `${fq(c.mp)} MP`, `${fq(c.m3)} m³ · ${fq(c.t)} t ${t("(szac.)")}`], [t("Zapotrzebowanie"), `${fq(c.need)} MP`, c.shortage > 0 ? t("niedobór {q} MP", { q: fq(c.shortage) }) : c.surplus > 0 ? t("nadwyżka {q} MP", { q: fq(c.surplus) }) : t("pokryte")], [t("Wagony"), String(c.wagons), t("śr. {q} MP na wagon", { q: fq(c.perWagon) })], [t("Czas załadunku (szac.)"), hm(c.timeMin), t("{n} cykli · trasa {m} m", { n: c.cycles, m: fq(c.routeM) })]]
              .map(([a, b, d], i) => `<div class="kpi ${i === 1 && c.shortage > 0 ? "warn" : ""}"><div class="k-t">${esc(a)}</div><div class="k-v">${esc(b)}</div><div class="k-s">${esc(d)}</div></div>`).join("")}</div>
            <div class="ymap-card small">${zoomBtns()}${mapSvg(wh, { view: T.view, marks, route, dim: o => o.kind === "pile" && !marks.has(o.id) })}</div></div></div></div>`;
      }
      // realizacja
      let run = "";
      const RP = T.planId ? plans.find(p => p.id === T.planId) : null;
      if (RP && !E) {
        const pg = Y.progress(RP), A = RP.actual, live = RP.status === "RUNNING" || RP.status === "PAUSED", c = calcOf(RP.lines, RP.params);
        marks = new Map(RP.lines.map((l, i) => [l.pileId, { order: i + 1, qty: l.qty }])); route = RP.lines.map(l => l.pileId);
        run = `<div class="card mt4" id="load-run"><div class="card-h"><h3>${esc(t("Realizacja: {n}", { n: RP.name }))}</h3>${pStatus(RP)}<span class="spacer"></span>
            ${canRun && RP.status === "APPROVED" ? `<button class="btn primary" type="button" data-pact="start" data-id="${esc(RP.id)}">${ic("play", 15)} ${th("Rozpocznij załadunek")}</button>` : ""}
            ${canRun && RP.status === "RUNNING" ? `<button class="btn" type="button" data-pact="pause" data-id="${esc(RP.id)}">${th("Wstrzymaj")}</button>` : ""}${canRun && RP.status === "PAUSED" ? `<button class="btn primary" type="button" data-pact="resume" data-id="${esc(RP.id)}">${th("Wznów")}</button>` : ""}
            ${canRun && live ? `<button class="btn" type="button" id="lr-save">${ic("check", 15)} ${th("Zapisz ilości")}</button><button class="btn primary" type="button" id="lr-finish">${ic("file", 15)} ${th("Zakończ załadunek — WZ")}</button>` : ""}</div>
          <div class="ykpis five" id="lr-progress">${[[t("Planowana ilość"), `${fq(pg.planned)} MP`], [t("Rzeczywiście załadowano"), `${fq(pg.done)} MP`], [t("Różnica"), `${pg.diff > 0 ? "+" : ""}${fq(pg.diff)} MP`], [t("Pozostało do załadunku"), `${fq(pg.left)} MP`], [t("Postęp"), `${pg.pct}%`]].map(([a, b]) => `<div class="kpi"><div class="k-t">${esc(a)}</div><div class="k-v">${esc(b)}</div></div>`).join("")}</div>
          <div class="ybar"><i style="width:${pg.pct}%"></i></div>
          <p class="muted pad">${A ? esc(t("Rozpoczęto: {a}{b}", { a: Dates.ts(A.startedAt), b: A.endedAt ? " · " + t("zakończono: {e}", { e: Dates.ts(A.endedAt) }) : "" })) + (RP.opNo ? ` · ${esc(t("dokument {no}", { no: RP.opNo }))} · ${esc(fq(A.weightT))} t` : "") : th("Załadunek jeszcze nie rozpoczęty — plan zatwierdzony, biomasa zarezerwowana.")}</p>
          <div class="yedit"><div><div class="tbl-wrap"><table class="tbl" id="lr-lines"><thead><tr><th>#</th><th>${th("Pryzma")}</th><th class="r">${th("Plan MP")}</th><th class="r">${th("Pobrano MP")}</th><th>${th("Wykorzystana")}</th></tr></thead><tbody>
              ${RP.lines.map((l, i) => { const a = A ? A.lines.find(x => x.pileId === l.pileId) : null; return `<tr><td>${i + 1}</td><td>${esc(pileName(R.byId(S.yard, l.pileId)))}</td><td class="r">${esc(fq(l.qty))}</td><td class="r">${live && canRun ? `<input class="ctrl sm r" data-aq="${esc(l.pileId)}" inputmode="decimal" value="${esc(fq(a ? a.qty : 0))}">` : esc(fq(a ? a.qty : 0))}</td><td>${live && canRun ? `<input type="checkbox" data-ad="${esc(l.pileId)}" ${a && a.done ? "checked" : ""}>` : a && a.done ? ic("check", 14) : "—"}</td></tr>`; }).join("")}</tbody></table></div>
            <h4 class="mini-h">${th("Wagony")}</h4><div class="tbl-wrap"><table class="tbl" id="lr-wagons"><thead><tr><th>${th("Wagon")}</th><th class="r">${th("Załadowano MP")}</th></tr></thead><tbody>
              ${(A ? A.wagons : []).concat(live && canRun ? [{ no: "", qty: "" }] : []).map((w, i) => live && canRun ? `<tr><td><input class="ctrl sm" data-wn="${i}" value="${esc(w.no)}" placeholder="${esc(t("nr wagonu"))}"></td><td class="r"><input class="ctrl sm r" data-wq="${i}" inputmode="decimal" value="${w.qty === "" ? "" : esc(fq(w.qty))}"></td></tr>` : `<tr><td>${esc(w.no)}</td><td class="r">${esc(fq(w.qty))}</td></tr>`).join("") || `<tr><td colspan="2" class="dim">${th("Brak wpisanych wagonów.")}</td></tr>`}</tbody></table></div>
            <p class="help">${esc(t("Plan: {w} wag. po ok. {q} MP. Suma w wagonach: {s} MP.", { w: c.wagons, q: fq(c.perWagon), s: fq(pg.wagons) }))}</p></div>
            <div class="ymap-card small">${zoomBtns()}${mapSvg(wh, { view: T.view, marks, route, dim: o => o.kind === "pile" && !marks.has(o.id) })}</div></div></div>`;
      }
      const A0 = Y.summary(S, train);
      return head + `<div class="card"><div class="toolbar">${fld("ld-train", t("Pociąg"), sel("ld-train", trains.map(x => [x.id, `${x.no} · ${trainWhen(x)} · ${x.recipient || ""} · ${t(Y.TRAIN_STATUS[x.status])}`]), T.trainId), "grow")}</div>
          <div class="ykpis five" id="ld-train-info">${[[t("Odbiorca"), train.recipient || "—"], [t("Termin załadunku"), trainWhen(train) + (train.loadEnd ? "–" + train.loadEnd : "")], [t("Wymagana ilość"), `${fq(train.reqQty)} MP${train.reqT ? " · " + fq(train.reqT) + " t" : ""}`], [t("Rodzaj biomasy"), train.productId ? (R.byId(S.products, train.productId) || {}).name : t("dowolna zrębka")], [t("Przydział automatyczny"), active ? `${fq(A0.total)} MP${A0.shortage > 0 ? " · " + t("niedobór {q} MP", { q: fq(A0.shortage) }) : ""}` : t(Y.TRAIN_STATUS[train.status])]].map(([a, b]) => `<div class="kpi"><div class="k-t">${esc(a)}</div><div class="k-v sm">${esc(b)}</div></div>`).join("")}</div></div>
        ${cmp}${editor}${run}`;
    },
    bind(page) {
      const T = this.T(), S = Store.state, wh = whId(), train = R.byId(S.trains, T.trainId);
      const tr = $("#ld-train", page); if (tr) tr.onchange = () => { T.trainId = tr.value; T.proposals = null; T.edit = null; T.planId = ""; history.replaceState(null, "", "#/zaladunek"); App.render(); };
      if (!train) return;
      const P0 = Y.defaultParams(S.config), on = (id, fn) => { const el = $(id, page); if (el) el.onclick = fn; };
      const cr = $("#ld-crit", page); if (cr) cr.onchange = () => { T.crit = cr.value; App.render(); };
      on("#ld-propose", () => { T.proposals = ["nearest", "fewest", "fastest"].map(s => ({ strategy: s, lines: Y.propose(S, train.id, s).lines })); T.edit = null; if (!T.proposals[0].lines.length) Toast.warn(t("Brak dostępnych pryzm"), t("Żadna pryzma nie spełnia wymagań tego pociągu albo wszystkie są zarezerwowane.")); App.render(); });
      const openEdit = (o) => { T.edit = { id: o.id || null, name: o.name || "", strategy: o.strategy, lines: o.lines.map(l => ({ pileId: l.pileId, qty: l.qty })), params: Object.assign({}, P0, o.params || {}) }; T.planId = ""; App.render(); };
      on("#ld-manual", () => openEdit({ strategy: "manual", lines: [], name: t(Y.STRATEGIES.manual) }));
      $$("[data-propedit]", page).forEach(b => b.onclick = () => { const p = T.proposals[+b.dataset.propedit]; openEdit({ strategy: p.strategy, lines: p.lines, name: t(Y.STRATEGIES[p.strategy]) }); });
      $$("[data-propsave]", page).forEach(b => b.onclick = async () => { const p = T.proposals[+b.dataset.propsave]; const res = await exec("load.save", { trainId: train.id, name: t(Y.STRATEGIES[p.strategy]), strategy: p.strategy, lines: p.lines }, t("Zapisano projekt symulacji")); if (res.ok) { T.proposals.splice(+b.dataset.propsave, 1); App.render(); } });
      $$("[data-pedit]", page).forEach(b => b.onclick = () => openEdit(R.byId(S.loadPlans, b.dataset.pedit)));
      $$("[data-pdel]", page).forEach(b => b.onclick = async () => { if ((await exec("load.remove", { id: b.dataset.pdel })).ok) App.render(); });
      $$("[data-prun]", page).forEach(b => b.onclick = () => { T.planId = T.planId === b.dataset.prun ? "" : b.dataset.prun; T.edit = null; App.render(); });
      const MSG = { approve: N_("Plan zatwierdzony — biomasa zarezerwowana"), unapprove: N_("Zatwierdzenie cofnięte — rezerwacja zwolniona"), handover: N_("Plan przekazany operatorowi ładowarki"), start: N_("Załadunek rozpoczęty"), pause: N_("Załadunek wstrzymany"), resume: N_("Załadunek wznowiony") };
      $$("[data-pact]", page).forEach(b => b.onclick = async () => { const res = await exec("load.action", { id: b.dataset.id, action: b.dataset.pact }, t(MSG[b.dataset.pact])); if (res.ok) { if (["approve", "start"].includes(b.dataset.pact)) T.planId = b.dataset.id; App.render(); } });
      const model = id => { const p = R.byId(S.loadPlans, id); return planModel(p, train, Y.calc(S, train, p.lines, p.params)); };
      $$("[data-pprint]", page).forEach(b => b.onclick = () => UI.Printer.print(model(b.dataset.pprint), "PLAN"));
      $$("[data-ppdf]", page).forEach(b => b.onclick = () => UI.Printer.pdf(model(b.dataset.ppdf), "PLAN", `plan_zaladunku_${train.no.replace(/[^\w-]+/g, "_")}`));
      // edytor
      const E = T.edit;
      if (E) {
        const num = v => { const n = R.NumParse.parse(v); return n.ok ? R.rq(n.value) : null; };
        $("#le-name", page).onchange = e => { E.name = e.target.value; };
        $$("[data-lq]", page).forEach(i => i.onchange = () => { const n = num(i.value); if (n !== null && n >= 0) E.lines[+i.dataset.lq].qty = n; App.render(); });
        $$("[data-lup]", page).forEach(b => b.onclick = () => { const i = +b.dataset.lup; E.lines.splice(i - 1, 0, E.lines.splice(i, 1)[0]); E.strategy = "manual"; App.render(); });
        $$("[data-ldn]", page).forEach(b => b.onclick = () => { const i = +b.dataset.ldn; E.lines.splice(i + 1, 0, E.lines.splice(i, 1)[0]); E.strategy = "manual"; App.render(); });
        $$("[data-ldel]", page).forEach(b => b.onclick = () => { E.lines.splice(+b.dataset.ldel, 1); E.strategy = "manual"; App.render(); });
        const add = $("#le-add", page); add.onchange = () => { if (!add.value) return; const c = Y.candidates(S, train, E.id).find(x => x.pile.id === add.value), left = Math.max(0, (Number(train.reqQty) || 0) - E.lines.reduce((s, l) => s + l.qty, 0)); E.lines.push({ pileId: add.value, qty: R.rq(Math.min(c.free, left || c.free)) }); E.strategy = "manual"; App.render(); };
        $$("[data-lp]", page).forEach(i => i.onchange = () => { const k = i.dataset.lp, n = num(i.value); E.params[k] = i.value.trim() === "" && k === "wagons" ? null : n === null ? E.params[k] : n; App.render(); });
        on("#le-cancel", () => { T.edit = null; App.render(); });
        on("#le-save", async () => { const res = await exec("load.save", Object.assign(E.id ? { id: E.id } : { trainId: train.id }, { name: $("#le-name", page).value, strategy: E.strategy, lines: E.lines, params: E.params }), t("Zapisano projekt symulacji")); if (res.ok) { T.edit = null; App.render(); } });
      }
      // realizacja
      const readRun = () => ({ id: T.planId, lines: $$("[data-aq]", page).map(i => ({ pileId: i.dataset.aq, qty: i.value, done: !!($(`[data-ad="${i.dataset.aq}"]`, page) || {}).checked })),
        wagons: $$("[data-wq]", page).map(i => ({ no: $(`[data-wn="${i.dataset.wq}"]`, page).value, qty: i.value })).filter(w => String(w.qty).trim() !== "" || w.no.trim() !== "").map(w => ({ no: w.no, qty: w.qty === "" ? 0 : w.qty })) });
      on("#lr-save", async () => { if ((await exec("load.record", readRun(), t("Zapisano pobrane ilości"))).ok) App.render(); });
      on("#lr-finish", async () => {
        const pre = await Store.exec("load.record", readRun(), SRC); if (!pre.ok && pre.code !== "NOCHANGE") return fail(pre);
        const p = R.byId(Store.state.loadPlans, T.planId), pg = Y.progress(p), pr = R.byId(S.products, p.productId) || {}, est = R.Units.mass(pg.done, pr, S.config);
        const m = Modal.open({ title: t("Zakończenie załadunku pociągu {no}", { no: train.no }), id: "finish-dialog",
          body: `<p class="muted">${esc(t("Powstanie dokument WZ na {q} MP ({p}) dla odbiorcy {b}. Stan magazynu i pryzmy zmniejszą się o rzeczywiście pobrane ilości.", { q: fq(pg.done), p: pr.name || "", b: train.recipient || "" }))}</p>
            <div class="yform">${fld("fn-price", t("Cena sprzedaży [zł/MP]"), inp("fn-price", "", 'inputmode="decimal"'))}${fld("fn-weight", t("Tonaż z ważenia [t]"), inp("fn-weight", "", `inputmode="decimal" placeholder="${esc(t("szac. {q}", { q: fq(est) }))}"`))}${fld("fn-date", t("Data dokumentu"), inp("fn-date", App.today(), `type="date" max="${esc(App.today())}"`))}</div>`,
          footer: `<button class="btn ghost" type="button" data-no>${th("Anuluj")}</button><button class="btn primary" type="button" id="fn-ok">${ic("check", 15)} ${th("Zakończ i wystaw WZ")}</button>` });
        $("[data-no]", m.el).onclick = () => m.close();
        $("#fn-ok", m.el).onclick = async () => { const res = await exec("load.finish", { id: T.planId, price: $("#fn-price", m.el).value, weightT: $("#fn-weight", m.el).value, date: $("#fn-date", m.el).value }); if (!res.ok) return; m.close(); Toast.ok(t("Załadunek zakończony"), t("Dokument {no}: {q} MP", { no: res.no, q: fq(pg.done) })); App.render(); };
      });
      if (E || T.planId) bindMap(page, T, { alloc: Y.allocate(S, wh) });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Ekran: Panel operatora ładowarki (telefon)                          */
  /* ------------------------------------------------------------------ */
  Views.operator = {
    T() { return tab("oper", { view: { x: 0, y: 0, w: Y.AREA.w, h: Y.AREA.h } }); },
    plan() { const S = Store.state, wh = whId(), L = S.loadPlans.filter(p => p.whId === wh); return L.find(p => p.status === "RUNNING" || p.status === "PAUSED") || L.filter(p => p.status === "APPROVED" && p.handedAt).sort((a, b) => a.handedAt < b.handedAt ? -1 : 1)[0] || null; },
    html() {
      const S = Store.state, T = this.T(), wh = whId(), p = this.plan(), can = App.can("load.run");
      const head = `<div class="page-head"><div class="titles"><h2>${th("Panel operatora ładowarki")}</h2><p>${esc(t("Magazyn {w} — plan przekazany przez magazyniera.", { w: App.whName(wh) }))}</p></div></div>`;
      if (!p) return head + `<div class="card"><div class="empty" id="op-empty">${th("Brak planu załadunku do realizacji. Plan pojawi się tutaj po zatwierdzeniu i przekazaniu operatorowi.")}</div></div>`;
      const train = R.byId(S.trains, p.trainId), pg = Y.progress(p), A = p.actual, live = p.status === "RUNNING" || p.status === "PAUSED";
      const isDone = l => { const a = A ? A.lines.find(x => x.pileId === l.pileId) : null; return !!(a && a.done); };
      const idx = p.lines.findIndex(l => !isDone(l)), cur = idx >= 0 ? p.lines[idx] : null, curP = cur ? R.byId(S.yard, cur.pileId) : null, curA = cur && A ? A.lines.find(x => x.pileId === cur.pileId) : null;
      const marks = new Map(p.lines.map((l, i) => [l.pileId, { order: i + 1, qty: l.qty }]));
      return head + `<div class="yop" id="op-panel"><div class="card yop-head"><div><small>${th("Pociąg")}</small><b>${esc(train.no)}</b><span>${esc(train.recipient || "")} · ${esc(trainWhen(train))}</span></div>
          <div><small>${th("Do załadunku")}</small><b>${esc(fq(pg.planned))} MP</b><span>${esc(t("załadowano {q} MP", { q: fq(pg.done) }))}</span></div>
          <div class="yop-pct"><b id="op-pct">${pg.pct}%</b><div class="ybar"><i style="width:${pg.pct}%"></i></div>${pStatus(p)}</div></div>
        ${cur ? `<div class="card yop-cur" id="op-current"><small>${esc(t("Pryzma {a} z {b}", { a: idx + 1, b: p.lines.length }))}</small><h3>${esc(pileName(curP))}</h3><p class="yop-q">${esc(t("Pobrać {q} MP", { q: fq(cur.qty) }))}</p>
            ${live && can ? `<div class="yop-in">${fld("op-qty", t("Pobrano [MP]"), inp("op-qty", fq(curA ? curA.qty : 0), 'inputmode="decimal"'))}<button class="btn" type="button" id="op-save">${th("Zapisz ilość")}</button><button class="btn primary lg" type="button" id="op-done">${ic("check", 16)} ${th("Pryzma wykorzystana — następna")}</button></div>`
              : p.status === "APPROVED" && can ? `<button class="btn primary lg block" type="button" id="op-start">${ic("play", 16)} ${th("Rozpocznij załadunek")}</button>` : ""}</div>`
          : `<div class="card yop-cur"><h3>${ic("check", 18)} ${th("Wszystkie pryzmy z planu wykorzystane")}</h3><p class="muted">${th("Magazynier kończy załadunek i wystawia dokument WZ.")}</p></div>`}
        <div class="card ymap-card small">${zoomBtns()}${mapSvg(wh, { view: T.view, marks, route: cur ? [cur.pileId] : null, dim: o => o.kind === "pile" && !marks.has(o.id) })}</div>
        <div class="card"><div class="card-h"><h3>${th("Kolejność pryzm")}</h3></div><ol class="yop-list" id="op-list">${p.lines.map((l, i) => { const a = A ? A.lines.find(x => x.pileId === l.pileId) : null; return `<li class="${isDone(l) ? "done" : i === idx ? "cur" : ""}"><b>${esc(pileName(R.byId(S.yard, l.pileId)))}</b><span>${esc(fq(l.qty))} MP${a && a.qty ? ` · ${esc(t("pobrano {q}", { q: fq(a.qty) }))}` : ""}</span></li>`; }).join("")}</ol></div></div>`;
    },
    bind(page) {
      const T = this.T(), p = this.plan(), wh = whId(); if (!p) return;
      bindMap(page, T, { alloc: Y.allocate(Store.state, wh) });
      const on = (id, fn) => { const el = $(id, page); if (el) el.onclick = fn; };
      on("#op-start", async () => { if ((await exec("load.action", { id: p.id, action: "start" }, t("Załadunek rozpoczęty"))).ok) App.render(); });
      const idx = p.lines.findIndex(l => !(p.actual && (p.actual.lines.find(x => x.pileId === l.pileId) || {}).done)), cur = p.lines[idx];
      const rec = async done => { const res = await exec("load.record", { id: p.id, lines: [{ pileId: cur.pileId, qty: $("#op-qty", page).value, done }] }, done ? t("Pryzma wykorzystana") : t("Zapisano pobraną ilość")); if (res.ok || res.code === "NOCHANGE") App.render(); };
      on("#op-save", () => rec(false)); on("#op-done", () => rec(true));
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
