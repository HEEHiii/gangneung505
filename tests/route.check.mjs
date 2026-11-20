/* ============================================================
   일정 자동 생성 — 순수 함수 검사

   실행: node tests/route.check.mjs

   ★ 여기서 막으려는 두 가지 실패

   1) 3일 이상에서 한 날에 전부 몰림
      2일이면 각 날의 끝점이 달라(1일차는 숙소에서 끝) 이동시간만
      줄여도 저절로 균형이 맞습니다. 그런데 3일 이상은 중간 날이
      "숙소 → … → 숙소" 라, 순수 이동 최소화가 한 날에 다 몰고
      나머지를 비우려 합니다. 숙소 왕복이 날마다 생기니까요.
      그 결과는 일정표로서 아무 쓸모가 없습니다.

   2) 횟집이 아침 10시 반에
      투표는 "무엇"의 순위이지 "언제"가 아닙니다. 이동시간만 보는
      최적화기는 회를 10:30 에, 카페를 21:00 에 아무렇지 않게
      배치합니다. 그러면 사용자는 기능이 고장났다고 결론 내리고
      전부 손으로 고칩니다. 일정 자동 생성의 가장 큰 제품 리스크입니다.
   ============================================================ */

import { buildItinerary, enumerateDays, toMin, OPTIONS, ANCHORS } from "../app/assets/route.js";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${what}  (받음 ${JSON.stringify(got)})`);

const HUB = { name: "강릉역", lat: 37.7639, lng: 128.8990 };
const LODGING = { name: "오붓한강릉", lat: 37.8250, lng: 128.8780 };
const PLACES = [
  { id: "a", name: "초당순두부",   lat: 37.7956, lng: 128.9142, kind: "food" },
  { id: "b", name: "안목해변 카페", lat: 37.7733, lng: 128.9471, kind: "cafe" },
  { id: "c", name: "경포대",       lat: 37.7955, lng: 128.8963, kind: "spot" },
  { id: "d", name: "오죽헌",       lat: 37.7792, lng: 128.8783, kind: "spot" },
  { id: "e", name: "주문진 회센터", lat: 37.8960, lng: 128.8295, kind: "food" },
  { id: "f", name: "정동진",       lat: 37.6908, lng: 129.0335, kind: "spot" },
];

const build = (start, end, over = {}) => buildItinerary({
  days: enumerateDays(start, end),
  hub: HUB, lodging: LODGING, places: PLACES, ...over,
});
const placeSlots = (day) => day.slots.filter((s) => s.placeId);

/* ============================================================
   1. 날짜 펼치기
   ============================================================ */
console.log("── 날짜 펼치기");
eq(enumerateDays("2027-01-23", "2027-01-23").length, 1, "같은 날이면 하루 (0박)");
eq(enumerateDays("2027-01-23", "2027-01-24").length, 2, "1박이면 이틀");
eq(enumerateDays("2027-01-23", "2027-01-26").length, 4, "3박이면 나흘");
eq(enumerateDays("2027-01-24", "2027-01-23").length, 0, "끝이 시작보다 빠르면 빈 배열");
eq(enumerateDays("", "").length, 0, "빈 값이면 빈 배열");
ok(enumerateDays("2027-01-01", "2027-12-31").length <= 16, "아무리 길어도 상한이 있다");
eq(enumerateDays("2027-02-28", "2027-03-01").map((d) => d.date),
   ["2027-02-28", "2027-03-01"], "달을 넘어가도 맞다");
eq(enumerateDays("2028-02-28", "2028-03-01").map((d) => d.date),
   ["2028-02-28", "2028-02-29", "2028-03-01"], "윤년 2월 29일을 빠뜨리지 않는다");
eq(enumerateDays("2027-01-23", "2027-01-23")[0].dow, "토", "요일이 맞다");

/* ============================================================
   2. 장소가 하나도 빠지거나 겹치지 않는가
   ============================================================ */
console.log("── 장소가 정확히 한 번씩");
for (const [s, e, label] of [
  ["2027-01-23", "2027-01-23", "0박"],
  ["2027-01-23", "2027-01-24", "1박"],
  ["2027-01-23", "2027-01-25", "2박"],
  ["2027-01-23", "2027-01-27", "4박"],
]) {
  const r = build(s, e);
  const ids = r.itinerary.flatMap((d) => placeSlots(d).map((x) => x.placeId)).sort();
  eq(ids, PLACES.map((p) => p.id).sort(), `${label} — 6곳이 정확히 한 번씩 들어감`);
}

/* ============================================================
   3. ★ 한 날에 몰리지 않는가
   ============================================================ */
console.log("── 한 날에 몰리지 않는가");
{
  for (const [s, e, D] of [["2027-01-23","2027-01-25",3], ["2027-01-23","2027-01-26",4]]) {
    const r = build(s, e);
    const counts = r.itinerary.map((d) => placeSlots(d).length);
    const spread = Math.max(...counts) - Math.min(...counts);
    ok(spread <= 1, `${D}일 — 날마다 장소 수 차이가 1 이내  (${counts.join("/")})`);
    ok(!counts.includes(0), `${D}일 — 빈 날이 없다  (${counts.join("/")})`);
    ok(Math.max(...counts) <= OPTIONS.maxPerDay,
      `${D}일 — 하루 ${OPTIONS.maxPerDay}곳 상한을 지킴  (최대 ${Math.max(...counts)})`);
  }
}
{
  /* 장소가 많을 때도 (2-opt 경로) */
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`, name: `곳${i}`, kind: ["spot", "food", "cafe"][i % 3],
    lat: 37.70 + (i % 4) * 0.05, lng: 128.85 + Math.floor(i / 4) * 0.06,
  }));
  const r = buildItinerary({
    days: enumerateDays("2027-01-23", "2027-01-26"), hub: HUB, lodging: LODGING, places: many,
  });
  const counts = r.itinerary.map((d) => placeSlots(d).length);
  eq(counts.reduce((a, b) => a + b, 0), 12, "12곳이 전부 들어감");
  ok(Math.max(...counts) - Math.min(...counts) <= 1,
    `12곳도 고르게 나뉨  (${counts.join("/")})`);
}

/* ============================================================
   4. ★ 밥은 밥때에
   ============================================================ */
console.log("── 밥은 밥때에");
{
  const [lunchS, lunchE] = ANCHORS.lunch.map(toMin);
  const [dinS, dinE] = ANCHORS.dinner.map(toMin);
  let foods = 0, inWindow = 0, cafes = 0, cafeOk = 0;

  for (const [s, e] of [["2027-01-23","2027-01-24"], ["2027-01-23","2027-01-25"],
                        ["2027-01-23","2027-01-26"], ["2027-01-23","2027-01-23"]]) {
    for (const day of build(s, e).itinerary) {
      for (const slot of placeSlots(day)) {
        const t = toMin(slot.time);
        if (slot.kind === "food") {
          foods++;
          if ((t >= lunchS && t <= lunchE) || (t >= dinS && t <= dinE)) inWindow++;
        }
        if (slot.kind === "cafe") {
          cafes++;
          if (t >= toMin(ANCHORS.cafeFrom)) cafeOk++;
        }
      }
    }
  }
  ok(foods > 0 && inWindow === foods,
    `식당 ${foods}곳이 전부 점심(11:30~13:30) 또는 저녁(17:30~19:30) 시간대  (${inWindow}/${foods})`);
  ok(cafes > 0 && cafeOk === cafes, `카페 ${cafes}곳이 전부 오후  (${cafeOk}/${cafes})`);
}
{
  /* 하루에 식당 셋이 몰리면 안 됩니다 — 끼니가 셋일 수 없으니까요 */
  const threeFood = [
    { id:"f1", name:"횟집",   lat:37.80, lng:128.90, kind:"food" },
    { id:"f2", name:"순두부", lat:37.79, lng:128.91, kind:"food" },
    { id:"f3", name:"막국수", lat:37.78, lng:128.89, kind:"food" },
    { id:"s1", name:"경포대", lat:37.795, lng:128.896, kind:"spot" },
  ];
  const r = buildItinerary({
    days: enumerateDays("2027-01-23", "2027-01-24"),
    hub: HUB, lodging: LODGING, places: threeFood,
  });
  const perDay = r.itinerary.map((d) => placeSlots(d).filter((s) => s.kind === "food").length);
  ok(Math.max(...perDay) <= OPTIONS.maxFoodPerDay,
    `하루 식사는 ${OPTIONS.maxFoodPerDay}끼까지  (${perDay.join("/")})`);
}

/* ============================================================
   5. 시각이 거꾸로 가지 않는가
   ============================================================ */
console.log("── 시각이 앞으로만 가는가");
{
  let bad = 0, checked = 0;
  for (const [s, e] of [["2027-01-23","2027-01-23"], ["2027-01-23","2027-01-24"],
                        ["2027-01-23","2027-01-25"], ["2027-01-23","2027-01-27"]]) {
    for (const day of build(s, e).itinerary) {
      let last = -1;
      for (const slot of day.slots) {
        const t = toMin(slot.time);
        checked++;
        if (t < last) bad++;
        last = t;
      }
    }
  }
  eq(bad, 0, `모든 칸(${checked}개)의 시각이 앞으로만 간다`);
}

/* ============================================================
   6. 날 모양 — 체크인·체크아웃이 제자리에
   ============================================================ */
console.log("── 날 모양");
{
  const r = build("2027-01-23", "2027-01-25");
  const txt = (d) => d.slots.map((x) => x.title).join(" | ");

  ok(txt(r.itinerary[0]).includes("강릉역 도착"), "첫날은 도착으로 시작");
  ok(txt(r.itinerary[0]).includes("체크인"), "첫날은 체크인으로 끝");
  ok(!txt(r.itinerary[1]).includes("체크인"), "중간 날에는 체크인이 없다");
  ok(!txt(r.itinerary[1]).includes("체크아웃"), "중간 날에는 체크아웃이 없다");
  ok(txt(r.itinerary[2]).includes("체크아웃"), "마지막 날은 체크아웃");
  ok(txt(r.itinerary[2]).includes("귀가"), "마지막 날은 귀가로 끝");

  /* 마지막 날에 "출발"과 "체크아웃"이 같이 있으면 앞뒤가 안 맞습니다 */
  ok(!/출발[^|]*\|[^|]*체크아웃/.test(txt(r.itinerary[2])),
    "마지막 날에 '출발' 다음 '체크아웃'이 오지 않는다");

  /* 중간 날의 첫 칸은 실제로 나서는 시각이어야 합니다 */
  const mid = r.itinerary[1];
  const lead = mid.slots[0], firstPlace = placeSlots(mid)[0];
  ok(toMin(lead.time) <= toMin(firstPlace.time), "중간 날 '출발'이 첫 장소보다 이르다");
  ok(toMin(firstPlace.time) - toMin(lead.time) <= 60,
    `중간 날 '출발'이 첫 장소 직전이다 (${toMin(firstPlace.time) - toMin(lead.time)}분 전)`);
}
{
  const r = build("2027-01-23", "2027-01-23");
  const txt = r.itinerary[0].slots.map((x) => x.title).join(" | ");
  eq(r.itinerary.length, 1, "0박은 하루");
  ok(!txt.includes("체크인") && !txt.includes("체크아웃"), "0박에는 체크인·체크아웃이 없다");
  ok(txt.includes("도착") && txt.includes("귀가"), "0박도 도착과 귀가는 있다");
}

/* ============================================================
   7. 없을 수도 있는 것들 — 터지지 않고 degrade 하는가
   ============================================================ */
console.log("── 빠진 값이 있어도 버티는가");
{
  const days = enumerateDays("2027-01-23", "2027-01-24");

  const noLodge = buildItinerary({ days, hub: HUB, lodging: null, places: PLACES });
  eq(noLodge.itinerary.length, 2, "숙소가 없어도 이틀치가 나온다");
  ok(noLodge.warnings.some((w) => w.includes("숙소")), "숙소가 없다고 알려준다");
  ok(!JSON.stringify(noLodge.itinerary).includes("체크인"), "숙소가 없으면 체크인도 없다");

  const noHub = buildItinerary({ days, hub: null, lodging: LODGING, places: PLACES });
  eq(noHub.itinerary.length, 2, "출발 지점이 없어도 나온다");
  ok(noHub.warnings.some((w) => w.includes("출발")), "출발 지점이 없다고 알려준다");

  const nothing = buildItinerary({ days, hub: null, lodging: null, places: [] });
  eq(nothing.itinerary.length, 2, "아무것도 없어도 빈 이틀치는 나온다");
  eq(nothing.totalMin, 0, "아무것도 없으면 이동시간 0");

  const noPlaces = buildItinerary({ days, hub: HUB, lodging: LODGING, places: [] });
  eq(noPlaces.itinerary.length, 2, "장소가 없어도 틀은 나온다");

  const noDays = buildItinerary({ days: [], hub: HUB, lodging: LODGING, places: PLACES });
  ok(noDays.itinerary.length >= 0, "날짜가 없어도 터지지 않는다");
}

/* ============================================================
   8. 같은 입력이면 같은 결과
   ============================================================ */
console.log("── 결과가 매번 같은가");
{
  const a = JSON.stringify(build("2027-01-23", "2027-01-25"));
  const b = JSON.stringify(build("2027-01-23", "2027-01-25"));
  ok(a === b, "두 번 불러도 똑같다 (새로고침할 때마다 바뀌면 안 됩니다)");

  const shuffled = buildItinerary({
    days: enumerateDays("2027-01-23", "2027-01-25"),
    hub: HUB, lodging: LODGING, places: [...PLACES].reverse(),
  });
  const ids = (r) => r.itinerary.flatMap((d) => placeSlots(d).map((x) => x.placeId)).sort().join();
  ok(ids(shuffled) === ids(build("2027-01-23", "2027-01-25")),
    "장소 순서를 뒤집어도 같은 곳들이 들어간다");
}

/* ============================================================
   9. 이동시간이 말이 되는가
   ============================================================ */
console.log("── 이동시간");
{
  const r = build("2027-01-23", "2027-01-24");
  ok(r.estimated === true, "추정값임을 표시한다 (실제 주행시간이 아님)");
  ok(r.totalMin > 0 && r.totalMin < 600, `총 이동시간이 말이 되는 범위  (${r.totalMin}분)`);

  /* 날이 늘면 숙소 왕복이 늘어 이동시간은 보통 늘어납니다 */
  const two = build("2027-01-23", "2027-01-24").totalMin;
  const four = build("2027-01-23", "2027-01-26").totalMin;
  ok(four >= two, `날이 늘면 이동시간이 줄지 않는다  (${two}분 → ${four}분)`);
}

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
