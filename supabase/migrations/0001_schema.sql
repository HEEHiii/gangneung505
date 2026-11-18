-- ============================================================
--  여행방 서비스 — 스키마
--
--  Supabase SQL 편집기에 그대로 붙여넣고 실행하세요.
--  여러 번 실행해도 안전합니다 (전부 IF NOT EXISTS).
--
--  ★ 보안의 핵심 두 가지
--
--  1) 테이블을 'app' 스키마에 둡니다.
--     Supabase 가 바깥에 노출하는 스키마는 public 뿐이라서,
--     브라우저에서 /rest/v1/places 같은 주소로 테이블을 아예
--     지목할 수 없습니다.
--
--  2) 그 위에 RLS 를 켜고 정책을 하나도 만들지 않습니다.
--     만약 누군가 설정을 바꿔 app 스키마를 노출시켜도,
--     정책이 없으므로 anon 은 한 줄도 읽지 못합니다.
--
--  모든 접근은 다음 마이그레이션(0002)의 함수로만 들어옵니다.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;

-- anon/authenticated 는 app 스키마를 쓸 수 없습니다.
-- (함수가 SECURITY DEFINER 로 소유자 권한으로 대신 읽습니다)
revoke all on schema app from public;
revoke all on all tables in schema app from anon, authenticated;


-- ============================================================
--  서버 비밀값 — IP 해시에 섞는 pepper
--
--  IP 를 그대로 저장하지 않기 위해 sha256(IP + pepper) 를 씁니다.
--  pepper 가 없으면 해시만 보고 IP 를 되맞출 수 있습니다.
--  마이그레이션에서 자동 생성되므로 손으로 넣을 것이 없습니다.
-- ============================================================
create table if not exists app.config (
  id      smallint primary key default 1 check (id = 1),
  pepper  text not null,
  created_at timestamptz not null default now()
);
alter table app.config enable row level security;

insert into app.config (id, pepper)
values (1, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;


-- ============================================================
--  방
-- ============================================================
create table if not exists app.rooms (
  id          uuid primary key default extensions.gen_random_uuid(),
  slug        text not null unique,

  -- 카카오로 로그인한 방장. 탈퇴하면 방과 모든 자식 행이 함께 사라집니다
  -- (탈퇴 = 삭제. 법적으로 기대되는 동작이고 데이터 삭제 경로가 공짜로 생깁니다)
  owner_id    uuid not null references auth.users(id) on delete cascade,

  title       text not null check (char_length(title) between 1 and 60),
  start_date  date not null,
  end_date    date not null,
  people      smallint not null check (people between 1 and 30),

  -- 지역. region_code 는 regions.js 의 키이고, 없으면 "직접 검색"으로 만든 방입니다.
  -- 중심 좌표는 방에 복사해 둡니다 — regions.js 를 나중에 고쳐도 기존 방이 안 흔들립니다.
  region_code text,
  region_name text not null check (char_length(region_name) between 1 and 40),
  center_lat  double precision not null check (center_lat between 33 and 38.7),
  center_lng  double precision not null check (center_lng between 124.5 and 131),
  map_level   smallint not null default 8 check (map_level between 1 and 14),

  -- 출발·귀가 지점 {name, lat, lng}. 못 찾았으면 null 이고 일정은 숙소부터 시작합니다
  hub         jsonb,

  pw_hash     text not null,

  -- 테마 등 자유 설정 {theme: 'winter', anchors: {...}}
  settings    jsonb not null default '{}'::jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),   -- 자식 쓰기마다 트리거로 갱신 (싼 polling 용)
  last_seen_at timestamptz not null default now(),

  constraint rooms_dates_sane
    check (end_date >= start_date and end_date - start_date <= 14)
);
alter table app.rooms enable row level security;

create index if not exists rooms_owner_idx on app.rooms (owner_id);
create index if not exists rooms_last_seen_idx on app.rooms (last_seen_at);


-- ============================================================
--  장소 — 숙소 후보와 맛집·카페·관광지를 한 테이블에
--
--  kind 값은 route.js 의 DWELL = {food:70, cafe:50, spot:60, lodging:0}
--  키와 일부러 똑같이 맞췄습니다. 최적화기에 변환 계층이 필요 없습니다.
--
--  숙소 탭은 lodging 을 번호 핀으로, spot 을 회색 점으로 그리고,
--  맛집 탭은 food/cafe/spot 을 크게 그립니다. 같은 행, 다른 투영입니다.
-- ============================================================
create table if not exists app.places (
  id         uuid primary key default extensions.gen_random_uuid(),
  room_id    uuid not null references app.rooms(id) on delete cascade,
  kind       text not null check (kind in ('lodging', 'food', 'cafe', 'spot')),

  name       text not null check (char_length(name) between 1 and 80),
  lat        double precision not null check (lat between 33 and 38.7),
  lng        double precision not null check (lng between 124.5 and 131),

  address    text check (char_length(address) <= 300),
  url        text check (char_length(url) <= 500),
  note       text check (char_length(note) <= 300),
  price      integer check (price between 0 and 100000000),
  capacity   text check (char_length(capacity) <= 40),

  -- 에어비앤비처럼 대략 위치만 아는 경우 true → 카드와 지도에 '대략 위치' 배지
  approx     boolean not null default false,

  -- 어떻게 들어왔는지. seed 는 지금 쓰지 않습니다
  -- (카카오 검색 결과를 DB 에 쌓지 않는다는 정책 때문에 관광지 시딩은 화면에서만 합니다)
  source     text check (source in ('search', 'link', 'pick', 'seed')),

  kakao_place_id text check (char_length(kakao_place_id) <= 40),

  -- 누가 넣었는지. 방장도 voter_key 를 씁니다 (auth.uid() 를 쓰면 방장만 식별돼
  -- 익명 약속이 깨집니다). 삭제 버튼을 자기 것에만 보이게 하는 데 씁니다
  created_by text not null check (char_length(created_by) <= 64),

  created_at timestamptz not null default now(),
  deleted_at timestamptz   -- soft delete: 실수로 지운 것을 복구할 수 있습니다
);
alter table app.places enable row level security;

create index if not exists places_room_kind_idx
  on app.places (room_id, kind) where deleted_at is null;

-- 두 친구가 같은 식당을 중복으로 넣는 것을 막습니다
create unique index if not exists places_room_kakao_uniq
  on app.places (room_id, kakao_place_id)
  where kakao_place_id is not null and deleted_at is null;


-- ============================================================
--  투표
--
--  구글 시트판은 모든 토글을 한 줄씩 쌓고 읽을 때 되감아 집계했습니다.
--  그건 시트에 unique 제약이 없어서 생긴 우회책이지 기능이 아닙니다.
--  Postgres 에서는 제약이 공짜이므로:
--    투표  = insert ... on conflict do nothing
--    취소  = delete
--  테이블이 무한히 자라지 않고 집계는 group by 한 번입니다.
-- ============================================================
create table if not exists app.votes (
  place_id   uuid not null references app.places(id) on delete cascade,
  voter_key  text not null check (char_length(voter_key) <= 64),
  room_id    uuid not null references app.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (place_id, voter_key)
);
alter table app.votes enable row level security;

create index if not exists votes_room_idx on app.votes (room_id);


-- ============================================================
--  입장 세션 — 비밀번호를 맞힌 뒤 받는 토큰
--
--  토큰 원문은 저장하지 않습니다. sha256 만 넣고, 원문은 발급 때 한 번만
--  돌려줍니다. DB 가 새더라도 그것만으로 남의 방에 들어갈 수 없습니다.
-- ============================================================
create table if not exists app.room_sessions (
  token_hash   bytea primary key,
  room_id      uuid not null references app.rooms(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
alter table app.room_sessions enable row level security;

create index if not exists room_sessions_room_idx on app.room_sessions (room_id, created_at);
create index if not exists room_sessions_expiry_idx on app.room_sessions (expires_at);


-- ============================================================
--  입장 실패 기록 — 비밀번호 무차별 대입 방어
--
--  방 비밀번호는 네 자리일 것입니다. 이것 없이는 설계가 성립하지 않습니다.
--  bcrypt 를 호출하기 "전에" 먼저 세어서 막습니다 (bcrypt 자체가 느려서
--  그것만으로도 서버를 괴롭힐 수 있기 때문입니다).
-- ============================================================
create table if not exists app.join_attempts (
  room_id uuid not null references app.rooms(id) on delete cascade,
  ip_hash text not null,
  at      timestamptz not null default now()
);
alter table app.join_attempts enable row level security;

create index if not exists join_attempts_idx on app.join_attempts (room_id, at desc);


-- ============================================================
--  범용 횟수 제한 (resolve-link 등)
--  방 생성은 auth.uid() 로 app.rooms 에서 바로 세므로 여기 쓰지 않습니다.
-- ============================================================
create table if not exists app.rate_events (
  bucket   text not null check (char_length(bucket) <= 40),
  key_hash text not null,
  at       timestamptz not null default now()
);
alter table app.rate_events enable row level security;

create index if not exists rate_events_idx on app.rate_events (bucket, key_hash, at desc);


-- ============================================================
--  방 변경 시각 갱신 트리거
--
--  친구 화면이 "바뀐 게 있나?" 를 싸게 물어볼 수 있게 합니다.
--  room_snapshot(p_since) 이 updated_at <= p_since 이면 수십 바이트만
--  돌려주고 끝냅니다 — 무료 티어의 월 5GB 전송량을 지키는 장치입니다.
-- ============================================================
create or replace function app.touch_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
begin
  v_room := coalesce(new.room_id, old.room_id);
  if v_room is not null then
    update app.rooms set updated_at = now() where id = v_room;
  end if;
  return null;   -- AFTER 트리거이므로 반환값은 쓰이지 않습니다
end;
$$;

drop trigger if exists places_touch on app.places;
create trigger places_touch after insert or update or delete on app.places
  for each row execute function app.touch_room();

drop trigger if exists votes_touch on app.votes;
create trigger votes_touch after insert or update or delete on app.votes
  for each row execute function app.touch_room();


-- ============================================================
--  slug 만들기
--
--  모음을 뺀 Crockford 계열 32진수 9자입니다.
--   · 모음이 없으니 우연히 단어가 되지 않습니다
--   · 0/O/1/I/L 이 없으니 전화로 읽어줘도 헷갈리지 않습니다
--  27^9 ≈ 7.6조 가지라 추측으로 남의 방을 찾을 수 없습니다.
-- ============================================================
create or replace function app.new_slug()
returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := '23456789BCDFGHJKMNPQRSTVWXZ';   -- 27자
  out text := '';
  i int;
begin
  for i in 1..9 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;


-- ============================================================
--  IP 해시 — 입장 제한에만 씁니다
--
--  Supabase 게이트웨이가 x-forwarded-for 를 채워줍니다.
--  ★ 최선의 노력일 뿐입니다: 상위에서 위조할 수 있고, 같은 통신사
--    사용자끼리 공유될 수 있습니다. 보안 경계가 아니라 과속 방지턱입니다.
-- ============================================================
create or replace function app.client_ip_hash()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fwd text;
  v_pepper text;
begin
  begin
    v_fwd := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  exception when others then
    v_fwd := null;
  end;

  select pepper into v_pepper from app.config where id = 1;

  return encode(
    extensions.digest(coalesce(v_fwd, 'unknown') || '|' || coalesce(v_pepper, ''), 'sha256'),
    'hex'
  );
end;
$$;


-- ============================================================
--  오래된 것 치우기
--  pg_cron 이 있으면 거기서, 없으면 room_create 가 가끔 부릅니다.
-- ============================================================
create or replace function app.gc()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.room_sessions where expires_at < now();
  delete from app.join_attempts where at < now() - interval '1 day';
  delete from app.rate_events  where at < now() - interval '1 day';
end;
$$;
