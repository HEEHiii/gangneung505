-- ============================================================
--  0005 — 일정
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0001 ~ 0004 를 먼저 올린 뒤에 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
--  날짜별 일정
--
--  ★ "일정 전체"를 통짜로 저장하지 않고 날짜마다 한 줄씩 둡니다.
--
--    505 는 일정 전체를 한 덩어리로 저장했습니다. 두 사람이 동시에
--    고치면 나중에 저장한 사람이 앞사람 것을 통째로 덮어썼고,
--    아무 표시도 없었습니다. 친구가 한 시간 들여 짠 일정이 조용히
--    사라지는 겁니다.
--
--    날짜별로 나누면 충돌 범위가 "여행 전체"에서 "같은 날"로 줄고,
--    version 을 확인해서 "친구가 먼저 고쳤어요" 라고 알릴 수 있습니다.
--    조용한 유실 대신 보이는 재조회입니다.
-- ------------------------------------------------------------
create table if not exists app.itinerary_days (
  room_id    uuid not null references app.rooms(id) on delete cascade,
  day_index  smallint not null check (day_index between 0 and 14),
  the_date   date,
  label      text check (char_length(label) <= 40),
  slots      jsonb not null default '[]'::jsonb,
  version    integer not null default 1,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (room_id, day_index),
  check (jsonb_typeof(slots) = 'array'),
  check (jsonb_array_length(slots) <= 40),
  check (pg_column_size(slots) < 65536)
);
alter table app.itinerary_days enable row level security;

drop trigger if exists itinerary_touch on app.itinerary_days;
create trigger itinerary_touch after insert or update or delete on app.itinerary_days
  for each row execute function app.touch_room();


-- ============================================================
--  하루치 저장
--
--  p_expected_version 을 함께 보냅니다. 그 사이 누가 고쳤으면
--  덮어쓰지 않고 [stale] 로 알립니다. 화면은 그 날만 다시 불러오고
--  "친구가 먼저 고쳤어요" 를 띄웁니다.
--
--  ★ 예외를 던지지 않고 값으로 돌려줍니다.
--    raise exception 은 같은 트랜잭션의 INSERT 까지 되돌립니다.
--    room_join 에서 그것 때문에 잠금 카운터가 영영 0 이었습니다.
--    여기서도 같은 함정을 피합니다.
-- ============================================================
create or replace function public.itinerary_day_save(
  p_token   text,
  p_voter   text,
  p_index   int,
  p_slots   jsonb,
  p_expected_version int default null,
  p_date    date default null,
  p_label   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_cur  int;
  v_new  int;
begin
  if coalesce(p_voter, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'denied',
                              'message', '누가 고치는지 알 수 없어요');
  end if;
  if p_index is null or p_index < 0 or p_index > 14 then
    return jsonb_build_object('ok', false, 'code', 'bad',
                              'message', '없는 날짜예요');
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'bad',
                              'message', '일정 모양이 올바르지 않아요');
  end if;
  if jsonb_array_length(p_slots) > 40 then
    return jsonb_build_object('ok', false, 'code', 'limit',
                              'message', '하루에 넣을 수 있는 칸을 넘었어요 (40개)');
  end if;

  select version into v_cur
    from app.itinerary_days where room_id = v_room and day_index = p_index;

  if v_cur is null then
    insert into app.itinerary_days (room_id, day_index, the_date, label, slots, version, updated_by)
    values (v_room, p_index, p_date, p_label, p_slots, 1, p_voter)
    on conflict (room_id, day_index) do nothing;

    select version into v_cur
      from app.itinerary_days where room_id = v_room and day_index = p_index;
    if v_cur = 1 then
      update app.rooms set last_seen_at = now() where id = v_room;
      return jsonb_build_object('ok', true, 'version', 1);
    end if;
    -- 그 찰나에 누가 먼저 만들었습니다
    return jsonb_build_object('ok', false, 'code', 'stale', 'version', v_cur,
                              'message', '친구가 먼저 고쳤어요. 최신 내용을 불러왔어요');
  end if;

  if p_expected_version is not null and p_expected_version <> v_cur then
    return jsonb_build_object('ok', false, 'code', 'stale', 'version', v_cur,
                              'message', '친구가 먼저 고쳤어요. 최신 내용을 불러왔어요');
  end if;

  update app.itinerary_days
     set slots = p_slots,
         the_date = coalesce(p_date, the_date),
         label = coalesce(p_label, label),
         version = version + 1,
         updated_by = p_voter,
         updated_at = now()
   where room_id = v_room and day_index = p_index
     and (p_expected_version is null or version = p_expected_version)
  returning version into v_new;

  if v_new is null then
    select version into v_cur
      from app.itinerary_days where room_id = v_room and day_index = p_index;
    return jsonb_build_object('ok', false, 'code', 'stale', 'version', v_cur,
                              'message', '친구가 먼저 고쳤어요. 최신 내용을 불러왔어요');
  end if;

  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('ok', true, 'version', v_new);
end;
$$;


-- ============================================================
--  일정 전체를 새로 짜기 (자동 생성 결과를 한 번에)
--
--  여기서는 version 을 보지 않습니다. "처음부터 다시 짜기"는
--  사용자가 명시적으로 누르는 동작이고, 화면에서 한 번 더 묻습니다.
-- ============================================================
create or replace function public.itinerary_build_save(
  p_token text,
  p_voter text,
  p_days  jsonb          -- [{day_index, the_date, label, slots}]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := app.room_from_token(p_token);
  v_d    jsonb;
  v_n    int := 0;
begin
  if coalesce(p_voter, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'denied',
                              'message', '누가 고치는지 알 수 없어요');
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'bad',
                              'message', '일정 모양이 올바르지 않아요');
  end if;
  if jsonb_array_length(p_days) > 15 then
    return jsonb_build_object('ok', false, 'code', 'limit',
                              'message', '여행이 너무 길어요 (15일까지)');
  end if;

  for v_d in select * from jsonb_array_elements(p_days) loop
    if jsonb_array_length(coalesce(v_d -> 'slots', '[]'::jsonb)) > 40 then
      return jsonb_build_object('ok', false, 'code', 'limit',
                                'message', '하루에 넣을 수 있는 칸을 넘었어요 (40개)');
    end if;

    insert into app.itinerary_days (room_id, day_index, the_date, label, slots, version, updated_by)
    values (
      v_room,
      (v_d ->> 'day_index')::int,
      nullif(v_d ->> 'the_date', '')::date,
      nullif(v_d ->> 'label', ''),
      coalesce(v_d -> 'slots', '[]'::jsonb),
      1, p_voter
    )
    on conflict (room_id, day_index) do update
      set slots = excluded.slots,
          the_date = excluded.the_date,
          label = excluded.label,
          version = app.itinerary_days.version + 1,
          updated_by = excluded.updated_by,
          updated_at = now();
    v_n := v_n + 1;
  end loop;

  update app.rooms set last_seen_at = now() where id = v_room;
  return jsonb_build_object('ok', true, 'days', v_n);
end;
$$;


-- ============================================================
--  권한 — 일정도 친구들이 같이 고칩니다
-- ============================================================
revoke execute on function public.itinerary_day_save(text, text, int, jsonb, int, date, text) from public;
revoke execute on function public.itinerary_build_save(text, text, jsonb) from public;

grant execute on function public.itinerary_day_save(text, text, int, jsonb, int, date, text) to anon, authenticated;
grant execute on function public.itinerary_build_save(text, text, jsonb)                     to anon, authenticated;


-- ============================================================
--  room_snapshot 에 일정을 싣습니다
--
--  ★ 0004 의 정의를 기계로 가져와 'itinerary' 만 덧붙인 것입니다.
--    create or replace 라 데이터베이스는 "마지막" 것을 씁니다.
--    tests/rpc-contract.check.mjs 도 마지막 정의를 읽습니다.
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
    ), '[]'::jsonb)
  );
end;
$$;
