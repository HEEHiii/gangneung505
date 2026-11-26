/* ============================================================
   route.js — 투표 결과로 N일치 동선 짜기

   ★ 순수 함수입니다. 네트워크를 타지 않습니다.

     505 는 공개 OSRM 데모 서버에서 실제 주행시간을 받아왔습니다.
     그 서버는 운영 사용 금지이고 초당 1회 수준의 제한이 있어서,
     이용자가 늘면 제일 먼저 터집니다. 그리고 25곳을 넘으면 조용히
     추정으로 떨어졌습니다 — 여행이 가장 클 때 정확도가 떨어진다는
     뜻입니다.

     그래서 추정 하나로 통일했습니다. 직선거리 × 1.35, 35km/h.
     한국 도시 안에서 오차가 ±25% 정도인데, 이 오차는 보통
     "순서를 바꾸지 않고" 표시 시각만 바꿉니다. 대신 의존성과
     실패 모드가 0 이고, 전부 테스트할 수 있습니다.
   ============================================================ */

import { distanceKm } from "./geo.js";

/* 머무는 시간(분). 키 이름은 places 의 kind 와 같습니다 */
export const DWELL = { food: 70, cafe: 50, spot: 60, lodging: 0, hub: 0 };
const dwellOf = (p) => DWELL[p.kind] ?? 50;

export const ANCHORS = {
  arriveFirstDay: "11:00",   // 첫날 도착
  checkIn:        "15:00",   // 체크인 가능 시각
  checkOut:       "11:00",   // 체크아웃
  dayStart:       "09:00",   // 중간 날 아침 출발
  lunch:          ["11:30", "13:30"],
  dinner:         ["17:30", "19:30"],
  cafeFrom:       "13:00",   // 카페는 오후부터
};

export const OPTIONS = {
  maxPerDay: 4,      // 하루에 넣을 장소 수 상한
  maxFoodPerDay: 2,  // 하루 식사 두 끼 (점심·저녁)
  balance: 25,       // 하루 치가 넘칠 때 1곳당 더하는 가상 비용(분)
};

/* ============================================================
   이동 수단

   ★ 전에는 수단과 무관하게 35km/h 하나였습니다. 걸어가도 차로
     가도 같은 시간이 나왔습니다.

   ★ 바뀌는 것이 시간만이 아닙니다. 뚜벅이 여행에 하루 5곳을
     넣어주면 시간 숫자가 맞든 틀리든 그 일정은 못 씁니다.
     그래서 maxPerDay 도 수단을 따릅니다 — 이쪽이 더 크게 틀립니다.

   ★ 이 숫자들은 측정값이 아니라 어림입니다. 실제 길찾기 API 를
     쓰지 않습니다 (공개 OSRM 을 걷어낸 이유는 이 파일 머리말에).
     특히 대중교통은 노선이 있고 없고가 커서 오차가 가장 큽니다.
     화면에서도 "어림"이라고 말합니다.

       kmh      문앞에서 문앞까지 평균 속도 (기다림·주차 포함 아님)
       detour   직선거리에 곱하는 값. 길이 곧지 않으니까요
       overhead 구간마다 더하는 고정 시간(분) — 기다리거나 세우는 시간
   ============================================================ */
export const TRANSPORT = {
  /* 자차: 전과 똑같은 값입니다. 35km/h 가 낮아 보이지만 시내 주행에
     신호·주차·걸어 들어가는 시간이 이미 녹아 있는 수치입니다.

     ★ maxPerDay 를 5 로 올려봤다가 되돌렸습니다. 4일 일정에서
       빈 날이 생겼습니다 (2/0/2/2). 상한이 느슨해지니 하루 균형을
       맞추는 쪽이 한 날을 통째로 비워도 되게 됐습니다.

       고쳐야 할 것은 "걸어가는데 차처럼 짜는 것" 이었지 자차가
       빡빡한 것이 아니었습니다. 이미 맞게 도는 것은 건드리지
       않습니다. */
  car:     { label: "자차",     kmh: 35,  detour: 1.35, overhead: 0,  maxPerDay: 4 },

  /* 대중교통: 환승과 기다림이 들어가 평균 속도가 확 떨어집니다.
     노선이 직선으로 안 가므로 detour 도 큽니다. */
  transit: { label: "대중교통", kmh: 18,  detour: 1.45, overhead: 15, maxPerDay: 3 },

  /* 도보: 4.2km/h 는 보통 걸음입니다. 길이 곧지 않아도 질러갈 수
     있어서 detour 는 오히려 작습니다. */
  walk:    { label: "도보",     kmh: 4.2, detour: 1.25, overhead: 0,  maxPerDay: 3 },
};

export const DEFAULT_TRANSPORT = "car";
const modeOf = (m) => TRANSPORT[m] || TRANSPORT[DEFAULT_TRANSPORT];

/* 걸어서 가기엔 먼 구간 — 이것보다 길면 화면에서 말려줍니다 */
export const WALK_FAR_KM = 4;

/* 이것보다 가까우면 무엇을 타든 걷습니다.
   버스를 200m 타려고 15분 기다리지는 않으니까요. */
export const WALK_IT_KM = 0.4;

/* ---------- 시각 ---------- */
export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (min) => {
  const m = Math.max(0, Math.round(min));
  return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" +
         String(m % 60).padStart(2, "0");
};

/* ---------- 이동시간(초) ---------- */
export function estimateSec(a, b, mode = DEFAULT_TRANSPORT) {
  const raw = distanceKm(a.lat, a.lng, b.lat, b.lng);

  /* ★ 아주 가까우면 수단을 무시하고 걷습니다.

     이게 없으면 대중교통에서 바로 옆 가게로 옮기는 데도 기다리는
     15분이 그대로 붙습니다. 200m 를 버스로 가지는 않으니까요.

     ★ 한때 "같은 자리끼리는 0초" 로 바꿨다가 되돌렸습니다.
       행렬의 대각선은 **빈 날의 비용**으로도 쓰입니다. 0 으로
       만들었더니 빈 날이 공짜가 돼서, 4일 일정에서 한 날이
       통째로 비었습니다 (2/0/2/2). 여기서는 걷기 기준 최소값
       120초가 나오고, 그게 빈 날을 막는 벌점 노릇을 합니다. */
  const t = modeOf(raw < WALK_IT_KM ? "walk" : mode);
  const km = raw * t.detour;
  return Math.max(120, t.overhead * 60 + (km / t.kmh) * 3600);
}

export function durationMatrix(pts, mode = DEFAULT_TRANSPORT) {
  return pts.map((a) => pts.map((b) => estimateSec(a, b, mode)));
}

/* ---------- 날짜 펼치기 ---------- */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export function enumerateDays(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (isNaN(a) || isNaN(b) || b < a) return [];

  const out = [];
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({
      date: iso,
      dow: DOW[d.getDay()],
      label: `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`,
    });
    if (out.length > 15) break;          // SQL 쪽 14일 상한과 맞춥니다
  }
  return out;
}

/* ============================================================
   순서 정하기
   ============================================================ */
function legTime(M, from, seq, to) {
  let t = 0, prev = from;
  for (const s of seq) { t += M[prev][s]; prev = s; }
  return t + M[prev][to];
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

/* 하루치 구간이 규칙에 맞는가 */
function segmentOk(seg, pts, opt) {
  if (seg.length > opt.maxPerDay) return false;
  let food = 0;
  for (const i of seg) if (pts[i].kind === "food") food++;
  return food <= opt.maxFoodPerDay;
}

/* ------------------------------------------------------------
   정해진 순서를 D 개의 날로 쪼갭니다 (DP)

   ★ 여기가 N일 일반화의 핵심이고, 함정이 숨어 있는 곳입니다.

     2일이면 각 날의 끝점이 달라서(1일차는 숙소에서 끝, 2일차는
     집으로) 이동시간만 줄여도 저절로 균형이 맞습니다.

     그런데 3일 이상이면 중간 날은 "숙소 → … → 숙소" 라, 순수
     이동시간 최소화는 한 날에 전부 몰아넣고 나머지 날을 비우려
     합니다. 숙소에서 나갔다 들어오는 왕복이 날마다 생기니까요.
     그 결과는 일정표로서 아무 쓸모가 없습니다.

     그래서 하루 상한(하드)과 넘칠 때의 가상 비용(소프트)을 둡니다.
   ------------------------------------------------------------ */
function splitDays(M, order, D, ends, pts, opt) {
  const n = order.length;
  const budget = Math.ceil(n / D);               // 고르게 나눴을 때 하루 치

  /* best[d][i] = d 일까지 써서 앞 i 개를 소화했을 때의 최소 비용 */
  const best = Array.from({ length: D + 1 }, () => new Array(n + 1).fill(Infinity));
  const from = Array.from({ length: D + 1 }, () => new Array(n + 1).fill(-1));
  best[0][0] = 0;

  for (let d = 1; d <= D; d++) {
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= i; j++) {
        if (best[d - 1][j] === Infinity) continue;
        const seg = order.slice(j, i);
        if (!segmentOk(seg, pts, opt)) continue;

        const over = Math.max(0, seg.length - budget);
        const cost = best[d - 1][j]
                   + legTime(M, ends[d - 1].from, seg, ends[d - 1].to)
                   + over * opt.balance * 60;    // 분 → 초

        if (cost < best[d][i]) { best[d][i] = cost; from[d][i] = j; }
      }
    }
  }

  if (best[D][n] === Infinity) return null;      // 상한 때문에 다 못 담음

  const cuts = [];
  let i = n;
  for (let d = D; d >= 1; d--) {
    const j = from[d][i];
    cuts.unshift(order.slice(j, i));
    i = j;
  }
  return { days: cuts, cost: best[D][n] };
}

function nearestThen2opt(M, start, idx) {
  const left = new Set(idx);
  const seq = [];
  let cur = start;
  while (left.size) {
    let pick = null, bestD = Infinity;
    for (const p of left) if (M[cur][p] < bestD) { bestD = M[cur][p]; pick = p; }
    seq.push(pick); left.delete(pick); cur = pick;
  }
  const cost = (s) => legTime(M, start, s, start);
  let improved = true, guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let a = 0; a < seq.length - 1; a++) {
      for (let b = a + 1; b < seq.length; b++) {
        const cand = [...seq.slice(0, a), ...seq.slice(a, b + 1).reverse(), ...seq.slice(b + 1)];
        if (cost(cand) < cost(seq) - 1) { seq.splice(0, seq.length, ...cand); improved = true; }
      }
    }
  }
  return seq;
}

/* ============================================================
   시각 붙이기 — 밥은 밥때에

   ★ 이게 없으면 최적화기는 횟집을 10:30 에, 카페를 21:00 에
     아무렇지 않게 배치합니다. 이동시간만 보니까요. 그리고
     사용자는 "이 기능 고장났네" 하고 전부 손으로 고칩니다.
     일정 자동 생성에서 가장 큰 제품 리스크가 이것입니다.
   ============================================================ */
function mealWindow(kind, clock, A) {
  if (kind === "food") {
    const [ls, le] = A.lunch.map(toMin);
    const [ds, de] = A.dinner.map(toMin);
    if (clock <= le) return [ls, le, "점심"];
    return [ds, de, "저녁"];
  }
  if (kind === "cafe") return [toMin(A.cafeFrom), 24 * 60, "오후"];
  return null;
}

/* ============================================================
   메인
   ============================================================ */
export function buildItinerary({
  days, hub, lodging, places = [],
  transport = DEFAULT_TRANSPORT,
  anchors = {}, options = {},
} = {}) {
  const A = { ...ANCHORS, ...anchors };
  /* ★ 하루 장소 수의 기본값은 수단이 정합니다. 그래도 부르는 쪽이
     options.maxPerDay 를 주면 그쪽이 이깁니다 (검사에서 씁니다). */
  const T = modeOf(transport);
  const opt = { ...OPTIONS, maxPerDay: T.maxPerDay, ...options };
  const D = Math.max(1, (days || []).length);
  const warnings = [];

  /* ---- 기준점 정하기 ----
     hub 가 없을 수 있고(지역에 역이 없거나 직접 검색한 지역),
     숙소가 아직 안 정해졌을 수도 있습니다. 둘 다 없으면 첫 장소를
     기준으로 삼습니다. 어느 쪽도 예외를 던지지 않습니다. */
  const anchorPoint = hub || lodging || places[0] || null;
  if (!anchorPoint) {
    return { itinerary: (days || []).map((d) => ({ ...d, slots: [] })),
             totalMin: 0, estimated: true, warnings: ["장소가 없어요"] };
  }
  if (!hub) warnings.push("출발 지점이 없어 숙소를 기준으로 짰어요");
  if (!lodging && D > 1) warnings.push("숙소가 아직 안 정해졌어요");

  const H = { ...anchorPoint, kind: "hub", name: hub ? hub.name : (anchorPoint.name || "출발") };
  const L = lodging ? { ...lodging, kind: "lodging" } : H;

  const pts = [H, L, ...places];
  const M = durationMatrix(pts, transport);

  /* ★ 걸어서 가기엔 먼 구간이 있으면 말려줍니다.

     시간만 길게 계산해주고 끝내면, 화면에는 "2시간 10분" 이라고
     적힌 멀쩡해 보이는 일정이 나옵니다. 그걸 보고 진짜 걸으면
     여행을 망칩니다. 숫자 대신 말로 알려줘야 합니다. */
  if (transport === "walk") {
    let farthest = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const km = distanceKm(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng);
        if (km > farthest) farthest = km;
      }
    }
    if (farthest > WALK_FAR_KM) {
      warnings.push(
        `걸어서 가기엔 먼 구간이 있어요 (가장 먼 두 곳이 ${farthest.toFixed(1)}km). ` +
        "버스나 택시를 섞는 게 나을 수 있어요");
    }
  }
  const S = 0, LG = 1;
  const idx = places.map((_, i) => i + 2);

  /* ---- 날마다의 출발·도착점 ----
     첫날: 출발지 → 숙소 / 중간: 숙소 → 숙소 / 마지막: 숙소 → 출발지
     0박(하루짜리)이면 출발지 → 출발지 하나뿐입니다. */
  const ends = [];
  for (let d = 0; d < D; d++) {
    const first = d === 0, last = d === D - 1;
    ends.push({
      from: first ? S : LG,
      to:   last  ? S : LG,
    });
  }
  if (D === 1) ends[0] = { from: S, to: S };

  /* ---- 순서 + 쪼개기 ---- */
  let split = null;
  if (idx.length === 0) {
    split = { days: Array.from({ length: D }, () => []), cost: 0 };
  } else if (idx.length <= 7) {
    for (const order of permutations(idx)) {
      const r = splitDays(M, order, D, ends, pts, opt);
      if (r && (!split || r.cost < split.cost)) split = r;
    }
  } else {
    const order = nearestThen2opt(M, S, idx);
    split = splitDays(M, order, D, ends, pts, opt);
  }

  /* 상한 때문에 다 못 담았으면 상한을 풀어 다시 — 비워두는 것보다 낫습니다 */
  if (!split) {
    const loose = { ...opt, maxPerDay: idx.length, maxFoodPerDay: idx.length };
    const order = idx.length <= 7 ? idx : nearestThen2opt(M, S, idx);
    split = splitDays(M, order, D, ends, pts, loose);
    warnings.push(
      `장소가 많아 ${T.label} 기준 하루 ${opt.maxPerDay}곳 규칙을 넘겼어요`);
  }

  /* ---- 시각 붙이기 ---- */
  const mins = (sec) => Math.max(1, Math.round(sec / 60));
  const itinerary = [];
  let moveSec = 0;

  for (let d = 0; d < D; d++) {
    const first = d === 0, last = d === D - 1;
    const seg = split.days[d] || [];
    const slots = [];
    let clock;

    /* ★ 하루의 첫 칸은 "언제 나서나" 입니다.

       처음에는 중간 날에도 09:00 출발을 그냥 적었는데, 첫 장소가
       점심이면 11:30 이라 두 시간 반이 빈 채로 "09:00 출발"이
       적혀 있었습니다. 거짓말입니다 — 실제로는 11시 19분에
       나서면 됩니다. 그래서 첫 구간을 계산한 뒤 역산해 채웁니다.

       마지막 날은 체크아웃이 곧 출발이라 따로 적지 않습니다.
       ("09:00 출발" 다음에 "11:00 체크아웃"은 앞뒤가 안 맞습니다) */
    let leadSlot = null;

    if (first) {
      clock = toMin(A.arriveFirstDay);
      slots.push({ time: toHHMM(clock), title: `${H.name} 도착`,
                   note: "도착 시간에 맞춰 고치세요", kind: "hub" });
    } else if (last && lodging) {
      clock = Math.max(toMin(A.dayStart), toMin(A.checkOut));
      slots.push({ time: toHHMM(clock), title: "숙소 체크아웃",
                   note: `체크아웃 ${A.checkOut}`, fixed: true, kind: "lodging" });
    } else {
      clock = toMin(A.dayStart);
      leadSlot = { time: toHHMM(clock), title: "출발",
                   note: lodging ? "숙소에서" : "", kind: "hub" };
      slots.push(leadSlot);
    }

    let prev = ends[d].from;
    let firstLeg = true;
    for (const p of seg) {
      const tv = mins(M[prev][p]);
      moveSec += M[prev][p];
      clock += tv;

      const win = mealWindow(pts[p].kind, clock, A);
      let note = `${pts[prev].name}에서 ${tv}분`;
      if (win) {
        const [ws, we, label] = win;
        if (clock < ws) {
          /* 기다려야 한다면, 아예 늦게 나서는 편이 낫습니다 */
          if (firstLeg && leadSlot) {
            leadSlot.time = toHHMM(Math.max(toMin(A.dayStart), ws - tv));
          } else {
            note += ` · ${label} 시간까지 기다려요`;
          }
          clock = ws;
        } else if (clock > we) {
          note += ` · ${label}치고는 늦어요`;
        }
      }

      slots.push({
        time: toHHMM(clock), title: pts[p].name, note,
        kind: pts[p].kind, placeId: pts[p].id ?? null,
      });
      clock += dwellOf(pts[p]);
      prev = p;
      firstLeg = false;
    }

    /* 장소가 하나도 없는 날이면 "출발"만 덩그러니 남습니다 */
    if (!seg.length && leadSlot) slots.length = 0;

    if (!last && lodging) {
      const tv = mins(M[prev][LG]);
      moveSec += M[prev][LG];
      clock += tv;
      if (first) clock = Math.max(clock, toMin(A.checkIn));
      slots.push({
        time: toHHMM(clock),
        title: first ? `숙소 체크인 — ${L.name}` : `숙소로 — ${L.name}`,
        note: first ? `${pts[prev].name}에서 ${tv}분 · 체크인 ${A.checkIn}부터`
                    : `${pts[prev].name}에서 ${tv}분`,
        fixed: first, kind: "lodging",
      });
    } else if (last) {
      const tv = mins(M[prev][S]);
      moveSec += M[prev][S];
      clock += tv;
      slots.push({ time: toHHMM(clock), title: `${H.name} — 귀가`,
                   note: `${pts[prev].name}에서 ${tv}분`, kind: "hub" });
    }

    itinerary.push({ ...(days[d] || {}), slots });
  }

  return {
    itinerary,
    totalMin: Math.round(moveSec / 60),
    estimated: true,          // 실제 주행시간이 아니라 추정입니다 (화면에 표시)
    warnings,
  };
}
