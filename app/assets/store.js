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
import { hasBackend, SUPABASE_URL, SUPABASE_ANON_KEY, RESOLVE_FN,
         PHOTO_FN } from "./config.js";
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
    expenses: (box.expenses || [])
      .filter((e) => !e.deleted_at)
      .map((e) => ({ ...e, mine: e.created_by === voter })),
    itinerary: (box.itinerary || []).slice().sort((a, b) => a.day_index - b.day_index),
    comments: (box.comments || [])
      .filter((c) => !c.deleted_at && c.target_type === "place")
      .map((c) => ({
        id: c.id, target_type: c.target_type, target_id: c.target_id,
        body: c.body, nick: c.nick,
        mine: c.voter_key === voter,          /* voter_key 는 내보내지 않습니다 */
        created_at: c.created_at,
      })),
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
      expenses: [],
      itinerary: [],
      comments: [],
      photos: [],
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

/* ============================================================
   비밀번호 화면에 띄울 최소 정보

   친구가 링크를 열었을 때 "여행방"이라고만 뜨면 제대로 찾아온 건지
   알 수가 없습니다. 이름·지역·날짜만 미리 보여줍니다.
   숙소·투표·경비는 비밀번호 뒤에 그대로 있습니다.

   못 가져와도 화면은 떠야 하므로 실패하면 null 입니다.
   ============================================================ */
export async function peekRoom(slug) {
  if (!slug) return null;

  if (!hasBackend()) {
    const box = lread(slug);
    if (!box) return null;
    const r = box.room;
    return {
      title: r.title, region_name: r.region_name,
      start_date: r.start_date, end_date: r.end_date,
      people: r.people, theme: (r.settings || {}).theme || null,
    };
  }

  try {
    return await rpc("room_peek", { p_slug: slug });
  } catch (_) {
    return null;   // 있으면 좋은 것이라 실패해도 조용히
  }
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
  /* Edge Function 이 없는 환경이면 한 번 겪고 그만둡니다.
     lastResolveNote 는 "왜 안 됐는지" 를 화면에 보여주기 위한 것입니다 —
     그냥 조용히 실패하면 사장님도 저도 원인을 알 수가 없습니다. */
  let resolveOff = false;
  let lastResolveNote = "";

  /* 사진 보관함이 연결돼 있는지. null = 아직 안 물어봄 */
  let galleryReady = null;
  let galleryNote = "";
  const voter = voterKey(slug);
  const online = hasBackend();
  let token = null;

  /* ★ 로컬 모드에서도 토큰을 요구합니다.
     로컬 데이터는 그 사람 브라우저에 있으니 보안 이득은 없습니다.
     그런데 확인을 빼면 로컬에서 비밀번호 게이트를 건너뛸 수 있게 되고,
     그러면 두 모드가 다르게 행동해서 게이트 흐름을 로컬에서 테스트할
     수 없습니다. 모양을 같게 유지하는 쪽이 이득이 큽니다. */
  /* ★ 지울 수 있는가 — 서버와 같은 규칙을 씁니다.

     서버는 "내가 올린 것이거나, 내가 방장이면" 지울 수 있습니다.
     이 브라우저에만 저장하는 모드에서는 쓰는 사람이 곧 방장이므로
     (lsnapshot 이 is_owner: true 로 돌려줍니다) 전부 지울 수 있는
     게 맞습니다. 두 모드가 다르게 굴면 화면 코드가 어느 쪽에
     맞춰야 할지 알 수 없게 됩니다. */
  const canDropLocal = (by) => by === voter || true;   // 로컬에서는 늘 방장

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
        if (!canDropLocal(p.created_by)) {
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

    /* ---------- 지출 적기 ----------
       ★ 친구도 적을 수 있어야 합니다. 총무 한 명만 적게 하면 결국
         카톡으로 불러주고 총무가 받아적는 꼴이 됩니다. */
    async expenseAdd({ item, amount, payer }) {
      const clean = {
        item: String(item || "").trim().slice(0, 60),
        amount: Math.round(Number(amount) || 0),
        payer: String(payer || "").trim().slice(0, 20),
      };
      if (!clean.item) throw new RpcError("bad", "어디에 썼는지 적어주세요", "no item");
      if (!clean.payer) throw new RpcError("bad", "누가 냈는지 적어주세요", "no payer");
      if (!(clean.amount > 0)) throw new RpcError("bad", "금액을 적어주세요", "no amount");
      if (clean.amount > 100000000) {
        throw new RpcError("bad", "금액이 너무 커요 (1억까지)", "too big");
      }

      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        box.expenses = box.expenses || [];
        if (box.expenses.filter((e) => !e.deleted_at).length >= 300) {
          throw new RpcError("limit", "한 방에 적을 수 있는 지출을 넘었어요 (300개)", "cap");
        }
        const id = newId("e");
        box.expenses.push({
          ...clean, id, created_by: voter, created_at: new Date().toISOString(),
        });
        lwrite(slug, box);
        return { id };
      }

      return await rpc("expense_add", {
        p_token: need(), p_voter: voter,
        p_item: clean.item, p_amount: clean.amount, p_payer: clean.payer,
      });
    },

    /* ---------- 지출 지우기 (되돌릴 수 있게 표시만) ---------- */
    async expenseRemove(id) {
      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        const e = (box.expenses || []).find((x) => x.id === id && !x.deleted_at);
        if (!e) throw new RpcError("denied", "없는 지출이에요", "miss");
        if (!canDropLocal(e.created_by)) {
          throw new RpcError("denied", "직접 적은 것만 지울 수 있어요", "not mine");
        }
        e.deleted_at = new Date().toISOString();
        lwrite(slug, box);
        return { ok: true };
      }
      return await rpc("expense_remove", { p_token: need(), p_voter: voter, p_id: id });
    },

    /* ---------- 일정 하루치 저장 ----------

       ★ 성공/실패를 값으로 돌려줍니다 (예외를 던지지 않습니다).
         "친구가 먼저 고쳤어요" 는 오류가 아니라 정상적인 결과이고,
         화면은 그 날만 다시 불러오면 됩니다. */
    async itineraryDaySave(index, slots, expectedVersion, meta = {}) {
      need();
      const list = Array.isArray(slots) ? slots.slice(0, 40) : [];

      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        box.itinerary = box.itinerary || [];
        const at = box.itinerary.findIndex((d) => d.day_index === index);
        if (at < 0) {
          box.itinerary.push({
            day_index: index, the_date: meta.date || null,
            label: meta.label || null, slots: list, version: 1,
          });
          lwrite(slug, box);
          return { ok: true, version: 1 };
        }
        const cur = box.itinerary[at];
        if (expectedVersion != null && cur.version !== expectedVersion) {
          return {
            ok: false, code: "stale", version: cur.version,
            message: "친구가 먼저 고쳤어요. 최신 내용을 불러왔어요",
          };
        }
        cur.slots = list;
        cur.version = (cur.version || 1) + 1;
        if (meta.date) cur.the_date = meta.date;
        if (meta.label) cur.label = meta.label;
        lwrite(slug, box);
        return { ok: true, version: cur.version };
      }

      return await rpc("itinerary_day_save", {
        p_token: need(), p_voter: voter, p_index: index, p_slots: list,
        p_expected_version: expectedVersion ?? null,
        p_date: meta.date || null, p_label: meta.label || null,
      });
    },

    /* ---------- 일정 전체 새로 짜기 ---------- */
    async itinerarySave(days) {
      need();
      const payload = (days || []).slice(0, 15).map((d, i) => ({
        day_index: d.day_index ?? i,
        the_date: d.date || d.the_date || null,
        label: d.label || null,
        slots: (d.slots || []).slice(0, 40),
      }));

      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        const before = new Map((box.itinerary || []).map((d) => [d.day_index, d.version || 1]));
        box.itinerary = payload.map((d) => ({
          ...d, version: (before.get(d.day_index) || 0) + 1,
        }));
        lwrite(slug, box);
        return { ok: true, days: payload.length };
      }

      return await rpc("itinerary_build_save", {
        p_token: need(), p_voter: voter, p_days: payload,
      });
    },

    /* ---------- 댓글 달기 ----------
       ★ 투표는 익명, 댓글은 별명입니다. 목적이 다릅니다 —
         투표는 눈치 안 보고 고르라고, 댓글은 대화가 되라고. */
    async commentAdd({ targetType = "place", targetId, body, nick }) {
      const clean = {
        body: String(body || "").trim().slice(0, 500),
        nick: String(nick || "").trim().slice(0, 12),
      };
      if (!clean.body) throw new RpcError("bad", "내용을 적어주세요", "no body");
      if (!clean.nick) throw new RpcError("bad", "별명을 적어주세요", "no nick");
      if (!targetId) throw new RpcError("bad", "어디에 다는 댓글인지 알 수 없어요", "no target");

      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        box.comments = box.comments || [];
        /* 댓글은 장소에도 사진에도 달립니다. 어느 쪽인지 보고 확인합니다 */
        const pool = targetType === "photo" ? (box.photos || []) : box.places;
        if (!pool.some((x) => x.id === targetId && !x.deleted_at)) {
          throw new RpcError("denied",
            targetType === "photo" ? "없는 사진이에요" : "없는 장소예요", "miss");
        }
        if (box.comments.filter((c) => !c.deleted_at).length >= 200) {
          throw new RpcError("limit", "한 방에 달 수 있는 댓글을 넘었어요 (200개)", "cap");
        }
        const id = newId("c");
        box.comments.push({
          id, target_type: targetType, target_id: targetId,
          body: clean.body, nick: clean.nick,
          voter_key: voter, created_at: new Date().toISOString(),
        });
        lwrite(slug, box);
        return { id };
      }

      return await rpc("comment_add", {
        p_token: need(), p_voter: voter,
        p_target_type: targetType, p_target_id: targetId,
        p_body: clean.body, p_nick: clean.nick,
      });
    },

    /* ---------- 댓글 지우기 ---------- */
    async commentRemove(id) {
      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        const c = (box.comments || []).find((x) => x.id === id && !x.deleted_at);
        if (!c) throw new RpcError("denied", "없는 댓글이에요", "miss");
        if (!canDropLocal(c.voter_key)) {
          throw new RpcError("denied", "직접 쓴 댓글만 지울 수 있어요", "not mine");
        }
        c.deleted_at = new Date().toISOString();
        lwrite(slug, box);
        return { ok: true };
      }
      return await rpc("comment_remove", { p_token: need(), p_voter: voter, p_id: id });
    },

    /* ---------- 짧은 링크 풀기 ----------

       naver.me 같은 짧은 주소는 열어봐야 진짜 주소를 알 수 있는데,
       브라우저는 남의 사이트의 Location 헤더를 못 읽습니다(CORS).
       그래서 작은 서버 조각(Edge Function)이 대신 따라가 줍니다.

       ★ 배포 안 돼 있어도 괜찮습니다.
         한 번 불러보고 안 되면 이번 방문 동안 다시 시도하지 않고,
         화면은 "이름으로 검색 / 지도에서 찍기" 로 degrade 합니다.
         매번 404 를 기다리면 사용자만 답답해집니다. */
    get resolveNote() { return lastResolveNote; },

    async resolveShort(url) {
      if (!online || resolveOff) return null;
      const token = need();
      lastResolveNote = "";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${RESOLVE_FN}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ token, url }),
          /* AbortSignal.timeout 은 좀 된 사파리에 없습니다. 없으면
             TypeError 가 나면서 "연결 실패"처럼 보여 원인을 헷갈리게
             합니다. 그래서 직접 만듭니다. */
          signal: ctl.signal,
        });
        /* 404(배포 안 됨) · 401(JWT 검사에 막힘) 처럼 "설정 문제"는
           다시 시도해도 똑같습니다. 한 번 겪으면 그만둡니다.
           403(토큰·횟수) 은 상황이 바뀔 수 있으므로 계속 시도합니다. */
        if (res.status === 404) {
          resolveOff = true;
          lastResolveNote = `링크 풀기 함수 "${RESOLVE_FN}" 를 찾지 못했어요 `
                          + "(Supabase 주소창의 /functions/<이름>/details 와 맞는지 확인해주세요)";
          return null;
        }
        if (res.status === 401) {
          resolveOff = true;
          lastResolveNote = "링크 풀기 기능이 막혀 있어요 "
                          + `(Edge Functions → ${RESOLVE_FN} → Verify JWT 를 꺼주세요)`;
          return null;
        }
        if (res.status >= 500) {
          resolveOff = true;
          lastResolveNote = `링크 풀기 서버에 문제가 있어요 (${res.status})`;
          return null;
        }
        const got = await res.json().catch(() => null);
        if (got && got.ok) return { lat: got.lat, lng: got.lng, name: got.name || "" };
        lastResolveNote = (got && got.message) || `링크를 풀지 못했어요 (${res.status})`;
        return null;
      } catch (e) {
        resolveOff = true;        /* 네트워크 자체가 안 되면 더 조르지 않습니다 */
        /* 여기로 오면 HTTP 응답조차 못 받은 것입니다. 거의 항상
           관문(gateway)이 먼저 막아 브라우저가 CORS 오류로 처리한
           경우입니다 — 함수는 실행조차 안 되므로 로그도 안 남습니다. */
        lastResolveNote = (e && e.name === "AbortError")
          ? "링크 풀기가 너무 오래 걸려요"
          : "링크 풀기 서버에 닿지 못했어요 "
            + `(${RESOLVE_FN} 의 Verify JWT 를 끄거나 함수 이름을 확인해주세요)`;
        return null;
      } finally {
        clearTimeout(timer);
      }
    },

    /* ---------- 갤러리 ----------

       ★ 사진 파일은 Cloudflare R2 에 있고, 여기에는 "어디 있는지"만
         적힙니다. 올리는 순서:
           1) 브라우저에서 줄이고 위치정보를 지웁니다 (photo.js)
           2) Edge Function 에 "올릴 자리" 를 받습니다
              — 자리 이름은 서버가 정합니다. 사용자가 정하게 하면
                남의 사진을 덮어쓰는 이름을 지어낼 수 있습니다
           3) 브라우저가 R2 에 직접 올립니다 (우리 서버를 안 거칩니다)
           4) "올렸다"고 DB 에 적습니다

       ★ R2 설정이 없으면 이 브라우저에만 저장합니다.
         설정 전에도 화면을 다 눌러볼 수 있어야 합니다. */
    async photoList() {
      need();

      /* ★ 서버 모드면 Edge Function 에 물어봅니다.
         그 함수가 DB 에서 "이 방의 사진"만 꺼내 한 시간짜리 주소를
         붙여 돌려줍니다. 어떤 사진의 주소를 내줄지 DB 가 정하므로,
         남의 방 사진 주소를 달라고 할 방법이 없습니다. */
      if (online && galleryReady !== false) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/${PHOTO_FN}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              apikey: SUPABASE_ANON_KEY,
              authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ mode: "view", token: need(), voter }),
          });
          if (res.ok) {
            const got = await res.json();
            if (got && got.ok) {
              galleryReady = true;
              return { ...got, local: false };
            }
          }
          /* 왜 안 됐는지 남깁니다 — 화면이 사람 말로 보여줍니다 */
          galleryReady = false;
          if (res.status === 404) {
            galleryNote = `사진 함수 "${PHOTO_FN}" 를 찾지 못했어요 `
                        + "(Supabase 주소창의 /functions/<이름>/details 와 맞는지 확인해주세요)";
          } else if (res.status === 401) {
            galleryNote = `사진 함수가 막혀 있어요 `
                        + `(Edge Functions → ${PHOTO_FN} → Verify JWT 를 꺼주세요)`;
          } else if (res.status === 503) {
            galleryNote = "사진함이 아직 준비되지 않았어요 (0009_photo_bucket.sql 을 돌려주세요)";
          } else if (res.status === 403 || res.status === 424) {
            /* 함수가 DB 에 물어본 게 실패한 경우 — 이유를 그대로 전합니다 */
            const why = await res.json().catch(() => null);
            galleryNote = (why && why.message)
              || "사진 표가 아직 없어요 (0008_photos.sql 과 0009_photo_bucket.sql 을 돌려주세요)";
          } else {
            galleryNote = `사진 보관함에 연결하지 못했어요 (${res.status})`;
          }
        } catch (_) {
          galleryReady = false;
          galleryNote = "사진 보관함에 닿지 못했어요 "
                      + `(${PHOTO_FN} 의 Verify JWT 를 끄거나 함수 이름을 확인해주세요)`;
        }
      }

      /* ★ 서버에 방이 있는데 사진 함수만 안 되는 경우.

         전에는 여기서 로컬 저장소를 뒤지다 "이 브라우저에 저장된
         방이 없어요" 라고 했습니다. 서버 모드에서는 당연히 없는데,
         그 말을 들으면 사진이 아니라 방이 문제인 줄 알게 됩니다.
         진짜 이유를 그대로 돌려줍니다. */
      if (online) {
        return {
          photos: [], comments: [], cap: 0, used: 0,
          local: true, note: galleryNote,
        };
      }

      /* 서버 자체를 안 쓰는 모드 — 이 브라우저에만 저장합니다 */
      const box = lread(slug);
      if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
      const alive = (box.photos || []).filter((p) => !p.deleted_at);
      return {
        photos: alive.map((p) => ({
          ...p, url: p.key, thumbUrl: p.thumb, mine: p.created_by === voter,
        })),
        comments: (box.comments || [])
          .filter((c) => !c.deleted_at && c.target_type === "photo")
          .map((c) => ({
            id: c.id, target_id: c.target_id, body: c.body, nick: c.nick,
            mine: c.voter_key === voter, created_at: c.created_at,
          })),
        cap: 30, used: alive.length, local: true,
      };
    },

    /* 줄여둔 사진 두 장을 올리고 기록합니다 */
    async photoUpload({ full, thumb, width, height, caption, nick }) {
      need();

      if (online && galleryReady === false) {
        throw new RpcError("setup",
          galleryNote || "사진 보관함이 아직 연결되지 않았어요", "no gallery");
      }

      if (!online) {
        /* 이 브라우저에만 — 미리보기용으로 data URL 로 들고 있습니다 */
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        box.photos = box.photos || [];
        if (box.photos.filter((p) => !p.deleted_at).length >= 30) {
          throw new RpcError("limit",
            "이 브라우저에만 저장하는 중이라 30장까지예요 (사진 보관함을 연결하면 300장)", "cap");
        }
        const toUrl = (b) => new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(new Error("읽지 못했어요"));
          r.readAsDataURL(b);
        });
        const id = newId("ph");
        box.photos.push({
          id, key: await toUrl(full), thumb: await toUrl(thumb),
          width, height, bytes: full.size,
          caption: caption || null, nick: nick || null,
          created_by: voter, created_at: new Date().toISOString(),
        });
        lwrite(slug, box);
        return { id, local: true };
      }

      /* 1) 올릴 자리 받기 */
      const slot = await fetch(`${SUPABASE_URL}/functions/v1/${PHOTO_FN}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ token: need(), bytes: full.size, thumbBytes: thumb.size }),
      }).then((r) => r.json()).catch(() => null);

      if (!slot || !slot.ok) {
        throw new RpcError(
          (slot && slot.code) || "net",
          (slot && slot.message) || "사진 올릴 자리를 받지 못했어요",
          "slot");
      }

      /* 2) 저장소에 직접 올리기 — 이 과정은 우리 서버를 거치지 않습니다.
            주소 안에 "이 자리에만, 잠깐만" 이라는 표가 들어 있습니다. */
      const put = async (url, blob) => {
        const res = await fetch(url, {
          method: "PUT",
          headers: {
            "content-type": blob.type || "image/webp",
            /* 같은 자리에 두 번 올리는 것을 막습니다 (자리 이름이
               매번 새로 생기므로 정상 경로에서는 겹칠 일이 없습니다) */
            "x-upsert": "false",
          },
          body: blob,
        });
        if (!res.ok) {
          throw new RpcError("upload", "사진을 올리지 못했어요", `storage ${res.status}`);
        }
      };
      await put(slot.fullUrl, full);
      await put(slot.thumbUrl, thumb);

      /* 3) 올렸다고 적기 */
      return await rpc("photo_add", {
        p_token: need(), p_voter: voter,
        p_key: slot.fullKey, p_thumb: slot.thumbKey,
        p_width: width, p_height: height, p_bytes: full.size,
        p_caption: caption || null, p_nick: nick || null,
      });
    },

    async photoRemove(id) {
      need();
      if (!online) {
        const box = lread(slug);
        if (!box) throw new RpcError("expired", "이 브라우저에 저장된 방이 없어요.", "local miss");
        const ph = (box.photos || []).find((p) => p.id === id && !p.deleted_at);
        if (!ph) throw new RpcError("denied", "없는 사진이에요", "miss");
        if (!canDropLocal(ph.created_by)) {
          throw new RpcError("denied", "직접 올린 사진만 지울 수 있어요", "not mine");
        }
        ph.deleted_at = new Date().toISOString();
        lwrite(slug, box);
        return { ok: true };
      }
      return await rpc("photo_remove", { p_token: need(), p_voter: voter, p_id: id });
    },

    /* ---------- 아직 쓰는 방이라고 표시 ---------- */
    async touch() {
      if (!online) return { ok: true };
      try { return await rpc("room_touch", { p_token: need() }); }
      catch (_) { return { ok: false }; }   // 있으면 좋은 것이라 실패해도 조용히
    },
  };
}
