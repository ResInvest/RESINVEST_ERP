/* Praca nad wyglądem programu:  npm run dev   [-- --edition demo|premium]
   Obserwuje app/src i app/assets; po każdym zapisie pliku buduje program od nowa (ok. 1–2 s).
   Otwórz zbudowany plik (ResInvest_ERP.html / _Demo / _Premium) w przeglądarce i odśwież stronę (F5) po zmianie.
   Ctrl+C — koniec. */
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let timer = null, running = false, again = false;

function build() {
  if (running) { again = true; return; }
  running = true;
  const t0 = Date.now();
  const p = spawn(process.execPath, [join(ROOT, "tools", "build.mjs"), ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
  p.on("close", code => {
    running = false;
    const line = out.trim().split("\n").pop();
    console.log(code === 0 ? `[${new Date().toLocaleTimeString("pl-PL")}] ${line} (${Date.now() - t0} ms) — odśwież przeglądarkę (F5)` : `BŁĄD BUDOWY:\n${out}`);
    if (again) { again = false; build(); }
  });
}
for (const dir of ["app/src", "app/assets"]) {
  watch(join(ROOT, dir), { recursive: true }, (ev, file) => {
    if (!file || /(^|[\\/])\.|~$|\.swp$/.test(file)) return;
    clearTimeout(timer); timer = setTimeout(() => { console.log(`zmiana: ${dir}/${file}`); build(); }, 250);
  });
}
console.log("Obserwuję app/src i app/assets — zapisz plik, a program zbuduje się sam. Ctrl+C kończy.");
build();
