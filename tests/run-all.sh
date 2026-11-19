#!/usr/bin/env bash
# ============================================================
#  전부 검증
#
#  실행:  bash tests/run-all.sh
#
#  묶음별로 나눠 돕니다.
#    0) 설정 검사      config.js 에 비밀 키가 섞였는지, 반쪽만 찼는지
#    1) 데이터 검증    지역·좌표 파일의 손으로 적은 값
#    2) 순수 함수      거리·날짜·좌표 계산
#    3) 계약 검증      JS 가 보내는 인자와 SQL 함수 서명이 같은지
#    4) SQL            일회용 PostgreSQL 에 올려서 권한·격리·잠김 확인
#    5) 브라우저        지도·저장소 (가짜 카카오 SDK, 네트워크 없음)
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pass=0; fail=0
results=()

step() {
  local name="$1"; shift
  echo ""
  echo "════════ $name ════════"
  if "$@"; then
    pass=$((pass+1)); results+=("  통과   $name")
  else
    fail=$((fail+1)); results+=("  실패   $name")
  fi
}

step "설정 (config.js)"  node tests/config.check.mjs
step "지역·POI 데이터"   node tests/regions.check.mjs
step "순수 함수"         node tests/util.check.mjs
step "링크 파싱"         node tests/places.check.mjs
step "RPC 계약"          node tests/rpc-contract.check.mjs

if [ -x /usr/lib/postgresql/16/bin/initdb ] || [ -n "${PGBIN:-}" ]; then
  step "SQL (스키마·권한·격리)" bash tests/sql/run.sh
else
  echo ""
  echo "════════ SQL ════════"
  echo "  건너뜀 — PostgreSQL 이 없습니다 (PGBIN 으로 지정할 수 있습니다)"
  results+=("  건너뜀 SQL")
fi

step "브라우저 (지도·저장소)" bash tests/run-browser.sh

echo ""
echo "════════ 정리 ════════"
printf '%s\n' "${results[@]}"
echo ""
if [ "$fail" = "0" ]; then
  echo "전부 통과 ($pass 묶음)"
else
  echo "실패 $fail 묶음 / 통과 $pass 묶음"
fi
exit $([ "$fail" = "0" ] && echo 0 || echo 1)
