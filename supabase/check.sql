-- ============================================================
--  설치가 제대로 됐는지 확인하기
--
--  Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run.
--  표가 하나 나오고, 모든 줄이 ✅ 면 정상입니다.
--
--  ★ 왜 필요한가
--  SQL Editor 는 중간에 멈춰도 앞부분까지는 저장합니다. 그래서
--  "Success" 를 봤어도 뒷부분이 안 들어갔을 수 있고, 그 상태로는
--  방을 만드는 순간에야 터집니다. 여기서 미리 걸러냅니다.
--
--  아무것도 바꾸지 않습니다. 읽기만 합니다. 여러 번 돌려도 됩니다.
-- ============================================================

with
expected_tables(name) as (values
  ('rooms'), ('places'), ('votes'), ('room_sessions'),
  ('join_attempts'), ('rate_events'), ('config')
),
-- 링크를 받은 친구(손님)가 쓰는 기능
guest_funcs(name) as (values
  ('health'), ('room_peek'), ('room_join'), ('room_snapshot'),
  ('place_add'), ('place_remove'), ('vote_set'), ('room_touch')
),
-- 방을 만든 사람만 쓰는 기능 — 손님에게 열리면 안 됩니다
owner_funcs(name) as (values
  ('room_create'), ('room_list_mine'), ('room_resume'),
  ('room_set_password'), ('room_delete')
),
expected_funcs(name) as (
  select name from guest_funcs union all select name from owner_funcs
),

got_tables as (
  select tablename as name from pg_tables where schemaname = 'app'
),
got_funcs as (
  select p.proname as name, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
granted_anon as (
  select p.proname as name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
),
granted_auth as (
  select p.proname as name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
),
rls_off as (
  select c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind = 'r' and not c.relrowsecurity
),
leaky as (   -- 표가 public 에 있으면 주소만으로 전부 읽힙니다
  select tablename as name from pg_tables
  where schemaname = 'public' and tablename in (select name from expected_tables)
),
loose as (   -- search_path 를 고정하지 않은 SECURITY DEFINER 함수
  select name from got_funcs
  where prosecdef
    and not coalesce(array_to_string(proconfig, ',') like '%search_path=%', false)
),

checks(sort, 항목, ok, 설명) as (
  select 1, '1. 암호화 도구 (pgcrypto)',
    exists (select 1 from pg_extension where extname = 'pgcrypto'),
    '비밀번호를 안전하게 저장하는 데 씁니다'

  union all select 2, '2. 표 7개',
    (select count(*) from got_tables g join expected_tables e using (name)) = 7,
    coalesce('빠짐: ' || (select string_agg(name, ', ' order by name)
                          from expected_tables
                          where name not in (select name from got_tables)),
             '전부 있음')

  union all select 3, '3. 기능 13개',
    (select count(*) from got_funcs g join expected_funcs e using (name)) = 13,
    coalesce('빠짐: ' || (select string_agg(name, ', ' order by name)
                          from expected_funcs
                          where name not in (select name from got_funcs)),
             '전부 있음')

  union all select 4, '4. 친구가 쓸 기능 8개가 열림',
    (select count(*) from granted_anon g join guest_funcs e using (name)) = 8,
    coalesce('안 열림: ' || (select string_agg(name, ', ' order by name)
                             from guest_funcs
                             where name not in (select name from granted_anon)),
             '입장·투표·장소추가 전부 가능')

  union all select 5, '5. 방장 기능 5개가 로그인 전용',
    (select count(*) from granted_auth g join owner_funcs e using (name)) = 5,
    coalesce('안 열림: ' || (select string_agg(name, ', ' order by name)
                             from owner_funcs
                             where name not in (select name from granted_auth)),
             '로그인한 사람만 쓸 수 있음')

  -- ★ 여기가 제일 중요합니다. 이게 뚫리면 링크를 받은 누구나
  --    남의 방을 지우거나 비밀번호를 바꿀 수 있습니다.
  union all select 6, '6. 손님은 방 삭제·비번변경 불가',
    not exists (select 1 from owner_funcs where name in (select name from granted_anon)),
    coalesce('⚠ 손님에게 열려 있음: ' || (select string_agg(name, ', ' order by name)
                                          from owner_funcs
                                          where name in (select name from granted_anon)),
             '막혀 있음')

  union all select 7, '7. 표 직접 접근 차단 (RLS)',
    not exists (select 1 from rls_off),
    coalesce('꺼져 있음: ' || (select string_agg(name, ', ' order by name) from rls_off),
             '모든 표에 켜져 있음')

  union all select 8, '8. 표가 바깥에 노출 안 됨',
    not exists (select 1 from leaky),
    coalesce('public 에 있음: ' || (select string_agg(name, ', ' order by name) from leaky),
             'app 안에만 있어 주소로 못 읽습니다')

  union all select 9, '9. 함수 search_path 고정',
    not exists (select 1 from loose),
    coalesce('안 고정됨: ' || (select string_agg(name, ', ' order by name) from loose),
             '전부 고정됨')

  union all select 10, '10. 비밀 소금값 생성됨',
    exists (select 1 from app.config where id = 1 and length(pepper) >= 32),
    '입장 시도 횟수를 셀 때 씁니다'
)

select
  case when ok then '✅' else '❌ 다시 하세요' end  as "결과",
  항목,
  설명
from checks
order by sort;
