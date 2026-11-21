/* ============================================================
   config.js 안전 검사

   실행: node tests/config.check.mjs

   ★ 왜 이 검사가 있는가

   config.js 는 코드가 아니라 "사람이 키를 붙여넣는 칸" 입니다.
   그래서 이 저장소에서 사람 손이 가장 자주 닿는 파일이고,
   여기서의 실수는 조용합니다 — 화면은 멀쩡히 돌아갑니다.

   막으려는 사고 두 가지:

   1) service_role / sb_secret_ 키를 붙여넣기
      모든 잠금을 무시하는 키입니다. 페이지는 "더 잘" 돌아가는 것처럼
      보이지만, 주소만 알면 누구나 전체 데이터를 지울 수 있게 됩니다.
      깃허브에 올라가는 파일이므로 사실상 공개입니다.

   2) 두 줄 중 한 줄만 채우기
      hasBackend() 가 false 가 되어 조용히 "이 브라우저에만 저장"
      모드로 떨어집니다. 오류가 없어서 친구들과 합쳐지지 않는 걸
      한참 뒤에야 알게 됩니다.
   ============================================================ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = join(HERE, "..", "app", "assets", "config.js");
const src = readFileSync(PATH, "utf8");

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};

const read = (name) => {
  const m = src.match(new RegExp(`^export const ${name} = "(.*?)";$`, "m"));
  return m ? m[1] : null;
};

const URL_ = read("SUPABASE_URL");
const KEY = read("SUPABASE_ANON_KEY");
const KAKAO = read("KAKAO_JS_KEY");
const PHOTO_FN = read("PHOTO_FN");
const PROVIDER = read("LOGIN_PROVIDER");
const RESOLVE_FN = read("RESOLVE_FN");

console.log("── 네 줄이 제자리에 있는지");
for (const [n, v] of [["SUPABASE_URL", URL_], ["SUPABASE_ANON_KEY", KEY],
                      ["KAKAO_JS_KEY", KAKAO], ["PHOTO_FN", PHOTO_FN]]) {
  ok(v !== null, `${n} 줄을 읽을 수 있음`);
}
if ([URL_, KEY, KAKAO, PHOTO_FN].some((v) => v === null)) {
  console.log("\nconfig.js 모양이 바뀌었습니다. tests/stub-config.mjs 도 같이 확인하세요.");
  process.exit(1);
}

/* ---------- 1. 위험한 키 ---------- */
console.log("── 비밀 키가 섞여 들어가지 않았는지");

ok(!KEY.startsWith("sb_secret_"),
  "SUPABASE_ANON_KEY 가 sb_secret_ 키가 아님");

/* 옛 형식 키는 JWT 라서 가운데 토막에 역할이 적혀 있습니다 */
let role = null;
if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(KEY)) {
  try {
    role = JSON.parse(Buffer.from(KEY.split(".")[1], "base64url").toString()).role;
  } catch { /* 못 읽으면 아래에서 따로 걸립니다 */ }
}
ok(role !== "service_role",
  `SUPABASE_ANON_KEY 가 service_role 키가 아님${role ? ` (역할: ${role})` : ""}`);

/* 카카오 Client Secret 과 REST 키는 생김새가 JS 키와 같아 구분할 수 없습니다.
   대신 "여기 들어오면 안 되는 것"만 막습니다. */
ok(!/^ey[A-Za-z0-9_-]+\./.test(KAKAO), "KAKAO_JS_KEY 자리에 JWT 가 들어있지 않음");
ok(!KAKAO.startsWith("sb_"), "KAKAO_JS_KEY 자리에 Supabase 키가 들어있지 않음");

/* 카카오 앱 키는 소문자 16진수 32자입니다. 복사하다 잘리거나 앞뒤에
   공백이 묻는 사고가 흔한데, 그러면 지도가 조용히 안 뜹니다. */
if (KAKAO) {
  ok(/^[0-9a-f]{32}$/.test(KAKAO),
    `KAKAO_JS_KEY 가 카카오 키 모양 (소문자 16진수 32자, 지금 ${KAKAO.length}자)`);
}
ok(!KEY.startsWith("sb_") || KEY.startsWith("sb_publishable_"),
  "Supabase 키는 publishable 이거나 옛 anon 형식");

/* ---------- 1-2. 로그인 서비스 ---------- */
console.log("── 방장 로그인 서비스");
const KNOWN = ["google", "github", "kakao"];
ok(KNOWN.includes(PROVIDER),
  `LOGIN_PROVIDER 가 아는 값  (지금 ${JSON.stringify(PROVIDER)})`);
if (PROVIDER === "kakao") {
  console.log("  참고   카카오는 비즈앱 전환이 끝난 뒤에만 됩니다 (KOE205)");
}

/* ---------- 1-3. 링크 풀기 함수 이름 ---------- */
console.log("── 짧은 링크 풀기");
if (RESOLVE_FN !== null) {
  ok(/^[a-z0-9][a-z0-9-]{0,40}$/.test(RESOLVE_FN),
    `RESOLVE_FN 이 Supabase 함수 이름 모양  (${JSON.stringify(RESOLVE_FN)})`);
}

/* ---------- 2. 반쪽만 채운 상태 ---------- */
console.log("── 반쪽만 채워서 조용히 꺼지지 않는지");
ok(!!URL_ === !!KEY,
  URL_ || KEY
    ? "SUPABASE_URL 과 ANON_KEY 가 둘 다 채워졌거나 둘 다 비었음"
    : "Supabase 설정이 아직 비어 있음 (로컬 저장 모드 — 정상)");

/* ---------- 3. 주소 모양 ---------- */
console.log("── 주소 모양");
if (URL_) {
  ok(URL_.startsWith("https://"), "SUPABASE_URL 이 https");
  ok(!URL_.endsWith("/"), "SUPABASE_URL 끝에 / 가 없음 (붙으면 요청 주소가 //rest 가 됩니다)");
  ok(/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(URL_),
    `SUPABASE_URL 이 프로젝트 주소 모양  (${URL_})`);
} else {
  console.log("  건너뜀 — Supabase 주소가 비어 있음");
}
ok(/^[a-z0-9][a-z0-9-]{0,40}$/.test(PHOTO_FN || ""),
  `PHOTO_FN 이 Supabase 함수 이름 모양  (${JSON.stringify(PHOTO_FN)})`);

/* ★ 공개 주소를 적는 칸이 다시 생기면 안 됩니다.
   그걸 쓰면 사진이 비밀번호 밖으로 나가고, 한 번 복사된 주소는
   비밀번호를 바꿔도 계속 살아 있습니다. */
ok(!/export const R2_PUBLIC_BASE/.test(src),
  "사진 공개 주소 칸이 없다 (사진은 비밀번호 뒤에 있어야 합니다)");

/* ---------- 4. 지금 어떤 모드인지 알려주기 ---------- */
console.log("── 지금 상태");
console.log(`  저장   ${URL_ && KEY ? "Supabase 서버 (친구와 합쳐짐)" : "이 브라우저에만"}`);
console.log(`  지도   ${KAKAO ? "카카오 지도" : "안내판으로 대체"}`);
console.log(`  갤러리 ${PHOTO_FN} (연결됐는지는 열 때 확인합니다)`);
console.log(`  로그인 ${PROVIDER}`);
console.log(`  링크풀기 ${RESOLVE_FN}`);

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
