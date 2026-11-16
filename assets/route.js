/* ============================================================
   route.js — 투표 결과로 이동시간을 고려한 경로 짜기

   이동시간은 OSRM(무료 길찾기 서버)에서 실제 주행시간을 받아옵니다.
   서버가 안 되면 직선거리 기반 추정으로 자동 전환합니다.
   (추정으로 돌아갔을 때는 화면에 그렇게 표시합니다)
   ============================================================ */

const OSRM = "https://router.project-osrm.org";

/* 머무는 시간(분) — 분류별 기본값 */
const DWELL = { food: 70, cafe: 50, spot: 60, lodging: 0, hub: 0 };
const dwellOf = p => DWELL[p.cat] ?? 50;

/* 직선거리 기반 추정 이동시간(초)
   실제 도로는 직선보다 돌아가므로 1.35배, 평균 35km/h 로 잡았습니다. */
function estimateSec(a, b) {
  const km = distanceKm(a.lat, a.lng, b.lat, b.lng) * 1.35;
  return Math.max(120, (km / 35) * 3600);
}

/* 모든 지점 사이의 이동시간 표 (한 번의 요청으로) */
async function durationMatrix(pts) {
  const fallback = () => ({
    matrix: pts.map(a => pts.map(b => estimateSec(a, b))),
    real: false,
  });

  if (pts.length < 2 || pts.length > 25) return fallback();

  try {
    const coords = pts.map(p => `${p.lng},${p.lat}`).join(";");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    let res;
    try {
      res = await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=duration`,
                        { signal: ctl.signal });
    } finally { clearTimeout(timer); }

    if (!res.ok) return fallback();
    const j = await res.json();
    if (j.code !== "Ok" || !Array.isArray(j.durations)) return fallback();

    // 길이 못 찾은 구간(null)은 추정값으로 메웁니다
    const matrix = j.durations.map((row, i) =>
      row.map((v, k) => (v == null ? estimateSec(pts[i], pts[k]) : v)));
    return { matrix, real: true };
  } catch (_) {
    return fallback();
  }
}

/* ---------- 순서 정하기 ----------
   하루차: 강릉역 → (장소들) → 숙소
   이틀차: 숙소 → (장소들) → 강릉역
   둘로 나누는 지점까지 같이 고릅니다.

   장소가 7곳 이하면 모든 경우를 따져 최적을 찾고,
   그보다 많으면 가까운 곳부터 잇고 2-opt 로 다듬습니다. */

function totalTime(M, start, seq, end) {
  let t = 0, prev = start;
  for (const s of seq) { t += M[prev][s]; prev = s; }
  return t + M[prev][end];
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

function bestExact(M, station, lodging, places) {
  let best = null;
  for (const order of permutations(places)) {
    for (let k = 0; k <= order.length; k++) {
      const d1 = order.slice(0, k), d2 = order.slice(k);
      const t = totalTime(M, station, d1, lodging) +
                totalTime(M, lodging, d2, station);
      if (!best || t < best.t) best = { t, day1: d1, day2: d2 };
    }
  }
  return best;
}

function nearestThen2opt(M, station, lodging, places) {
  // 가까운 곳부터 잇기
  const left = new Set(places);
  const seq = [];
  let cur = station;
  while (left.size) {
    let pick = null, bestD = Infinity;
    for (const p of left) if (M[cur][p] < bestD) { bestD = M[cur][p]; pick = p; }
    seq.push(pick); left.delete(pick); cur = pick;
  }
  // 2-opt 로 꼬인 구간 펴기
  const cost = s => totalTime(M, station, s, station);
  let improved = true, guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < seq.length - 1; i++) {
      for (let j = i + 1; j < seq.length; j++) {
        const cand = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
        if (cost(cand) < cost(seq) - 1) { seq.splice(0, seq.length, ...cand); improved = true; }
      }
    }
  }
  // 절반씩 나누되, 나누는 지점은 전체 시간이 가장 짧은 곳으로
  let best = null;
  for (let k = 0; k <= seq.length; k++) {
    const d1 = seq.slice(0, k), d2 = seq.slice(k);
    const t = totalTime(M, station, d1, lodging) + totalTime(M, lodging, d2, station);
    if (!best || t < best.t) best = { t, day1: d1, day2: d2 };
  }
  return best;
}

/* ---------- 시각 계산 ---------- */
const toMin = hhmm => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = min => {
  const m = Math.max(0, Math.round(min));
  return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
};

/* ============================================================
   메인 — 투표 결과로 이틀치 일정을 만듭니다
   lodging : 1등 숙소 {name, lat, lng}
   places  : 투표된 장소들 [{id,name,lat,lng,cat,votes}]
   station : 출발·도착지 (강릉역)
   ============================================================ */
async function buildItinerary({ lodging, places, station, trip }) {
  const pts = [station, lodging, ...places];
  const { matrix: M, real } = await durationMatrix(pts);

  const S = 0, L = 1;
  const P = places.map((_, i) => i + 2);

  const plan = P.length <= 7
    ? bestExact(M, S, L, P)
    : nearestThen2opt(M, S, L, P);

  const mins = sec => Math.max(1, Math.round(sec / 60));
  const nameOf = i => pts[i].name;

  /* ---- 1일차: 강릉역 11:00 도착 → 들르고 → 숙소 ---- */
  const day1 = [];
  let clock = toMin("11:00");
  day1.push({ time: toHHMM(clock), title: "강릉역 도착", note: "KTX 도착 시간에 맞춰 고치세요" });

  let prev = S;
  for (const p of plan.day1) {
    const tv = mins(M[prev][p]);
    clock += tv;
    day1.push({ time: toHHMM(clock), title: nameOf(p), note: `${nameOf(prev)}에서 ${tv}분` });
    clock += dwellOf(pts[p]);
    prev = p;
  }
  const tvIn = mins(M[prev][L]);
  clock = Math.max(clock + tvIn, toMin("15:00"));
  day1.push({ time: toHHMM(clock), title: `숙소 체크인 — ${lodging.name}`,
              note: `${nameOf(prev)}에서 ${tvIn}분 · 체크인 15:00부터`, fixed: true });

  /* ---- 2일차: 숙소 11:00 체크아웃 → 들르고 → 강릉역 ---- */
  const day2 = [];
  clock = toMin("09:00");
  day2.push({ time: toHHMM(clock), title: "아침", note: "" });
  clock = toMin("11:00");
  day2.push({ time: toHHMM(clock), title: "숙소 체크아웃", note: "체크아웃 11:00", fixed: true });

  prev = L;
  for (const p of plan.day2) {
    const tv = mins(M[prev][p]);
    clock += tv;
    day2.push({ time: toHHMM(clock), title: nameOf(p), note: `${nameOf(prev)}에서 ${tv}분` });
    clock += dwellOf(pts[p]);
    prev = p;
  }
  const tvOut = mins(M[prev][S]);
  clock += tvOut;
  day2.push({ time: toHHMM(clock), title: "강릉역 — 귀가",
              note: `${nameOf(prev)}에서 ${tvOut}분` });

  return {
    real,                                   // 실제 주행시간인지 추정인지
    totalMin: Math.round(plan.t / 60),      // 순수 이동시간 합계
    itinerary: [
      { ...trip[0], slots: day1 },
      { ...trip[1], slots: day2 },
    ],
  };
}
