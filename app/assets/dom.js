/* ============================================================
   dom.js — 화면을 다루는 작은 도구들

   esc 는 원래 map.js 에, 나머지는 app.js 에 있었습니다.
   지도를 갈아끼울 때 esc 가 같이 사라지지 않게 따로 뺐습니다.
   ============================================================ */

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* HTML 에 사람이 넣은 글자를 끼울 때 반드시 통과시킵니다.
   친구가 숙소 이름에 <script> 를 넣어도 글자로만 보이게 합니다. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 아래에서 올라오는 알림.
   #toast 가 없는 페이지(랜딩 등)에서도 터지지 않게 만들어 줍니다. */
let toastTimer;
export function toast(msg) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
}

/* 금액 */
export const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";

/* "2027-01-23" ~ "2027-01-24" → "2027.01.23 – 01.24 · 1박 2일" */
export function fmtRange(start, end) {
  if (!start || !end) return "";
  const md = (s) => s.slice(5).replace("-", ".");
  const nights = Math.max(0, Math.round(
    (new Date(end + "T00:00:00") - new Date(start + "T00:00:00")) / 86400000));
  const tail = nights > 0 ? ` · ${nights}박 ${nights + 1}일` : " · 당일";
  return `${start.slice(0, 4)}.${md(start)} – ${md(end)}${tail}`;
}

/* 날짜 범위를 하루씩 펼칩니다 → [{date, label, dow}]
   route.js 의 N일 일반화와 일정표 뼈대가 이걸 씁니다. */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export function enumerateDays(start, end) {
  const out = [];
  if (!start || !end) return out;
  const a = new Date(start + "T00:00:00"), b = new Date(end + "T00:00:00");
  if (isNaN(a) || isNaN(b) || b < a) return out;

  for (let d = new Date(a), i = 1; d <= b; d.setDate(d.getDate() + 1), i++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date: iso, label: `${i}일차`, dow: DOW[d.getDay()] });
    if (out.length > 15) break;   // 서버에서 14일로 제한하지만 안전장치
  }
  return out;
}

/* 카톡 인앱 브라우저에서도 되는 복사.
   async clipboard API 가 막혀 있어서 두 단계 폴백이 필요합니다.
   돌려주는 값: true(복사됨) / false(직접 선택해야 함) */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* 아래 폴백으로 */ }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);   // iOS
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch (_) {
    return false;
  }
}


/* ------------------------------------------------------------
   파일 하나를 사용자에게 건네기 — 사진과 스토리 카드가 같이 씁니다

   ★ 폰에서는 <a download> 가 사진첩에 안 넣어줍니다. 공유 시트를
     띄워야 "이미지 저장" 이 나옵니다. 그래서 공유를 먼저 시도하고,
     안 되는 데스크톱에서만 내려받기로 갑니다.

   ★ AbortError 는 사용자가 공유 시트를 닫은 것입니다. 그때 내려받기로
     넘어가면, 취소했는데 파일이 떨어집니다. 조용히 끝냅니다.

   돌려주는 값: "shared" | "downloaded" | "cancelled" | "failed"
   ------------------------------------------------------------ */
export async function saveBlob(blob, name) {
  if (!blob) return "failed";

  try {
    const file = new File([blob], name, { type: blob.type || "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled";
    /* 공유가 안 되면 아래 내려받기로 */
  }

  try {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return "downloaded";
  } catch (_) {
    return "failed";
  }
}

/* 폰이면 "저장 · 보내기", 아니면 "저장" — 공유 시트가 뜨는지로 가릅니다 */
export function saveLabel(what) {
  const phone = typeof navigator !== "undefined"
    && navigator.canShare && /iPhone|iPad|Android/i.test(navigator.userAgent || "");
  return phone ? `${what} · 보내기` : `${what} 저장`;
}
