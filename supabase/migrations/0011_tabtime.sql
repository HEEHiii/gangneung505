-- ============================================================
--  0011 — 탭에 얼마나 머무는지, 그리고 통계는 나만 보기
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0010 을 먼저 올린 뒤에 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
--  통계를 볼 수 있는 사람
--
--  0010 에서는 "로그인한 사람이면 누구나" 였습니다. 지금은 방장이
--  한 명뿐이라 같은 말이었지만, 다른 사람이 방을 만들기 시작하면
--  그 사람도 서비스 전체 숫자를 보게 됩니다. 그래서 명단을 둡니다.
--
--  ★ 이 표에 자기를 넣는 방법은 SQL Editor 뿐입니다. 사이트에서
--    자기를 관리자로 만드는 길은 열어두지 않았습니다.
-- ------------------------------------------------------------
create table if not exists app.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note    text,
  added_at timestamptz not null default now()
);

alter table app.admins enable row level security;

-- ★ 이 파일은 명단을 "비워둔 채로" 끝납니다. 아무도 넣지 않습니다.
--
--   전에는 여기서 auth.users 를 통째로 넣었습니다. "어차피 방장은
--   한 명뿐"이라고 보고 짠 건데, 카카오 로그인을 한 번이라도 한
--   사람은 전부 관리자가 됩니다. 친구 한 명이 호기심에 로그인해도
--   그렇게 됩니다. 조건이 하나도 없는 insert 였습니다.
--
--   명단이 비면 app.is_admin() 은 모두에게 false 이고,
--   tab_report 는 아무에게도 숫자를 주지 않습니다. 즉 기본값이
--   "아무도 못 봄" 입니다. 잠긴 쪽이 기본이어야 안전합니다.
--
--   자기를 넣는 것은 supabase/make-me-admin.sql 로 따로 합니다.
--   사이트 화면에서 자기를 관리자로 만드는 길은 없습니다.

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.admins a where a.user_id = auth.uid());
$$;


-- ------------------------------------------------------------
--  머문 시간
--
--  ★ 왜 "본 사람 수"와 따로 세는가: 숙소 탭은 누구나 한 번은
--    열어봅니다. 그 숫자만 보면 전부 비슷해 보입니다. 정작
--    궁금한 것은 "열고 나서 뭘 하다 가는가" 이고, 그건 머문
--    시간으로 드러납니다.
--
--  ★ 여기도 사람과 방은 기록하지 않습니다. 날짜·탭별 합계뿐입니다.
--
--  seconds 는 합계, visits 는 들어온 횟수입니다. 둘을 나누면
--  "한 번 들어와서 평균 얼마나 머무는가" 가 나옵니다. 합계만
--  두면 사람이 많은 탭이 무조건 이겨서 비교가 안 됩니다.
-- ------------------------------------------------------------
alter table app.tab_views add column if not exists visits  integer not null default 0;
alter table app.tab_views add column if not exists seconds bigint  not null default 0;

create or replace function public.tab_time(p_token text, p_tab text, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sec integer;
begin
  -- 토큰 확인은 숫자를 바깥에서 부풀리지 못하게 하려는 것입니다.
  -- 어느 방인지는 확인만 하고 버립니다.
  -- ★ stable 을 붙이면 안 됩니다 (0010 주석과 tests/sql/test.sql 9.11 참고)
  perform app.room_from_token(p_token);

  if p_tab is null or p_tab not in ('stay', 'food', 'plan', 'money', 'photo') then
    return;
  end if;

  -- ★ 30분에서 자릅니다. 창을 켜 둔 채 자리를 비우면 몇 시간이
  --   찍히고, 그 한 번이 평균을 통째로 망칩니다. 브라우저도
  --   화면이 가려지면 세는 것을 멈추지만, 믿을 수 있는 쪽은 여기입니다.
  v_sec := least(greatest(coalesce(p_seconds, 0), 0), 1800);

  -- 스쳐 지나간 것은 버립니다
  if v_sec < 2 then
    return;
  end if;

  -- views 를 0 으로 넣는 것은 일부러입니다. "몇 명이 봤나"는
  -- tab_seen 이 하루 한 번만 세고, 머문 시간과는 단위가 다릅니다.
  insert into app.tab_views as t (the_date, tab, views, visits, seconds)
  values (current_date, p_tab, 0, 1, v_sec)
  on conflict (the_date, tab) do update
    set visits  = t.visits + 1,
        seconds = t.seconds + v_sec;
end
$$;


-- ------------------------------------------------------------
--  보기 — 명단에 있는 사람만
--
--  돌려주는 칸이 늘어서 create or replace 로는 안 바뀝니다.
--  (Postgres 는 반환 모양이 달라지면 거부합니다.)
-- ------------------------------------------------------------
drop function if exists public.tab_report(integer);

create or replace function public.tab_report(p_days integer default 30)
returns table (tab text, views bigint, visits bigint, seconds bigint, first_day date)
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

  if not app.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  return query
    select t.tab,
           sum(t.views)::bigint,
           sum(t.visits)::bigint,
           sum(t.seconds)::bigint,
           min(t.the_date)
      from app.tab_views t
     where t.the_date > current_date - v_days
     group by t.tab
     order by 2 desc, 4 desc;
end
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
revoke execute on function public.tab_time(text, text, integer) from public;
revoke execute on function public.tab_report(integer)           from public;

grant execute on function public.tab_time(text, text, integer) to anon, authenticated;
grant execute on function public.tab_report(integer)           to authenticated;
