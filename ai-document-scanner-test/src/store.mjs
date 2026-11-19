// @ts-check
/* =========================================================================
   AI Document Scanner Test — IZOLOWANY magazyn wyników testowych

   * Pliki JSON + obraz w osobnym katalogu (domyślnie data-test/scans) —
     bez połączenia z bazą ResInvest ERP. Każdy rekord ma testOnly = true
     i erpPosted = false; moduł nie ma żadnej ścieżki zapisu do ERP.
   * Zapis atomowy: plik tymczasowy → fsync → rename (brak połowicznych plików
     po awarii zasilania).
   * Ochrona przed nadpisaniem: każda korekta podaje numer rewizji (rev);
     niezgodność = 409 (ktoś inny zmienił wynik w międzyczasie).
   * Historia korekt: pole, było, jest, kto, kiedy — wynik AI jest zamrożony
     w aiResult i nigdy nie jest nadpisywany.
   ========================================================================= */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { assertIsolatedDataDir } from "./config.mjs";

export const RECORD_SCHEMA = 1;
const ID_RE = /^scan_[a-z0-9]{6,12}_[a-f0-9]{8}$/;

export class StoreError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) { super(message); this.name = "StoreError"; this.status = status; }
}

export function isValidId(id) { return typeof id === "string" && ID_RE.test(id); }
export function newId() { return `scan_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`; }

/** Zapis atomowy pliku. */
export function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  writeFileSync(tmp, data);
  const fd = openSync(tmp, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}

export class ScanStore {
  /** @param {string} dataDir */
  constructor(dataDir) {
    assertIsolatedDataDir(dataDir);
    this.dir = join(dataDir, "scans");
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(dataDir, "README-TEST-DATA.txt"),
      "Dane testowe modułu AI Document Scanner Test.\r\nTO NIE SĄ dokumenty ResInvest ERP — nie mają wpływu na stany magazynowe.\r\nKatalog można bezpiecznie usunąć.\r\n");
    /** @type {Map<string, Promise<any>>} */
    this.locks = new Map();
  }

  file(id) {
    if (!isValidId(id)) throw new StoreError("Nieprawidłowy identyfikator wyniku.", 400);
    return join(this.dir, `${id}.json`);
  }

  /** Serializacja operacji na jednym rekordzie (brak wyścigów w obrębie procesu). */
  async withLock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.locks.set(id, run);
    try { return await run; }
    finally { if (this.locks.get(id) === run) this.locks.delete(id); }
  }

  /**
   * @param {{ image: { buffer: Buffer|null, mime: string, ext: string, width: number|null, height: number|null, sha256: string, originalName: string|null }, provider: any, hintType: string|null, result: any, erpMatches: any }} input
   */
  create(input) {
    const id = newId();
    const now = new Date().toISOString();
    let imageFile = null;
    if (input.image.buffer) {
      imageFile = `${id}.${input.image.ext}`;
      atomicWrite(join(this.dir, imageFile), input.image.buffer);
    }
    const rec = {
      id, schema: RECORD_SCHEMA, rev: 1,
      testOnly: true, erpPosted: false,
      status: "ANALYZED",
      createdAt: now, updatedAt: now,
      image: { file: imageFile, mime: input.image.mime, width: input.image.width, height: input.image.height, sha256: input.image.sha256, bytes: input.image.buffer ? input.image.buffer.length : null, originalName: input.image.originalName },
      provider: input.provider,
      hintType: input.hintType,
      aiResult: structuredClone(input.result),
      result: input.result,
      erpMatches: input.erpMatches,
      corrections: []
    };
    atomicWrite(this.file(id), JSON.stringify(rec, null, 1));
    return rec;
  }

  get(id) {
    const f = this.file(id);
    if (!existsSync(f)) throw new StoreError("Nie znaleziono wyniku testowego.", 404);
    return JSON.parse(readFileSync(f, "utf8"));
  }

  imagePath(id) {
    const rec = this.get(id);
    if (!rec.image || !rec.image.file) throw new StoreError("Wynik nie ma zapisanego obrazu.", 404);
    return { path: join(this.dir, rec.image.file), mime: rec.image.mime };
  }

  /**
   * Zmiana rekordu z kontrolą rewizji.
   * @param {string} id @param {number} rev @param {(rec: any) => void} mutate
   */
  async update(id, rev, mutate) {
    return this.withLock(id, () => {
      const rec = this.get(id);
      if (!Number.isInteger(rev) || rev !== rec.rev) throw new StoreError(`Wynik został zmieniony w międzyczasie (rewizja ${rec.rev}, a edytowano ${rev}). Odśwież i popraw ponownie.`, 409);
      mutate(rec);
      rec.rev += 1;
      rec.updatedAt = new Date().toISOString();
      rec.testOnly = true; rec.erpPosted = false; // niezmienniki izolacji
      atomicWrite(this.file(id), JSON.stringify(rec, null, 1));
      return rec;
    });
  }

  list(limit = 100) {
    const out = [];
    for (const f of readdirSync(this.dir).filter(x => x.endsWith(".json"))) {
      try {
        const r = JSON.parse(readFileSync(join(this.dir, f), "utf8"));
        out.push({
          id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, status: r.status, rev: r.rev,
          docType: r.result && r.result.docType ? r.result.docType.value : null,
          docTypeConfidence: r.result && r.result.docType ? r.result.docType.confidence : null,
          docNumber: r.result && r.result.fields && r.result.fields.docNumber ? r.result.fields.docNumber.value : null,
          docDate: r.result && r.result.fields && r.result.fields.docDate ? r.result.fields.docDate.value : null,
          vehicleReg: r.result && r.result.fields && r.result.fields.vehicleReg ? r.result.fields.vehicleReg.value : null,
          provider: r.provider ? r.provider.name : null, simulated: !!(r.provider && r.provider.simulated),
          corrections: (r.corrections || []).length
        });
      } catch { /* uszkodzony plik testowy — pomijamy */ }
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
  }

  async remove(id) {
    return this.withLock(id, () => {
      const rec = this.get(id);
      if (rec.image && rec.image.file) rmSync(join(this.dir, rec.image.file), { force: true });
      rmSync(this.file(id), { force: true });
      return { id, removed: true };
    });
  }
}
