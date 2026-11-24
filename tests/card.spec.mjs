/* ============================================================
   스토리 카드 — 브라우저 검사

   실행: bash tests/run-browser.sh card

   ★ "Blob 이 나왔다" 로 끝내면 안 됩니다.
     텅 빈 1080×1920 PNG 도 Blob 입니다. 선을 안 그려도, 좌표를
     무시하고 아무 데나 그려도 통과합니다. 그래서 그려진 그림의
     픽셀을 읽고, 기대값은 그림이 아니라 layout 에서 뽑습니다.

     (최근 가짜 지도 스텁이 확대 단계를 안 바꿔서 검사가 헛돌던
      일이 있었습니다. 같은 종류를 두 번 겪지 않으려는 것입니다.)
   ============================================================ */

import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { stubConfig } from "./stub-config.mjs";

const BASE = process.env.BASE || "http://localhost:8080";

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};
const eq = (got, want, what) =>
  ok(JSON.stringify(got) === JSON.stringify(want),
     `${what}  (받음 ${JSON.stringify(got)})`);

const browser = await chromium.launch();

/* 강릉 언저리 — 남북으로도 동서로도 퍼지게 */
const PLACES = [
  { id: "p1", kind: "spot", name: "경포해변", lat: 37.7950, lng: 128.8960 },
  { id: "p2", kind: "food", name: "초당순두부", lat: 37.7840, lng: 128.9100 },
  { id: "p3", kind: "spot", name: "정동진", lat: 37.6900, lng: 129.0340 },
  { id: "p4", kind: "lodging", name: "경포호텔", lat: 37.7900, lng: 128.9000 },
];
const ITIN = [{
  day_index: 0,
  slots: [
    { title: "경포해변", kind: "spot", placeId: "p1" },
    { title: "초당순두부", kind: "food", placeId: "p2" },
    { title: "숙소 체크인 — 경포호텔", kind: "lodging" },
    { title: "정동진", kind: "spot", placeId: "p3" },
  ],
}];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await stubConfig(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${BASE}/app/room.html`);
  return { ctx, page, errors };
}

/* 그림을 만들고, 작게 줄여 픽셀을 통째로 가져옵니다 */
async function shoot(page, opts) {
  return page.evaluate(async ({ places, itin, opts }) => {
    const { pickPoints, layoutCard, renderCard } = await import("/app/assets/card.js");
    const points = pickPoints(itin, places, null);
    const L = layoutCard({ points, title: "겨울 강릉", sub: "강릉", foot: "1박 2일" }, opts);
    const blob = await renderCard(L);

    const bmp = await createImageBitmap(blob);
    const W = 108, H = 192;                     // 10분의 1로 줄여서 읽습니다
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0, W, H);
    const px = [...g.getImageData(0, 0, W, H).data];

    return {
      type: blob.type, size: blob.size,
      full: { w: bmp.width, h: bmp.height },
      small: { w: W, h: H }, px,
      layout: { w: L.w, h: L.h, area: L.area, stops: L.stops, labels: L.labels },
    };
  }, { places: PLACES, itin: ITIN, opts });
}

const at = (s, x, y) => {
  const i = (y * s.small.w + x) * 4;
  return { r: s.px[i], g: s.px[i + 1], b: s.px[i + 2] };
};
const isInk = (p) => p.r > 235 && p.g > 235 && p.b > 235;   // 흰 선·점·글자


/* ============================================================
   1. 그림이 실제로 그려지는가
   ============================================================ */
{
  console.log("── 그림");
  const { ctx, page, errors } = await open();
  const s = await shoot(page, { showNames: false });

  eq(s.full, { w: 1080, h: 1920 }, "★ 인스타 스토리 크기로 나온다");
  eq(s.type, "image/png", "PNG 이다 (인스타·사진첩이 확실히 받습니다)");
  ok(s.size > 3000 && s.size < 900000, `용량이 그럴듯하다  (${Math.round(s.size / 1024)}KB)`);

  /* ★ 그라데이션 방향 — 위아래를 뒤집으면 깨집니다 */
  const top = at(s, 54, 2), bot = at(s, 54, s.small.h - 3);
  ok(top.g > bot.g + 20 && bot.r >= top.r - 30,
    `★ 위가 노랗고 아래가 붉다  (위 ${top.r},${top.g},${top.b} / 아래 ${bot.r},${bot.g},${bot.b})`);

  /* ★ 흰 것이 실제로 그려졌다 — 선을 지우면 하한에 걸립니다 */
  let ink = 0;
  for (let y = 0; y < s.small.h; y++)
    for (let x = 0; x < s.small.w; x++) if (isInk(at(s, x, y))) ink++;
  const pct = (ink / (s.small.w * s.small.h)) * 100;
  ok(pct > 0.8 && pct < 20, `★ 선과 글자가 그려져 있다  (흰 픽셀 ${pct.toFixed(1)}%)`);

  /* ★ 흰 것이 "동선이 지나는 자리" 에 있다.

     기대값을 그림에서 뽑지 않고 layout 에서 뽑는 것이 핵심입니다.
     좌표를 무시하고 아무 데나 그리면 칸이 어긋나 깨집니다. */
  const A = s.layout.area;
  const cell = (x, y) => `${Math.min(2, Math.floor((x - A.x) / (A.w / 3)))},`
                       + `${Math.min(2, Math.floor((y - A.y) / (A.h / 3)))}`;
  const want = new Set(s.layout.stops.map((p) => cell(p.x, p.y)));

  const got = new Set();
  const k = s.small.w / s.layout.w;
  for (let y = 0; y < s.small.h; y++) {
    for (let x = 0; x < s.small.w; x++) {
      if (!isInk(at(s, x, y))) continue;
      const fx = x / k, fy = y / k;
      if (fx < A.x || fx > A.x + A.w || fy < A.y || fy > A.y + A.h) continue;
      got.add(cell(fx, fy));
    }
  }
  const missing = [...want].filter((c) => !got.has(c));
  eq(missing, [], "★ 점이 있어야 할 칸에 실제로 흰 픽셀이 있다 (좌표를 쓴다)");

  eq(errors.length, 0, `콘솔 오류 없음${errors.length ? " — " + errors[0] : ""}`);
  await ctx.close();
}


/* ============================================================
   2. 장소 이름 토글
   ============================================================ */
{
  console.log("── 장소 이름");
  const { ctx, page } = await open();

  const off = await shoot(page, { showNames: false });
  const on = await shoot(page, { showNames: true });

  eq(off.layout.labels.length, 0, "★ 기본은 이름이 하나도 없다");
  ok(on.layout.labels.length > 0, `켜면 이름이 생긴다  (${on.layout.labels.length}개)`);

  /* ★ 숙소는 켜도 안 나옵니다 */
  ok(!JSON.stringify(on.layout).includes("경포호텔"),
    "★ 숙소 이름은 켜도 그림에 안 들어간다");

  /* ★ 흰 픽셀 수로 재면 안 됩니다. 이름표 뒤에 깔리는 어두운 띠가
     원래 희던 선을 덮어서, 켰는데 흰 픽셀이 오히려 줄어듭니다.
     (실제로 그래서 한 번 틀렸습니다.)

     그래서 "그림이 달라졌는가" 를 그대로 잽니다 — 토글을 무시하게
     되돌리면 달라진 픽셀이 0 이 되어 깨집니다. */
  let moved = 0;
  for (let i = 0; i < off.px.length; i += 4) {
    if (Math.abs(off.px[i] - on.px[i]) > 12 ||
        Math.abs(off.px[i + 1] - on.px[i + 1]) > 12 ||
        Math.abs(off.px[i + 2] - on.px[i + 2]) > 12) moved++;
  }
  ok(moved > 20, `★ 켜면 그림이 실제로 달라진다  (바뀐 픽셀 ${moved}개)`);

  /* 이름표가 layout 이 말한 자리에 생깁니다 */
  const k = on.small.w / on.layout.w;
  const box = on.layout.labels[0];
  let near = 0;
  for (let y = 0; y < on.small.h; y++) {
    for (let x = 0; x < on.small.w; x++) {
      const i = (y * on.small.w + x) * 4;
      if (Math.abs(off.px[i] - on.px[i]) <= 12) continue;
      if (Math.hypot(x / k - box.x, y / k - box.y) < 260) near++;
    }
  }
  ok(near > 0, "★ 바뀐 자리가 layout 이 말한 이름표 자리 근처다");

  await ctx.close();
}


/* ============================================================
   3. 여행이 끝난 뒤에만
   ============================================================ */
{
  console.log("── 언제 보이는가");
  const { ctx, page } = await open();

  const seeButton = async (end) => page.evaluate(async (end) => {
    /* 화면 코드가 보는 조건을 그대로 흉내냅니다 */
    const { canDraw } = await import("/app/assets/card.js");
    const ended = !!(end && new Date(`${end}T23:59:59`) < new Date());
    return ended && canDraw();
  }, end);

  eq(await seeButton("2030-01-01"), false, "★ 여행 전에는 안 보인다 (집 비는 때를 알리지 않습니다)");
  eq(await seeButton("2020-01-01"), true, "여행이 끝나면 보인다");

  await ctx.close();
}

await browser.close();

console.log("");
if (fails === 0) console.log("전부 통과");
else { console.log(`실패 ${fails}건`); process.exit(1); }
