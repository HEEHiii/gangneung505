/* ============================================================
   스토리 카드 — 순수 함수 검사

   실행: node tests/card.check.mjs

   ★ 좌표를 화면에 앉히는 계산이 제일 틀리기 쉬운데, 캔버스에
     묶여 있으면 눈으로 보기 전까지 모릅니다. 그래서 layoutCard 는
     숫자만 내놓고 여기서 잽니다.
   ============================================================ */

import { pickPoints, layoutCard, CARD } from "../app/assets/card.js";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(JSON.stringify(got) === JSON.stringify(want),
     `${what}  (받음 ${JSON.stringify(got)})`);

/* 강릉 언저리 좌표들 */
const 경포 = { id: "p1", name: "경포해변", lat: 37.7950, lng: 128.8960, kind: "spot" };
const 정동진 = { id: "p2", name: "정동진", lat: 37.6900, lng: 129.0340, kind: "spot" };
const 숙소 = { id: "p3", name: "경포호텔", lat: 37.7900, lng: 128.9000, kind: "lodging" };
const PLACES = [경포, 정동진, 숙소];

const ROOM = { hub: { name: "강릉역", lat: 37.7639, lng: 128.8997 } };

const DAY = (slots) => ({ day_index: 0, slots });


/* ============================================================
   1. 일정에서 점 뽑기
   ============================================================ */
console.log("── 점 뽑기");
{
  const pts = pickPoints([DAY([
    { title: "경포해변", kind: "spot", placeId: "p1" },
    { title: "정동진", kind: "spot", placeId: "p2" },
  ])], PLACES, ROOM);
  eq(pts.map((p) => p.name), ["경포해변", "정동진"], "placeId 로 좌표를 찾는다");
}
{
  /* ★ placeId 가 없는 칸 — 이름으로 찾아야 합니다.
     버리면 하루의 시작과 끝이 사라져 선이 공중에서 시작합니다. */
  const pts = pickPoints([DAY([
    { title: "숙소 체크인 — 경포호텔", kind: "lodging", fixed: true },
    { title: "정동진", kind: "spot", placeId: "p2" },
  ])], PLACES, ROOM);
  eq(pts.map((p) => p.name), ["경포호텔", "정동진"],
    "★ placeId 가 없어도 이름으로 찾는다");
}
{
  const pts = pickPoints([DAY([
    { title: "강릉역 도착", kind: "hub" },
    { title: "경포해변", kind: "spot", placeId: "p1" },
    { title: "강릉역 — 귀가", kind: "hub" },
  ])], PLACES, ROOM);
  eq(pts.map((p) => p.name), ["강릉역", "경포해변", "강릉역"],
    "★ 출발지와 귀가도 방의 hub 로 찾는다");
}
{
  /* 숙소 체크인 → 다음날 출발이 같은 자리로 연달아 나옵니다 */
  const pts = pickPoints([
    DAY([{ title: "숙소 체크인 — 경포호텔", kind: "lodging" }]),
    { day_index: 1, slots: [{ title: "출발", kind: "hub" },
                            { title: "숙소로 — 경포호텔", kind: "lodging" }] },
  ], PLACES, ROOM);
  eq(pts.length, 1, "같은 자리가 연달아 나오면 한 번만 찍는다");
}
{
  eq(pickPoints(null, null, null), [], "일정이 없으면 빈 배열");
  eq(pickPoints([DAY([{ title: "없는 곳", kind: "spot", placeId: "없음" }])], PLACES, ROOM),
     [], "좌표를 못 찾으면 버린다");
  eq(pickPoints([DAY([{ title: "출발", kind: "hub" }])], PLACES, {}),
     [], "hub 도 없으면 버린다");
}


/* ============================================================
   2. 캔버스에 앉히기
   ============================================================ */
console.log("── 자리 계산");
const L = (points, opts) => layoutCard({ points, title: "겨울 강릉" }, opts);

{
  const r = L([경포, 정동진, 숙소]);
  eq([r.w, r.h], [1080, 1920], "인스타 스토리 크기");
  ok(r.stops.length === 3, "점이 그대로 셋");
  ok(r.stops.every((s) => s.x >= 0 && s.x <= r.w && s.y >= 0 && s.y <= r.h),
    "★ 모든 점이 그림 안에 들어온다");
  ok(r.stops.every((s) =>
       s.x >= r.area.x && s.x <= r.area.x + r.area.w &&
       s.y >= r.area.y && s.y <= r.area.y + r.area.h),
    "★ 제목·요약 자리를 침범하지 않는다");
}
{
  /* ★ 위도가 클수록 위에 있어야 합니다 (캔버스 y 는 아래로 자랍니다) */
  const r = L([경포, 정동진]);          // 경포가 북쪽
  ok(r.stops[0].y < r.stops[1].y, "★ 북쪽이 위에 온다");
}
{
  /* ★ 가로 보정(cos 위도) 검사.

     위도 37.5°에서 경도 0.1°는 위도 0.1°보다 약 21% 짧습니다.
     보정을 빼면 둘이 같은 길이로 나와서 이 검사가 깨집니다.
     (일부러 빼서 깨지는 것을 확인했습니다.) */
  const base = { lat: 37.5, lng: 128.0 };
  const 북 = { lat: 37.6, lng: 128.0, name: "북" };
  const 동 = { lat: 37.5, lng: 128.1, name: "동" };
  const r = layoutCard({ points: [base, 북, 동] });
  const dy = Math.abs(r.stops[1].y - r.stops[0].y);   // 남북 0.1°
  const dx = Math.abs(r.stops[2].x - r.stops[0].x);   // 동서 0.1°
  const ratio = dx / dy;
  ok(ratio > 0.76 && ratio < 0.83,
    `★ 동서가 남북보다 짧게 그려진다 (cos 보정, 비율 ${ratio.toFixed(3)})`);
}
{
  const r = L([경포]);
  eq(r.stops.length, 1, "점이 하나여도 그린다");
  eq(r.path, [], "점이 하나면 선은 없다");
  ok(Number.isFinite(r.stops[0].x) && Number.isFinite(r.stops[0].y),
    "★ 점이 하나여도 자리가 숫자로 나온다 (0 으로 나누지 않는다)");
}
{
  const 같은곳 = [{ lat: 37.8, lng: 128.9 }, { lat: 37.8, lng: 128.9 }];
  const r = layoutCard({ points: 같은곳 });
  ok(r.stops.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)),
    "★ 전부 같은 자리여도 숫자가 나온다");
}
{
  const r = L([]);
  eq(r.stops, [], "점이 없으면 빈 채로");
  eq(r.path, [], "점이 없으면 선도 없다");
  ok(r.title === "겨울 강릉", "점이 없어도 제목은 남는다");
}


/* ============================================================
   3. 장소 이름은 켜야 나온다
   ============================================================ */
console.log("── 이름 보이기");
{
  const off = L([경포, 정동진, 숙소]);
  eq(off.labels, [], "★ 기본은 장소 이름이 안 나온다");
  eq(off.showNames, false, "기본값은 꺼짐");

  const on = L([경포, 정동진, 숙소], { showNames: true });
  eq(on.labels.map((l) => l.text), ["경포해변", "정동진"],
    "★ 켜면 이름이 나온다");

  /* ★ 숙소만은 켜도 안 나옵니다.

     이 저장소는 숙소 위치가 새는 걸 막으려고 사진 EXIF 지우기를
     필수로 뒀습니다. 이 그림은 방보다 더 공개된 곳으로 갑니다.
     "이름 붙은 점 + 지역명" 은 검색이 되고, 이름 없는 점은 안 됩니다. */
  ok(!JSON.stringify(on).includes("경포호텔"),
    "★ 숙소 이름은 켜도 그림 어디에도 없다");

  /* pickPoints 를 거치지 않고 바로 불러도 막혀야 합니다 */
  const direct = layoutCard({ points: [숙소] }, { showNames: true });
  eq(direct.labels, [], "★ layoutCard 를 직접 불러도 숙소는 이름이 없다");
}
{
  /* 숙소는 매일 나오므로 이름이 여러 번 찍힙니다 */
  const on = L([숙소, 경포, 경포, 정동진, 경포], { showNames: true });
  eq(on.labels.map((l) => l.text), ["경포해변", "정동진"],
    "같은 이름은 한 번만 적는다");
}


/* ============================================================
   3-2. 이름표는 서로 겹치지 않는다

   ★ 겹쳐 찍으면 둘 다 못 읽습니다. 하나를 빼는 것보다 나쁩니다.
   ============================================================ */
console.log("── 이름표 겹침");
{
  const hits = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  /* 아주 가까운 곳 여섯 — 그냥 찍으면 전부 겹칩니다 */
  const 빽빽 = [];
  for (let i = 0; i < 6; i++) {
    빽빽.push({ lat: 37.78 + i * 0.0006, lng: 128.90 + i * 0.0006,
                name: `장소${i}`, kind: "spot" });
  }
  const r = layoutCard({ points: 빽빽 }, { showNames: true });

  let bad = 0;
  for (let i = 0; i < r.labels.length; i++)
    for (let j = i + 1; j < r.labels.length; j++)
      if (hits(r.labels[i].box, r.labels[j].box)) bad++;
  eq(bad, 0, "★ 남은 이름표끼리는 겹치지 않는다");
  ok(r.labels.length < 빽빽.length,
    `자리가 없으면 일부는 포기한다  (${빽빽.length}개 중 ${r.labels.length}개)`);
  ok(r.labels.length >= 2, "그렇다고 전부 버리지는 않는다");
}
{
  /* 이름표가 그림 밖으로 나가지 않습니다 */
  const 끝 = [{ lat: 37.80, lng: 128.80, name: "아주아주긴이름의장소입니다", kind: "spot" },
              { lat: 37.70, lng: 129.00, name: "반대쪽끝의장소", kind: "spot" }];
  const r = layoutCard({ points: 끝 }, { showNames: true });
  ok(r.labels.every((l) => l.box.x >= 0 && l.box.x + l.box.w <= r.w),
    "★ 이름표가 좌우로 잘리지 않는다");
}


/* ============================================================
   4. 제목·요약은 그대로 실린다
   ============================================================ */
console.log("── 글자");
{
  const r = layoutCard({
    points: [경포], title: "겨울 강릉", sub: "강릉 · 1월 23일 ~ 24일",
    foot: "1박 2일 · 7곳",
  });
  eq(r.title, "겨울 강릉", "제목");
  eq(r.sub, "강릉 · 1월 23일 ~ 24일", "부제");
  eq(r.foot, "1박 2일 · 7곳", "요약");
  ok(r.brand.length > 0, "★ 서비스 이름이 그림 안에 들어간다 (스토리는 링크를 못 겁니다)");
}
{
  const r = layoutCard({});
  ok(r.title === "우리 여행", "제목이 비면 기본값");
  eq([r.w, r.h], [CARD.w, CARD.h], "크기는 늘 같다");
}

/* ============================================================
   5. 총 이동거리
   ============================================================ */
console.log("── 이동거리");
{
  const { totalKm } = await import("../app/assets/card.js");
  ok(totalKm([]) === 0, "점이 없으면 0");
  ok(totalKm([경포]) === 0, "점이 하나면 0");
  const km = totalKm([경포, 정동진]);
  ok(km > 15 && km < 19, `경포 ↔ 정동진이 17km 언저리  (${km.toFixed(1)}km)`);
}

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
