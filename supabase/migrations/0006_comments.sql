-- ============================================================
--  0006 — 댓글
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0001 ~ 0005 를 먼저 올린 뒤에 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
--  댓글
--
--  ★ 투표는 익명, 댓글은 별명입니다. 목적이 다릅니다.
--    투표는 눈치 안 보고 고르라고 익명이고,
--    댓글은 대화가 되라고 별명을 씁니다.
--    완전 익명 댓글은 "누가 쓴 거야?"가 되어 오히려 불편합니다.
--
--  ★ voter_key 는 바깥으로 절대 나가지 않습니다.
--    나가면 "이 댓글 쓴 사람이 이 숙소에 투표했네"가 되어
--    투표 익명성이 댓글을 통해 깨집니다.
--
--  ★ target_type 이 'photo' 도 받습니다 (3단계 갤러리).
--    다형성이라 외래키를 걸 수 없으므로 RPC 에서 존재를 확인합니다.
-- ------------------------------------------------------------
create table if not exists app.comments (
  id          uuid primary key default extensions.gen_random_uuid(),
  room_id     uuid not null references app.rooms(id) on delete cascade,
  target_type text not null check (target_type in ('place', 'photo')),
  target_id   uuid not null,
  body        text not null check (char_length(body) between 1 and 500),
  nick        text not null check (char_length(nick) between 1 and 12),
  voter_key   text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table app.comments enable row level security;

create index if not exists comments_target_idx
  on app.comments (room_id, target_type, target_id) where deleted_at is null;

drop trigger if exists comments_touch on app.comments;
create trigger comments_touch after insert or update or delete on app.comments
  for each row execute function app.touch_room();


-- ============================================================
--  댓글 달기
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

  -- 이 방의 것이 맞는지. 아니면 남의 방 장소에 댓글을 달 수 있습니다.
  if p_target_type = 'place' then
    if not exists (select 1 from app.places
                    where id = p_target_id and room_id = v_room and deleted_at is null) then
      raise exception '[denied] 없는 장소예요';
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


-- ============================================================
--  댓글 지우기 (soft delete)
--  자기 것만. 방장은 전부.
-- ============================================================
create or replace function public.comment_remove(p_token text, p_voter text, p_id uuid)
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
    from app.comments where id = p_id and room_id = v_room and deleted_at is null;

  if v_by is null then
    raise exception '[denied] 없는 댓글이에요';
  end if;

  if v_by <> coalesce(p_voter, '') and not app.is_owner(v_room) then
    raise exception '[denied] 직접 쓴 댓글만 지울 수 있어요';
  end if;

  update app.comments set deleted_at = now() where id = p_id;
  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
--  권한
-- ============================================================
revoke execute on function public.comment_add(text, text, text, uuid, text, text) from public;
revoke execute on function public.comment_remove(text, text, uuid) from public;

grant execute on function public.comment_add(text, text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.comment_remove(text, text, uuid)                to anon, authenticated;


-- ============================================================
--  room_snapshot 에 댓글을 싣습니다
--
--  ★ 0005 의 정의를 기계로 가져와 'comments' 만 덧붙인 것입니다.
--    사진 댓글(target_type='photo')은 갤러리 탭을 열 때 따로
--    불러옵니다 — 사진이 많아지면 스냅샷이 무거워지니까요.
--    방 하나의 장소 댓글은 작아서 본문까지 같이 싣습니다.
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
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'item', e.item, 'amount', e.amount,
               'payer', e.payer,
               'mine', (e.created_by = coalesce(p_voter, '')),
               'created_at', e.created_at
             ) order by e.created_at)
        from app.expenses e
       where e.room_id = v_room and e.deleted_at is null
    ), '[]'::jsonb),
    'itinerary', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day_index', i.day_index,
               'the_date',  i.the_date,
               'label',     i.label,
               'slots',     i.slots,
               'version',   i.version
             ) order by i.day_index)
        from app.itinerary_days i
       where i.room_id = v_room
    ), '[]'::jsonb),
    /* ★ voter_key 는 내보내지 않습니다. 내보내면 "이 댓글 쓴 사람이
          이 숙소에 투표했네"가 되어 투표 익명성이 댓글로 깨집니다.
          내가 쓴 것인지는 mine 불리언으로만 알려줍니다. */
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'target_type', c.target_type,
               'target_id', c.target_id,
               'body', c.body,
               'nick', c.nick,
               'mine', (c.voter_key = coalesce(p_voter, '')),
               'created_at', c.created_at
             ) order by c.created_at)
        from app.comments c
       where c.room_id = v_room and c.deleted_at is null
         and c.target_type = 'place'
    ), '[]'::jsonb)
  );
end;
$$;
