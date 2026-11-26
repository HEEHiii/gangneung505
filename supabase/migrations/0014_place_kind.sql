-- ============================================================
--  0014 — 수정할 때 분류도 바꿀 수 있게
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  여러 번 돌려도 안전합니다. 0013 을 안 돌렸어도 이 파일만으로
--  됩니다 (함수를 통째로 다시 만듭니다).
--
--  ── 왜 0013 을 고치나
--
--  0013 에서 kind 를 일부러 못 바꾸게 막았습니다. 이유는
--  "숙소를 맛집으로 바꾸면 그 카드에 모인 표의 뜻이 달라진다"
--  였습니다. 그 자체는 맞습니다. 그런데 규칙을 너무 넓게 잡았습니다.
--
--  맛집 탭 안에는 식당·카페·관광이 같이 있습니다. 이름으로 검색해
--  추가하면 그 셋 중 뭔지 알 수 없는 채로 들어갑니다. 카페를
--  식당으로 고치는 건 "같은 장소를 제대로 분류하는 것" 이지
--  다른 장소로 바꾸는 게 아닙니다. 표의 뜻도 그대로입니다.
--
--  그래서 넘지 못하는 선은 하나만 남깁니다 — 숙소와 그 나머지.
--  탭을 넘어가는 이동만 막고, 탭 안에서는 자유롭게 바꿉니다.
-- ============================================================

create or replace function public.place_edit(
  p_token text,
  p_voter text,
  p_id    uuid,
  p_data  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room     uuid := app.room_from_token(p_token);
  v_by       text;
  v_old_kind text;
  v_name     text;
  v_kind     text;
begin
  select created_by, kind into v_by, v_old_kind
    from app.places
   where id = p_id and room_id = v_room and deleted_at is null;

  if v_by is null then
    raise exception '[denied] 없는 장소예요';
  end if;

  -- 지우기와 같은 규칙입니다: 직접 올린 사람, 또는 방장.
  if v_by <> coalesce(p_voter, '') and not app.is_owner(v_room) then
    raise exception '[denied] 직접 추가한 곳만 고칠 수 있어요';
  end if;

  -- 이름은 비울 수 없습니다. 카드에서 유일하게 꼭 있어야 하는 값입니다.
  if p_data ? 'name' then
    v_name := trim(coalesce(p_data ->> 'name', ''));
    if v_name = '' then
      raise exception '[invalid] 이름은 비울 수 없어요';
    end if;
    if char_length(v_name) > 80 then
      raise exception '[invalid] 이름이 너무 길어요 (80자까지)';
    end if;
  end if;

  /* ★ 분류는 같은 탭 안에서만 바꿉니다.

     넘지 못하는 선은 숙소 ↔ 나머지 하나뿐입니다. 숙소 탭과 맛집
     탭은 서로 다른 것을 고르는 자리라, 표가 뜻하는 바가 다릅니다.
     식당·카페·관광 사이는 같은 목록 안의 꼬리표일 뿐이라
     자유롭게 바꿔도 표의 뜻이 그대로입니다. */
  if p_data ? 'kind' then
    v_kind := trim(coalesce(p_data ->> 'kind', ''));
    if v_kind not in ('lodging', 'food', 'cafe', 'spot') then
      raise exception '[invalid] 모르는 분류예요';
    end if;
    if (v_old_kind = 'lodging') <> (v_kind = 'lodging') then
      raise exception '[denied] 숙소와 맛집 사이로는 못 옮겨요. 지우고 다시 넣어주세요';
    end if;
  end if;

  /* ★ 보낸 칸만 고칩니다 (p_data ? 'key').

     coalesce 로 "없으면 원래 값" 을 쓰면, 메모를 일부러 지우려고
     빈 값을 보내도 지워지지 않습니다. 칸이 왔는지 자체를 봐야
     "비우기" 와 "안 건드림" 이 구별됩니다. */
  update app.places set
    kind = case when p_data ? 'kind'
                then trim(p_data ->> 'kind') else kind end,
    name = case when p_data ? 'name'
                then trim(p_data ->> 'name') else name end,
    note = case when p_data ? 'note'
                then nullif(trim(coalesce(p_data ->> 'note', '')), '') else note end,
    url  = case when p_data ? 'url'
                then nullif(trim(coalesce(p_data ->> 'url', '')), '') else url end,
    capacity = case when p_data ? 'capacity'
                then nullif(trim(coalesce(p_data ->> 'capacity', '')), '') else capacity end,
    price = case when p_data ? 'price'
                then nullif(p_data ->> 'price', '')::integer else price end
  where id = p_id;

  update app.rooms set last_seen_at = now() where id = v_room;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;


-- ------------------------------------------------------------
--  권한 — 추가·삭제와 같습니다 (친구들도 씁니다)
-- ------------------------------------------------------------
revoke execute on function public.place_edit(text, text, uuid, jsonb) from public;
grant  execute on function public.place_edit(text, text, uuid, jsonb) to anon, authenticated;
