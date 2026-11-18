/* ============================================================
   store.js — 데이터 읽기·쓰기

   두 가지 모드로 돕니다.

     서버 모드   config.js 에 Supabase 설정이 있을 때.
                 친구들과 합쳐집니다.
     로컬 모드   설정이 비어 있을 때. 이 브라우저에만 저장됩니다.

   ★ 로컬 모드를 유지하는 이유
     505 판에도 같은 장치가 있었고 실제로 쓸모가 있었습니다.
       · 키를 받기 전에 화면 전체를 눌러보며 만들 수 있습니다
       · 테스트 대부분이 네트워크 없이 돕니다
       · 서버가 잠시 죽어도 혼자서는 쓸 수 있습니다
     바깥에서 보면 두 모드가 완전히 같은 모양을 돌려줍니다.
     그래서 화면 코드에 "서버 있나?" 분기가 한 줄도 없습니다.
   ============================================================ */

import { rpc, RpcError } from "./supa.js";
import { hasBackend } from "./config.js";
import { voterKey, newId } from "./session.js";

const LOCAL_TOKEN = "local-mode";

/* ============================================================
   로컬 모드 — 작은 가짜 서버
   ============================================================ */
const SLUG_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXZ";   // SQL 쪽과 같은 알파벳

function localSlug() {
  let s = "";
  for (let i = 0; i < 9; i++) {
    s += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return s;
}

const lkey = (slug) => `trip.local.${slug}`;

function lread(slug) {
  try {
    const raw = localStorage.getItem(lkey(slug));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function lwrite(slug, box) {
  try {
    box.room.updated_at = new Date().toISOString();
    localStorage.setItem(lkey(slug), JSON.stringify(box));
    return true;
  } catch (_) { return false; }
}

function lsnapshot(slug, voter, since) {
  const box = lread(slug);
  if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");

  if (since && box.room.updated_at <= since) {
    return { unchanged: true, updated_at: box.room.updated_at };
  }

  const alive = (box.places || []).filter((p) => !p.deleted_at);
  const counts = {};
  const mine = [];
  for (const [pid, voters] of Object.entries(box.votes || {})) {
    if (!alive.some((p) => p.id === pid)) continue;
    if (voters.length) counts[pid] = voters.length;
    if (voters.includes(voter)) mine.push(pid);
  }

  return {
    unchanged: false,
    updated_at: box.room.updated_at,
    room: { ...box.room, is_owner: true },   // 로컬에서는 내가 유일한 사용자입니다
    places: alive.map((p) => ({ ...p, mine: p.created_by === voter })),
    counts,
    mine,
  };
}


/* ============================================================
   방 만들기 — 랜딩에서 부릅니다

   form: { title, start, end, people, regionCode, regionName,
           center:[lat,lng], mapLevel, hub, password, theme }
   ============================================================ */
export async function createRoom(form) {
  const settings = { theme: form.theme || "summer" };

  if (!hasBackend()) {
    const slug = localSlug();
    const box = {
      room: {
        slug,
        title: form.title,
        start_date: form.start,
        end_date: form.end,
        people: form.people,
        region_code: form.regionCode || null,
        region_name: form.regionName,
        center: form.center,
        map_level: form.mapLevel || 8,
        hub: form.hub || null,
        settings,
        updated_at: new Date().toISOString(),
      },
      pw: String(form.password || ""),
      places: [],
      votes: {},
    };
    lwrite(slug, box);
    return { slug, token: LOCAL_TOKEN, local: true };
  }

  const r = await rpc("room_create", {
    p_title: form.title,
    p_start: form.start,
    p_end: form.end,
    p_people: form.people,
    p_region_code: form.regionCode || null,
    p_region_name: form.regionName,
    p_center_lat: form.center[0],
    p_center_lng: form.center[1],
    p_map_level: form.mapLevel || 8,
    p_hub: form.hub || null,
    p_password: form.password,
    p_settings: settings,
  });
  return { slug: r.slug, token: r.token, local: false };
}

/* 내가 만든 방 목록 (로그인한 방장) */
export async function listMyRooms() {
  if (!hasBackend()) return [];
  return await rpc("room_list_mine");
}

/* 방장이 비밀번호 없이 다시 들어가기 */
export async function resumeRoom(slug) {
  if (!hasBackend()) return { token: LOCAL_TOKEN };
  return await rpc("room_resume", { p_slug: slug });
}

/* 비밀번호 바꾸기 — 친구들 토큰이 전부 죽습니다 (접근 회수) */
export async function setRoomPassword(slug, next) {
  if (!hasBackend()) {
    const box = lread(slug);
    if (box) { box.pw = String(next); lwrite(slug, box); }
    return { ok: true };
  }
  return await rpc("room_set_password", { p_slug: slug, p_new: next });
}

export async function deleteRoom(slug) {
  if (!hasBackend()) {
    try { localStorage.removeItem(lkey(slug)); } catch (_) {}
    return { ok: true };
  }
  return await rpc("room_delete", { p_slug: slug });
}


/* ============================================================
   방 하나를 다루는 꾸러미
   ============================================================ */
export function createStore(slug) {
  const voter = voterKey(slug);
  const online = hasBackend();
  let token = null;

  /* ★ 로컬 모드에서도 토큰을 요구합니다.
     로컬 데이터는 그 사람 브라우저에 있으니 보안 이득은 없습니다.
     그런데 확인을 빼면 로컬에서 비밀번호 게이트를 건너뛸 수 있게 되고,
     그러면 두 모드가 다르게 행동해서 게이트 흐름을 로컬에서 테스트할
     수 없습니다. 모양을 같게 유지하는 쪽이 이득이 큽니다. */
  const need = () => {
    if (!token) throw new RpcError("expired", "다시 입장해주세요.", "no token");
    return token;
  };

  return {
    slug,
    voter,
    online,

    setToken(t) { token = t; },
    hasToken() { return !!token; },

    /* ---------- 입장 ----------
       ★ 서버가 실패를 예외가 아니라 값으로 돌려줍니다.
         (SQL 에서 예외를 던지면 실패 기록이 같이 롤백되어
          무차별 대입 방어가 무력화되기 때문입니다)
         그래서 반드시 ok 를 확인해야 합니다. */
    async join(password) {
      if (!online) {
        const box = lread(slug);
        if (!box) return { ok: false, code: "nomatch", message: "주소나 비밀번호를 다시 확인해주세요" };
        if (String(password) !== String(box.pw)) {
          return { ok: false, code: "nomatch", message: "주소나 비밀번호를 다시 확인해주세요" };
        }
        token = LOCAL_TOKEN;
        return { ok: true, token };
      }

      const r = await rpc("room_join", { p_slug: slug, p_password: String(password) });
      if (r && r.ok) { token = r.token; return r; }
      return r || { ok: false, code: "unknown", message: "문제가 생겼어요." };
    },

    /* ---------- 방 전체 받기 ----------
       since 를 주면 바뀐 게 없을 때 {unchanged:true} 만 옵니다.
       무료 티어의 월 전송량을 지키는 장치입니다. */
    async snapshot(since = null) {
      need();                       // 로컬에서도 게이트를 지킵니다 (아래 주석 참고)
      if (!online) return lsnapshot(slug, voter, since);
      return await rpc("room_snapshot", {
        p_token: need(), p_voter: voter, p_since: since || undefined,
      });
    },

    /* ---------- 장소 추가 ---------- */
    async placeAdd(data) {
      const clean = {
        kind: data.kind,
        name: String(data.name || "").trim().slice(0, 80),
        lat: data.lat, lng: data.lng,
        address: data.address || null,
        url: data.url || null,
        note: data.note ? String(data.note).slice(0, 300) : null,
        price: data.price != null && data.price !== "" ? Number(data.price) : null,
        capacity: data.capacity || null,
        approx: !!data.approx,
        source: data.source || "search",
        kakao_place_id: data.kakao_place_id || null,
      };

      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        if (clean.kakao_place_id &&
            box.places.some((p) => !p.deleted_at && p.kakao_place_id === clean.kakao_place_id)) {
          throw new RpcError("conflict", "이미 누가 추가한 곳이에요", "dup");
        }
        if (box.places.filter((p) => !p.deleted_at).length >= 120) {
          throw new RpcError("limit", "한 방에 넣을 수 있는 장소를 넘었어요 (120곳)", "cap");
        }
        const id = newId("p");
        box.places.push({ ...clean, id, created_by: voter, created_at: new Date().toISOString() });
        lwrite(slug, box);
        return { id };
      }

      return await rpc("place_add", { p_token: need(), p_voter: voter, p_data: clean });
    },

    /* ---------- 장소 지우기 (되돌릴 수 있게 표시만) ---------- */
    async placeRemove(id) {
      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        const p = box.places.find((x) => x.id === id && !x.deleted_at);
        if (!p) throw new RpcError("denied", "없는 장소예요", "miss");
        if (p.created_by !== voter) {
          throw new RpcError("denied", "직접 추가한 곳만 지울 수 있어요", "not mine");
        }
        p.deleted_at = new Date().toISOString();
        lwrite(slug, box);
        return { ok: true };
      }
      return await rpc("place_remove", { p_token: need(), p_voter: voter, p_id: id });
    },

    /* ---------- 투표 켜고 끄기 ---------- */
    async voteSet(placeId, on) {
      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        if (!box.places.some((p) => p.id === placeId && !p.deleted_at)) {
          throw new RpcError("denied", "없는 장소예요", "miss");
        }
        const list = box.votes[placeId] || [];
        const at = list.indexOf(voter);
        if (on && at < 0) list.push(voter);
        if (!on && at >= 0) list.splice(at, 1);
        box.votes[placeId] = list;
        lwrite(slug, box);
        return { count: list.length };
      }
      return await rpc("vote_set", {
        p_token: need(), p_voter: voter, p_place_id: placeId, p_on: !!on,
      });
    },

    /* ---------- 아직 쓰는 방이라고 표시 ---------- */
    async touch() {
      if (!online) return { ok: true };
      try { return await rpc("room_touch", { p_token: need() }); }
      catch (_) { return { ok: false }; }   // 있으면 좋은 것이라 실패해도 조용히
    },
  };
}
