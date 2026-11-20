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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8080";

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

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
  /* 이 루프는 두 기기 설정에서 각각 도는데, 아래 묶음이
     "두 번 다 같은 값이 나오는지"를 따로 확인합니다 */
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

/* ============================================================
   네 계절 모두 기기 설정과 무관하게 같은 모습

   ★ 여행방은 여럿이 같이 보는 화면입니다.
     예전에는 밝게/어둡게를 기기 설정이 정했는데, 카톡 인앱
     브라우저가 어두운 모드를 보고하지 않아서 같은 폰에서도
     카톡으로 열면 밝고 사파리로 열면 어두웠습니다. 친구마다
     전혀 다른 화면을 보게 됩니다.

     그래서 계절이 밝기까지 정합니다 — 봄·여름·가을은 늘 밝고
     겨울은 늘 어둡습니다. 이 테스트가 그걸 고정합니다.
   ============================================================ */
console.log("── 기기 설정과 무관하게 같은 화면");
{
  const read = async (scheme, theme) => {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/tests/fixtures/theme.html`);
    await page.waitForFunction(() => window.__ready === true);
    const r = await page.evaluate((t) => {
      window.setTheme(t);
      return {
        bg: window.cs("body", "background-color"),
        text: window.cs("#body-text", "color"),
        scheme: window.tok("--on-dark"),
      };
    }, theme);
    await ctx.close();
    return r;
  };

  /* ★ 핵심: 어떤 계절이든 밝은 기기와 어두운 기기에서 똑같아야 합니다.
     하나라도 달라지면 카톡으로 연 친구와 사파리로 연 친구가
     다른 화면을 보게 됩니다. */
  for (const season of SEASONS) {
    const a = await read("light", season);
    const b = await read("dark", season);
    eq(a.bg, b.bg, `${season} — 기기 설정이 달라도 배경이 같다`);
    eq(a.text, b.text, `${season} — 기기 설정이 달라도 글자색이 같다`);
  }

  /* 봄·여름·가을은 밝고, 겨울은 어둡다 */
  for (const season of ["spring", "summer", "autumn"]) {
    const r = await read("dark", season);
    ok(lum(parseRgb(r.bg)) > 0.7,
      `${season} 은 어두운 기기에서도 밝다  (${r.bg})`);
  }
  const wD = await read("dark", "winter");
  const wL = await read("light", "winter");
  ok(lum(parseRgb(wL.bg)) < 0.1, `겨울은 밝은 기기에서도 어둡다  (${wL.bg})`);
  ok(contrast(wL.text, wL.bg) >= 4.5,
    `겨울(밝은 기기) 본문 대비 ${contrast(wL.text, wL.bg).toFixed(2)}:1`);

  /* CSS 에 기기 설정을 보는 규칙이 아예 없어야 합니다 —
     하나라도 남아 있으면 그 계절만 조용히 둘로 갈라집니다 */
  const cssSrc = readFileSync(join(HERE, "..", "app", "assets", "style.css"), "utf8");
  const mediaRules = cssSrc.match(/@media[^{]*prefers-color-scheme[^{]*\{/g) || [];
  eq(mediaRules.length, 0, "CSS 에 prefers-color-scheme 규칙이 없다");

  /* 고를 때 보이는 색 견본도 어두워야 합니다 — 아니면 고른 것과 다른 게 나옵니다 */
  const css = readFileSync(join(HERE, "..", "app", "assets", "style.css"), "utf8");
  const sw = css.match(/\.swatch-winter\{background:(#[0-9a-f]{6})/i);
  ok(sw && lum(hexToRgb(sw[1])) < 0.15,
    `겨울 색 견본도 어둡다  (${sw ? sw[1] : "못 찾음"})`);
}

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
