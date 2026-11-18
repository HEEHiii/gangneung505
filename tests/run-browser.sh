#!/usr/bin/env bash
# ============================================================
#  브라우저 테스트
#
#  실행:  bash tests/run-browser.sh            (전부)
#         bash tests/run-browser.sh map        (map.spec.mjs 만)
#
#  ES 모듈은 file:// 로 열면 CORS 때문에 막히므로 작은 웹서버가
#  필요합니다. 여기서 알아서 띄우고 끝나면 내립니다.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=${PORT:-8080}
cd "$ROOT"

# 이미 떠 있으면 그걸 씁니다
STARTED=0
if ! curl -sf "http://localhost:$PORT/app/assets/geo.js" >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/trip-http.log 2>&1 &
  HTTP_PID=$!
  STARTED=1
  for _ in $(seq 1 40); do
    curl -sf "http://localhost:$PORT/app/assets/geo.js" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

cleanup() {
  if [ "$STARTED" = "1" ] && [ -n "${HTTP_PID:-}" ]; then
    kill "$HTTP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

WHICH=${1:-all}
fail=0

run_spec() {
  echo ""
  echo "════ $1 ════"
  node "tests/$1" || fail=1
}

if [ "$WHICH" = "all" ]; then
  for s in tests/*.spec.mjs; do run_spec "$(basename "$s")"; done
else
  run_spec "$WHICH.spec.mjs"
fi

exit $fail
