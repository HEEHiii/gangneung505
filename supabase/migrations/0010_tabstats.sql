-- ============================================================
--  0010 — 어느 탭을 많이 쓰는지
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0001 ~ 0009 를 먼저 올린 뒤에 실행하세요.
--
--  안 돌려도 사이트는 그대로 돕니다. 이 함수가 없으면 세는 쪽이
--  조용히 포기하도록 만들어 두었습니다 (app/assets/store.js 의
--  tabSeen 주석 참고). 다만 돌리지 않으면 "오늘부터의 기록"이
--  쌓이지 않습니다 — 지난 일은 나중에 되살릴 수 없습니다.
-- ============================================================

-- ------------------------------------------------------------
--  탭 사용 수
--
--  ★ 여기에 "누가" 와 "어느 방" 이 없는 것은 실수가 아닙니다.
--
--    알고 싶은 것은 "정산 탭이 쓰이긴 하는가" 한 가지입니다.
--    그 답에는 방도 사람도 필요 없습니다. 반대로 room_id 를
--    하나 넣는 순간, 이 표는 "그 방 사람들이 언제 접속했는지"를
--    말해주는 접속 기록이 되고, 개인정보로 다뤄야 합니다.
--
--    그래서 날짜와 탭 이름, 숫자 하나만 둡니다. 이 표를 통째로
--    누가 가져가도 알 수 있는 것은 "11월 20일에 지도 탭이
--    40번 열렸다" 뿐입니다.
--
--  ★ 한 사람이 탭을 백 번 눌러도 하루 한 번만 셉니다.
--    세는 단위를 "눌린 횟수"로 두면 지도처럼 왔다 갔다 하게 되는
--    탭이 무조건 이깁니다. 궁금한 것은 "몇 명이 보긴 하는가"
--    이므로, 브라우저가 하루에 탭마다 한 번만 보냅니다.
-- ------------------------------------------------------------
create table if not exists app.tab_views (
  the_date date not null default current_date,
  tab      text not null,
  views    integer not null default 0,
  primary key (the_date, tab)
);

alter table app.tab_views enable row level security;
-- 정책은 하나도 만들지 않습니다 → anon·authenticated 는 직접 못 봅니다.


-- ------------------------------------------------------------
--  세기
--
--  방 토큰을 확인하는 이유는 방 때문이 아니라, 아무나 바깥에서
--  숫자를 부풀리지 못하게 하기 위해서입니다. 어느 방인지는
--  확인만 하고 버립니다.
--
--  ★ stable 을 붙이면 안 됩니다. app.room_from_token 이
--    last_used_at 을 갱신하는데, PostgREST 는 stable 함수를
--    읽기 전용 트랜잭션에서 돌려서 통째로 실패합니다.
--    (0008 에서 실제로 겪은 일입니다. tests/sql/test.sql 9.11 이 지킵니다.)
-- ------------------------------------------------------------
create or replace function public.tab_seen(p_token text, p_tab text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 토큰이 유효한지만 봅니다. 틀리면 여기서 예외가 납니다.
  perform app.room_from_token(p_token);

  -- 모르는 이름은 조용히 버립니다. 표가 쓰레기로 차지 않게.
  if p_tab is null or p_tab not in ('stay', 'food', 'plan', 'money', 'photo') then
    return;
  end if;

  insert into app.tab_views as t (the_date, tab, views)
  values (current_date, p_tab, 1)
  on conflict (the_date, tab) do update
    set views = t.views + 1;
end
$$;


-- ------------------------------------------------------------
--  보기 — 로그인한 사람만
--
--  숫자 자체는 비밀이 아니지만, 서비스 상태를 아무나 들여다볼
--  이유도 없어서 로그인 뒤에 둡니다.
-- ------------------------------------------------------------
create or replace function public.tab_report(p_days integer default 30)
returns table (tab text, views bigint, first_day date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;

  return query
    select t.tab, sum(t.views)::bigint, min(t.the_date)
      from app.tab_views t
     where t.the_date > current_date - v_days
     group by t.tab
     order by 2 desc;
end
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
revoke execute on function public.tab_seen(text, text) from public;
revoke execute on function public.tab_report(integer)  from public;

grant execute on function public.tab_seen(text, text) to anon, authenticated;
grant execute on function public.tab_report(integer)  to authenticated;
