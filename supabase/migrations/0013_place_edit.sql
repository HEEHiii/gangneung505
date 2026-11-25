-- ============================================================
--  0013 — 숙소·맛집 카드 고치기
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  여러 번 돌려도 안전합니다.
--
--  지금까지는 추가와 삭제만 됐습니다. 이름에 오타가 나거나 가격이
--  바뀌면 지우고 다시 넣어야 했는데, 그러면 그 카드에 모인 투표와
--  댓글이 같이 사라집니다. 고치기가 없으면 "오타 하나 = 투표 초기화"
--  입니다.
--
--  ★ 위치(lat/lng)는 일부러 못 고치게 뒀습니다.
--    좌표를 손으로 바꾸게 하면 지도 핀과 카드가 어긋나기 쉽고,
--    제대로 하려면 지도에서 찍는 화면이 따로 있어야 합니다.
--    장소 자체가 틀렸다면 지우고 다시 넣는 것이 맞습니다.
--    (그때는 투표가 사라지는 게 오히려 맞습니다 — 다른 곳이니까요)
--
--  ★ kind 도 못 바꿉니다. 숙소를 맛집으로 바꾸면 투표의 뜻이
--    달라집니다. 그것도 다시 넣는 쪽이 정직합니다.
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
  v_room uuid := app.room_from_token(p_token);
  v_by   text;
  v_name text;
begin
  select created_by into v_by
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

  /* ★ 보낸 칸만 고칩니다 (p_data ? 'key').

     coalesce 로 "없으면 원래 값" 을 쓰면, 메모를 일부러 지우려고
     빈 값을 보내도 지워지지 않습니다. 칸이 왔는지 자체를 봐야
     "비우기" 와 "안 건드림" 이 구별됩니다. */
  update app.places set
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
