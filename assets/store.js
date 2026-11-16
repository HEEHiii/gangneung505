/* ============================================================
   store.js — 공유 데이터 저장 (투표 / 경비 / 추가한 숙소·맛집 / 일정)

   ★ SETUP.md 를 따라 구글 앱스 스크립트를 배포한 뒤,
     아래 ENDPOINT 에 받은 주소를 붙여넣으세요.
     (https://script.google.com/macros/s/..../exec 형태)

   비워두면 "이 기기에만 저장" 모드로 동작합니다.
   페이지의 모든 기능이 그대로 되지만, 친구들과 내용이 합쳐지지 않습니다.
   나중에 주소만 넣으면 그 뒤로는 자동으로 합쳐집니다.
   ============================================================ */

const ENDPOINT = "https://script.google.com/macros/s/AKfycbxghaqYFNl26PbYbQ31itcDfza7rERna43b2bxulB9QYSWNksZxGBsmsG5bsgHtcjMkow/exec";

/* ---------- 익명 식별자 ----------
   이름을 받지 않습니다. 중복 투표만 막기 위한 임의의 난수이고
   서버에도 이 난수만 남습니다. 누가 뭘 눌렀는지 알 수 없습니다. */
const VOTER_KEY = (() => {
  const K = "gn505.voter";
  try {
    let v = localStorage.getItem(K);
    if (!v) {
      v = newId("v");
      localStorage.setItem(K, v);
    }
    return v;
  } catch (_) {
    return newId("v");
  }
})();

function newId(prefix) {
  const rand = (crypto.randomUUID && crypto.randomUUID()) ||
               (Date.now().toString(36) + Math.random().toString(36).slice(2));
  return prefix + "-" + rand.replace(/-/g, "").slice(0, 16);
}

const Store = (() => {
  const online = !!ENDPOINT;
  const TIMEOUT = 12000;

  /* ---------- 로컬 폴백 ---------- */
  const local = {
    read(k, fb) {
      try {
        const raw = localStorage.getItem("gn505." + k);
        return raw == null ? fb : JSON.parse(raw);
      } catch (_) { return fb; }
    },
    write(k, v) {
      try { localStorage.setItem("gn505." + k, JSON.stringify(v)); } catch (_) {}
    },
  };

  /* ---------- 네트워크 ---------- */
  async function call(params, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const url = ENDPOINT + "?" + new URLSearchParams(params).toString();
      const opt = body
        // text/plain 으로 보내야 CORS preflight 없이 통과합니다.
        ? { method: "POST", body: JSON.stringify(body), signal: ctl.signal,
            headers: { "Content-Type": "text/plain;charset=utf-8" } }
        : { method: "GET", signal: ctl.signal };
      const res = await fetch(url, opt);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json && json.error) throw new Error(json.error);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    online,
    voterKey: VOTER_KEY,

    /* ---------- 전부 한 번에 읽기 ----------
       { counts, mine, expenses, items, docs } */
    async load() {
      if (!online) {
        const mine = local.read("myVotes", []);
        const counts = {};
        mine.forEach(id => { counts[id] = 1; });
        return {
          counts,
          mine,
          expenses: local.read("expenses", []),
          items:    local.read("items", []),
          docs:     local.read("docs", {}),
        };
      }
      const r = await call({ voter: VOTER_KEY });
      return {
        counts:   r.counts   || {},
        mine:     r.mine     || [],
        expenses: r.expenses || [],
        items:    r.items    || [],
        docs:     r.docs     || {},
      };
    },

    /* ---------- 투표 ---------- */
    async toggleVote(itemId, on) {
      if (!online) {
        const mine = new Set(local.read("myVotes", []));
        on ? mine.add(itemId) : mine.delete(itemId);
        local.write("myVotes", [...mine]);
        return;
      }
      await call({ type: "vote" }, { voter: VOTER_KEY, itemId, value: on ? 1 : 0 });
    },

    /* ---------- 경비 ---------- */
    async addExpense(e) {
      const row = { id: newId("e"), ...e };
      if (!online) {
        local.write("expenses", [...local.read("expenses", []), row]);
        return row;
      }
      await call({ type: "expense-add" }, row);
      return row;
    },

    async removeExpense(id) {
      if (!online) {
        local.write("expenses", local.read("expenses", []).filter(x => x.id !== id));
        return;
      }
      await call({ type: "expense-del" }, { id });
    },

    /* ---------- 친구들이 추가한 숙소 · 맛집 ----------
       kind: "lodging" | "food" */
    async addItem(kind, data) {
      const item = { ...data, id: newId(kind === "food" ? "f" : "l"), kind, added: true };
      if (!online) {
        local.write("items", [...local.read("items", []), item]);
        return item;
      }
      await call({ type: "item-add" }, { id: item.id, kind, data });
      return item;
    },

    async removeItem(id) {
      if (!online) {
        local.write("items", local.read("items", []).filter(x => x.id !== id));
        return;
      }
      await call({ type: "item-del" }, { id });
    },

    /* ---------- 일정표처럼 통째로 저장되는 것 ---------- */
    async setDoc(key, data) {
      if (!online) {
        local.write("docs", { ...local.read("docs", {}), [key]: data });
        return;
      }
      await call({ type: "doc-set" }, { key, data });
    },
  };
})();
