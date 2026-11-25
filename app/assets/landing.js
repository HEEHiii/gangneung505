/* ============================================================
   landing.js — 첫 화면

   하는 일
     1. 폼을 채우고 검증
     2. (서버 모드면) 방장 로그인 — ★ 폼을 다 채운 뒤에
     3. 방 만들기 → 공유 링크

   ★ 로그인 벽의 위치가 중요합니다.
     제출 버튼 앞에서 사용자는 이미 날짜·지역·인원을 넣었습니다.
     그 자리의 로그인은 "형식 절차"로 읽히고,
     페이지를 열자마자 세우면 "통행료"로 읽혀서 그냥 나갑니다.
   ============================================================ */

import { REGIONS, regionByCode, seasonFor, THEMES } from "./regions.js";
import { $, $$, esc, toast, fmtRange, copyText, enumerateDays } from "./dom.js";
import { hasBackend, hasMap, roomUrl, KAKAO_JS_KEY, loginName } from "./config.js";
import { loadKakao, kakaoReady } from "./kakaomap.js";
import { searchByKeyword, findHub } from "./places.js";
import { currentUser, signIn, readReturn, sweepPending, signOut } from "./auth.js";
import { createRoom, listMyRooms, tabReport, sweepPhotoTrash } from "./store.js";
import { rememberRoom, recentRooms } from "./session.js";

/* 직접 검색으로 고른 곳 (지역 목록에 없는 경우) */
let custom = null;        // { name, lat, lng }
let busy = false;

/* ★ "지도를 쓸 수 있나"의 기준
   설정 키가 있는지가 아니라 SDK 가 실제로 준비됐는지로 판단합니다.
   키는 있는데 도메인 등록이 안 돼 로딩이 실패할 수도 있고, 반대로
   테스트처럼 SDK 가 이미 올라와 있을 수도 있습니다.
   hasMap() 은 처음 안내 문구에만 쓰고, 동작은 이 함수로 가릅니다. */
async function ensureMap() {
  if (kakaoReady()) return true;
  if (!hasMap()) return false;
  return await loadKakao(KAKAO_JS_KEY);
}

/* ============================================================
   폼 채우기
   ============================================================ */
function fillRegions() {
  const sel = $("#f-region");
  sel.innerHTML =
    REGIONS.map((r) => `<option value="${esc(r.code)}">${esc(r.name)}</option>`).join("") +
    `<option value="__custom">그 밖의 지역 — 직접 검색</option>`;
  sel.value = "gangneung";
}

function fillThemes() {
  $("#f-theme").innerHTML = THEMES.map((t) => `
    <label class="theme-opt">
      <input type="radio" name="theme" value="${esc(t.key)}">
      <span class="swatch swatch-${esc(t.key)}"></span>
      <span>${esc(t.label)}</span>
    </label>`).join("");
}

function setTheme(key) {
  const k = THEMES.some((t) => t.key === key) ? key : "summer";
  document.documentElement.setAttribute("data-theme", k);
  const input = $(`#f-theme input[value="${k}"]`);
  if (input) input.checked = true;
}

function defaultDates() {
  // 다음 주 토요일 1박 2일을 기본으로 — 대부분의 여행이 그 모양입니다
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  const iso = (x) => x.toISOString().slice(0, 10);
  const end = new Date(d); end.setDate(end.getDate() + 1);
  return { start: iso(d), end: iso(end) };
}

function updateNights() {
  const s = $("#f-start").value, e = $("#f-end").value;
  const note = $("#nights-note");
  if (!s || !e) { note.textContent = ""; return; }
  const days = enumerateDays(s, e);
  if (!days.length) {
    note.textContent = "도착일이 출발일보다 빨라요.";
    note.classList.add("bad");
    return;
  }
  note.classList.remove("bad");
  /* ★ 날짜 전체가 아니라 밤 수만 적습니다.
     바로 위 두 칸에 날짜가 이미 있는데 그 아래 또 쓰면 같은 말을
     두 번 하는 것이고, 한 줄을 통째로 더 먹습니다. */
  note.textContent = days.length > 15
    ? "너무 길어요 (최대 15일)"
    : `${days.length - 1}박 ${days.length}일`;
  if (days.length > 15) note.classList.add("bad");
  // 날짜가 바뀌면 계절도 따라갑니다 (아직 손대지 않았을 때만)
  if (!$("#f-theme").dataset.touched) setTheme(seasonFor(s));
}


/* ============================================================
   지역 — 목록에 없으면 검색해서 좌표를 잡습니다

   ★ 좌표 없는 지역은 빈 지도를 만듭니다.
     카카오 장소 검색은 중심이나 범위가 있어야 하므로,
     "직접 검색" 방은 만들 때 좌표를 반드시 확보해야 합니다.
   ============================================================ */
function onRegionChange() {
  const isCustom = $("#f-region").value === "__custom";
  $("#custom-wrap").hidden = !isCustom;
  if (!isCustom) { custom = null; return; }

  ensureMap().then((can) => {
    if (can) return;
    $("#custom-note").textContent =
      "지도 키가 없어서 직접 검색은 아직 쓸 수 없어요. 목록에서 골라주세요.";
    $("#custom-note").classList.add("bad");
  });
}

async function runCustomSearch() {
  const q = $("#f-custom").value.trim();
  const note = $("#custom-note");
  const list = $("#custom-hits");

  if (!q) { note.textContent = "찾을 곳 이름을 넣어주세요."; return; }

  note.classList.remove("bad");
  note.textContent = "찾는 중…";
  list.hidden = true;

  try {
    if (!await ensureMap()) {
      note.classList.add("bad");
      note.textContent = "지도 키가 없어서 직접 검색은 아직 쓸 수 없어요. 목록에서 골라주세요.";
      return;
    }
    const hits = await searchByKeyword(q, { size: 8 });
    if (!hits.length) {
      note.textContent = "못 찾았어요. 다른 이름으로 찾아보세요.";
      return;
    }
    note.textContent = "맞는 곳을 골라주세요.";
    list.hidden = false;
    list.innerHTML = hits.map((h, i) => `
      <li><button type="button" data-i="${i}">
        <strong>${esc(h.name)}</strong>
        <span>${esc(h.address || "")}</span>
      </button></li>`).join("");
    list.dataset.hits = JSON.stringify(hits.map((h) => ({ name: h.name, lat: h.lat, lng: h.lng })));
  } catch (e) {
    note.classList.add("bad");
    note.textContent = e.message || "검색이 안 됐어요.";
  }
}

function onCustomPick(e) {
  const btn = e.target.closest("button[data-i]");
  if (!btn) return;
  const hits = JSON.parse($("#custom-hits").dataset.hits || "[]");
  custom = hits[Number(btn.dataset.i)];
  if (!custom) return;
  $("#custom-hits").hidden = true;
  $("#f-custom").value = custom.name;
  const note = $("#custom-note");
  note.classList.remove("bad");
  note.textContent = `"${custom.name}" 주변으로 지도를 엽니다.`;
}


/* ============================================================
   검증 — ★ 로그인으로 보내기 전에 전부 끝냅니다

   카카오를 다 돌고 와서 "날짜가 거꾸로입니다"를 알려주는 일은
   없어야 합니다. 사용자는 이미 한참 걸어왔습니다.
   ============================================================ */
function readForm() {
  const err = (m) => { throw new Error(m); };

  const title = $("#f-title").value.trim();
  if (!title) err("여행 이름을 적어주세요.");
  if (title.length > 30) err("여행 이름이 너무 길어요.");

  const start = $("#f-start").value, end = $("#f-end").value;
  if (!start || !end) err("날짜를 골라주세요.");
  const days = enumerateDays(start, end);
  if (!days.length) err("도착일이 출발일보다 빠를 수 없어요.");
  if (days.length > 15) err("한 번에 15일까지 만들 수 있어요.");

  const people = Number($("#f-people").value);
  if (!Number.isInteger(people) || people < 1 || people > 30) {
    err("인원은 1~30명으로 넣어주세요.");
  }

  const code = $("#f-region").value;
  let regionCode = null, regionName = "", center = null, mapLevel = 8;

  if (code === "__custom") {
    if (!custom) err("갈 곳을 검색해서 골라주세요.");
    regionName = custom.name;
    center = [custom.lat, custom.lng];
    mapLevel = 7;
  } else {
    const r = regionByCode(code);
    if (!r) err("지역을 골라주세요.");
    regionCode = r.code; regionName = r.name;
    center = r.center; mapLevel = r.level;
  }

  const pw = $("#f-pw").value, pw2 = $("#f-pw2").value;
  if (pw.length < 4) err("비밀번호는 4자 이상으로 해주세요.");
  if (pw.length > 20) err("비밀번호가 너무 길어요.");
  if (pw !== pw2) err("비밀번호 두 개가 서로 달라요.");

  const theme = ($("#f-theme input:checked") || {}).value || seasonFor(start);

  return { title, start, end, people, regionCode, regionName, center, mapLevel, password: pw, theme };
}


/* ============================================================
   방 만들기
   ============================================================ */
async function make(form) {
  if (busy) return;
  busy = true;
  const btn = $("#btn-make");
  btn.disabled = true;
  btn.textContent = "만드는 중…";

  try {
    // 출발 지점은 좌표를 적지 않고 이름으로 찾습니다
    let hub = null;
    const region = form.regionCode ? regionByCode(form.regionCode) : null;
    if (region) {
      try {
        if (await ensureMap()) hub = await findHub(region);
      } catch (_) { /* 없으면 일정이 숙소부터 시작합니다 */ }
    }

    const made = await createRoom({ ...form, hub });
    rememberRoom(made.slug, form.title);
    showDone(made.slug, form);
  } catch (e) {
    showError(e.message || "방을 만들지 못했어요.");
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = "방 만들기";
  }
}

function showError(msg) {
  const el = $("#form-error");
  el.textContent = msg;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}

function showDone(slug, form) {
  const url = roomUrl(slug);
  $("#make").hidden = true;
  $("#mine").hidden = true;
  $("#done").hidden = false;
  $("#done-title").textContent = `${form.title} · ${fmtRange(form.start, form.end)}`;
  $("#share-url").value = url;
  $("#btn-enter").href = url;
  $("#done").scrollIntoView({ block: "start", behavior: "smooth" });
}


/* ============================================================
   내 방 목록
   ============================================================ */
async function showMyRooms() {
  const box = $("#mine"), list = $("#room-list"), note = $("#mine-note");

  let rooms = [];
  let fromServer = false;
  try {
    const me = await currentUser();
    if (me) { rooms = await listMyRooms(); fromServer = true; }
  } catch (_) { /* 아래에서 최근 목록으로 */ }

  if (!fromServer) {
    rooms = recentRooms().map((r) => ({ slug: r.slug, title: r.title, recent: true }));
  }

  /* ★ 로그아웃은 "서버에 로그인한 상태"일 때만 의미가 있습니다.
     이 브라우저에서 열어본 방 목록은 로그인과 무관하므로,
     그때 로그아웃 버튼을 보여주면 눌러도 아무 일이 안 일어납니다. */
  $("#signout").hidden = !fromServer;

  if (!rooms.length) {
    // 로그인은 했는데 만든 방이 없는 경우 — 나갈 길은 남겨둡니다
    box.hidden = !fromServer;
    list.innerHTML = "";
    note.textContent = fromServer ? "아직 만든 방이 없어요." : "";
    return;
  }

  box.hidden = false;
  list.innerHTML = rooms.map((r) => `
    <li>
      <a href="${esc(roomUrl(r.slug))}">
        <strong>${esc(r.title || "이름 없는 여행")}</strong>
        ${r.start_date ? `<span>${esc(fmtRange(r.start_date, r.end_date))}</span>` : ""}
        ${r.region_name ? `<span class="tag">${esc(r.region_name)}</span>` : ""}
      </a>
    </li>`).join("");

  note.textContent = fromServer
    ? "카카오 계정으로 만든 방이에요. 비밀번호를 잊어도 여기로 들어올 수 있어요."
    : "이 브라우저에서 열어본 방이에요.";
}


/* ============================================================
   어느 탭을 쓰는지 — 방을 만든 사람에게만 보입니다

   ★ 0010 마이그레이션을 안 돌렸으면 이 칸이 아예 안 뜹니다.
     없는 기능을 "오류"로 보여줄 이유가 없습니다.

   ★ 숫자를 읽는 법은 화면에 같이 적어둡니다. "정산 12" 를
     혼자 보면 많은 건지 적은 건지 알 수 없고, 사람이 적을 때
     이 숫자로 기능을 지우는 판단을 하면 거의 틀립니다.
   ============================================================ */
const TAB_LABEL = {
  stay: "숙소", food: "맛집", plan: "일정", money: "정산", photo: "사진",
};

/* "42초" / "3분 10초" — 평균이라 초를 버리면 짧은 탭끼리 구별이 안 됩니다 */
function howLong(sec) {
  const n = Math.round(sec);
  if (!(n > 0)) return "";
  if (n < 60) return `${n}초`;
  const m = Math.floor(n / 60), r = n % 60;
  return r ? `${m}분 ${r}초` : `${m}분`;
}

async function showUsage() {
  const box = $("#usage"), list = $("#usage-list"), note = $("#usage-note");

  let rows = [];
  try {
    const me = await currentUser();
    if (!me) return;                 // 로그인 안 했으면 보여주지 않습니다
    rows = await tabReport(90);
  } catch (_) { return; }            // 명단에 없거나 함수가 없으면 조용히

  /* ★ 여기서 그냥 return 하면 안 됩니다.

     통계는 SQL 을 올린 날부터 쌓입니다. 올린 직후에는 줄이 0개라
     칸이 통째로 사라지는데, 그러면 "명단에 안 들어갔나? 고장났나?
     그냥 아직 없는 건가?" 를 구별할 길이 없습니다.

     tab_report 가 예외 없이 돌아왔다는 건 이미 "명단에 있다" 는
     뜻입니다. 그러니 칸은 띄우고, 비었다고 말해줍니다.
     칸이 보이면 권한은 통과한 것입니다. */
  if (!Array.isArray(rows)) rows = [];

  if (!rows.length) {
    box.hidden = false;
    list.innerHTML = "";
    note.textContent =
      "아직 기록이 없어요. 통계는 SQL 을 올린 날부터 쌓입니다 — " +
      "방에 들어가서 탭을 눌러보시면 내일부터 여기 나타나요. " +
      "이 칸이 보인다는 건 보기 권한은 제대로 들어갔다는 뜻이에요.";
    return;
  }

  const top = Math.max(...rows.map((r) => Number(r.views) || 0), 1);
  const sum = rows.reduce((a, r) => a + (Number(r.views) || 0), 0);
  const since = rows
    .map((r) => r.first_day).filter(Boolean).sort()[0];

  box.hidden = false;
  list.innerHTML = rows.map((r) => {
    const n = Number(r.views) || 0;
    const pct = Math.round((n / top) * 100);
    const visits = Number(r.visits) || 0;
    const secs = Number(r.seconds) || 0;
    /* ★ 합계가 아니라 평균을 보여줍니다. 합계는 사람이 많은 탭이
       무조건 이겨서, "이 탭에서 뭘 하다 가는가" 를 못 봅니다. */
    const avg = visits ? howLong(secs / visits) : "";
    return `
      <li>
        <span class="usage-name">${esc(TAB_LABEL[r.tab] || r.tab)}</span>
        <span class="usage-bar"><span style="width:${pct}%"></span></span>
        <span class="usage-num">${n}${avg ? ` · ${esc(avg)}` : ""}</span>
      </li>`;
  }).join("");

  note.textContent =
    `왼쪽 숫자는 본 사람(하루 한 번), 오른쪽은 한 번 들어와서 머문 평균 시간이에요` +
    (since ? ` (${esc(since)} 부터, 모두 ${sum})` : ` (모두 ${sum})`) +
    `. 방이나 사람은 기록하지 않아요.`;
}


/* ============================================================
   시작
   ============================================================ */
async function boot() {
  sweepPending();
  fillRegions();
  fillThemes();

  const d = defaultDates();
  $("#f-start").value = d.start;
  $("#f-end").value = d.end;
  setTheme(seasonFor(d.start));
  updateNights();
  onRegionChange();   // "장소 검색" 영역의 처음 상태를 확실히 맞춥니다

  /* 설정 상태를 솔직하게 알려줍니다 */
  const bits = [];
  if (!hasBackend()) bits.push("지금은 <strong>이 브라우저에만</strong> 저장돼요 (친구와 합쳐지지 않아요)");
  if (!hasMap()) bits.push("지도 키가 없어 <strong>지도 없이</strong> 동작해요");
  $("#mode-note").innerHTML = bits.join(" · ");
  $("#login-note").innerHTML = hasBackend()
    ? `방을 만들 때 <strong>${loginName()} 로그인</strong>을 한 번 합니다. 친구들은 로그인하지 않아요.`
    : "";

  /* 이벤트 */
  $("#f-start").addEventListener("change", () => {
    // 출발일을 도착일보다 뒤로 옮기면 도착일도 같이 밀어줍니다
    if ($("#f-end").value && $("#f-end").value < $("#f-start").value) {
      $("#f-end").value = $("#f-start").value;
    }
    updateNights();
  });
  $("#f-end").addEventListener("change", updateNights);
  $("#f-region").addEventListener("change", onRegionChange);
  $("#btn-custom").addEventListener("click", runCustomSearch);
  $("#f-custom").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runCustomSearch(); }
  });
  $("#custom-hits").addEventListener("click", onCustomPick);
  $("#f-theme").addEventListener("change", (e) => {
    $("#f-theme").dataset.touched = "1";
    setTheme(e.target.value);
  });

  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#form-error").textContent = "";

    let form;
    try { form = readForm(); }
    catch (err) { return showError(err.message); }

    // 로컬 모드면 로그인 없이 바로
    if (!hasBackend()) return make(form);

    const r = await signIn(form);
    if (r.state === "sent") return;             // 카카오로 떠났습니다
    if (r.state === "error") return showError(r.message);
    return make(form);                           // already / off
  });

  $("#btn-copy").addEventListener("click", async () => {
    const url = $("#share-url").value;
    if (await copyText(url)) toast("링크를 복사했어요");
    else {
      $("#share-url").select();
      toast("길게 눌러 복사해주세요");
    }
  });

  $("#btn-again").addEventListener("click", () => {
    $("#done").hidden = true;
    $("#make").hidden = false;
    $("#f-title").value = "";
    $("#f-pw").value = "";
    $("#f-pw2").value = "";
    showMyRooms();
    $("#make").scrollIntoView({ block: "start", behavior: "smooth" });
  });

  /* ---------- 카카오에서 돌아왔나 ---------- */
  const { form, partial } = readReturn();
  if (form) {
    setTheme(form.theme || seasonFor(form.start));
    await make(form);
  } else if (partial) {
    // 꾸러미를 못 찾았습니다 — 비밀 아닌 값만 되채우고 비밀번호만 다시 받습니다.
    // 로그인은 이미 끝났으니 두 번째 제출은 바로 완료됩니다.
    if (partial.start) $("#f-start").value = partial.start;
    if (partial.end) $("#f-end").value = partial.end;
    if (partial.people) $("#f-people").value = partial.people;
    if (partial.regionCode) { $("#f-region").value = partial.regionCode; onRegionChange(); }
    if (partial.theme) setTheme(partial.theme);
    updateNights();
    showError("비밀번호만 다시 넣어주세요. 로그인은 끝났어요.");
    $("#f-pw").focus();
  }

  /* 로그아웃 — 다른 계정으로 들어가 볼 때도 씁니다.
     주소(?login=…)는 그대로 두고 새로고침하므로, 로그아웃한 뒤
     바로 그 수단으로 다시 로그인하게 됩니다. */
  $("#signout").addEventListener("click", async () => {
    await signOut();
    location.reload();
  });

  /* 지운 사진 파일 치우기 — 통계 칸 안에 있으므로 관리자만 봅니다.

     ★ 평소에는 누를 일이 없습니다. 사진을 지우면 그 자리에서 파일도
       함께 지워집니다. 이 버튼은 방 삭제나 카카오 탈퇴처럼 우리가
       끼어들 수 없었던 경우에 남은 파일을 치우는 용도입니다. */
  $("#sweep").addEventListener("click", async () => {
    const btn = $("#sweep"), note = $("#sweep-note");
    btn.disabled = true;
    note.textContent = "정리하는 중…";
    try {
      const got = await sweepPhotoTrash();
      note.textContent = got.removed
        ? `파일 ${got.removed}개를 지웠어요. 더 있으면 한 번 더 눌러주세요.`
        : "치울 파일이 없어요. 깨끗합니다.";
    } catch (e) {
      note.textContent = (e && e.message) || "정리하지 못했어요.";
    } finally {
      btn.disabled = false;
    }
  });

  showMyRooms();
  showUsage();            // 방장에게만, 실패하면 조용히 사라집니다
  window.__landingReady = true;
}

boot();
