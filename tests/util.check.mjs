/* ============================================================
   geo.js / dom.js 순수 함수 테스트

   실행: node tests/util.check.mjs

   날짜·좌표 계산은 경계에서 틀리기 쉽고, 틀려도 화면에서는
   그냥 "뭔가 이상한" 수준으로 보여서 놓치기 쉽습니다.
   ============================================================ */

import { distanceKm, inKorea, parsePos, bboxOf, inBbox, prettyKm } from "../app/assets/geo.js";
import { esc, won, fmtRange, enumerateDays } from "../app/assets/dom.js";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(got === want, `${what}  (받음 ${JSON.stringify(got)})`);

/* ---------- distanceKm ---------- */
console.log("── 거리");
ok(distanceKm(37.7637, 128.8990, 37.7637, 128.8990) === 0, "같은 점은 0km");
// 강릉역 → 경포해변 약 4km
const d1 = distanceKm(37.7637, 128.8990, 37.7955, 128.9105);
ok(d1 > 3 && d1 < 5, `강릉역–경포해변 ${d1.toFixed(2)}km (3~5km 예상)`);
// 서울–부산 약 325km
const d2 = distanceKm(37.5665, 126.9780, 35.1796, 129.0756);
ok(d2 > 310 && d2 < 340, `서울–부산 ${d2.toFixed(0)}km (310~340km 예상)`);
ok(Math.abs(distanceKm(37.0, 128.0, 38.0, 129.0) - distanceKm(38.0, 129.0, 37.0, 128.0)) < 1e-9,
  "거리는 방향과 무관");

/* ---------- inKorea ---------- */
console.log("── 한국 범위");
ok(inKorea(37.5, 127.0), "서울");
ok(inKorea(33.5, 126.5), "제주");
ok(!inKorea(127.0, 37.5), "위도·경도를 뒤바꾼 값 거부");
ok(!inKorea(35.6, 139.7), "도쿄 거부");
ok(!inKorea(NaN, 127.0), "NaN 거부");
ok(!inKorea(null, null), "null 거부");

/* ---------- parsePos ---------- */
console.log("── 좌표 문자열");
eq(JSON.stringify(parsePos("37.7743, 128.9444")), '{"lat":37.7743,"lng":128.9444}', "쉼표 구분");
eq(JSON.stringify(parsePos("37.7743 128.9444")), '{"lat":37.7743,"lng":128.9444}', "공백 구분");
eq(JSON.stringify(parsePos("37.7743/128.9444")), '{"lat":37.7743,"lng":128.9444}', "슬래시 구분");
eq(parsePos("128.9444, 37.7743"), null, "순서가 뒤바뀐 입력 거부");
eq(parsePos("그냥 글자"), null, "숫자가 없으면 null");
eq(parsePos(""), null, "빈 문자열");
eq(parsePos(null), null, "null 입력");

/* ---------- bboxOf ---------- */
console.log("── 범위 계산");
eq(bboxOf([]), null, "점이 없으면 null");
eq(bboxOf(null), null, "null 입력");

const bb1 = bboxOf([{ lat: 37.7, lng: 128.8 }, { lat: 37.9, lng: 129.0 }]);
ok(bb1[0][0] === 37.7 && bb1[1][0] === 37.9, "두 점의 위도 범위");
ok(bb1[0][1] === 128.8 && bb1[1][1] === 129.0, "두 점의 경도 범위");

// 한 점만 있으면 범위가 0 이 되어 지도가 최대 확대됩니다 → 넓혀야 합니다
const bb2 = bboxOf([{ lat: 37.75, lng: 128.9 }]);
ok(bb2[1][0] - bb2[0][0] > 0, "한 점이어도 범위가 0 이 아님 (지도 최대 확대 방지)");
ok(bb2[1][1] - bb2[0][1] > 0, "한 점이어도 경도 범위가 0 이 아님");

// 한국 밖 좌표는 범위에 끼지 않아야 합니다
const bb3 = bboxOf([{ lat: 37.7, lng: 128.8 }, { lat: 35.6, lng: 139.7 }]);
ok(bb3[1][1] < 130, "한국 밖 점은 범위에서 제외 (도쿄가 끼면 지도가 바다로 날아감)");

ok(inBbox(37.75, 128.9, bb1), "범위 안 판정");
ok(!inBbox(33.5, 126.5, bb1), "범위 밖 판정");
ok(inBbox(0, 0, null), "범위가 없으면 늘 true");

/* ---------- prettyKm ---------- */
console.log("── 거리 표시");
eq(prettyKm(0.35), "350m", "1km 미만은 m");
eq(prettyKm(4.27), "4.3km", "1km 이상은 km");
eq(prettyKm(NaN), "", "NaN 은 빈 문자열");

/* ---------- esc ---------- */
console.log("── HTML 이스케이프");
eq(esc("<script>alert(1)</script>"),
  "&lt;script&gt;alert(1)&lt;/script&gt;", "스크립트 태그 무력화");
eq(esc('a"b\'c&d'), "a&quot;b&#39;c&amp;d", "따옴표와 앰퍼샌드");
eq(esc(null), "", "null 은 빈 문자열");
eq(esc(undefined), "", "undefined 는 빈 문자열");

/* ---------- won ---------- */
console.log("── 금액");
eq(won(125000), "125,000원", "천 단위 구분");
eq(won(0), "0원", "0원");
eq(won(null), "0원", "null 은 0원");

/* ---------- fmtRange ---------- */
console.log("── 날짜 범위 표시");
eq(fmtRange("2027-01-23", "2027-01-24"), "2027.01.23 – 01.24 · 1박 2일", "1박 2일");
eq(fmtRange("2027-01-23", "2027-01-23"), "2027.01.23 – 01.23 · 당일", "당일치기");
eq(fmtRange("2027-04-30", "2027-05-03"), "2027.04.30 – 05.03 · 3박 4일", "달을 넘는 3박");
eq(fmtRange("", ""), "", "빈 입력");
eq(fmtRange(null, null), "", "null 입력");

/* ---------- enumerateDays ----------
   route.js 의 N일 일반화가 이걸 씁니다. 0박과 거꾸로 된 날짜가
   실제로 들어올 수 있고, 지금 코드는 1박2일만 가정하고 있었습니다. */
console.log("── 날짜 펼치기");
const w1 = enumerateDays("2027-01-23", "2027-01-24");
eq(w1.length, 2, "1박 2일 → 2일");
eq(w1[0].date, "2027-01-23", "첫날 날짜");
eq(w1[0].label, "1일차", "첫날 라벨");
eq(w1[0].dow, "토", "2027-01-23 은 토요일");
eq(w1[1].dow, "일", "다음날은 일요일");

const w0 = enumerateDays("2027-01-23", "2027-01-23");
eq(w0.length, 1, "당일치기 → 1일 (0박 경계)");

const w3 = enumerateDays("2027-04-30", "2027-05-03");
eq(w3.length, 4, "달을 넘는 3박 → 4일");
eq(w3[1].date, "2027-05-01", "달 경계를 넘김");

const wLeap = enumerateDays("2028-02-28", "2028-03-01");
eq(wLeap.length, 3, "윤년 2월 29일 포함 → 3일");
eq(wLeap[1].date, "2028-02-29", "2028은 윤년");

eq(enumerateDays("2027-01-24", "2027-01-23").length, 0, "거꾸로 된 날짜는 빈 배열");
eq(enumerateDays("", "").length, 0, "빈 입력");
eq(enumerateDays(null, null).length, 0, "null 입력");
ok(enumerateDays("2027-01-01", "2027-12-31").length <= 16, "아주 긴 범위도 상한에서 멈춤");

/* ---------- 결과 ---------- */
console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
