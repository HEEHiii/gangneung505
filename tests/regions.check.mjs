/* ============================================================
   regions.js 데이터 검증

   실행: node tests/regions.check.mjs

   좌표를 손으로 적는 파일이라, 숫자를 뒤집거나 자리를 바꾸는
   실수가 조용히 배포되기 쉽습니다. 그러면 지도가 바다 한가운데서
   열리거나 장소 검색이 0건이 됩니다.

   지역을 추가한 뒤에는 이 스크립트를 한 번 돌려보세요.
   ============================================================ */

import { REGIONS, regionByCode, seasonFor, THEMES } from "../app/assets/regions.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const POI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "assets", "pois");

/* 대한민국을 넉넉히 감싸는 범위 (마라도~백령도, 독도 제외) */
const KR = { latMin: 33.0, latMax: 38.7, lngMin: 124.5, lngMax: 131.0 };

let fails = 0;
const fail = (msg) => { console.log("  실패  " + msg); fails++; };

/* ---------- 1. 코드 중복 ---------- */
const seen = new Set();
for (const r of REGIONS) {
  if (seen.has(r.code)) fail(`code 중복: ${r.code}`);
  seen.add(r.code);
}

/* ---------- 2. 항목별 검사 ---------- */
for (const r of REGIONS) {
  const at = `${r.name}(${r.code})`;

  if (!/^[a-z][a-z0-9_]*$/.test(r.code || "")) fail(`${at}: code 는 영소문자여야 합니다`);
  if (!r.name) fail(`${at}: name 이 없습니다`);
  if (!r.hubQuery) fail(`${at}: hubQuery 가 없습니다`);

  if (!Number.isInteger(r.level) || r.level < 1 || r.level > 14) {
    fail(`${at}: level 은 1~14 (1이 가장 가까움). 지금 ${r.level}`);
  }

  const c = r.center;
  if (!Array.isArray(c) || c.length !== 2) { fail(`${at}: center 형식이 [위도, 경도] 가 아닙니다`); continue; }
  const [clat, clng] = c;
  if (clat < KR.latMin || clat > KR.latMax) fail(`${at}: center 위도 ${clat} 가 한국 밖입니다 (위도·경도를 뒤바꿨을 수 있습니다)`);
  if (clng < KR.lngMin || clng > KR.lngMax) fail(`${at}: center 경도 ${clng} 가 한국 밖입니다`);

  const b = r.bbox;
  if (!Array.isArray(b) || b.length !== 2 || b[0].length !== 2 || b[1].length !== 2) {
    fail(`${at}: bbox 형식이 [[남서위도,남서경도],[북동위도,북동경도]] 가 아닙니다`); continue;
  }
  const [[swLat, swLng], [neLat, neLng]] = b;

  /* 이게 평창에서 실제로 났던 실수입니다 — 남서/북동을 거꾸로 적음 */
  if (swLat >= neLat) fail(`${at}: bbox 남서 위도(${swLat})가 북동 위도(${neLat})보다 크거나 같습니다 — 거꾸로 적었습니다`);
  if (swLng >= neLng) fail(`${at}: bbox 남서 경도(${swLng})가 북동 경도(${neLng})보다 크거나 같습니다 — 거꾸로 적었습니다`);

  /* 중심이 범위 밖이면 지도와 검색이 서로 다른 곳을 봅니다 */
  if (clat < swLat || clat > neLat || clng < swLng || clng > neLng) {
    fail(`${at}: center [${clat}, ${clng}] 가 bbox 밖입니다 — 지도와 장소 검색이 다른 곳을 봅니다`);
  }

  /* 너무 좁으면 검색이 0건, 너무 넓으면 옆 도시가 섞입니다 */
  const dLat = neLat - swLat, dLng = neLng - swLng;
  if (dLat < 0.03 || dLng < 0.03) fail(`${at}: bbox 가 너무 좁습니다 (${dLat.toFixed(3)} x ${dLng.toFixed(3)}도)`);
  if (dLat > 1.0 || dLng > 1.2) fail(`${at}: bbox 가 너무 넓습니다 (${dLat.toFixed(3)} x ${dLng.toFixed(3)}도) — 옆 도시가 섞입니다`);
}

/* ---------- 3. 큐레이션 POI 파일 ----------
   파일이 없는 지역은 카카오 실시간 검색으로 채우므로 정상입니다.
   있는 파일만 검사합니다. */
const KINDS = new Set(["lodging", "food", "cafe", "spot"]);
let poiFiles = 0, poiCount = 0;

if (existsSync(POI_DIR)) {
  for (const f of readdirSync(POI_DIR).filter((f) => f.endsWith(".json"))) {
    poiFiles++;
    const code = f.replace(/\.json$/, "");
    const region = regionByCode(code);
    if (!region) { fail(`pois/${f}: regions.js 에 code "${code}" 가 없습니다`); continue; }

    let doc;
    try { doc = JSON.parse(readFileSync(join(POI_DIR, f), "utf8")); }
    catch (e) { fail(`pois/${f}: JSON 을 읽을 수 없습니다 — ${e.message}`); continue; }

    if (doc.region !== code) fail(`pois/${f}: region 필드("${doc.region}")가 파일 이름과 다릅니다`);
    if (!Array.isArray(doc.spots)) { fail(`pois/${f}: spots 배열이 없습니다`); continue; }
    if (doc.spots.length === 0) fail(`pois/${f}: spots 가 비어 있습니다 — 파일을 지우면 카카오 검색으로 채워집니다`);

    const [[swLat, swLng], [neLat, neLng]] = region.bbox;
    const names = new Set();

    for (const s of doc.spots) {
      const at = `pois/${f} "${s.name}"`;
      if (!s.name) { fail(`pois/${f}: name 없는 항목이 있습니다`); continue; }
      if (names.has(s.name)) fail(`${at}: 이름이 중복됩니다`);
      names.add(s.name);

      if (!KINDS.has(s.kind)) fail(`${at}: kind 는 ${[...KINDS].join("|")} 중 하나여야 합니다 (지금 "${s.kind}")`);
      if (typeof s.lat !== "number" || typeof s.lng !== "number") { fail(`${at}: lat/lng 가 숫자가 아닙니다`); continue; }

      /* 이 검사가 "핀이 바다에 찍히는" 실수를 잡습니다 */
      if (s.lat < swLat || s.lat > neLat || s.lng < swLng || s.lng > neLng) {
        fail(`${at}: 좌표 [${s.lat}, ${s.lng}] 가 ${region.name} 범위 밖입니다 — 오타이거나 위도·경도가 바뀌었습니다`);
      }
      poiCount++;
    }
  }
}

/* ---------- 4. 헬퍼 ---------- */
if (regionByCode("gangneung")?.name !== "강릉") fail("regionByCode 가 강릉을 못 찾습니다");
if (regionByCode("없는코드") !== null) fail("regionByCode 는 없는 코드에 null 을 줘야 합니다");
if (regionByCode(undefined) !== null) fail("regionByCode 는 undefined 에 null 을 줘야 합니다");

const seasons = [["2027-04-10", "spring"], ["2027-07-02", "summer"],
                 ["2027-10-09", "autumn"], ["2027-01-23", "winter"],
                 ["2027-12-31", "winter"], ["2027-02-14", "winter"]];
for (const [d, want] of seasons) {
  const got = seasonFor(d);
  if (got !== want) fail(`seasonFor("${d}") = ${got}, 기대값 ${want}`);
}
if (!THEMES.some((t) => t.key === seasonFor("2027-01-23"))) fail("seasonFor 결과가 THEMES 에 없습니다");

/* ---------- 결과 ---------- */
if (fails === 0) {
  console.log(`전부 통과 — 지역 ${REGIONS.length}곳, 큐레이션 파일 ${poiFiles}개 / 장소 ${poiCount}곳`);
  console.log(REGIONS.map((r) => r.name).join(" · "));
  console.log(`큐레이션 없는 지역은 카카오 관광명소 검색으로 채워집니다.`);
} else {
  console.log(`\n실패 ${fails}건`);
  process.exit(1);
}
