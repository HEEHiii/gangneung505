/* ============================================================
   auth.js — 카카오 로그인 (방장만)

   ★ 친구들은 로그인하지 않습니다.
     링크 + 방 비밀번호로 들어옵니다. 초대받은 사람에게 로그인을
     요구하면 4명 중 1명이 동의 화면에서 멈추고 그 방은 죽습니다.
     로그인은 방을 "만드는" 사람에게만 필요합니다.

   ★ 로그인 벽은 폼을 다 채운 뒤에 세웁니다.
     제출 버튼 앞에서 사용자는 이미 날짜·지역·인원을 넣었으므로
     그 자리의 로그인은 "형식 절차"로 읽힙니다.
     페이지를 열자마자 같은 벽을 세우면 "통행료"로 읽힙니다.

   ★ 이메일은 받지 않습니다.
     카카오에서 이메일까지 받으려면 비즈앱 전환이라는 별도 절차가
     필요한데, 우리는 "누가 만든 방인지"만 알면 되므로 카카오가 주는
     고유 ID 만으로 충분합니다. 절차 하나를 건너뜁니다.
   ============================================================ */

import { getClient } from "./supa.js";
import { hasBackend } from "./config.js";
import { newId } from "./session.js";

/* ============================================================
   지금 로그인한 사람
   ============================================================ */
export async function currentUser() {
  if (!hasBackend()) return null;
  const c = await getClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    const u = data && data.session && data.session.user;
    if (!u) return null;
    const meta = u.user_metadata || {};
    return {
      id: u.id,
      // 카카오는 닉네임을 여러 이름으로 줍니다 — 있는 것을 씁니다
      nick: meta.name || meta.nickname || meta.full_name || meta.preferred_username || "나",
      avatar: meta.avatar_url || meta.picture || "",
    };
  } catch (_) {
    return null;
  }
}

export async function signOut() {
  const c = await getClient();
  if (c) { try { await c.auth.signOut(); } catch (_) {} }
}

/* 로그인 상태가 바뀌면 알려줍니다 (버튼 모양 갱신용) */
export async function onAuthChange(fn) {
  const c = await getClient();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange(() => { fn(); });
  return () => { try { data.subscription.unsubscribe(); } catch (_) {} };
}


/* ============================================================
   폼 상태를 로그인 왕복 동안 지키기

   signInWithOAuth 는 페이지를 통째로 떠납니다:
     우리 페이지 → kauth.kakao.com → Supabase 콜백 → 우리 페이지
   메모리에 있던 입력값은 그 사이에 사라집니다.

   ★ sessionStorage 가 아니라 localStorage 입니다.
     sessionStorage 는 탭 단위여서, 카톡 인앱 브라우저처럼 중간에
     카카오 앱으로 넘겼다가 "다른 탭"으로 돌아오는 경우 죽습니다.
     결정적인 근거가 하나 더 있습니다 — supabase-js 는 PKCE 를 쓰고
     그 code verifier 가 이미 localStorage 에 있습니다. 즉 localStorage
     가 유지되어야만 로그인 왕복이 애초에 성립하므로, 폼을 같은 곳에
     두는 것은 새로운 실패 지점을 만들지 않습니다.

   ★ 비밀번호는 저장된 꾸러미에만 들어가고 주소에는 절대 넣지 않습니다.
     주소에 실으면 브라우저 방문 기록, Referer, 카카오와 Supabase 의
     리다이렉트 로그에 방 비밀번호가 남습니다.
   ============================================================ */
const PENDING = "trip.pending.";
const TTL = 10 * 60 * 1000;   // 10분

export function stashPending(form) {
  const nonce = newId("p");
  try {
    localStorage.setItem(PENDING + nonce,
      JSON.stringify({ ...form, exp: Date.now() + TTL }));
  } catch (_) {
    return null;   // 저장이 막힌 브라우저 → 호출하는 쪽이 degrade 합니다
  }
  return nonce;
}

/* 한 번 쓰면 바로 지웁니다.
   남겨두면 나중에 그냥 방문했을 때 방이 또 만들어질 수 있습니다. */
export function takePending(nonce) {
  if (!nonce) return null;
  const k = PENDING + nonce;
  let v = null;
  try {
    const raw = localStorage.getItem(k);
    localStorage.removeItem(k);
    if (!raw) return null;
    v = JSON.parse(raw);
  } catch (_) { return null; }

  if (!v || !v.exp || v.exp < Date.now()) return null;
  delete v.exp;
  return v;
}

/* 페이지를 열 때마다 만료된 것을 치웁니다 */
export function sweepPending() {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PENDING)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        if (!v || !v.exp || v.exp < now) localStorage.removeItem(k);
      } catch (_) { localStorage.removeItem(k); }
    }
  } catch (_) {}
}


/* ============================================================
   카카오로 보내기

   돌려주는 값:
     "already"  이미 로그인돼 있음 → 리다이렉트 없이 바로 진행
     "sent"     카카오로 떠났음 (이 뒤 코드는 실행되지 않습니다)
     "off"      서버 설정이 없음 → 로컬 모드로 진행
     "error"    실패 — 사용자에게 알려야 합니다
   ============================================================ */
export async function signInWithKakao(form) {
  if (!hasBackend()) return { state: "off" };

  const c = await getClient();
  if (!c) return { state: "error", message: "서버에 연결할 수 없어요." };

  // 재방문이면 리다이렉트 없이 즉시 (첫 방 이후로는 이게 일반 경로입니다)
  try {
    const { data } = await c.auth.getSession();
    if (data && data.session) return { state: "already" };
  } catch (_) {}

  const nonce = stashPending(form || {});

  const back = new URL(location.origin + location.pathname);
  if (nonce) back.searchParams.set("pending", nonce);
  // 비밀 아닌 값만 — 꾸러미를 못 찾았을 때 폼을 다시 채워주기 위한 것입니다
  if (form) {
    if (form.start && form.end) back.searchParams.set("d", `${form.start}~${form.end}`);
    if (form.people) back.searchParams.set("p", String(form.people));
    if (form.regionCode) back.searchParams.set("rg", form.regionCode);
    if (form.theme) back.searchParams.set("th", form.theme);
  }

  try {
    const { error } = await c.auth.signInWithOAuth({
      provider: "kakao",
      options: { redirectTo: back.toString() },
    });
    if (error) throw error;
    return { state: "sent" };
  } catch (e) {
    console.warn("[로그인] 카카오로 보내지 못했습니다", e);
    return {
      state: "error",
      message: "카카오 로그인을 시작할 수 없어요. 잠시 뒤에 다시 시도해주세요.",
    };
  }
}


/* ============================================================
   돌아왔을 때 — 주소에서 꾸러미를 꺼냅니다

   { form, partial } 을 돌려줍니다.
     form    온전히 복원됨 → 바로 방을 만들 수 있습니다
     partial 꾸러미는 없지만 주소에 비밀 아닌 값이 있음
             → 폼을 다시 채워주고 비밀번호만 받습니다
             (로그인은 이미 끝났으니 두 번째 제출은 즉시 완료됩니다)
   ============================================================ */
export function readReturn() {
  let url;
  try { url = new URL(location.href); } catch (_) { return { form: null, partial: null }; }

  const q = url.searchParams;
  const nonce = q.get("pending");
  const form = takePending(nonce);

  let partial = null;
  const d = q.get("d");
  if (d && /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [start, end] = d.split("~");
    partial = {
      start, end,
      people: Number(q.get("p")) || null,
      regionCode: q.get("rg") || "",
      theme: q.get("th") || "",
    };
  }

  // 주소를 깔끔하게 — 새로고침해도 다시 만들어지지 않게
  if (nonce || d) {
    try {
      ["pending", "d", "p", "rg", "th"].forEach((k) => q.delete(k));
      history.replaceState({}, "", url.pathname + (q.toString() ? "?" + q : ""));
    } catch (_) {}
  }

  return { form, partial };
}
