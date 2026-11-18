#!/usr/bin/env bash
# ============================================================
#  마이그레이션과 함수를 로컬 PostgreSQL 에 올려서 돌려봅니다.
#
#  실행:  bash tests/sql/run.sh
#
#  왜 필요한가: PL/pgSQL 함수 본문은 만들 때 문법만 보고 지나갑니다.
#  오타 하나가 "마이그레이션 성공"으로 보이고, 실제로는 사용자가
#  방을 만드는 순간 터집니다. Supabase SQL 편집기에 붙여넣기 전에
#  여기서 먼저 걸러냅니다.
#
#  일회용 클러스터를 만들고 끝나면 지웁니다. 아무것도 남기지 않습니다.
# ============================================================
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK=${WORK:-/var/tmp/pgcheck}
PORT=${PORT:-55432}
PSQL="$PGBIN/psql -h $WORK/run -p $PORT"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "PostgreSQL 이 없습니다: $PGBIN" >&2
  echo "PGBIN=/usr/lib/postgresql/<버전>/bin 으로 지정하세요." >&2
  exit 2
fi

# postgres 사용자로 돌려야 하므로 (initdb 는 root 를 거부합니다)
AS_PG="su postgres -c"
if [ "$(id -u)" != "0" ]; then AS_PG="bash -c"; fi

cleanup() {
  $AS_PG "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "── 일회용 클러스터 준비"
rm -rf "$WORK"
mkdir -p "$WORK/data" "$WORK/run" "$WORK/sql"
cp "$ROOT"/tests/sql/prelude.sql "$ROOT"/tests/sql/test.sql "$ROOT"/supabase/migrations/*.sql "$WORK/sql/"
if [ "$(id -u)" = "0" ]; then chown -R postgres "$WORK"; fi

$AS_PG "$PGBIN/initdb -D $WORK/data -A trust -E UTF8 --locale=C" >"$WORK/initdb.log" 2>&1
$AS_PG "$PGBIN/pg_ctl -D $WORK/data -o \"-k $WORK/run -p $PORT -c listen_addresses=''\" -l $WORK/pg.log start -w" >/dev/null

$AS_PG "$PSQL -d postgres -qc 'create database trip'"

run() { $AS_PG "$PSQL -d trip -v ON_ERROR_STOP=1 -q -f $WORK/sql/$1"; }

echo "── Supabase 뼈대 (auth 스키마, anon/authenticated 역할)"
run prelude.sql

echo "── 0001_schema.sql"
run 0001_schema.sql

echo "── 0002_rpc.sql"
run 0002_rpc.sql

echo "── 다시 실행해도 안전한지 (여러 번 붙여넣는 경우)"
run 0001_schema.sql
run 0002_rpc.sql

echo "── 기능 테스트"
$AS_PG "$PSQL -d trip -v ON_ERROR_STOP=1 -f $WORK/sql/test.sql"
