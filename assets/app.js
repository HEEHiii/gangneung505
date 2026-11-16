/* ============================================================
   app.js — 게이트 · 탭 · 숙소/투표 · 일정 · 경비 · 맛집
   ============================================================ */

const PASSWORD = "505";
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* 저장소에서 읽어온 공유 상태 */
const state = { counts: {}, mine: [], expenses: [], items: [], docs: {}, loaded: false };

/* 지금 지도에서 들여다보고 있는 것 (같은 걸 또 누르면 전체 보기로 돌아갑니다) */
let selectedLodgingId = null;
let selectedFoodId = null;

/* ───────── 작은 도구들 ───────── */
const won = n => Number(n || 0).toLocaleString("ko-KR") + "원";

function fmtRange() {
  if (!TRIP.start) return "";
  const d = s => s.replace(/^\d{4}-/, "").replace("-", ".");
  const nights = TRIP.nights ? ` · ${TRIP.nights}박 ${TRIP.nights + 1}일` : "";
  return `${TRIP.start.slice(0, 4)}.${d(TRIP.start)} – ${d(TRIP.end)}${nights}`;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
}

/* "37.7743, 128.9444" → {lat,lng}.  못 읽으면 null */
function parsePos(text) {
  const m = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*[,/\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  // 한국 범위를 크게 벗어나면 순서를 바꿔 넣었을 가능성이 큽니다
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  return { lat, lng };
}

/* 기본 목록 + 친구들이 추가한 것 */
const added = kind => state.items.filter(i => i.kind === kind);
const allLodgings = () => [...LODGINGS, ...added("lodging")];
const allFoods    = () => [...FOODS,    ...added("food")];

/* 일정표: 고친 적이 있으면 그걸, 없으면 data.js 기본값 */
function currentItinerary() {
  const saved = state.docs && state.docs.itinerary;
  if (saved && Array.isArray(saved) && saved.length) return saved;
  return JSON.parse(JSON.stringify(ITINERARY));
}

/* ───────── 1. 비밀번호 게이트 ─────────
   주의: 이 함수는 파일 맨 아래에서 호출합니다.
   위에서 바로 실행하면, 아래에 선언된 변수들보다 먼저 돌아서
   "이미 비밀번호를 통과한 상태로 새로고침" 할 때 페이지가 깨집니다. */
function initGate() {
  const sub = $("#gate-sub");
  sub.textContent = fmtRange();

  const passed = (() => {
    try { return sessionStorage.getItem("gn505.ok") === "1"; } catch (_) { return false; }
  })();
  if (passed) return enter();

  const form = $("#gate-form"), input = $("#gate-input"), err = $("#gate-error");
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (input.value.trim() === PASSWORD) {
      try { sessionStorage.setItem("gn505.ok", "1"); } catch (_) {}
      enter();
    } else {
      err.textContent = "비밀번호가 맞지 않아요";
      input.value = "";
      input.classList.remove("shake");
      void input.offsetWidth;          // 애니메이션 재시작
      input.classList.add("shake");
      input.focus();
    }
  });
  input.focus();
}

function enter() {
  $("#gate").hidden = true;
  $("#app").hidden = false;
  $("#trip-range").textContent = fmtRange();
  boot();
}

/* ───────── 2. 탭 ───────── */
const TABS = ["stay", "plan", "money", "food"];
const inited = {};
const maps = {};

function showTab(name) {
  if (!TABS.includes(name)) name = "stay";
  TABS.forEach(t => { $("#panel-" + t).hidden = (t !== name); });
  $$("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === name));

  if (name === "stay" && maps.stay) maps.stay.refresh();
  if (name === "food") { initFood(); if (maps.food) maps.food.refresh(); }
}

window.addEventListener("hashchange", () => {
  if ($("#app").hidden) return;
  showTab(location.hash.replace("#", ""));
});

/* ───────── 3. 부팅 ───────── */
async function boot() {
  initStay();
  initPlan();
  initMoney();
  showTab(location.hash.replace("#", "") || "stay");

  // 먼저 기본 내용으로 그려두고, 저장소에서 읽어온 뒤 다시 그립니다.
  // 구글 시트에서 받아오는 데 2~3초쯤 걸려서, 그동안은 투표를 막아둡니다.
  // (0표로 보이는 사이에 또 누르는 걸 막으려고)
  if (Store.online) setPlanStatus("불러오는 중…");
  try {
    Object.assign(state, await Store.load());
  } catch (err) {
    console.warn("불러오기 실패", err);
    toast("저장된 내용을 불러오지 못했어요");
  }
  state.loaded = true;
  setPlanStatus("");
  redrawAll();
}

function redrawAll() {
  renderLodgings();
  if (maps.stay) {
    maps.stay.setLodgings(allLodgings(), id => selectLodging(id, false));
  }
  // 처음 그릴 때만 저장된 일정을 불러오고, 그 뒤에는 편집 중인 내용을 지키기
  renderPlan(planDraft !== null);
  renderMoney();
  if (inited.food) renderFood();
}

/* ───────── 4. 숙소 + 지도 + 투표 ───────── */
function initStay() {
  if (inited.stay) return;
  inited.stay = true;

  maps.stay = createMap("map-stay", { center: GANGNEUNG, zoom: 11 });
  maps.stay.setSpots(SPOTS);
  maps.stay.setLodgings(allLodgings(), id => selectLodging(id, false));
  maps.stay.fit();
  maps.stay.refresh();

  $$(".map-legend button").forEach(b => {
    b.addEventListener("click", () => {
      $$(".map-legend button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      maps.stay.filter(b.dataset.filter);
    });
  });

  /* 목록 클릭 — 한 번만 연결하고 위임으로 처리 */
  const ul = $("#lodging-list");
  ul.addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); return onDeleteItem(del.dataset.del, "숙소"); }
    const voteBtn = e.target.closest("[data-vote]");
    if (voteBtn) { e.stopPropagation(); return onVote(voteBtn.dataset.vote); }
    if (e.target.closest("a")) return;          // 링크는 그대로 열리게
    const card = e.target.closest(".card");
    if (card) selectLodging(card.dataset.id, true);
  });
  ul.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card");
    if (card && e.target === card) { e.preventDefault(); selectLodging(card.dataset.id, true); }
  });

  /* 숙소 추가 폼 */
  $("#form-lodging").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#al-name").value.trim();
    const url  = $("#al-url").value.trim();
    const posText = $("#al-pos").value.trim();
    const note = $("#al-note").value.trim();
    if (!name || !url) return toast("이름과 링크를 적어주세요");

    let pos = null;
    if (posText) {
      pos = parsePos(posText);
      if (!pos) return toast("위치를 37.7743, 128.9444 형태로 적거나 지도에서 찍어주세요");
    }

    const btn = $("#form-lodging button[type=submit]");
    btn.disabled = true;
    try {
      const item = await Store.addItem("lodging", {
        name, url, note,
        lat: pos ? pos.lat : null,
        lng: pos ? pos.lng : null,
        area: "", capacity: "", price: "",
      });
      state.items.push(item);
      $("#form-lodging").reset();
      maps.stay.cancelPick();
      redrawAll();
      toast("숙소를 추가했어요");
    } catch (_) {
      toast("추가하지 못했어요");
    } finally {
      btn.disabled = false;
    }
  });

  wireResolver({ urlSel: "#al-url", statusSel: "#al-status",
                 nameSel: "#al-name", posSel: "#al-pos", mapKey: "stay" });

  // 저장소를 기다리지 않고 기본 5곳을 바로 보여줍니다.
  // (안 그러면 2~3초 동안 빈 목록이 보입니다)
  renderLodgings();

  const note = $("#vote-note");
  if (!Store.online) {
    note.hidden = false;
    note.innerHTML =
      "지금은 투표·추가한 내용이 <strong>이 기기에만</strong> 저장됩니다. " +
      "친구들과 합쳐지게 하려면 <code>SETUP.md</code> 를 따라 주소를 연결해주세요.";
  }
}

function renderLodgings() {
  const list = allLodgings();
  const ul = $("#lodging-list");
  const waiting = Store.online && !state.loaded;
  $("#stay-count").textContent = waiting
    ? "불러오는 중…"
    : `후보 ${list.length}곳 · ${TRIP.people}인 기준`;

  if (!list.length) {
    ul.innerHTML = '<li class="empty">아직 숙소 후보가 없어요. 아래에서 추가해보세요.</li>';
    return;
  }

  const refs = SPOTS.filter(s => s.dist);

  ul.innerHTML = list.map((d, i) => {
    const hasPos = d.lat != null && d.lng != null;
    const dists = (hasPos ? refs : []).map(s => {
      const km = distanceKm(d.lat, d.lng, s.lat, s.lng);
      return `<span class="dist">${esc(s.name)} ${km < 1 ? Math.round(km * 1000) + "m" : km.toFixed(1) + "km"}</span>`;
    }).join("");

    const meta = [d.area, d.capacity, d.price].filter(Boolean).map(esc).join(" · ");
    const badge = !hasPos ? '<span class="badge">위치 미입력</span>'
                : d.approx ? '<span class="badge">대략 위치</span>' : "";

    return `
    <li class="card" data-id="${esc(d.id)}" tabindex="0">
      <div class="card-top">
        <div class="card-no${hasPos ? "" : " off"}">${i + 1}</div>
        <div class="card-body">
          <div class="card-name">${esc(d.name)}${badge}${
            d.added ? '<span class="badge added">친구 추가</span>' : ""}</div>
          ${meta ? `<div class="card-meta">${meta}</div>` : ""}
          ${d.note ? `<div class="card-note">${esc(d.note)}</div>` : ""}
          ${dists ? `<div class="dists">${dists}</div>` : ""}
          <div class="card-actions">
            <a class="btn-link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">숙소 보기 ↗</a>
            <button class="btn-vote" type="button" data-vote="${esc(d.id)}"${waiting ? " disabled" : ""}>투표</button>
            ${d.added ? `<button class="btn-del" type="button" data-del="${esc(d.id)}" aria-label="${esc(d.name)} 삭제">삭제</button>` : ""}
            <span class="vote-count" data-count="${esc(d.id)}"><strong>0</strong>표</span>
          </div>
        </div>
      </div>
    </li>`;
  }).join("");

  // 목록이 바뀌어 사라진 카드를 고른 상태로 남겨두지 않기
  if (selectedLodgingId && !list.some(d => d.id === selectedLodgingId)) selectedLodgingId = null;
  if (selectedLodgingId) {
    const c = $(`#lodging-list .card[data-id="${CSS.escape(selectedLodgingId)}"]`);
    if (c) c.classList.add("sel");
  }

  paintVotes();
}

function selectLodging(id, fromCard) {
  // 이미 보고 있던 숙소를 또 누르면 전체 지도로 돌아갑니다
  if (selectedLodgingId === id) return clearLodgingSelection();

  selectedLodgingId = id;
  $$("#lodging-list .card").forEach(c => c.classList.toggle("sel", c.dataset.id === id));
  maps.stay.select(id, true);
  if (!fromCard) {
    const card = $(`#lodging-list .card[data-id="${CSS.escape(id)}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function clearLodgingSelection() {
  selectedLodgingId = null;
  $$("#lodging-list .card").forEach(c => c.classList.remove("sel"));
  if (!maps.stay) return;
  maps.stay.clearSelect();
  maps.stay.fit();
}

function paintVotes() {
  [...allLodgings(), ...allFoods()].forEach(d => {
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
  renderRoutePreview();
}

async function onVote(id) {
  const on = !state.mine.includes(id);

  // 낙관적 반영
  const before = { counts: { ...state.counts }, mine: [...state.mine] };
  state.mine = on ? [...state.mine, id] : state.mine.filter(x => x !== id);
  state.counts[id] = Math.max(0, (state.counts[id] || 0) + (on ? 1 : -1));
  paintVotes();

  try {
    await Store.toggleVote(id, on);
  } catch (_) {
    state.counts = before.counts;
    state.mine = before.mine;
    paintVotes();
    toast("투표를 저장하지 못했어요. 잠시 후 다시 눌러주세요.");
  }
}

/* 친구가 추가한 숙소·맛집 삭제 */
async function onDeleteItem(id, label) {
  const item = state.items.find(x => x.id === id);
  if (!item) return;
  if (!confirm(`"${item.name}" ${label}를 목록에서 지울까요?`)) return;

  const before = [...state.items];
  state.items = state.items.filter(x => x.id !== id);
  redrawAll();
  try { await Store.removeItem(id); }
  catch (_) { state.items = before; redrawAll(); toast("삭제하지 못했어요"); }
}

/* ───────── 5. 일정 (직접 수정) ───────── */
let planDraft = null;
let planSaveTimer = null;

function initPlan() {
  if (inited.plan) return;
  inited.plan = true;

  const box = $("#itinerary");

  box.addEventListener("input", e => {
    const f = e.target.closest("[data-field]");
    if (!f) return;
    const { day, slot, field } = f.dataset;
    planDraft[day].slots[slot][field] = f.value;
    queuePlanSave();
  });

  box.addEventListener("click", e => {
    const addBtn = e.target.closest("[data-add-slot]");
    if (addBtn) {
      planDraft[addBtn.dataset.addSlot].slots.push({ time: "", title: "", note: "" });
      renderPlan(true);
      queuePlanSave();
      // 새로 생긴 칸에 바로 커서
      const d = addBtn.dataset.addSlot;
      const last = planDraft[d].slots.length - 1;
      const input = $(`[data-day="${d}"][data-slot="${last}"][data-field="title"]`);
      if (input) input.focus();
      return;
    }
    const delBtn = e.target.closest("[data-del-slot]");
    if (delBtn) {
      const [d, s] = delBtn.dataset.delSlot.split(":");
      planDraft[d].slots.splice(Number(s), 1);
      renderPlan(true);
      queuePlanSave();
    }
  });

  $("#route-build").addEventListener("click", onBuildRoute);

  $("#plan-reset").addEventListener("click", async () => {
    if (!confirm("일정표를 처음 상태로 되돌릴까요? 적어둔 내용이 사라집니다.")) return;
    planDraft = JSON.parse(JSON.stringify(ITINERARY));
    renderPlan(true);
    await savePlan();
  });
}

function queuePlanSave() {
  setPlanStatus("저장 중…");
  clearTimeout(planSaveTimer);
  planSaveTimer = setTimeout(savePlan, 700);
}

async function savePlan() {
  try {
    state.docs.itinerary = JSON.parse(JSON.stringify(planDraft));
    await Store.setDoc("itinerary", state.docs.itinerary);
    setPlanStatus("저장됨");
  } catch (_) {
    setPlanStatus("저장 실패 — 다시 고쳐보세요", true);
  }
}

let statusTimer;
function setPlanStatus(text, bad) {
  const el = $("#plan-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("bad", !!bad);
  clearTimeout(statusTimer);
  if (text && !bad && text !== "불러오는 중…") {
    statusTimer = setTimeout(() => { el.textContent = ""; }, 2200);
  }
}

/* keepDraft=true 면 지금 편집 중인 내용을 유지한 채 다시 그립니다 */
function renderPlan(keepDraft) {
  if (!keepDraft) planDraft = currentItinerary();

  $("#itinerary").innerHTML = planDraft.map((day, di) => `
    <section class="day">
      <div class="day-head">
        <h3>${esc(day.label)}</h3>
        <span>${esc(String(day.date || "").replace(/^\d{4}-/, "").replace("-", "월 "))}${day.date ? "일" : ""}${day.dow ? ` (${esc(day.dow)})` : ""}</span>
      </div>

      ${day.slots.map((s, si) => `
        <div class="slot edit">
          <input class="slot-time-in" data-field="time" data-day="${di}" data-slot="${si}"
                 value="${esc(s.time || "")}" placeholder="시간" maxlength="5"
                 aria-label="${esc(day.label)} ${si + 1}번째 일정 시간">
          <div class="slot-body">
            <input class="slot-title-in" data-field="title" data-day="${di}" data-slot="${si}"
                   value="${esc(s.title || "")}" placeholder="무엇을 할까요?" maxlength="40"
                   aria-label="${esc(day.label)} ${si + 1}번째 일정 내용">
            <input class="slot-note-in" data-field="note" data-day="${di}" data-slot="${si}"
                   value="${esc(s.note || "")}" placeholder="메모 (선택)" maxlength="60"
                   aria-label="${esc(day.label)} ${si + 1}번째 일정 메모">
          </div>
          <button class="slot-del" type="button" data-del-slot="${di}:${si}" aria-label="이 일정 지우기">×</button>
        </div>`).join("")}

      <button class="slot-add" type="button" data-add-slot="${di}">+ 일정 추가</button>
    </section>`).join("");
}

/* ───────── 6. 경비 정산 ───────── */
function initMoney() {
  if (inited.money) return;
  inited.money = true;

  $("#expense-form").addEventListener("submit", async e => {
    e.preventDefault();
    const item   = $("#ex-item").value.trim();
    const amount = Number($("#ex-amount").value);
    const payer  = $("#ex-payer").value.trim();
    if (!item || !payer || !(amount > 0)) return toast("항목·금액·결제자를 모두 적어주세요");

    try {
      const row = await Store.addExpense({ item, amount, payer, ts: Date.now() });
      state.expenses.push(row);
      $("#ex-item").value = ""; $("#ex-amount").value = "";
      $("#ex-item").focus();
      renderMoney();
    } catch (_) {
      toast("저장하지 못했어요");
    }
  });

  $("#expense-list").addEventListener("click", async e => {
    const btn = e.target.closest(".ex-del");
    if (!btn) return;
    const id = btn.dataset.id;
    const keep = [...state.expenses];
    state.expenses = state.expenses.filter(x => x.id !== id);
    renderMoney();
    try { await Store.removeExpense(id); }
    catch (_) { state.expenses = keep; renderMoney(); toast("삭제하지 못했어요"); }
  });
}

function renderMoney() {
  const N = Math.max(1, TRIP.people || 1);
  const total = state.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const share = total / N;

  $("#expense-summary").innerHTML = `
    <div class="stat"><div class="stat-k">총 지출</div><div class="stat-v">${won(total)}</div></div>
    <div class="stat"><div class="stat-k">1인당 (${N}명)</div><div class="stat-v">${won(Math.round(share))}</div></div>`;

  $("#expense-list").innerHTML = state.expenses.length
    ? state.expenses.map(e => `
        <li>
          <span class="ex-item">${esc(e.item)}</span>
          <span class="ex-payer">${esc(e.payer)}</span>
          <span class="ex-amount">${won(e.amount)}</span>
          <button class="ex-del" type="button" data-id="${esc(e.id)}" aria-label="삭제">×</button>
        </li>`).join("")
    : '<li class="empty" style="border:0">아직 적은 지출이 없어요.</li>';

  renderSettlement(share, N);
}

function renderSettlement(share, N) {
  const box = $("#settlement");
  if (!state.expenses.length) { box.innerHTML = ""; box.hidden = true; return; }
  box.hidden = false;

  const paid = {};
  state.expenses.forEach(e => { paid[e.payer] = (paid[e.payer] || 0) + Number(e.amount || 0); });

  const names = Object.keys(paid);
  // 아직 한 푼도 안 낸 사람 자리를 채워 계산이 맞아떨어지게
  const ghosts = Math.max(0, N - names.length);
  const people = [
    ...names.map(n => ({ name: n, bal: paid[n] - share })),
    ...Array.from({ length: ghosts }, (_, i) => ({ name: `아직 안 낸 사람 ${i + 1}`, bal: -share })),
  ];

  const owe = people.filter(p => p.bal < -1).sort((a, b) => a.bal - b.bal);
  const get = people.filter(p => p.bal >  1).sort((a, b) => b.bal - a.bal);

  const lines = [];
  let i = 0, j = 0;
  while (i < owe.length && j < get.length) {
    const amt = Math.min(-owe[i].bal, get[j].bal);
    lines.push(`<li><em>${esc(owe[i].name)}</em> → <em>${esc(get[j].name)}</em> ${won(Math.round(amt))}</li>`);
    owe[i].bal += amt; get[j].bal -= amt;
    if (-owe[i].bal < 1) i++;
    if (get[j].bal   < 1) j++;
  }

  box.innerHTML = `
    <h3>이렇게 주고받으면 끝</h3>
    <ul>${lines.length ? lines.join("") : "<li>정산할 게 없어요.</li>"}</ul>
    ${ghosts ? `<p class="muted" style="margin-top:10px">
        ${TRIP.people}명 중 ${names.length}명만 결제 기록이 있어요.
        나머지 ${ghosts}명은 이름 대신 임시로 표시했습니다.
      </p>` : ""}`;
}

/* ───────── 7. 맛집 ───────── */
let foodCat = "all";

function initFood() {
  if (inited.food) return;
  inited.food = true;

  maps.food = createMap("map-food", { center: GANGNEUNG, zoom: 11 });

  $("#food-filters").innerHTML = FOOD_CATS.map(c =>
    `<button class="chip${c.key === "all" ? " on" : ""}" type="button" data-cat="${c.key}">${esc(c.label)}</button>`
  ).join("");

  $("#food-filters").addEventListener("click", e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    foodCat = b.dataset.cat;
    $$("#food-filters .chip").forEach(x => x.classList.toggle("on", x === b));
    renderFood();
  });

  $("#food-list").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); return onDeleteItem(del.dataset.del, "장소"); }
    const voteBtn = e.target.closest("[data-vote]");
    if (voteBtn) { e.stopPropagation(); return onVote(voteBtn.dataset.vote); }
    if (e.target.closest("a")) return;          // 링크는 그대로 열리게
    const card = e.target.closest(".card");
    if (!card) return;
    // 이미 보고 있던 곳을 또 누르면 전체 지도로 돌아갑니다
    if (selectedFoodId === card.dataset.fid) return clearFoodSelection();
    selectedFoodId = card.dataset.fid;
    $$("#food-list .card").forEach(c => c.classList.toggle("sel", c === card));
    maps.food.goTo(selectedFoodId);
  });

  $("#form-food").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#af-name").value.trim();
    const cat  = $("#af-cat").value;
    const url  = $("#af-url").value.trim();
    const posText = $("#af-pos").value.trim();
    const note = $("#af-note").value.trim();
    if (!name) return toast("이름을 적어주세요");

    let pos = null;
    if (posText) {
      pos = parsePos(posText);
      if (!pos) return toast("위치를 37.7743, 128.9444 형태로 적거나 지도에서 찍어주세요");
    }

    const btn = $("#form-food button[type=submit]");
    btn.disabled = true;
    try {
      const item = await Store.addItem("food", {
        name, cat, note, url,
        lat: pos ? pos.lat : null,
        lng: pos ? pos.lng : null,
      });
      state.items.push(item);
      $("#form-food").reset();
      maps.food.cancelPick();
      renderFood();
      toast("추가했어요");
    } catch (_) {
      toast("추가하지 못했어요");
    } finally {
      btn.disabled = false;
    }
  });

  wireResolver({ urlSel: "#af-url", statusSel: "#af-status",
                 nameSel: "#af-name", posSel: "#af-pos", mapKey: "food" });

  renderFood();
}

function clearFoodSelection() {
  selectedFoodId = null;
  $$("#food-list .card").forEach(c => c.classList.remove("sel"));
  if (!maps.food) return;
  maps.food.clearSelect();
  maps.food.fitPoints();
}

function renderFood() {
  const list = allFoods().filter(f => foodCat === "all" || f.cat === foodCat);

  const waiting = Store.online && !state.loaded;

  $("#food-list").innerHTML = list.length
    ? list.map(f => {
        const hasPos = f.lat != null && f.lng != null;
        return `
        <li class="card" data-fid="${esc(f.id)}" tabindex="0">
          <div class="card-body">
            <div class="card-name">${esc(f.name)}${
              !hasPos ? '<span class="badge">위치 미입력</span>'
              : f.approx ? '<span class="badge">대략 위치</span>' : ""}${
              f.added ? '<span class="badge added">친구 추가</span>' : ""}</div>
            ${f.note ? `<div class="card-note">${esc(f.note)}</div>` : ""}
            <div class="card-actions">
              ${f.url ? `<a class="btn-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">보기 ↗</a>` : ""}
              <button class="btn-vote" type="button" data-vote="${esc(f.id)}"${waiting ? " disabled" : ""}>투표</button>
              ${f.added ? `<button class="btn-del" type="button" data-del="${esc(f.id)}" aria-label="${esc(f.name)} 삭제">삭제</button>` : ""}
              <span class="vote-count" data-count="${esc(f.id)}"><strong>0</strong>표</span>
            </div>
          </div>
        </li>`;
      }).join("")
    : '<li class="empty">이 분류에는 아직 없어요.</li>';

  maps.food.setPoints(list.filter(f => f.lat != null && f.lng != null));
  maps.food.refresh();

  // 분류를 바꾸면 보던 곳이 목록에서 빠질 수 있습니다
  if (selectedFoodId && !list.some(f => f.id === selectedFoodId)) selectedFoodId = null;
  if (selectedFoodId) {
    const c = $(`#food-list .card[data-fid="${CSS.escape(selectedFoodId)}"]`);
    if (c) c.classList.add("sel");
  }

  paintVotes();
}

/* ───────── 8. 링크 붙여넣으면 이름·위치 자동으로 찾기 ─────────
   브라우저에서 네이버·에어비앤비를 직접 읽는 건 CORS 때문에 불가능해서,
   구글 앱스 스크립트가 서버에서 대신 읽어옵니다. */
function wireResolver({ urlSel, statusSel, nameSel, posSel, mapKey }) {
  const urlEl = $(urlSel), statusEl = $(statusSel);
  if (!urlEl || !statusEl) return;
  let lastTried = "";

  const setStatus = (text, kind) => {
    statusEl.textContent = text;
    statusEl.className = "resolve-status" + (kind ? " " + kind : "");
  };

  async function run() {
    const url = urlEl.value.trim();
    if (!url || url === lastTried) return;
    if (!/^https?:\/\//i.test(url)) return;
    lastTried = url;

    setStatus("이름과 위치를 찾는 중…", "busy");
    const r = await Store.resolveLink(url);

    if (!r || r.error) {
      setStatus(r?.error || "못 찾았어요. 지도에서 찍어주세요.", "bad");
      return;
    }

    const nameEl = $(nameSel), posEl = $(posSel);
    let gotName = false, gotPos = false;

    // 에어비앤비처럼 이름 대신 설명문이 오는 곳이 있어서 걸러냅니다.
    // ("펜션 · 강릉시 · ★5.0 · 침실 1개 · 침대 2개 …" 같은 것)
    const usableName = s =>
      s && s.length <= 25 && !/★/.test(s) && !/\d\s*개/.test(s) &&
      (s.match(/·/g) || []).length < 2;

    if (usableName(r.name) && nameEl && !nameEl.value.trim()) {
      nameEl.value = r.name;
      gotName = true;
    }
    if (r.lat != null && r.lng != null && posEl) {
      posEl.value = `${r.lat}, ${r.lng}`;
      gotPos = true;
      if (maps[mapKey]) maps[mapKey].showPick(r.lat, r.lng);
    }

    const where = r.address ? " — " + r.address : "";
    if (gotName && gotPos)  setStatus("이름과 위치를 넣었어요" + where, "ok");
    else if (gotPos)        setStatus("위치를 넣었어요. 이름은 직접 적어주세요." + where, "ok");
    else if (gotName)       setStatus("이름만 찾았어요. 위치는 지도에서 찍어주세요.", "bad");
    else                    setStatus("위치를 못 찾았어요. 지도에서 찍어주세요.", "bad");
  }

  urlEl.addEventListener("change", run);
  urlEl.addEventListener("blur", run);
  urlEl.addEventListener("paste", () => setTimeout(run, 60));
}

/* ───────── 9. 투표 결과로 경로 짜기 ───────── */
const votesOf = id => state.counts[id] || 0;

function topLodging() {
  const list = allLodgings().filter(d => d.lat != null && d.lng != null);
  if (!list.length) return null;
  return list.reduce((best, d) => (votesOf(d.id) > votesOf(best.id) ? d : best), list[0]);
}

function votedPlaces() {
  return allFoods()
    .filter(f => f.lat != null && f.lng != null && votesOf(f.id) > 0)
    .sort((a, b) => votesOf(b.id) - votesOf(a.id));
}

function renderRoutePreview() {
  const box = $("#route-preview");
  if (!box) return;
  const lod = topLodging();
  const places = votedPlaces();

  if (!lod) {
    box.innerHTML = '<p class="muted">위치가 있는 숙소가 없어요.</p>';
    return;
  }
  box.innerHTML = `
    <div class="route-pick">
      <span class="route-k">숙소</span>
      <strong>${esc(lod.name)}</strong>
      <span class="muted">${votesOf(lod.id)}표${votesOf(lod.id) === 0 ? " · 아직 투표 없음" : " 최다"}</span>
    </div>
    <div class="route-pick">
      <span class="route-k">들를 곳</span>
      ${places.length
        ? places.map(p => `<span class="route-chip">${esc(p.name)} <b>${votesOf(p.id)}</b></span>`).join("")
        : '<span class="muted">맛집 탭에서 투표한 곳이 아직 없어요</span>'}
    </div>`;
}

async function onBuildRoute() {
  const lod = topLodging();
  if (!lod) return toast("위치가 있는 숙소가 없어요");

  const places = votedPlaces();
  if (!places.length) toast("투표된 곳이 없어 숙소만으로 짭니다");

  if (!confirm("지금 일정표를 새로 만듭니다. 적어둔 내용은 사라져요. 계속할까요?")) return;

  const btn = $("#route-build"), note = $("#route-note");
  btn.disabled = true;
  note.className = "muted";
  note.textContent = "이동시간 계산 중…";

  try {
    const st = SPOTS.find(s => s.name === "강릉역") ||
               { name: "강릉역", lat: 37.7637, lng: 128.8990 };
    const res = await buildItinerary({
      lodging: { ...lod, cat: "lodging" },
      places:  places.map(p => ({ ...p })),
      station: { ...st, cat: "hub" },
      trip:    currentItinerary(),
    });

    planDraft = res.itinerary;
    renderPlan(true);
    await savePlan();

    note.textContent = res.real
      ? `실제 주행시간 기준 · 이동 합계 약 ${res.totalMin}분`
      : `길찾기 서버가 응답하지 않아 직선거리로 추정했어요 · 이동 합계 약 ${res.totalMin}분`;
    note.className = res.real ? "muted" : "muted bad";
    toast("일정을 새로 짰어요");
  } catch (err) {
    console.warn("경로 생성 실패", err);
    note.textContent = "경로를 만들지 못했어요. 잠시 후 다시 눌러주세요.";
    note.className = "muted bad";
  } finally {
    btn.disabled = false;
  }
}

/* ───────── 10. 지도에서 위치 찍기 (숙소·맛집 공용) ───────── */
document.addEventListener("click", e => {
  const b = e.target.closest(".btn-pick");
  if (!b) return;
  const m = maps[b.dataset.map];
  const input = $("#" + b.dataset.pick);
  if (!m || !input) return;

  $$(".btn-pick").forEach(x => { x.classList.remove("on"); x.textContent = "지도에서 찍기"; });
  b.classList.add("on");
  b.textContent = "지도를 누르세요";
  m.map.getContainer().scrollIntoView({ behavior: "smooth", block: "center" });

  m.startPick(({ lat, lng }) => {
    input.value = `${lat}, ${lng}`;
    b.classList.remove("on");
    b.textContent = "다시 찍기";
    toast("위치를 찍었어요");
  });
});

/* ───────── 11. 시작 ─────────
   모든 선언이 끝난 뒤에 게이트를 켭니다. (위 initGate 주석 참고) */
initGate();
