-- ============================================================
--  0004 — 경비 정산
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  여러 번 실행해도 안전합니다.
--
--  0001, 0002 를 먼저 올린 뒤에 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
--  쓴 돈
--
--  ★ 결제자(payer)는 자유 입력이고 실명이 들어올 수 있습니다.
--    개인정보보호법상 개인정보입니다. 화면에서 "별명을 권한다"고
--    안내하고, 계좌번호 같은 건 적지 않도록 item 길이를 짧게 둡니다.
-- ------------------------------------------------------------
create table if not exists app.expenses (
  id          uuid primary key default extensions.gen_random_uuid(),
  room_id     uuid not null references app.rooms(id) on delete cascade,
  item        text not null check (char_length(item) between 1 and 60),
  amount      bigint not null check (amount > 0 and amount <= 100000000),
  payer       text not null check (char_length(payer) between 1 and 20),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table app.expenses enable row level security;

create index if not exists expenses_room_idx
  on app.expenses (room_id, created_at) where deleted_at is null;

-- 쓸 때마다 방의 updated_at 을 올려 room_snapshot 의 p_since 가 동작하게 합니다
drop trigger if exists expenses_touch on app.expenses;
create trigger expenses_touch after insert or update or delete on app.expenses
  for each row execute function app.touch_room();


-- ============================================================
--  지출 적기
-- ============================================================
create or replace function public.expense_add(
  p_token  text,
  p_voter  text,
  p_item   text,
  p_amount bigint,
  p_payer  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_item text := trim(coalesce(p_item, ''));
  v_payer text := trim(coalesce(p_payer, ''));
  v_n    int;
  v_id   uuid;
begin
  if coalesce(p_voter, '') = '' then
    raise exception '[denied] 누가 적는지 알 수 없어요';
  end if;
  if v_item = '' then
    raise exception '[bad] 어디에 썼는지 적어주세요';
  end if;
  if char_length(v_item) > 60 then
    raise exception '[bad] 항목이 너무 길어요 (60자까지)';
  end if;
  if v_payer = '' then
    raise exception '[bad] 누가 냈는지 적어주세요';
  end if;
  if char_length(v_payer) > 20 then
    raise exception '[bad] 이름이 너무 길어요 (20자까지)';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception '[bad] 금액을 적어주세요';
  end if;
  if p_amount > 100000000 then
    raise exception '[bad] 금액이 너무 커요 (1억까지)';
  end if;

  select count(*) into v_n from app.expenses
   where room_id = v_room and deleted_at is null;
  if v_n >= 300 then
    raise exception '[limit] 한 방에 적을 수 있는 지출을 넘었어요 (300개)';
  end if;

  insert into app.expenses (room_id, item, amount, payer, created_by)
  values (v_room, v_item, p_amount, v_payer, p_voter)
  returning id into v_id;

  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('id', v_id);
end;
$$;


-- ============================================================
--  지출 지우기 (soft delete)
--  자기가 적은 것만. 방장은 전부 지울 수 있습니다.
-- ============================================================
create or replace function public.expense_remove(p_token text, p_voter text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_by   text;
begin
  select created_by into v_by
    from app.expenses where id = p_id and room_id = v_room and deleted_at is null;

  if v_by is null then
    raise exception '[denied] 없는 지출이에요';
  end if;

  if v_by <> coalesce(p_voter, '') and not app.is_owner(v_room) then
    raise exception '[denied] 직접 적은 것만 지울 수 있어요';
  end if;

  update app.expenses set deleted_at = now() where id = p_id;
  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
--  권한
--
--  ★ 친구도 적고 지울 수 있어야 합니다. 총무 한 명만 적게 하면
--    결국 카톡으로 불러주고 총무가 받아적는 꼴이 됩니다.
-- ============================================================
revoke execute on function public.expense_add(text, text, text, bigint, text) from public;
revoke execute on function public.expense_remove(text, text, uuid) from public;

grant execute on function public.expense_add(text, text, text, bigint, text) to anon, authenticated;
grant execute on function public.expense_remove(text, text, uuid)           to anon, authenticated;


-- ============================================================
--  room_snapshot 에 경비를 싣습니다
--
--  ★ 0002 의 정의를 그대로 가져와 'expenses' 만 덧붙인 것입니다.
--    손으로 옮겨 적으면 어딘가 빠뜨리므로 기계로 붙였습니다.
--    0002 를 고치면 여기도 같이 고쳐야 합니다 —
--    tests/sql/test.sql 이 둘이 어긋나면 잡아냅니다.
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
    ), '[]'::jsonb)
  );
end;
$$;
