/* ============================================================
   짧은 링크 풀기 — 안전장치 검사

   실행: node tests/resolve.check.mjs

   ★ 이 함수는 주소만 알면 누구나 부를 수 있습니다.
     막지 않으면 "아무 주소나 대신 긁어주는 서버"가 되어, 남의
     내부망을 찔러보는 도구로 쓰입니다(SSRF). 보안 장치는 짰다고
     되는 게 아니라, 일부러 공격해 보고 막히는 걸 봐야 합니다.
   ============================================================ */

import { hostAllowed, safeUrl, coordsFrom, nameFrom, inKorea }
  from "../supabase/functions/resolve-link/safe.js";
import { buildBundle } from "../tools/build-resolve.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${what}  (받음 ${JSON.stringify(got)})`);

/* ============================================================
   1. 허용한 곳만 열어본다
   ============================================================ */
console.log("── 허용한 주소");
for (const u of [
  "https://naver.me/abcd1234",
  "https://map.naver.com/p/entry/place/123",
  "https://m.place.naver.com/restaurant/123",
  "https://booking.naver.com/booking/x",
  "https://kko.to/abcd",
  "https://place.map.kakao.com/12345",
  "https://maps.app.goo.gl/xyz",
]) ok(!!safeUrl(u), `열어봄: ${u}`);

console.log("── 막아야 하는 주소");
const BLOCKED = [
  ["http://169.254.169.254/latest/meta-data/", "클라우드 메타데이터 (서버 열쇠가 들어 있는 곳)"],
  ["http://127.0.0.1:8000/admin", "자기 자신"],
  ["http://localhost/secret", "localhost"],
  ["http://10.0.0.5/", "사설망 10.x"],
  ["http://192.168.0.1/", "사설망 192.168.x"],
  ["http://172.16.0.1/", "사설망 172.16.x"],
  ["http://[::1]/", "IPv6 자기 자신"],
  ["http://db.internal/", ".internal 도메인"],
  ["http://printer.local/", ".local 도메인"],
  ["file:///etc/passwd", "파일 읽기"],
  ["gopher://evil/", "다른 스킴"],
  ["ftp://naver.me/x", "ftp"],
  ["https://evil.com/", "허용 목록 밖"],
  ["https://naver.me.evil.com/", "★ 허용 호스트를 앞에 붙인 가짜"],
  ["https://evil.com/?x=naver.me", "주소 안에 허용 호스트를 숨긴 것"],
  ["https://naver.mevil.com/", "비슷한 이름"],
  ["", "빈 값"],
  ["그냥 글자", "주소가 아님"],
];
for (const [u, why] of BLOCKED) ok(safeUrl(u) === null, `막음: ${why}`);

console.log("── 호스트 판단");
ok(hostAllowed("naver.me"), "naver.me 는 허용");
ok(hostAllowed("m.naver.me"), "하위 도메인도 허용");
ok(!hostAllowed("naver.me.evil.com"), "★ 뒤에 다른 도메인이 붙으면 거부");
ok(!hostAllowed("1.2.3.4"), "IP 를 직접 적으면 거부");
ok(hostAllowed("NAVER.ME"), "대문자로 써도 허용");

/* ============================================================
   2. 좌표 읽기
   ============================================================ */
console.log("── 좌표 읽기");
eq(coordsFrom("https://map.naver.com/p/?lat=37.7956&lng=128.9142"),
   { lat: 37.7956, lng: 128.9142 }, "lat/lng");
eq(coordsFrom("https://map.naver.com/p/?lng=128.9142&lat=37.7956"),
   { lat: 37.7956, lng: 128.9142 }, "순서가 반대여도 맞게");
eq(coordsFrom("https://map.naver.com/p/x?c=128.9142,37.7956,15,0,0,0,dh"),
   { lat: 37.7956, lng: 128.9142 }, "네이버 c= (경도,위도)");
eq(coordsFrom("https://www.google.com/maps/@37.7956,128.9142,15z"),
   { lat: 37.7956, lng: 128.9142 }, "구글 @위도,경도");
eq(coordsFrom("https://www.google.com/maps/x!3d37.7956!4d128.9142"),
   { lat: 37.7956, lng: 128.9142 }, "구글 !3d!4d");

console.log("── 한국 밖은 안 받는다");
ok(coordsFrom("https://map.naver.com/?lat=48.8584&lng=2.2945") === null,
  "에펠탑 좌표는 거부 (카카오 지도가 한국 전용입니다)");
ok(coordsFrom("https://map.naver.com/?lat=0&lng=0") === null, "0,0 거부");
ok(coordsFrom("https://naver.me/abcd1234") === null, "좌표가 없으면 null");
ok(!inKorea(NaN, NaN), "숫자가 아니면 거부");

console.log("── 이름 읽기");
eq(nameFrom("https://map.naver.com/?title=%EC%B4%88%EB%8B%B9%EC%88%9C%EB%91%90%EB%B6%80"),
   "초당순두부", "한글 이름을 읽는다");
eq(nameFrom("https://map.naver.com/?name=cafe+bada"), "cafe bada", "+ 는 공백으로");
eq(nameFrom("https://naver.me/x"), "", "이름이 없으면 빈 문자열");
ok(nameFrom("https://map.naver.com/?title=" + "가".repeat(200)).length <= 60,
  "아무리 길어도 60자로 자른다");
eq(nameFrom("https://map.naver.com/?title=%E0%A4%A"), "", "깨진 글자여도 터지지 않는다");

/* ============================================================
   3. 붙여넣기용 한 파일이 최신인가

   ★ Supabase 편집기에서는 파일 여러 개를 만들기 번거로워서,
     safe.js + index.ts 를 합친 bundled.ts 를 따로 둡니다.
     사본은 반드시 낡습니다 — 한쪽만 고치고 다른 쪽을 잊으면,
     그 어긋남은 배포한 뒤에야 드러납니다. 그래서 지금 다시
     만들어 보고 커밋된 것과 같은지 확인합니다.
   ============================================================ */
console.log("── 붙여넣기용 파일");
{
  const HERE = dirname(fileURLToPath(import.meta.url));
  const file = join(HERE, "..", "supabase", "functions", "resolve-link", "bundled.ts");
  let saved = "";
  try { saved = readFileSync(file, "utf8"); } catch (_) {}
  ok(saved === buildBundle(),
    "bundled.ts 가 최신이다 (낡았으면: node tools/build-resolve.mjs)");
  ok(saved.includes("Deno.serve"), "bundled.ts 에 진입점이 들어 있다");
  ok(!saved.includes('from "./safe.js"'), "bundled.ts 에 다른 파일을 부르는 줄이 없다");
  ok(saved.includes("hostAllowed"), "bundled.ts 에 안전장치가 들어 있다");
}

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
