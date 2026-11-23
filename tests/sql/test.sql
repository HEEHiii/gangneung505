-- ============================================================
--  함수·권한 기능 테스트
--
--  실행: tests/sql/run.sh
--
--  PL/pgSQL 함수 본문은 만들 때 문법만 보고, 실제 오류는 돌려봐야
--  나옵니다. 그래서 "마이그레이션이 올라갔다"는 아무 보증이 아닙니다.
--
--  특히 다음 네 가지는 설계의 핵심 주장이므로 반드시 통과해야 합니다.
--    1) anon 은 테이블을 직접 못 읽는다
--    2) A 방 토큰으로 B 방을 건드릴 수 없다
--    3) 비밀번호를 많이 틀리면 잠긴다
--    4) 방장의 투표에도 auth.uid() 가 새지 않는다
-- ============================================================

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ---------- 작은 단정 도우미 ----------
create or replace function pg_temp.ok(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice '  OK    %', p_what;
  else
    raise exception 'FAIL: %', p_what;
  end if;
end $$;

-- 호출이 특정 코드로 실패해야 함을 확인합니다
create or replace function pg_temp.must_fail(p_sql text, p_code text, p_what text)
returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := SQLERRM;
    if position(p_code in v_msg) > 0 then
      raise notice '  OK    % → %', p_what, left(v_msg, 60);
      return;
    end if;
    raise exception 'FAIL: % — 기대한 %, 실제: %', p_what, p_code, v_msg;
  end;
  raise exception 'FAIL: % — 실패해야 하는데 성공했습니다', p_what;
end $$;


-- room_join 은 예외가 아니라 {ok, code, message} 를 돌려줍니다
-- (실패 기록이 롤백되지 않게 하려고 — 0002_rpc.sql 의 주석 참고)
create or replace function pg_temp.join_code(p_slug text, p_pw text)
returns text language sql as $$
  select public.room_join(p_slug, p_pw) ->> 'code';
$$;


-- ============================================================
--  준비: 가짜 카카오 사용자 둘
-- ============================================================
\echo '── 준비'
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.test')
on conflict (id) do nothing;

select pg_temp.ok(count(*) = 2, '테스트 사용자 2명') from auth.users;

-- 중간 결과를 들고 다닐 표.
-- role 을 바꿔가며 테스트하므로 postgres 가 만들고 모두에게 열어둡니다
-- (안 그러면 set role anon 이후에 "permission denied for table t" 가 납니다)
drop table if exists t;
create table t (k text primary key, v text);
grant all on t to anon, authenticated;


-- ============================================================
--  1. 로그인 없이는 방을 만들 수 없다
-- ============================================================
\echo '── 1. 방 만들기'
set role authenticated;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

select pg_temp.must_fail(
  $$ select public.room_create('무단', '2027-01-23', '2027-01-24', 4,
       'gangneung', '강릉', 37.75, 128.88, 8, null, '0505') $$,
  '[auth]', '로그인 없이 방 생성');

-- ★ 회귀 테스트: JWT 클레임이 깨져 있으면 "로그인 안 됨"으로 취급해야 합니다.
--   auth.uid() 를 그대로 쓰면 JSON 파싱 예외가 사용자에게 그대로 나갔습니다.
select set_config('request.jwt.claims', '', false);
select pg_temp.must_fail(
  $$ select public.room_create('깨진토큰','2027-01-23','2027-01-24',4,null,'강릉',37.75,128.88,8,null,'0505') $$,
  '[auth]', '빈 JWT 클레임은 로그인 안 된 것으로 취급');

select set_config('request.jwt.claims', 'not-json-at-all', false);
select pg_temp.must_fail(
  $$ select public.room_create('깨진토큰2','2027-01-23','2027-01-24',4,null,'강릉',37.75,128.88,8,null,'0505') $$,
  '[auth]', '깨진 JWT 클레임도 로그인 안 된 것으로 취급');

select set_config('request.jwt.claims', '{"role":"anon"}', false);

-- ---------- 방장으로 로그인 ----------
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', false);

insert into t
select 'room1', (public.room_create(
  '겨울 강릉', '2027-01-23', '2027-01-24', 4,
  'gangneung', '강릉', 37.7519, 128.8761, 8,
  '{"name":"강릉역","lat":37.7637,"lng":128.8990}'::jsonb,
  '0505', '{"theme":"winter"}'::jsonb))::text;

select pg_temp.ok((select (v::jsonb ->> 'slug') from t where k = 'room1') ~ '^[23456789BCDFGHJKMNPQRSTVWXZ]{9}$',
  'slug 가 모음 없는 9자');
select pg_temp.ok(length((select v::jsonb ->> 'token' from t where k = 'room1')) >= 40,
  '방장이 방 토큰을 함께 받음');

-- 비밀번호가 평문으로 남아 있지 않은지
reset role;
select pg_temp.ok(pw_hash like '$2%' and pw_hash <> '0505', 'bcrypt 로 저장됨 (평문 아님)')
  from app.rooms limit 1;

-- 짧은 비밀번호 거부
set role authenticated;
select pg_temp.must_fail(
  $$ select public.room_create('짧은비번','2027-03-01','2027-03-02',2,null,'아무데나',37.5,127.0,8,null,'12') $$,
  '[limit]', '비밀번호 4자 미만 거부');

-- 날짜가 거꾸로면 제약이 막는다
select pg_temp.must_fail(
  $$ select public.room_create('거꾸로','2027-03-05','2027-03-01',2,null,'아무데나',37.5,127.0,8,null,'0505') $$,
  'rooms_dates_sane', '종료일이 시작일보다 이르면 거부');

-- 15일 초과 거부
select pg_temp.must_fail(
  $$ select public.room_create('장기','2027-03-01','2027-03-20',2,null,'아무데나',37.5,127.0,8,null,'0505') $$,
  'rooms_dates_sane', '14일 초과 거부');


-- ============================================================
--  2. 입장 — 틀린 비밀번호와 잠김
-- ============================================================
\echo '── 2. 입장'
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

insert into t select 'slug1', (select v::jsonb ->> 'slug' from t where k = 'room1');

select pg_temp.ok(pg_temp.join_code((select v from t where k = 'slug1'), '9999') = 'nomatch',
  '틀린 비밀번호 거부');

-- 없는 방도 똑같은 코드 (방 존재 여부를 알려주지 않습니다)
select pg_temp.ok(pg_temp.join_code('ZZZZZZZZZ', '0505') = 'nomatch',
  '없는 방도 같은 코드 (존재 여부 안 알려줌)');

-- 맞는 비밀번호
insert into t select 'tok1', (public.room_join((select v from t where k = 'slug1'), '0505'))::text;
select pg_temp.ok((select (v::jsonb ->> 'ok')::boolean from t where k = 'tok1'), '맞는 비밀번호는 ok=true');
select pg_temp.ok(length((select v::jsonb ->> 'token' from t where k = 'tok1')) >= 40, '맞는 비밀번호로 토큰 발급');

-- 토큰 원문이 DB 에 없는지 (해시만 저장)
reset role;
select pg_temp.ok(
  not exists (
    select 1 from app.room_sessions
     where token_hash = (select (v::jsonb ->> 'token') from t where k = 'tok1')::bytea
  ), '토큰 원문은 저장되지 않음 (해시만)');

-- ---------- 잠김: 10번 틀리면 11번째가 막힌다 ----------
--
-- ★ 이 테스트가 실제로 심각한 버그를 잡았습니다.
--   처음에는 room_join 이 실패 기록을 insert 한 뒤 raise exception 했는데,
--   PostgreSQL 에서 raise 는 트랜잭션을 되감으므로 그 insert 가 함께
--   사라졌습니다. 그래서 몇 번을 틀려도 횟수가 0 이었고, 무차별 대입
--   방어가 조용히 작동하지 않았습니다.
--
--   아래 do 블록도 같은 함정이 있어서 statement 마다 따로 호출합니다.
--   (do 블록 안에서 exception 을 잡으면 그 안의 insert 도 되감깁니다)
-- 앞선 테스트에서 이미 한 번 틀렸으므로 기준을 0 으로 맞춥니다
reset role;
delete from app.join_attempts;

set role anon;
select pg_temp.join_code((select v from t where k = 'slug1'), '0000');
select pg_temp.join_code((select v from t where k = 'slug1'), '0001');
select pg_temp.join_code((select v from t where k = 'slug1'), '0002');
select pg_temp.join_code((select v from t where k = 'slug1'), '0003');
select pg_temp.join_code((select v from t where k = 'slug1'), '0004');
select pg_temp.join_code((select v from t where k = 'slug1'), '0005');
select pg_temp.join_code((select v from t where k = 'slug1'), '0006');
select pg_temp.join_code((select v from t where k = 'slug1'), '0007');
select pg_temp.join_code((select v from t where k = 'slug1'), '0008');

reset role;
select pg_temp.ok((select count(*) from app.join_attempts) = 9,
  '실패 기록이 실제로 남음 (예외로 롤백되지 않음)');

set role anon;
select pg_temp.ok(pg_temp.join_code((select v from t where k = 'slug1'), '0009') = 'nomatch',
  '10번째 실패까지는 아직 nomatch');
select pg_temp.ok(pg_temp.join_code((select v from t where k = 'slug1'), '0505') = 'locked',
  '10번 틀린 뒤 잠김 — 맞는 비밀번호여도 거부');

-- 다음 테스트를 위해 실패 기록을 비웁니다
reset role;
delete from app.join_attempts;


-- ============================================================
--  3. 위조 토큰
-- ============================================================
\echo '── 3. 토큰 검증'
set role anon;
select pg_temp.must_fail(
  $$ select public.room_snapshot('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'v1') $$,
  '[expired]', '위조 토큰 거부');
select pg_temp.must_fail(
  $$ select public.room_snapshot('짧음', 'v1') $$,
  '[expired]', '짧은 토큰 거부');
select pg_temp.must_fail(
  $$ select public.room_snapshot(null, 'v1') $$,
  '[expired]', 'null 토큰 거부');


-- ============================================================
--  4. 장소와 투표
-- ============================================================
\echo '── 4. 장소 · 투표'
insert into t select 'place1', (public.place_add(
  (select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-A',
  '{"kind":"lodging","name":"오붓한강릉","lat":37.8250,"lng":128.8780,
    "note":"사천해변 도보권","approx":true,"source":"link"}'::jsonb))::text;

select pg_temp.ok((select v::jsonb ->> 'id' from t where k = 'place1') is not null, '숙소 추가');

-- 투표: 서로 다른 두 사람
select public.vote_set((select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-A',
  (select (v::jsonb ->> 'id')::uuid from t where k = 'place1'), true);
insert into t select 'cnt2', (public.vote_set(
  (select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-B',
  (select (v::jsonb ->> 'id')::uuid from t where k = 'place1'), true))::text;

select pg_temp.ok((select (v::jsonb ->> 'count')::int from t where k = 'cnt2') = 2, '두 사람 투표 → 2표');

-- 같은 사람이 두 번 눌러도 1표 (unique 제약)
insert into t select 'cnt3', (public.vote_set(
  (select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-A',
  (select (v::jsonb ->> 'id')::uuid from t where k = 'place1'), true))::text;
select pg_temp.ok((select (v::jsonb ->> 'count')::int from t where k = 'cnt3') = 2, '같은 사람 재투표는 중복 안 됨');

-- 취소
insert into t select 'cnt4', (public.vote_set(
  (select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-B',
  (select (v::jsonb ->> 'id')::uuid from t where k = 'place1'), false))::text;
select pg_temp.ok((select (v::jsonb ->> 'count')::int from t where k = 'cnt4') = 1, '취소하면 1표');

-- 남의 장소는 못 지운다
select pg_temp.must_fail(
  format($$ select public.place_remove(%L, 'voter-B', %L) $$,
    (select v::jsonb ->> 'token' from t where k = 'tok1'),
    (select v::jsonb ->> 'id' from t where k = 'place1')),
  '[denied]', '남이 넣은 장소는 못 지움');


-- ============================================================
--  5. 스냅샷
-- ============================================================
\echo '── 5. 스냅샷'
insert into t select 'snap', (public.room_snapshot(
  (select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-A'))::text;

select pg_temp.ok((select v::jsonb -> 'room' ->> 'title' from t where k = 'snap') = '겨울 강릉', '방 제목');
select pg_temp.ok((select v::jsonb -> 'room' ->> 'region_name' from t where k = 'snap') = '강릉', '지역 이름');
select pg_temp.ok((select v::jsonb -> 'room' -> 'settings' ->> 'theme' from t where k = 'snap') = 'winter', '테마 전달');
select pg_temp.ok((select v::jsonb -> 'room' ->> 'hub' from t where k = 'snap') is not null, 'hub 전달');
select pg_temp.ok((select jsonb_array_length(v::jsonb -> 'places') from t where k = 'snap') = 1, '장소 1곳');
select pg_temp.ok((select jsonb_array_length(v::jsonb -> 'mine') from t where k = 'snap') = 1, 'voter-A 의 내 투표 1건');
select pg_temp.ok((select (v::jsonb -> 'places' -> 0 ->> 'mine')::boolean from t where k = 'snap'), 'voter-A 가 넣은 장소에 mine=true');

-- ★ 비밀번호 해시가 스냅샷에 섞여 나가지 않아야 합니다
select pg_temp.ok((select position('$2' in v) = 0 from t where k = 'snap'), '스냅샷에 비밀번호 해시 없음');
select pg_temp.ok((select position('pw_hash' in v) = 0 from t where k = 'snap'), '스냅샷에 pw_hash 필드 없음');

-- p_since: 바뀐 게 없으면 수십 바이트만
insert into t select 'snap2', (public.room_snapshot(
  (select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-A',
  (select (v::jsonb ->> 'updated_at')::timestamptz from t where k = 'snap')))::text;
select pg_temp.ok((select (v::jsonb ->> 'unchanged')::boolean from t where k = 'snap2'), 'p_since 로 변경 없음 확인');
select pg_temp.ok((select length(v) < 120 from t where k = 'snap2'), '변경 없을 때 응답이 작음 (전송량 절약)');


-- ============================================================
--  6. 방 격리 — A 토큰으로 B 방을 못 건드린다
-- ============================================================
\echo '── 5.5 게이트 정보 (room_peek)'
set role anon;

insert into t select 'peek', (public.room_peek((select v from t where k = 'slug1')))::text;

select pg_temp.ok((select v::jsonb ->> 'title' from t where k = 'peek') = '겨울 강릉', '여행 이름이 보인다');
select pg_temp.ok((select v::jsonb ->> 'theme' from t where k = 'peek') = 'winter', '테마가 보인다 (게이트부터 계절 적용)');

/* ★ 여기부터가 핵심입니다 — 내용은 비밀번호 뒤에 남아야 합니다.
   이 경계가 무너지면 링크만 퍼져도 방이 다 열립니다. */
select pg_temp.ok((select position('오붓한강릉' in v) = 0 from t where k = 'peek'), '숙소 이름이 새지 않는다');
select pg_temp.ok((select position('$2'   in v) = 0 from t where k = 'peek'), '비밀번호 해시가 새지 않는다');
select pg_temp.ok((select position('places' in v) = 0 from t where k = 'peek'), '장소 목록이 없다');
select pg_temp.ok((select position('counts' in v) = 0 from t where k = 'peek'), '투표 집계가 없다');
select pg_temp.ok((select position('voter'  in v) = 0 from t where k = 'peek'), '투표자 정보가 없다');
select pg_temp.ok((select position('hub'    in v) = 0 from t where k = 'peek'), '출발 지점 좌표도 없다');
/* 제목에 지역 이름이 들어가는 경우가 많으므로("겨울 강릉") 문자열로
   찾으면 안 되고, 어떤 키를 돌려주는지로 확인해야 합니다. */
select pg_temp.ok((select v::jsonb ? 'start_date' from t where k = 'peek') = false, '날짜 키가 없다');
select pg_temp.ok((select v::jsonb ? 'end_date'   from t where k = 'peek') = false, '종료일 키가 없다');
select pg_temp.ok((select v::jsonb ? 'region_name' from t where k = 'peek') = false, '지역 키가 없다');
select pg_temp.ok((select v::jsonb ? 'people'     from t where k = 'peek') = false, '인원 키가 없다');
select pg_temp.ok((select v::jsonb ? 'hub'        from t where k = 'peek') = false, 'hub 키가 없다');
select pg_temp.ok(
  (select count(*) from jsonb_object_keys((select v::jsonb from t where k = 'peek'))) = 2,
  '돌려주는 항목이 정확히 2개 (이름·테마) — 화면에 안 쓰는 값은 보내지 않는다');

-- 없는 방과 이상한 주소는 조용히 null
select pg_temp.ok(public.room_peek('ZZZZZZZZZ') is null, '없는 방은 null');
select pg_temp.ok(public.room_peek('짧음')      is null, '모양이 안 맞는 주소는 조회조차 안 함');
select pg_temp.ok(public.room_peek('')          is null, '빈 문자열은 null');
select pg_temp.ok(public.room_peek(null)        is null, 'null 입력은 null');
select pg_temp.ok(public.room_peek('AEIOUAEIO') is null, '알파벳 밖 글자(모음)는 null');

-- 손으로 소문자로 쳐도 찾아줍니다
select pg_temp.ok(
  (public.room_peek(lower((select v from t where k = 'slug1'))) ->> 'title') = '겨울 강릉',
  '소문자로 쳐도 찾아준다');

/* ★ 링크만 아는 사람이 방을 영원히 살려두면 안 됩니다.
   peek 이 last_seen_at 을 갱신하면 오래된 방 정리가 무력해집니다. */
reset role;
insert into t select 'seen_before',
  (select last_seen_at from app.rooms where slug = (select v from t where k = 'slug1'))::text;
set role anon;
select public.room_peek((select v from t where k = 'slug1'));
reset role;
select pg_temp.ok(
  (select last_seen_at from app.rooms where slug = (select v from t where k = 'slug1'))::text
    = (select v from t where k = 'seen_before'),
  'peek 전후로 last_seen_at 이 같다 (링크만으로 방을 살려둘 수 없음)');


\echo '── 6. 방 격리'
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', false);

insert into t select 'room2', (public.room_create(
  '다른 사람 여행', '2027-05-01', '2027-05-03', 2,
  'jeju', '제주', 33.38, 126.55, 11, null, '7777'))::text;

-- B 방 장소를 A 방 토큰으로 지우려 하면?
insert into t select 'place2', (public.place_add(
  (select v::jsonb ->> 'token' from t where k = 'room2'), 'voter-C',
  '{"kind":"food","name":"제주 흑돼지","lat":33.50,"lng":126.53}'::jsonb))::text;

set role anon;
select pg_temp.must_fail(
  format($$ select public.place_remove(%L, 'voter-C', %L) $$,
    (select v::jsonb ->> 'token' from t where k = 'tok1'),     -- A 방 토큰
    (select v::jsonb ->> 'id' from t where k = 'place2')),      -- B 방 장소
  '[denied]', 'A 방 토큰으로 B 방 장소 삭제 불가');

select pg_temp.must_fail(
  format($$ select public.vote_set(%L, 'voter-C', %L, true) $$,
    (select v::jsonb ->> 'token' from t where k = 'tok1'),
    (select v::jsonb ->> 'id' from t where k = 'place2')),
  '[denied]', 'A 방 토큰으로 B 방 장소에 투표 불가');

-- A 방 스냅샷에 B 방 장소가 섞이지 않는지
insert into t select 'snapA', (public.room_snapshot(
  (select v::jsonb ->> 'token' from t where k = 'tok1'), 'voter-A'))::text;
select pg_temp.ok((select position('제주 흑돼지' in v) = 0 from t where k = 'snapA'),
  'A 방 스냅샷에 B 방 데이터 없음');


-- ============================================================
--  7. 방장 전용 기능
-- ============================================================
\echo '── 7. 방장 권한'
set role authenticated;

-- 남의 방 비밀번호를 바꾸려 하면 (지금은 other 로 로그인된 상태)
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', false);
select pg_temp.must_fail(
  format($$ select public.room_set_password(%L, '1234') $$, (select v from t where k = 'slug1')),
  '[denied]', '남의 방 비밀번호 변경 불가');
select pg_temp.must_fail(
  format($$ select public.room_delete(%L) $$, (select v from t where k = 'slug1')),
  '[denied]', '남의 방 삭제 불가');
select pg_temp.must_fail(
  format($$ select public.room_resume(%L) $$, (select v from t where k = 'slug1')),
  '[denied]', '남의 방 재입장 불가');

-- 내 방 목록은 내 것만
insert into t select 'mine2', (public.room_list_mine())::text;
select pg_temp.ok((select jsonb_array_length(v::jsonb) from t where k = 'mine2') = 1, '내가 만든 방만 보임');
select pg_temp.ok((select position('겨울 강릉' in v) = 0 from t where k = 'mine2'), '남의 방은 목록에 없음');

-- ---------- 방장으로 돌아가서 ----------
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', false);

-- 비밀번호 없이 재입장
insert into t select 'resume', (public.room_resume((select v from t where k = 'slug1')))::text;
select pg_temp.ok(length((select v::jsonb ->> 'token' from t where k = 'resume')) >= 40,
  '방장은 비밀번호 없이 재입장 (분실 문제가 아예 없음)');

-- ★ 비밀번호 교체 = 접근 회수. 기존 토큰이 전부 죽어야 합니다
select public.room_set_password((select v from t where k = 'slug1'), '8888');

set role anon;
select pg_temp.must_fail(
  format($$ select public.room_snapshot(%L, 'voter-A') $$,
    (select v::jsonb ->> 'token' from t where k = 'tok1')),
  '[expired]', '비밀번호 교체 후 기존 토큰 무효 (접근 회수)');
select pg_temp.ok(pg_temp.join_code((select v from t where k = 'slug1'), '0505') = 'nomatch',
  '교체 후 옛 비밀번호 실패');
insert into t select 'tok1b', (public.room_join((select v from t where k = 'slug1'), '8888'))::text;
select pg_temp.ok(length((select v::jsonb ->> 'token' from t where k = 'tok1b')) >= 40, '새 비밀번호로 입장');


-- ============================================================
--  8. 방장의 익명성 — 여기가 조용히 깨지기 쉬운 곳입니다
-- ============================================================
\echo '── 8. 방장 익명성'
set role anon;
select public.vote_set((select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-OWNER',
  (select (v::jsonb ->> 'id')::uuid from t where k = 'place1'), true);

reset role;
select pg_temp.ok(
  not exists (
    select 1 from app.votes
     where voter_key in ('11111111-1111-1111-1111-111111111111',
                         '22222222-2222-2222-2222-222222222222')
  ), '투표 테이블에 auth.uid() 가 새지 않음');
select pg_temp.ok(
  not exists (
    select 1 from app.places
     where created_by in ('11111111-1111-1111-1111-111111111111',
                          '22222222-2222-2222-2222-222222222222')
  ), '장소 테이블에 auth.uid() 가 새지 않음');


-- ============================================================
--  9. anon 은 테이블을 직접 못 읽는다 (가장 중요한 주장)
-- ============================================================
\echo '── 9. 테이블 직접 접근 차단'
set role anon;
select pg_temp.must_fail($$ select * from app.rooms $$,          'permission denied', 'anon 이 app.rooms 직접 조회 불가');
select pg_temp.must_fail($$ select * from app.places $$,         'permission denied', 'anon 이 app.places 직접 조회 불가');
select pg_temp.must_fail($$ select * from app.votes $$,          'permission denied', 'anon 이 app.votes 직접 조회 불가');
select pg_temp.must_fail($$ select * from app.room_sessions $$,  'permission denied', 'anon 이 app.room_sessions 직접 조회 불가');
select pg_temp.must_fail($$ select * from app.config $$,         'permission denied', 'anon 이 pepper 조회 불가');
select pg_temp.must_fail($$ select app.room_from_token('x') $$,  'permission denied', 'anon 이 내부 함수 직접 호출 불가');
select pg_temp.must_fail($$ select app.new_slug() $$,            'permission denied', 'anon 이 app.new_slug 호출 불가');

set role authenticated;
select pg_temp.must_fail($$ select * from app.rooms $$, 'permission denied', 'authenticated 도 테이블 직접 조회 불가');

-- anon 은 방을 만들 수 없다 (GRANT 가 authenticated 에만 있음)
set role anon;
select pg_temp.must_fail(
  $$ select public.room_create('x','2027-01-01','2027-01-02',2,null,'x',37.5,127.0,8,null,'0505') $$,
  'permission denied', 'anon 은 room_create 실행 권한 없음');
select pg_temp.must_fail($$ select public.room_list_mine() $$, 'permission denied', 'anon 은 room_list_mine 권한 없음');


-- ============================================================
--  9.5 경비 정산
--
--  ★ 친구도 적고 지울 수 있어야 합니다. 총무 한 명만 적게 하면
--    결국 카톡으로 불러주고 총무가 받아적는 꼴이 됩니다.
--    그래서 쓰기는 "친구 입장(anon)" 으로 합니다.
--
--  ★ 검증 구문은 reset role 로 돌아와서 합니다.
--    anon 은 app 스키마를 직접 못 읽는 게 정상이고, 그게 이 설계의
--    핵심이라 테스트가 그 벽을 뚫으려 하면 안 됩니다.
-- ============================================================
\echo '── 9.5 경비 정산'
-- 7절에서 비밀번호를 바꿔 tok1 은 이미 무효입니다. 그때 다시 받은 tok1b 를 씁니다.

reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

insert into t select 'ex1', (public.expense_add(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A', '숙소', 200000, '민수')) ->> 'id';
insert into t select 'ex2', (public.expense_add(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-B', '회', 90000, '지아')) ->> 'id';

-- 스냅샷은 친구도 부를 수 있어야 합니다 (화면이 읽는 유일한 경로)
insert into t select 'esnap', (public.room_snapshot(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A'))::text;

reset role;
select pg_temp.ok((select count(*) from app.expenses where deleted_at is null) = 2,
  '친구가 로그인 없이 지출을 적을 수 있다');
select pg_temp.ok((select sum(amount) from app.expenses where deleted_at is null) = 290000,
  '금액이 그대로 저장됨');
select pg_temp.ok(
  jsonb_array_length((select v::jsonb -> 'expenses' from t where k = 'esnap')) = 2,
  '스냅샷에 지출 2건이 실림');
select pg_temp.ok(
  (select v::jsonb -> 'expenses' -> 0 ->> 'mine' from t where k = 'esnap') = 'true',
  '내가 적은 것은 mine=true');
select pg_temp.ok(
  (select v::jsonb -> 'expenses' -> 1 ->> 'mine' from t where k = 'esnap') = 'false',
  '남이 적은 것은 mine=false  (남의 것을 내 것으로 보여주면 안 됩니다)');
select pg_temp.ok(
  (select v::jsonb -> 'expenses' -> 0 ->> 'payer' from t where k = 'esnap') = '민수',
  '결제자 이름이 그대로');

set role anon;

-- 남의 것은 못 지운다
do $$
declare v_blocked boolean := false; v_why text;
begin
  begin
    perform public.expense_remove(
      (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-B',
      (select v from t where k = 'ex1')::uuid);
  exception when others then v_blocked := true; v_why := sqlerrm;
  end;
  if v_blocked then raise notice '  OK    남의 지출은 못 지움 (%)', v_why;
  else raise exception 'FAIL: 남의 지출이 지워졌습니다';
  end if;
end $$;

-- 내 것은 지울 수 있다
select public.expense_remove(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A',
  (select v from t where k = 'ex1')::uuid);

-- 말이 안 되는 값은 막는다
do $$
declare
  v_tok text := (select v::jsonb ->> 'token' from t where k = 'tok1b');
  v_case text;
  v_blocked int := 0;
begin
  foreach v_case in array array['빈 항목','0원','1억 초과','긴 이름','긴 항목'] loop
    begin
      if    v_case = '빈 항목'   then perform public.expense_add(v_tok,'v','   ',1000,'민수');
      elsif v_case = '0원'       then perform public.expense_add(v_tok,'v','밥',0,'민수');
      elsif v_case = '1억 초과'  then perform public.expense_add(v_tok,'v','밥',100000001,'민수');
      elsif v_case = '긴 이름'   then perform public.expense_add(v_tok,'v','밥',1000,repeat('가',21));
      else                            perform public.expense_add(v_tok,'v',repeat('가',61),1000,'민수');
      end if;
    exception when others then v_blocked := v_blocked + 1;
    end;
  end loop;
  if v_blocked = 5 then raise notice '  OK    말이 안 되는 값 5가지를 모두 막음';
  else raise exception 'FAIL: 5개 중 %개만 막혔습니다', v_blocked;
  end if;
end $$;

-- 가짜 토큰으로는 남의 방에 적을 수 없다
do $$
declare v_blocked boolean := false; v_why text;
begin
  begin
    perform public.expense_add(repeat('ab',32), 'v', '밥', 1000, '민수');
  exception when others then v_blocked := true; v_why := sqlerrm;
  end;
  if v_blocked then raise notice '  OK    가짜 토큰은 막힘 (%)', v_why;
  else raise exception 'FAIL: 가짜 토큰이 통과했습니다';
  end if;
end $$;

reset role;
select pg_temp.ok((select count(*) from app.expenses where deleted_at is null) = 1,
  '내가 적은 지출은 지울 수 있다');
select pg_temp.ok((select count(*) from app.expenses) = 2,
  '지운 것도 행은 남는다 (soft delete — 되살릴 수 있음)');


-- ============================================================
--  9.6 일정 — 조용한 덮어쓰기를 막는가
--
--  ★ 505 는 일정 전체를 통짜로 저장했습니다. 두 사람이 동시에
--    고치면 나중 사람이 앞사람 것을 통째로 덮어썼고 아무 표시도
--    없었습니다. 친구가 한 시간 들여 짠 일정이 조용히 사라집니다.
--    그걸 막는 게 version 이고, 여기서 실제로 확인합니다.
-- ============================================================
\echo '── 9.6 일정'
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

insert into t select 'it1', (public.itinerary_day_save(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A', 0,
  '[{"time":"11:00","title":"강릉역 도착"}]'::jsonb, null,
  '2027-01-23', '1/23 (토)'))::text;

insert into t select 'it2', (public.itinerary_day_save(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A', 0,
  '[{"time":"11:00","title":"강릉역 도착"},{"time":"12:00","title":"점심"}]'::jsonb, 1))::text;

-- 친구B 가 옛 버전으로 고치려 함
insert into t select 'it3', (public.itinerary_day_save(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-B', 0,
  '[{"time":"09:00","title":"엉뚱한 일정"}]'::jsonb, 1))::text;

reset role;
select pg_temp.ok((select v::jsonb ->> 'ok' from t where k = 'it1') = 'true', '일정 하루치 저장');
select pg_temp.ok((select v::jsonb ->> 'version' from t where k = 'it2') = '2',
  '같은 버전으로 고치면 version 이 올라감');
select pg_temp.ok((select v::jsonb ->> 'ok' from t where k = 'it3') = 'false',
  '옛 버전으로 덮어쓰려 하면 막힘');
select pg_temp.ok((select v::jsonb ->> 'code' from t where k = 'it3') = 'stale',
  '막힌 이유를 stale 로 알려줌 (화면이 그 날만 다시 불러옵니다)');
select pg_temp.ok(
  (select jsonb_array_length(slots) from app.itinerary_days where day_index = 0) = 2,
  '★ 먼저 고친 사람 것이 그대로 남아 있다 (조용한 유실 없음)');
select pg_temp.ok(
  (select updated_by from app.itinerary_days where day_index = 0) = 'voter-A',
  '덮어쓰기를 시도한 사람 이름으로 바뀌지 않았다');

-- 전체 다시 짜기
set role anon;
insert into t select 'itb', (public.itinerary_build_save(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A',
  '[{"day_index":0,"the_date":"2027-01-23","label":"1/23","slots":[{"time":"11:00","title":"도착"}]},
    {"day_index":1,"the_date":"2027-01-24","label":"1/24","slots":[{"time":"09:00","title":"출발"}]}]'::jsonb))::text;

-- 말이 안 되는 값
insert into t select 'itx1', (public.itinerary_day_save(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A', 99, '[]'::jsonb))::text;
insert into t select 'itx2', (public.itinerary_day_save(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A', 0, '"배열아님"'::jsonb))::text;
insert into t select 'itx3', (public.itinerary_day_save(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), '', 0, '[]'::jsonb))::text;

-- 스냅샷
insert into t select 'isnap', (public.room_snapshot(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A'))::text;

reset role;
select pg_temp.ok((select v::jsonb ->> 'ok' from t where k = 'itb') = 'true', '전체 다시 짜기');
select pg_temp.ok((select count(*) from app.itinerary_days) = 2, '이틀치가 저장됨');
select pg_temp.ok((select v::jsonb ->> 'code' from t where k = 'itx1') = 'bad', '없는 날짜는 거부');
select pg_temp.ok((select v::jsonb ->> 'code' from t where k = 'itx2') = 'bad', '배열이 아니면 거부');
select pg_temp.ok((select v::jsonb ->> 'code' from t where k = 'itx3') = 'denied', '누군지 모르면 거부');
select pg_temp.ok(
  jsonb_array_length((select v::jsonb -> 'itinerary' from t where k = 'isnap')) = 2,
  '스냅샷에 일정 이틀치가 실림');

-- 가짜 토큰
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.itinerary_day_save(repeat('ab',32), 'v', 0, '[]'::jsonb);
  exception when others then v_blocked := true;
  end;
  if v_blocked then raise notice '  OK    가짜 토큰으로는 남의 일정을 못 고침';
  else raise exception 'FAIL: 가짜 토큰이 통과했습니다';
  end if;
end $$;

reset role;


-- ============================================================
--  9.7 댓글
--
--  ★ 투표는 익명, 댓글은 별명입니다. 목적이 다릅니다.
--    그런데 스냅샷에 voter_key 가 섞여 나가면 "이 댓글 쓴 사람이
--    이 숙소에 투표했네"가 되어, 투표 익명성이 댓글을 통해
--    깨집니다. 그게 새지 않는지가 여기서 제일 중요한 검사입니다.
-- ============================================================
\echo '── 9.7 댓글'
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

insert into t select 'c1', (public.comment_add(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A',
  'place', (select v::jsonb ->> 'id' from t where k = 'place1')::uuid,
  '여기 바다 보여요', '민수')) ->> 'id';

insert into t select 'c2', (public.comment_add(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-B',
  'place', (select v::jsonb ->> 'id' from t where k = 'place1')::uuid,
  '주차 되나요?', '지아')) ->> 'id';

insert into t select 'csnap', (public.room_snapshot(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A'))::text;

reset role;
select pg_temp.ok((select count(*) from app.comments where deleted_at is null) = 2, '댓글 2개 달림');
select pg_temp.ok(
  jsonb_array_length((select v::jsonb -> 'comments' from t where k = 'csnap')) = 2,
  '스냅샷에 댓글이 실림');
select pg_temp.ok(
  (select v::jsonb -> 'comments' -> 0 ->> 'nick' from t where k = 'csnap') = '민수',
  '별명이 보인다 (댓글은 익명이 아닙니다)');
select pg_temp.ok(
  (select v::jsonb -> 'comments' -> 0 ->> 'mine' from t where k = 'csnap') = 'true',
  '내가 쓴 것은 mine=true');
select pg_temp.ok(
  (select v::jsonb -> 'comments' -> 1 ->> 'mine' from t where k = 'csnap') = 'false',
  '남이 쓴 것은 mine=false');

-- ★ 핵심: voter_key 가 스냅샷 어디에도 없어야 합니다
select pg_temp.ok(
  (select v from t where k = 'csnap') not like '%voter_key%',
  '★ 스냅샷에 voter_key 라는 칸이 없다');
select pg_temp.ok(
  (select v from t where k = 'csnap') not like '%voter-B%',
  '★ 남의 voter_key 값이 새어 나가지 않는다 (투표 익명성 유지)');

set role anon;
-- 남의 댓글은 못 지운다
do $$
declare v_blocked boolean := false; v_why text;
begin
  begin
    perform public.comment_remove(
      (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-B',
      (select v from t where k = 'c1')::uuid);
  exception when others then v_blocked := true; v_why := sqlerrm;
  end;
  if v_blocked then raise notice '  OK    남의 댓글은 못 지움 (%)', v_why;
  else raise exception 'FAIL: 남의 댓글이 지워졌습니다';
  end if;
end $$;

select public.comment_remove(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A',
  (select v from t where k = 'c1')::uuid);

-- 말이 안 되는 값
do $$
declare
  v_tok text := (select v::jsonb ->> 'token' from t where k = 'tok1b');
  v_pid uuid := (select v::jsonb ->> 'id' from t where k = 'place1')::uuid;
  v_case text; v_blocked int := 0;
begin
  foreach v_case in array array['빈 내용','500자 초과','빈 별명','긴 별명','없는 장소','이상한 대상'] loop
    begin
      if    v_case = '빈 내용'    then perform public.comment_add(v_tok,'v','place',v_pid,'   ','민수');
      elsif v_case = '500자 초과' then perform public.comment_add(v_tok,'v','place',v_pid,repeat('가',501),'민수');
      elsif v_case = '빈 별명'    then perform public.comment_add(v_tok,'v','place',v_pid,'좋아요','  ');
      elsif v_case = '긴 별명'    then perform public.comment_add(v_tok,'v','place',v_pid,'좋아요',repeat('가',13));
      elsif v_case = '없는 장소'  then perform public.comment_add(v_tok,'v','place',
                                        '00000000-0000-0000-0000-000000000000'::uuid,'좋아요','민수');
      else                             perform public.comment_add(v_tok,'v','엉뚱',v_pid,'좋아요','민수');
      end if;
    exception when others then v_blocked := v_blocked + 1;
    end;
  end loop;
  if v_blocked = 6 then raise notice '  OK    말이 안 되는 값 6가지를 모두 막음';
  else raise exception 'FAIL: 6개 중 %개만 막혔습니다', v_blocked;
  end if;
end $$;

reset role;
select pg_temp.ok((select count(*) from app.comments where deleted_at is null) = 1,
  '내가 쓴 댓글은 지울 수 있다');


-- ============================================================
--  9.8 짧은 링크 풀기 허가
--
--  ★ Edge Function 은 주소만 알면 누구나 부를 수 있습니다.
--    막지 않으면 "아무 주소나 대신 긁어주는 서버"가 됩니다.
--    그 판단을 여기(SQL)에 둔 이유가 바로 이 테스트입니다.
-- ============================================================
\echo '── 9.8 링크 풀기 허가'
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

insert into t select 'ra1', (public.resolve_allow(
  (select v::jsonb ->> 'token' from t where k = 'tok1b')))::text;
insert into t select 'ra2', (public.resolve_allow('가짜토큰입니다가짜토큰입니다가짜'))::text;

reset role;
select pg_temp.ok((select v::jsonb ->> 'ok' from t where k = 'ra1') = 'true',
  '진짜 방 토큰이면 허용');
select pg_temp.ok((select v::jsonb ->> 'ok' from t where k = 'ra2') = 'false',
  '가짜 토큰이면 거부');
select pg_temp.ok((select v::jsonb ->> 'code' from t where k = 'ra2') = 'expired',
  '거부 이유를 알려줌');

-- 20번을 넘기면 잠깐 멈춰야 합니다
set role anon;
do $$
declare
  v_tok text := (select v::jsonb ->> 'token' from t where k = 'tok1b');
  v_r jsonb; i int;
begin
  for i in 1..25 loop
    v_r := public.resolve_allow(v_tok);
  end loop;
  if (v_r ->> 'ok') = 'false' and (v_r ->> 'code') = 'rate' then
    raise notice '  OK    한 시간에 20번을 넘기면 잠깐 멈춤';
  else
    raise exception 'FAIL: 25번을 불러도 안 막혔습니다 (%)', v_r;
  end if;
end $$;

reset role;
select pg_temp.ok(
  (select count(*) from app.rate_events where bucket = 'resolve') between 1 and 25,
  '★ 횟수가 실제로 쌓인다 (예외를 던졌다면 0 이었을 것)');


-- ============================================================
--  9.9 사진
--
--  ★ 올릴 자리 이름(key)은 서버가 정합니다. 사용자가 정하게 하면
--    남의 방 자리 이름을 지어내 그 사진을 덮어쓰거나, 자기 방
--    것처럼 기록할 수 있습니다. 그게 막히는지가 핵심입니다.
-- ============================================================
\echo '── 9.9 사진'
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

insert into t select 'pa', (public.photo_allow(
  (select v::jsonb ->> 'token' from t where k = 'tok1b')))::text;

reset role;
select pg_temp.ok((select v::jsonb ->> 'ok' from t where k = 'pa') = 'true', '올릴 자리를 내준다');
select pg_temp.ok((select v::jsonb ->> 'key' from t where k = 'pa') is not null, '자리 이름이 있다');
select pg_temp.ok(
  (select v::jsonb ->> 'key' from t where k = 'pa')
    like (select v::jsonb ->> 'room' from t where k = 'pa') || '/%',
  '자리 이름이 이 방 것으로 시작한다');

set role anon;
insert into t select 'ph1', (public.photo_add(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A',
  (select v::jsonb ->> 'key' from t where k = 'pa'),
  (select v::jsonb ->> 'key' from t where k = 'pa') || '-t',
  1600, 1067, 250000, '경포해변', '민수')) ->> 'id';

-- ★ 남의 자리 이름으로 기록하려는 시도
do $$
declare v_blocked boolean := false; v_why text;
begin
  begin
    perform public.photo_add(
      (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A',
      '00000000-0000-0000-0000-000000000000/stolen',
      '00000000-0000-0000-0000-000000000000/stolen-t',
      100, 100, 1000, null, null);
  exception when others then v_blocked := true; v_why := sqlerrm;
  end;
  if v_blocked then raise notice '  OK    ★ 남의 방 자리 이름으로는 기록 못 함 (%)', v_why;
  else raise exception 'FAIL: 남의 자리 이름이 통과했습니다';
  end if;
end $$;

-- 사진에 댓글
insert into t select 'pc', (public.comment_add(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-B',
  'photo', (select v from t where k = 'ph1')::uuid, '여기 예뻤다', '지아')) ->> 'id';

-- 없는 사진에 댓글 다는 시도
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.comment_add(
      (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'v',
      'photo', '00000000-0000-0000-0000-000000000000'::uuid, '유령', '지아');
  exception when others then v_blocked := true;
  end;
  if v_blocked then raise notice '  OK    없는 사진에는 댓글을 못 단다';
  else raise exception 'FAIL: 없는 사진에 댓글이 달렸습니다';
  end if;
end $$;

insert into t select 'plist', (public.photo_list(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A'))::text;

reset role;
select pg_temp.ok((select count(*) from app.photos where deleted_at is null) = 1, '사진 1장 기록됨');
select pg_temp.ok(
  jsonb_array_length((select v::jsonb -> 'photos' from t where k = 'plist')) = 1,
  '갤러리 목록에 실린다');
select pg_temp.ok(
  jsonb_array_length((select v::jsonb -> 'comments' from t where k = 'plist')) = 1,
  '사진 댓글이 갤러리 목록에 함께 온다');
select pg_temp.ok(
  (select v from t where k = 'plist') not like '%voter_key%',
  '★ 갤러리 목록에도 voter_key 가 새지 않는다');
select pg_temp.ok(
  (select v::jsonb -> 'photos' -> 0 ->> 'mine' from t where k = 'plist') = 'true',
  '내가 올린 것은 mine=true');
select pg_temp.ok((select v::jsonb ->> 'cap' from t where k = 'plist') = '300', '상한을 알려준다');

-- 남의 사진은 못 지운다
set role anon;
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.photo_remove(
      (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-B',
      (select v from t where k = 'ph1')::uuid);
  exception when others then v_blocked := true;
  end;
  if v_blocked then raise notice '  OK    남의 사진은 못 지운다';
  else raise exception 'FAIL: 남의 사진이 지워졌습니다';
  end if;
end $$;
select public.photo_remove(
  (select v::jsonb ->> 'token' from t where k = 'tok1b'), 'voter-A',
  (select v from t where k = 'ph1')::uuid);

reset role;
select pg_temp.ok((select count(*) from app.photos where deleted_at is null) = 0,
  '내가 올린 사진은 지울 수 있다');
select pg_temp.ok((select count(*) from app.photos) = 1,
  '지워도 행은 남는다 (R2 파일을 나중에 정리할 수 있게)');


-- ============================================================
--  9.10 사진함은 비공개여야 한다
--
--  ★ 이 서비스에서 가장 중요한 한 글자가 public = false 입니다.
--
--    공개로 열리면 사진 주소를 아는 사람은 비밀번호 없이도 볼 수
--    있고, 한 번 복사해 간 주소는 비밀번호를 바꿔도 계속 살아
--    있습니다. 다른 탭은 전부 비밀번호 뒤에 있는데 사진만 밖으로
--    나가는 겁니다.
--
--    화면에서 토글 한 번이면 바뀌는 설정이라, 테스트로 붙잡아
--    둡니다. 0009 를 다시 돌리면 비공개로 되돌아오는 것도 함께
--    확인합니다 — 실수했을 때 되돌릴 방법이 있어야 합니다.
-- ============================================================
\echo '── 9.10 사진함'
reset role;

select pg_temp.ok(
  exists (select 1 from storage.buckets where id = 'trip-photos'),
  '사진함이 만들어졌다');

select pg_temp.ok(
  (select public from storage.buckets where id = 'trip-photos') = false,
  '★ 사진함이 비공개다 (사진은 비밀번호 뒤에 있어야 합니다)');

select pg_temp.ok(
  (select file_size_limit from storage.buckets where id = 'trip-photos') = 10485760,
  '한 장에 10MB 상한이 서버에도 걸려 있다');

select pg_temp.ok(
  'image/webp' = any (select unnest(allowed_mime_types)
                        from storage.buckets where id = 'trip-photos'),
  '사진 형식만 받는다');

-- 실수로 공개로 바꿨다가 마이그레이션을 다시 돌리면 잠겨야 합니다
update storage.buckets set public = true where id = 'trip-photos';
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-photos', 'trip-photos', false, 10485760,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

select pg_temp.ok(
  (select public from storage.buckets where id = 'trip-photos') = false,
  '★ 실수로 공개했어도 0009 를 다시 돌리면 비공개로 되돌아온다');

select pg_temp.ok(
  (select relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'),
  '저장된 파일에 직접 접근은 막혀 있다 (RLS)');

select pg_temp.ok(
  not exists (select 1 from pg_policies
               where schemaname = 'storage' and tablename = 'objects'),
  '저장소에 열어준 정책이 하나도 없다 (Edge Function 만 들어갑니다)');


-- ============================================================
--  10. 방 삭제는 자식까지 함께
-- ============================================================
\echo '── 10. 방 삭제'
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
select public.room_delete((select v from t where k = 'slug1'));

reset role;
select pg_temp.ok(not exists (select 1 from app.rooms where slug = (select v from t where k = 'slug1')), '방 삭제됨');
select pg_temp.ok(not exists (select 1 from app.places where id = (select (v::jsonb ->> 'id')::uuid from t where k = 'place1')), '방 삭제 시 장소도 함께');
select pg_temp.ok((select count(*) from app.votes) = 0, '방 삭제 시 투표도 함께');

-- 카카오 탈퇴 = 사용자 삭제 → 그 사람 방 전부 사라짐
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok((select count(*) from app.rooms) = 0, '사용자 탈퇴 시 그 사람 방도 사라짐 (cascade)');

\echo ''
\echo '════ SQL 테스트 전부 통과 ════'
