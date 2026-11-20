/* ============================================================
   resolve-link 의 "판단" 부분만 따로

   ★ 왜 파일을 나눴는가

   이 안에 공개 프록시가 되지 않게 막는 장치가 들어 있습니다.
   여기가 뚫리면 우리 서버가 남의 내부망을 대신 찔러주는 도구가
   됩니다(SSRF). 보안 장치는 "짰으니 되겠지"로 두면 안 되고,
   일부러 공격해 보는 테스트가 있어야 합니다.

   Edge Function(index.ts)은 Deno 에서 돌아 로컬에서 돌려보기가
   번거롭습니다. 그래서 네트워크를 타지 않는 판단 부분만 떼어
   평범한 JS 로 두고, tests/resolve.check.mjs 가 그대로 돌립니다.
   index.ts 는 이 파일을 가져다 씁니다 — 사본이 아니라 같은 코드라
   한쪽만 고쳐져 어긋날 일이 없습니다.
   ============================================================ */

const ALLOW_HOSTS = [
  "naver.me", "map.naver.com", "m.map.naver.com",
  "m.place.naver.com", "place.naver.com", "booking.naver.com",
  "kko.to", "place.map.kakao.com", "map.kakao.com",
  "maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.com",
];

const MAX_HOPS = 4;
const TIMEOUT_MS = 3000;

/* 한국 안인가 — 밖이면 어차피 쓸 수 없습니다 */
const inKorea = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat > 33 && lat < 39 && lng > 124 && lng < 132;

function hostAllowed(h) {
  const host = h.toLowerCase();
  /* IP 를 직접 적은 주소는 전부 거부 — 내부망을 찌르는 통로입니다 */
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(":")) return false;              // IPv6
  if (host === "localhost" || host.endsWith(".local") ||
      host.endsWith(".internal")) return false;
  return ALLOW_HOSTS.some((a) => host === a || host.endsWith("." + a));
}

function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!hostAllowed(u.hostname)) return null;
  return u;
}

/* 주소 안에서 좌표 찾기 — 순서를 외우지 않고 한국에 떨어지는 쪽을 씁니다 */
const N = "(-?\\d{1,3}\\.\\d+)";
const PATTERNS = [
  new RegExp(`[?&]lat=${N}[^]*?[?&](?:lng|lon|long)=${N}`),
  new RegExp(`[?&](?:lng|lon|long)=${N}[^]*?[?&]lat=${N}`),
  new RegExp(`[?&]c=${N},${N}`),
  new RegExp(`@${N},${N}`),
  new RegExp(`!3d${N}!4d${N}`),
  new RegExp(`[?&]y=${N}[^]*?[?&]x=${N}`),
  new RegExp(`[?&]x=${N}[^]*?[?&]y=${N}`),
  new RegExp(`${N},${N}`),
];

function coordsFrom(url) {
  for (const re of PATTERNS) {
    const m = url.match(re);
    if (!m) continue;
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (inKorea(a, b)) return { lat: a, lng: b };
    if (inKorea(b, a)) return { lat: b, lng: a };
  }
  return null;
}

function nameFrom(url) {
  const m = url.match(/[?&]title=([^&]*)/) || url.match(/[?&]name=([^&]*)/);
  if (!m) return "";
  try { return decodeURIComponent(m[1].replace(/\+/g, " ")).slice(0, 60); }
  catch { return ""; }
}

export { ALLOW_HOSTS, MAX_HOPS, TIMEOUT_MS, inKorea, hostAllowed, safeUrl, coordsFrom, nameFrom };
