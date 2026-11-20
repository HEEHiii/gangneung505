/* ============================================================
   store.js / session.js / auth.js 브라우저 테스트

   실행: bash tests/run-browser.sh store

   서버 설정이 비어 있을 때의 "이 브라우저에만 저장" 모드를 검증합니다.
   서버 모드의 권한·격리·잠김은 tests/sql/test.sql 에서 이미 확인했고,
   여기서는 화면 코드가 기대하는 모양이 양쪽에서 같은지를 봅니다.
   ============================================================ */

import { createRequire } from "node:module";
import { stubConfig } from "./stub-config.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE || "http://localhost:8080";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(got === want, `${what}  (받음 ${JSON.stringify(got)})`);

const browser = await chromium.launch();
const ctx = await browser.newContext();
/* 진짜 config.js 가 채워져도 이 테스트는 "설정 없음" 상태를 봅니다 */
await stubConfig(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`${BASE}/tests/fixtures/store.html`);
await page.waitForFunction(() => window.__ready === true);

const FORM = {
  title: "겨울 강릉", start: "2027-01-23", end: "2027-01-24", people: 4,
  regionCode: "gangneung", regionName: "강릉", center: [37.7519, 128.8761],
  mapLevel: 8, hub: { name: "강릉역", lat: 37.7637, lng: 128.8990 },
  password: "0505", theme: "winter",
};

/* ============================================================
   1. 설정이 비어 있으면 로컬 모드
   ============================================================ */
console.log("── 모드 판정");
eq(await page.evaluate(() => window.C.hasBackend()), false, "설정이 비면 서버 없음으로 판정");
eq(await page.evaluate(() => window.C.hasMap()), false, "지도 키 없음으로 판정");

/* 설정이 비었을 때 CDN 을 건드리지 않는지 — 네트워크 요청을 지켜봅니다 */
const cdnHits = [];
page.on("request", (r) => {
  if (/jsdelivr|supabase\.co|dapi\.kakao/.test(r.url())) cdnHits.push(r.url());
});

/* ============================================================
   2. 방 만들기
   ============================================================ */
console.log("── 방 만들기");
const made = await page.evaluate((f) => window.S.createRoom(f), FORM);
ok(/^[23456789BCDFGHJKMNPQRSTVWXZ]{9}$/.test(made.slug),
  `slug 가 SQL 과 같은 알파벳 9자 (${made.slug})`);
eq(made.local, true, "로컬 모드로 만들어짐");

/* 공유 링크 */
const url = await page.evaluate((s) => window.C.roomUrl(s), made.slug);
ok(url.includes(`room.html?r=${made.slug}`), `공유 링크 모양 (${url.split("/").pop()})`);

/* ============================================================
   3. 입장 — 비밀번호
   ============================================================ */
console.log("── 입장");
await page.evaluate((s) => { window.st = window.S.createStore(s); }, made.slug);

const bad = await page.evaluate(() => window.st.join("9999"));
eq(bad.ok, false, "틀린 비밀번호는 ok=false");
eq(bad.code, "nomatch", "코드가 nomatch");
eq(await page.evaluate(() => window.st.hasToken()), false, "실패하면 토큰이 없음");

/* 없는 방 */
const ghost = await page.evaluate(() => window.S.createStore("ZZZZZZZZZ").join("0505"));
eq(ghost.code, "nomatch", "없는 방도 같은 코드 (존재 여부 안 알려줌)");

const good = await page.evaluate(() => window.st.join("0505"));
eq(good.ok, true, "맞는 비밀번호는 ok=true");
ok(await page.evaluate(() => window.st.hasToken()), "토큰이 생김");

/* 토큰 없이 쓰려 하면 */
const noTok = await page.evaluate(async () => {
  try { await window.S.createStore(window.st.slug).snapshot(); return "성공"; }
  catch (e) { return e.code; }
});
eq(noTok, "expired", "토큰 없이 읽으면 expired");

/* ============================================================
   4. 스냅샷 모양 — 서버와 같아야 합니다
   ============================================================ */
console.log("── 스냅샷 모양");
const snap = await page.evaluate(() => window.st.snapshot());
const keys = Object.keys(snap).sort().join(",");
eq(keys, "counts,expenses,itinerary,mine,places,room,unchanged,updated_at",
  "최상위 키가 SQL 의 room_snapshot 과 같음");

eq(snap.room.title, "겨울 강릉", "방 제목");
eq(snap.room.settings.theme, "winter", "테마가 전달됨");
eq(snap.room.people, 4, "인원");
eq(snap.room.hub.name, "강릉역", "출발 지점");
eq(JSON.stringify(snap.room.center), "[37.7519,128.8761]", "중심 좌표");
eq(snap.places.length, 0, "처음엔 장소 0곳");
ok(!("pw" in snap.room) && !("pw_hash" in snap.room), "비밀번호가 스냅샷에 섞이지 않음");

/* ============================================================
   5. 장소와 투표
   ============================================================ */
console.log("── 장소 · 투표");
const p1 = await page.evaluate(() => window.st.placeAdd({
  kind: "lodging", name: "오붓한강릉", lat: 37.8250, lng: 128.8780,
  approx: true, source: "link", note: "사천해변 도보권",
}));
ok(!!p1.id, "숙소 추가");

await page.evaluate(() => window.st.placeAdd({
  kind: "food", name: "초당순두부", lat: 37.7900, lng: 128.9110,
  kakao_place_id: "kakao-1",
}));

const dup = await page.evaluate(async () => {
  try {
    await window.st.placeAdd({ kind: "food", name: "초당순두부(중복)",
      lat: 37.79, lng: 128.91, kakao_place_id: "kakao-1" });
    return "성공";
  } catch (e) { return e.code; }
});
eq(dup, "conflict", "같은 카카오 장소를 또 넣으면 conflict");

let s2 = await page.evaluate(() => window.st.snapshot());
eq(s2.places.length, 2, "장소 2곳");
ok(s2.places.every((p) => p.mine === true), "내가 넣은 것에 mine=true");

/* 투표 */
const v1 = await page.evaluate((id) => window.st.voteSet(id, true), p1.id);
eq(v1.count, 1, "투표하면 1표");
const v2 = await page.evaluate((id) => window.st.voteSet(id, true), p1.id);
eq(v2.count, 1, "같은 사람이 또 눌러도 1표 (중복 안 됨)");
const v3 = await page.evaluate((id) => window.st.voteSet(id, false), p1.id);
eq(v3.count, 0, "취소하면 0표");

await page.evaluate((id) => window.st.voteSet(id, true), p1.id);
s2 = await page.evaluate(() => window.st.snapshot());
eq(s2.counts[p1.id], 1, "counts 에 반영");
ok(s2.mine.includes(p1.id), "mine 에 내 투표가 들어감");

/* 없는 장소에 투표 */
const badVote = await page.evaluate(async () => {
  try { await window.st.voteSet("없는-id", true); return "성공"; }
  catch (e) { return e.code; }
});
eq(badVote, "denied", "없는 장소에 투표하면 denied");

/* ============================================================
   6. 지우기 — 되돌릴 수 있게 표시만
   ============================================================ */
console.log("── 지우기");
await page.evaluate((id) => window.st.placeRemove(id), p1.id);
s2 = await page.evaluate(() => window.st.snapshot());
eq(s2.places.length, 1, "지운 장소는 목록에서 빠짐");
ok(!(p1.id in s2.counts), "지운 장소의 표도 집계에서 빠짐");

const gone = await page.evaluate(async (id) => {
  try { await window.st.placeRemove(id); return "성공"; }
  catch (e) { return e.code; }
}, p1.id);
eq(gone, "denied", "이미 지운 것을 또 지우면 denied");

/* ============================================================
   7. 안 바뀌었으면 작게 — 전송량 절약 장치
   ============================================================ */
console.log("── 변경 확인");
const cur = await page.evaluate(() => window.st.snapshot());
const again = await page.evaluate((since) => window.st.snapshot(since), cur.updated_at);
eq(again.unchanged, true, "바뀐 게 없으면 unchanged=true");
ok(!("places" in again), "unchanged 응답에는 목록이 없음 (작게)");

await page.evaluate(() => window.st.placeAdd({
  kind: "cafe", name: "테라로사", lat: 37.6878, lng: 128.8686,
}));
const after = await page.evaluate((since) => window.st.snapshot(since), cur.updated_at);
eq(after.unchanged, false, "바뀌면 unchanged=false");
eq(after.places.length, 2, "바뀐 뒤 목록이 옴");

/* ============================================================
   8. 세션 저장 — 방별로 나뉘는가
   ============================================================ */
console.log("── 세션 저장");
const voters = await page.evaluate(() => [
  window.Sess.voterKey("AAAAAAAAA"),
  window.Sess.voterKey("BBBBBBBBB"),
  window.Sess.voterKey("AAAAAAAAA"),
]);
ok(voters[0] !== voters[1], "방이 다르면 투표자 식별자도 다름 (두 방을 연결할 수 없음)");
eq(voters[0], voters[2], "같은 방이면 같은 식별자 유지");

eq(await page.evaluate(() => window.Sess.slugFromUrl()), "", "주소에 r 이 없으면 빈 문자열");

await page.evaluate(() => {
  window.Sess.rememberRoom("AAAAAAAAA", "첫 여행");
  window.Sess.rememberRoom("BBBBBBBBB", "둘째 여행");
  window.Sess.rememberRoom("AAAAAAAAA", "첫 여행");
});
const recent = await page.evaluate(() => window.Sess.recentRooms());
eq(recent.length, 2, "최근 방 목록에 중복이 없음");
eq(recent[0].slug, "AAAAAAAAA", "최근에 본 것이 맨 앞");

/* ============================================================
   9. 로그인 왕복 — 비밀번호가 주소에 새지 않아야 합니다
   ============================================================ */
console.log("── 로그인 왕복");
const nonce = await page.evaluate((f) => window.A.stashPending(f), FORM);
ok(!!nonce, "폼 꾸러미를 저장함");

const stored = await page.evaluate((n) => {
  const raw = localStorage.getItem("trip.pending." + n);
  return raw ? JSON.parse(raw) : null;
}, nonce);
eq(stored.password, "0505", "꾸러미에는 비밀번호가 들어 있음 (localStorage)");

const taken = await page.evaluate((n) => window.A.takePending(n), nonce);
eq(taken.title, "겨울 강릉", "꾸러미를 꺼냄");
const twice = await page.evaluate((n) => window.A.takePending(n), nonce);
eq(twice, null, "한 번 쓰면 사라짐 (나중에 방이 또 만들어지지 않게)");

/* 만료된 꾸러미 */
const expired = await page.evaluate(() => {
  localStorage.setItem("trip.pending.old",
    JSON.stringify({ title: "옛것", exp: Date.now() - 1000 }));
  return window.A.takePending("old");
});
eq(expired, null, "만료된 꾸러미는 무시");

await page.evaluate(() => {
  localStorage.setItem("trip.pending.stale",
    JSON.stringify({ title: "묵은것", exp: Date.now() - 99999 }));
  window.A.sweepPending();
});
eq(await page.evaluate(() => localStorage.getItem("trip.pending.stale")), null,
  "sweepPending 이 묵은 꾸러미를 치움");

/* ============================================================
   10. 오류 다듬기
   ============================================================ */
console.log("── 오류 메시지");
const codes = await page.evaluate(() => [
  window.Supa.toRpcError(new Error("[locked] 너무 많이 틀렸어요")).code,
  window.Supa.toRpcError(new Error("[locked] 너무 많이 틀렸어요")).message,
  window.Supa.toRpcError(new Error("permission denied for table rooms")).code,
  window.Supa.toRpcError(new Error("Could not find the function public.vote_set")).code,
  window.Supa.toRpcError(new Error("Failed to fetch")).code,
  window.Supa.toRpcError(new Error("뭔가 이상함")).code,
]);
eq(codes[0], "locked", "[locked] 를 코드로 뽑아냄");
eq(codes[1], "너무 많이 틀렸어요", "메시지에서 코드 괄호를 떼어냄");
eq(codes[2], "denied", "permission denied → denied");
eq(codes[3], "contract", "함수 못 찾음 → contract (개발 중 오류)");
eq(codes[4], "net", "네트워크 실패 → net");
eq(codes[5], "unknown", "모르는 오류 → unknown");

/* 표에 없는 인자를 보내면 바로 알려줍니다 */
const wrongArg = await page.evaluate(async () => {
  try {
    const { rpc } = await import("/app/assets/supa.js");
    await rpc("vote_set", { p_voter_key: "x" });
    return "성공";
  } catch (e) { return e.code; }
});
eq(wrongArg, "contract", "RPC 표에 없는 인자는 호출 전에 걸러짐");

/* ============================================================
   11. 설정이 비었으면 네트워크를 건드리지 않아야 합니다
   ============================================================ */
console.log("── 네트워크");
eq(cdnHits.length, 0, `설정이 비면 CDN·서버 요청이 0건${cdnHits.length ? " — " + cdnHits[0] : ""}`);
eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
