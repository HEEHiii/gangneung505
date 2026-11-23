/* ============================================================
   photo-upload-url — 사진 올릴 자리와 볼 주소를 내줍니다

   ★ 사진은 비밀번호 뒤에 있습니다

   사진함(버킷)을 공개로 두면 주소를 아는 사람은 비밀번호 없이도
   볼 수 있고, 한 번 복사해 간 주소는 비밀번호를 바꿔도 계속 살아
   있습니다. 그래서 비공개로 두고, 방에 들어온 사람에게만
   "한 시간 동안만 유효한 주소"를 발급합니다.

   사진 자체는 Supabase 저장소에서 브라우저로 바로 갑니다.
   이 함수를 거치지 않으므로 느려지지 않습니다. 이 함수는 주소만
   만들어 줍니다.

   ★ 어떤 사진의 주소를 내줄지는 DB 가 정합니다

   photo_list 가 "이 토큰의 방에 있는 사진"만 돌려주므로, 남의 방
   사진 주소를 달라고 할 방법이 없습니다.

   ★ 올릴 자리 이름도 DB 가 정합니다

   사용자가 정하게 하면 남의 방 자리 이름을 지어내 그 사진을
   덮어쓸 수 있습니다. photo_allow 가 방 토큰을 확인하고 그 방
   아래의 이름을 만들어 줍니다.

   ★ 따로 넣을 열쇠가 없습니다

   Supabase 가 이 함수에 SUPABASE_URL 과 SERVICE_ROLE_KEY 를
   자동으로 넣어줍니다. 사장님이 설정할 게 없다는 뜻입니다.
   service_role 키는 모든 잠금을 무시하므로 이 함수 밖으로
   절대 나가면 안 됩니다 — 돌려주는 건 주소뿐입니다.
   ============================================================ */

const BUCKET = "trip-photos";
const VIEW_EXPIRES = 3600;                 // 보는 주소: 1시간
const MAX_BYTES = 10 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, code: "method" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!URL_ || !SERVICE) {
    return json({ ok: false, code: "setup",
                  message: "사진 보관함이 아직 준비되지 않았어요" }, 503);
  }

  let body: { mode?: string; token?: string; bytes?: number; thumbBytes?: number };
  try { body = await req.json(); } catch { return json({ ok: false, code: "bad" }, 400); }
  const token = String(body.token || "");

  /* 방 토큰으로 DB 에 묻습니다 (손님 자격으로) */
  const rpc = async (fn: string, args: unknown) => {
    const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: ANON,
                 authorization: `Bearer ${ANON}` },
      body: JSON.stringify(args),
    });
    return { ok: r.ok, data: await r.json().catch(() => null) };
  };

  /* 저장소는 service_role 로만 만집니다 */
  const storage = async (path: string, payload: unknown) => {
    const r = await fetch(`${URL_}/storage/v1/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SERVICE,
                 authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify(payload),
    });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
  };

  /* ================= 보기 ================= */
  if (body.mode === "view") {
    const got = await rpc("photo_list", { p_token: token, p_voter: "" });

    /* ★ 왜 실패했는지 구분해서 말합니다.

       전에는 전부 "다시 입장해주세요" 였습니다. 그런데 실제로는
       0008 을 안 돌려서 함수가 없는 경우가 많고, 그때 "다시
       입장하라"는 말을 들으면 엉뚱한 데를 고치게 됩니다. */
    if (!got.ok) {
      const msg = String(got.data?.message || "");
      if (/function.*does not exist|could not find.*function|PGRST202/i.test(msg)) {
        return json({ ok: false, code: "nosql",
          message: "사진 표가 아직 없어요 (0008_photos.sql 을 돌려주세요)" }, 424);
      }
      if (/expired|입장/.test(msg)) {
        return json({ ok: false, code: "expired",
                      message: "다시 입장해주세요" }, 403);
      }
      return json({ ok: false, code: "db",
                    message: msg || "사진 목록을 불러오지 못했어요" }, 424);
    }
    if (!got.data || !Array.isArray(got.data.photos)) {
      return json({ ok: false, code: "expired", message: "다시 입장해주세요" }, 403);
    }
    const photos = got.data.photos as Array<Record<string, unknown>>;

    if (!photos.length) {
      return json({ ok: true, photos: [], comments: got.data.comments ?? [],
                    cap: got.data.cap, used: got.data.used });
    }

    /* 여러 장의 주소를 한 번에 받습니다 */
    const paths = photos.flatMap((p) => [String(p.key), String(p.thumb)]);
    const signed = await storage(`object/sign/${BUCKET}`,
                                 { expiresIn: VIEW_EXPIRES, paths });
    const map = new Map<string, string>();
    if (signed.ok && Array.isArray(signed.data)) {
      for (const row of signed.data) {
        if (row && row.path && row.signedURL) {
          map.set(String(row.path), `${URL_}/storage/v1${row.signedURL}`);
        }
      }
    }

    return json({
      ok: true,
      photos: photos.map((p) => ({
        ...p,
        url: map.get(String(p.key)) ?? "",
        thumbUrl: map.get(String(p.thumb)) ?? "",
      })),
      comments: got.data.comments ?? [],
      cap: got.data.cap, used: got.data.used,
      expiresIn: VIEW_EXPIRES,
    });
  }

  /* ================= 올리기 ================= */
  const bytes = Number(body.bytes) || 0;
  const thumbBytes = Number(body.thumbBytes) || 0;
  if (bytes <= 0 || bytes > MAX_BYTES || thumbBytes <= 0 || thumbBytes > MAX_BYTES) {
    return json({ ok: false, code: "bad", message: "사진 용량이 올바르지 않아요" }, 400);
  }

  const slot = await rpc("photo_allow", { p_token: token });
  const s = slot.data as { ok?: boolean; key?: string; code?: string; message?: string; left?: number };
  if (!slot.ok || !s || s.ok !== true || !s.key) {
    return json({ ok: false, code: s?.code || "denied",
                  message: s?.message || "사진을 올릴 수 없어요" }, 403);
  }

  const fullKey = `${s.key}.webp`;
  const thumbKey = `${s.key}-t.webp`;

  const [a, b] = await Promise.all([
    storage(`object/upload/sign/${BUCKET}/${fullKey}`, {}),
    storage(`object/upload/sign/${BUCKET}/${thumbKey}`, {}),
  ]);
  if (!a.ok || !b.ok || !a.data?.url || !b.data?.url) {
    return json({ ok: false, code: "sign",
                  message: "사진 올릴 자리를 만들지 못했어요" }, 500);
  }

  return json({
    ok: true, fullKey, thumbKey,
    fullUrl: `${URL_}/storage/v1${a.data.url}`,
    thumbUrl: `${URL_}/storage/v1${b.data.url}`,
    left: s.left,
  });
});
