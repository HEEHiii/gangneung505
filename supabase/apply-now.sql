/* ══════════════════════════════════════════════════════════════
   아직 안 올린 것 세 개를 하나로 합친 파일입니다.

   쓰는 법
     Supabase → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run

   여러 번 돌려도 안전합니다. 이미 올라가 있는 부분은 그냥 넘어갑니다.
   그래서 "전에 올렸던가?" 가 헷갈리면 그냥 한 번 더 돌리시면 됩니다.

   들어 있는 것
     0010  탭 통계 — 어느 탭을 얼마나 쓰는지
     0011  머문 시간 + 통계는 명단에 있는 사람만 (사장님만)
     0012  사진을 지우면 파일도 진짜로 지우기

   ⚠ 0012 는 SQL 만으로 끝나지 않습니다. 아래 "다음" 을 보세요.
   ══════════════════════════════════════════════════════════════ */




/* ─────────── 0010_tabstats.sql ─────────── */

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
-- 0011 이 돌려주는 칸을 늘립니다. 이 파일을 다시 Run 해도 부딪히지
-- 않도록 먼저 지웁니다 (Postgres 는 반환 모양이 달라지면 거부합니다).
drop function if exists public.tab_report(integer);

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


/* ─────────── 0011_tabtime.sql ─────────── */

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

-- 처음 올릴 때 이미 있던 계정을 넣어줍니다.
-- 이 파일을 다시 Run 해도, 명단이 비어 있을 때만 채우므로
-- 나중에 가입한 사람이 슬쩍 관리자가 되지 않습니다.
insert into app.admins (user_id, note)
select u.id, '0011 올릴 때 이미 있던 계정'
  from auth.users u
 where not exists (select 1 from app.admins)
on conflict (user_id) do nothing;

/*  나중에 직접 넣고 빼려면:

    -- 누가 있는지 보기
    select u.id, u.email, u.created_at,
           (a.user_id is not null) as 관리자
      from auth.users u
      left join app.admins a on a.user_id = u.id
     order by u.created_at;

    -- 넣기
    insert into app.admins (user_id, note) values ('여기에-uuid', '나')
      on conflict (user_id) do nothing;

    -- 빼기
    delete from app.admins where user_id = '여기에-uuid';
*/

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


/* ─────────── 0012_photo_trash.sql ─────────── */

-- ============================================================
--  0012 — 지운 사진의 파일을 진짜로 지우기
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0008 ~ 0011 을 먼저 올린 뒤에 실행하세요.
--  특히 0011 이 필요합니다 — 휴지통을 비울 수 있는 사람을
--  가리는 app.is_admin() 이 거기 있습니다.
--
--  0012 를 올린 뒤에는 photo-upload-url 함수도 다시 배포해야
--  합니다 (app/SETUP.md 참고). 표만 바꾸고 함수를 그대로 두면
--  파일이 계속 남습니다.
-- ============================================================

-- ------------------------------------------------------------
--  왜 필요했나
--
--  지금까지는 사진을 지우면 app.photos 의 줄에 "지웠음" 표시만
--  남기고, 보관함의 파일은 그대로 뒀습니다. 목록에서 사라지고
--  아무도 볼 수 없으니 괜찮아 보이지만, 얼굴이 담긴 파일이
--  남아 있는 것은 "지웠다"고 말할 수 있는 상태가 아닙니다.
--
--  ★ 어려운 쪽은 따로 있습니다.
--
--  방을 지우거나 카카오 계정을 탈퇴하면 app.photos 의 줄이
--  cascade 로 사라집니다. 그 순간 파일 이름도 같이 사라져서,
--  나중에는 보관함의 어떤 파일이 버려진 것인지 알 방법이
--  없어집니다. 우리 코드가 끼어들 자리도 없습니다 — 탈퇴는
--  Supabase 가 처리하니까요.
--
--  그래서 줄이 사라지는 순간 파일 이름을 휴지통에 적어둡니다.
--  트리거는 cascade 로 지워질 때도 실행되므로, 방 삭제와 탈퇴가
--  공짜로 함께 처리됩니다.
-- ------------------------------------------------------------
create table if not exists app.photo_trash (
  key      text primary key,
  added_at timestamptz not null default now()
);

alter table app.photo_trash enable row level security;

create index if not exists photo_trash_age_idx on app.photo_trash (added_at);


create or replace function app.photos_to_trash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.photo_trash (key)
  values (old.r2_key), (old.thumb_key)
  on conflict (key) do nothing;
  return old;
end
$$;

drop trigger if exists photos_to_trash on app.photos;
create trigger photos_to_trash
  after delete on app.photos
  for each row execute function app.photos_to_trash();


-- ------------------------------------------------------------
--  사진 지우기 — 이제 줄을 진짜로 지웁니다
--
--  전에는 deleted_at 만 찍었습니다. 그러면 위 트리거가 안 돌고,
--  파일 이름이 휴지통에 들어가지 않습니다. 사진은 파일을 지우면
--  어차피 되돌릴 수 없으므로, 줄을 남겨둘 이유도 없습니다.
--
--  돌려주는 값에 파일 이름을 담습니다. 부르는 쪽(Edge Function)이
--  그 자리에서 보관함의 파일까지 지웁니다. 혹시 그게 실패해도
--  이름은 휴지통에 있으니 나중에 정리됩니다.
-- ------------------------------------------------------------
create or replace function public.photo_remove(p_token text, p_voter text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room  uuid := app.room_from_token(p_token);
  v_by    text;
  v_key   text;
  v_thumb text;
begin
  select voter_key, r2_key, thumb_key into v_by, v_key, v_thumb
    from app.photos where id = p_id and room_id = v_room and deleted_at is null;

  if v_by is null then
    raise exception '[denied] 없는 사진이에요';
  end if;

  if v_by <> coalesce(p_voter, '') and not app.is_owner(v_room) then
    raise exception '[denied] 직접 올린 사진만 지울 수 있어요';
  end if;

  delete from app.photos where id = p_id;      -- 트리거가 휴지통에 적습니다
  update app.rooms set last_seen_at = now() where id = v_room;

  return jsonb_build_object('ok', true, 'keys', jsonb_build_array(v_key, v_thumb));
end
$$;


-- ------------------------------------------------------------
--  휴지통 비우기 — 명단에 있는 사람만
--
--  take 가 이름을 꺼내주면, 부르는 쪽이 보관함에서 파일을 지우고
--  clear 로 그 이름을 지웁니다. 두 단계로 나눈 이유는, 파일
--  삭제가 실패했을 때 이름이 사라지면 안 되기 때문입니다.
-- ------------------------------------------------------------
create or replace function public.photo_trash_take(p_limit integer default 100)
returns table (key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  return query
    select t.key from app.photo_trash t
     order by t.added_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end
$$;


create or replace function public.photo_trash_clear(p_keys text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not app.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  delete from app.photo_trash where key = any(coalesce(p_keys, array[]::text[]));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'cleared', v_n);
end
$$;


-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
revoke execute on function public.photo_remove(text, text, uuid)  from public;
revoke execute on function public.photo_trash_take(integer)       from public;
revoke execute on function public.photo_trash_clear(text[])       from public;

grant execute on function public.photo_remove(text, text, uuid)  to anon, authenticated;
grant execute on function public.photo_trash_take(integer)       to authenticated;
grant execute on function public.photo_trash_clear(text[])       to authenticated;
