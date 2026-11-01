#!/usr/bin/env bash
# Klient demona przeglądarki QA: b.sh <port> '<json>'
# np.: qa/tools/b.sh 9301 '{"action":"observe"}'
set -euo pipefail
curl -sS --noproxy 127.0.0.1 --max-time 600 -X POST "http://127.0.0.1:$1/" -H 'content-type: application/json' --data-binary "$2"
echo
