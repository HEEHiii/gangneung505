-- ============================================================
--  0009 — 사진함 만들기 (Supabase Storage)
--
--  Supabase → SQL Editor → New query 에 붙여넣고 Run.
--  0001 ~ 0008 을 먼저 올린 뒤에 실행하세요.
--
--  이걸 돌리면 사진 보관함이 준비됩니다. Cloudflare 계정도,
--  신용카드도, 따로 넣을 열쇠도 필요 없습니다.
-- ============================================================

-- ------------------------------------------------------------
--  ★ public = false 가 이 파일에서 가장 중요한 글자입니다.
--
--    공개로 열면 사진 주소를 아는 사람은 비밀번호 없이도 볼 수
--    있고, 한 번 복사해 간 주소는 비밀번호를 바꿔도 계속 살아
--    있습니다. 비공개로 두면 방에 들어온 사람에게만 "한 시간
--    동안만 유효한 주소"가 발급됩니다.
--
--    on conflict 에서도 public = false 로 되돌립니다. 누가
--    실수로 화면에서 공개로 바꿔도, 이 파일을 다시 돌리면
--    다시 잠깁니다.
--
--  ★ 용량과 형식도 여기서 막습니다.
--    브라우저 코드만 믿으면 안 됩니다 — 우리 화면을 거치지 않고
--    바로 올리는 것을 막는 건 결국 서버 쪽 규칙입니다.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-photos', 'trip-photos', false,
  10485760,                                   -- 10MB
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ------------------------------------------------------------
--  사진함에 대한 직접 접근은 모두 막습니다.
--
--  storage.objects 는 RLS 가 켜져 있고, 우리는 정책을 하나도
--  만들지 않습니다. 그러면 anon·authenticated 로는 아무것도
--  할 수 없습니다. Edge Function 만 service_role 로 들어와
--  "한 시간짜리 주소"를 만들어 줍니다.
--
--  혹시 예전에 만들어 둔 정책이 있으면 지웁니다.
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'trip_photos%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;
