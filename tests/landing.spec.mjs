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
import { stubConfig } from "./stub-config.mjs";

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

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
