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
