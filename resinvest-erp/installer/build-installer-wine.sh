#!/usr/bin/env bash
# Buduje instalator Windows ResInvest ERP na Linuksie (Wine + Inno Setup 6.4 z pakietu npm „innosetup”).
# Odpowiednik installer\build-installer.ps1 dla serwera budowania bez Windows.
# Wymagania: Node.js >= 22.13, wine64 + wine32 (Ubuntu: dpkg --add-architecture i386; apt install wine64 wine32:i386),
#            dostęp do registry.npmjs.org i nodejs.org.
# Uruchomienie z katalogu resinvest-erp:  bash installer/build-installer-wine.sh [--skip-tests]
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_VERSION="${NODE_VERSION:-22.22.2}"
WORK="${RIW_BUILD_DIR:-$(mktemp -d)}"
export WINEDEBUG=-all WINEPREFIX="$WORK/wineprefix"

echo "== 1/4 Budowanie ResInvest_ERP.html i danych przykładowych"
node tools/build.mjs
node tools/export-sample-data.mjs
node tools/i18n-extract.mjs

if [ "${1:-}" != "--skip-tests" ]; then
  echo "== 2/4 Testy jednostkowe i integracyjne"
  node --test tests/engine.test.mjs tests/features34.test.mjs tests/features35.test.mjs tests/features36.test.mjs tests/features38.test.mjs tests/features39.test.mjs tests/pdf.test.mjs tests/platform.test.mjs tests/server.test.mjs tests/auth.test.mjs tests/mail35.test.mjs tests/mail36.test.mjs tests/reg37.test.mjs tests/smtp.test.mjs tests/update.test.mjs tests/storage.test.mjs
fi

echo "== 3/4 Środowisko Node.js $NODE_VERSION (win-x64) — weryfikacja SHA-256"
mkdir -p installer/runtime
if [ ! -f installer/runtime/node.exe ] || [ "$(cat installer/runtime/VERSION.txt 2>/dev/null)" != "$NODE_VERSION" ]; then
  zip="node-v$NODE_VERSION-win-x64.zip"
  curl -fsSL -o "$WORK/$zip" "https://nodejs.org/dist/v$NODE_VERSION/$zip"
  curl -fsSL -o "$WORK/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  expected=$(grep " $zip\$" "$WORK/SHASUMS256.txt" | cut -d' ' -f1)
  actual=$(sha256sum "$WORK/$zip" | cut -d' ' -f1)
  [ "$expected" = "$actual" ] || { echo "Suma SHA-256 archiwum Node.js nie zgadza się"; exit 1; }
  python3 - "$WORK/$zip" "$NODE_VERSION" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1]); d = f"node-v{sys.argv[2]}-win-x64/"
open("installer/runtime/node.exe", "wb").write(z.read(d + "node.exe"))
open("installer/runtime/LICENSE-node.txt", "wb").write(z.read(d + "LICENSE"))
PY
  printf "%s" "$NODE_VERSION" > installer/runtime/VERSION.txt
fi

echo "== 4/4 Kompilacja instalatora (Inno Setup 6.4, Wine)"
( cd "$WORK" && npm pack innosetup@6.4.1 --silent >/dev/null && mkdir -p is && tar xzf innosetup-6.4.1.tgz -C is )
wine "$WORK/is/package/bin/ISCC.exe" /Q "installer\\ResInvestERP.iss"
ls -la installer/Output/ResInvestERP_Setup_*.exe
sha256sum installer/Output/ResInvestERP_Setup_*.exe
