// @ts-check
/* =========================================================================
   AI Document Scanner Test — kontrola przesłanego obrazu

   Typ pliku jest rozpoznawany po sygnaturze bajtów (nie po nazwie / nagłówku
   przeglądarki). Obsługiwane formaty = formaty przyjmowane przez providery AI:
   JPEG, PNG, WEBP, GIF. Zdjęcia HEIC z telefonów konwertuje przeglądarka
   (canvas → JPEG) jeszcze przed wysłaniem.
   ========================================================================= */
import { createHash } from "node:crypto";

export const SUPPORTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** @param {Buffer} buf @returns {string|null} */
export function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  const gif = buf.toString("ascii", 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  return null;
}

/**
 * Wymiary obrazu z nagłówka (bez dekodowania). Zwraca null, gdy nie da się odczytać.
 * @param {Buffer} buf
 * @param {string} mime
 * @returns {{ width: number, height: number }|null}
 */
export function imageSize(buf, mime) {
  try {
    if (mime === "image/png") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === "image/gif") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === "image/webp") {
      const chunk = buf.toString("ascii", 12, 16);
      if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      return null;
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch { /* uszkodzony nagłówek */ }
  return null;
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Pełna kontrola obrazu przed analizą.
 * @param {Buffer} buf
 * @param {{ maxBytes: number, minSide: number, maxSide: number }} limits
 * @returns {{ ok: true, mime: string, width: number|null, height: number|null, sha256: string } | { ok: false, status: number, error: string }}
 */
export function inspectImage(buf, limits) {
  if (!buf || !buf.length) return { ok: false, status: 400, error: "Brak pliku obrazu." };
  if (buf.length > limits.maxBytes) return { ok: false, status: 413, error: `Plik jest za duży (maks. ${Math.round(limits.maxBytes / 1024 / 1024)} MB).` };
  const mime = sniffMime(buf);
  if (!mime) return { ok: false, status: 415, error: "Nieobsługiwany format pliku. Dozwolone: JPEG, PNG, WEBP, GIF." };
  const size = imageSize(buf, mime);
  if (size) {
    if (Math.min(size.width, size.height) < limits.minSide) return { ok: false, status: 422, error: `Zdjęcie ma za małą rozdzielczość (${size.width}×${size.height}). Dokument będzie nieczytelny.` };
    if (Math.max(size.width, size.height) > limits.maxSide) return { ok: false, status: 422, error: `Zdjęcie jest za duże (${size.width}×${size.height}, maks. ${limits.maxSide} px na dłuższym boku).` };
  }
  return { ok: true, mime, width: size ? size.width : null, height: size ? size.height : null, sha256: sha256(buf) };
}
