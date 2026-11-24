/* ============================================================
   여행이 끝난 뒤 남는 한 장 — 스토리 카드 (9:16)

   ★ 왜 만드는가

   이 서비스는 여행을 정하는 동안만 쓰이고 끝나면 손에 남는 게
   없습니다. 아무도 "우리 이렇게 다녔어" 를 보여줄 수 없습니다.
   올릴 물건이 없으면 아무도 안 올리고, 안 올라가면 아무도
   모릅니다.

   ★ 왜 지도 타일을 안 쓰는가

   카카오 지도는 캔버스로 내보낼 수 없습니다(이용약관·CORS).
   그래서 좌표만 받아 선과 점으로 직접 그립니다. 이건 제약이
   아니라 장점입니다:
     · 추상적이라 "기본은 보수적으로" 와 맞습니다
     · 선 모양이 여행마다 달라서 "내 것" 이 됩니다
     · 사진이 한 장도 없어도 성립합니다

   ★ 왜 순수 부분과 캔버스 부분을 가르는가

   좌표를 화면에 앉히는 계산이 제일 틀리기 쉬운데, 캔버스에
   묶여 있으면 눈으로 보기 전까지 모릅니다. layoutCard 는
   캔버스 없이 숫자만 내놓으므로 node 로 바로 검사합니다.
   ============================================================ */

import { bboxOf, inKorea, distanceKm } from "./geo.js";

/* 인스타 스토리 크기. 세로 한 장이면 카톡에도 그냥 보낼 수 있어
   두 곳을 다 덮습니다. */
export const CARD = { w: 1080, h: 1920 };

/* tools/make-og.py 가 이미 정한 배색을 그대로 씁니다 */
export const COLORS = {
  top: "#ffb84d",
  bottom: "#f05848",
  ink: "#ffffff",
};

/* 지도가 들어갈 자리 — 위는 제목, 아래는 요약에 내줍니다 */
const AREA = { x: 110, top: 480, bottom: 390 };

/* 점이 하나뿐이거나 전부 같은 자리일 때 강제할 최소 범위(도) */
const MIN_SPAN = 0.01;


/* ------------------------------------------------------------
   1) 일정에서 좌표가 있는 점을 뽑습니다

   ★ slot 에는 좌표가 없습니다.
     {time, title, note, kind, placeId?, fixed?} 가 전부라서
     placeId 로 places 를 찾아 이어야 합니다.

   ★ placeId 가 없는 칸(도착·체크인·체크아웃·귀가)도 버리면
     안 됩니다. 그 칸들이 하루의 시작과 끝이라, 빼면 선이
     공중에서 시작합니다. 이름으로 한 번 더 찾고, 그래도
     없으면 방의 출발지(hub)를 씁니다.
   ------------------------------------------------------------ */
export function pickPoints(itinerary, places, room) {
  const list = Array.isArray(places) ? places : [];
  const byId = new Map();
  const byName = new Map();
  for (const p of list) {
    if (p && p.id) byId.set(p.id, p);
    if (p && p.name && !byName.has(p.name)) byName.set(p.name, p);
  }

  /* ★ 방의 출발지(hub)도 이름으로 찾게 넣어둡니다.
     "kind 가 hub 면 hub 로" 하면 안 됩니다 — 중간날의 "출발" 칸도
     kind 가 hub 라서, 숙소에서 나서는 것을 역으로 가는 것으로
     읽습니다. 매일 아침 역에 갔다 오는 선이 그려집니다.
     "강릉역 도착" · "강릉역 — 귀가" 처럼 이름이 맞을 때만 씁니다. */
  if (room && room.hub && num(room.hub.lat) !== null && room.hub.name) {
    if (!byName.has(room.hub.name)) {
      byName.set(room.hub.name, {
        lat: +room.hub.lat, lng: +room.hub.lng, name: room.hub.name, kind: "hub",
      });
    }
  }

  const out = [];
  (Array.isArray(itinerary) ? itinerary : []).forEach((day, di) => {
    (day && Array.isArray(day.slots) ? day.slots : []).forEach((slot) => {
      if (!slot) return;

      let hit = slot.placeId ? byId.get(slot.placeId) : null;
      if (!hit) hit = byName.get(nameFrom(slot.title)) || null;
      if (!hit) return;

      const lat = num(hit.lat), lng = num(hit.lng);
      if (lat === null || lng === null) return;
      /* 링크로 들어온 좌표가 뒤집혀 있을 수 있습니다. 그대로 그리면
         선이 바다 건너로 뻗고 나머지 점이 깨알이 됩니다. */
      if (!inKorea(lat, lng)) return;

      /* 같은 자리가 연달아 나오면 한 번만 찍습니다.
         숙소 체크인 → 다음날 출발이 바로 그 경우인데, 그대로 두면
         점이 겹쳐 두껍게 보이고 "들른 곳" 수도 부풀려집니다. */
      const last = out[out.length - 1];
      if (last && last.lat === lat && last.lng === lng) return;

      const kind = slot.kind || hit.kind || "spot";
      out.push({
        lat, lng,
        name: hit.name || nameFrom(slot.title),
        kind,
        day: di,
        /* ★ 숙소 이름은 체크박스를 켜도 그리지 않습니다.

           이 저장소는 숙소 위치가 새는 것을 막으려고 사진의 EXIF 를
           지우는 것까지 필수로 뒀습니다(photo.js 주석). 그런데 이
           그림은 방보다 더 공개된 곳(인스타)으로 갑니다.

           점은 찍습니다 — 밤마다 숙소로 돌아오는 왕복이 선 모양의
           절반이라 빼면 우리 여행의 모양이 아니게 됩니다. 다만
           "이름 붙은 점 + 지역명" 은 그대로 검색이 되고, 이름 없는
           점은 그렇지 않습니다. 그 차이가 규칙 하나로 갈립니다. */
        nameSafe: kind !== "lodging",
      });
    });
  });
  return out;
}

/* "숙소 체크인 — 경포호텔" → "경포호텔"
   "강릉역 — 귀가"        → "강릉역"
   "강릉역 도착"          → "강릉역"          */
function nameFrom(title) {
  let t = String(title == null ? "" : title).trim();
  const part = t.split(" — ");
  if (part.length > 1) t = part[1] === "귀가" ? part[0] : part[1];
  return t.replace(/\s*도착$/, "").trim();
}

const num = (v) => (Number.isFinite(+v) ? +v : null);


/* ------------------------------------------------------------
   2) 좌표를 캔버스 자리로 — 순수 계산

   ★ 경도에 cos(위도) 를 곱해야 합니다.
     위도 37.5°에서 경도 1°는 위도 1°의 약 0.79배 거리입니다.
     보정하지 않으면 동서로 25% 넘게 늘어나서, 실제로는 남북으로
     긴 동선이 옆으로 퍼진 모양으로 나옵니다.
   ------------------------------------------------------------ */
/* 총 이동거리 — 집계값이라 되짚을 수 없고, "많이 다녔다" 가 드러납니다 */
export function totalKm(points) {
  const p = Array.isArray(points) ? points : [];
  let km = 0;
  for (let i = 1; i < p.length; i++) {
    km += distanceKm(p[i - 1].lat, p[i - 1].lng, p[i].lat, p[i].lng);
  }
  return km;
}

export function layoutCard(data = {}, opts = {}) {
  const w = CARD.w, h = CARD.h;
  const area = {
    x: AREA.x,
    y: AREA.top,
    w: w - AREA.x * 2,
    h: h - AREA.top - AREA.bottom,
  };

  const pts = (Array.isArray(data.points) ? data.points : [])
    .filter((p) => p && num(p.lat) !== null && num(p.lng) !== null);

  const showNames = !!opts.showNames;
  const stops = [];

  if (pts.length) {
    const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const k = Math.cos((lat0 * Math.PI) / 180) || 1;   // 가로 보정

    /* geo.js 의 bboxOf 를 그대로 씁니다 — 한국 밖 좌표를 걸러주고
       너무 좁은 범위를 넓혀주는 처리가 이미 들어 있습니다. */
    const bb = bboxOf(pts, MIN_SPAN);
    let [[swLat, swLng], [neLat, neLng]] = bb || [
      [pts[0].lat - MIN_SPAN, pts[0].lng - MIN_SPAN],
      [pts[0].lat + MIN_SPAN, pts[0].lng + MIN_SPAN],
    ];

    let spanY = neLat - swLat;
    let spanX = (neLng - swLng) * k;
    if (!(spanY > 0)) { spanY = MIN_SPAN; swLat -= MIN_SPAN / 2; }
    if (!(spanX > 0)) { spanX = MIN_SPAN * k; swLng -= MIN_SPAN / 2; }

    /* 비율을 지켜 자리 안에 넣습니다 (찌그러지면 지도가 아닙니다) */
    const scale = Math.min(area.w / spanX, area.h / spanY);
    const drawW = spanX * scale, drawH = spanY * scale;
    const left = area.x + (area.w - drawW) / 2;
    const top = area.y + (area.h - drawH) / 2;

    for (const p of pts) {
      const safe = p.nameSafe === false ? false : p.kind !== "lodging";
      stops.push({
        x: left + ((p.lng - swLng) * k) * scale,
        y: top + drawH - (p.lat - swLat) * scale,   // 위도가 클수록 위
        day: p.day,
        kind: p.kind,
        /* ★ 그리지 않을 이름은 들고 다니지도 않습니다.
           남겨두면 언젠가 누가 stop.name 을 그리게 되고, 그때는
           라벨 쪽 규칙이 있어도 소용이 없습니다. */
        name: safe ? p.name : "",
        /* ★ 어디로 들어왔든 숙소는 이름을 안 답니다. pickPoints 에서
           한 번 막고 여기서 또 막습니다 — 한 군데만 막아두면
           layoutCard 를 직접 부르는 길에서 조용히 새어나갑니다. */
        nameSafe: safe,
      });
    }
  }

  const path = stops.length > 1 ? stops.map((s) => ({ x: s.x, y: s.y })) : [];

  return {
    w, h, area,
    stops,
    path,
    steps: footsteps(path),
    /* ★ 기본은 이름을 넣지 않습니다. 켜는 건 올리는 사람 몫입니다. */
    labels: showNames ? placeLabels(stops, { x: AREA.x, w: w - AREA.x * 2 }) : [],
    showNames,
    title: String(data.title || "우리 여행"),
    sub: String(data.sub || ""),
    foot: String(data.foot || ""),
    brand: String(data.brand || "친구들과 여행계획"),
  };
}

/* ------------------------------------------------------------
   발자취 — 선 자리에 발자국을 늘어놓습니다

   ★ 걸음걸이를 흉내 내지 않습니다. 좌우로 번갈아 벌리고 바깥으로
     틀어보니, 작게 줄이면 그냥 얼룩으로 보이고 선만 눈에 남았습니다.
     선이 가던 자리에 발자국을 그대로 얹는 쪽이 또렷합니다.

   ★ 자리 계산은 여기(순수)에 둡니다. 그리는 쪽에서 하면 눈으로
     보기 전까지 틀린 줄 모릅니다.
   ------------------------------------------------------------ */
const STEP = {
  gap: 52,      // 발자국 간격
  len: 30,      // 발자국 길이
  wide: 14,     // 발자국 폭
  max: 400,     // 아주 긴 여행에서도 이보다 많이는 안 찍습니다
};

export function footsteps(path) {
  const p = Array.isArray(path) ? path : [];
  if (p.length < 2) return [];

  const out = [];
  let carry = STEP.gap / 2;        // 출발점 바로 위에 겹치지 않게

  for (let i = 1; i < p.length && out.length < STEP.max; i++) {
    const a = p[i - 1], b = p[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;

    const angle = Math.atan2(dy, dx);
    for (let t = carry; t <= len && out.length < STEP.max; t += STEP.gap) {
      out.push({ x: a.x + (dx / len) * t, y: a.y + (dy / len) * t, angle });
    }
    carry = STEP.gap - ((len - carry) % STEP.gap);   // 남은 거리를 다음 구간으로
  }
  return out;
}


/* ------------------------------------------------------------
   이름표 자리 잡기

   ★ 겹치면 버립니다. 겹쳐 찍으면 둘 다 못 읽게 되는데, 그건
     하나를 빼는 것보다 나쁩니다. 위가 막히면 아래를 한 번 더
     봅니다.

   ★ 글자 폭은 캔버스 없이 어림합니다 (한글 한 자 ≈ 1em,
     영숫자 ≈ 0.5em). 어림이 틀려도 그릴 때 maxWidth 로 한 번 더
     묶이므로 상자를 넘지 않습니다.
   ------------------------------------------------------------ */
const LABEL_PX = 32;          // 글자 크기 (renderCard 와 같아야 합니다)
const LABEL_H = 46;           // 알약 높이

export function textWidth(text, px = LABEL_PX) {
  let em = 0;
  for (const ch of String(text || "")) em += /[\x00-\x7f]/.test(ch) ? 0.52 : 1.0;
  return em * px * 1.08;      // 글꼴이 달라질 수 있어 약간 넉넉히
}

function placeLabels(stops, bounds) {
  const seen = new Set();
  const taken = [];
  const out = [];

  for (const s of stops) {
    if (s.nameSafe === false) continue;          // 숙소는 이름을 안 적습니다
    const t = String(s.name || "").trim();
    if (!t || seen.has(t)) continue;

    const tw = textWidth(t) + 24;
    const half = tw / 2;
    const x = Math.min(Math.max(s.x, bounds.x + half), bounds.x + bounds.w - half);

    let box = null;
    for (const dy of [-56, 52]) {                // 위를 먼저, 막히면 아래
      const b = { x: x - half, y: s.y + dy - LABEL_H / 2, w: tw, h: LABEL_H };
      if (!taken.some((o) => hits(o, b))) { box = b; break; }
    }
    if (!box) continue;                          // 둘 다 막히면 포기

    seen.add(t);
    taken.push(box);
    out.push({ x, y: box.y + LABEL_H - 12, text: t, box });
  }
  return out;
}

const hits = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;


/* ------------------------------------------------------------
   3) 그리기 — 여기만 캔버스를 압니다

   photo.js 의 draw() 와 같은 폴백 모양을 씁니다:
   OffscreenCanvas 가 있으면 그걸, 없으면 <canvas>.
   ------------------------------------------------------------ */
export function canDraw() {
  return typeof OffscreenCanvas === "function" ||
         typeof document !== "undefined";
}

const FONT = `"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;

export async function renderCard(L, colors = COLORS) {
  const { canvas, ctx } = makeCanvas(L.w, L.h);

  /* 배경 — 노을 */
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, colors.top);
  g.addColorStop(1, colors.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.w, L.h);

  ctx.fillStyle = colors.ink;
  ctx.strokeStyle = colors.ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /* 제목 */
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 92px ${FONT}`;
  fitText(ctx, L.title, AREA.x, 300, L.w - AREA.x * 2);

  if (L.sub) {
    ctx.globalAlpha = 0.9;
    ctx.font = `400 44px ${FONT}`;
    fitText(ctx, L.sub, AREA.x, 380, L.w - AREA.x * 2);
    ctx.globalAlpha = 1;
  }

  /* 발자취 — 선을 긋지 않습니다. 발자국이 곧 선입니다. */
  for (const st of L.steps) drawFoot(ctx, st);

  /* 들른 곳.

     ★ 겹쳐도 읽히게 모양을 다르게 둡니다. 출발점과 도착점이 같은
       역인 왕복 여행이 흔한데, 전부 같은 동그라미면 왼쪽에 흰
       덩어리 하나로 뭉쳐 보입니다. 아이콘·og 와 같은 말을 씁니다 —
       출발은 속 빈 테, 도착은 가운데 뚫린 핀. */
  const last = L.stops.length - 1;
  L.stops.forEach((s, i) => {
    if (i === 0 || i === last) return;                 // 끝 두 개는 아래에서
    ctx.beginPath();
    ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
    ctx.fill();
  });

  const a = L.stops[0], z = L.stops[last];
  /* ★ 돌아오는 여행은 출발점과 도착점이 같은 자리입니다. 테와 핀을
     겹쳐 그리면 흰 덩어리가 되어 둘 다 안 보입니다. 핀만 둡니다. */
  const roundTrip = a && z && Math.hypot(a.x - z.x, a.y - z.y) < 30;

  if (a && !(roundTrip && L.stops.length > 1)) {
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 16, 0, Math.PI * 2);
    ctx.stroke();                                      // 출발 — 속 빈 테
  }
  if (L.stops.length > 1) drawPin(ctx, z.x, z.y, colors);   // 도착 — 핀

  /* 장소 이름 — 켰을 때만 */
  if (L.showNames) {
    /* ★ 자리는 layout 이 정한 그대로 씁니다. 여기서 다시 계산하면
       겹침을 피해 둔 것이 무너지고, 순수 검사도 의미가 없어집니다. */
    ctx.font = `600 ${LABEL_PX}px ${FONT}`;
    ctx.textAlign = "center";
    for (const l of L.labels) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#000000";
      roundRect(ctx, l.box.x, l.box.y, l.box.w, l.box.h, l.box.h / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.ink;
      ctx.fillText(l.text, l.x, l.y, l.box.w - 20);
    }
    ctx.textAlign = "left";
  }

  /* 아래 요약과 서비스 이름

     ★ 스토리에는 링크를 못 걸 수 있습니다. 그래서 이름이
       그림 안에 있어야 보는 사람이 찾아올 수 있습니다. */
  if (L.foot) {
    ctx.globalAlpha = 0.92;
    ctx.font = `600 46px ${FONT}`;
    fitText(ctx, L.foot, AREA.x, L.h - 250, L.w - AREA.x * 2);
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 0.72;
  ctx.font = `500 36px ${FONT}`;
  fitText(ctx, L.brand, AREA.x, L.h - 150, L.w - AREA.x * 2);
  ctx.globalAlpha = 1;

  return toBlob(canvas);
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === "function") {
    const c = new OffscreenCanvas(w, h);
    return { canvas: c, ctx: c.getContext("2d") };
  }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { canvas: c, ctx: c.getContext("2d") };
}

/* ★ PNG 입니다. 선과 큰 글자뿐이라 WebP 로 줄여봐야 얼마 안 되고,
   인스타·카톡·사진첩 어디서나 확실히 열리는 쪽이 낫습니다. */
function toBlob(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}

/* 발자국 하나 — 앞꿈치와 뒤꿈치 두 덩이면 작게도 발로 읽힙니다 */
function drawFoot(ctx, st) {
  const L = STEP.len, W = STEP.wide;
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.rotate(st.angle);

  ctx.beginPath();
  ctx.ellipse(L * 0.16, 0, L * 0.36, W * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(-L * 0.38, 0, L * 0.18, W * 0.33, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPin(ctx, x, y, colors) {
  const r = 27, tip = y, cy = y - r * 1.75;
  ctx.beginPath();
  ctx.arc(x, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const half = r * 0.62;
  const sy = cy + Math.sqrt(Math.max(r * r - half * half, 1)) - 2;
  ctx.beginPath();
  ctx.moveTo(x - half, sy);
  ctx.lineTo(x + half, sy);
  ctx.lineTo(x, tip);
  ctx.closePath();
  ctx.fill();
  /* 가운데를 뚫습니다 — 아이콘과 같은 모양 */
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(x, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 넘치면 … 로 자릅니다. 제목이 잘리는 것보다 넘쳐서 안 보이는 게 나쁩니다. */
function fitText(ctx, text, x, y, max) {
  let t = String(text == null ? "" : text);
  if (!t) return;
  if (ctx.measureText(t).width <= max) { ctx.fillText(t, x, y); return; }
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  ctx.fillText(t + "…", x, y);
}
