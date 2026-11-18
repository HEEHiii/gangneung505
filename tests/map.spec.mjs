/* ============================================================
   kakaomap.js 브라우저 테스트

   실행: node tests/map.spec.mjs
   (미리 python3 -m http.server 8080 이 떠 있어야 합니다.
    tests/run-browser.sh 가 알아서 띄우고 내립니다)

   가짜 카카오 SDK 를 넣고 돌립니다 — 키도 할당량도 필요 없습니다.
   ============================================================ */

// playwright 는 전역(/opt/node-tools)에 설치돼 있고 ESM import 는 NODE_PATH 를
// 따르지 않습니다. createRequire 로 가져오면 어느 디렉터리에서도 됩니다.
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

const LODGINGS = [
  { id: "l1", name: "오붓한강릉", lat: 37.8250, lng: 128.8780, approx: true, address: "사천면" },
  { id: "l2", name: "경포대 호텔", lat: 37.7925, lng: 128.8966 },
  { id: "l3", name: "좌표없음", lat: null, lng: null },
];
const SPOTS = [
  { name: "경포해변", lat: 37.7955, lng: 128.9105, tag: "해변" },
  { name: "오죽헌", lat: 37.7792, lng: 128.8780, tag: "관광" },
];
const FOODS = [
  { id: "f1", name: "테라로사", lat: 37.6878, lng: 128.8686, kind: "cafe" },
  { id: "f2", name: "초당순두부", lat: 37.7900, lng: 128.9110, kind: "food", note: "웨이팅 김" },
];

const browser = await chromium.launch();

/* ============================================================
   1. 가짜 SDK 가 있을 때
   ============================================================ */
{
  console.log("── 지도가 있을 때");
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await ctx.addInitScript({ content: STUB });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${BASE}/tests/fixtures/map.html`);
  await page.waitForFunction(() => window.__ready === true);

  ok(await page.evaluate(() => window.__kakaoReady()), "가짜 SDK 를 인식함");

  await page.evaluate(({ L, S, F }) => {
    window.m = window.__createMap("map", { center: [37.7519, 128.8761], level: 8 });
    window.__picks = [];
    window.m.setLodgings(L, (id) => window.__picks.push(id));
    window.m.setSpots(S);
    window.__L = L; window.__S = S; window.__F = F;
  }, { L: LODGINGS, S: SPOTS, F: FOODS });

  ok(await page.evaluate(() => window.m.ok === true), "ok 플래그가 true");

  // 좌표 없는 숙소는 핀을 만들지 않아야 합니다
  eq(await page.evaluate(() => window.m.setLodgings(window.__L, null)), 2,
    "좌표 없는 숙소는 세지 않음 (3개 중 2개)");

  eq(await page.locator("#map .pin-lodging").count(), 2, "숙소 핀 2개");
  eq(await page.locator("#map .pin-spot").count(), 2, "관광지 핀 2개");

  // 번호가 1, 2 로 붙는지
  eq(await page.locator("#map .pin-lodging span").first().textContent(), "1", "첫 숙소 번호 1");
  eq((await page.locator("#map .pin-lodging span").allTextContents()).join(","), "1,2", "번호가 1,2");

  // 관광지 이름 라벨
  const labels = await page.locator("#map .pin-label").allTextContents();
  ok(labels.includes("경포해변"), "관광지 이름 라벨이 보임");

  /* ---------- 핀 클릭 → 콜백 + 말풍선 ---------- */
  await page.evaluate(() => {
    window.__picks = [];
    window.m.setLodgings(window.__L, (id) => window.__picks.push(id));
  });
  await page.locator("#map .pin-lodging").first().click();
  eq(await page.evaluate(() => window.__picks[0]), "l1", "숙소 핀 클릭 → 콜백에 id 전달");
  ok(await page.locator("#map .map-bubble").count() > 0, "핀 클릭에 말풍선이 뜸");
  ok((await page.locator("#map .map-bubble").textContent()).includes("오붓한강릉"), "말풍선에 이름");
  ok((await page.locator("#map .map-bubble").textContent()).includes("대략 위치"), "approx 면 '대략 위치' 표시");

  /* ---------- 선택 강조 ---------- */
  await page.evaluate(() => window.m.select("l2", false));
  eq(await page.locator("#map .pin-lodging.sel").count(), 1, "선택된 핀만 강조");
  eq(await page.locator("#map .pin-lodging.sel span").textContent(), "2", "강조된 핀이 2번");

  await page.evaluate(() => window.m.clearSelect());
  eq(await page.locator("#map .pin-lodging.sel").count(), 0, "clearSelect 로 강조 해제");
  eq(await page.locator("#map .map-bubble").count(), 0, "clearSelect 로 말풍선 닫힘");

  /* ---------- 필터 ---------- */
  await page.evaluate(() => window.m.filter("lodging"));
  eq(await page.locator("#map .pin-lodging").count(), 2, "숙소만: 숙소 핀 유지");
  eq(await page.locator("#map .pin-spot").count(), 0, "숙소만: 관광지 핀 숨김");

  await page.evaluate(() => window.m.filter("spot"));
  eq(await page.locator("#map .pin-lodging").count(), 0, "관광지만: 숙소 핀 숨김");
  eq(await page.locator("#map .pin-spot").count(), 2, "관광지만: 관광지 핀 유지");

  await page.evaluate(() => window.m.filter("all"));
  eq(await page.locator("#map .pin-lodging").count(), 2, "전부: 숙소 핀 복귀");
  eq(await page.locator("#map .pin-spot").count(), 2, "전부: 관광지 핀 복귀");

  /* ---------- 맛집 핀 ---------- */
  await page.evaluate(() => window.m.setPoints(window.__F));
  // 카페 핀도 pin-food 클래스를 함께 갖습니다 (원래 Leaflet 판과 같은 규칙)
  eq(await page.locator("#map .pin-food").count(), 2, "맛집 핀 2개");
  eq(await page.locator("#map .pin-food.cafe").count(), 1, "그중 카페 1개 (속 빈 핀)");
  eq(await page.locator("#map .pin-food:not(.cafe)").count(), 1, "그중 식당 1개 (꽉 찬 핀)");
  const foodLabels = await page.locator("#map .pin-label").allTextContents();
  ok(foodLabels.includes("테라로사") && foodLabels.includes("초당순두부"), "맛집 이름 라벨");

  /* ---------- 위치 찍기 ---------- */
  await page.evaluate(() => {
    window.__picked = null;
    window.m.startPick((p) => { window.__picked = p; });
  });
  ok(await page.evaluate(() => document.getElementById("map").classList.contains("picking")),
    "찍기 모드에서 picking 클래스가 붙음");

  // 지도(핀이 아닌 곳)를 클릭
  await page.evaluate(() => {
    const el = document.getElementById("map");
    const ev = new MouseEvent("click", { bubbles: true });
    ev.__stubLatLng = new window.kakao.maps.LatLng(37.7743, 128.9444);
    el.dispatchEvent(ev);
  });
  eq(await page.evaluate(() => window.__picked && window.__picked.lat), 37.7743, "찍은 위도 전달");
  eq(await page.evaluate(() => window.__picked && window.__picked.lng), 128.9444, "찍은 경도 전달");
  ok(!(await page.evaluate(() => document.getElementById("map").classList.contains("picking"))),
    "찍고 나면 picking 클래스가 떨어짐");
  eq(await page.locator("#map .pin-pick").count(), 1, "찍은 자리에 핀 표시");

  /* ---------- 핀 클릭이 찍기 모드를 깨뜨리지 않는지 ----------
     Leaflet 에서 카카오로 옮길 때 실제로 조심해야 하는 부분입니다.
     CustomOverlay 가 클릭을 삼키지 않으면 핀을 누를 때마다
     그 자리가 "찍힌 좌표"로 들어가 버립니다. */
  await page.evaluate(() => {
    window.__picked = null;
    window.m.setLodgings(window.__L, null);
    window.m.startPick((p) => { window.__picked = p; });
  });
  await page.locator("#map .pin-lodging").first().click();
  eq(await page.evaluate(() => window.__picked), null,
    "핀을 눌러도 '찍기'로 잡히지 않음 (클릭 전파 차단)");

  /* ---------- refresh ---------- */
  await page.evaluate(() => window.m.refresh());
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => window.m.map._relayouts > 0),
    "refresh 가 relayout 을 부름 (숨은 탭이 보일 때 필요)");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}

/* ============================================================
   2. SDK 가 없을 때 — 키를 받기 전에도 앱이 살아 있어야 합니다
   ============================================================ */
{
  console.log("── 지도 키가 없을 때");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/tests/fixtures/map.html`);
  await page.waitForFunction(() => window.__ready === true);

  ok(!(await page.evaluate(() => window.__kakaoReady())), "SDK 없음을 인식");

  await page.evaluate(({ L, S, F }) => {
    window.m = window.__createMap("map", { center: [37.75, 128.88], level: 8 });
    window.__r = {
      ok: window.m.ok,
      lodgings: window.m.setLodgings(L, null),
    };
    // 모든 메서드를 불러도 터지지 않아야 합니다
    window.m.setSpots(S); window.m.setPoints(F);
    window.m.goTo("l1"); window.m.select("l1"); window.m.filter("all");
    window.m.fit(); window.m.fitPoints(); window.m.clearSelect();
    window.m.cancelPick(); window.m.showPick(37.7, 128.8); window.m.refresh();
  }, { L: LODGINGS, S: SPOTS, F: FOODS });

  eq(await page.evaluate(() => window.__r.ok), false, "ok 플래그가 false");
  eq(await page.evaluate(() => window.__r.lodgings), 2, "지도 없이도 숙소 개수는 셈");
  ok(await page.locator("#map.map-off").count() > 0, "안내판으로 대체됨");
  ok((await page.locator("#map").textContent()).includes("목록과 투표는 그대로"),
    "'목록과 투표는 그대로 쓸 수 있어요' 안내");
  eq(errors.length, 0, `메서드를 다 불러도 오류 없음${errors.length ? " — " + errors[0] : ""}`);

  await ctx.close();
}

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
