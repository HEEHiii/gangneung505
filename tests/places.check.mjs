/* ============================================================
   places.js — 링크 파싱 테스트

   실행: node tests/places.check.mjs

   여기가 505 판에서 가장 잘 깨지던 자리입니다. 예전에는 네이버·
   에어비앤비 페이지의 HTML 을 정규식으로 긁었고, 사이트가 조금만
   바뀌면 전원이 고장났습니다.

   지금은 "주소 문자열에서 좌표를 뽑는" 것만 합니다. HTML 을 읽지
   않으므로 사이트가 바뀌어도 영향이 없습니다. 대신 주소 형식이
   여러 가지라, 그 경우들을 여기에 모아둡니다.

   ★ 핵심 요령 하나: 위도·경도 순서를 외우지 않습니다.
     네이버는 경도가 먼저고 구글은 위도가 먼저이며 형식이 자주 바뀝니다.
     그래서 두 순서를 다 넣어보고 "한국 안에 떨어지는 쪽"을 고릅니다.
   ============================================================ */

import { coordsFromUrl, nameFromUrl, isShortUrl , hintFor } from "../app/assets/places.js";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const near = (got, want, what) => {
  const good = got && Math.abs(got.lat - want[0]) < 1e-4 && Math.abs(got.lng - want[1]) < 1e-4;
  ok(good, `${what}  (받음 ${got ? `${got.lat}, ${got.lng}` : "null"})`);
};
const eq = (got, want, what) => ok(got === want, `${what}  (받음 ${JSON.stringify(got)})`);

/* ============================================================
   좌표 뽑기 — 되는 경우
   ============================================================ */
console.log("── 주소에서 좌표 (성공)");

near(coordsFromUrl("https://www.google.com/maps/@37.7637,128.8990,17z"),
  [37.7637, 128.8990], "구글 @위도,경도");

near(coordsFromUrl("https://www.google.com/maps/place/x/data=!3m1!4b1!3d37.7955!4d128.9105"),
  [37.7955, 128.9105], "구글 !3d위도!4d경도");

/* 네이버는 경도가 먼저입니다 — 순서를 외우지 않고 알아서 맞춥니다 */
near(coordsFromUrl("https://map.naver.com/v5/?c=128.9444,37.7743,15,0,0,0,dh"),
  [37.7743, 128.9444], "네이버 c=경도,위도 (순서가 거꾸로여도 맞춤)");

near(coordsFromUrl("https://m.place.naver.com/restaurant/123?lat=37.7900&lng=128.9110"),
  [37.7900, 128.9110], "lat= / lng=");

near(coordsFromUrl("https://example.com/?lng=128.9110&lat=37.7900"),
  [37.7900, 128.9110], "lng 가 먼저 나와도 맞춤");

near(coordsFromUrl("https://map.naver.com/?x=128.8990&y=37.7637"),
  [37.7637, 128.8990], "x= / y= (네이버식)");

near(coordsFromUrl("https://map.kakao.com/link/map/강릉역,37.7637,128.8990"),
  [37.7637, 128.8990], "카카오 link/map/이름,위도,경도");

near(coordsFromUrl("37.7743, 128.9444"), [37.7743, 128.9444], "그냥 좌표 두 개");

/* ============================================================
   좌표 뽑기 — 안 되어야 하는 경우

   잘못 뽑으면 핀이 엉뚱한 데 찍히고, 사용자는 그걸 눈치채기 어렵습니다.
   "못 찾음"이 "틀린 좌표"보다 훨씬 낫습니다.
   ============================================================ */
console.log("── 주소에서 좌표 (실패해야 정상)");

eq(coordsFromUrl("https://naver.me/5xjphLSt"), null, "단축 주소에는 좌표가 없음");
eq(coordsFromUrl("https://place.map.kakao.com/1234567"), null, "장소 번호만 있는 주소");
eq(coordsFromUrl("https://www.airbnb.co.kr/rooms/12345678"), null, "에어비앤비 숙소 번호");
eq(coordsFromUrl(""), null, "빈 문자열");
eq(coordsFromUrl(null), null, "null");

/* 신형 네이버는 c= 에 확대 배율이 먼저 옵니다 — 좌표로 오해하면 안 됩니다 */
eq(coordsFromUrl("https://map.naver.com/p/entry/place/11658148?c=15.00,0,0,0,dh"), null,
  "신형 네이버 c=확대배율,... 은 좌표가 아님");

/* 한국 밖은 받지 않습니다 (지금 서비스는 국내 전용입니다) */
eq(coordsFromUrl("https://www.google.com/maps/@35.6586,139.7454,17z"), null,
  "도쿄 좌표는 거부");
eq(coordsFromUrl("https://www.google.com/maps/@40.7128,-74.0060,17z"), null,
  "뉴욕 좌표는 거부");

/* 버전 번호 같은 숫자를 좌표로 착각하지 않아야 합니다 */
eq(coordsFromUrl("https://cdn.example.com/lib/v1.234/x2.345/app.js"), null,
  "주소 속 버전 번호를 좌표로 오해하지 않음");

/* ============================================================
   이름 뽑기 — 좌표를 못 찾았을 때 검색에 쓸 말
   ============================================================ */
console.log("── 주소에서 이름");

eq(nameFromUrl("https://map.naver.com/p/search/초당순두부"), "초당순두부", "경로에 든 한글 이름");
eq(nameFromUrl("https://map.naver.com/p/search/%EA%B0%95%EB%A6%89%EC%97%AD"), "강릉역",
  "퍼센트 인코딩된 한글");
eq(nameFromUrl("https://example.com/?q=테라로사"), "테라로사", "q= 로 들어온 이름");
eq(nameFromUrl("https://example.com/?query=경포해변"), "경포해변", "query= 로 들어온 이름");

/* 카카오 link/map 은 이름 뒤에 좌표가 붙습니다 — 떼어내야 합니다 */
eq(nameFromUrl("https://map.kakao.com/link/map/강릉역,37.7637,128.8990"), "강릉역",
  "이름 뒤에 붙은 좌표를 떼어냄");

eq(nameFromUrl("https://place.map.kakao.com/1234567"), "", "한글이 없으면 빈 문자열");
eq(nameFromUrl("https://naver.me/5xjphLSt"), "", "단축 주소에는 이름이 없음");
eq(nameFromUrl("그냥 글자"), "", "주소가 아니면 빈 문자열");
eq(nameFromUrl(""), "", "빈 문자열");

/* ============================================================
   단축 주소 판정 — 서버를 거쳐야 하는 것들
   ============================================================ */
console.log("── 단축 주소 판정");

ok(isShortUrl("https://naver.me/5xjphLSt"), "naver.me");
ok(isShortUrl("https://kko.to/abc"), "kko.to");
ok(isShortUrl("https://maps.app.goo.gl/abc"), "maps.app.goo.gl");
ok(!isShortUrl("https://map.naver.com/p/search/x"), "일반 네이버 지도는 단축 아님");
ok(!isShortUrl("https://naver.me.evil.com/x"), "naver.me 를 흉내 낸 주소는 단축 아님");
ok(!isShortUrl("그냥 글자"), "주소가 아니면 false");

/* ============================================================
   결과
   ============================================================ */
console.log("── 못 찾았을 때 안내");
{
  const air = hintFor("https://www.airbnb.co.kr/rooms/12345678");
  ok(air.includes("에어비앤비"), "에어비앤비는 왜 안 되는지 알려준다");
  ok(air.includes("예약 링크"), "대신 할 수 있는 방법을 알려준다");
  ok(!air.includes("못 찾았어요"), "사용자 잘못처럼 말하지 않는다");

  ok(hintFor("https://abnb.me/xyz").includes("에어비앤비"), "에어비앤비 짧은 링크도 같게");
  ok(hintFor("https://www.yanolja.com/stay/1").includes("예약 링크"), "다른 예약 사이트도");
  ok(hintFor("https://naver.me/abcd").includes("짧은 링크"), "짧은 링크는 짧은 링크대로");
  ok(hintFor("https://example.com/x").includes("못 찾았어요"), "모르는 사이트는 일반 안내");
  ok(hintFor("아무거나").length > 0, "주소가 아니어도 터지지 않는다");
}

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
