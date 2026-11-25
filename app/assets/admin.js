/* ============================================================
   관리자 화면 — 어느 탭을 쓰는지

   ★ 이 페이지는 비밀이 아닙니다.

     주소를 아는 사람은 누구나 열 수 있습니다. GitHub Pages 는 정적
     파일만 주므로 "로그인한 사람에게만 파일을 준다" 가 불가능합니다.

     막는 것은 이 페이지가 아니라 서버입니다. tab_report 가
     app.is_admin() 으로 명단을 확인하고, 명단에 없으면 숫자를 아예
     주지 않습니다. 그래서 남이 이 주소를 열면 "아직 명단에 없어요"
     만 보입니다.

     화면을 숨기는 것으로 보안을 삼지 않는다 — 이 파일에서 지켜야
     할 성질은 그것 하나입니다.

   ★ 전에는 이 내용이 첫 화면 카드 하나로 들어 있었습니다. 방을
     만들러 온 사람에게는 쓸모없는 칸이고, 사장님에게는 너무 좁았습니다.
     따로 떼서 기간도 고르고 표도 볼 수 있게 했습니다.
   ============================================================ */

import { $, $$, esc } from "./dom.js";
import { currentUser, signIn, signOut, sweepPending } from "./auth.js";
import { tabReport, sweepPhotoTrash } from "./store.js";
import { hasBackend } from "./config.js";

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

/* 합계는 시간 단위까지 갑니다 */
function howLongBig(sec) {
  const n = Math.round(sec);
  if (!(n > 0)) return "0초";
  if (n < 3600) return howLong(n);
  const h = Math.floor(n / 3600), m = Math.round((n % 3600) / 60);
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

let days = 30;

function show(id, on) { const el = $(id); if (el) el.hidden = !on; }

function paint(rows) {
  const list = $("#usage-list"), note = $("#usage-note"), body = $("#usage-rows");

  if (!rows.length) {
    list.innerHTML = "";
    body.innerHTML = `<tr><td colspan="5" class="admin-empty">아직 기록이 없어요</td></tr>`;
    note.textContent =
      "통계는 SQL 을 올린 날부터 쌓입니다. 방에 들어가서 탭을 눌러보시면 " +
      "내일부터 여기 나타나요. 이 화면이 보인다는 건 보기 권한은 제대로 들어갔다는 뜻이에요.";
    return;
  }

  const top = Math.max(...rows.map((r) => Number(r.views) || 0), 1);
  const sum = rows.reduce((a, r) => a + (Number(r.views) || 0), 0);
  const since = rows.map((r) => r.first_day).filter(Boolean).sort()[0];

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

  body.innerHTML = rows.map((r) => {
    const n = Number(r.views) || 0;
    const visits = Number(r.visits) || 0;
    const secs = Number(r.seconds) || 0;
    return `
      <tr>
        <th scope="row">${esc(TAB_LABEL[r.tab] || r.tab)}</th>
        <td>${n}</td>
        <td>${visits}</td>
        <td>${visits ? esc(howLong(secs / visits)) : "—"}</td>
        <td>${esc(howLongBig(secs))}</td>
      </tr>`;
  }).join("");

  note.textContent =
    `막대는 본 사람 수예요 (하루 한 번). 옆 숫자는 한 번 들어와서 머문 평균 시간이고요` +
    (since ? ` — ${esc(since)} 부터, 모두 ${sum}` : ` — 모두 ${sum}`) + `.`;
}

async function load() {
  try {
    const rows = await tabReport(days);
    show("#stats", true);
    show("#sweep-card", true);
    show("#not-admin", false);
    paint(Array.isArray(rows) ? rows : []);
    return true;
  } catch (e) {
    /* ★ 왜 안 되는지 그대로 보여줍니다.

       전에는 조용히 사라졌습니다. 그러면 "명단에 없는 건지,
       SQL 을 안 올린 건지, 고장난 건지" 를 구별할 수 없었습니다. */
    show("#stats", false);
    show("#sweep-card", false);
    show("#not-admin", true);
    $("#not-admin-why").textContent =
      (e && e.message) ? `서버가 이렇게 답했어요 — ${e.message}` : "";
    return false;
  }
}

async function boot() {
  sweepPending();

  /* 로그인하고 돌아오면 주소에 ?pending=... 이 붙습니다. 이 화면은
     그 꾸러미를 쓰지 않으므로(방 만들기용입니다) 주소만 치웁니다. */
  if (location.search.includes("pending=")) {
    history.replaceState(null, "", location.pathname);
  }

  if (!hasBackend()) { show("#no-backend", true); return; }

  const me = await currentUser().catch(() => null);
  if (!me) { show("#need-login", true); return; }

  wireRange();
  await load();
}

/* 기간 고르기 */
function wireRange() {
  $$(".admin-range .chip").forEach((b) => {
    b.addEventListener("click", async () => {
      days = Number(b.dataset.days) || 30;
      $$(".admin-range .chip").forEach((x) => x.classList.toggle("on", x === b));
      await load();
    });
  });
}

$("#btn-login").addEventListener("click", async () => {
  const r = await signIn(null).catch(() => null);
  /* 이미 로그인돼 있으면 리다이렉트가 안 일어납니다 — 직접 다시 그립니다 */
  if (r && r.state === "already") location.reload();
});

$("#signout2").addEventListener("click", async () => {
  await signOut().catch(() => {});
  location.reload();
});

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

boot().then(() => { window.__adminReady = true; });
