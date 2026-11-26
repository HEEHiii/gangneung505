/* ============================================================
   방 화면 — 브라우저 테스트

   실행: bash tests/run-browser.sh room

   "이 브라우저에만 저장" 모드로 돕니다. 서버 모드의 권한·격리·잠김은
   tests/sql/test.sql 에서 확인했고, 여기서는 화면 흐름을 봅니다.
   ============================================================ */

import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stubConfig, FAKE_SUPABASE } from "./stub-config.mjs";
import { gpsJpegBytes } from "./fixtures/gps-jpeg.mjs";

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

const PLACES = {
  keyword: {
    "초당순두부": [{
      id: "k1", place_name: "초당할머니순두부", x: "128.9110", y: "37.7900",
      road_address_name: "강릉시 초당순두부길 77", category_group_code: "FD6",
    }],
    "오붓한강릉": [{
      id: "k2", place_name: "오붓한강릉", x: "128.8780", y: "37.8250",
      road_address_name: "강릉시 사천면", category_group_code: "AD5",
    }],
    "강릉역": [{
      id: "h1", place_name: "강릉역", x: "128.8990", y: "37.7637",
      road_address_name: "강릉시 용지로 176", category_group_code: "SW8",
    }],
  },
  category: { AT4: [] },
};

const browser = await chromium.launch();

async function fresh(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 900 },
    colorScheme: opts.scheme || "light",
  });
  /* 진짜 config.js 대신 테스트가 정한 값 (기본: 전부 비움) */
  await stubConfig(ctx, opts.config);
  await ctx.addInitScript({ content: STUB });
  await ctx.addInitScript({ content: `window.__stubPlaces = ${JSON.stringify(PLACES)};` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text());
  });
  return { ctx, page, errors };
}

/* 랜딩에서 방을 하나 만들고 링크를 돌려줍니다 */
async function makeRoom(page, v = {}) {
  await page.goto(`${BASE}/app/index.html`);
  await page.waitForFunction(() => window.__landingReady === true, { timeout: 10000 });
  await page.fill("#f-title", v.title ?? "겨울 강릉");
  await page.fill("#f-start", v.start ?? "2027-01-23");
  await page.fill("#f-end", v.end ?? "2027-01-24");
  await page.fill("#f-people", String(v.people ?? 4));
  await page.fill("#f-pw", v.pw ?? "0505");
  await page.fill("#f-pw2", v.pw ?? "0505");
  await page.click("#btn-make");
  await page.waitForSelector("#done:not([hidden])", { timeout: 8000 });
  return page.locator("#share-url").inputValue();
}

const openRoom = async (page, url) => {
  await page.goto(url);
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 10000 });
};

const enter = async (page, pw = "0505") => {
  await page.fill("#gate-input", pw);
  await page.click("#gate-go");
  await page.waitForSelector("#app:not([hidden])", { timeout: 8000 });
  await page.waitForTimeout(500);
};

/* ============================================================
   1. 비밀번호 게이트
   ============================================================ */
let roomUrl = "";
{
  console.log("── 게이트");
  const { ctx, page, errors } = await fresh();
  roomUrl = await makeRoom(page);
  await openRoom(page, roomUrl);

  eq(await page.locator("#gate").isVisible(), true, "비밀번호를 먼저 묻는다");
  eq(await page.locator("#app").isVisible(), false, "통과 전에는 내용이 안 보인다");

  /* ★ 친구가 카톡으로 링크를 받아 열었을 때 "여기가 맞나?"를 알 수 있어야 합니다.
     예전에는 "여행방"이라고만 떠서 확신이 안 섰습니다. */
  eq(await page.locator("#gate-title").textContent(), "겨울 강릉",
    "비밀번호 화면에 여행 이름이 뜬다");
  const sub = await page.locator("#gate-sub").textContent();
  ok(sub.includes("비밀번호"), "무엇을 해야 하는지 안내");

  /* ★ 이름만 보여주고 나머지는 들어가서 봅니다.
     보내지 않은 값은 샐 수가 없으므로 서버도 아예 안 보냅니다. */
  ok(!sub.includes("1박"), "기간은 비밀번호 앞에서 안 보인다");
  ok(!sub.includes("강릉"), "지역은 비밀번호 앞에서 안 보인다");
  ok(!sub.includes("4명"), "인원은 비밀번호 앞에서 안 보인다");
  eq(await page.title(), "겨울 강릉 — 여행방", "브라우저 탭 제목도 바뀐다");

  /* 1월 여행이므로 겨울 테마가 게이트부터 적용되어야 합니다 */
  eq(await page.getAttribute("html", "data-theme"), "winter",
    "게이트부터 계절 테마가 적용된다");

  /* ★ 이름은 보여주되 내용은 비밀번호 뒤에 남아야 합니다.
     서버가 정확히 무엇만 돌려주는지는 tests/sql/test.sql 의 5.5 절에서
     항목 수까지 세어 확인합니다. 여기서는 화면에 안 그려지는지만 봅니다. */
  eq(await page.locator("#lodging-list .card").count(), 0, "통과 전에는 숙소 카드가 없다");
  eq(await page.locator("[data-vote]").count(), 0, "통과 전에는 투표 버튼이 없다");
  eq(await page.locator(".map .pin-lodging").count(), 0, "통과 전에는 지도 핀도 없다");

  /* ★ 505 판은 화면에서 문자열을 비교해서 F12 로 그냥 보였습니다.
     이제 비밀번호가 페이지 소스 어디에도 없어야 합니다. */
  const html = await page.content();
  ok(!html.includes("0505"), "비밀번호가 페이지 소스에 없다 (서버가 확인)");

  await page.fill("#gate-input", "9999");
  await page.click("#gate-go");
  await page.waitForTimeout(400);
  ok((await page.locator("#gate-error").textContent()).includes("확인"), "틀리면 알려준다");
  eq(await page.locator("#app").isVisible(), false, "틀리면 못 들어간다");

  await enter(page);
  eq(await page.locator("#app").isVisible(), true, "맞으면 들어간다");

  /* 다시 열면 안 묻는다 — 친구들은 몇 주에 걸쳐 다시 엽니다 */
  await openRoom(page, roomUrl);
  eq(await page.locator("#app").isVisible(), true, "다시 열면 비밀번호를 또 묻지 않는다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

/* ============================================================
   2. 없는 방 / 잘못된 주소
   ============================================================ */
{
  console.log("── 잘못된 주소");
  const { ctx, page } = await fresh();

  await page.goto(`${BASE}/app/room.html`);
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  ok((await page.locator("#gate-error").textContent()).includes("링크"), "방 주소가 없으면 안내");
  eq(await page.locator("#gate-form").isVisible(), false, "입력칸을 숨긴다");

  await page.goto(`${BASE}/app/room.html?r=ZZZZZZZZZ`);
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });

  /* 없는 방은 이름을 못 가져오니 기본 문구 그대로여야 합니다 (화면이 멈추면 안 됩니다) */
  eq(await page.locator("#gate-title").textContent(), "여행방",
    "없는 방은 기본 제목 그대로");
  eq(await page.locator("#gate-form").isVisible(), true, "그래도 입력칸은 떠 있다");

  await page.fill("#gate-input", "0505");
  await page.click("#gate-go");
  await page.waitForTimeout(400);
  const msg = await page.locator("#gate-error").textContent();
  ok(msg.includes("확인"), "없는 방도 '비밀번호 틀림'과 같은 메시지 (존재 여부를 안 알려줌)");

  await ctx.close();
}

/* ============================================================
   3. 방 정보와 테마
   ============================================================ */
{
  console.log("── 방 정보");
  const { ctx, page } = await fresh();
  const url = await makeRoom(page, { title: "봄 제주", start: "2027-04-10", end: "2027-04-12", people: 6 });
  await openRoom(page, url);
  await enter(page);

  eq(await page.locator("#room-title").textContent(), "봄 제주", "방 제목");
  ok((await page.locator("#trip-range").textContent()).includes("2박 3일"), "기간 표시");
  ok((await page.locator("#stay-count").textContent()).includes("6인"), "인원 표시");

  /* ★ 방을 만들 때 고른 계절이 방에서도 이어져야 합니다 */
  eq(await page.getAttribute("html", "data-theme"), "spring", "4월에 만든 방은 봄 테마로 열린다");
  eq(await page.title(), "봄 제주 — 여행방", "브라우저 탭 제목");

  /* 약한 게이트라는 점을 숨기지 않습니다 */
  ok((await page.locator("#vote-note").textContent()).length > 10, "보안 수준을 안내한다");

  await ctx.close();
}

/* ============================================================
   4. 지역 관광지 — 큐레이션 파일
   ============================================================ */
{
  console.log("── 지역 관광지");
  const { ctx, page } = await fresh();
  await openRoom(page, await makeRoom(page));
  await enter(page);

  const spots = await page.locator("#map-stay .pin-spot").count();
  ok(spots >= 10, `강릉 큐레이션 관광지가 지도에 올라감 (${spots}곳)`);
  const labels = await page.locator("#map-stay .pin-label").allTextContents();
  ok(labels.includes("경포해변"), "관광지 이름이 보인다");

  await ctx.close();
}

/* ============================================================
   5. 장소 추가 — 칸 하나로 이름이든 링크든
   ============================================================ */
{
  console.log("── 장소 추가");
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page));
  await enter(page);

  eq(await page.locator("#lodging-list .empty").count(), 1, "처음엔 빈 목록 안내");

  /* (a) 이름으로 */
  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", "오붓한강릉");
  await page.fill("#adder-stay .a-note", "사천해변 도보권");
  await page.click("#adder-stay .a-find");
  await page.waitForSelector("#adder-stay .a-hits:not([hidden])", { timeout: 5000 });
  eq(await page.locator("#adder-stay .a-hits li").count(), 1, "이름 검색 결과");

  await page.click("#adder-stay .a-hits button");
  await page.waitForTimeout(500);
  eq(await page.locator("#lodging-list .card").count(), 1, "카드가 생긴다");
  ok((await page.locator("#lodging-list").textContent()).includes("오붓한강릉"), "이름");
  ok((await page.locator("#lodging-list").textContent()).includes("사천해변 도보권"), "메모도 함께");
  eq(await page.locator("#map-stay .pin-lodging").count(), 1, "지도에 핀이 생긴다");
  ok((await page.locator("#lodging-list .dists").textContent()).includes("경포해변"),
    "대표 관광지까지 거리를 보여준다");

  /* (b) 링크로 — 주소에 좌표가 든 경우는 네트워크 없이 바로 */
  await page.fill("#adder-stay .a-q", "https://map.kakao.com/link/map/강릉역,37.7637,128.8990");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(600);
  eq(await page.locator("#lodging-list .card").count(), 2, "링크로도 추가된다");
  ok((await page.locator("#lodging-list").textContent()).includes("강릉역"), "링크에서 이름을 뽑는다");

  /* (c) 좌표를 그대로 붙여넣기 */
  await page.fill("#adder-stay .a-q", "37.7955, 128.9105");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(600);
  eq(await page.locator("#lodging-list .card").count(), 3, "좌표를 붙여넣어도 된다");

  /* (d) 못 찾는 경우 */
  await page.fill("#adder-stay .a-q", "없는가게이름");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(600);
  ok((await page.locator("#adder-stay .a-status").textContent()).includes("지도에서 찍"),
    "못 찾으면 지도에서 찍으라고 안내");
  eq(await page.locator("#lodging-list .card").count(), 3, "못 찾았을 때 추가되지 않음");

  /* (e) 빈 입력 */
  await page.fill("#adder-stay .a-q", "");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(300);
  ok((await page.locator("#adder-stay .a-status").textContent()).includes("넣어주세요"), "빈 입력 안내");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

/* ============================================================
   6. 투표
   ============================================================ */
{
  console.log("── 투표");
  const { ctx, page } = await fresh();
  await openRoom(page, await makeRoom(page));
  await enter(page);

  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", "오붓한강릉");
  await page.click("#adder-stay .a-find");
  await page.waitForSelector("#adder-stay .a-hits:not([hidden])", { timeout: 5000 });
  await page.click("#adder-stay .a-hits button");
  await page.waitForTimeout(500);

  const count = () => page.locator("#lodging-list .vote-count").first().textContent();
  const btn = page.locator("#lodging-list [data-vote]").first();

  /* ★ 2026-11: 버튼이 "투표 / 투표함 ✓" 글자에서 하트 + 숫자로
     바뀌었습니다. 글자는 그때의 모양이고, 지켜야 할 성질은
     "셈이 맞는가" 와 "눌린 상태가 드러나는가" 입니다. */
  eq((await count()).trim(), "0", "처음엔 0표");
  eq(await btn.getAttribute("aria-pressed"), "false", "버튼 기본 상태");

  await btn.click();
  await page.waitForTimeout(400);
  eq((await count()).trim(), "1", "누르면 1표");
  eq(await btn.getAttribute("aria-pressed"), "true", "버튼이 눌린 상태가 된다");
  eq(await btn.getAttribute("aria-label"), "투표 취소", "읽어주는 말도 바뀐다");
  eq(await btn.getAttribute("aria-pressed"), "true", "스크린리더에도 상태 전달");

  await btn.click();
  await page.waitForTimeout(400);
  eq((await count()).trim(), "0", "다시 누르면 취소");
  eq(await btn.getAttribute("aria-pressed"), "false", "상태도 되돌아간다");

  /* 새로고침해도 유지 */
  await btn.click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(600);
  eq((await count()).trim(), "1", "새로고침해도 투표가 남는다");
  eq(await page.locator("#lodging-list [data-vote]").first().getAttribute("aria-pressed"), "true",
    "내가 한 투표임을 기억한다");

  await ctx.close();
}

/* ============================================================
   7. 삭제 — 내가 넣은 것만
   ============================================================ */
{
  console.log("── 삭제");
  const { ctx, page } = await fresh();
  await openRoom(page, await makeRoom(page));
  await enter(page);

  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", "오붓한강릉");
  await page.click("#adder-stay .a-find");
  await page.waitForSelector("#adder-stay .a-hits:not([hidden])", { timeout: 5000 });
  await page.click("#adder-stay .a-hits button");
  await page.waitForTimeout(500);

  eq(await page.locator("#lodging-list [data-del]").count(), 1, "내가 넣은 것에는 삭제 버튼");

  page.on("dialog", (d) => d.accept());
  await page.click("#lodging-list [data-del]");
  await page.waitForTimeout(500);
  eq(await page.locator("#lodging-list .card").count(), 0, "지워진다");
  eq(await page.locator("#map-stay .pin-lodging").count(), 0, "지도 핀도 사라진다");

  await ctx.close();
}

/* ============================================================
   8. 탭
   ============================================================ */
{
  console.log("── 탭");
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page));
  await enter(page);

  eq(await page.locator("#panel-stay").isVisible(), true, "숙소 탭이 기본");

  await page.click('#tabs a[data-tab="food"]');
  await page.waitForTimeout(400);
  eq(await page.locator("#panel-food").isVisible(), true, "맛집 탭으로 이동");
  eq(await page.locator("#panel-stay").isVisible(), false, "숙소 탭은 숨는다");
  eq(await page.locator("#food-filters .chip").count(), 4, "분류 칩 4개");

  /* 맛집 추가 — 분류를 고를 수 있다 */
  await page.click("#adder-food summary");
  await page.selectOption("#adder-food .a-kind", "cafe");
  await page.fill("#adder-food .a-q", "초당순두부");
  await page.click("#adder-food .a-find");
  await page.waitForSelector("#adder-food .a-hits:not([hidden])", { timeout: 5000 });
  await page.click("#adder-food .a-hits button");
  await page.waitForTimeout(500);
  eq(await page.locator("#food-list .card").count(), 1, "맛집 카드 생성");
  ok((await page.locator("#food-list").textContent()).includes("카페"), "고른 분류가 반영된다");
  eq(await page.locator("#map-food .pin-food.cafe").count(), 1, "카페 핀 모양");

  /* 분류 필터 */
  await page.click('#food-filters [data-cat="food"]');
  await page.waitForTimeout(300);
  eq(await page.locator("#food-list .card").count(), 0, "식당 필터에는 안 보인다");
  await page.click('#food-filters [data-cat="cafe"]');
  await page.waitForTimeout(300);
  eq(await page.locator("#food-list .card").count(), 1, "카페 필터에는 보인다");

  /* 2단계 탭 */
  await page.click('#tabs a[data-tab="plan"]');
  await page.waitForTimeout(300);
  ok(await page.locator("#plan-build").isVisible(), "일정 탭에 '짜기' 버튼이 보임");
  await page.click('#tabs a[data-tab="money"]');
  await page.waitForTimeout(300);
  ok(await page.locator("#ex-form").isVisible(), "정산 탭에 지출 적는 칸이 열림");

  /* 주소의 # 으로도 탭이 바뀐다 */
  await page.goto(roomUrlWithHash(page.url(), "food"));
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(400);
  eq(await page.locator("#panel-food").isVisible(), true, "주소의 #food 로 바로 맛집 탭");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

function roomUrlWithHash(current, tab) {
  const u = new URL(current);
  u.hash = tab;
  return u.toString();
}

/* ============================================================
   9. 지도 키가 없을 때 — 목록과 투표는 그대로
   ============================================================ */
{
  console.log("── 지도 키가 없을 때");
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await stubConfig(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await openRoom(page, await makeRoom(page));
  await enter(page);

  ok(await page.locator("#map-stay.map-off").count() > 0, "지도 자리에 안내판");
  ok((await page.locator("#map-stay").textContent()).includes("목록과 투표는 그대로"),
    "'목록과 투표는 그대로' 안내");

  /* 링크 1단계는 지도 없이도 됩니다 */
  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", "https://map.kakao.com/link/map/강릉역,37.7637,128.8990");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(600);
  eq(await page.locator("#lodging-list .card").count(), 1, "지도 없이도 링크로 추가된다");

  await page.locator("#lodging-list [data-vote]").first().click();
  await page.waitForTimeout(400);
  eq((await page.locator("#lodging-list .vote-count").first().textContent()).trim(), "1",
    "지도 없이도 투표된다");

  /* 이름 검색만 막히고, 친절하게 알려줍니다 */
  await page.fill("#adder-stay .a-q", "초당순두부");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(500);
  ok((await page.locator("#adder-stay .a-status").textContent()).includes("지도 키"),
    "이름 검색은 왜 안 되는지 알려준다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   정산 탭

   ★ 돈이 걸린 화면이라 "눌리나"가 아니라 "숫자가 맞나"를 봅니다.
     계산 자체는 tests/settle.check.mjs 가 2,000판 돌려 확인하므로,
     여기서는 화면·저장·권한이 제대로 이어졌는지만 봅니다.
   ============================================================ */
console.log("── 정산 탭");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, { title: "정산 시험", people: 4 }));
  await enter(page);

  await page.click('#tabs a[data-tab="money"]');
  await page.waitForSelector("#panel-money:not([hidden])", { timeout: 5000 });

  eq(await page.locator("#settlement").isVisible(), false,
    "지출이 없으면 '주고받기'가 숨어 있음");

  const addExpense = async (item, amount, payer) => {
    await page.fill("#ex-item", item);
    await page.fill("#ex-amount", String(amount));
    await page.fill("#ex-payer", payer);
    await page.click("#ex-form button[type=submit]");
    await page.waitForTimeout(250);
  };

  await addExpense("숙소", 200000, "민수");
  eq(await page.locator("#expense-list li").count(), 1, "지출 한 건이 목록에 보임");

  const stats = async () =>
    (await page.locator("#expense-summary .stat-v").allTextContents()).join(" / ");
  eq(await stats(), "200,000원 / 50,000원", "총액과 1인당이 맞음 (4명)");

  eq(await page.locator("#settlement").isVisible(), true, "한 명만 냈으면 정산할 게 생김");
  eq(await page.locator("#settle-list li").count(), 3, "나머지 3명이 각각 보냄");
  ok((await page.locator("#settle-list").textContent()).includes("50,000원"),
    "1인분씩 보내라고 나옴");
  ok((await page.locator("#settle-note").textContent()).includes("3명"),
    "결제 기록이 없는 사람을 안내함");

  await addExpense("회", 90000, "지아");
  eq(await stats(), "290,000원 / 72,500원", "두 번째 지출이 합산됨");

  /* 새로고침해도 남아 있어야 합니다 — 저장이 진짜 됐는지 */
  await page.reload();
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.click('#tabs a[data-tab="money"]');
  await page.waitForTimeout(300);
  eq(await page.locator("#expense-list li").count(), 2, "새로고침해도 지출이 남아 있음");

  /* 말이 안 되는 입력 */
  await page.fill("#ex-item", "");
  await page.fill("#ex-amount", "1000");
  await page.fill("#ex-payer", "민수");
  await page.click("#ex-form button[type=submit]");
  await page.waitForTimeout(200);
  eq(await page.locator("#expense-list li").count(), 2, "빈 항목은 안 들어감");

  /* 지우기 */
  page.once("dialog", (d) => d.accept());
  await page.click("#expense-list li:first-child .ex-del");
  await page.waitForTimeout(350);
  eq(await page.locator("#expense-list li").count(), 1, "내가 적은 지출은 지울 수 있음");
  eq(await stats(), "90,000원 / 22,500원", "지운 뒤 합계가 다시 계산됨");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

{
  console.log("── 정산 — 남의 지출");
  /* 다른 브라우저 = 다른 사람. 남이 적은 지출에는 지우기 버튼이 없어야 합니다. */
  const a = await fresh();
  const url = await makeRoom(a.page, { title: "둘이서", people: 2 });
  await openRoom(a.page, url);
  await enter(a.page);
  await a.page.click('#tabs a[data-tab="money"]');
  await a.page.waitForSelector("#panel-money:not([hidden])", { timeout: 5000 });
  await a.page.fill("#ex-item", "기름값");
  await a.page.fill("#ex-amount", "40000");
  await a.page.fill("#ex-payer", "민수");
  await a.page.click("#ex-form button[type=submit]");
  await a.page.waitForTimeout(300);
  eq(await a.page.locator("#expense-list .ex-del[data-id]").count(), 1,
    "내가 적은 것에는 지우기 버튼이 있다");

  await a.ctx.close();
}


/* ============================================================
   일정 탭

   ★ 투표 → 일정 생성 → 직접 수정 → 새로고침해도 남아있는지.
     짜는 알고리즘 자체는 tests/route.check.mjs 가 따로 확인합니다.
   ============================================================ */
console.log("── 일정 탭");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, {
    title: "일정 시험", start: "2027-01-23", end: "2027-01-25", people: 4,
  }));
  await enter(page);

  await page.click('#tabs a[data-tab="plan"]');
  await page.waitForSelector("#panel-plan:not([hidden])", { timeout: 5000 });
  eq(await page.locator("#plan-empty").isVisible(), true, "처음에는 '아직 일정이 없어요'");
  eq(await page.locator("#plan-share").isVisible(), false, "일정이 없으면 공유 버튼도 숨음");

  /* 장소가 없으면 안내 — 수단을 묻기 전에 걸러야 합니다.
     아무것도 없는데 "어떻게 다니실 건가요?" 부터 물으면 헛걸음입니다. */
  await page.click("#plan-build");
  await page.waitForTimeout(300);
  eq(await page.locator("#plan-mode").isVisible(), false,
    "★ 장소가 없으면 수단을 묻지도 않는다");
  ok((await page.locator("#plan-error").textContent()).includes("추가"),
    "장소가 없으면 먼저 추가하라고 알려줌");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


{
  console.log("── 일정 — 짜고 고치기");
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, {
    title: "일정 전체", start: "2027-01-23", end: "2027-01-25", people: 4,
  }));
  await enter(page);

  /* 지도 없이 카카오 링크로 장소를 넣습니다 (좌표가 링크 안에 있습니다) */
  const addVia = async (tab, name, lat, lng) => {
    await page.click(`#tabs a[data-tab="${tab}"]`);
    await page.waitForTimeout(200);
    const box = `#adder-${tab}`;
    /* 추가가 끝나면 접히므로, 눈에 보이는지로 판단해 다시 엽니다 */
    if (!(await page.locator(`${box} .a-q`).isVisible())) {
      await page.click(`${box} summary`);
      await page.locator(`${box} .a-q`).waitFor({ state: "visible", timeout: 5000 });
    }
    await page.fill(`${box} .a-q`, `https://map.kakao.com/link/map/${name},${lat},${lng}`);
    await page.click(`${box} .a-find`);
    await page.waitForTimeout(700);
  };

  await addVia("stay", "오붓한강릉", 37.8250, 128.8780);
  await addVia("food", "초당순두부", 37.7956, 128.9142);
  await addVia("food", "경포대", 37.7955, 128.8963);
  await addVia("food", "주문진회센터", 37.8960, 128.8295);

  await page.click('#tabs a[data-tab="plan"]');
  await page.waitForSelector("#panel-plan:not([hidden])", { timeout: 5000 });

  /* ★ 짤 때마다 이동 수단을 묻습니다. 수단에 따라 시간만이 아니라
     하루에 넣는 장소 수까지 달라집니다. */
  const build = async (mode) => {
    await page.click("#plan-build");
    await page.locator("#plan-mode").waitFor({ state: "visible", timeout: 5000 });
    await page.check(`#plan-mode input[name="transport"][value="${mode}"]`);
    await page.click("#pm-go");
    await page.waitForTimeout(900);
  };

  await page.click("#plan-build");
  await page.locator("#plan-mode").waitFor({ state: "visible", timeout: 5000 });
  ok(true, "★ 짜기를 누르면 이동 수단을 묻는다");
  await page.click("#pm-cancel");
  await page.waitForTimeout(200);
  eq(await page.locator(".plan-day").count(), 0, "   취소하면 안 짠다");

  await build("car");

  eq(await page.locator(".plan-day").count(), 3, "3일 여행이면 날짜 칸이 3개");
  eq(await page.locator("#plan-empty").isVisible(), false, "일정이 생기면 안내가 사라짐");
  eq(await page.locator("#plan-share").isVisible(), true, "일정이 생기면 공유 버튼이 보임");
  ok((await page.locator("#plan-note").textContent()).includes("이동시간"),
    "이동시간을 알려줌");
  ok((await page.locator("#plan-note").textContent()).includes("어림"),
    "어림이라고 솔직하게 밝힘");
  ok((await page.locator("#plan-note").textContent()).includes("자차"),
    "★ 어느 수단 기준인지 적는다 (저장되는 건 시각뿐이라 이 말이 없으면 알 수 없습니다)");

  const firstDay = page.locator(".plan-day").first();
  ok((await firstDay.textContent()).includes("도착"), "첫날은 도착으로 시작");
  ok((await page.locator(".plan-day").last().textContent()).includes("귀가"),
    "마지막 날은 귀가로 끝");

  /* 모든 장소가 어딘가에 들어갔는지 */
  const all = await page.locator("#plan-days").textContent();
  for (const n of ["초당순두부", "경포대", "주문진회센터"]) {
    ok(all.includes(n), `${n} 이 일정에 들어감`);
  }

  /* ★ 시간이 카드 왼쪽 끝에 붙어 있지 않아야 합니다.

     .plan-slots 선택자가 두 번 있었고 뒤엣것의 padding:0 이
     이겨서 여백이 죽어 있었습니다. 두 줄 떨어져 있어서 눈으로는
     안 보였습니다 — 숫자로 잽니다. */
  {
    const time = await page.locator(".plan-time").first().boundingBox();
    const day = await page.locator(".plan-day").first().boundingBox();
    const gap = time.x - day.x;
    ok(gap >= 8, `★ 시간이 카드 왼쪽에 붙어 있지 않다  (${gap.toFixed(0)}px 띄움)`);
  }

  /* ★★ 시간을 손으로 고칠 수 있어야 합니다.

     짜준 시간은 어림입니다. 기차 시간이나 체크인 시간처럼 정해진
     것이 있으면 그쪽이 맞습니다. */
  {
    const first = page.locator(".plan-day").first().locator(".plan-time").first();
    const was = (await first.textContent()).trim();

    page.once("dialog", (d) => d.accept("07:05"));
    await first.click();
    await page.waitForTimeout(700);
    eq((await page.locator(".plan-day").first().locator(".plan-time").first()
         .textContent()).trim(), "07:05", `★ 시간을 고칠 수 있다  (${was} → 07:05)`);

    /* 잘못 적으면 말해주고 그대로 둡니다 */
    page.once("dialog", (d) => d.accept("아무거나"));
    await page.locator(".plan-day").first().locator(".plan-time").first().click();
    await page.waitForTimeout(500);
    eq((await page.locator(".plan-day").first().locator(".plan-time").first()
         .textContent()).trim(), "07:05", "   잘못 적으면 안 바꾼다");

    /* 취소하면 그대로 */
    page.once("dialog", (d) => d.dismiss());
    await page.locator(".plan-day").first().locator(".plan-time").first().click();
    await page.waitForTimeout(400);
    eq((await page.locator(".plan-day").first().locator(".plan-time").first()
         .textContent()).trim(), "07:05", "   취소해도 그대로");
  }

  /* 직접 고치기 — 빼기 */
  const before = await page.locator(".plan-day .plan-slots li").count();
  page.once("dialog", (d) => d.accept());
  await firstDay.locator('button[data-act="drop"]').first().click();
  await page.waitForTimeout(700);
  const after = await page.locator(".plan-day .plan-slots li").count();
  eq(after, before - 1, "칸 하나를 뺄 수 있다");

  /* 새로고침해도 남아 있는가 */
  await page.reload();
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.click('#tabs a[data-tab="plan"]');
  await page.waitForTimeout(400);
  eq(await page.locator(".plan-day").count(), 3, "새로고침해도 일정이 남아 있음");
  eq(await page.locator(".plan-day .plan-slots li").count(), after,
    "새로고침해도 고친 내용이 그대로");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   댓글

   ★ 보는 것: 별명을 한 번만 묻는가, 남의 댓글에 지우기 버튼이
     없는가, 카드 클릭(지도 따라가기)과 부딪히지 않는가.
   ============================================================ */
console.log("── 댓글");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, { title: "댓글 시험" }));
  await enter(page);

  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", "https://map.kakao.com/link/map/오붓한강릉,37.8250,128.8780");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(700);
  eq(await page.locator("#lodging-list .card").count(), 1, "숙소가 하나 추가됨");

  const cmts = page.locator("#lodging-list .cmts").first();
  eq(await cmts.count(), 1, "카드에 댓글 영역이 있음");
  ok((await cmts.textContent()).includes("댓글"), "접힌 상태로 '댓글' 이라고 보임");

  await cmts.locator("summary").click();
  await page.waitForTimeout(200);
  eq(await cmts.locator(".cmt-input").isVisible(), true, "누르면 펼쳐짐");

  /* 첫 댓글 — 별명을 묻는다 */
  let asked = 0;
  page.on("dialog", async (d) => {
    if (d.type() === "prompt") { asked++; await d.accept("민수"); }
    else await d.accept();
  });

  await cmts.locator(".cmt-input").fill("여기 바다 보여요");
  await cmts.locator(".cmt-form button").click();
  await page.waitForTimeout(800);

  eq(asked, 1, "첫 댓글에서 별명을 한 번 묻는다");
  ok((await page.locator("#lodging-list").textContent()).includes("여기 바다 보여요"),
    "댓글이 보인다");
  ok((await page.locator("#lodging-list").textContent()).includes("민수"),
    "별명이 같이 보인다");

  /* 두 번째 댓글 — 다시 묻지 않는다 */
  const open = page.locator("#lodging-list .cmts").first();
  if (!(await open.locator(".cmt-input").isVisible())) await open.locator("summary").click();
  await open.locator(".cmt-input").fill("주차 되나요?");
  await open.locator(".cmt-form button").click();
  await page.waitForTimeout(800);

  eq(asked, 1, "두 번째 댓글에서는 별명을 다시 묻지 않는다");
  eq(await page.locator("#lodging-list .cmt-list li").count(), 2, "댓글이 2개");

  /* 내 댓글에는 지우기 버튼이 있다 */
  eq(await page.locator("#lodging-list .cmt-del").count(), 2,
    "내가 쓴 댓글에는 지우기 버튼이 있다");

  await page.locator("#lodging-list .cmt-del").first().click();
  await page.waitForTimeout(800);
  eq(await page.locator("#lodging-list .cmt-list li").count(), 1, "내 댓글을 지울 수 있다");

  /* 새로고침해도 남아 있는가 */
  await page.reload();
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.locator("#lodging-list .cmts summary").first().click();
  await page.waitForTimeout(200);
  eq(await page.locator("#lodging-list .cmt-list li").count(), 1, "새로고침해도 댓글이 남아 있음");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   맛집 카드를 누르면 그 자리가 확대되고, 그대로 유지되는가

   ★ 실제로 있었던 버그:
     setPoints 가 끝에서 늘 fitPoints() 를 불렀습니다. 이 함수는
     새로고침마다 다시 도니까, 카드를 눌러 확대해 놔도 몇 초 뒤
     폴링이 돌면 전체 보기로 튕겨 나갔습니다. 사용자 눈에는
     "엉뚱한 곳이 확대된다"로 보입니다.
   ============================================================ */
console.log("── 맛집 카드 → 지도 이동");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, { title: "지도 이동" }));
  await enter(page);
  await page.click('#tabs a[data-tab="food"]');
  await page.waitForTimeout(300);

  const addFood = async (name, lat, lng) => {
    const box = "#adder-food";
    if (!(await page.locator(`${box} .a-q`).isVisible())) {
      await page.click(`${box} summary`);
      await page.locator(`${box} .a-q`).waitFor({ state: "visible", timeout: 5000 });
    }
    await page.fill(`${box} .a-q`, `https://map.kakao.com/link/map/${name},${lat},${lng}`);
    await page.click(`${box} .a-find`);
    await page.waitForTimeout(700);
  };
  await addFood("초당순두부", 37.7956, 128.9142);
  await addFood("주문진회센터", 37.8960, 128.8295);

  const center = async () => page.evaluate(() => {
    const m = window.__kmaps && window.__kmaps["map-food"];
    return m ? m.__center().map((v) => v.toFixed(4)).join(",") : "지도 없음";
  });
  const clickCard = async (name) =>
    page.locator("#food-list .card", { hasText: name }).locator(".card-name").click();

  await clickCard("초당순두부");
  await page.waitForTimeout(400);
  eq(await center(), "37.7956,128.9142", "누른 맛집으로 지도가 간다");

  await clickCard("주문진회센터");
  await page.waitForTimeout(400);
  eq(await center(), "37.8960,128.8295", "다른 카드를 누르면 그쪽으로 간다");


  /* ★ 핵심: 새로고침이 돌아도 확대가 풀리지 않아야 합니다 */
  await page.evaluate(() => window.__refreshNow && window.__refreshNow());
  await page.waitForTimeout(600);
  eq(await center(), "37.8960,128.8295",
    "★ 새로고침이 돌아도 보던 자리가 유지된다 (전체 보기로 안 튕김)");

  /* 같은 카드를 다시 누르면 선택이 풀립니다.
     (스텁은 setBounds 로 중심을 바꾸지 않으므로 선택 표시로 확인합니다) */
  await clickCard("주문진회센터");
  await page.waitForTimeout(400);
  eq(await page.locator("#food-list .card.sel").count(), 0,
    "같은 카드를 다시 누르면 선택이 풀린다");

  /* ★★ 멀리 떨어진 곳을 "전체 보기" 상태에서 처음 누를 때

     사장님이 영상으로 잡아주신 증상입니다. 카드를 연달아 누를
     때는 멀쩡한데, 전체 보기로 돌아간 뒤 먼 곳을 누르면 핀이
     없는 엉뚱한 자리가 확대됐습니다.

     원인은 panTo(부드럽게 이동) 직후에 setLevel 이 끼어들어 이동을
     끊은 것이었습니다. 이미 확대돼 있으면 setLevel 이 아예 안 불려서
     멀쩡하고, 멀리서 처음 누를 때만 깨집니다 — 그래서 "먼 곳만"
     이라는 모양으로 보였습니다.

     바로 위에서 선택을 풀어 전체 보기로 돌아왔습니다. 그 상태가
     이 검사의 출발점입니다. */
  const level = async () => page.evaluate(() => {
    const m = window.__kmaps && window.__kmaps["map-food"];
    return m ? m.getLevel() : -1;
  });

  const wideLevel = await level();
  ok(wideLevel > 5, `전체 보기라 확대가 풀려 있다  (단계 ${wideLevel})`);

  await clickCard("초당순두부");            // 여기서 깨졌습니다
  await page.waitForTimeout(400);
  eq(await center(), "37.7956,128.9142",
    "★ 전체 보기에서 먼 카드를 눌러도 그 카드가 중심이다");
  ok((await level()) <= 5, `   그리고 확대도 같이 된다  (단계 ${await level()})`);

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   카드 고치기

   ★ 왜 필요한가: 전에는 추가와 삭제뿐이었습니다. 이름에 오타가
     나면 지우고 다시 넣어야 했는데, 그러면 그 카드에 모인 투표와
     댓글이 같이 사라집니다. "오타 하나 = 투표 초기화" 였습니다.
     그래서 이 검사의 핵심은 "고친 뒤에도 투표가 남아 있는가" 입니다.
   ============================================================ */
console.log("── 카드 고치기");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, { title: "고치기" }));
  await enter(page);
  await page.waitForTimeout(300);

  const addStay = async (name, lat, lng) => {
    const box = "#adder-stay";
    if (!(await page.locator(`${box} .a-q`).isVisible())) {
      await page.click(`${box} summary`);
      await page.locator(`${box} .a-q`).waitFor({ state: "visible", timeout: 5000 });
    }
    await page.fill(`${box} .a-q`, `https://map.kakao.com/link/map/${name},${lat},${lng}`);
    await page.click(`${box} .a-find`);
    await page.waitForTimeout(700);
  };
  await addStay("오붓한강릉", 37.8250, 128.8780);

  const card = () => page.locator("#lodging-list .card").first();

  /* 투표를 해 둡니다 — 고친 뒤에도 남아 있어야 합니다 */
  await card().locator("[data-vote]").click();
  await page.waitForTimeout(400);
  eq((await card().locator(".vote-count").textContent()).trim(), "1", "먼저 투표를 해 둔다");

  await card().locator("[data-edit]").click();
  await page.locator("#place-edit").waitFor({ state: "visible", timeout: 5000 });

  eq(await page.inputValue("#pe-name"), "오붓한강릉", "지금 이름이 채워져 있다");

  await page.fill("#pe-name", "오붓한 강릉");
  await page.fill("#pe-price", "180000");
  await page.fill("#pe-capacity", "4인");
  await page.fill("#pe-note", "바다 보임");
  await page.click("#pe-save");
  await page.waitForTimeout(600);

  eq((await card().locator(".card-name").textContent()).trim().split("\n")[0].trim(),
    "오붓한 강릉", "★ 이름이 바뀐다");
  ok((await card().textContent()).includes("바다 보임"), "메모가 들어간다");
  ok((await card().textContent()).includes("4인"), "인원이 들어간다");

  eq((await card().locator(".vote-count").textContent()).trim(), "1",
    "★★ 고쳐도 투표가 그대로 남는다 (지우고 다시 넣으면 사라집니다)");

  /* 새로고침해도 남아 있어야 진짜 저장된 것입니다.
     (토큰이 남아 있어 게이트는 다시 안 뜹니다 — enter 를 또 부르면 안 됩니다) */
  await page.reload();
  await page.locator("#lodging-list .card").first()
    .waitFor({ state: "visible", timeout: 10000 });
  ok((await card().textContent()).includes("오붓한 강릉"),
    "★ 새로고침해도 고친 이름이 남는다");

  /* 이름을 비우면 막아야 합니다 */
  await card().locator("[data-edit]").click();
  await page.locator("#place-edit").waitFor({ state: "visible", timeout: 5000 });
  await page.fill("#pe-name", "   ");
  await page.click("#pe-save");
  await page.waitForTimeout(300);
  ok(await page.locator("#place-edit").isVisible(), "이름을 비우면 창이 안 닫힌다");
  ok(await page.locator("#pe-err").isVisible(), "   왜 안 되는지 알려준다");
  await page.click("#pe-cancel");
  await page.waitForTimeout(200);
  ok((await card().textContent()).includes("오붓한 강릉"), "취소하면 그대로다");

  /* ★★ 맛집은 식당인지 카페인지 고칠 수 있어야 합니다.

     이 기능이 생긴 진짜 이유입니다. 이름으로 검색해서 추가하면
     식당·카페·관광 중 뭔지 모르는 채로 들어옵니다.

     반대로 "1박 가격" 은 맛집에 물어볼 것이 아닙니다. 숨긴 칸을
     같이 보내면 place_edit 가 그 빈 값으로 멀쩡한 값을 지웁니다. */
  await page.click('#tabs a[data-tab="food"]');
  await page.waitForTimeout(300);

  const foodBox = "#adder-food";
  if (!(await page.locator(`${foodBox} .a-q`).isVisible())) {
    await page.click(`${foodBox} summary`);
    await page.locator(`${foodBox} .a-q`).waitFor({ state: "visible", timeout: 5000 });
  }
  await page.fill(`${foodBox} .a-q`, "https://map.kakao.com/link/map/테라로사,37.7390,128.8760");
  await page.click(`${foodBox} .a-find`);
  await page.waitForTimeout(700);

  const fcard = () => page.locator("#food-list .card", { hasText: "테라로사" });
  await fcard().locator("[data-edit]").click();
  await page.locator("#place-edit").waitFor({ state: "visible", timeout: 5000 });

  ok(await page.locator("#pe-kind-row").isVisible(), "★ 맛집에는 분류 칸이 나온다");
  eq(await page.locator("#pe-stay-row").isVisible(), false,
    '★ 맛집에는 "1박 가격" 이 안 나온다');

  await page.selectOption("#pe-kind", "cafe");
  await page.click("#pe-save");
  await page.waitForTimeout(600);

  ok((await fcard().textContent()).includes("카페"), "★ 식당을 카페로 고칠 수 있다");

  /* 숙소는 반대 — 가격은 나오고 분류는 안 나옵니다 */
  await page.click('#tabs a[data-tab="stay"]');
  await page.waitForTimeout(300);
  await card().locator("[data-edit]").click();
  await page.locator("#place-edit").waitFor({ state: "visible", timeout: 5000 });
  ok(await page.locator("#pe-stay-row").isVisible(), "숙소에는 1박 가격이 나온다");
  eq(await page.locator("#pe-kind-row").isVisible(), false, "   숙소에는 분류 칸이 없다");
  eq(await page.inputValue("#pe-price"), "180000", "   아까 넣은 가격이 그대로다");
  await page.click("#pe-cancel");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   지도 범례가 위쪽 탭을 가리지 않는다

   ★ 사장님이 캡처로 잡아주신 것:
     숙소 탭에서 스크롤하면 지도 위에 떠 있는 "전부 / 숙소만 /
     관광지만" 알약이 위에 붙어 있는 숙소·맛집 탭을 덮었습니다.

   범례는 z-index:400, 상단바는 20 입니다. 지도 안에 있으니
   괜찮을 것 같지만, 감싸는 .map-wrap 이 position:relative 만 있고
   z-index 가 없으면 "쌓임 맥락"을 만들지 않습니다. 그러면 400 이
   지도 안이 아니라 페이지 전체에서 겨뤄서 상단바를 이깁니다.

   눈으로만 보면 스크롤을 특정 위치까지 내렸을 때만 보이는
   문제라 놓치기 쉽습니다. 실제로 그 자리에서 무엇이 손에 닿는지
   (elementFromPoint) 로 잽니다 — 보이기만 하는 게 아니라
   눌리기까지 하니까요.
   ============================================================ */
console.log("── 지도 범례 vs 위쪽 탭");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, { title: "범례 겹침" }));
  await enter(page);
  await page.waitForTimeout(400);

  const legend = page.locator(".map-wrap .map-legend").first();
  await legend.waitFor({ state: "visible", timeout: 5000 });

  /* ★ 후보를 몇 개 넣어 페이지를 길게 만듭니다.
     빈 방은 내용이 화면보다 짧아서 스크롤 자체가 안 됩니다 —
     그러면 "겹치는 지점까지 내렸다" 가 영영 false 가 됩니다. */
  const addStay = async (name, lat, lng) => {
    const box = "#adder-stay";
    if (!(await page.locator(`${box} .a-q`).isVisible())) {
      await page.click(`${box} summary`);
      await page.locator(`${box} .a-q`).waitFor({ state: "visible", timeout: 5000 });
    }
    await page.fill(`${box} .a-q`, `https://map.kakao.com/link/map/${name},${lat},${lng}`);
    await page.click(`${box} .a-find`);
    await page.waitForTimeout(700);
  };
  await addStay("경포펜션", 37.7956, 128.9142);
  await addStay("강릉역호텔", 37.7640, 128.8990);
  await addStay("정동진스테이", 37.6900, 129.0340);
  await page.waitForTimeout(300);

  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight);
  ok(scrollable > 120, `페이지가 스크롤될 만큼 길다  (${scrollable}px)`);

  /* 더듬지 않고, 범례 가운데가 상단바 가운데에 오도록 바로 내립니다 */
  const r = await page.evaluate(() => {
    const lg = document.querySelector(".map-wrap .map-legend");
    const bar = document.querySelector(".topbar");
    const a = lg.getBoundingClientRect(), b = bar.getBoundingClientRect();
    const want = (a.top + window.scrollY + a.height / 2) - b.height / 2;
    window.scrollTo(0, want);
    return { want, max: document.documentElement.scrollHeight - window.innerHeight };
  });
  await page.waitForTimeout(200);

  ok(r.want <= r.max + 1,
    `겹치는 자리까지 내릴 수 있다  (필요 ${r.want.toFixed(0)}px ≤ 가능 ${r.max.toFixed(0)}px)`);

  const hit = await page.evaluate(() => {
    const lg = document.querySelector(".map-wrap .map-legend");
    const bar = document.querySelector(".topbar");
    const a = lg.getBoundingClientRect(), b = bar.getBoundingClientRect();
    const x = a.left + a.width / 2, y = a.top + a.height / 2;
    const el = document.elementFromPoint(x, y);
    return {
      inBar: y >= b.top && y <= b.bottom,
      onLegend: !!(el && el.closest(".map-legend")),
      onBar: !!(el && el.closest(".topbar")),
      tag: el ? String(el.className || el.tagName) : "없음",
      y: +y.toFixed(0), barBottom: +b.bottom.toFixed(0),
    };
  });

  ok(hit.inBar,
    `범례가 상단바와 겹친다  (범례 가운데 y=${hit.y}, 상단바 아래 ${hit.barBottom})`);
  ok(!hit.onLegend,
    `★ 겹치는 자리에서 손에 닿는 것이 범례가 아니다  (닿은 것: ${hit.tag})`);
  ok(hit.onBar,
    "   상단바(탭)가 범례보다 위에 있다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   주소로 추가 + 예약 링크

   ★ 사장님이 실제로 겪은 문제:
     이름으로 검색해 숙소를 추가하면 카카오가 준 링크가 붙어서
     "보러가기"가 카카오맵으로 갑니다. 위치는 정확하지만 예약을
     할 수가 없습니다. 그리고 네이버·에어비앤비 링크에는 좌표가
     없어서(브라우저는 남의 사이트를 못 읽습니다) 지도에 안 뜹니다.
   ============================================================ */
console.log("── 주소로 추가 · 예약 링크");
{
  const ADDR = "강원특별자치도 강릉시 사천면 가둔지길 24";
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await stubConfig(ctx, { KAKAO_JS_KEY: "0".repeat(32) });
  await ctx.addInitScript({ content: STUB });
  await ctx.addInitScript({ content: `window.__stubPlaces = ${JSON.stringify({
    address: {
      [ADDR]: [{
        x: "128.8780", y: "37.8250",
        road_address: { address_name: ADDR, building_name: "오붓한강릉" },
        address: { address_name: "강릉시 사천면 가둔지리 123" },
      }],
    },
  })};` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await openRoom(page, await makeRoom(page, { title: "주소 추가" }));
  await enter(page);

  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", ADDR);
  await page.fill("#adder-stay .a-url", "https://www.airbnb.co.kr/rooms/12345678");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(600);

  ok((await page.locator("#adder-stay .a-status").textContent()).includes("주소로 찾았어요"),
    "도로명 주소로 찾아준다");
  eq(await page.locator("#adder-stay .a-hits li").count(), 1, "후보가 하나 나온다");

  await page.locator("#adder-stay .a-hits button").first().click();
  await page.waitForTimeout(700);

  eq(await page.locator("#lodging-list .card").count(), 1, "주소만으로 숙소가 추가된다");
  const link = await page.locator("#lodging-list .card .btn-link").first().getAttribute("href");
  eq(link, "https://www.airbnb.co.kr/rooms/12345678",
    "★ 보러가기가 내가 적은 예약 링크로 간다 (카카오맵이 아니라)");

  /* 좌표가 제대로 들어갔는지 — 지도에 떠야 의미가 있습니다 */
  await page.locator("#lodging-list .card .card-name").first().click();
  await page.waitForTimeout(400);
  const c = await page.evaluate(() => {
    const m = window.__kmaps && window.__kmaps["map-stay"];
    return m ? m.__center().map((v) => v.toFixed(4)).join(",") : "없음";
  });
  eq(c, "37.8250,128.8780", "주소가 좌표로 바뀌어 지도에 뜬다");

  /* 링크를 안 적으면 예전처럼 동작 */
  await page.fill("#adder-stay .a-q", ADDR);
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(600);
  await page.locator("#adder-stay .a-hits button").first().click();
  await page.waitForTimeout(700);
  eq(await page.locator("#lodging-list .card").count(), 2, "링크 없이도 추가된다");

  /* 이상한 링크는 막는다 */
  await page.fill("#adder-stay .a-q", ADDR);
  await page.fill("#adder-stay .a-url", "그냥 글자");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(600);
  await page.locator("#adder-stay .a-hits button").first().click();
  await page.waitForTimeout(500);
  ok((await page.locator("#adder-stay .a-status").textContent()).includes("https://"),
    "링크 모양이 아니면 알려준다");
  eq(await page.locator("#lodging-list .card").count(), 2, "그때는 추가되지 않는다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   맛집 지도에서 식당이 묻히지 않는가

   ★ 사장님 말: "관광지 때문에 식당이 어디 있는지 잘 안 보여"

     원인이 셋이었다. 관광지를 식당과 똑같은 크기·이름표로 그렸고,
     지도 범위를 관광지까지 포함해 맞춰서 식당들이 깨알만 해졌고,
     위의 필터가 목록만 거르고 지도는 그대로 뒀다.
   ============================================================ */
console.log("── 맛집 지도 — 관광지에 묻히지 않기");
{
  const SEED = [
    { place_name: "경포대", x: "128.8963", y: "37.7955", address_name: "강릉" },
    { place_name: "오죽헌", x: "128.8783", y: "37.7792", address_name: "강릉" },
    { place_name: "정동진", x: "129.0335", y: "37.6908", address_name: "강릉" },
  ];
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await stubConfig(ctx, { KAKAO_JS_KEY: "0".repeat(32) });
  await ctx.addInitScript({ content: STUB });
  await ctx.addInitScript({ content:
    `window.__stubPlaces = ${JSON.stringify({ category: { AT4: SEED } })};` });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await openRoom(page, await makeRoom(page, { title: "지도 정리" }));
  await enter(page);
  await page.click('#tabs a[data-tab="food"]');
  await page.waitForTimeout(500);

  const addFood = async (name, lat, lng) => {
    const box = "#adder-food";
    if (!(await page.locator(`${box} .a-q`).isVisible())) {
      await page.click(`${box} summary`);
      await page.locator(`${box} .a-q`).waitFor({ state: "visible", timeout: 5000 });
    }
    await page.fill(`${box} .a-q`, `https://map.kakao.com/link/map/${name},${lat},${lng}`);
    await page.click(`${box} .a-find`);
    await page.waitForTimeout(700);
  };
  await addFood("초당순두부", 37.7956, 128.9142);

  const pins = () => page.evaluate(() => {
    const layer = document.querySelector("#map-food .stub-layer");
    const nodes = [...(layer ? layer.children : [])];
    return {
      식당: nodes.filter((n) => n.querySelector(".pin-food")).length,
      관광지: nodes.filter((n) => n.querySelector(".pin-spot")).length,
      큰이름표: nodes.filter((n) => n.querySelector(".pin-label:not(.sm)")).length,
    };
  });

  const before = await pins();
  ok(before.식당 >= 1, `직접 추가한 식당이 또렷한 핀으로 뜸  (${before.식당}개)`);
  ok(before.관광지 >= 1, `관광지도 같이 뜸  (${before.관광지}개)`);
  eq(before.큰이름표, before.식당,
    "★ 큰 이름표는 직접 추가한 곳에만 (관광지는 작은 글씨로 물러남)");

  /* 필터가 지도에도 걸리는가 */
  await page.click('#food-filters [data-cat="food"]');
  await page.waitForTimeout(400);
  const onlyFood = await pins();
  eq(onlyFood.관광지, 0, "★ '식당'을 누르면 지도에서도 관광지가 사라진다");
  ok(onlyFood.식당 >= 1, "식당은 그대로 남는다");

  await page.click('#food-filters [data-cat="all"]');
  await page.waitForTimeout(400);
  ok((await pins()).관광지 >= 1, "'전부'로 되돌리면 관광지가 다시 보인다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   에어비앤비 링크 — 막다른 길로 두지 않는다

   ★ 에어비앤비는 예약 전까지 정확한 위치를 안 알려주고 지도에
     동그라미만 보여줍니다. 링크에도 페이지에도 좌표가 없어서
     서버가 있어도 못 가져옵니다.

     그런데 그 동그라미를 보고 사용자가 직접 찍으면 정확도가
     똑같습니다. 그러니 "안 돼요"로 끝내지 말고 바로 이어줘야
     합니다 — 링크는 예약 칸으로 옮기고, 지도를 찍기 모드로.
   ============================================================ */
console.log("── 에어비앤비 링크");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, { title: "에어비앤비" }));
  await enter(page);

  const AIR = "https://www.airbnb.co.kr/rooms/53302736?adults=4&check_in=2027-01-23"
            + "&scroll_to_review=1712155966852771718";

  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", AIR);
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(700);

  const msg = await page.locator("#adder-stay .a-status").textContent();
  ok(msg.includes("동그라미"), "왜 안 되는지, 뭐가 같은지 설명한다");
  ok(!msg.includes("못 찾았어요"), "사용자 잘못처럼 말하지 않는다");

  eq(await page.locator("#adder-stay .a-url").inputValue(), AIR,
    "★ 붙여넣은 링크가 '예약 링크' 칸으로 옮겨진다");
  eq(await page.locator("#adder-stay .a-q").inputValue(), "",
    "검색칸은 비워서 이름을 받을 준비를 한다");
  eq(await page.locator("#adder-stay .a-hits").isVisible(), false,
    "엉뚱한 후보를 보여주지 않는다");

  /* 이름을 적고 지도를 찍으면 추가된다 */
  await page.fill("#adder-stay .a-q", "사천해변 에어비앤비");
  /* 지도 "바탕"을 누릅니다. 좌표로 누르면 관광지 핀 위에 떨어지기
     쉽고, 핀 클릭은 지도 클릭이 아니라 무시됩니다. */
  await page.locator("#map-stay").dispatchEvent("click");
  await page.waitForTimeout(800);

  eq(await page.locator("#lodging-list .card").count(), 1, "지도에서 찍어 추가된다");
  ok((await page.locator("#lodging-list").textContent()).includes("대략 위치"),
    "대략 위치라고 솔직하게 표시한다");
  eq(await page.locator("#lodging-list .btn-link").first().getAttribute("href"), AIR,
    "★ 보러가기가 에어비앤비 예약 페이지로 간다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   사진 갤러리

   ★ R2 설정이 없는 상태입니다. 그때도 화면이 돌아가되,
     "이 브라우저에만 저장된다"고 솔직히 말해야 합니다.
     조용히 로컬에 쌓아두면 친구들에게 안 보이는 걸 모른 채
     수십 장을 올리게 됩니다.
   ============================================================ */
console.log("── 사진 갤러리");
{
  const { ctx, page, errors } = await fresh();
  await openRoom(page, await makeRoom(page, { title: "사진 시험" }));
  await enter(page);

  await page.click('#tabs a[data-tab="photo"]');
  await page.waitForSelector("#panel-photo:not([hidden])", { timeout: 5000 });

  eq(await page.locator("#photo-empty").isVisible(), true, "처음에는 '아직 사진이 없어요'");
  ok((await page.locator("#photo-intro").textContent()).includes("이 브라우저에만"),
    "★ 보관함이 없으면 친구들에게 안 보인다고 솔직하게 말한다");

  /* 사진 올리기 — GPS 가 박힌 사진으로 */
  await page.setInputFiles("#photo-input", {
    name: "trip.jpg", mimeType: "image/jpeg", buffer: Buffer.from(gpsJpegBytes()),
  });
  await page.waitForTimeout(1500);

  eq(await page.locator(".photo-cell").count(), 1, "사진이 한 장 올라간다");
  eq(await page.locator("#photo-empty").isVisible(), false, "안내가 사라진다");
  ok((await page.locator("#photo-status").textContent()).includes("줄였어요"),
    "얼마나 줄였는지 알려준다");
  ok((await page.locator("#photo-left").textContent()).includes("1장"),
    "몇 장인지 보여준다");

  /* 크게 보기 */
  await page.locator(".photo-cell").first().click();
  await page.waitForTimeout(400);
  eq(await page.locator("#photo-view").isVisible(), true, "누르면 크게 보인다");

  /* ★ 사진이 먼저 보여야 합니다.

     <dialog> 는 열릴 때 "처음 누를 수 있는 요소" 로 포커스를 옮기고
     브라우저가 그 자리로 스크롤합니다. 우리 상자에서는 그게 댓글
     입력칸이라, 폰에서 사진을 누르면 사진은 안 보이고 "한마디
     남기기" 부터 떴습니다. */
  {
    const v = await page.evaluate(() => {
      const dlg = document.querySelector("#photo-view");
      const img = document.querySelector("#photo-big");
      const r = img.getBoundingClientRect();
      return {
        dlgScroll: dlg.scrollTop,
        imgTop: Math.round(r.top),
        imgBottom: Math.round(r.bottom),
        winH: window.innerHeight,
        focused: (document.activeElement && document.activeElement.className) || "",
      };
    });
    eq(v.dlgScroll, 0, "★ 상자가 맨 위에서 열린다 (아래로 안 밀림)");
    ok(v.imgTop >= -2, `사진 윗부분이 잘리지 않는다  (위 ${v.imgTop}px)`);
    ok(v.imgTop < v.winH * 0.6,
      `사진이 화면 안에 들어와 있다  (위 ${v.imgTop}px / 화면 ${v.winH}px)`);
    ok(!/cmt-input/.test(v.focused),
      `댓글칸으로 바로 뛰지 않는다  (포커스: ${v.focused || "상자"})`);
  }
  eq(await page.locator("#photo-del").isVisible(), true, "내가 올린 사진은 지울 수 있다");
  eq(await page.locator("#photo-save").isVisible(), true,
    "사진을 폰에 저장할 수 있다 (주소는 못 넘겨도 사진은 받을 수 있어야 합니다)");

  /* 사진에 댓글 */
  let asked = 0;
  page.on("dialog", async (d) => {
    if (d.type() === "prompt") { asked++; await d.accept("민수"); }
    else await d.accept();
  });
  await page.locator("#photo-cmt-form .cmt-input").fill("여기 진짜 예뻤다");
  await page.locator("#photo-cmt-go").click();
  await page.waitForTimeout(800);
  ok((await page.locator("#photo-cmts").textContent()).includes("여기 진짜 예뻤다"),
    "사진에 댓글을 달 수 있다");
  ok((await page.locator("#photo-cmts").textContent()).includes("민수"), "별명이 보인다");

  /* ★ 엔터로도 달려야 합니다.

     이 칸은 <form method="dialog"> 안에 있어서, 가로채지 않으면
     엔터가 "상자 닫기" 로 처리됩니다. 댓글을 쓰려다 사진이
     닫히는 거라, 실제로 겪으면 꽤 당황스럽습니다. */
  await page.locator("#photo-cmt-form .cmt-input").fill("엔터로 남긴 댓글");
  await page.locator("#photo-cmt-form .cmt-input").press("Enter");
  await page.waitForTimeout(800);

  eq(await page.locator("#photo-view").isVisible(), true,
    "★ 엔터를 눌러도 사진이 닫히지 않는다");
  ok((await page.locator("#photo-cmts").textContent()).includes("엔터로 남긴 댓글"),
    "★ 엔터로 댓글이 달린다");
  eq(await page.locator("#photo-cmts .cmt-list li").count(), 2, "댓글이 2개가 된다");
  eq(await page.locator("#photo-cmt-form .cmt-input").inputValue(), "",
    "보내고 나면 칸이 비워진다");

  /* 빈 칸에서 엔터를 눌러도 닫히면 안 됩니다 */
  await page.locator("#photo-cmt-form .cmt-input").press("Enter");
  await page.waitForTimeout(300);
  eq(await page.locator("#photo-view").isVisible(), true,
    "빈 칸에서 엔터를 눌러도 닫히지 않는다");
  eq(await page.locator("#photo-cmts .cmt-list li").count(), 2, "빈 댓글은 안 달린다");

  await page.locator("#photo-view button[type=submit]").click();
  await page.waitForTimeout(300);
  ok((await page.locator(".photo-cell").first().textContent()).includes("2"),
    "목록에 댓글 개수가 보인다");

  /* 새로고침해도 남아 있는가 */
  await page.reload();
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.click('#tabs a[data-tab="photo"]');
  await page.waitForTimeout(600);
  eq(await page.locator(".photo-cell").count(), 1, "새로고침해도 사진이 남아 있음");

  /* 지우기 */
  await page.locator(".photo-cell").first().click();
  await page.waitForTimeout(300);
  await page.locator("#photo-del").click();
  await page.waitForTimeout(800);
  eq(await page.locator(".photo-cell").count(), 0, "내가 올린 사진을 지울 수 있다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   사진 — 여행 중에는 더 강하게 말린다

   ★ "우리가 지금 여기 있다"가 위험한 것이지, 다녀온 뒤 사진은
     추억입니다. 그래서 끝난 날짜를 보고 문구를 바꿉니다.
     안내를 늘 똑같이 띄우면 아무도 안 읽습니다.
   ============================================================ */
console.log("── 사진 — 여행 중 경고");
{
  const future = (days) => {
    const d = new Date(Date.now() + days * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const past = (days) => future(-days);

  /* 아직 안 끝난 여행 */
  {
    const { ctx, page } = await fresh();
    await openRoom(page, await makeRoom(page, {
      title: "다가오는 여행", start: future(10), end: future(12),
    }));
    await enter(page);
    await page.click('#tabs a[data-tab="photo"]');
    await page.waitForTimeout(500);
    const w = await page.locator("#photo-warn").textContent();
    ok(w.includes("여행이 끝난 뒤에"), "여행 전에는 '끝난 뒤에 올리세요'");
    ok(w.includes("지금 어디에 있는지"), "왜 그런지도 말해준다");
    ok(await page.locator("#photo-warn.strong").count() === 1, "눈에 띄게 표시된다");
    await ctx.close();
  }

  /* 이미 끝난 여행 */
  {
    const { ctx, page } = await fresh();
    await openRoom(page, await makeRoom(page, {
      title: "다녀온 여행", start: past(12), end: past(10),
    }));
    await enter(page);
    await page.click('#tabs a[data-tab="photo"]');
    await page.waitForTimeout(500);
    const w = await page.locator("#photo-warn").textContent();
    ok(!w.includes("여행이 끝난 뒤에"), "다녀온 뒤에는 그 말을 안 한다");
    ok(w.includes("누구나 볼 수 있어요"), "대신 공유 범위는 계속 알려준다");
    eq(await page.locator("#photo-warn.strong").count(), 0, "경고 수위가 낮아진다");
    await ctx.close();
  }
}


/* ============================================================
   사진은 올린 사람만 지운다

   ★ 브라우저를 따로 쓰면 다른 사람입니다 (저장소가 분리됩니다).
     남이 올린 사진에는 지우기 버튼이 아예 안 보여야 하고,
     버튼을 숨기는 것만으로는 부족하므로 서버도 막습니다
     (tests/sql/test.sql 9.9 에서 확인합니다).
   ============================================================ */
console.log("── 사진 — 올린 사람만 지우기");
{
  const a = await fresh();
  await openRoom(a.page, await makeRoom(a.page, { title: "사진 권한" }));
  await enter(a.page);
  await a.page.click('#tabs a[data-tab="photo"]');
  await a.page.waitForSelector("#panel-photo:not([hidden])", { timeout: 5000 });
  await a.page.setInputFiles("#photo-input", {
    name: "mine.jpg", mimeType: "image/jpeg", buffer: Buffer.from(gpsJpegBytes()),
  });
  await a.page.waitForTimeout(1500);

  await a.page.locator(".photo-cell").first().click();
  await a.page.waitForTimeout(400);
  eq(await a.page.locator("#photo-del").isVisible(), true,
    "내가 올린 사진에는 '사진 지우기' 가 보인다");
  eq(await a.page.locator("#photo-save").isVisible(), true,
    "저장 버튼도 함께 보인다");

  await a.page.keyboard.press("Escape");
  await a.page.waitForTimeout(200);

  /* ★ 남이 올린 사진을 실제로 만들어 봅니다.

     저장된 방에 "다른 사람이 올린" 사진을 한 장 끼워 넣고 다시
     읽게 합니다. 화면 코드가 mine 을 보고 버튼을 숨기는지,
     진짜로 확인하는 방법입니다. */
  const slug = await a.page.evaluate(() => {
    const u = new URL(location.href);
    return (u.searchParams.get("r") || "").toUpperCase();
  });
  await a.page.evaluate((slug) => {
    const key = `trip.local.${slug}`;
    const box = JSON.parse(localStorage.getItem(key));
    const mine = box.photos[0];
    box.photos.push({
      ...mine,
      id: "ph-someone-else",
      caption: "친구가 올린 사진",
      created_by: "다른-사람",          /* 내 voter 와 다릅니다 */
    });
    localStorage.setItem(key, JSON.stringify(box));
  }, slug);

  await a.page.reload();
  await a.page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await a.page.waitForTimeout(400);
  await a.page.click('#tabs a[data-tab="photo"]');
  await a.page.waitForTimeout(600);
  eq(await a.page.locator(".photo-cell").count(), 2, "사진이 두 장 보인다");

  /* 두 번째(친구 것)를 열어봅니다 */
  await a.page.locator(".photo-cell").nth(1).click();
  await a.page.waitForTimeout(400);
  /* ★ 이 브라우저에만 저장하는 모드에서는 쓰는 사람이 곧 방장이라,
     친구가 올린 사진에도 버튼이 보이는 게 맞습니다. 방장이 아닌
     친구에게 안 보이는 것은 서버 쪽 규칙이고 tests/sql/test.sql
     9.9 가 지킵니다. */
  eq(await a.page.locator("#photo-del").isVisible(), true,
    "★ 방장이면 친구가 올린 사진도 지울 수 있다");
  eq(await a.page.locator("#photo-save").isVisible(), true,
    "그래도 저장은 할 수 있다");

  /* 화면을 속여도 서버가 막습니다 (SQL 테스트 9.9 와 짝입니다) */
  const blocked = await a.page.evaluate(async () => {
    const { createStore } = await import("/app/assets/store.js");
    const { getToken } = await import("/app/assets/session.js");
    const u = new URL(location.href);
    const slug = (u.searchParams.get("r") || "").toUpperCase();
    const s = createStore(slug);
    s.setToken(getToken(slug));          /* 새로 만든 store 라 직접 넣어줍니다 */
    try { await s.photoRemove("ph-someone-else"); return "지워짐"; }
    catch (e) { return e.message; }
  });
  eq(blocked, "지워짐", `★ 방장이므로 실제로 지워진다  (${blocked})`);

  await a.ctx.close();
}


/* ============================================================
   사진 함수가 "누가 보는지" 를 DB 에 넘기는가

   ★ 실제로 겪은 버그입니다.

     Edge Function 이 photo_list 를 부를 때 p_voter 에 빈 문자열을
     넣었습니다. 주소만 만들면 되니 필요 없다고 봤는데, photo_list
     는 그 값으로 "내가 올린 사진인가"(mine) 를 정합니다. 빈 값이면
     모든 사진이 남의 것이 되고, 자기가 올린 사진에도 지우기 버튼이
     안 나옵니다.

     함수를 여기서 돌려볼 수는 없으므로, 클라이언트가 voter 를
     실제로 보내는지와 함수 코드가 그걸 넘기는지를 각각 봅니다.
   ============================================================ */
console.log("── 사진 함수에 보는 사람 전달");
{
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await stubConfig(ctx, FAKE_SUPABASE);
  await ctx.addInitScript({ content: STUB });

  let sent = null;
  await ctx.route("**/functions/v1/**", async (route) => {
    sent = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, photos: [], comments: [], cap: 300, used: 0 }),
    });
  });
  /* 방 입장·스냅샷은 가짜로 통과시킵니다 */
  await ctx.route("**/rest/v1/rpc/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

  const page = await ctx.newPage();
  await page.goto(`${BASE}/app/room.html`);
  const got = await page.evaluate(async () => {
    const { createStore } = await import("/app/assets/store.js");
    const s = createStore("B2C3D4F5G");
    s.setToken("t".repeat(44));
    await s.photoList();
    return s.voter;
  });

  ok(sent && sent.mode === "view", "보기 요청을 보낸다");
  ok(sent && typeof sent.voter === "string" && sent.voter.length > 0,
    `★ 보는 사람(voter)을 함께 보낸다  (${sent && sent.voter ? sent.voter.slice(0, 12) + "…" : "안 보냄"})`);
  eq(sent && sent.voter, got, "보낸 값이 이 브라우저의 투표자 식별자와 같다");
  await ctx.close();
}

{
  /* 함수 코드가 그 값을 DB 로 넘기는지 — 빈 문자열로 되돌아가면 잡습니다 */
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)),
         "..", "supabase", "functions", "photo-upload-url", "index.ts"), "utf8");
  ok(/p_voter:\s*voter/.test(src),
    "★ 함수가 photo_list 에 보는 사람을 넘긴다");
  ok(!/p_voter:\s*""/.test(src),
    "빈 문자열로 넘기지 않는다 (그러면 모든 사진이 남의 것이 됩니다)");
}


/* ============================================================
   사진이 늦게 도착해도 사진부터 보인다

   ★ 사장님이 두 번 말씀하신 증상입니다.

     사진은 나중에 도착합니다. 그 전에는 사진 자리가 비어 있어서
     댓글칸이 위로 올라와 있고, 사진이 도착하며 아래로 밀려날 때
     브라우저가 "보던 것(댓글)"을 따라 같이 스크롤합니다.
     그래서 사진은 화면 위로 사라지고 "한마디 남기기" 만 보입니다.

     앞선 수정(포커스·scrollTop)만으로는 못 막습니다 — 그 시점엔
     아직 사진이 안 왔으니까요. 느리게 오는 사진으로 확인합니다.
   ============================================================ */
console.log("── 사진이 늦게 와도 사진부터");
{
  const { ctx, page, errors } = await fresh();

  await openRoom(page, await makeRoom(page, { title: "느린 사진" }));
  await enter(page);
  await page.click('#tabs a[data-tab="photo"]');
  await page.waitForSelector("#panel-photo:not([hidden])", { timeout: 5000 });
  await page.setInputFiles("#photo-input", {
    name: "slow.jpg", mimeType: "image/jpeg", buffer: Buffer.from(gpsJpegBytes()),
  });
  await page.waitForTimeout(1800);

  await page.locator(".photo-cell").first().click();

  /* 열자마자, 그리고 사진이 도착한 뒤 — 두 시점 모두 확인합니다 */
  const look = () => page.evaluate(() => {
    const dlg = document.querySelector("#photo-view");
    const img = document.querySelector("#photo-big");
    const r = img.getBoundingClientRect();
    const cmt = document.querySelector("#photo-cmt-form");
    const cr = cmt ? cmt.getBoundingClientRect() : null;
    return {
      scroll: dlg.scrollTop,
      imgTop: Math.round(r.top), imgH: Math.round(r.height),
      cmtTop: cr ? Math.round(cr.top) : null,
      loaded: img.complete && img.naturalWidth > 0,
    };
  });

  await page.waitForTimeout(150);
  const early = await look();
  eq(early.scroll, 0, "열자마자 맨 위에 있다");
  ok(early.imgTop < (early.cmtTop ?? 1e9),
    `사진이 댓글칸보다 위에 있다  (사진 ${early.imgTop} / 댓글 ${early.cmtTop})`);

  await page.waitForTimeout(600);
  const late = await look();
  ok(late.loaded, "사진이 도착했다");
  eq(late.scroll, 0, "사진이 도착한 뒤에도 맨 위 그대로");
  ok(late.imgTop >= -2, `사진 윗부분이 안 잘린다  (위 ${late.imgTop}px)`);
  ok(late.imgH > 50, `사진이 제대로 자리를 차지한다  (높이 ${late.imgH}px)`);
  ok(late.imgTop < late.cmtTop, "사진이 댓글칸보다 위에 있다");

  /* ★ 여기서부터가 진짜 검사입니다.

     이 브라우저에만 저장하는 모드에서는 사진이 data URL 이라 즉시
     뜹니다. 그래서 "늦게 도착하는" 상황을 로컬에서는 만들 수
     없습니다. 대신 그걸 막는 두 장치가 실제로 걸려 있는지 봅니다 —
     장치가 사라지면 서버 모드에서 증상이 그대로 돌아옵니다. */
  const guards = await page.evaluate(() => {
    const dlg = document.querySelector("#photo-view");
    const box = document.querySelector("#photo-view .photo-box");
    const img = document.querySelector("#photo-big");
    return {
      anchorDlg: getComputedStyle(dlg).overflowAnchor,
      anchorBox: getComputedStyle(box).overflowAnchor,
      ratio: img.style.aspectRatio || "",
      maxH: getComputedStyle(img).maxHeight,
      fit: getComputedStyle(img).objectFit,
    };
  });
  eq(guards.anchorDlg, "none",
    "★ 상자에 '스크롤 따라가기' 가 꺼져 있다 (사진이 밀고 들어와도 안 따라감)");
  eq(guards.anchorBox, "none", "안쪽에도 꺼져 있다");
  ok(/^\d+\s*\/\s*\d+$/.test(guards.ratio),
    `★ 사진 자리를 미리 잡아둔다  (비율 ${guards.ratio || "없음"})`);
  ok(guards.maxH !== "none", `사진 높이가 화면에 맞게 묶여 있다  (${guards.maxH})`);
  eq(guards.fit, "contain", "비율을 깨지 않고 맞춘다");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   방장은 친구가 올린 것도 지울 수 있다

   ★ 서버는 처음부터 방장에게 열어뒀는데(네 곳 모두), 화면이
     "내 것" 일 때만 버튼을 보여줘서 그 권한을 쓸 수가 없었습니다.
     열어둔 문 앞에 손잡이가 없던 셈입니다.

   ★ 브라우저마다 다른 사람인 게 핵심입니다. 폰에서 올린 사진은
     같은 사람이라도 컴퓨터에서는 "남의 것" 입니다. 방장이 아니면
     자기가 올린 것도 다른 기기에서는 못 지웁니다 — 그게 익명을
     지키는 대가이고, 방장만 예외입니다.
   ============================================================ */
console.log("── 방장은 친구 것도 지울 수 있다");
{
  const { ctx, page } = await fresh();
  const url = await makeRoom(page, { title: "방장 권한" });
  await openRoom(page, url);
  await enter(page);

  /* 친구가 올린 장소를 하나 만들어 둡니다 */
  await page.click("#adder-stay summary");
  await page.fill("#adder-stay .a-q", "https://map.kakao.com/link/map/친구숙소,37.8250,128.8780");
  await page.click("#adder-stay .a-find");
  await page.waitForTimeout(700);

  const slug = new URL(url).searchParams.get("r").toUpperCase();
  await page.evaluate((slug) => {
    const key = `trip.local.${slug}`;
    const box = JSON.parse(localStorage.getItem(key));
    box.places[0].created_by = "다른-사람";      /* 남이 넣은 것으로 */
    localStorage.setItem(key, JSON.stringify(box));
  }, slug);

  await page.reload();
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(500);

  /* 이 브라우저에만 저장하는 모드에서는 내가 곧 방장입니다 */
  const owner = await page.evaluate(() => {
    const el = document.querySelector("#lodging-list .btn-del");
    return { 버튼있음: !!el };
  });
  ok(owner.버튼있음,
    "★ 방장에게는 친구가 올린 것에도 삭제 버튼이 보인다");

  /* 누르면 "친구가 올린 것" 이라고 한 번 더 묻습니다 */
  let asked = "";
  page.once("dialog", async (d) => { asked = d.message(); await d.dismiss(); });
  await page.locator("#lodging-list .btn-del").first().click();
  await page.waitForTimeout(400);
  ok(/친구가 올린 거예요/.test(asked),
    `남의 것을 지울 때는 그렇게 알려준다  (${asked.replace(/\n/g, " ")})`);
  eq(await page.locator("#lodging-list .card").count(), 1,
    "취소하면 안 지워진다");

  await ctx.close();
}

/* ============================================================
   카드를 눌러 확대한 것이 유지되는가

   ★ 사장님이 두 번 말씀하신 증상입니다. 카드를 누르면 확대는
     되는데 금방 전체 지도로 되돌아갑니다.

     되돌리는 길이 두 개 있습니다:
       · 20초마다 도는 갱신(redrawAll)
       · 탭을 나갔다 들어올 때의 refresh()  ← refresh 가 60ms 뒤에
         setBounds 로 전체 범위를 다시 씌웁니다
   ============================================================ */
{
  console.log("── 카드를 눌러 확대한 뒤");
  const a = await fresh();
  const url = await makeRoom(a.page);
  await openRoom(a.page, url);
  await enter(a.page);

  const slug = await a.page.evaluate(() => {
    const u = new URL(location.href);
    return (u.searchParams.get("r") || "").toUpperCase();
  });

  /* 좌표가 있는 숙소 두 곳을 넣습니다 (하나면 확대해도 티가 안 납니다) */
  await a.page.evaluate((slug) => {
    const key = `trip.local.${slug}`;
    const box = JSON.parse(localStorage.getItem(key));
    box.places = box.places || [];
    box.places.push(
      { id: "lg-1", kind: "lodging", name: "경포대 숙소",
        lat: 37.795, lng: 128.896, created_by: "me", created_at: new Date().toISOString() },
      { id: "lg-2", kind: "lodging", name: "정동진 숙소",
        lat: 37.690, lng: 129.034, created_by: "me", created_at: new Date().toISOString() },
    );
    localStorage.setItem(key, JSON.stringify(box));
  }, slug);

  await a.page.reload();
  await a.page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await a.page.waitForTimeout(500);

  const level = () => a.page.evaluate(
    () => (window.__maps && window.__maps.stay ? window.__maps.stay.level() : null));

  await a.page.locator("#lodging-list .card .card-name").first().click();
  await a.page.waitForTimeout(300);
  const zoomed = await level();
  ok(zoomed !== null && zoomed <= 5, `카드를 누르면 확대된다  (단계 ${zoomed})`);

  /* ① 20초마다 도는 갱신이 돌아도 */
  await a.page.evaluate(() => window.__refreshNow());
  await a.page.waitForTimeout(300);
  eq(await level(), zoomed, "★ 갱신이 돌아도 확대가 풀리지 않는다");

  /* ② 탭을 나갔다 들어와도 */
  await a.page.click('#tabs a[data-tab="food"]');
  await a.page.waitForTimeout(200);
  await a.page.click('#tabs a[data-tab="stay"]');
  await a.page.waitForTimeout(400);
  eq(await level(), zoomed, "★ 탭을 나갔다 와도 확대가 풀리지 않는다");

  /* ③ 선택 강조도 살아 있어야 합니다 */
  eq(await a.page.locator("#lodging-list .card.sel").count(), 1,
    "카드 강조가 남아 있다");
  ok(await a.page.evaluate(() => !!document.querySelector(".pin-lodging.sel, .sel .pin-lodging, .sel")),
    "지도 핀 강조도 남아 있다");

  eq(a.errors.length, 0, `콘솔 오류 없음${a.errors.length ? " — " + a.errors[0] : ""}`);
  await a.ctx.close();
}

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
