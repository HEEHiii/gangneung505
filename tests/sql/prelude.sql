-- ============================================================
--  Supabase 흉내내기 — 로컬 검증용
--
--  실제 Supabase 프로젝트에는 이미 있는 것들입니다.
--  마이그레이션을 실제 DB 에 붙여넣기 전에 로컬에서 돌려보기 위한
--  최소한의 뼈대입니다. 이 파일은 Supabase 에 넣지 마세요.
-- ============================================================

-- Supabase 가 쓰는 역할들
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase 는 확장을 extensions 스키마에 설치합니다
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ============================================================
--  auth 스키마 — 실제 Supabase Auth 의 최소 대역
-- ============================================================
create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  created_at timestamptz not null default now()
);

-- 실제 Supabase 의 auth.uid() 와 같은 구현입니다:
-- PostgREST 가 요청마다 세팅하는 request.jwt.claims 에서 sub 을 꺼냅니다.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
