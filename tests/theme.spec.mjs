/* ============================================================
   계절 테마 — 브라우저 테스트

   실행: bash tests/run-browser.sh theme

   ★ 색을 사람이 고르면 대비(가독성)가 쉽게 망가집니다.
     특히 다크 모드는 "어두워 보이기만 하고 글씨가 안 읽히는" 상태가
     되기 쉽고, 만든 사람은 자기 화면에서 잘 보여서 못 알아챕니다.
     그래서 계절 4 × (밝게/어둡게) 여덟 벌의 대비를 실제로 잽니다.

     기준은 WCAG AA:
       본문 글씨 4.5:1 이상
       큰 글씨·UI 요소 3:1 이상
   ============================================================ */

import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE || "http://localhost:8080";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(got === want, `${what}  (받음 ${JSON.stringify(got)})`);

/* ---------- 대비 계산 (WCAG) ---------- */
function parseRgb(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(",").map((x) => parseFloat(x));
  return [r, g, b];
}
function lum([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const A = parseRgb(a), B = parseRgb(b);
  if (!A || !B) return 0;
  const [hi, lo] = [lum(A), lum(B)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SEASONS = ["spring", "summer", "autumn", "winter"];
const browser = await chromium.launch();

for (const scheme of ["light", "dark"]) {
  console.log(`── ${scheme === "light" ? "밝을 때" : "어두울 때"}`);
  const ctx = await browser.newContext({ colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/tests/fixtures/theme.html`);
  await page.waitForFunction(() => window.__ready === true);

  const seen = new Set();

  for (const season of SEASONS) {
    const r = await page.evaluate((s) => {
      window.setTheme(s);
      return {
        bg: window.cs("body", "background-color"),
        text: window.cs("#body-text", "color"),
        muted: window.cs("#muted-text", "color"),
        accent: window.cs("#link", "color"),
        btnBg: window.cs("#primary", "background-color"),
        btnFg: window.cs("#primary", "color"),
        surface: window.tok("--surface"),
        pinRing: window.tok("--pin-ring"),
        labelBg: window.cs("#label", "background-color"),
        labelFg: window.cs("#label", "color"),
        bubbleBg: window.cs("#bubble", "background-color"),
        bubbleFg: window.cs("#bubble", "color"),
      };
    }, season);

    const name = `${season} (${scheme})`;
    seen.add(r.bg);

    const cText = contrast(r.text, r.bg);
    ok(cText >= 4.5, `${name} 본문 대비 ${cText.toFixed(2)}:1 (4.5 이상)`);

    const cMuted = contrast(r.muted, r.bg);
    ok(cMuted >= 4.5, `${name} 흐린 글씨 대비 ${cMuted.toFixed(2)}:1 (4.5 이상)`);

    const cAccent = contrast(r.accent, r.bg);
    ok(cAccent >= 4.5, `${name} 강조색 대비 ${cAccent.toFixed(2)}:1 (4.5 이상)`);

    const cBtn = contrast(r.btnFg, r.btnBg);
    ok(cBtn >= 4.5, `${name} 버튼 글씨 대비 ${cBtn.toFixed(2)}:1 (4.5 이상)`);

    const cLabel = contrast(r.labelFg, r.labelBg);
    ok(cLabel >= 4.5, `${name} 핀 이름표 대비 ${cLabel.toFixed(2)}:1`);

    const cBubble = contrast(r.bubbleFg, r.bubbleBg);
    ok(cBubble >= 4.5, `${name} 말풍선 대비 ${cBubble.toFixed(2)}:1`);

    /* ★ 지도는 다크 모드가 없어서 늘 밝습니다.
       핀 테두리가 어두워지면 밝은 지도 위에서 핀이 사라집니다. */
    eq(r.pinRing, "#ffffff", `${name} 핀 테두리는 흰색 고정 (지도가 늘 밝으므로)`);
  }

  eq(seen.size, 4, `${scheme}: 계절 4개가 서로 다른 배경색`);
  eq(errors.length, 0, `${scheme}: 콘솔 오류 없음`);
  await ctx.close();
}

/* ============================================================
   테마 적용 방식
   ============================================================ */
console.log("── 테마 적용");
{
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/tests/fixtures/theme.html`);
  await page.waitForFunction(() => window.__ready === true);

  const noAttr = await page.evaluate(() => {
    window.setTheme(null);
    return window.cs("body", "background-color");
  });
  const summer = await page.evaluate(() => {
    window.setTheme("summer");
    return window.cs("body", "background-color");
  });
  eq(noAttr, summer, "data-theme 이 없으면 여름이 기본");

  const unknown = await page.evaluate(() => {
    window.setTheme("없는계절");
    return window.cs("body", "background-color");
  });
  eq(unknown, summer, "모르는 테마 이름이면 기본값으로 (화면이 깨지지 않음)");

  /* 날짜로 계절 추천 */
  const picks = await page.evaluate(() => [
    window.seasonFor("2027-04-10"), window.seasonFor("2027-07-02"),
    window.seasonFor("2027-10-09"), window.seasonFor("2027-01-23"),
  ]);
  eq(picks.join(","), "spring,summer,autumn,winter", "날짜로 계절을 추천");

  const themeKeys = await page.evaluate(() => window.THEMES.map((t) => t.key).join(","));
  eq(themeKeys, "spring,summer,autumn,winter", "고를 수 있는 테마 4개");

  /* CSS 에 네 계절이 다 정의돼 있는지 — THEMES 와 CSS 가 어긋나면
     목록에는 있는데 눌러도 안 바뀌는 테마가 생깁니다 */
  const defined = await page.evaluate(async () => {
    const css = await (await fetch("/app/assets/style.css")).text();
    return ["spring", "summer", "autumn", "winter"]
      .filter((s) => css.includes(`[data-theme="${s}"]`));
  });
  eq(defined.join(","), "spring,summer,autumn,winter", "CSS 에 네 계절이 모두 정의됨");

  await ctx.close();
}

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
