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
  ok(sub.includes("1박 2일"), `기간도 함께  (${sub.split("친구")[0].trim()})`);
  ok(sub.includes("강릉"), "지역도 함께");
  ok(sub.includes("4명"), "인원도 함께");
  ok(sub.includes("비밀번호"), "무엇을 해야 하는지도 여전히 안내");
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
  ok((await page.locator("#panel-plan").textContent()).includes("곧 열립니다"), "일정 탭 안내");
  await page.click('#tabs a[data-tab="money"]');
  await page.waitForTimeout(300);
  ok((await page.locator("#panel-money").textContent()).includes("곧 열립니다"), "정산 탭 안내");

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

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
