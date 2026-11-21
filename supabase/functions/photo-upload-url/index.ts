/* ============================================================
   photo-upload-url — 사진 올릴 자리를 내줍니다

   브라우저가 Cloudflare R2 에 직접 올릴 수 있게, 짧은 시간만
   유효한 주소(presigned URL)를 만들어 줍니다.

   ★ 왜 우리 서버를 거치지 않는가

   사진이 우리 서버를 지나가면 그만큼 전송량과 시간이 듭니다.
   브라우저 → R2 로 바로 보내면 우리는 "자리만" 내주면 됩니다.

   ★ R2 열쇠는 여기에만 있습니다

   Supabase 의 Secrets 에 넣고 이 함수만 읽습니다. 브라우저에
   내려보내면 누구나 우리 저장소에 아무거나 올릴 수 있게 됩니다.
   그래서 열쇠 대신 "이 자리에, 10분 동안만" 올릴 수 있는 주소를
   만들어 줍니다.

   ★ 올릴 자리 이름은 DB 가 정합니다

   사용자가 정하게 하면 남의 방 자리 이름을 지어내 그 사진을
   덮어쓸 수 있습니다. photo_allow 가 방 토큰을 확인하고 그 방
   아래의 이름을 만들어 줍니다.

   필요한 Secrets:
     R2_ACCOUNT_ID       Cloudflare 계정 ID
     R2_BUCKET           버킷 이름
     R2_ACCESS_KEY_ID    S3 호환 토큰의 Access Key ID
     R2_SECRET_KEY       S3 호환 토큰의 Secret
   ============================================================ */

const MAX_BYTES = 10 * 1024 * 1024;
const EXPIRES = 600;                      // 10분

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "content-type": "application/json" },
  });

/* ---------- AWS SigV4 (R2 는 S3 호환이라 같은 방식입니다) ---------- */
const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/* 쿼리로 서명한 PUT 주소를 만듭니다 */
async function presignPut(opts: {
  accountId: string; bucket: string; key: string;
  accessKey: string; secretKey: string; expires: number;
}) {
  const host = `${opts.accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20260101T000000Z
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;

  const canonicalUri = `/${opts.bucket}/${opts.key.split("/").map(encodeURIComponent).join("/")}`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${opts.accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(opts.expires),
    "X-Amz-SignedHeaders": "host",
  });
  params.sort();

  const canonical = [
    "PUT", canonicalUri, params.toString(),
    `host:${host}\n`, "host", "UNSIGNED-PAYLOAD",
  ].join("\n");

  const toSign = [
    "AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical),
  ].join("\n");

  let k: ArrayBuffer | Uint8Array = enc.encode(`AWS4${opts.secretKey}`);
  for (const part of [dateStamp, "auto", "s3", "aws4_request"]) k = await hmac(k, part);
  const signature = hex(await hmac(k, toSign));

  return `https://${host}${canonicalUri}?${params.toString()}&X-Amz-Signature=${signature}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, code: "method" }, 405);

  const ACCOUNT = Deno.env.get("R2_ACCOUNT_ID") ?? "";
  const BUCKET = Deno.env.get("R2_BUCKET") ?? "";
  const AK = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
  const SK = Deno.env.get("R2_SECRET_KEY") ?? "";
  if (!ACCOUNT || !BUCKET || !AK || !SK) {
    return json({ ok: false, code: "setup",
                  message: "사진 보관함이 아직 연결되지 않았어요" }, 503);
  }

  let body: { token?: string; bytes?: number; thumbBytes?: number };
  try { body = await req.json(); } catch { return json({ ok: false, code: "bad" }, 400); }

  const bytes = Number(body.bytes) || 0;
  const thumbBytes = Number(body.thumbBytes) || 0;
  if (bytes <= 0 || bytes > MAX_BYTES || thumbBytes <= 0 || thumbBytes > MAX_BYTES) {
    return json({ ok: false, code: "bad", message: "사진 용량이 올바르지 않아요" }, 400);
  }

  /* ---- 방 토큰 확인 + 상한 (판단은 DB 가 합니다) ---- */
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  let slot: { ok?: boolean; key?: string; code?: string; message?: string; left?: number };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/photo_allow`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: ANON,
                 authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ p_token: String(body.token || "") }),
    });
    slot = await r.json();
    if (!r.ok || !slot || slot.ok !== true || !slot.key) {
      return json({ ok: false, code: slot?.code || "denied",
                    message: slot?.message || "사진을 올릴 수 없어요" }, 403);
    }
  } catch {
    return json({ ok: false, code: "denied" }, 403);
  }

  const fullKey = `${slot.key}.webp`;
  const thumbKey = `${slot.key}-t.webp`;

  try {
    const [fullUrl, thumbUrl] = await Promise.all([
      presignPut({ accountId: ACCOUNT, bucket: BUCKET, key: fullKey,
                   accessKey: AK, secretKey: SK, expires: EXPIRES }),
      presignPut({ accountId: ACCOUNT, bucket: BUCKET, key: thumbKey,
                   accessKey: AK, secretKey: SK, expires: EXPIRES }),
    ]);
    return json({ ok: true, fullKey, thumbKey, fullUrl, thumbUrl, left: slot.left });
  } catch {
    return json({ ok: false, code: "sign", message: "올릴 자리를 만들지 못했어요" }, 500);
  }
});
