-- ============================================================
--  0003 — 비밀번호 화면에 여행 이름 보여주기
--
--  0001, 0002 를 먼저 실행하세요.
--  여러 번 실행해도 안전합니다.
--
--  왜 필요한가:
--    친구가 카톡으로 링크를 받아 열면 "여행방"이라고만 떠서,
--    제대로 찾아온 건지 알 수가 없었습니다. 비밀번호를 넣기 전에
--    "겨울 강릉"이라고 보이면 바로 확신이 섭니다.
--
--  ★ 무엇이 공개되고 무엇이 안 되는가
--
--    공개: 여행 이름, 화면 테마
--    비공개: 날짜, 지역, 인원, 숙소·맛집, 투표, 경비, 일정 — 전부 비밀번호 뒤
--
--    즉 "링크를 가진 사람"은 **여행 이름만** 알 수 있고,
--    "비밀번호까지 아는 사람"만 나머지를 볼 수 있습니다.
--
--    화면에 안 쓰는 값은 보내지 않습니다. 보낸 것은 언젠가 새어 나가고,
--    안 보낸 것은 샐 수가 없습니다.
--
--  ★ 방 주소를 찍어서 남의 방을 찾을 수 있나?
--    주소는 모음 없는 27자 알파벳 9자입니다. 27^9 ≈ 7.6조 가지라
--    초당 백만 번을 찍어도 수십만 년이 걸립니다. 실질적으로 불가능합니다.
--    그래서 "링크를 받은 사람에게만 보인다"가 성립합니다.
--
--  ★ room_join 과 톤이 다른 이유
--    room_join 은 "없는 방"과 "비밀번호 틀림"을 일부러 구분하지 않습니다.
--    비밀번호를 찍어보는 사람에게 힌트를 주지 않기 위해서입니다.
--    peek 은 애초에 비밀번호와 무관하므로 그 고민이 적용되지 않습니다.
-- ============================================================

create or replace function public.room_peek(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := upper(trim(coalesce(p_slug, '')));
  v_r    app.rooms;
begin
  -- 모양이 안 맞으면 조회조차 하지 않습니다 (잘못 복사한 링크, 무작위 요청)
  if v_slug !~ '^[23456789BCDFGHJKMNPQRSTVWXZ]{9}$' then
    return null;
  end if;

  select * into v_r from app.rooms where slug = v_slug;
  if v_r.id is null then
    return null;          -- 없는 방 — 예외가 아니라 null 입니다
  end if;

  -- ★ last_seen_at 을 건드리지 않습니다.
  --   여기서 갱신하면 링크만 아는 사람이 방을 영원히 살려둘 수 있습니다.
  --   "아직 쓰는 방"의 기준은 실제로 들어온 사람(room_join)이어야 합니다.

  return jsonb_build_object(
    'title', v_r.title,
    'theme', v_r.settings ->> 'theme'   -- 게이트부터 계절을 입히는 데만 씁니다
  );
end;
$$;

-- 비밀번호 화면에서 부르는 것이므로 누구나 호출할 수 있어야 합니다
grant execute on function public.room_peek(text) to anon, authenticated;
