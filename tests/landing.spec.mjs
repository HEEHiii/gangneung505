/* ============================================================
   첫 화면 — 브라우저 테스트

   실행: bash tests/run-browser.sh landing

   config.js 를 테스트가 갈아끼워 "이 브라우저에만 저장" 모드로 돕니다
   (→ tests/stub-config.mjs). 진짜 키가 채워져 있어도 결과가 같습니다.
   그래서 카카오 로그인 없이 방 만들기 흐름 전체를 확인할 수 있습니다.
   ============================================================ */

import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SUPABASE, stubConfig } from "./stub-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8080";
const STUB = readFileSync(join(HERE, "kakao-stub.js"), "utf8");

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(got === want, `${what}  (받음 ${JSON.stringify(got)})`);

const browser = await chromium.launch();

async function open(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 900 },
    colorScheme: opts.scheme || "light",
  });
  /* 진짜 config.js 대신 테스트가 정한 값을 씁니다 (기본: 전부 비움).
     이게 없으면 사장님이 키를 넣는 순간 테스트가 깨집니다. */
  await stubConfig(ctx, opts.config);
  if (opts.kakao) {
    await ctx.addInitScript({ content: STUB });
    await ctx.addInitScript({
      content: `window.__stubPlaces = ${JSON.stringify(opts.kakao)};`,
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // 글꼴 CDN 은 이 컨테이너에서 막혀 있습니다 (사용자 브라우저에서는 됩니다)
    if (m.type() === "error" && !/ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${BASE}/app/index.html`);
  await page.waitForFunction(() => window.__landingReady === true, { timeout: 10000 });
  return { ctx, page, errors };
}

async function fill(page, v = {}) {
  await page.fill("#f-title", v.title ?? "겨울 강릉");
  await page.fill("#f-start", v.start ?? "2027-01-23");
  await page.fill("#f-end", v.end ?? "2027-01-24");
  await page.fill("#f-people", String(v.people ?? 4));
  if (v.region) await page.selectOption("#f-region", v.region);
  await page.fill("#f-pw", v.pw ?? "0505");
  await page.fill("#f-pw2", v.pw2 ?? v.pw ?? "0505");
}

const err = (page) => page.locator("#form-error").textContent();

/* ============================================================
   1. 처음 열었을 때
   ============================================================ */
{
  console.log("── 처음 열었을 때");
  const { ctx, page, errors } = await open();

  ok(await page.locator(".hero-title").isVisible(), "제목이 보임");
  eq(await page.locator(".hero-title").textContent(), "친구들과 여행계획을 짜보세요", "제목 문구");

  /* ★ 숨겨둔 영역이 실제로 숨어 있는지.
     [hidden] 의 display:none 은 브라우저 기본 규칙이라 .field{display:block}
     같은 우리 규칙에 밀립니다. 실제로 "장소 검색" 상자가 늘 떠 있었습니다. */
  eq(await page.locator("#custom-wrap").isVisible(), false, "'장소 검색'은 처음엔 숨어 있음");
  eq(await page.locator("#done").isVisible(), false, "완료 화면도 숨어 있음");

  eq(await page.locator("#f-region").inputValue(), "gangneung", "지역 기본값은 강릉");
  eq(await page.locator("#f-people").inputValue(), "4", "인원 기본값 4명");

  const opts = await page.locator("#f-region option").count();
  eq(opts, 21, "지역 20곳 + '직접 검색'");

  ok((await page.locator("#mode-note").textContent()).includes("이 브라우저에만"),
    "설정이 없으면 솔직하게 알려줌");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

/* ============================================================
   2. 날짜 → 계절 추천
   ============================================================ */
{
  console.log("── 날짜에 맞춘 테마");
  const { ctx, page } = await open();

  const theme = async () => page.getAttribute("html", "data-theme");

  await page.fill("#f-start", "2027-01-23");
  await page.dispatchEvent("#f-start", "change");
  eq(await theme(), "winter", "1월 → 겨울");

  await page.fill("#f-start", "2027-07-15");
  await page.dispatchEvent("#f-start", "change");
  eq(await theme(), "summer", "7월 → 여름");

  await page.fill("#f-start", "2027-10-09");
  await page.dispatchEvent("#f-start", "change");
  eq(await theme(), "autumn", "10월 → 가을");

  /* 직접 고른 뒤에는 날짜가 바뀌어도 건드리지 않습니다.
     라디오 버튼은 눈에 안 보이게 숨겨두고 라벨을 누르게 돼 있습니다
     (실제 사용자도 라벨을 누릅니다). */
  await page.click('#f-theme .theme-opt:has(input[value="spring"])');
  eq(await theme(), "spring", "직접 고르면 그대로 적용");
  await page.fill("#f-start", "2027-12-20");
  await page.dispatchEvent("#f-start", "change");
  eq(await theme(), "spring", "직접 고른 뒤에는 날짜가 바뀌어도 유지");

  await ctx.close();
}

/* ============================================================
   3. 검증 — ★ 로그인으로 보내기 전에 전부 걸러야 합니다
   ============================================================ */
{
  console.log("── 입력 검증");
  const { ctx, page } = await open();

  await fill(page, { title: "" });
  await page.click("#btn-make");
  ok((await err(page)).includes("여행 이름"), "이름이 비면 막음");

  await fill(page, { start: "2027-01-24", end: "2027-01-23" });
  await page.click("#btn-make");
  ok((await err(page)).includes("빠를 수 없"), "도착일이 더 빠르면 막음");

  await fill(page, { start: "2027-01-01", end: "2027-02-01" });
  await page.click("#btn-make");
  ok((await err(page)).includes("15일"), "너무 긴 여행은 막음");

  await fill(page, { people: 0 });
  await page.click("#btn-make");
  ok((await err(page)).includes("인원"), "인원 0명은 막음");

  await fill(page, { people: 99 });
  await page.click("#btn-make");
  ok((await err(page)).includes("인원"), "인원 99명은 막음");

  await fill(page, { pw: "12" });
  await page.click("#btn-make");
  ok((await err(page)).includes("4자"), "짧은 비밀번호는 막음");

  await fill(page, { pw: "0505", pw2: "0506" });
  await page.click("#btn-make");
  ok((await err(page)).includes("서로 달라"), "비밀번호 두 개가 다르면 막음");

  eq(await page.locator("#done").isVisible(), false, "검증에 걸리면 방이 만들어지지 않음");
  await ctx.close();
}

/* ============================================================
   4. 방 만들기 성공
   ============================================================ */
let madeUrl = "";
{
  console.log("── 방 만들기");
  const { ctx, page, errors } = await open();

  await fill(page);
  await page.click("#btn-make");
  await page.waitForSelector("#done:not([hidden])", { timeout: 5000 });

  eq(await page.locator("#make").isVisible(), false, "폼이 사라짐");
  ok((await page.locator("#done-title").textContent()).includes("겨울 강릉"), "여행 이름 표시");
  ok((await page.locator("#done-title").textContent()).includes("1박 2일"), "기간 표시");

  madeUrl = await page.locator("#share-url").inputValue();
  ok(/\/app\/room\.html\?r=[23456789BCDFGHJKMNPQRSTVWXZ]{9}$/.test(madeUrl),
    `공유 링크 모양 (…${madeUrl.slice(-22)})`);

  eq(await page.locator("#share-url").getAttribute("readonly"), "",
    "링크 칸은 읽기 전용 (실수로 고치지 않게)");

  /* ★ 비밀번호를 링크와 함께 보내지 말라는 경고가 반드시 있어야 합니다.
     한 메시지에 같이 보내면 비밀번호가 사실상 없는 것과 같습니다. */
  ok((await page.locator(".note.warn").textContent()).includes("따로"),
    "비밀번호를 링크와 따로 보내라고 경고");

  eq(await page.locator("#btn-enter").getAttribute("href"), madeUrl, "'들어가기'가 같은 링크");

  /* 다시 만들기 */
  await page.click("#btn-again");
  eq(await page.locator("#make").isVisible(), true, "'또 만들기'로 폼 복귀");
  eq(await page.locator("#f-title").inputValue(), "", "이름이 비워짐");
  eq(await page.locator("#f-pw").inputValue(), "", "비밀번호도 비워짐 (남겨두면 위험)");

  /* 내 방 목록 */
  await page.waitForSelector("#mine:not([hidden])", { timeout: 3000 });
  const n = await page.locator("#room-list li").count();
  eq(n, 1, "만든 방이 목록에 뜸");
  ok((await page.locator("#room-list").textContent()).includes("겨울 강릉"), "목록에 이름");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

/* ============================================================
   5. 목록에 없는 지역 — 좌표를 반드시 잡아야 합니다

   ★ 좌표 없이 방을 만들면 지도가 빈 바다에서 열리고
     장소 검색도 기준점이 없어 엉뚱한 결과가 나옵니다.
   ============================================================ */
{
  console.log("── 직접 검색한 지역");
  const { ctx, page } = await open({
    kakao: { keyword: { "죽녹원": [{
      id: "d1", place_name: "죽녹원", x: "126.9880", y: "35.3280",
      road_address_name: "담양군 담양읍", category_group_code: "AT4",
    }] } },
  });

  await fill(page, { region: "__custom" });
  eq(await page.locator("#custom-wrap").isVisible(), true, "'직접 검색'을 고르면 검색칸이 나타남");

  await page.click("#btn-make");
  ok((await err(page)).includes("검색해서 골라"), "고르지 않으면 막음");

  await page.fill("#f-custom", "죽녹원");
  await page.click("#btn-custom");
  await page.waitForSelector("#custom-hits:not([hidden])", { timeout: 4000 });
  eq(await page.locator("#custom-hits li").count(), 1, "검색 결과가 나옴");

  await page.click("#custom-hits button");
  ok((await page.locator("#custom-note").textContent()).includes("죽녹원"), "고른 곳을 알려줌");

  await page.click("#btn-make");
  await page.waitForSelector("#done:not([hidden])", { timeout: 5000 });
  ok((await page.locator("#done-title").textContent()).includes("겨울 강릉"), "방이 만들어짐");

  /* 저장된 방에 좌표가 들어갔는지 */
  const saved = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("trip.local.")) return JSON.parse(localStorage.getItem(k)).room;
    }
    return null;
  });
  eq(saved.region_name, "죽녹원", "검색해서 고른 이름이 지역명이 됨");
  ok(Math.abs(saved.center[0] - 35.328) < 1e-3, "위도가 저장됨");
  ok(Math.abs(saved.center[1] - 126.988) < 1e-3, "경도가 저장됨");
  eq(saved.region_code, null, "큐레이션 지역이 아니므로 code 는 없음");

  await ctx.close();
}

/* ============================================================
   6. 저장이 막힌 브라우저 (시크릿 모드 등)
   ============================================================ */
{
  console.log("── 저장이 막혔을 때");
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: `
    // localStorage 가 예외를 던지는 상황을 흉내 냅니다
    const t = () => { throw new Error("저장 막힘"); };
    Object.defineProperty(window, "localStorage", {
      value: { getItem: t, setItem: t, removeItem: t, key: t, get length() { return 0; } },
    });
  ` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/app/index.html`);
  const loaded = await page.waitForFunction(() => window.__landingReady === true, { timeout: 8000 })
    .then(() => true).catch(() => false);

  ok(loaded, "저장이 막혀도 화면은 뜸");
  eq(errors.length, 0, `저장이 막혀도 터지지 않음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   폼 칸 너비 — 아이폰에서 날짜 칸이 비어져 나가던 문제

   ★ 왜 이걸 재는가

   grid 칸은 기본이 min-width:auto 라 "안의 내용보다 작아지지 않습니다".
   아이폰 사파리의 <input type=date> 는 고유 너비가 넓어서, 1fr 로
   반씩 나눠도 오른쪽 칸이 벌어지며 카드 밖으로 밀고 나갔습니다.
   도착 칸만 길어 보이고 둘 사이 간격도 먹혔습니다.

   눈으로는 데스크톱에서 멀쩡해 보이므로 숫자로 재야 잡힙니다.
   ============================================================ */
console.log("── 폼 칸 너비");
{
  const { ctx, page } = await open();

  const box = async (sel) => page.locator(sel).boundingBox();

  const start = await box("#f-start");
  const end = await box("#f-end");
  const title = await box("#f-title");
  const people = await box("#f-people");
  const region = await box("#f-region");

  /* 출발과 도착은 정확히 같은 너비 (반올림 1px 허용) */
  ok(Math.abs(start.width - end.width) <= 1,
    `출발·도착 칸 너비가 같다  (${start.width.toFixed(1)} vs ${end.width.toFixed(1)})`);

  /* 둘을 합쳐도 위아래 칸을 넘지 않는다 */
  const pairRight = end.x + end.width;
  const titleRight = title.x + title.width;
  ok(pairRight <= titleRight + 1,
    `날짜 두 칸이 위 칸 밖으로 안 나간다  (오른쪽 끝 ${pairRight.toFixed(1)} ≤ ${titleRight.toFixed(1)})`);

  ok(Math.abs(start.x - title.x) <= 1,
    "출발 칸 왼쪽 끝이 위 칸과 맞다");

  /* 둘 사이에 간격이 살아 있다 — 먹히면 한 칸처럼 보입니다 */
  const gap = end.x - (start.x + start.width);
  ok(gap >= 6, `출발·도착 사이 간격이 살아 있다  (${gap.toFixed(1)}px)`);

  /* ★ 인원과 지역은 이제 한 줄입니다 (2026-11 짜임새 정리).

     전에는 "이름·인원·지역 칸 너비가 서로 같다" 였는데, 그건
     그때의 배치를 그대로 적어둔 것이지 지켜야 할 성질이 아니었습니다.
     지켜야 할 성질은 이 묶음 머리말에 있습니다 — 칸이 카드 밖으로
     비어져 나가지 않는 것. 그걸 새 배치에 맞춰 다시 잽니다. */
  const pairRight2 = region.x + region.width;
  ok(pairRight2 <= titleRight + 1,
    `인원·지역 두 칸이 위 칸 밖으로 안 나간다  (오른쪽 끝 ${pairRight2.toFixed(1)} ≤ ${titleRight.toFixed(1)})`);

  ok(Math.abs(people.x - title.x) <= 1,
    "인원 칸 왼쪽 끝이 위 칸과 맞다");

  const pairGap = region.x - (people.x + people.width);
  ok(pairGap >= 6, `인원·지역 사이 간격이 살아 있다  (${pairGap.toFixed(1)}px)`);

  /* ★ 인원 칸이 너무 좁아지면 "4" 와 "명" 이 겹칩니다 */
  ok(people.width >= 88, `인원 칸이 좁아지지 않는다  (${people.width.toFixed(0)}px)`);

  /* ★ 밤 수는 날짜 머리말과 같은 줄에 있어야 합니다.
     아래에 따로 두면 같은 말(날짜)을 두 번 하면서 한 줄을 더 먹습니다. */
  const nights = await box("#nights-note");
  const label = await box(".field-head .field-label");
  ok(Math.abs((nights.y + nights.height / 2) - (label.y + label.height / 2)) <= 10,
    `★ 밤 수가 날짜 머리말과 같은 줄에 있다  (${nights.y.toFixed(0)} vs ${label.y.toFixed(0)})`);
  ok(nights.x > label.x + label.width,
    "밤 수가 머리말 오른쪽에 있다");
  eq((await page.locator("#nights-note").textContent()).trim(), "1박 2일",
    "밤 수만 짧게 적는다");

  /* ★ "여행방 만들기" 가 폼을 끝까지 안 내려도 보여야 합니다.
     전에는 비밀번호까지 내려가야 버튼이 나왔습니다. */
  const vh = page.viewportSize().height;
  const btn = await box("#btn-make");
  ok(btn.y + btn.height <= vh + 1,
    `★ 만들기 버튼이 첫 화면에서 바로 보인다  (아래 끝 ${(btn.y + btn.height).toFixed(0)} ≤ ${vh})`);

  /* 가로 스크롤이 생기지 않는다 */
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 0, `가로 스크롤이 없다  (넘침 ${overflow}px)`);

  await ctx.close();
}


/* ============================================================
   테마 고르기 — 색 띠를 눌러도 글자를 눌러도 똑같이

   ★ 실제로 있었던 버그:
     숨긴 라디오에 width:0 만 줬는데, 이 묶음이 <fieldset class="field">
     안이라 뒤에 오는 .field input{width:100%} 가 이겼습니다. 보이지
     않는 라디오가 가로 344px 로 라벨 밖까지 뻗었고, 포커스가 가면
     브라우저가 화면 밖으로 스크롤하려 들어 폰에서 버벅였습니다.
     그리고 색 띠와 글자가 서로 다른 요소라 동작이 달랐습니다.
   ============================================================ */
console.log("── 테마 고르기 탭 영역");
{
  const { ctx, page, errors } = await open();

  /* 숨긴 라디오가 라벨 밖으로 뻗지 않는가 */
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll("#f-theme .theme-opt")].map((lab) => {
      const i = lab.querySelector("input").getBoundingClientRect();
      const l = lab.getBoundingClientRect();
      return { w: i.width, h: i.height, out: i.right > l.right + 1 || i.bottom > l.bottom + 1 };
    }));
  ok(boxes.every((b) => b.w <= 2 && b.h <= 2),
    `숨긴 라디오가 1px 로 접혀 있다  (${boxes.map((b) => `${b.w}×${b.h}`).join(" ")})`);
  ok(boxes.every((b) => !b.out), "숨긴 라디오가 라벨 밖으로 뻗지 않는다");

  /* 색 띠 중앙을 눌렀을 때 실제로 받는 요소가 라벨인가 */
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll("#f-theme .theme-opt")].map((lab) => {
      const b = lab.querySelector(".swatch").getBoundingClientRect();
      const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return el ? (el.closest(".theme-opt") === lab ? "자기 라벨" : "남의 것") : "없음";
    }));
  ok(hits.every((h) => h === "자기 라벨"),
    `색 띠를 눌러도 자기 라벨이 받는다  (${hits.join(", ")})`);

  /* 색 띠를 눌러서 실제로 테마가 바뀌는가 — 글자를 눌렀을 때와 같은가 */
  const themeNow = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

  /* ★ 좌표로 누릅니다. 색 띠는 pointer-events:none 이라 Playwright 의
     일반 click 으로는 못 누르는데, 그게 바로 의도한 바입니다 —
     실제 손가락은 그 자리를 눌러도 라벨이 받습니다. */
  const tapAt = async (n, sel) => {
    const b = await page.locator("#f-theme .theme-opt").nth(n).locator(sel).boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(150);
  };

  await tapAt(0, ".swatch");
  const bySwatch = await themeNow();
  await tapAt(2, ".swatch");
  const other = await themeNow();
  ok(bySwatch !== other, `색 띠 자리를 눌러 테마가 바뀐다  (${bySwatch} → ${other})`);

  /* 같은 칸의 글자 자리를 눌렀을 때도 같은 결과 */
  await tapAt(0, "span:not(.swatch)");
  eq(await themeNow(), bySwatch, "글자 자리와 색 띠 자리의 결과가 같다");

  /* 누른 뒤 화면이 옆으로 밀리지 않는가 (포커스 스크롤) */
  const scrolled = await page.evaluate(() => window.scrollX);
  eq(scrolled, 0, "테마를 눌러도 화면이 옆으로 밀리지 않는다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

/* ============================================================
   탭 사용 칸 — 설정이 없으면 조용히 숨는다

   ★ 0010 마이그레이션을 안 돌린 사람에게 빈 표나 오류가
     보이면 안 됩니다. 통계는 있으면 좋은 것이지, 사이트가
     돌아가는 조건이 아닙니다.
   ============================================================ */
{
  console.log("── 탭 사용 칸");
  const { ctx, page, errors } = await open();

  eq(await page.locator("#usage").isVisible(), false,
    "★ 설정이 없으면 통계 칸이 아예 안 보인다");
  eq(errors.length, 0,
    `통계 때문에 콘솔 오류가 나지 않는다${errors.length ? " — " + errors[0] : ""}`);

  /* ★ 로그인하지 않은 상태에서 로그아웃 버튼이 보이면 안 됩니다.
     눌러도 아무 일이 안 일어나는 버튼은 "고장났나?" 로 읽힙니다. */
  eq(await page.locator("#signout").isVisible(), false,
    "★ 로그인하지 않았으면 로그아웃 버튼이 안 보인다");

  await ctx.close();
}

/* ============================================================
   시험용 로그인 수단 바꾸기 (?login=)

   ★ 비즈 앱 심사가 통과했는지는 실제로 로그인해봐야 압니다.
     그렇다고 config.js 를 바꿔서 확인하면 안 될 때 아무도 방을
     못 만듭니다. 주소로만 바뀌고 기본값은 그대로여야 합니다.
   ============================================================ */
{
  console.log("── 시험용 로그인 수단");

  /* ★ 기본값을 여기서 못박습니다. config.js 의 실제 값을 그대로 쓰면,
     사장님이 로그인 수단을 바꾸는 날 이 검사가 엉뚱하게 깨집니다. */
  const noteFor = async (query) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await stubConfig(ctx, { ...FAKE_SUPABASE, LOGIN_PROVIDER: "github" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app/index.html${query}`);
    await page.waitForFunction(() => window.__landingReady === true, { timeout: 10000 });
    const t = await page.locator("#login-note").innerText();
    await ctx.close();
    return t;
  };

  const base = await noteFor("");
  ok(/깃허브/.test(base), `기본값은 config.js 그대로  (${base.slice(0, 20)}…)`);

  const kakao = await noteFor("?login=kakao");
  ok(/카카오/.test(kakao), `★ ?login=kakao 면 카카오로 바뀐다  (${kakao.slice(0, 20)}…)`);

  const bogus = await noteFor("?login=페이스북");
  ok(/깃허브/.test(bogus), `모르는 이름은 무시하고 기본값으로  (${bogus.slice(0, 20)}…)`);
}

/* ============================================================
   개인정보 처리방침

   ★ 링크만 걸고 페이지가 없으면 404 입니다. 법적으로 있어야 하는
     문서라 "있는 척"이 제일 나쁩니다.
   ============================================================ */
{
  console.log("── 개인정보 처리방침");
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e)));

  await page.goto(`${BASE}/app/index.html`);
  const href = await page.getAttribute('.foot a[href="privacy.html"]', "href");
  eq(href, "privacy.html", "첫 화면 바닥에 링크가 있다");

  const res = await page.goto(`${BASE}/app/privacy.html`);
  eq(res.status(), 200, "★ 링크가 가리키는 페이지가 실제로 있다");

  const text = await page.locator("main").innerText();
  for (const must of ["카카오", "사진", "지우", "문의", "만 14세"]) {
    ok(text.includes(must), `빠진 대목이 없다 — "${must}"`);
  }

  /* ★ 연락처를 안 채우고 올리면 "문의하세요" 라고 해놓고 문의할 곳이
     없는 문서가 됩니다. 채울 때까지 눈에 띄게 해둡니다. */
  const blank = text.includes("여기에 이메일 주소를 적어주세요");
  if (blank) console.log("  주의  연락처가 아직 비어 있습니다 (공개 전에 채우세요)");

  eq(await page.locator('.foot a[href="index.html"]').isVisible(), true,
    "돌아가는 길이 있다");
  eq(bad.length, 0, `콘솔 오류 없음${bad.length ? " — " + bad[0] : ""}`);
  await ctx.close();
}

/* ============================================================
   카톡 링크 미리보기

   ★ og:image 가 상대 경로면 카톡이 못 읽어서 그림 없는 카드가
     뜹니다. 그런데 브라우저로 열면 멀쩡해 보여서, 실제로
     카톡에 보내보기 전까지는 모릅니다. 그래서 검사로 둡니다.

   ★ 방 페이지 제목에 여행 이름이 들어가면 안 됩니다. 링크가
     단톡방 밖으로 새면 "누가 어디 가는지" 가 미리보기만으로
     드러납니다.
   ============================================================ */
{
  console.log("── 링크 미리보기");
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();

  for (const [file, name] of [["index.html", "첫 화면"],
                              ["room.html", "방"],
                              ["privacy.html", "처리방침"]]) {
    await page.goto(`${BASE}/app/${file}`);
    const img = await page.getAttribute('meta[property="og:image"]', "content");
    const title = await page.getAttribute('meta[property="og:title"]', "content");
    ok(img && /^https:\/\//.test(img),
      `${name} — og:image 가 전체 주소다  (${String(img).slice(0, 44)}…)`);
    ok(title && title.length > 1, `${name} — 제목이 있다  (${title})`);
  }

  /* 그림 파일이 실제로 있는지 */
  const res = await page.goto(`${BASE}/app/assets/brand/og.png`);
  eq(res.status(), 200, "★ 미리보기 그림 파일이 실제로 있다");

  await page.goto(`${BASE}/app/room.html`);
  const roomTitle = await page.getAttribute('meta[property="og:title"]', "content");
  const roomDesc = await page.getAttribute('meta[property="og:description"]', "content");
  ok(!/강릉|여행 이름|\{/.test(`${roomTitle} ${roomDesc}`),
    "★ 방 미리보기에 여행 이름이 안 들어간다");

  await ctx.close();
}

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
