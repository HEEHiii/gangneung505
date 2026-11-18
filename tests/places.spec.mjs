/* ============================================================
   places.js 검색 — 브라우저 테스트

   실행: bash tests/run-browser.sh places

   가짜 카카오 SDK 를 씁니다. 가짜가 검색 범위(bounds)를 실제로
   반영하므로 "지역 안에서 먼저 찾고 없으면 전국" 분기가 진짜로
   검증됩니다.
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

/* 카카오가 돌려주는 모양 그대로 (x=경도, y=위도 — 헷갈리기 쉬운 부분) */
const DATA = {
  keyword: {
    "초당순두부": [
      { id: "1", place_name: "초당할머니순두부", x: "128.9110", y: "37.7900",
        road_address_name: "강릉시 초당순두부길 77", category_group_code: "FD6",
        place_url: "http://place.map.kakao.com/1" },
      { id: "2", place_name: "초당순두부 2호점", x: "128.9120", y: "37.7910",
        address_name: "강릉시 초당동", category_group_code: "FD6" },
    ],
    // 강릉 범위 밖 — 부산에만 있습니다
    "밀면": [
      { id: "9", place_name: "부산 밀면집", x: "129.0756", y: "35.1796",
        road_address_name: "부산 중구", category_group_code: "FD6" },
    ],
    "강릉역": [
      { id: "h1", place_name: "강릉역", x: "128.8990", y: "37.7637",
        road_address_name: "강릉시 용지로 176", category_group_code: "SW8" },
    ],
    "테라로사": [
      { id: "t1", place_name: "테라로사 커피공장", x: "128.8686", y: "37.6878",
        road_address_name: "강릉시 구정면", category_group_code: "CE7" },
    ],
  },
  category: {
    AT4: [
      { id: "s1", place_name: "경포해변", x: "128.9105", y: "37.7955", category_group_code: "AT4" },
      { id: "s2", place_name: "오죽헌", x: "128.8780", y: "37.7792", category_group_code: "AT4" },
      { id: "s3", place_name: "해운대", x: "129.1603", y: "35.1587", category_group_code: "AT4" },
    ],
  },
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript({ content: STUB });
await ctx.addInitScript({ content: `window.__stubPlaces = ${JSON.stringify(DATA)};` });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`${BASE}/tests/fixtures/places.html`);
await page.waitForFunction(() => window.__ready === true);

const GN = await page.evaluate(() => window.R.regionByCode("gangneung"));
ok(!!GN, "강릉 지역 정보를 불러옴");

/* ============================================================
   1. 이름으로 검색
   ============================================================ */
console.log("── 이름 검색");
const hits = await page.evaluate((bbox) =>
  window.P.searchByKeyword("초당순두부", { bbox }), GN.bbox);

eq(hits.length, 2, "검색 결과 2건");
eq(hits[0].name, "초당할머니순두부", "이름");
eq(hits[0].lat, 37.79, "위도 (y 를 위도로 제대로 읽음)");
eq(hits[0].lng, 128.911, "경도 (x 를 경도로 제대로 읽음)");
eq(hits[0].kind, "food", "FD6 → food");
eq(hits[0].address, "강릉시 초당순두부길 77", "도로명 주소 우선");
eq(hits[1].address, "강릉시 초당동", "도로명이 없으면 지번 주소");
eq(hits[0].kakao_place_id, "1", "카카오 장소 번호 (중복 추가 방지에 씁니다)");
ok(hits.every((h) => h.nearby === true), "전부 지역 안으로 표시");

/* ★ 지역 밖 결과 — 이것 때문에 범위를 넘깁니다.
   "밀면" 으로 검색하면 부산 가게만 나오는데, 강릉 여행 목록에
   조용히 끼면 안 되고 그렇다고 아예 안 보여줘도 불편합니다.
   그래서 보여주되 "지역 밖" 으로 표시합니다. */
const far = await page.evaluate((bbox) =>
  window.P.searchByKeyword("밀면", { bbox }), GN.bbox);
eq(far.length, 1, "지역 안에 없으면 전국으로 다시 찾음");
eq(far[0].nearby, false, "지역 밖으로 표시됨 (고르는 사람이 알아야 합니다)");
eq(far[0].name, "부산 밀면집", "결과 자체는 돌려줌");

const none = await page.evaluate((bbox) =>
  window.P.searchByKeyword("없는가게이름", { bbox }), GN.bbox);
eq(none.length, 0, "아무것도 없으면 빈 목록");

const blank = await page.evaluate(() => window.P.searchByKeyword("   "));
eq(blank.length, 0, "빈 검색어는 호출하지 않음");

/* ============================================================
   2. 지역 관광지 자동 채우기 (큐레이션 파일이 없는 지역)
   ============================================================ */
console.log("── 관광지 자동 채우기");
const seeded = await page.evaluate((r) => window.P.seedSpots(r), GN);
eq(seeded.length, 2, "강릉 범위 안의 관광지만 (해운대는 제외)");
ok(seeded.every((s) => s.kind === "spot"), "전부 spot 으로");
ok(seeded.every((s) => s.seeded === true), "자동으로 채운 것임을 표시");
ok(!seeded.some((s) => s.name === "해운대"), "범위 밖 관광지는 섞이지 않음");

/* ============================================================
   3. 출발·귀가 지점 찾기
      좌표를 손으로 적지 않고 이름으로 찾습니다
   ============================================================ */
console.log("── 출발 지점");
const hub = await page.evaluate((r) => window.P.findHub(r), GN);
eq(hub.name, "강릉역", "hubQuery 로 찾음");
eq(hub.lat, 37.7637, "좌표도 카카오에서 (손으로 적지 않음)");
eq(hub.lng, 128.899, "경도");

const noHub = await page.evaluate(() => window.P.findHub({ hubQuery: "없는역이름", bbox: null }));
eq(noHub, null, "못 찾으면 null (일정은 숙소부터 시작합니다)");

/* ============================================================
   4. 링크 붙여넣기 — 네 단계
   ============================================================ */
console.log("── 링크 붙여넣기");

/* 1단계: 주소에 좌표가 있으면 네트워크 없이 바로 */
const t1 = await page.evaluate(() =>
  window.P.resolveLink("https://map.kakao.com/link/map/강릉역,37.7637,128.8990", { kind: "spot" }));
eq(t1.ok, true, "1단계: 주소에 좌표가 있으면 바로 성공");
eq(t1.place.name, "강릉역", "이름도 주소에서 뽑음");
eq(t1.place.lat, 37.7637, "좌표");
eq(t1.place.source, "link", "출처를 link 로 기록");

/* 3단계: 좌표가 없으면 이름을 뽑아 검색 → 고르게 함 */
const t3 = await page.evaluate((bbox) =>
  window.P.resolveLink("https://map.naver.com/p/search/테라로사", { bbox }), GN.bbox);
eq(t3.ok, false, "3단계: 바로 확정하지 않고");
eq(t3.candidates.length, 1, "검색 결과를 후보로 돌려줌");
eq(t3.candidates[0].name, "테라로사 커피공장", "후보 이름");
ok(t3.reason.includes("테라로사"), "무엇으로 찾았는지 알려줌");

/* 4단계: 단축 주소인데 서버 도움이 없으면 */
const t4 = await page.evaluate(() =>
  window.P.resolveLink("https://naver.me/5xjphLSt"));
eq(t4.ok, false, "4단계: 단축 주소는 바로 못 엶");
eq(t4.candidates.length, 0, "후보 없음");
ok(t4.reason.includes("지도에서 찍"), "지도에서 찍으라고 안내");

/* 2단계: 서버 도움이 있으면 단축 주소도 풀립니다 */
const t2 = await page.evaluate(() =>
  window.P.resolveLink("https://naver.me/5xjphLSt", {
    resolveShort: async () => ({ lat: 37.8250, lng: 128.8780, name: "오붓한강릉" }),
  }));
eq(t2.ok, true, "2단계: 서버가 풀어주면 성공");
eq(t2.place.name, "오붓한강릉", "서버가 준 이름");
eq(t2.place.lat, 37.825, "서버가 준 좌표");

/* 서버가 한국 밖 좌표를 주면 믿지 않습니다 */
const bad = await page.evaluate(() =>
  window.P.resolveLink("https://naver.me/xxxx", {
    resolveShort: async () => ({ lat: 35.6586, lng: 139.7454, name: "도쿄타워" }),
  }));
eq(bad.ok, false, "서버가 한국 밖 좌표를 줘도 받지 않음");

/* 서버가 터져도 다음 단계로 넘어갑니다 */
const boom = await page.evaluate((bbox) =>
  window.P.resolveLink("https://naver.me/yyyy", {
    bbox,
    resolveShort: async () => { throw new Error("서버 꺼짐"); },
  }), GN.bbox);
eq(boom.ok, false, "서버가 터져도 터지지 않고 다음 단계로");
ok(Array.isArray(boom.candidates), "후보 배열은 항상 있음");

/* 주소가 아닌 것 */
const notUrl = await page.evaluate(() => window.P.resolveLink("그냥 글자"));
eq(notUrl.ok, false, "주소가 아니면 실패");
ok(notUrl.reason.includes("https://"), "https:// 로 시작하라고 안내");

/* ============================================================
   5. 지도 키가 없을 때 — 검색은 못 하지만 터지지 않아야 합니다
   ============================================================ */
console.log("── 지도 키가 없을 때");
const ctx2 = await browser.newContext();          // 가짜 SDK 를 넣지 않습니다
const page2 = await ctx2.newPage();
const errors2 = [];
page2.on("pageerror", (e) => errors2.push(String(e)));
await page2.goto(`${BASE}/tests/fixtures/places.html`);
await page2.waitForFunction(() => window.__ready === true);

const offSearch = await page2.evaluate(async () => {
  try { await window.P.searchByKeyword("초당순두부"); return "성공"; }
  catch (e) { return e.message; }
});
ok(/카카오 키/.test(offSearch), `검색은 친절한 메시지로 실패  (${offSearch.slice(0, 30)}…)`);

const offSeed = await page2.evaluate(() => window.P.seedSpots({ bbox: null, center: [37, 128] }));
eq(offSeed.length, 0, "관광지 자동 채우기는 빈 목록");

const offHub = await page2.evaluate(() => window.P.findHub({ hubQuery: "강릉역" }));
eq(offHub, null, "출발 지점은 null");

/* 링크 1단계는 네트워크도 SDK 도 필요 없으므로 계속 됩니다 */
const offLink = await page2.evaluate(() =>
  window.P.resolveLink("https://www.google.com/maps/@37.7637,128.8990,17z"));
eq(offLink.ok, true, "지도 키가 없어도 주소 속 좌표는 읽음");

eq(errors2.length, 0, `지도 없이도 콘솔 오류 없음${errors2.length ? " — " + errors2[0] : ""}`);
await ctx2.close();

eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
