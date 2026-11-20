/* ============================================================
   resolve-link — 짧은 링크를 따라가 좌표를 찾아줍니다

   naver.me / kko.to / maps.app.goo.gl 같은 짧은 주소는 열어봐야
   진짜 주소를 알 수 있습니다. 브라우저는 보안(CORS) 때문에 남의
   사이트의 Location 헤더를 읽을 수 없어서, 이 작은 서버가 대신
   따라가 줍니다.

   ★ 절대 하지 않는 것

   페이지 내용(HTML)을 내려받지 않습니다. Location 헤더만 읽습니다.
   505 는 HTML 을 통째로 받아 정규식으로 긁었는데, 그게 저장소에서
   가장 잘 깨지는 코드였습니다. 상대가 디자인만 바꿔도 멈춥니다.
   다행히 naver.me 는 넘어가는 주소 자체에 좌표를 담고 있어서,
   헤더만 봐도 대부분 해결됩니다.

   ★ 공개 프록시가 되지 않게

   주소만 알면 누구나 부를 수 있는 함수입니다. 그대로 두면 "아무
   주소나 대신 긁어주는 서버" 가 되어 남의 내부망을 찔러보는 데
   쓰일 수 있습니다(SSRF). 그래서:
     · 방 토큰이 있어야 함 (DB 가 확인, 한 방에 시간당 20번)
     · 호스트 허용 목록에 있는 주소만
     · IP 를 직접 적은 주소, 사설·링크로컬 대역 거부
     · http/https 외의 스킴 거부
     · 3초 넘으면 포기, 리다이렉트 4번까지
     · 돌려주는 건 {lat,lng,name} 뿐 — 페이지 내용은 절대 안 보냄
   ============================================================ */

import {
  MAX_HOPS, TIMEOUT_MS, safeUrl, coordsFrom, nameFrom,
} from "./safe.js";

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

  let body: { token?: string; url?: string };
  try { body = await req.json(); } catch { return json({ ok: false, code: "bad" }, 400); }

  const token = String(body.token || "");
  const start = safeUrl(String(body.url || ""));
  if (!start) return json({ ok: false, code: "host", message: "이 주소는 풀 수 없어요" }, 400);

  /* ---- 방 토큰 확인 + 횟수 제한 (판단은 DB 가 합니다) ---- */
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_allow`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: ANON,
                 authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ p_token: token }),
    });
    const ok = await r.json();
    if (!r.ok || !ok || ok.ok !== true) {
      return json({ ok: false, code: ok?.code || "denied",
                    message: ok?.message || "허용되지 않았어요" }, 403);
    }
  } catch {
    return json({ ok: false, code: "denied" }, 403);
  }

  /* ---- Location 헤더만 따라갑니다 ---- */
  let current = start;
  const seen: string[] = [current.toString()];

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    /* 중간 주소에 이미 좌표가 있으면 거기서 끝 */
    const here = coordsFrom(current.toString());
    if (here) {
      return json({ ok: true, lat: here.lat, lng: here.lng,
                    name: nameFrom(current.toString()), source: "redirect" });
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",          // 따라가지 않고 헤더만 봅니다
        signal: ctl.signal,
        headers: { "user-agent": "trip-link-resolver" },
      });
    } catch {
      clearTimeout(timer);
      return json({ ok: false, code: "net", message: "링크를 열어볼 수 없었어요" });
    }
    clearTimeout(timer);

    const loc = res.headers.get("location");
    if (!loc) break;                 // 더 넘어갈 곳이 없습니다

    const next = safeUrl(new URL(loc, current).toString());
    if (!next) break;                // 허용 목록 밖으로 넘어가면 멈춥니다
    if (seen.includes(next.toString())) break;   // 제자리 돌기 방지
    seen.push(next.toString());
    current = next;
  }

  const hit = coordsFrom(current.toString());
  if (hit) {
    return json({ ok: true, lat: hit.lat, lng: hit.lng,
                  name: nameFrom(current.toString()), source: "redirect" });
  }
  return json({ ok: false, code: "nocoord",
                message: "링크를 따라가 봤지만 위치가 없었어요" });
});
