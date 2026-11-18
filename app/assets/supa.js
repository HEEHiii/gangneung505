/* ============================================================
   supa.js — Supabase 와 이야기하는 유일한 통로

   ★ 테이블을 직접 읽지 않습니다.
     테이블은 app 스키마에 숨겨져 있어서 브라우저에서 지목조차 할 수
     없고, 모든 접근이 아래 RPC 목록을 통과합니다.
     그래서 "어떤 호출이 가능한가"가 이 파일 하나에 다 적혀 있습니다.
   ============================================================ */

import { SUPABASE_URL, SUPABASE_ANON_KEY, hasBackend } from "./config.js";

/* supabase-js 는 Auth(카카오 로그인, PKCE, 토큰 갱신) 때문에 씁니다.
   그건 직접 만들 만한 것이 아닙니다. 버전을 정확히 못박아 둡니다. */
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";


/* ============================================================
   RPC 계약

   ★ 이 표가 있는 이유
     SQL 쪽 인자 이름과 여기서 보내는 이름이 어긋나면,
     Supabase 는 "함수를 못 찾겠다"는 식의 애매한 오류를 냅니다.
     한눈에 안 보이고 런타임에만 터집니다.
     표로 적어두면 tests/rpc-contract.check.mjs 가 실제 DB 의
     함수 서명과 대조해서 어긋남을 미리 잡습니다.

   순서도 SQL 선언 순서와 같게 유지하세요.
   ============================================================ */
export const RPC = {
  /* ---- 누구나 ---- */
  health:        [],
  room_join:     ["p_slug", "p_password"],
  room_snapshot: ["p_token", "p_voter", "p_since"],
  place_add:     ["p_token", "p_voter", "p_data"],
  place_remove:  ["p_token", "p_voter", "p_id"],
  vote_set:      ["p_token", "p_voter", "p_place_id", "p_on"],
  room_touch:    ["p_token"],

  /* ---- 로그인한 방장만 ---- */
  room_create: [
    "p_title", "p_start", "p_end", "p_people",
    "p_region_code", "p_region_name",
    "p_center_lat", "p_center_lng", "p_map_level",
    "p_hub", "p_password", "p_settings",
  ],
  room_list_mine:    [],
  room_resume:       ["p_slug"],
  room_set_password: ["p_slug", "p_new"],
  room_delete:       ["p_slug"],
};

/* 로그인이 필요한 호출 — 미리 걸러서 친절한 메시지를 냅니다 */
export const NEEDS_LOGIN = new Set([
  "room_create", "room_list_mine", "room_resume",
  "room_set_password", "room_delete",
]);


/* ============================================================
   클라이언트 — 필요할 때 한 번만 불러옵니다

   설정이 비어 있으면 CDN 을 아예 건드리지 않습니다.
   덕분에 "이 브라우저에만 저장" 모드가 완전히 오프라인으로 돌고,
   테스트도 네트워크 없이 돕니다.
   ============================================================ */
let clientPromise = null;

export function getClient() {
  if (!hasBackend()) return Promise.resolve(null);
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    try {
      const { createClient } = await import(/* @vite-ignore */ SUPABASE_JS);
      return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // 카톡 인앱 브라우저가 OAuth 중에 탭을 바꾸므로
          // localStorage 에 남아 있어야 돌아왔을 때 이어집니다
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      });
    } catch (e) {
      console.warn("[supabase] 라이브러리를 불러오지 못했습니다.", e);
      return null;
    }
  })();

  return clientPromise;
}

/* 테스트에서 가짜 클라이언트를 꽂을 수 있게 */
export function __setClientForTest(c) {
  clientPromise = Promise.resolve(c);
}


/* ============================================================
   오류 다듬기

   SQL 쪽은 '[코드] 사람이 읽는 메시지' 꼴로 던집니다.
   그 코드를 떼어내 분기에 쓰고, 메시지는 그대로 보여줍니다.
   ============================================================ */
export class RpcError extends Error {
  constructor(code, message, raw) {
    super(message);
    this.name = "RpcError";
    this.code = code;       // auth | nomatch | locked | expired | denied | limit | conflict | net | unknown
    this.raw = raw;
  }
}

const FRIENDLY = {
  net: "연결이 잘 안 돼요. 잠시 뒤에 다시 시도해주세요.",
  unknown: "문제가 생겼어요. 잠시 뒤에 다시 시도해주세요.",
};

export function toRpcError(err) {
  const raw = String((err && err.message) || err || "");

  const m = raw.match(/^\s*\[(\w+)\]\s*(.*)$/);
  if (m) return new RpcError(m[1], m[2] || FRIENDLY.unknown, raw);

  // 권한 자체가 없을 때 (GRANT 가 안 된 함수를 부른 경우)
  if (/permission denied/i.test(raw)) {
    return new RpcError("denied", "이 동작을 할 권한이 없어요.", raw);
  }
  // 함수 이름·인자가 어긋날 때 — 개발 중에만 나야 하는 오류입니다
  if (/Could not find the function|PGRST202/i.test(raw)) {
    return new RpcError("contract",
      "서버와 화면의 버전이 맞지 않아요. 새로고침해도 안 되면 알려주세요.", raw);
  }
  if (/Failed to fetch|NetworkError|aborted|timeout/i.test(raw)) {
    return new RpcError("net", FRIENDLY.net, raw);
  }
  return new RpcError("unknown", FRIENDLY.unknown, raw);
}


/* ============================================================
   rpc — 모든 호출이 지나가는 곳

   · 12초 뒤 포기 (앱스 스크립트 판과 같은 기준)
   · 인자 이름을 RPC 표에서 가져오므로 오타가 날 자리가 없습니다
   · 로그인이 필요한 호출은 미리 걸러냅니다
   ============================================================ */
const TIMEOUT = 12000;

export async function rpc(fn, args = {}) {
  const spec = RPC[fn];
  if (!spec) throw new RpcError("contract", `알 수 없는 호출: ${fn}`, fn);

  // 표에 없는 인자를 보내면 조용히 무시되는 대신 바로 알려줍니다
  for (const k of Object.keys(args)) {
    if (!spec.includes(k)) {
      throw new RpcError("contract", `${fn} 에 없는 인자: ${k}`, fn);
    }
  }

  const client = await getClient();
  if (!client) throw new RpcError("net", "서버 설정이 없어요.", "no client");

  if (NEEDS_LOGIN.has(fn)) {
    const { data } = await client.auth.getSession();
    if (!data || !data.session) {
      throw new RpcError("auth", "카카오 로그인이 필요해요.", "no session");
    }
  }

  // undefined 는 빼고 보냅니다 (SQL 기본값을 쓰게)
  const body = {};
  for (const k of spec) if (args[k] !== undefined) body[k] = args[k];

  let timer;
  try {
    const call = client.rpc(fn, body);
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error("timeout")), TIMEOUT);
    });
    const { data, error } = await Promise.race([call, timeout]);
    if (error) throw toRpcError(error);
    return data;
  } catch (e) {
    throw e instanceof RpcError ? e : toRpcError(e);
  } finally {
    clearTimeout(timer);
  }
}

/* 서버가 살아 있는지 (무료 티어 일시정지 깨우기 겸) */
export async function ping() {
  try {
    await rpc("health");
    return true;
  } catch (_) {
    return false;
  }
}
