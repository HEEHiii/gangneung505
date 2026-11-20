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

  eq((await count()).trim(), "0표", "처음엔 0표");
  eq(await btn.textContent(), "투표", "버튼 기본 상태");

  await btn.click();
  await page.waitForTimeout(400);
  eq((await count()).trim(), "1표", "누르면 1표");
  eq(await btn.textContent(), "투표함 ✓", "버튼이 바뀐다");
  eq(await btn.getAttribute("aria-pressed"), "true", "스크린리더에도 상태 전달");

  await btn.click();
  await page.waitForTimeout(400);
  eq((await count()).trim(), "0표", "다시 누르면 취소");
  eq(await btn.getAttribute("aria-pressed"), "false", "상태도 되돌아간다");

  /* 새로고침해도 유지 */
  await btn.click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.__roomReady === true, { timeout: 8000 });
  await page.waitForTimeout(600);
  eq((await count()).trim(), "1표", "새로고침해도 투표가 남는다");
  eq(await page.locator("#lodging-list [data-vote]").first().textContent(), "투표함 ✓",
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
  eq((await page.locator("#lodging-list .vote-count").first().textContent()).trim(), "1표",
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

  /* 장소가 없으면 안내 */
  await page.click("#plan-build");
  await page.waitForTimeout(300);
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
  await page.click("#plan-build");
  await page.waitForTimeout(900);

  eq(await page.locator(".plan-day").count(), 3, "3일 여행이면 날짜 칸이 3개");
  eq(await page.locator("#plan-empty").isVisible(), false, "일정이 생기면 안내가 사라짐");
  eq(await page.locator("#plan-share").isVisible(), true, "일정이 생기면 공유 버튼이 보임");
  ok((await page.locator("#plan-note").textContent()).includes("이동시간"),
    "이동시간을 알려줌");
  ok((await page.locator("#plan-note").textContent()).includes("추정"),
    "추정값이라고 솔직하게 밝힘");

  const firstDay = page.locator(".plan-day").first();
  ok((await firstDay.textContent()).includes("도착"), "첫날은 도착으로 시작");
  ok((await page.locator(".plan-day").last().textContent()).includes("귀가"),
    "마지막 날은 귀가로 끝");

  /* 모든 장소가 어딘가에 들어갔는지 */
  const all = await page.locator("#plan-days").textContent();
  for (const n of ["초당순두부", "경포대", "주문진회센터"]) {
    ok(all.includes(n), `${n} 이 일정에 들어감`);
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

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
