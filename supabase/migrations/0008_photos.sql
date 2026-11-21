-- ============================================================
--  0008 — 사진 갤러리
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0001 ~ 0007 을 먼저 올린 뒤에 실행하세요.
--
--  이 파일만으로는 사진을 올릴 수 없습니다. Cloudflare R2 설정과
--  Edge Function 이 있어야 합니다 (app/SETUP.md 참고).
--  설정이 없으면 갤러리 탭이 아예 숨습니다.
-- ============================================================

-- ------------------------------------------------------------
--  사진
--
--  ★ 사진 파일 자체는 여기 없습니다. Cloudflare R2 에 있고,
--    여기에는 "어디에 있는지"와 설명만 둡니다.
--
--    왜 Supabase 에 안 넣는가: 무료 저장소가 1GB 인데 휴대폰 사진
--    한 장이 3~5MB 입니다. 서비스 전체에서 200~300장이면 끝납니다.
--    더 큰 문제는 보는 쪽입니다 — 월 5GB 전송 제한에서 친구 10명이
--    사진 30장짜리 방을 한 번 보면 75MB, 즉 월 65회면 소진됩니다.
--    R2 는 10GB 무료에 "보는 것"이 무료라 사진에는 사실상 정답입니다.
--
--  ★ bytes 를 왜 저장하는가: 용량이 유일하게 돈이 드는 자원이라,
--    방마다 얼마나 쓰는지 볼 수 없으면 나중에 손쓸 방법이 없습니다.
-- ------------------------------------------------------------
create table if not exists app.photos (
  id         uuid primary key default extensions.gen_random_uuid(),
  room_id    uuid not null references app.rooms(id) on delete cascade,

  r2_key     text not null check (char_length(r2_key) between 8 and 200),
  thumb_key  text not null check (char_length(thumb_key) between 8 and 200),

  width      smallint check (width between 1 and 20000),
  height     smallint check (height between 1 and 20000),
  bytes      integer  check (bytes between 1 and 10000000),

  caption    text check (char_length(caption) <= 100),

  -- 일정 날짜나 장소에 묶기 (선택)
  day_index  smallint check (day_index between 0 and 14),
  place_id   uuid references app.places(id) on delete set null,

  nick       text check (char_length(nick) <= 12),
  voter_key  text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- 같은 파일을 두 번 올리지 않게
  unique (room_id, r2_key)
);
alter table app.photos enable row level security;

create index if not exists photos_room_idx
  on app.photos (room_id, created_at desc) where deleted_at is null;

drop trigger if exists photos_touch on app.photos;
create trigger photos_touch after insert or update or delete on app.photos
  for each row execute function app.touch_room();


-- ============================================================
--  방에 사진을 몇 장까지 둘 수 있나
--
--  Edge Function 이 "올려도 되는지" 물을 때도 씁니다.
--  한 군데에 두어야 올리기 전과 뒤의 기준이 어긋나지 않습니다.
-- ============================================================
create or replace function app.photo_room_cap()
returns int language sql immutable as $$ select 300 $$;


-- ============================================================
--  사진 올릴 자리 요청 — Edge Function 이 부릅니다
--
--  진짜 방 토큰인지, 상한을 넘지 않았는지 확인하고 올려도 되는지
--  답합니다. 실제 presigned URL 은 Edge Function 이 만듭니다
--  (R2 열쇠는 거기 secrets 에만 있고 DB 는 모릅니다).
-- ============================================================
create or replace function public.photo_allow(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_n    int;
  v_cap  int := app.photo_room_cap();
begin
  begin
    v_room := app.room_from_token(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'expired',
                              'message', '다시 입장해주세요');
  end;

  select count(*) into v_n
    from app.photos where room_id = v_room and deleted_at is null;

  if v_n >= v_cap then
    return jsonb_build_object('ok', false, 'code', 'limit',
      'message', format('사진은 한 방에 %s장까지예요. 지우고 올려주세요', v_cap));
  end if;

  -- 올릴 자리 이름을 DB 가 정합니다. 사용자가 정하게 하면 남의 사진을
  -- 덮어쓰는 이름을 지어낼 수 있습니다.
  return jsonb_build_object(
    'ok', true,
    'room', v_room,
    'key', v_room::text || '/' || replace(extensions.gen_random_uuid()::text, '-', ''),
    'left', v_cap - v_n
  );
end;
$$;


-- ============================================================
--  사진 기록하기 (R2 에 올린 뒤)
-- ============================================================
create or replace function public.photo_add(
  p_token   text,
  p_voter   text,
  p_key     text,
  p_thumb   text,
  p_width   int,
  p_height  int,
  p_bytes   int,
  p_caption text default null,
  p_nick    text default null
)
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
    raise exception '[denied] 누가 올리는지 알 수 없어요';
  end if;

  -- ★ 올릴 자리 이름은 "이 방 것" 이어야 합니다. 안 그러면 남의 방
  --   사진을 자기 방 것처럼 기록할 수 있습니다.
  if p_key is null or p_key not like v_room::text || '/%' then
    raise exception '[denied] 올릴 자리가 올바르지 않아요';
  end if;
  if p_thumb is null or p_thumb not like v_room::text || '/%' then
    raise exception '[denied] 올릴 자리가 올바르지 않아요';
  end if;

  if p_bytes is null or p_bytes <= 0 or p_bytes > 10000000 then
    raise exception '[bad] 사진 용량이 올바르지 않아요';
  end if;

  select count(*) into v_n
    from app.photos where room_id = v_room and deleted_at is null;
  if v_n >= app.photo_room_cap() then
    raise exception '[limit] 사진은 한 방에 %장까지예요', app.photo_room_cap();
  end if;

  insert into app.photos (
    room_id, r2_key, thumb_key, width, height, bytes, caption, nick, voter_key
  ) values (
    v_room, p_key, p_thumb,
    nullif(p_width, 0), nullif(p_height, 0), p_bytes,
    nullif(trim(coalesce(p_caption, '')), ''),
    nullif(trim(coalesce(p_nick, '')), ''),
    p_voter
  )
  returning id into v_id;

  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('id', v_id);

exception
  when unique_violation then
    raise exception '[conflict] 이미 올린 사진이에요';
end;
$$;


-- ============================================================
--  사진 지우기 (soft delete)
--
--  ★ R2 의 파일은 바로 지우지 않습니다. 실수로 지웠을 때 되돌릴 수
--    있어야 하고, 지우는 일은 나중에 모아서 하는 편이 낫습니다.
--    대신 목록에서 사라지므로 아무도 볼 수 없습니다.
-- ============================================================
create or replace function public.photo_remove(p_token text, p_voter text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_by   text;
begin
  select voter_key into v_by
    from app.photos where id = p_id and room_id = v_room and deleted_at is null;

  if v_by is null then
    raise exception '[denied] 없는 사진이에요';
  end if;

  if v_by <> coalesce(p_voter, '') and not app.is_owner(v_room) then
    raise exception '[denied] 직접 올린 사진만 지울 수 있어요';
  end if;

  update app.photos set deleted_at = now() where id = p_id;
  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
--  갤러리 불러오기
--
--  ★ room_snapshot 에 싣지 않습니다. 사진이 300장이면 목록만으로도
--    무거워지는데, 갤러리 탭을 안 여는 사람에게까지 매번 보낼 이유가
--    없습니다. 탭을 열 때만 부릅니다.
--    사진 댓글도 여기서 함께 가져옵니다.
-- ============================================================
create or replace function public.photo_list(p_token text, p_voter text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
begin
  return jsonb_build_object(
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'key', p.r2_key, 'thumb', p.thumb_key,
               'width', p.width, 'height', p.height, 'bytes', p.bytes,
               'caption', p.caption, 'nick', p.nick,
               'day_index', p.day_index, 'place_id', p.place_id,
               'mine', (p.voter_key = coalesce(p_voter, '')),
               'created_at', p.created_at
             ) order by p.created_at desc)
        from app.photos p
       where p.room_id = v_room and p.deleted_at is null
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'target_id', c.target_id,
               'body', c.body, 'nick', c.nick,
               'mine', (c.voter_key = coalesce(p_voter, '')),
               'created_at', c.created_at
             ) order by c.created_at)
        from app.comments c
       where c.room_id = v_room and c.deleted_at is null
         and c.target_type = 'photo'
    ), '[]'::jsonb),
    'cap', app.photo_room_cap(),
    'used', (select count(*) from app.photos
              where room_id = v_room and deleted_at is null)
  );
end;
$$;


-- ============================================================
--  권한 — 친구들도 올리고 봅니다
-- ============================================================
revoke execute on function public.photo_allow(text) from public;
revoke execute on function public.photo_add(text, text, text, text, int, int, int, text, text) from public;
revoke execute on function public.photo_remove(text, text, uuid) from public;
revoke execute on function public.photo_list(text, text) from public;

grant execute on function public.photo_allow(text)                                               to anon, authenticated;
grant execute on function public.photo_add(text, text, text, text, int, int, int, text, text)    to anon, authenticated;
grant execute on function public.photo_remove(text, text, uuid)                                  to anon, authenticated;
grant execute on function public.photo_list(text, text)                                          to anon, authenticated;


-- ============================================================
--  comment_add 가 사진도 확인하게 합니다
--
--  ★ 0006 을 만들 때는 사진이 없어서 'place' 만 확인했습니다.
--    그대로 두면 target_type='photo' 로 아무 uuid 나 적어 남의 방
--    사진에 댓글을 다는 것처럼 꾸밀 수 있습니다. 실제로 보이지는
--    않지만, 확인하지 않는 입력은 결국 문제가 됩니다.
--
--  0006 의 정의를 그대로 가져와 photo 분기만 더한 것입니다.
-- ============================================================
create or replace function public.comment_add(
  p_token  text,
  p_voter  text,
  p_target_type text,
  p_target_id   uuid,
  p_body   text,
  p_nick   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_body text := trim(coalesce(p_body, ''));
  v_nick text := trim(coalesce(p_nick, ''));
  v_n    int;
  v_id   uuid;
begin
  if coalesce(p_voter, '') = '' then
    raise exception '[denied] 누가 쓰는지 알 수 없어요';
  end if;
  if p_target_type not in ('place', 'photo') then
    raise exception '[bad] 어디에 다는 댓글인지 알 수 없어요';
  end if;
  if v_body = '' then
    raise exception '[bad] 내용을 적어주세요';
  end if;
  if char_length(v_body) > 500 then
    raise exception '[bad] 댓글이 너무 길어요 (500자까지)';
  end if;
  if v_nick = '' then
    raise exception '[bad] 별명을 적어주세요';
  end if;
  if char_length(v_nick) > 12 then
    raise exception '[bad] 별명이 너무 길어요 (12자까지)';
  end if;

  -- 이 방의 것이 맞는지. 아니면 남의 방 것에 댓글을 달 수 있습니다.
  if p_target_type = 'place' then
    if not exists (select 1 from app.places
                    where id = p_target_id and room_id = v_room and deleted_at is null) then
      raise exception '[denied] 없는 장소예요';
    end if;
  else
    if not exists (select 1 from app.photos
                    where id = p_target_id and room_id = v_room and deleted_at is null) then
      raise exception '[denied] 없는 사진이에요';
    end if;
  end if;

  select count(*) into v_n from app.comments
   where room_id = v_room and deleted_at is null;
  if v_n >= 200 then
    raise exception '[limit] 한 방에 달 수 있는 댓글을 넘었어요 (200개)';
  end if;

  insert into app.comments (room_id, target_type, target_id, body, nick, voter_key)
  values (v_room, p_target_type, p_target_id, v_body, v_nick, p_voter)
  returning id into v_id;

  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('id', v_id);
end;
$$;
