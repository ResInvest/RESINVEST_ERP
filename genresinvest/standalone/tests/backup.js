// Test kopii zapasowej: dane → plik .json → czysta przeglądarka → przywrócenie → te same dokumenty.
// Użycie: node standalone/tests/backup.js <katalog_na_wyniki> <ścieżka do dist/GenResInvest.html>
const { chromium } = require('playwright');
const OUT = process.argv[2]; const FILE = 'file://' + process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const a = await browser.newContext({ acceptDownloads: true, colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const p = await a.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(FILE); await p.click('button:has-text("Rozpocznij pracę")'); await p.waitForSelector('text=Dzień dobry');
  // dokument przez API diagnostyczne (logika domenowa) — szybkie przygotowanie danych
  const n = await p.evaluate(async () => {
    const { Store, Docs } = window.GRI;
    const c = Store.state.contractors.find((x) => x.name.startsWith('DRENO'));
    const d = { ...emptyData('zamowienie'), contractorId: c.id, subject: 'Zrębka drzewna', pickup: 'Nowy Sącz', quantity: 500000, price: 9000 };
    const r = await Docs.saveDraft('zamowienie', null, d);
    await Docs.issue(r.id);
    return Store.state.documents.length;
  });
  await p.goto(FILE + '#/zamowienia/nowe'); await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/dark-editor.png` });
  await p.goto(FILE + '#/ustawienia'); await p.waitForSelector('text=Zapisz kopię wszystkich danych');
  const dl = p.waitForEvent('download'); await p.click('button:has-text("Zapisz kopię wszystkich danych")');
  const file = `${OUT}/kopia.json`; await (await dl).saveAs(file);
  // czysta przeglądarka
  const b = await browser.newContext({ acceptDownloads: true });
  const q = await b.newPage(); q.on('pageerror', (e) => errors.push(e.message));
  await q.goto(FILE); await q.click('button:has-text("Rozpocznij pracę")'); await q.waitForSelector('text=Dzień dobry');
  const before = await q.evaluate(() => window.GRI.Store.state.documents.length);
  await q.goto(FILE + '#/ustawienia'); await q.waitForSelector('text=Przywróć z pliku');
  await q.setInputFiles('.panel input[type=file]', file);
  await q.click('button:has-text("Przywróć")'); await q.click('dialog button:has-text("Przywróć")');
  await q.waitForTimeout(800);
  const after = await q.evaluate(() => ({ n: window.GRI.Store.state.documents.length, num: window.GRI.Store.state.documents[0]?.number }));
  // uszkodzony plik musi zostać odrzucony
  const fs = require('fs'); const bad = JSON.parse(fs.readFileSync(file, 'utf8')); bad.state.documents[0].number = 'PODMIANA'; fs.writeFileSync(`${OUT}/zla.json`, JSON.stringify(bad));
  await q.setInputFiles('.panel input[type=file]', `${OUT}/zla.json`);
  await q.click('button:has-text("Przywróć")'); await q.click('dialog button:has-text("Przywróć")'); await q.waitForTimeout(500);
  const toast = await q.textContent('.toast.error').catch(() => '');
  console.log(JSON.stringify({ source: n, freshBefore: before, restored: after, tamperRejected: /suma kontrolna/.test(toast), errors }));
  await browser.close();
  if (after.n !== n || before !== 0 || !/suma kontrolna/.test(toast) || errors.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
