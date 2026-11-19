// Start programu.
(async function boot() {
  try { const t = localStorage.getItem('gri-theme'); if (t) applyTheme(t); } catch { /* */ }
  if (!window.jspdf || !window.fflate) { $('#app').replaceChildren(h('div', { class: 'boot' }, 'Plik programu jest uszkodzony (brak bibliotek). Pobierz GenResInvest.html ponownie.')); return; }
  await Store.init();
  await pickProfile();
  buildShell();
  route();
  window.GRI = { Store, Docs, buildDocModel, renderPdf, renderDocx }; // dostęp diagnostyczny i testy
}());
