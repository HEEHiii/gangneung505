/* ============================================================
   room.js — 방 화면 (게이트 · 숙소 · 맛집 · 투표)

   505 판 app.js 에서 검증된 부분을 그대로 가져왔습니다.
   투표 낙관적 반영, 카드 선택 토글, 지도 연동, 삭제 롤백이 그것입니다.

   바뀐 것:
     · 비밀번호를 화면에서 비교하지 않고 서버가 확인합니다
     · 숙소·맛집이 코드가 아니라 방에서 옵니다
     · 장소 추가가 "이름이든 링크든 한 칸"으로 합쳐졌습니다

   아직 없는 것: 일정·정산 (2단계)
   ============================================================ */

import { $, $$, esc, toast, fmtRange, won } from "./dom.js";
import { distanceKm, prettyKm, parsePos } from "./geo.js";
import { KAKAO_JS_KEY, hasBackend, hasMap } from "./config.js";
import { regionByCode, THEMES } from "./regions.js";
import { loadKakao, kakaoReady, createMap } from "./kakaomap.js";
import { searchByKeyword, seedSpots, resolveLink } from "./places.js";
import { createStore, peekRoom, resumeRoom, setRoomPassword, deleteRoom } from "./store.js";
import { currentUser } from "./auth.js";
import { settle } from "./settle.js";
import { slugFromUrl, getToken, setToken, clearToken, rememberRoom } from "./session.js";

/* ───────── 상태 ───────── */
const slug = slugFromUrl();
let store = null;
let room = null;                 // 방 설정 (제목·날짜·지역·테마…)
let seeded = [];                 // 지역 관광지 (화면에만, 저장하지 않음)
const state = { places: [], counts: {}, mine: [], expenses: [], loaded: false, updatedAt: null };

const maps = { stay: null, food: null };
const inited = { stay: false, food: false, money: false };
let selectedId = { stay: null, food: null };
let foodCat = "all";

const FOOD_CATS = [
  { key: "all",  label: "전부" },
  { key: "food", label: "식당" },
  { key: "cafe", label: "카페" },
  { key: "spot", label: "관광" },
];

const lodgings = () => state.places.filter((p) => p.kind === "lodging");
const foods = () => state.places.filter((p) => p.kind !== "lodging");


/* ============================================================
   1. 비밀번호 게이트

   ★ 505 판은 화면에서 문자열을 비교했습니다 (app.js 의 PASSWORD).
     F12 로 그냥 보였습니다. 이제 서버가 확인하고, 통과하면
     토큰을 받아 30일 동안 다시 묻지 않습니다.
   ============================================================ */
function gateError(msg) {
  $("#gate-error").textContent = msg || "";
}

async function tryEnter(password) {
  const btn = $("#gate-go");
  btn.disabled = true;
  gateError("");

  try {
    const r = await store.join(password);
    if (!r.ok) {
      // 서버가 예외가 아니라 값으로 알려줍니다 (실패 기록이 롤백되지 않게)
      gateError(r.message || "들어가지 못했어요");
      $("#gate-input").select();
      return false;
    }
    setToken(slug, r.token);
    await enter();
    return true;
  } catch (e) {
    gateError(e.message || "들어가지 못했어요");
    return false;
  } finally {
    btn.disabled = false;
  }
}

/* 비밀번호를 넣기 전에 "여기가 맞나?"를 알려줍니다.

   친구가 카톡으로 링크를 받아 열면 "여행방"이라고만 떠서 제대로
   찾아온 건지 알 수가 없었습니다. 이름·날짜·지역만 미리 보여주고,
   숙소·투표·경비는 그대로 비밀번호 뒤에 둡니다.

   못 가져오면 기본 문구를 그대로 둡니다 — 화면이 멈추면 안 됩니다. */
function applyPeek(info) {
  if (!info || !info.title) return;

  document.title = `${info.title} — 여행방`;
  $("#gate-title").textContent = info.title;

  /* 날짜·지역·인원은 일부러 보여주지 않습니다.
     들어가면 바로 보이는 것들이고, 비밀번호 앞에서는 "여기가 맞나"만
     확인되면 충분합니다. 서버도 이 값들을 아예 보내지 않습니다. */

  // 방을 만들 때 고른 계절을 게이트부터 적용합니다
  if (info.theme && THEMES.some((t) => t.key === info.theme)) {
    document.documentElement.setAttribute("data-theme", info.theme);
  }
}

function initGate() {
  if (!slug) {
    gateError("방 주소가 올바르지 않아요. 친구가 보낸 링크를 다시 확인해주세요.");
    $("#gate-form").hidden = true;
    return;
  }

  $("#gate-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#gate-input").value.trim();
    if (!v) return gateError("비밀번호를 넣어주세요");
    tryEnter(v);
  });

  if (!hasBackend()) {
    $("#gate-note").innerHTML =
      "지금은 <strong>이 브라우저에만</strong> 저장되는 상태예요.";
  }
}


/* ============================================================
   2. 들어온 뒤
   ============================================================ */
async function enter() {
  $("#gate").hidden = true;
  $("#app").hidden = false;

  await refresh(true);
  if (!room) return;

  rememberRoom(slug, room.title);
  applyRoom();

  initStay();
  showTab((location.hash || "#stay").replace("#", ""));

  window.addEventListener("hashchange", () =>
    showTab((location.hash || "#stay").replace("#", "")));

  initOwner();
  startPolling();
  window.__roomReady = true;
}

function applyRoom() {
  document.title = `${room.title} — 여행방`;
  $("#room-title").textContent = room.title;
  $("#trip-range").textContent = fmtRange(room.start_date, room.end_date);

  const theme = (room.settings && room.settings.theme) || "summer";
  if (THEMES.some((t) => t.key === theme)) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  const bits = [`${room.region_name} · ${room.people}명`];
  if (!hasBackend()) bits.push("이 브라우저에만 저장됨");
  $("#room-foot").textContent = bits.join(" · ");

  /* ★ 약한 게이트라는 점을 숨기지 않습니다.
     비밀번호가 네 자리이고 링크가 카톡으로 돌아다닙니다. */
  const note = $("#vote-note");
  note.hidden = false;
  note.innerHTML = hasBackend()
    ? "링크와 비밀번호를 아는 사람은 누구나 볼 수 있어요. <strong>비밀은 적지 말아주세요.</strong>"
    : "지금은 투표와 추가한 내용이 <strong>이 브라우저에만</strong> 저장돼요. " +
      "친구들과 합쳐지게 하려면 <code>app/SETUP.md</code> 를 따라 주소를 연결해주세요.";
}


/* ============================================================
   3. 서버에서 받아오기
   ============================================================ */
async function refresh(first = false) {
  try {
    const snap = await store.snapshot(first ? null : state.updatedAt);
    if (snap.unchanged) { state.updatedAt = snap.updated_at; return; }

    room = snap.room;
    state.places = snap.places || [];
    state.counts = snap.counts || {};
    state.mine = snap.mine || [];
    state.expenses = snap.expenses || [];
    state.updatedAt = snap.updated_at;
    state.loaded = true;

    if (!first) redrawAll();
  } catch (e) {
    if (e.code === "expired") {
      // 토큰이 죽었습니다 (만료 또는 방장이 비밀번호를 바꿈)
      clearToken(slug);
      stopPolling();
      $("#app").hidden = true;
      $("#gate").hidden = false;
      gateError("다시 입장해주세요. 비밀번호가 바뀌었을 수도 있어요.");
      room = null;
      return;
    }
    if (first) {
      gateError(e.message || "방을 불러오지 못했어요");
      $("#app").hidden = true;
      $("#gate").hidden = false;
      room = null;
      return;
    }
    console.warn("새로고침 실패", e);
  }
}

function redrawAll() {
  renderLodgings();
  if (maps.stay) maps.stay.setLodgings(lodgings(), (id) => select("stay", id, false));
  if (inited.food) renderFood();
  if (inited.money) renderMoney();
}


/* ============================================================
   4. 탭
   ============================================================ */
const TABS = ["stay", "food", "plan", "money"];

function showTab(name) {
  const tab = TABS.includes(name) ? name : "stay";
  TABS.forEach((t) => { $(`#panel-${t}`).hidden = t !== tab; });
  $$("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));

  if (tab === "food" && !inited.food) initFood();
  if (tab === "money" && !inited.money) initMoney();
  // 숨어 있던 지도는 보일 때 다시 그려야 합니다
  if (maps[tab]) maps[tab].refresh();
}


/* ============================================================
   5. 지역 관광지 — 화면에만 올립니다

   ★ 카카오 정책: 검색 결과를 받아서 우리 DB 에 쌓으면 안 됩니다.
     그래서 큐레이션 파일이 있으면 그걸 쓰고, 없으면 열 때마다
     실시간으로 찾습니다. 어느 쪽이든 places 테이블에 넣지 않습니다.
   ============================================================ */
async function loadSeeded() {
  const region = room.region_code ? regionByCode(room.region_code) : null;

  if (region) {
    try {
      const res = await fetch(`assets/pois/${region.code}.json`);
      if (res.ok) {
        const doc = await res.json();
        if (Array.isArray(doc.spots) && doc.spots.length) {
          seeded = doc.spots.map((s) => ({ ...s, kind: "spot", seeded: true }));
          return;
        }
      }
    } catch (_) { /* 아래 실시간 검색으로 */ }
  }

  if (!kakaoReady()) return;
  try {
    seeded = await seedSpots(region || {
      bbox: null, center: room.center, hubQuery: null,
    });
  } catch (_) { seeded = []; }
}


/* ============================================================
   6. 숙소 탭
   ============================================================ */
async function initStay() {
  if (inited.stay) return;
  inited.stay = true;

  if (hasMap()) { try { await loadKakao(KAKAO_JS_KEY); } catch (_) {} }
  await loadSeeded();

  maps.stay = createMap("map-stay", { center: room.center, level: room.map_level });
  maps.stay.setSpots(seeded);
  maps.stay.setLodgings(lodgings(), (id) => select("stay", id, false));
  maps.stay.fit();
  maps.stay.refresh();

  $$(".map-legend button").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".map-legend button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      maps.stay.filter(b.dataset.filter);
    });
  });

  wireList("#lodging-list", "stay", "숙소");
  makeAdder({ slot: "#adder-stay", kind: "lodging", mapKey: "stay", label: "숙소" });

  renderLodgings();
}

function renderLodgings() {
  const list = lodgings();
  $("#stay-count").textContent = state.loaded
    ? `후보 ${list.length}곳 · ${room.people}인 기준`
    : "불러오는 중…";

  const ul = $("#lodging-list");
  if (!list.length) {
    ul.innerHTML = '<li class="empty">아직 숙소 후보가 없어요. 아래에서 추가해보세요.</li>';
    return;
  }

  // 대표 관광지까지 거리 — 숙소 고를 때 제일 궁금한 정보입니다
  const refs = seeded.filter((s) => s.dist).slice(0, 2);

  ul.innerHTML = list.map((d, i) => {
    const hasPos = d.lat != null && d.lng != null;
    const dists = (hasPos ? refs : []).map((s) =>
      `<span class="dist">${esc(s.name)} ${prettyKm(distanceKm(d.lat, d.lng, s.lat, s.lng))}</span>`
    ).join("");

    const meta = [d.address, d.capacity].filter(Boolean).map(esc).join(" · ");
    const badge = !hasPos ? '<span class="badge">위치 미입력</span>'
                : d.approx ? '<span class="badge">대략 위치</span>' : "";

    return `
    <li class="card" data-id="${esc(d.id)}" tabindex="0">
      <div class="card-top">
        <div class="card-no${hasPos ? "" : " off"}">${i + 1}</div>
        <div class="card-body">
          <div class="card-name">${esc(d.name)}${badge}</div>
          ${meta ? `<div class="card-meta">${meta}</div>` : ""}
          ${d.note ? `<div class="card-note">${esc(d.note)}</div>` : ""}
          ${dists ? `<div class="dists">${dists}</div>` : ""}
          <div class="card-actions">
            ${d.url ? `<a class="btn-link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">보러가기 ↗</a>` : ""}
            <button class="btn-vote" type="button" data-vote="${esc(d.id)}"${state.loaded ? "" : " disabled"}>투표</button>
            ${d.mine ? `<button class="btn-del" type="button" data-del="${esc(d.id)}" aria-label="${esc(d.name)} 삭제">삭제</button>` : ""}
            <span class="vote-count" data-count="${esc(d.id)}"><strong>0</strong>표</span>
          </div>
        </div>
      </div>
    </li>`;
  }).join("");

  keepSelection("stay", "#lodging-list", list);
  paintVotes();
}


/* ============================================================
   7. 맛집 탭
   ============================================================ */
async function initFood() {
  if (inited.food) return;
  inited.food = true;

  maps.food = createMap("map-food", { center: room.center, level: room.map_level });

  $("#food-filters").innerHTML = FOOD_CATS.map((c) =>
    `<button type="button" class="chip${c.key === foodCat ? " on" : ""}" data-cat="${c.key}">${esc(c.label)}</button>`
  ).join("");

  $("#food-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    foodCat = b.dataset.cat;
    $$("#food-filters .chip").forEach((x) => x.classList.toggle("on", x.dataset.cat === foodCat));
    renderFood();
  });

  wireList("#food-list", "food", "장소");
  makeAdder({ slot: "#adder-food", kind: "food", mapKey: "food", label: "맛집" });

  renderFood();
  maps.food.refresh();
}

function renderFood() {
  const all = foods();
  const list = foodCat === "all" ? all : all.filter((p) => p.kind === foodCat);

  $("#food-count").textContent = `${all.length}곳`;

  const ul = $("#food-list");
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${
      all.length ? "이 분류에는 아직 없어요." : "아직 추가된 곳이 없어요. 아래에서 추가해보세요."
    }</li>`;
  } else {
    ul.innerHTML = list.map((d) => {
      const badge = d.approx ? '<span class="badge">대략 위치</span>' : "";
      const kindLabel = { food: "식당", cafe: "카페", spot: "관광" }[d.kind] || "";
      return `
      <li class="card" data-id="${esc(d.id)}" tabindex="0">
        <div class="card-top">
          <div class="card-body">
            <div class="card-name">${esc(d.name)}${badge}
              <span class="badge kind">${esc(kindLabel)}</span></div>
            ${d.address ? `<div class="card-meta">${esc(d.address)}</div>` : ""}
            ${d.note ? `<div class="card-note">${esc(d.note)}</div>` : ""}
            <div class="card-actions">
              ${d.url ? `<a class="btn-link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">보러가기 ↗</a>` : ""}
              <button class="btn-vote" type="button" data-vote="${esc(d.id)}"${state.loaded ? "" : " disabled"}>투표</button>
              ${d.mine ? `<button class="btn-del" type="button" data-del="${esc(d.id)}" aria-label="${esc(d.name)} 삭제">삭제</button>` : ""}
              <span class="vote-count" data-count="${esc(d.id)}"><strong>0</strong>표</span>
            </div>
          </div>
        </div>
      </li>`;
    }).join("");
  }

  // 지도에는 분류와 무관하게 전부 — 맛집 탭에서는 이게 주인공입니다
  maps.food.setPoints(all.concat(seeded.map((s) => ({ ...s, id: "seed-" + s.name }))));
  keepSelection("food", "#food-list", list);
  paintVotes();
}


/* ============================================================
   8. 목록 공통 — 클릭·선택·투표·삭제
   ============================================================ */
function wireList(sel, mapKey, label) {
  const ul = $(sel);

  ul.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); return onDelete(del.dataset.del, label); }

    const vote = e.target.closest("[data-vote]");
    if (vote) { e.stopPropagation(); return onVote(vote.dataset.vote); }

    if (e.target.closest("a")) return;            // 링크는 그대로 열리게
    const card = e.target.closest(".card");
    if (card) select(mapKey, card.dataset.id, true);
  });

  ul.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card");
    if (card && e.target === card) { e.preventDefault(); select(mapKey, card.dataset.id, true); }
  });
}

/* 같은 카드를 또 누르면 전체 지도로 돌아갑니다 */
function select(mapKey, id, fromCard) {
  const listSel = mapKey === "stay" ? "#lodging-list" : "#food-list";

  if (selectedId[mapKey] === id) {
    selectedId[mapKey] = null;
    $$(`${listSel} .card`).forEach((c) => c.classList.remove("sel"));
    if (maps[mapKey]) { maps[mapKey].clearSelect(); maps[mapKey][mapKey === "stay" ? "fit" : "fitPoints"](); }
    return;
  }

  selectedId[mapKey] = id;
  $$(`${listSel} .card`).forEach((c) => c.classList.toggle("sel", c.dataset.id === id));
  if (maps[mapKey]) {
    if (mapKey === "stay") maps[mapKey].select(id, true);
    else maps[mapKey].goTo(id);
  }
  if (!fromCard) {
    const card = $(`${listSel} .card[data-id="${CSS.escape(id)}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function keepSelection(mapKey, listSel, list) {
  const id = selectedId[mapKey];
  if (id && !list.some((d) => d.id === id)) { selectedId[mapKey] = null; return; }
  if (id) {
    const c = $(`${listSel} .card[data-id="${CSS.escape(id)}"]`);
    if (c) c.classList.add("sel");
  }
}

function paintVotes() {
  state.places.forEach((d) => {
    const n = state.counts[d.id] || 0;
    const el = $(`[data-count="${CSS.escape(d.id)}"]`);
    if (el) el.innerHTML = `<strong>${n}</strong>표`;

    const btn = $(`[data-vote="${CSS.escape(d.id)}"]`);
    if (btn) {
      const on = state.mine.includes(d.id);
      btn.classList.toggle("voted", on);
      btn.textContent = on ? "투표함 ✓" : "투표";
      btn.setAttribute("aria-pressed", String(on));
    }
  });
}

/* 낙관적으로 먼저 반영하고, 실패하면 되돌립니다.
   누를 때마다 서버를 기다리면 투표가 답답해집니다. */
async function onVote(id) {
  const on = !state.mine.includes(id);
  const before = { counts: { ...state.counts }, mine: [...state.mine] };

  state.mine = on ? [...state.mine, id] : state.mine.filter((x) => x !== id);
  state.counts[id] = Math.max(0, (state.counts[id] || 0) + (on ? 1 : -1));
  paintVotes();

  try {
    const r = await store.voteSet(id, on);
    if (r && typeof r.count === "number") { state.counts[id] = r.count; paintVotes(); }
  } catch (e) {
    state.counts = before.counts;
    state.mine = before.mine;
    paintVotes();
    toast(e.message || "투표를 저장하지 못했어요");
  }
}

async function onDelete(id, label) {
  const item = state.places.find((x) => x.id === id);
  if (!item) return;
  if (!confirm(`"${item.name}" ${label}를 목록에서 지울까요?`)) return;

  const before = [...state.places];
  state.places = state.places.filter((x) => x.id !== id);
  redrawAll();

  try { await store.placeRemove(id); }
  catch (e) { state.places = before; redrawAll(); toast(e.message || "삭제하지 못했어요"); }
}


/* ============================================================
   9. 장소 추가 — 칸 하나로 이름이든 링크든

   ★ 505 판은 "링크를 붙여넣으면 이름과 위치를 알아서 찾습니다" 뿐이었고,
     그 구현이 네이버 페이지 HTML 을 긁는 것이라 자주 실패했습니다.
     이제 같은 칸에 이름을 쳐도 되고 링크를 붙여도 됩니다.
     사람들이 실제로 하는 행동 두 가지를 한 칸으로 받습니다.
   ============================================================ */
function makeAdder({ slot, kind, mapKey, label }) {
  const root = $(slot);
  root.innerHTML = `
    <details class="adder">
      <summary>+ ${esc(label)} 추가하기</summary>
      <div class="adder-form">
        <label class="field">
          <span class="field-label">이름이나 링크</span>
          <div class="search-row">
            <input class="a-q" placeholder="예: 초당순두부  ·  또는 지도 링크 붙여넣기">
            <button type="button" class="a-find">찾기</button>
          </div>
        </label>
        <p class="field-note a-status">이름을 치거나, 지도 앱에서 복사한 링크를 붙여넣으세요.</p>
        <ul class="pick-list a-hits" hidden></ul>

        <label class="field">
          <span class="field-label">메모 <span class="opt">(선택)</span></span>
          <input class="a-note" maxlength="60" placeholder="예: 웨이팅 길어요">
        </label>

        ${kind === "food" ? `
        <label class="field">
          <span class="field-label">분류</span>
          <select class="a-kind">
            <option value="food">식당</option>
            <option value="cafe">카페</option>
            <option value="spot">관광</option>
          </select>
        </label>` : ""}

        <div class="adder-actions">
          <button type="button" class="btn-quiet a-pick">지도에서 찍기</button>
          <p class="muted">검색이 안 되는 곳은 지도에서 직접 찍어 추가할 수 있어요.</p>
        </div>
      </div>
    </details>`;

  const q = root.querySelector(".a-q");
  const status = root.querySelector(".a-status");
  const hits = root.querySelector(".a-hits");
  const noteIn = root.querySelector(".a-note");
  const kindIn = root.querySelector(".a-kind");

  const say = (msg, bad = false) => {
    status.textContent = msg;
    status.classList.toggle("bad", bad);
  };
  const pickedKind = () => (kind === "lodging" ? "lodging" : (kindIn ? kindIn.value : "food"));

  /* ★ 분류를 누가 정하는가
     카카오가 알려주는 분류(FD6→식당, CE7→카페)는 대체로 맞지만,
     사용자가 직접 고르면 그게 이겨야 합니다. "여기는 밥집이지만
     우리한테는 카페 느낌" 같은 건 본인만 압니다.
     그래서 드롭다운을 건드린 적이 있으면 그 값을, 아니면 카카오 값을
     씁니다. (테마에서 날짜 추천을 덮어쓰는 것과 같은 규칙입니다) */
  let kindTouched = false;
  if (kindIn) kindIn.addEventListener("change", () => { kindTouched = true; });

  function finalKind(place) {
    if (kind === "lodging") return "lodging";
    if (kindTouched) return pickedKind();
    return place.kind || pickedKind();
  }

  async function add(place) {
    try {
      await store.placeAdd({
        ...place,
        kind: finalKind(place),
        note: noteIn.value.trim() || null,
      });
      await refresh(true);
      redrawAll();
      q.value = ""; noteIn.value = "";
      hits.hidden = true;
      say("추가했어요. 계속 넣어도 됩니다.");
      toast(`${label}을 추가했어요`);
      if (maps[mapKey]) maps[mapKey].cancelPick();
    } catch (e) {
      say(e.message || "추가하지 못했어요", true);
    }
  }

  function showHits(list, msg) {
    say(msg);
    if (!list.length) { hits.hidden = true; return; }
    hits.hidden = false;
    hits.innerHTML = list.map((h, i) => `
      <li><button type="button" data-i="${i}">
        <strong>${esc(h.name)}${h.nearby === false ? ' <span class="badge">지역 밖</span>' : ""}</strong>
        <span>${esc(h.address || "")}</span>
      </button></li>`).join("");
    hits.__list = list;
  }

  hits.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const hit = (hits.__list || [])[Number(b.dataset.i)];
    if (hit) add(hit);
  });

  async function find() {
    const v = q.value.trim();
    if (!v) return say("이름을 치거나 링크를 붙여넣어주세요", true);

    say("찾는 중…");
    hits.hidden = true;

    try {
      if (/^https?:\/\//i.test(v)) {
        const r = await resolveLink(v, {
          bbox: regionBbox(), kind: pickedKind(),
          resolveShort: null,          // Edge Function 은 아직 없습니다 (1·3·4단계로 degrade)
        });
        if (r.ok) return add(r.place);
        return showHits(r.candidates, r.reason);
      }

      // 좌표를 그대로 붙여넣는 사람도 있습니다
      const pos = parsePos(v);
      if (pos) return add({ name: v, lat: pos.lat, lng: pos.lng, source: "pick" });

      if (!kakaoReady()) {
        return say("지도 키가 없어서 이름 검색은 아직 안 돼요. 링크를 붙여넣거나 지도에서 찍어주세요.", true);
      }
      const list = await searchByKeyword(v, { bbox: regionBbox(), size: 8, kind: pickedKind() });
      if (!list.length) return say("못 찾았어요. 다른 이름으로 찾아보거나 지도에서 찍어주세요.", true);
      showHits(list, "맞는 곳을 골라주세요.");
    } catch (e) {
      say(e.message || "찾지 못했어요", true);
    }
  }

  root.querySelector(".a-find").addEventListener("click", find);
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); find(); }
  });

  root.querySelector(".a-pick").addEventListener("click", () => {
    const m = maps[mapKey];
    if (!m || !m.ok) return say("지도가 없어서 찍기를 쓸 수 없어요.", true);
    say("지도를 눌러 위치를 정해주세요.");
    m.startPick((p) => {
      if (!p) return say("지도에서 찍기를 쓸 수 없어요.", true);
      const name = q.value.trim();
      if (!name) {
        say("위치를 찍었어요. 이름을 적고 다시 눌러주세요.", true);
        q.focus();
        return;
      }
      add({ name, lat: p.lat, lng: p.lng, source: "pick", approx: true });
    });
  });
}

/* ============================================================
   정산

   계산은 settle.js 가 전부 합니다. 여기서는 그리기만 합니다.
   돈 계산을 화면 코드에 섞으면 테스트가 불가능해집니다 —
   505 가 정확히 그래서 한 번도 검증된 적이 없었습니다.
   ============================================================ */
function initMoney() {
  if (inited.money) return;
  inited.money = true;

  const err = (m) => { $("#ex-error").textContent = m || ""; };

  $("#ex-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    err("");
    const item = $("#ex-item").value.trim();
    const amount = Number($("#ex-amount").value);
    const payer = $("#ex-payer").value.trim();

    if (!item || !payer || !(amount > 0)) {
      err("항목·금액·결제자를 모두 적어주세요");
      return;
    }

    const btn = $("#ex-form button[type=submit]");
    btn.disabled = true;
    try {
      await store.expenseAdd({ item, amount, payer });
      $("#ex-item").value = "";
      $("#ex-amount").value = "";
      /* 결제자는 지우지 않습니다 — 보통 같은 사람이 연달아 적습니다 */
      $("#ex-item").focus();
      await refresh();
      renderMoney();
    } catch (e) {
      err(e.message || "저장하지 못했어요");
    } finally {
      btn.disabled = false;
    }
  });

  $("#expense-list").addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".ex-del");
    if (!btn) return;
    const id = btn.dataset.id;
    const row = state.expenses.find((e) => e.id === id);
    if (!row) return;
    if (!confirm(`"${row.item}" ${won(row.amount)}을 지울까요?`)) return;

    btn.disabled = true;
    try {
      await store.expenseRemove(id);
      await refresh();
      renderMoney();
    } catch (e) {
      toast(e.message || "지우지 못했어요");
      btn.disabled = false;
    }
  });

  $("#settle-share").addEventListener("click", shareSettlement);

  renderMoney();
}

function renderMoney() {
  const result = settle(state.expenses, room ? room.people : 1);

  $("#expense-summary").innerHTML = `
    <div class="stat"><div class="stat-k">총 지출</div>
      <div class="stat-v">${won(result.total)}</div></div>
    <div class="stat"><div class="stat-k">1인당 (${result.people}명)</div>
      <div class="stat-v">${won(result.share)}</div></div>`;

  $("#expense-list").innerHTML = state.expenses.length
    ? state.expenses.map((e) => `
        <li>
          <span class="ex-item">${esc(e.item)}</span>
          <span class="ex-payer">${esc(e.payer)}</span>
          <span class="ex-amount">${won(e.amount)}</span>
          ${e.mine
            ? `<button class="ex-del" type="button" data-id="${esc(e.id)}"
                       aria-label="${esc(e.item)} 지우기">×</button>`
            : `<span class="ex-del" aria-hidden="true"></span>`}
        </li>`).join("")
    : '<li class="empty">아직 적은 지출이 없어요.</li>';

  const box = $("#settlement");
  if (!result.transfers.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  $("#settle-list").innerHTML = result.transfers.map((t) => `
    <li><em>${esc(t.from)}</em> → <em>${esc(t.to)}</em> ${won(t.amount)}</li>`).join("");

  $("#settle-note").textContent = result.ghosts
    ? `${result.people}명 중 ${result.people - result.ghosts}명만 결제 기록이 있어요. `
      + `나머지 ${result.ghosts}명은 이름 대신 임시로 표시했습니다.`
    : "";
}

/* ---------- 카톡으로 보내기 ----------

   ★ 진짜 알림(알림톡)은 사업자 등록과 건당 과금이 필요합니다.
     여기서 하는 건 "공유 시트를 열어주는 것"입니다 — 누르면 카톡이
     뜨고, 단톡방을 고르면 정산 결과가 링크와 함께 전송됩니다.

   navigator.share 는 아이폰·안드로이드에서 카톡을 포함한 공유 목록을
   띄웁니다. 데스크톱에는 대부분 없으므로 클립보드로 떨어집니다. */
function settlementText() {
  const result = settle(state.expenses, room ? room.people : 1);
  const lines = result.transfers.map((t) => `· ${t.from} → ${t.to} ${won(t.amount)}`);
  return [
    `[${room ? room.title : "여행"}] 정산`,
    `총 ${won(result.total)} · 1인당 ${won(result.share)}`,
    "",
    ...lines,
  ].join("\n");
}

async function shareSettlement() {
  const text = settlementText();
  const url = location.href.split("#")[0];

  if (navigator.share) {
    try {
      await navigator.share({ title: "여행 정산", text, url });
      return;
    } catch (e) {
      /* 사용자가 취소한 것은 실패가 아닙니다 — 조용히 넘어갑니다 */
      if (e && e.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("정산 내용을 복사했어요. 카톡에 붙여넣어 주세요");
  } catch (_) {
    toast("복사하지 못했어요. 화면을 길게 눌러 복사해주세요");
  }
}


function regionBbox() {
  const r = room && room.region_code ? regionByCode(room.region_code) : null;
  return r ? r.bbox : null;
}


/* ============================================================
   10. 방 설정 (방장만)
   ============================================================ */
async function initOwner() {
  if (!room || !room.is_owner) return;

  const btn = $("#btn-owner");
  btn.hidden = false;

  const dlg = $("#owner-dlg");
  const err = (m) => { $("#owner-error").textContent = m || ""; };

  try {
    const me = await currentUser();
    if (me) $("#owner-who").textContent = me.nick;
  } catch (_) {}

  btn.addEventListener("click", () => { err(""); dlg.showModal(); });

  $("#owner-save").addEventListener("click", async () => {
    const pw = $("#owner-pw").value;
    if (pw.length < 4) return err("비밀번호는 4자 이상으로 해주세요.");
    if (!confirm("비밀번호를 바꾸면 친구들이 모두 다시 입장해야 해요. 계속할까요?")) return;
    try {
      await setRoomPassword(slug, pw);
      $("#owner-pw").value = "";
      err("");
      dlg.close();
      toast("비밀번호를 바꿨어요. 친구들에게 새 비밀번호를 알려주세요.");
    } catch (e) { err(e.message || "바꾸지 못했어요"); }
  });

  $("#owner-del").addEventListener("click", async () => {
    if (!confirm(`"${room.title}" 방을 삭제할까요?\n친구들이 넣은 내용도 모두 사라지고 되돌릴 수 없어요.`)) return;
    try {
      await deleteRoom(slug);
      clearToken(slug);
      location.href = "index.html";
    } catch (e) { err(e.message || "삭제하지 못했어요"); }
  });
}


/* ============================================================
   11. 다른 사람이 바꾼 것 따라가기

   ★ 무료 티어의 월 전송량을 지키는 장치가 셋 들어 있습니다.
     · 화면이 보일 때만 물어봅니다
     · 5분 동안 아무 변화가 없으면 20초 → 60초로 늦춥니다
     · 바뀐 게 없으면 서버가 수십 바이트만 돌려줍니다
   ============================================================ */
let timer = null;
let idleSince = Date.now();

function startPolling() {
  if (!hasBackend()) return;
  stopPolling();

  const tick = async () => {
    if (document.visibilityState !== "visible") return;
    const before = state.updatedAt;
    await refresh(false);
    if (state.updatedAt !== before) idleSince = Date.now();
  };

  const schedule = () => {
    const quiet = Date.now() - idleSince > 5 * 60 * 1000;
    timer = setTimeout(async () => { await tick(); schedule(); }, quiet ? 60000 : 20000);
  };
  schedule();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}

function stopPolling() {
  if (timer) { clearTimeout(timer); timer = null; }
}


/* ============================================================
   12. 시작
   ============================================================ */
async function boot() {
  initGate();
  if (!slug) { window.__roomReady = true; return; }   // 안내만 띄우고 끝

  store = createStore(slug);

  // 게이트에 띄울 정보를 미리 불러둡니다. 아래 경로로 바로 들어가면
  // 쓰이지 않고 버려지므로, 기다리지 않고 먼저 띄워만 둡니다.
  const peeking = peekRoom(slug);

  // 이미 들어와 본 적이 있으면 바로 (친구들은 몇 주에 걸쳐 다시 엽니다)
  const saved = getToken(slug);
  if (saved) {
    store.setToken(saved);
    await enter();
    if (room) return;
  }

  // 방장이면 비밀번호 없이 들어갑니다 — 분실 문제가 아예 없습니다
  if (hasBackend()) {
    try {
      const me = await currentUser();
      if (me) {
        const r = await resumeRoom(slug);
        if (r && r.token) {
          store.setToken(r.token);
          setToken(slug, r.token);
          await enter();
          if (room) return;
        }
      }
    } catch (_) { /* 내 방이 아니면 그냥 비밀번호를 묻습니다 */ }
  }

  // 여기까지 왔으면 비밀번호를 물어봐야 합니다
  applyPeek(await peeking);
  $("#gate-input").focus();
  window.__roomReady = true;   // 게이트가 떴다는 뜻 (테스트용)
}

boot();
