/* Budowa aplikacji na telefon (Android, plik APK):  npm run build:android
   1. buduje program HTML (wersja firmowa + demonstracyjna) i kopiuje go do aplikacji (tryb „Bez serwera” i demo),
   2. generuje ikony z app/assets/icons/ric.svg (Playwright + Chromium),
   3. podpisuje APK kluczem firmy: RIW_KEYSTORE (+ RIW_KEYSTORE_PASS, RIW_KEY_ALIAS, RIW_KEY_PASS);
      bez zmiennych — klucz w mobile/android/keystore/ (tworzony przy pierwszej budowie, poza repozytorium).
      UWAGA: aktualizacje aplikacji muszą być podpisane TYM SAMYM kluczem — zachowaj folder keystore/ w kopii firmy.
   4. wynik: installer/Output/ResInvestERP_Android.apk
   Wymaga: Android SDK (ANDROID_HOME, platforma 35, build-tools 35), JDK 17+, Gradle 8.9+. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AND = join(ROOT, "mobile", "android");
const APP = join(AND, "app", "src", "main");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, Object.assign({ stdio: "inherit", cwd: ROOT }, opts));
const step = s => console.log(`\n== ${s}`);

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (existsSync("/opt/android-sdk") ? "/opt/android-sdk" : "");
if (!sdk || !existsSync(join(sdk, "platforms", "android-35"))) { console.error("Brak Android SDK (platforma android-35). Ustaw ANDROID_HOME."); process.exit(1); }

step("1/4 Program HTML (firmowy + demonstracyjny)");
if (!process.argv.includes("--skip-html")) { run(process.execPath, ["tools/build.mjs"]); run(process.execPath, ["tools/build.mjs", "--edition", "demo"]); }
mkdirSync(join(APP, "assets", "program"), { recursive: true });
for (const f of ["ResInvest_ERP.html", "ResInvest_ERP_Demo.html"]) copyFileSync(join(ROOT, f), join(APP, "assets", "program", f));

step("2/4 Ikony");
{
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const svg = readFileSync(join(ROOT, "app", "assets", "icons", "ric.svg"), "utf8");
  const DPI = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  for (const [d, s] of Object.entries(DPI)) {
    await page.setViewportSize({ width: s, height: s });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body></html>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
    mkdirSync(join(APP, "res", `mipmap-${d}`), { recursive: true });
    writeFileSync(join(APP, "res", `mipmap-${d}`, "ic_launcher.png"), png);
  }
  await browser.close();
}

step("3/4 Klucz podpisu");
const env = Object.assign({}, process.env, { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk });
if (!env.RIW_KEYSTORE) {
  const dir = join(AND, "keystore"), ks = join(dir, "resinvest-release.jks"), pw = join(dir, "HASLO-KLUCZA.txt");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(ks)) {
    const pass = randomBytes(18).toString("base64url");
    run("keytool", ["-genkeypair", "-keystore", ks, "-storetype", "PKCS12", "-alias", "resinvest", "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
      "-storepass", pass, "-keypass", pass, "-dname", "CN=ResInvest ERP, O=ResInvest, C=PL"], { stdio: "pipe" });
    writeFileSync(pw, `Klucz podpisu aplikacji ResInvest ERP (Android)\r\nPlik: resinvest-release.jks\r\nAlias: resinvest\r\nHasło: ${pass}\r\n\r\nZachowaj ten folder w bezpiecznym miejscu firmy. Bez tego klucza nie da się wydać aktualizacji aplikacji\r\n(telefon odrzuci nową wersję podpisaną innym kluczem — trzeba by odinstalować aplikację).\r\n`);
    console.log("Utworzono nowy klucz podpisu:", ks);
  }
  const pass = /Hasło: (\S+)/.exec(readFileSync(pw, "utf8"))[1];
  Object.assign(env, { RIW_KEYSTORE: ks, RIW_KEYSTORE_PASS: pass, RIW_KEY_ALIAS: "resinvest", RIW_KEY_PASS: pass });
}

step("4/4 Kompilacja APK (Gradle)");
writeFileSync(join(AND, "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "\\\\")}\n`);
const gradle = process.env.GRADLE || (existsSync("/opt/gradle/bin/gradle") ? "/opt/gradle/bin/gradle" : "gradle");
run(gradle, ["--no-daemon", "-q", "assembleRelease", `-PriwVersion=${pkg.version}`], { cwd: AND, env });
const apk = join(AND, "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!existsSync(apk)) { console.error("Brak pliku APK po kompilacji."); process.exit(1); }
const out = join(ROOT, "installer", "Output");
mkdirSync(out, { recursive: true });
const dest = join(out, "ResInvestERP_Android.apk");
copyFileSync(apk, dest);
const sha = createHash("sha256").update(readFileSync(dest)).digest("hex");
console.log(`\n${dest}  (${Math.round(statSync(dest).size / 1024)} kB)  SHA-256 ${sha}`);
