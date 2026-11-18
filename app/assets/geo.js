/* ============================================================
   geo.js — 좌표 계산

   원래 map.js 안에 있었습니다. 지도 라이브러리를 Leaflet 에서
   카카오로 바꾸는데, route.js 와 app.js 가 map.js 의 distanceKm 을
   쓰고 있어서 지도를 갈아끼울 때 같이 깨졌습니다.
   지도와 아무 상관이 없는 순수 계산이라 따로 뺐습니다.
   ============================================================ */

/* 대한민국을 넉넉히 감싸는 범위 */
export const KR_BOUNDS = { latMin: 33, latMax: 38.7, lngMin: 124.5, lngMax: 131 };

/* 두 지점 사이 직선거리(km) — 하버사인 */
export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* 한국 안인가 — 위도·경도를 거꾸로 넣은 입력을 걸러내는 데 씁니다 */
export function inKorea(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= KR_BOUNDS.latMin && lat <= KR_BOUNDS.latMax &&
    lng >= KR_BOUNDS.lngMin && lng <= KR_BOUNDS.lngMax;
}

/* "37.7743, 128.9444" → {lat,lng}. 못 읽으면 null.
   한국 범위를 벗어나면 순서를 바꿔 넣었을 가능성이 커서 거부합니다. */
export function parsePos(text) {
  const m = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*[,/\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (!inKorea(lat, lng)) return null;
  return { lat, lng };
}

/* 여러 점을 감싸는 범위 [[남서위도,남서경도],[북동위도,북동경도]].
   점이 없으면 null, 한 점이면 조금 넓혀서 돌려줍니다
   (한 점만 있으면 범위가 0 이 되어 지도가 최대 확대됩니다). */
export function bboxOf(points, padDeg = 0.01) {
  const pts = (points || []).filter((p) => inKorea(p.lat, p.lng));
  if (!pts.length) return null;

  let swLat = Infinity, swLng = Infinity, neLat = -Infinity, neLng = -Infinity;
  for (const p of pts) {
    if (p.lat < swLat) swLat = p.lat;
    if (p.lng < swLng) swLng = p.lng;
    if (p.lat > neLat) neLat = p.lat;
    if (p.lng > neLng) neLng = p.lng;
  }

  if (neLat - swLat < padDeg) { swLat -= padDeg; neLat += padDeg; }
  if (neLng - swLng < padDeg) { swLng -= padDeg; neLng += padDeg; }
  return [[swLat, swLng], [neLat, neLng]];
}

/* 범위 안인가 — 카카오 검색 결과가 그 지역 것인지 확인하는 데 씁니다 */
export function inBbox(lat, lng, bbox) {
  if (!bbox) return true;
  const [[swLat, swLng], [neLat, neLng]] = bbox;
  return lat >= swLat && lat <= neLat && lng >= swLng && lng <= neLng;
}

/* 거리를 사람이 읽는 꼴로 */
export function prettyKm(km) {
  if (!Number.isFinite(km)) return "";
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}
