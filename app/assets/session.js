/* ============================================================
   session.js — 브라우저에 남는 것들

   ★ 저장 키를 방별로 나눕니다.  trip.<slug>.<무엇>
     505 판은 "gn505.voter" 하나를 썼는데, 방이 여러 개가 되면
     한 브라우저에서 두 방의 투표자가 같은 사람으로 묶입니다.
     방별로 나누면 비용이 0 이고 두 방을 연결할 수 없게 됩니다.

   ★ 시크릿 모드나 저장이 막힌 브라우저에서 localStorage 접근은
     "빈 값"이 아니라 예외를 던집니다. 전부 try/catch 로 감쌉니다.
     읽기가 실패하면 기본값으로, 쓰기가 실패하면 조용히 넘어갑니다
     (그 브라우저에서는 새로고침하면 다시 비밀번호를 물어보게 됩니다).
   ============================================================ */

const read = (k, fb = null) => {
  try {
    const raw = localStorage.getItem(k);
    return raw == null ? fb : JSON.parse(raw);
  } catch (_) { return fb; }
};

const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (_) { return false; }
};

const drop = (k) => {
  try { localStorage.removeItem(k); } catch (_) {}
};

/* 방별 키 앞머리 */
export const ns = (slug) => (what) => `trip.${slug}.${what}`;

export function newId(prefix = "v") {
  try {
    if (crypto && crypto.randomUUID) return prefix + "-" + crypto.randomUUID();
  } catch (_) {}
  return prefix + "-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}


/* ============================================================
   입장 토큰 — 비밀번호를 맞힌 증거
   30일이라 친구들이 몇 주에 걸쳐 다시 열어도 다시 안 물어봅니다.
   ============================================================ */
export const getToken   = (slug) => read(ns(slug)("tok"));
export const setToken   = (slug, t) => write(ns(slug)("tok"), t);
export const clearToken = (slug) => drop(ns(slug)("tok"));


/* ============================================================
   투표자 식별자 — 이름이 아니라 난수입니다

   서버에도 이 난수만 남습니다. 누가 무엇을 눌렀는지 알 수 없습니다.
   브라우저를 바꾸거나 시크릿 모드로 들어가면 다른 사람이 되므로
   중복 투표를 완전히 막지는 못합니다 — 친구끼리 쓰는 도구라
   의도적으로 여기까지만 합니다.
   ============================================================ */
export function voterKey(slug) {
  const k = ns(slug)("voter");
  let v = read(k);
  if (!v) { v = newId("v"); write(k, v); }
  return v;
}


/* ============================================================
   별명 — 댓글에만 씁니다 (2단계)
   투표는 끝까지 익명입니다. 두 기능의 목적이 다릅니다.
   ============================================================ */
export const getNick = (slug) => read(ns(slug)("nick"), "");
export const setNick = (slug, n) => write(ns(slug)("nick"), String(n || "").slice(0, 12));


/* ============================================================
   최근에 열어본 방 — 랜딩에서 보여줍니다

   로그인한 방장은 서버에서 목록을 받아오지만(room_list_mine),
   이건 그것과 별개로 "친구로 초대받아 들어간 방"도 기억합니다.
   순전히 편의 기능이라 없어도 아무 문제가 없습니다.
   ============================================================ */
const RECENT = "trip.recent";
const RECENT_MAX = 12;

export function rememberRoom(slug, title) {
  if (!slug) return;
  const list = (read(RECENT, []) || []).filter((r) => r && r.slug !== slug);
  list.unshift({ slug, title: String(title || "").slice(0, 60), at: Date.now() });
  write(RECENT, list.slice(0, RECENT_MAX));
}

export function recentRooms() {
  return (read(RECENT, []) || []).filter((r) => r && r.slug);
}

export function forgetRoom(slug) {
  write(RECENT, (read(RECENT, []) || []).filter((r) => r && r.slug !== slug));
}


/* ============================================================
   주소에서 방 slug 읽기 — /app/room.html?r=<slug>

   hash 는 app.js 가 탭 상태로 쓰고 있어서 쓸 수 없습니다.
   GitHub Pages 에는 주소 재작성이 없어 /r/<slug> 같은 예쁜 주소는
   404.html 우회가 필요하므로 쿼리로 둡니다.
   ============================================================ */
export function slugFromUrl() {
  try {
    const v = new URL(location.href).searchParams.get("r");
    return v ? v.trim().toUpperCase() : "";
  } catch (_) { return ""; }
}
