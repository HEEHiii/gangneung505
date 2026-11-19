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
