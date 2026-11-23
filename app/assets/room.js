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
import { searchByKeyword, searchByAddress, looksLikeAddress,
         seedSpots, resolveLink, findHub } from "./places.js";
import { createStore, peekRoom, resumeRoom, setRoomPassword, deleteRoom } from "./store.js";
import { currentUser } from "./auth.js";
import { settle } from "./settle.js";
import { buildItinerary, enumerateDays } from "./route.js";
import { prepare, prettyBytes, canResize } from "./photo.js";
import { slugFromUrl, getToken, setToken, clearToken, rememberRoom,
         getNick, setNick } from "./session.js";

/* ───────── 상태 ───────── */
const slug = slugFromUrl();
let store = null;
let room = null;                 // 방 설정 (제목·날짜·지역·테마…)
let seeded = [];                 // 지역 관광지 (화면에만, 저장하지 않음)
const state = { places: [], counts: {}, mine: [], expenses: [], itinerary: [],
                comments: [], loaded: false, updatedAt: null };

const maps = { stay: null, food: null };
const inited = { stay: false, food: false, money: false, plan: false, photo: false };
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

  /* 테스트가 "폴링이 한 번 돈" 상황을 기다리지 않고 만들 수 있게.
     20초를 기다리는 테스트는 느리고, 느린 테스트는 안 돌리게 됩니다. */
  window.__refreshNow = async () => { await refresh(); redrawAll(); };

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
    state.itinerary = snap.itinerary || [];
    state.comments = snap.comments || [];
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

/* ============================================================
   누가 지울 수 있나

   ★ 브라우저마다 다른 사람입니다.

     친구들은 로그인을 하지 않으므로, 누가 누구인지 구분하는 건
     브라우저에 저장된 표식뿐입니다. 그래서 폰에서 올린 사진은
     같은 사람이라도 컴퓨터에서는 "남의 것" 입니다.
     익명을 지키려고 치르는 대가이고, 바꾸려면 친구들도 로그인을
     해야 합니다 — 그러면 아무도 안 들어옵니다.

   ★ 다만 방장은 예외입니다.

     서버는 처음부터 방장에게 전부 지울 수 있게 열어뒀는데
     (place_remove · expense_remove · comment_remove · photo_remove
      네 곳 모두), 화면이 "내 것" 일 때만 버튼을 보여줘서 그 권한을
     쓸 수가 없었습니다. 열어둔 문 앞에 손잡이가 없던 셈입니다.
   ============================================================ */
const canDelete = (mine) => !!mine || !!(room && room.is_owner);

/* 남의 것을 지울 때는 한 번 더 분명히 묻습니다 */
const askDelete = (mine, what) =>
  confirm(mine
    ? `${what}을(를) 지울까요?`
    /* 받침에 따라 "이에요/예요" 가 갈리므로 아예 붙이지 않습니다 */
    : `친구가 올린 거예요.\n${what}을(를) 그래도 지울까요?`);


function redrawAll() {
  renderLodgings();
  if (maps.stay) maps.stay.setLodgings(lodgings(), (id) => select("stay", id, false));
  if (inited.food) renderFood();
  if (inited.money) renderMoney();
  if (inited.plan) renderPlan();
}


/* ============================================================
   4. 탭
   ============================================================ */
const TABS = ["stay", "food", "plan", "money", "photo"];

function showTab(name) {
  const tab = TABS.includes(name) ? name : "stay";
  TABS.forEach((t) => { $(`#panel-${t}`).hidden = t !== tab; });
  $$("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));

  if (tab === "food" && !inited.food) initFood();
  if (tab === "money" && !inited.money) initMoney();
  if (tab === "plan" && !inited.plan) initPlan();
  if (tab === "photo" && !inited.photo) initPhoto();
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
            ${canDelete(d.mine) ? `<button class="btn-del" type="button" data-del="${esc(d.id)}" aria-label="${esc(d.name)} 삭제">삭제</button>` : ""}
            <span class="vote-count" data-count="${esc(d.id)}"><strong>0</strong>표</span>
          </div>
          ${commentsHtml(d.id)}
        </div>
      </div>
    </li>`;
  }).join("");

  wireComments("#lodging-list");
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
              ${canDelete(d.mine) ? `<button class="btn-del" type="button" data-del="${esc(d.id)}" aria-label="${esc(d.name)} 삭제">삭제</button>` : ""}
              <span class="vote-count" data-count="${esc(d.id)}"><strong>0</strong>표</span>
            </div>
            ${commentsHtml(d.id)}
          </div>
        </div>
      </li>`;
    }).join("");
    wireComments("#food-list");
  }

  // 지도에는 분류와 무관하게 전부 — 맛집 탭에서는 이게 주인공입니다
  /* ★ 위의 필터는 목록만이 아니라 지도에도 겁니다.

     전에는 목록만 걸러서, "식당"을 눌러도 지도에는 카페·관광지가
     그대로 떠 있었습니다. 보고 싶은 것만 보려고 누른 건데요.
     관광지는 "전부" 나 "관광" 일 때만 깔아둡니다. */
  const showSeeded = foodCat === "all" || foodCat === "spot";
  const onMap = list.concat(
    showSeeded ? seeded.map((s) => ({ ...s, id: "seed-" + s.name, seeded: true })) : []
  );

  /* 카드를 눌러 확대해 둔 상태면 화면을 건드리지 않습니다.
     안 그러면 새로고침마다 전체 보기로 튕겨 나갑니다. */
  maps.food.setPoints(onMap, { keepView: !!selectedId.food });
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
  if (!askDelete(item.mine, `"${item.name}" ${label}`)) return;

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
            <input class="a-q" placeholder="예: 초당순두부  ·  강릉시 가둔지길 24  ·  지도 링크">
            <button type="button" class="a-find">찾기</button>
          </div>
        </label>
        <p class="field-note a-status">이름 · 주소 · 지도 링크 아무거나 됩니다.</p>
        <ul class="pick-list a-hits" hidden></ul>

        <label class="field">
          <span class="field-label">메모 <span class="opt">(선택)</span></span>
          <input class="a-note" maxlength="60" placeholder="예: 웨이팅 길어요">
        </label>

        <label class="field">
          <span class="field-label">${kind === "lodging" ? "예약" : "보러갈"} 링크 <span class="opt">(선택)</span></span>
          <input class="a-url" type="url" inputmode="url"
                 placeholder="${kind === "lodging"
                   ? "네이버·에어비앤비 예약 페이지 주소"
                   : "보여주고 싶은 페이지 주소"}">
        </label>
        <p class="field-note">
          ${kind === "lodging"
            ? "넣어두면 카드의 <strong>보러가기</strong>가 바로 예약 페이지로 갑니다."
            : "넣어두면 카드의 <strong>보러가기</strong>가 이 주소로 갑니다."}
        </p>

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
  const urlIn = root.querySelector(".a-url");
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
      /* ★ 사용자가 적은 링크가 이깁니다.

         이름으로 검색해서 추가하면 카카오가 준 place_url 이 붙습니다.
         위치는 정확하지만 "보러가기"가 카카오맵으로 가서, 숙소를
         바로 예약할 수가 없습니다. 그래서 예약 링크를 따로 받아
         그게 있으면 그걸 씁니다. 위치는 카카오로 정확히, 링크는
         사용자가 원하는 곳으로. */
      const myUrl = urlIn.value.trim();
      if (myUrl && !/^https?:\/\//i.test(myUrl)) {
        return say("링크는 https:// 로 시작해야 해요", true);
      }

      await store.placeAdd({
        ...place,
        url: myUrl || place.url || null,
        kind: finalKind(place),
        note: noteIn.value.trim() || null,
      });
      await refresh(true);
      redrawAll();
      q.value = ""; noteIn.value = ""; urlIn.value = "";
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
          /* 짧은 링크(naver.me 등)는 서버 조각이 대신 따라가 줍니다.
             배포 안 돼 있으면 조용히 3·4단계로 내려갑니다. */
          resolveShort: (u) => store.resolveShort(u),
        });
        if (r.ok) return add(r.place);

        /* ★ 예약 사이트(에어비앤비 등)는 좌표를 안 알려줍니다.
           그런데 그 사이트들이 보여주는 것도 "대략 위치" 뿐이라,
           사용자가 그 자리를 직접 찍으면 정확도가 똑같습니다.
           그러니 막다른 길로 두지 말고 바로 이어줍니다:
             · 붙여넣은 링크는 '예약 링크' 칸으로 옮기고
             · 검색칸은 비워 이름을 받을 준비를 하고
             · 지도를 찍기 모드로 바꿉니다 */
        if (r.pick && r.bookingUrl) {
          if (!urlIn.value.trim()) urlIn.value = r.bookingUrl;
          q.value = "";
          hits.hidden = true;
          say(r.reason);
          startPick();
          q.focus();
          return;
        }

        /* 짧은 링크를 서버가 못 푼 경우, 왜 그런지도 같이 보여줍니다.
           조용히 "못 찾았어요" 만 뜨면 고칠 수가 없습니다. */
        const note = store.resolveNote;
        return showHits(r.candidates, note ? `${r.reason} (${note})` : r.reason);
      }

      // 좌표를 그대로 붙여넣는 사람도 있습니다
      const pos = parsePos(v);
      if (pos) return add({ name: v, lat: pos.lat, lng: pos.lng, source: "pick" });

      if (!kakaoReady()) {
        return say("지도 키가 없어서 이름 검색은 아직 안 돼요. 링크를 붙여넣거나 지도에서 찍어주세요.", true);
      }
      /* ★ 주소도 받습니다.

         네이버 숙소 페이지나 에어비앤비 링크에는 좌표가 없고,
         브라우저는 남의 사이트를 읽을 수 없습니다(CORS). 하지만
         그 페이지에 적힌 주소 한 줄은 사용자가 복사할 수 있습니다.
         그걸 좌표로 바꿔주면 서버 없이도 지도에 뜹니다.

         도로명 주소는 이름 검색으로는 잘 안 나오므로, 주소처럼
         보이면 주소 검색을 먼저 시도합니다. */
      if (looksLikeAddress(v)) {
        const byAddr = await searchByAddress(v, { kind: pickedKind() });
        if (byAddr.length) {
          return showHits(
            byAddr.map((h) => ({ ...h, name: h.name || v })),
            "주소로 찾았어요. 맞으면 골라주세요."
          );
        }
      }

      const list = await searchByKeyword(v, { bbox: regionBbox(), size: 8, kind: pickedKind() });
      if (list.length) return showHits(list, "맞는 곳을 골라주세요.");

      /* 이름으로도 못 찾았으면 마지막으로 주소로 한 번 더 */
      const byAddr2 = await searchByAddress(v, { kind: pickedKind() });
      if (byAddr2.length) {
        return showHits(byAddr2.map((h) => ({ ...h, name: h.name || v })),
                        "주소로 찾았어요. 맞으면 골라주세요.");
      }
      return say("못 찾았어요. 주소를 붙여넣거나 지도에서 찍어주세요.", true);
    } catch (e) {
      say(e.message || "찾지 못했어요", true);
    }
  }

  root.querySelector(".a-find").addEventListener("click", find);
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); find(); }
  });

  function startPick(msg) {
    const m = maps[mapKey];
    if (!m || !m.ok) { say("지도가 없어서 찍기를 쓸 수 없어요.", true); return false; }
    if (msg) say(msg);
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
    return true;
  }

  root.querySelector(".a-pick").addEventListener("click", () => {
    startPick("지도를 눌러 위치를 정해주세요.");
  });
}

/* ============================================================
   사진 갤러리

   ★ 사진은 이 서비스에서 되돌리기가 가장 어려운 기능입니다.
     용량이 진짜 비용이고, 얼굴·위치 같은 민감한 게 담기고,
     한 번 퍼진 링크는 회수가 안 됩니다.

     그래서 올리기 전에 반드시 줄입니다 — 전송량이 20분의 1이 되고,
     무엇보다 사진에 박힌 촬영 위치(GPS)가 그 과정에서 지워집니다.
     숙소에서 찍은 사진을 그대로 올리면 숙소 좌표가 공개됩니다.
   ============================================================ */
let gallery = { photos: [], comments: [], cap: 300, used: 0, local: false };

function initPhoto() {
  if (inited.photo) return;
  inited.photo = true;

  $("#photo-input").addEventListener("change", onPickPhotos);

  $("#photo-grid").addEventListener("click", (ev) => {
    const cell = ev.target.closest("[data-ph]");
    if (cell) openPhoto(cell.dataset.ph);
  });

  $("#photo-del").addEventListener("click", onDeletePhoto);
  $("#photo-save").addEventListener("click", onSavePhoto);

  loadGallery();
}

async function loadGallery() {
  try {
    gallery = await store.photoList();
  } catch (e) {
    $("#photo-error").textContent = e.message || "사진을 불러오지 못했어요";
    return;
  }
  renderGallery();
}

function renderGallery() {
  const list = gallery.photos || [];
  $("#photo-empty").hidden = list.length > 0;
  $("#photo-left").textContent = list.length
    ? `${list.length}장 / ${gallery.cap}장`
    : "";

  /* 저장소가 연결 안 됐으면 솔직하게 알려줍니다 */
  $("#photo-intro").innerHTML = gallery.local
    ? "⚠️ <strong>사진 보관함이 아직 연결되지 않았어요.</strong>"
      + (gallery.note
          ? ` ${esc(gallery.note)}`
          : " 지금 올리는 사진은 <strong>이 브라우저에만</strong> 저장되고 친구들에게는 안 보여요.")
    : "여행 사진을 모아두는 곳이에요. 올릴 때 <strong>자동으로 줄이고</strong> "
      + "사진에 박힌 <strong>촬영 위치 정보를 지웁니다.</strong>";

  /* ★ 여행 중에는 더 강하게 말립니다.

     "우리가 지금 여기 있다"는 정보가 위험한 것이지, 다녀온 뒤
     사진은 추억입니다. 그래서 끝난 날짜를 보고 문구를 바꿉니다.
     안내를 늘 똑같이 띄우면 아무도 안 읽습니다. */
  const ended = room && room.end_date
    && new Date(`${room.end_date}T23:59:59`) < new Date();
  $("#photo-warn").innerHTML = ended
    ? "링크를 가진 사람은 누구나 볼 수 있어요. "
      + "얼굴이 크게 나온 사진은 친구들에게 한 번 물어봐 주세요."
    : "⚠️ <strong>여행이 끝난 뒤에 올리는 걸 권해요.</strong> "
      + "여행 중에 올리면 <strong>지금 어디에 있는지</strong>가 링크를 가진 사람 모두에게 알려져요. "
      + "사진은 다녀와서 모아도 늦지 않아요.";
  $("#photo-warn").classList.toggle("strong", !ended);
  $("#photo-warn").hidden = gallery.local && !list.length;

  $("#photo-grid").innerHTML = list.map((p) => {
    const n = (gallery.comments || []).filter((c) => c.target_id === p.id).length;
    return `
      <button type="button" class="photo-cell" data-ph="${esc(p.id)}"
              aria-label="${esc(p.caption || "사진")} 크게 보기">
        <img src="${esc(p.thumbUrl || "")}" alt="${esc(p.caption || "")}" loading="lazy">
        ${n ? `<span class="n">💬 ${n}</span>` : ""}
      </button>`;
  }).join("");
}

async function onPickPhotos(ev) {
  const files = [...(ev.target.files || [])];
  ev.target.value = "";                    /* 같은 파일을 다시 골라도 동작하게 */
  if (!files.length) return;

  const err = (m) => { $("#photo-error").textContent = m || ""; };
  const say = (m) => { $("#photo-status").textContent = m || ""; };
  err("");

  if (!canResize()) {
    return err("이 브라우저에서는 사진 올리기를 쓸 수 없어요");
  }

  let done = 0, saved = 0;
  for (const file of files) {
    say(`${done + 1}/${files.length}번째 사진을 줄이는 중…`);
    try {
      const got = await prepare(file);
      saved += Math.max(0, file.size - got.full.size);
      say(`${done + 1}/${files.length}번째 사진을 올리는 중…`);
      await store.photoUpload({
        full: got.full, thumb: got.thumb,
        width: got.width, height: got.height,
        nick: getNick(slug) || null,
      });
      done++;
    } catch (e) {
      err(`${file.name}: ${e.message || "올리지 못했어요"}`);
      break;
    }
  }

  await loadGallery();
  say(done
    ? `${done}장 올렸어요. 용량을 ${prettyBytes(saved)} 줄였어요.`
    : "");
}

/* ---------- 크게 보기 ---------- */
let viewing = null;

function openPhoto(id) {
  const p = (gallery.photos || []).find((x) => x.id === id);
  if (!p) return;
  viewing = p;

  const img = $("#photo-big");

  /* ★ 사진이 도착하기 전에 "자리"부터 잡아둡니다.

     크기를 알려주지 않으면 도착 전 높이가 0 이라, 그 사이 댓글칸이
     위로 올라왔다가 사진이 오면서 아래로 밀립니다. 그 움직임이
     "사진을 눌렀는데 댓글창이 먼저 뜨는" 증상의 원인입니다.
     비율을 미리 주면 레이아웃이 처음부터 그대로입니다. */
  img.removeAttribute("style");
  if (p.width && p.height) {
    img.style.aspectRatio = `${p.width} / ${p.height}`;
  }
  img.src = p.url || "";
  img.alt = p.caption || "여행 사진";
  $("#photo-cap").textContent = [p.caption, p.nick && `— ${p.nick}`]
    .filter(Boolean).join(" ");
  $("#photo-del").hidden = !canDelete(p.mine);
  $("#photo-save").hidden = !p.url;
  /* 폰에서는 공유 시트가 뜨므로 "저장" 보다 넓은 말이 맞습니다 */
  $("#photo-save").textContent =
    (navigator.canShare && navigator.canShare({ files: [] }) !== undefined
      && /iPhone|iPad|Android/i.test(navigator.userAgent))
      ? "저장 · 보내기" : "사진 저장";

  renderPhotoComments();

  const dlg = $("#photo-view");
  dlg.showModal();

  /* ★ 사진부터 보여야 합니다.

     <dialog> 는 열릴 때 "처음 누를 수 있는 요소"로 포커스를 옮기고,
     브라우저는 그 자리로 스크롤합니다. 우리 상자에서는 그게 댓글
     입력칸이라, 폰에서 사진을 누르면 사진은 안 보이고 "한마디
     남기기" 부터 뜹니다.

     상자 자체(tabindex="-1")에 포커스를 두고 맨 위로 올립니다. */
  const box = $("#photo-view .photo-box");
  if (box) box.focus({ preventScroll: true });

  const toTop = () => { dlg.scrollTop = 0; if (box) box.scrollTop = 0; };
  toTop();
  /* 사진이 도착한 뒤에도 한 번 더 — 그때 높이가 바뀌기 때문입니다 */
  img.addEventListener("load", toTop, { once: true });
  img.addEventListener("error", toTop, { once: true });
}

function renderPhotoComments() {
  if (!viewing) return;
  const list = (gallery.comments || []).filter((c) => c.target_id === viewing.id);
  $("#photo-cmts").innerHTML = `
    <ul class="cmt-list">
      ${list.map((c) => `
        <li data-cid="${esc(c.id)}">
          <span class="cmt-nick">${esc(c.nick)}</span>
          <span class="cmt-body">${esc(c.body)}</span>
          ${canDelete(c.mine) ? `<button type="button" class="cmt-del" data-pcdel="${esc(c.id)}"
                              aria-label="댓글 지우기">×</button>` : ""}
        </li>`).join("")}
    </ul>
    <div class="cmt-form" id="photo-cmt-form">
      <input class="cmt-input" type="text" maxlength="500" placeholder="한마디 남기기">
      <button type="button" class="btn-quiet" id="photo-cmt-go">등록</button>
    </div>`;

  /* ★ 여기는 <form> 이 아니라 <div> 입니다.

     크게 보기 상자가 <form method="dialog"> 라서, 그 안에 또 <form>
     을 넣으면 HTML 규칙 위반입니다. 브라우저는 오류를 내지 않고
     안쪽 form 태그를 조용히 버립니다. 그래서 id 로 찾으면 null 이
     나오고, "왜 없지?" 하게 됩니다. 실제로 그걸로 한참 헤맸습니다. */
  const send = async () => {
    const input = $("#photo-cmt-form .cmt-input");
    const body = input.value.trim();
    if (!body || !viewing) return;
    const nick = ensureNick();
    if (!nick) return;
    try {
      await store.commentAdd({ targetType: "photo", targetId: viewing.id, body, nick });
      input.value = "";
      await loadGallery();
      renderPhotoComments();
      /* 다시 그렸으니 다음 댓글을 바로 칠 수 있게 */
      const again = $("#photo-cmt-form .cmt-input");
      if (again) again.focus();
    } catch (e) {
      toast(e.message || "남기지 못했어요");
    }
  };

  $("#photo-cmt-go").addEventListener("click", (ev) => {
    ev.preventDefault();
    send();
  });

  /* ★ 엔터로도 보내집니다.

     이 칸은 <form method="dialog"> 안에 있어서, 엔터를 누르면
     브라우저가 "그 폼을 제출" 한 것으로 보고 상자를 닫아버립니다.
     댓글을 쓰려다 사진이 닫히는 겁니다. 그래서 엔터를 가로챕니다.

     (숙소·맛집 카드의 댓글은 진짜 <form> 이라 엔터가 원래 됩니다.
      여기만 상자 안이라 다릅니다) */
  $("#photo-cmt-form .cmt-input").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.isComposing) return;
    ev.preventDefault();       // 상자가 닫히지 않게
    send();
  });

  $("#photo-cmts").addEventListener("click", async (ev) => {
    const del = ev.target.closest("[data-pcdel]");
    if (!del) return;
    if (!confirm("이 댓글을 지울까요?")) return;
    try {
      await store.commentRemove(del.dataset.pcdel);
      await loadGallery();
      renderPhotoComments();
    } catch (e) {
      toast(e.message || "지우지 못했어요");
    }
  }, { once: true });
}

/* ★ 사진을 폰에 저장하기 / 보내기

   주소가 한 시간 뒤에 죽기 때문에 "주소를 복사해 두기"는 안 되지만,
   사진 자체를 받아두는 건 당연히 됩니다.

   ★ 아이폰에서는 <a download> 로 사진첩에 저장되지 않습니다.
     iOS 사파리는 그 방식을 제대로 지원하지 않아서, 눌러도 아무
     일이 안 일어나거나 파일 앱에만 들어갑니다. 실제로 사장님이
     "저장이 안 된다" 고 하셨습니다.

     대신 공유 시트를 띄우면 거기에 "이미지 저장" 이 있고, 그게
     사진첩으로 들어갑니다. 카톡으로 바로 보내기도 같은 자리에
     있어서 오히려 더 쓸모 있습니다.

   데스크톱에는 파일 공유가 없는 브라우저가 많으므로 내려받기로
   물러납니다. */
async function onSavePhoto() {
  if (!viewing || !viewing.url) return;

  const name = `${(room && room.title) || "여행"}-${viewing.id.slice(0, 6)}.webp`;

  let blob;
  try {
    const res = await fetch(viewing.url);
    if (!res.ok) throw new Error("받지 못했어요");
    blob = await res.blob();
  } catch (_) {
    toast("사진을 받지 못했어요. 사진을 길게 눌러 저장해보세요");
    return;
  }

  /* 폰: 공유 시트 → "이미지 저장" 이 사진첩으로 넣어줍니다 */
  try {
    const file = new File([blob], name, { type: blob.type || "image/webp" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;      // 사용자가 취소
    /* 공유가 안 되면 아래 내려받기로 */
  }

  /* 데스크톱: 내려받기 */
  try {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (_) {
    toast("저장하지 못했어요. 사진을 길게 눌러 저장해보세요");
  }
}

async function onDeletePhoto() {
  if (!viewing) return;
  if (!askDelete(viewing.mine, "사진")) return;
  try {
    await store.photoRemove(viewing.id);
    $("#photo-view").close();
    viewing = null;
    await loadGallery();
  } catch (e) {
    toast(e.message || "지우지 못했어요");
  }
}


/* ============================================================
   댓글 — 숙소·맛집 카드마다

   ★ 투표는 익명, 댓글은 별명입니다. 목적이 다릅니다.
     투표는 눈치 안 보고 고르라고 익명이고, 댓글은 대화가 되라고
     별명을 씁니다. 완전 익명 댓글은 "누가 쓴 거야?"가 되어
     오히려 불편합니다.

     별명은 방마다 한 번만 받고 기억합니다. 댓글마다 이름을
     다시 묻는 앱은 아무도 두 번째 댓글을 달지 않습니다.
   ============================================================ */
function commentsFor(placeId) {
  return state.comments.filter((c) => c.target_id === placeId);
}

/* 카드 안에 들어갈 댓글 영역.
   <details> 라 기본은 접혀 있고, 개수는 접힌 채로도 보입니다. */
function commentsHtml(placeId) {
  const list = commentsFor(placeId);
  const n = list.length;

  return `
    <details class="cmts" data-cmt="${esc(placeId)}"${n ? "" : ""}>
      <summary>댓글${n ? ` <strong>${n}</strong>` : ""}</summary>
      <ul class="cmt-list">
        ${list.map((c) => `
          <li data-cid="${esc(c.id)}">
            <span class="cmt-nick">${esc(c.nick)}</span>
            <span class="cmt-body">${esc(c.body)}</span>
            ${canDelete(c.mine) ? `<button type="button" class="cmt-del" data-cdel="${esc(c.id)}"
                                aria-label="댓글 지우기">×</button>` : ""}
          </li>`).join("")}
      </ul>
      <form class="cmt-form">
        <input class="cmt-input" type="text" maxlength="500" placeholder="한마디 남기기">
        <button type="submit" class="btn-quiet">등록</button>
      </form>
    </details>`;
}

/* 별명을 아직 안 정했으면 한 번만 묻습니다 */
function ensureNick() {
  let nick = getNick(slug);
  if (nick) return nick;

  const asked = prompt("댓글에 표시할 별명을 알려주세요 (12자까지)\n투표는 계속 익명이에요.");
  if (asked == null) return null;                 // 취소
  nick = String(asked).trim().slice(0, 12);
  if (!nick) return null;
  setNick(slug, nick);
  return nick;
}

/* 숙소·맛집 목록 양쪽에 같은 방식으로 붙입니다 */
function wireComments(listSel) {
  const box = $(listSel);
  if (!box || box.dataset.cmtWired) return;
  box.dataset.cmtWired = "1";

  /* 카드 자체가 "누르면 지도가 따라가는" 요소라, 댓글 안에서의
     클릭이 거기까지 올라가면 안 됩니다 */
  box.addEventListener("click", (ev) => {
    if (ev.target.closest(".cmts")) ev.stopPropagation();
  });

  box.addEventListener("click", async (ev) => {
    const del = ev.target.closest("[data-cdel]");
    if (!del) return;
    ev.preventDefault();
    if (!confirm("이 댓글을 지울까요?")) return;
    del.disabled = true;
    try {
      await store.commentRemove(del.dataset.cdel);
      await refresh();
      redrawAll();
    } catch (e) {
      toast(e.message || "지우지 못했어요");
      del.disabled = false;
    }
  });

  box.addEventListener("submit", async (ev) => {
    const form = ev.target.closest(".cmt-form");
    if (!form) return;
    ev.preventDefault();

    const wrap = form.closest("[data-cmt]");
    const input = form.querySelector(".cmt-input");
    const body = input.value.trim();
    if (!body) return;

    const nick = ensureNick();
    if (!nick) return;

    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await store.commentAdd({ targetId: wrap.dataset.cmt, body, nick });
      input.value = "";
      await refresh();
      redrawAll();
      /* 다시 그리면 접히므로, 방금 쓴 카드는 열어둡니다 */
      const again = box.querySelector(`[data-cmt="${CSS.escape(wrap.dataset.cmt)}"]`);
      if (again) again.open = true;
    } catch (e) {
      toast(e.message || "남기지 못했어요");
    } finally {
      btn.disabled = false;
    }
  });
}


/* ============================================================
   일정표

   ★ 짜는 것은 route.js 가 전부 합니다. 여기서는 그리기와 저장만.

   ★ 저장은 "날짜별"입니다.
     505 는 일정 전체를 통짜로 저장해서, 두 사람이 동시에 고치면
     나중 사람이 앞사람 것을 조용히 덮어썼습니다. 여기서는 날마다
     version 을 들고 있다가 어긋나면 "친구가 먼저 고쳤어요" 를
     띄우고 그 날만 다시 불러옵니다.
   ============================================================ */
function planDays() {
  return enumerateDays(room.start_date, room.end_date);
}

/* 투표 순위로 후보 고르기.
   투표가 하나도 없으면 추가된 순서대로 씁니다 — "투표부터 하세요"
   라고 막아버리면 혼자 짜보려는 사람이 아무것도 못 합니다. */
function planCandidates() {
  const days = planDays().length || 1;
  const cap = Math.min(22, Math.max(4, days * 4));

  const scored = state.places
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ ...p, votes: state.counts[p.id] || 0 }));

  const voted = scored.filter((p) => p.votes > 0);
  const pool = voted.length ? voted : scored;

  const lodging = pool
    .filter((p) => p.kind === "lodging")
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ko"))[0] || null;

  const rest = pool
    .filter((p) => p.kind !== "lodging")
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ko"))
    .slice(0, cap);

  return { lodging, places: rest, usedVotes: voted.length > 0 };
}

function initPlan() {
  if (inited.plan) return;
  inited.plan = true;

  $("#plan-build").addEventListener("click", onBuildPlan);
  $("#plan-share").addEventListener("click", sharePlan);

  $("#plan-days").addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    const li = btn.closest("li[data-i]");
    const dayBox = btn.closest(".plan-day[data-d]");
    if (!li || !dayBox) return;
    await editDay(Number(dayBox.dataset.d), Number(li.dataset.i), btn.dataset.act);
  });

  renderPlan();
}

async function onBuildPlan() {
  const err = (m) => { $("#plan-error").textContent = m || ""; };
  err("");

  const { lodging, places, usedVotes } = planCandidates();
  if (!places.length && !lodging) {
    err("먼저 숙소나 맛집을 추가해주세요");
    return;
  }
  if (state.itinerary.length &&
      !confirm("지금 일정을 지우고 투표 결과로 새로 짤까요?")) return;

  const btn = $("#plan-build");
  btn.disabled = true;
  try {
    /* ★ 출발 지점을 여기서 한 번 더 찾습니다.

       방을 만들 때 카카오 검색으로 "강릉역" 같은 곳을 찾아 저장하는데,
       그때 검색이 한 번 실패하면 그 방은 영영 출발 지점이 없는 채로
       남습니다. 일정이 늘 숙소에서 시작하게 되죠. 짤 때 다시 찾으면
       그 한 번의 실패가 영구적인 결함이 되지 않습니다. */
    let hub = room.hub || null;
    if (!hub && room.region_code) {
      const region = regionByCode(room.region_code);
      if (region && region.hubQuery && kakaoReady()) {
        try { hub = await findHub(region); } catch (_) { /* 없으면 숙소 기준 */ }
      }
    }

    const built = buildItinerary({
      days: planDays(),
      hub,
      lodging,
      places,
    });

    const r = await store.itinerarySave(
      built.itinerary.map((d, i) => ({ day_index: i, date: d.date, label: d.label, slots: d.slots }))
    );
    if (r && r.ok === false) { err(r.message || "저장하지 못했어요"); return; }

    await refresh();
    renderPlan();

    const notes = [];
    notes.push(usedVotes ? "투표 순위로 짰어요." : "아직 투표가 없어서 추가된 순서로 짰어요.");
    notes.push(`이동시간 약 ${built.totalMin}분 (직선거리 기준 추정이라 실제와 다를 수 있어요)`);
    if (built.warnings.length) notes.push(built.warnings.join(" · "));
    $("#plan-note").textContent = notes.join(" ");
  } catch (e) {
    err(e.message || "일정을 짜지 못했어요");
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 직접 고치기 ---------- */
async function editDay(dayIndex, slotIndex, act) {
  const day = state.itinerary.find((d) => d.day_index === dayIndex);
  if (!day) return;

  const slots = (day.slots || []).slice();
  if (act === "up" && slotIndex > 0) {
    [slots[slotIndex - 1], slots[slotIndex]] = [slots[slotIndex], slots[slotIndex - 1]];
  } else if (act === "down" && slotIndex < slots.length - 1) {
    [slots[slotIndex], slots[slotIndex + 1]] = [slots[slotIndex + 1], slots[slotIndex]];
  } else if (act === "drop") {
    if (!confirm(`"${slots[slotIndex].title}"을 일정에서 뺄까요?`)) return;
    slots.splice(slotIndex, 1);
  } else {
    return;
  }

  try {
    const r = await store.itineraryDaySave(dayIndex, slots, day.version,
      { date: day.the_date, label: day.label });

    if (r && r.ok === false) {
      /* 친구가 먼저 고쳤습니다 — 덮어쓰지 않고 최신을 보여줍니다 */
      toast(r.message || "친구가 먼저 고쳤어요");
      await refresh();
      renderPlan();
      return;
    }
    await refresh();
    renderPlan();
  } catch (e) {
    toast(e.message || "고치지 못했어요");
  }
}

function renderPlan() {
  const box = $("#plan-days");
  const has = state.itinerary.length > 0;

  $("#plan-empty").hidden = has;
  $("#plan-share").hidden = !has;
  $("#plan-build").textContent = has ? "투표 결과로 다시 짜기" : "투표 결과로 짜기";

  if (!has) { box.innerHTML = ""; return; }

  const labels = planDays();
  box.innerHTML = state.itinerary.map((d) => {
    const label = d.label || (labels[d.day_index] && labels[d.day_index].label) || `${d.day_index + 1}일차`;
    const slots = d.slots || [];
    const spots = slots.filter((x) => x.placeId).length;

    return `
      <div class="plan-day" data-d="${d.day_index}">
        <h3>${esc(label)} <small>장소 ${spots}곳</small></h3>
        <ul class="plan-slots">
          ${slots.length ? slots.map((x, i) => `
            <li data-i="${i}">
              <span class="plan-time">${esc(x.time || "")}</span>
              <span class="plan-what">
                <span class="plan-title">${esc(x.title || "")}</span>
                ${x.note ? `<span class="plan-note">${esc(x.note)}</span>` : ""}
              </span>
              <span class="plan-move">
                <button type="button" data-act="up" ${i === 0 ? "disabled" : ""}
                        aria-label="위로">▲</button>
                <button type="button" data-act="down" ${i === slots.length - 1 ? "disabled" : ""}
                        aria-label="아래로">▼</button>
                <button type="button" data-act="drop" class="plan-drop"
                        aria-label="빼기">×</button>
              </span>
            </li>`).join("")
            : `<li data-i="0"><span class="plan-time"></span>
                 <span class="plan-what"><span class="plan-note">비어 있어요</span></span>
                 <span></span></li>`}
        </ul>
      </div>`;
  }).join("");
}

async function sharePlan() {
  const lines = [`[${room ? room.title : "여행"}] 일정`];
  for (const d of state.itinerary) {
    const label = d.label || `${d.day_index + 1}일차`;
    lines.push("", `■ ${label}`);
    for (const x of d.slots || []) lines.push(`${x.time}  ${x.title}`);
  }
  const text = lines.join("\n");
  const url = location.href.split("#")[0];

  if (navigator.share) {
    try { await navigator.share({ title: "여행 일정", text, url }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("일정을 복사했어요. 카톡에 붙여넣어 주세요");
  } catch (_) {
    toast("복사하지 못했어요. 화면을 길게 눌러 복사해주세요");
  }
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
    if (!askDelete(row.mine, `"${row.item}" ${won(row.amount)}`)) return;

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
          ${canDelete(e.mine)
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
