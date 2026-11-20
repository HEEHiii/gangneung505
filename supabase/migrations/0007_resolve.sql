-- ============================================================
--  0007 — 짧은 링크 풀기 허가
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0001 ~ 0006 을 먼저 올린 뒤에 실행하세요.
--
--  이 파일만으로는 아무 일도 안 일어납니다. Edge Function
--  (supabase/functions/resolve-link) 을 배포해야 실제로 동작합니다.
-- ============================================================

-- ------------------------------------------------------------
--  Edge Function 이 "이 요청을 처리해도 되는가" 를 묻는 함수
--
--  ★ 왜 SQL 에 두는가
--
--  Edge Function 은 누구나 주소만 알면 부를 수 있습니다. 그대로 두면
--  아무나 우리 서버를 시켜 아무 주소나 긁게 하는 공개 프록시가 됩니다.
--  그래서 (1) 진짜 방 토큰인지, (2) 너무 자주 부르지 않는지를 봅니다.
--
--  이 판단을 Edge Function 안에 코드로 넣으면 테스트가 어렵습니다.
--  SQL 에 두면 tests/sql/test.sql 이 그대로 돌려볼 수 있습니다.
--
--  ★ 예외를 던지지 않고 값으로 돌려줍니다.
--    raise exception 은 같은 트랜잭션의 INSERT 를 되돌립니다.
--    room_join 에서 그것 때문에 잠금 카운터가 영영 0 이었습니다.
--    여기서 그러면 횟수가 영원히 안 쌓입니다.
-- ------------------------------------------------------------
create or replace function public.resolve_allow(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_key  text;
  v_n    int;
begin
  begin
    v_room := app.room_from_token(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'expired',
                              'message', '다시 입장해주세요');
  end;

  v_key := v_room::text;

  -- 한 방이 한 시간에 20번까지
  select count(*) into v_n
    from app.rate_events
   where bucket = 'resolve' and key_hash = v_key and at > now() - interval '1 hour';

  if v_n >= 20 then
    return jsonb_build_object('ok', false, 'code', 'rate',
                              'message', '링크 풀기를 너무 자주 했어요. 잠시 뒤에 다시 해주세요');
  end if;

  insert into app.rate_events (bucket, key_hash) values ('resolve', v_key);

  -- 오래된 기록은 그때그때 치웁니다 (따로 청소할 일이 없게)
  delete from app.rate_events
   where bucket = 'resolve' and at < now() - interval '2 hours';

  return jsonb_build_object('ok', true, 'left', 19 - v_n);
end;
$$;

revoke execute on function public.resolve_allow(text) from public;
grant execute on function public.resolve_allow(text) to anon, authenticated;
