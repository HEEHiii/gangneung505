-- ============================================================
--  여행방 서비스 — 함수 (유일한 출입구)
--
--  0001_schema.sql 을 먼저 실행하세요.
--  여러 번 실행해도 안전합니다 (create or replace).
--
--  ★ 구조
--
--  두 종류의 사용자가 같은 행을 씁니다.
--
--    방장  — 카카오로 로그인했고 진짜 JWT 가 있습니다 (app.current_uid())
--    친구  — 계정이 없고 링크 + 방 비밀번호만 있습니다
--
--  방 안에서 하는 일(읽기·추가·투표)은 둘이 완전히 같은 경로를 씁니다.
--  방장도 room_create 때 방 토큰을 받아서 친구들과 똑같이 씁니다.
--  그래서 "보는 사람에 따라 다른 데이터 경로"가 생기지 않습니다.
--
--  방장만 할 수 있는 네 가지(목록·재입장·비밀번호 변경·삭제)만
--  방 토큰을 무시하고 app.current_uid() 를 봅니다.
--
--  ★ 방 격리가 구조적으로 보장되는 이유
--
--  첫 인자가 늘 p_token 이고, 모든 함수가 app.room_from_token() 으로
--  시작합니다. 호출하는 쪽이 room id 를 지정할 방법이 아예 없습니다.
--  그래서 감사할 지점이 함수 하나로 모입니다.
--
--  ★ room_join 만 예외 대신 {ok, code, message} 를 돌려줍니다.
--    (아래 그 함수의 주석에 이유가 있습니다 — 보안상 중요합니다)
--    나머지 함수는 실패 시 예외를 던집니다.
--
--  ★ 클라이언트가 구분해야 하는 오류는 메시지 앞에 [코드] 가 붙습니다
--     [auth]      로그인이 필요
--     [nomatch]   방을 못 찾았거나 비밀번호가 틀림 (일부러 구분하지 않음)
--     [locked]    너무 많이 틀려서 잠김
--     [expired]   토큰이 만료됨 → 다시 입장
--     [denied]    권한 없음
--     [limit]     개수 제한
--     [conflict]  남이 먼저 고침
-- ============================================================


-- ============================================================
--  토큰 → 방. 모든 방 안 함수가 이것으로 시작합니다.
-- ============================================================
create or replace function app.room_from_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_room uuid;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception '[expired] 다시 입장해주세요';
  end if;

  v_hash := extensions.digest(p_token, 'sha256');

  select room_id into v_room
    from app.room_sessions
   where token_hash = v_hash and expires_at > now();

  if v_room is null then
    raise exception '[expired] 입장 정보가 만료됐어요. 비밀번호를 다시 입력해주세요';
  end if;

  update app.room_sessions set last_used_at = now() where token_hash = v_hash;
  return v_room;
end;
$$;


-- ============================================================
--  지금 로그인한 사람 — auth.uid() 를 안전하게 감싼 것
--
--  ★ 왜 직접 auth.uid() 를 쓰지 않는가
--    auth.uid() 는 요청 헤더의 JWT 클레임을 JSON 으로 파싱합니다.
--    그 값이 비어 있거나 깨져 있으면 "로그인 안 됨"이 아니라
--    invalid input syntax for type json 예외를 던집니다.
--    그러면 사용자는 "로그인이 필요해요" 대신 알 수 없는 오류를 봅니다.
--    깨진 토큰은 로그인 안 한 것으로 취급하는 게 맞습니다.
-- ============================================================
create or replace function app.current_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return auth.uid();
exception when others then
  return null;
end;
$$;


-- ============================================================
--  이 호출자가 이 방의 방장인가?
--  로그인 안 한 친구는 늘 false 입니다.
-- ============================================================
create or replace function app.is_owner(p_room uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_uid();
begin
  if v_uid is null then return false; end if;
  return exists (select 1 from app.rooms where id = p_room and owner_id = v_uid);
end;
$$;


-- ============================================================
--  살아있나 확인 (무료 티어 일시정지 방지용 cron 이 부릅니다)
-- ============================================================
create or replace function public.health()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'at', now());
$$;


-- ============================================================
--  방 만들기 — 로그인 필요
-- ============================================================
create or replace function public.room_create(
  p_title       text,
  p_start       date,
  p_end         date,
  p_people      int,
  p_region_code text,
  p_region_name text,
  p_center_lat  double precision,
  p_center_lng  double precision,
  p_map_level   int,
  p_hub         jsonb,
  p_password    text,
  p_settings    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.current_uid();
  v_slug  text;
  v_room  uuid;
  v_token text;
  v_tries int := 0;
  v_today int;
  v_live  int;
begin
  if v_uid is null then
    raise exception '[auth] 방을 만들려면 카카오 로그인이 필요해요';
  end if;

  if p_password is null or char_length(p_password) < 4 then
    raise exception '[limit] 비밀번호는 4자 이상으로 해주세요';
  end if;
  if char_length(p_password) > 64 then
    raise exception '[limit] 비밀번호가 너무 길어요';
  end if;

  -- 남용 방지: 방장이 인증돼 있으므로 IP 가 아니라 계정 기준으로 셉니다
  select count(*) into v_today from app.rooms
   where owner_id = v_uid and created_at > now() - interval '1 day';
  if v_today >= 10 then
    raise exception '[limit] 하루에 만들 수 있는 방을 넘었어요. 내일 다시 시도해주세요';
  end if;

  select count(*) into v_live from app.rooms where owner_id = v_uid;
  if v_live >= 50 then
    raise exception '[limit] 방이 너무 많아요. 쓰지 않는 방을 지워주세요';
  end if;

  -- slug 충돌은 사실상 안 나지만, 나면 다시 뽑습니다
  loop
    v_tries := v_tries + 1;
    v_slug := app.new_slug();
    exit when not exists (select 1 from app.rooms where slug = v_slug);
    if v_tries > 20 then
      raise exception '[limit] 방 주소를 만들지 못했어요. 다시 시도해주세요';
    end if;
  end loop;

  insert into app.rooms (
    slug, owner_id, title, start_date, end_date, people,
    region_code, region_name, center_lat, center_lng, map_level, hub,
    pw_hash, settings
  ) values (
    v_slug, v_uid,
    trim(p_title), p_start, p_end, p_people,
    nullif(trim(coalesce(p_region_code, '')), ''),
    trim(p_region_name), p_center_lat, p_center_lng,
    coalesce(p_map_level, 8), p_hub,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    coalesce(p_settings, '{}'::jsonb)
  )
  returning id into v_room;

  -- 방장도 친구들과 똑같은 방 토큰을 받습니다 (방 안에서는 분기가 없습니다)
  v_token := encode(extensions.gen_random_bytes(32), 'base64');
  insert into app.room_sessions (token_hash, room_id, expires_at)
  values (extensions.digest(v_token, 'sha256'), v_room, now() + interval '30 days');

  -- 가끔 치웁니다 (pg_cron 이 없는 무료 프로젝트용)
  if random() < 0.02 then perform app.gc(); end if;

  return jsonb_build_object('slug', v_slug, 'token', v_token);
end;
$$;


-- ============================================================
--  입장 — 비밀번호 확인 후 토큰 발급
--
--  ★ 순서가 중요합니다. bcrypt 를 부르기 "전에" 먼저 횟수를 셉니다.
--    bcrypt 가 일부러 느리기 때문에, 세지 않으면 그 느림 자체가
--    서버를 괴롭히는 수단이 됩니다.
--
--  ★★ 이 함수만 예외를 던지지 않고 {ok:false, code, message} 를 돌려줍니다.
--     이유가 중요합니다 — 반드시 이대로 유지하세요.
--
--     PostgreSQL 에서 raise exception 은 그 트랜잭션을 되감습니다.
--     실패를 기록하는 insert into app.join_attempts 와 raise 가 같은
--     트랜잭션에 있으면, raise 가 그 insert 까지 지워버립니다.
--     PostgREST 는 호출 하나가 트랜잭션 하나이므로, 예외를 던지는 순간
--     실패 기록이 남지 않고 → 횟수가 0 으로 유지되고 → 무차별 대입
--     방어가 조용히 무력화됩니다. (실제로 그렇게 짰다가 테스트에서
--     "10번 틀린 뒤에도 잠기지 않음"으로 잡혔습니다.)
--
--     값으로 돌려주면 트랜잭션이 커밋되어 기록이 남습니다.
--     클라이언트는 data.ok 를 확인해야 합니다 — 오류로 오지 않습니다.
-- ============================================================
create or replace function public.room_join(p_slug text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room   uuid;
  v_hash   text;
  v_ip     text := app.client_ip_hash();
  v_byip   int;
  v_byroom int;
  v_token  text;
begin
  select id, pw_hash into v_room, v_hash
    from app.rooms where slug = upper(trim(coalesce(p_slug, '')));

  if v_room is null then
    -- 없는 방도 "비밀번호 틀림"과 똑같이 응답합니다.
    -- 더미 bcrypt 를 한 번 돌려 응답 시간까지 맞춥니다 —
    -- 안 그러면 빠른 실패/느린 실패로 방 존재 여부가 새어 나갑니다.
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'code', 'nomatch',
      'message', '주소나 비밀번호를 다시 확인해주세요');
  end if;

  -- 같은 사람(IP)이 10분에 10번 틀리면 잠깁니다
  select count(*) into v_byip from app.join_attempts
   where room_id = v_room and ip_hash = v_ip and at > now() - interval '10 minutes';
  if v_byip >= 10 then
    return jsonb_build_object('ok', false, 'code', 'locked',
      'message', '너무 많이 틀렸어요. 10분 뒤에 다시 시도해주세요');
  end if;

  -- 방 전체 브레이크: 네 자리 비밀번호는 이것 없이 버티지 못합니다
  select count(*) into v_byroom from app.join_attempts
   where room_id = v_room and at > now() - interval '1 hour';
  if v_byroom >= 60 then
    return jsonb_build_object('ok', false, 'code', 'locked',
      'message', '이 방이 잠시 잠겼어요. 잠시 뒤에 다시 시도해주세요');
  end if;

  if v_hash <> extensions.crypt(coalesce(p_password, ''), v_hash) then
    insert into app.join_attempts (room_id, ip_hash) values (v_room, v_ip);
    return jsonb_build_object('ok', false, 'code', 'nomatch',
      'message', '주소나 비밀번호를 다시 확인해주세요');
  end if;

  -- 성공. 세션이 너무 쌓이면 오래된 것부터 버립니다
  delete from app.room_sessions
   where token_hash in (
     select token_hash from app.room_sessions
      where room_id = v_room order by last_used_at desc offset 50
   );

  v_token := encode(extensions.gen_random_bytes(32), 'base64');
  insert into app.room_sessions (token_hash, room_id, expires_at)
  values (extensions.digest(v_token, 'sha256'), v_room, now() + interval '30 days');

  update app.rooms set last_seen_at = now() where id = v_room;

  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;


-- ============================================================
--  방 전체 내려주기
--
--  p_since 를 주면, 그 뒤로 바뀐 게 없을 때 {unchanged:true} 만
--  돌려줍니다. 무료 티어의 월 5GB 전송량을 지키는 장치입니다.
-- ============================================================
create or replace function public.room_snapshot(
  p_token text,
  p_voter text,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room    uuid := app.room_from_token(p_token);
  v_updated timestamptz;
  v_r       app.rooms;
begin
  select * into v_r from app.rooms where id = v_room;
  v_updated := v_r.updated_at;

  if p_since is not null and v_updated <= p_since then
    return jsonb_build_object('unchanged', true, 'updated_at', v_updated);
  end if;

  return jsonb_build_object(
    'unchanged', false,
    'updated_at', v_updated,
    'room', jsonb_build_object(
      'slug',        v_r.slug,
      'title',       v_r.title,
      'start_date',  v_r.start_date,
      'end_date',    v_r.end_date,
      'people',      v_r.people,
      'region_code', v_r.region_code,
      'region_name', v_r.region_name,
      'center',      jsonb_build_array(v_r.center_lat, v_r.center_lng),
      'map_level',   v_r.map_level,
      'hub',         v_r.hub,
      'settings',    v_r.settings,
      'is_owner',    app.is_owner(v_room)
    ),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'kind', p.kind, 'name', p.name,
               'lat', p.lat, 'lng', p.lng,
               'address', p.address, 'url', p.url, 'note', p.note,
               'price', p.price, 'capacity', p.capacity,
               'approx', p.approx, 'source', p.source,
               'kakao_place_id', p.kakao_place_id,
               'mine', (p.created_by = coalesce(p_voter, '')),
               'created_at', p.created_at
             ) order by p.created_at)
        from app.places p
       where p.room_id = v_room and p.deleted_at is null
    ), '[]'::jsonb),
    'counts', coalesce((
      select jsonb_object_agg(place_id::text, n)
        from (select v.place_id, count(*) as n
                from app.votes v
                join app.places p on p.id = v.place_id and p.deleted_at is null
               where v.room_id = v_room
               group by v.place_id) t
    ), '{}'::jsonb),
    'mine', coalesce((
      select jsonb_agg(v.place_id)
        from app.votes v
       where v.room_id = v_room and v.voter_key = coalesce(p_voter, '')
    ), '[]'::jsonb)
  );
end;
$$;


-- ============================================================
--  장소 추가
--  p_data: {kind,name,lat,lng,address,url,note,price,capacity,approx,source,kakao_place_id}
-- ============================================================
create or replace function public.place_add(p_token text, p_voter text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_n    int;
  v_id   uuid;
begin
  if coalesce(p_voter, '') = '' then
    raise exception '[denied] 누가 추가하는지 알 수 없어요';
  end if;

  select count(*) into v_n from app.places
   where room_id = v_room and deleted_at is null;
  if v_n >= 120 then
    raise exception '[limit] 한 방에 넣을 수 있는 장소를 넘었어요 (120곳)';
  end if;

  insert into app.places (
    room_id, kind, name, lat, lng, address, url, note,
    price, capacity, approx, source, kakao_place_id, created_by
  ) values (
    v_room,
    p_data ->> 'kind',
    trim(p_data ->> 'name'),
    (p_data ->> 'lat')::double precision,
    (p_data ->> 'lng')::double precision,
    nullif(trim(coalesce(p_data ->> 'address', '')), ''),
    nullif(trim(coalesce(p_data ->> 'url', '')), ''),
    nullif(trim(coalesce(p_data ->> 'note', '')), ''),
    nullif(p_data ->> 'price', '')::integer,
    nullif(trim(coalesce(p_data ->> 'capacity', '')), ''),
    coalesce((p_data ->> 'approx')::boolean, false),
    nullif(p_data ->> 'source', ''),
    nullif(trim(coalesce(p_data ->> 'kakao_place_id', '')), ''),
    p_voter
  )
  returning id into v_id;

  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('id', v_id);

exception
  when unique_violation then
    raise exception '[conflict] 이미 누가 추가한 곳이에요';
end;
$$;


-- ============================================================
--  장소 지우기 (soft delete — 실수는 복구할 수 있습니다)
--  자기가 넣은 것만. 방장은 전부 지울 수 있습니다.
-- ============================================================
create or replace function public.place_remove(p_token text, p_voter text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room  uuid := app.room_from_token(p_token);
  v_by    text;
begin
  select created_by into v_by
    from app.places where id = p_id and room_id = v_room and deleted_at is null;

  if v_by is null then
    raise exception '[denied] 없는 장소예요';
  end if;

  if v_by <> coalesce(p_voter, '') and not app.is_owner(v_room) then
    raise exception '[denied] 직접 추가한 곳만 지울 수 있어요';
  end if;

  update app.places set deleted_at = now() where id = p_id;
  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
--  투표 켜기/끄기
--
--  ★ 방장도 voter_key 를 씁니다. app.current_uid() 를 넣으면 방장의 투표만
--    식별 가능해져서, 익명 약속이 그걸 가장 먼저 눈치챌 사람에게서
--    깨집니다. 여기에 app.current_uid() 를 쓰지 마세요.
-- ============================================================
create or replace function public.vote_set(
  p_token text, p_voter text, p_place_id uuid, p_on boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_n    int;
  v_cnt  int;
begin
  if coalesce(p_voter, '') = '' then
    raise exception '[denied] 누가 투표하는지 알 수 없어요';
  end if;

  if not exists (
    select 1 from app.places
     where id = p_place_id and room_id = v_room and deleted_at is null
  ) then
    raise exception '[denied] 없는 장소예요';
  end if;

  if p_on then
    select count(*) into v_n from app.votes where room_id = v_room;
    if v_n >= 2000 then
      raise exception '[limit] 투표가 너무 많아요';
    end if;
    insert into app.votes (place_id, voter_key, room_id)
    values (p_place_id, p_voter, v_room)
    on conflict (place_id, voter_key) do nothing;
  else
    delete from app.votes where place_id = p_place_id and voter_key = p_voter;
  end if;

  select count(*) into v_cnt from app.votes where place_id = p_place_id;
  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('count', v_cnt);
end;
$$;


-- ============================================================
--  방 살아있음 표시 (오래 안 쓰면 치우는 기준)
-- ============================================================
create or replace function public.room_touch(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
begin
  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
--  ───────── 여기부터는 방장 전용 ─────────
--  방 토큰을 보지 않고 app.current_uid() 만 봅니다.
-- ============================================================

-- 내가 만든 방 목록
create or replace function public.room_list_mine()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_uid();
begin
  if v_uid is null then
    raise exception '[auth] 로그인이 필요해요';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'slug', slug, 'title', title,
             'start_date', start_date, 'end_date', end_date,
             'people', people, 'region_name', region_name,
             'settings', settings, 'created_at', created_at
           ) order by created_at desc)
      from app.rooms where owner_id = v_uid
  ), '[]'::jsonb);
end;
$$;


-- 비밀번호 없이 내 방에 다시 들어가기
--  ★ 이것 덕분에 "비밀번호 분실"이라는 문제가 아예 존재하지 않습니다.
--    방장의 복구 경로는 그냥 "카카오로 로그인"입니다.
create or replace function public.room_resume(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.current_uid();
  v_room  uuid;
  v_token text;
begin
  if v_uid is null then
    raise exception '[auth] 로그인이 필요해요';
  end if;

  select id into v_room from app.rooms
   where slug = upper(trim(coalesce(p_slug, ''))) and owner_id = v_uid;

  if v_room is null then
    raise exception '[denied] 내가 만든 방이 아니에요';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'base64');
  insert into app.room_sessions (token_hash, room_id, expires_at)
  values (extensions.digest(v_token, 'sha256'), v_room, now() + interval '30 days');

  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('token', v_token);
end;
$$;


-- 비밀번호 바꾸기
--  ★ 그 방의 세션을 전부 지웁니다 → 친구 전원이 다시 입장해야 합니다.
--    즉 이 함수가 "접근 회수" 수단입니다. 누군가에게 링크가 잘못
--    퍼졌을 때 쓸 수 있는 유일한 장치입니다.
create or replace function public.room_set_password(p_slug text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.current_uid();
  v_room uuid;
begin
  if v_uid is null then
    raise exception '[auth] 로그인이 필요해요';
  end if;
  if p_new is null or char_length(p_new) < 4 then
    raise exception '[limit] 비밀번호는 4자 이상으로 해주세요';
  end if;
  if char_length(p_new) > 64 then
    raise exception '[limit] 비밀번호가 너무 길어요';
  end if;

  select id into v_room from app.rooms
   where slug = upper(trim(coalesce(p_slug, ''))) and owner_id = v_uid;
  if v_room is null then
    raise exception '[denied] 내가 만든 방이 아니에요';
  end if;

  update app.rooms
     set pw_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = v_room;

  delete from app.room_sessions where room_id = v_room;
  delete from app.join_attempts where room_id = v_room;

  return jsonb_build_object('ok', true);
end;
$$;


-- 방 지우기 (자식 행은 cascade 로 함께 사라집니다)
create or replace function public.room_delete(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.current_uid();
  v_n    int;
begin
  if v_uid is null then
    raise exception '[auth] 로그인이 필요해요';
  end if;

  delete from app.rooms
   where slug = upper(trim(coalesce(p_slug, ''))) and owner_id = v_uid;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '[denied] 내가 만든 방이 아니에요';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
--  권한 — 여기가 마지막 잠금장치입니다
--
--  public 스키마의 함수를 전부 회수한 뒤, 위에서 만든 것만 돌려줍니다.
--  이렇게 해두면 나중에 실수로 함수를 하나 더 만들어도 자동으로
--  공개되지 않습니다. 열고 싶으면 명시적으로 GRANT 해야 합니다.
-- ============================================================
revoke execute on all functions in schema public from public, anon, authenticated;

-- 앞으로 새로 만드는 함수도 기본으로 닫아둡니다.
-- 이게 없으면 나중에 함수를 하나 추가할 때 PUBLIC 에게 자동으로
-- 실행 권한이 붙어서, 열 생각이 없던 함수가 조용히 공개됩니다.
alter default privileges in schema public revoke execute on functions from public;

-- 누구나 (로그인 없이)
grant execute on function public.health()                                   to anon, authenticated;
grant execute on function public.room_join(text, text)                      to anon, authenticated;
grant execute on function public.room_snapshot(text, text, timestamptz)     to anon, authenticated;
grant execute on function public.place_add(text, text, jsonb)               to anon, authenticated;
grant execute on function public.place_remove(text, text, uuid)             to anon, authenticated;
grant execute on function public.vote_set(text, text, uuid, boolean)        to anon, authenticated;
grant execute on function public.room_touch(text)                           to anon, authenticated;

-- 로그인한 사람만 (방장)
grant execute on function public.room_create(
  text, date, date, int, text, text, double precision, double precision, int, jsonb, text, jsonb
) to authenticated;
grant execute on function public.room_list_mine()                           to authenticated;
grant execute on function public.room_resume(text)                          to authenticated;
grant execute on function public.room_set_password(text, text)              to authenticated;
grant execute on function public.room_delete(text)                          to authenticated;

-- app 스키마의 내부 함수는 절대 공개하지 않습니다
revoke execute on all functions in schema app from public, anon, authenticated;
