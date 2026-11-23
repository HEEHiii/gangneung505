/* ============================================================
   사진 줄이기 — 브라우저 테스트

   실행: bash tests/run-browser.sh photo

   ★ 여기서 증명해야 하는 것

   1) 위치정보(GPS)가 정말 사라지는가
      휴대폰 사진에는 찍은 자리의 좌표가 박혀 있습니다. 숙소에서
      찍은 사진을 그대로 올리면 숙소 위치가 좌표까지 공개됩니다.
      링크를 가진 누구나 볼 수 있는 방인데요.
      "캔버스에 다시 그리면 지워진다"는 말은 맞지만, 말로 끝내면
      안 됩니다. 좌표를 박은 사진을 통과시켜 보고 확인합니다.

   2) 용량이 정말 줄어드는가
      전송량이 이 서비스에서 유일하게 진짜 돈이 드는 자원입니다.
   ============================================================ */

import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { gpsJpegBytes } from "./fixtures/gps-jpeg.mjs";

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
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/app/room.html`);

const bytes = [...gpsJpegBytes(37.8250, 128.8780)];

/* ============================================================
   1. 줄이기
   ============================================================ */
console.log("── 줄이기");
const r = await page.evaluate(async (arr) => {
  const { prepare, prettyBytes, canResize, bestType } =
    await import("/app/assets/photo.js");
  const file = new File([new Uint8Array(arr)], "trip.jpg", { type: "image/jpeg" });
  const got = await prepare(file);

  const toB64 = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  };
  return {
    canResize: canResize(), type: bestType(),
    srcBytes: file.size, fullBytes: got.full.size, thumbBytes: got.thumb.size,
    width: got.width, height: got.height,
    pretty: prettyBytes(got.full.size),
    full: await toB64(got.full), thumb: await toB64(got.thumb),
  };
}, bytes);

ok(r.canResize, "이 브라우저에서 줄이기를 쓸 수 있다");
ok(r.width <= 2048 && r.height <= 2048,
  `보기용이 긴 변 2048 이내로 줄어듦  (${r.width}x${r.height})`);
ok(r.fullBytes < r.srcBytes, `용량이 줄어듦  (${r.srcBytes} → ${r.fullBytes})`);
ok(r.thumbBytes < r.fullBytes, "목록용이 보기용보다 작다");
ok(/^image\/(webp|jpeg)$/.test(r.type), `쓸 수 있는 형식을 고름  (${r.type})`);
ok(/KB|MB|B$/.test(r.pretty), `용량을 사람 말로 보여줌  (${r.pretty})`);

/* ============================================================
   2. ★ 위치정보가 사라지는가
   ============================================================ */
console.log("── 위치정보 지우기");
{
  /* 원본에는 분명히 들어 있다 (테스트 자체가 맞는지 먼저 확인) */
  const src = Buffer.from(bytes);
  ok(src.includes(Buffer.from("Exif")), "원본에는 EXIF 가 들어 있다 (시험이 유효함)");

  for (const [name, b64] of [["보기용", r.full], ["목록용", r.thumb]]) {
    const out = Buffer.from(b64, "base64");
    ok(!out.includes(Buffer.from("Exif")), `${name}에 EXIF 흔적이 없다`);
    ok(!out.includes(Buffer.from("GPS")), `${name}에 GPS 글자가 없다`);

    /* 좌표 숫자가 바이트로 남아 있지는 않은지 — 도·분·초 값 */
    const lat = Buffer.from([0, 0, 0, 37, 0, 0, 0, 1]);   // 37도
    ok(!out.includes(lat), `${name}에 위도 값이 남아 있지 않다`);
  }
}

/* ============================================================
   3. 이상한 입력
   ============================================================ */
console.log("── 이상한 파일");
{
  const bad = await page.evaluate(async () => {
    const { prepare } = await import("/app/assets/photo.js");
    const out = {};
    const t = async (k, file) => {
      try { await prepare(file); out[k] = "통과함"; }
      catch (e) { out[k] = e.message; }
    };
    await t("문서", new File([new Uint8Array([1, 2, 3])], "a.pdf", { type: "application/pdf" }));
    await t("빈값", null);
    await t("너무큼", new File([new Uint8Array(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }));
    return out;
  });
  ok(bad.문서.includes("사진 파일만"), `사진이 아니면 거부  (${bad.문서})`);
  ok(bad.빈값.includes("사진 파일만"), "빈 값도 거부");
  ok(bad.너무큼.includes("너무 커요"), `10MB 넘으면 거부  (${bad.너무큼})`);
}

eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
