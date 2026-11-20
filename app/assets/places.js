/* ============================================================
   places.js — 장소 찾기

   두 가지 길을 제공합니다.

     이름으로 검색   "초당순두부" 라고 치면 목록에서 고릅니다. 기본입니다.
     링크 붙여넣기   네이버 지도에서 공유한 링크를 그대로 붙입니다.

   ★ 왜 이름 검색을 기본으로 두는가
     505 판은 링크 붙여넣기만 있었고, 그 구현이 네이버·에어비앤비
     페이지의 HTML 을 정규식으로 긁는 것이었습니다. 사이트가 조금만
     바뀌어도 전원이 고장나고, 모두가 하나의 호출 할당량을 나눠 써서
     한 명이 많이 쓰면 전원이 먹통이 됩니다.
     이름 검색은 카카오가 정식으로 제공하는 길이라 깨지지 않습니다.

   ★ 링크도 계속 됩니다 — 다만 HTML 을 긁지 않습니다.
     1단계  주소 자체에 좌표가 들어 있으면 그대로 씁니다 (네트워크 0)
     2단계  단축주소는 Edge Function 이 Location 헤더만 따라갑니다
     3단계  좌표를 못 찾으면 주소에서 이름을 뽑아 카카오로 검색합니다
     4단계  그래도 안 되면 "지도에서 찍기"
     1·3·4 단계는 서버 없이 됩니다.
   ============================================================ */

import { inKorea, inBbox } from "./geo.js";

/* 카카오 카테고리 그룹 코드 → 우리 kind
   kind 값은 route.js 의 DWELL 키와 같아야 합니다 */
const CAT_TO_KIND = {
  FD6: "food",     // 음식점
  CE7: "cafe",     // 카페
  AD5: "lodging",  // 숙박
  AT4: "spot",     // 관광명소
  CT1: "spot",     // 문화시설
};

export const CATEGORY = { FOOD: "FD6", CAFE: "CE7", LODGING: "AD5", SIGHT: "AT4", CULTURE: "CT1" };

function places() {
  const K = window.kakao && window.kakao.maps && window.kakao.maps.services;
  if (!K || !K.Places) return null;
  return new K.Places();
}

function geocoder() {
  const K = window.kakao && window.kakao.maps && window.kakao.maps.services;
  if (!K || !K.Geocoder) return null;
  return new K.Geocoder();
}

function kakaoBounds(bbox) {
  const K = window.kakao && window.kakao.maps;
  if (!K || !bbox) return null;
  const [[swLat, swLng], [neLat, neLng]] = bbox;
  return new K.LatLngBounds(new K.LatLng(swLat, swLng), new K.LatLng(neLat, neLng));
}

/* 카카오 결과 한 줄 → 우리 장소 모양 */
function mapResult(r, fallbackKind) {
  const lat = parseFloat(r.y), lng = parseFloat(r.x);
  if (!inKorea(lat, lng)) return null;
  return {
    name: r.place_name,
    lat, lng,
    address: r.road_address_name || r.address_name || "",
    url: r.place_url || "",
    kind: CAT_TO_KIND[r.category_group_code] || fallbackKind || "spot",
    kakao_place_id: r.id ? String(r.id) : null,
    category: r.category_name || "",
    phone: r.phone || "",
    source: "search",
  };
}


/* ============================================================
   이름으로 검색

   지역 범위를 넘겨 그 안에서 먼저 찾습니다. 안 그러면 "횟집" 으로
   검색했을 때 부산 가게가 강릉 여행 목록에 섞입니다.
   범위 안에 없으면 전국으로 다시 찾고 "지역 밖" 표시를 붙입니다.
   ============================================================ */
export function searchByKeyword(query, opts = {}) {
  const q = String(query || "").trim();
  if (!q) return Promise.resolve([]);

  const svc = places();
  if (!svc) return Promise.reject(new Error("지도 검색을 쓸 수 없어요. 카카오 키를 확인해주세요."));

  const { bbox = null, size = 15, kind = null } = opts;

  const run = (useBounds) => new Promise((resolve) => {
    const options = { size: Math.min(size, 15) };
    const b = useBounds ? kakaoBounds(bbox) : null;
    if (b) options.bounds = b;

    svc.keywordSearch(q, (data, status) => {
      const OK = window.kakao.maps.services.Status.OK;
      if (status !== OK || !Array.isArray(data)) return resolve([]);
      resolve(data.map((r) => mapResult(r, kind)).filter(Boolean));
    }, options);
  });

  return (async () => {
    let hits = bbox ? await run(true) : [];
    if (hits.length) return hits.map((h) => ({ ...h, nearby: true }));

    hits = await run(false);
    // 범위 밖이면 표시해 둡니다 — 고르는 사람이 알아야 합니다
    return hits.map((h) => ({ ...h, nearby: bbox ? inBbox(h.lat, h.lng, bbox) : true }));
  })();
}


/* ============================================================
   카테고리로 주변 채우기 — 큐레이션 파일이 없는 지역용

   ★ 결과를 우리 DB 에 저장하지 않습니다.
     카카오 운영 정책이 "필요할 때 실시간 호출, 배치로 받아 저장은
     금지" 이기 때문입니다. 화면에 그릴 때마다 다시 부릅니다.
     사용자가 직접 고른 장소를 저장하는 것은 별개로 괜찮습니다.
   ============================================================ */
export function searchByCategory(code, opts = {}) {
  const svc = places();
  if (!svc) return Promise.resolve([]);

  const { bbox = null, center = null, radius = 10000, size = 15 } = opts;

  return new Promise((resolve) => {
    const options = { size: Math.min(size, 15) };
    const b = kakaoBounds(bbox);
    if (b) options.bounds = b;
    else if (center) {
      options.location = new window.kakao.maps.LatLng(center[0], center[1]);
      options.radius = radius;
    }

    svc.categorySearch(code, (data, status) => {
      const OK = window.kakao.maps.services.Status.OK;
      if (status !== OK || !Array.isArray(data)) return resolve([]);
      resolve(data.map((r) => mapResult(r)).filter(Boolean));
    }, options);
  });
}

/* 지역의 대표 관광지 — 큐레이션 파일이 없을 때 */
export async function seedSpots(region, limit = 12) {
  if (!region) return [];
  const got = await searchByCategory(CATEGORY.SIGHT, {
    bbox: region.bbox, center: region.center, size: 15,
  });
  return got.slice(0, limit).map((s) => ({ ...s, kind: "spot", seeded: true }));
}

/* ============================================================
   주소로 찾기

   ★ 왜 따로 필요한가

   네이버 숙소 페이지나 에어비앤비 링크에는 좌표가 없습니다. 브라우저는
   남의 사이트 페이지를 읽을 수 없으니(CORS) 링크만으로는 위치를 알 수가
   없습니다. 그런데 그 페이지에 적힌 "주소 한 줄"은 사용자가 복사할 수
   있습니다. 그걸 받아서 좌표로 바꿔주면, 서버 없이도 지도에 뜹니다.

   이름 검색(keywordSearch)과는 다른 API 입니다. "강원특별자치도 강릉시
   사천면 가둔지길 24" 같은 도로명 주소는 이름 검색으로는 잘 안 나옵니다.
   ============================================================ */
export function looksLikeAddress(v) {
  const t = String(v || "").trim();
  if (t.length < 6) return false;
  /* 도로명(…로/…길 + 번호) 또는 지번(…동/…리 + 번지) 꼴 */
  return /(로|길)\s*\d/.test(t) || /(동|리|가)\s*\d+(-\d+)?\s*$/.test(t)
      || /(특별자치도|광역시|특별시|[가-힣]+시|[가-힣]+군|[가-힣]+구)\s/.test(t);
}

export function searchByAddress(addr, opts = {}) {
  const { kind = null } = opts;
  return new Promise((resolve) => {
    const geo = geocoder();
    if (!geo) return resolve([]);
    geo.addressSearch(String(addr || "").trim(), (res, status) => {
      if (status !== window.kakao.maps.services.Status.OK || !Array.isArray(res)) {
        return resolve([]);
      }
      const out = [];
      for (const r of res) {
        const lat = parseFloat(r.y), lng = parseFloat(r.x);
        if (!inKorea(lat, lng)) continue;
        out.push({
          name: r.road_address ? r.road_address.building_name || "" : "",
          lat, lng,
          address: (r.road_address && r.road_address.address_name)
                || (r.address && r.address.address_name) || String(addr),
          url: "", kind: kind || "spot", kakao_place_id: null,
          source: "address",
        });
      }
      resolve(out);
    });
  });
}


/* 지역의 출발·귀가 지점 (regions.js 의 hubQuery 로 찾습니다)
   좌표를 손으로 적지 않는 이유: 역이 이전해도 저절로 맞고,
   제가 기억으로 적은 좌표가 틀릴 일이 없습니다. */
export async function findHub(region) {
  if (!region || !region.hubQuery) return null;
  try {
    const hits = await searchByKeyword(region.hubQuery, { bbox: region.bbox, size: 5 });
    const best = hits.find((h) => h.nearby) || hits[0];
    if (!best) return null;
    return { name: best.name, lat: best.lat, lng: best.lng };
  } catch (_) {
    return null;
  }
}


/* ============================================================
   링크에서 좌표 뽑기 — 1단계 (네트워크 0)

   ★ 핵심 요령: 숫자 쌍을 찾은 뒤 "한국 안에 떨어지는 순서"를 고릅니다.
     네이버는 lng,lat 순서인데 형식이 자주 바뀌고, 구글은 lat,lng 입니다.
     순서를 외우는 대신 둘 다 시도해서 말이 되는 쪽을 씁니다.
     한국 밖은 어차피 받지 않으므로 애매할 일이 없습니다.
   ============================================================ */
function pick(a, b) {
  if (inKorea(a, b)) return { lat: a, lng: b };
  if (inKorea(b, a)) return { lat: b, lng: a };
  return null;
}

export function coordsFromUrl(raw) {
  const url = String(raw || "");
  if (!url) return null;

  const num = "(-?\\d{1,3}\\.\\d{3,})";

  const patterns = [
    // 구글: @37.77,128.94,15z  /  !3d37.77!4d128.94
    new RegExp(`@${num},${num}`),
    new RegExp(`!3d${num}!4d${num}`),
    // 네이버 신형: ?c=128.94,37.77,15,0,0,0,dh  (lng,lat)
    new RegExp(`[?&]c=${num},${num}`),
    // 이름 있는 값들 — 순서를 믿지 않고 pick 이 판단합니다
    new RegExp(`[?&]lat=${num}[^]*?[?&](?:lng|lon|long)=${num}`),
    new RegExp(`[?&](?:lng|lon|long)=${num}[^]*?[?&]lat=${num}`),
    new RegExp(`[?&]y=${num}[^]*?[?&]x=${num}`),
    new RegExp(`[?&]x=${num}[^]*?[?&]y=${num}`),
    // 카카오 link/map/이름,위도,경도
    new RegExp(`/link/(?:map|to)/[^/]*,${num},${num}`),
    // 마지막 수단: 주소 어딘가의 숫자 쌍
    new RegExp(`${num}[,/\\s]+${num}`),
  ];

  for (const re of patterns) {
    const m = url.match(re);
    if (!m) continue;
    const hit = pick(parseFloat(m[1]), parseFloat(m[2]));
    if (hit) return { ...hit, source: "link" };
  }
  return null;
}

/* 주소에서 장소 이름처럼 보이는 것 뽑기 — 3단계(검색 폴백)용 */
export function nameFromUrl(raw) {
  const url = String(raw || "");
  if (!url) return "";

  let u;
  try { u = new URL(url); } catch (_) { return ""; }

  // 쿼리에 대놓고 들어 있는 경우
  for (const k of ["q", "query", "keyword", "name", "title", "search"]) {
    const v = u.searchParams.get(k);
    if (v && v.trim()) return decodeURIComponent(v).trim().slice(0, 40);
  }

  // 경로 조각 중 한글이 섞인 것 (대개 장소 이름입니다)
  const parts = u.pathname.split("/").filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch (_) { return p; }
  });
  for (const p of parts.reverse()) {
    if (!/[가-힣]/.test(p) || p.length > 60) continue;
    // 카카오 link/map/강릉역,37.7637,128.899 처럼 이름 뒤에 좌표가 붙는 경우
    const clean = p.replace(/,\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*$/, "")
                   .replace(/[+_]/g, " ")
                   .trim();
    if (clean) return clean.slice(0, 40);
  }
  return "";
}

/* 단축 주소인가 — 2단계(서버 거치기)가 필요한 호스트 */
const SHORTENERS = ["naver.me", "kko.to", "kakao.to", "maps.app.goo.gl", "goo.gl", "abnb.me"];
export function isShortUrl(raw) {
  try {
    const h = new URL(String(raw)).hostname.toLowerCase();
    return SHORTENERS.some((s) => h === s || h.endsWith("." + s));
  } catch (_) { return false; }
}


/* ============================================================
   위치를 못 찾았을 때, 사이트에 맞는 안내를 합니다

   ★ "못 찾았어요" 만 띄우면 사용자는 자기가 뭘 잘못했는지 찾습니다.
     실제로는 그 사이트가 좌표를 안 주는 것이고, 할 수 있는 일이
     따로 있습니다. 그걸 알려주는 게 맞습니다.
   ============================================================ */
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ""; }
}

export function hintFor(url) {
  const h = hostOf(url);

  /* ★ 에어비앤비는 "못 하는" 게 아니라 "안 알려주는" 것입니다.
     예약 전까지 정확한 위치를 공개하지 않고 동그라미만 보여줍니다.
     서버가 있어도 가져올 수 없으므로, 할 수 있는 방법을 알려줍니다. */
  if (h.includes("airbnb") || h.includes("abnb.me")) {
    return "에어비앤비는 예약 전까지 정확한 위치를 공개하지 않아요. "
         + "숙소 페이지의 동네 이름이나 주소를 위 칸에 넣고, "
         + "이 링크는 아래 '예약 링크' 칸에 넣어주세요.";
  }
  if (h.includes("booking.com") || h.includes("agoda") || h.includes("yanolja")
      || h.includes("goodchoice") || h.includes("expedia")) {
    return "이 예약 사이트는 좌표를 알려주지 않아요. "
         + "숙소 이름이나 주소를 위 칸에 넣고, 이 링크는 아래 '예약 링크' 칸에 넣어주세요.";
  }
  if (isShortUrl(url)) {
    return "짧은 링크를 열어보지 못했어요. 이름이나 주소로 찾거나 지도에서 찍어주세요.";
  }
  return "이 링크에서는 위치를 못 찾았어요. 이름이나 주소로 찾거나 지도에서 찍어주세요.";
}


/* ============================================================
   링크 하나를 장소로 — 네 단계를 차례로

   돌려주는 모양:
     { ok:true,  place:{...} }                 바로 쓸 수 있음
     { ok:false, candidates:[...], reason }    골라야 함 (검색 결과)
     { ok:false, candidates:[],   reason }     지도에서 찍어야 함

   resolveShort 는 2단계를 해주는 함수입니다. 없으면 건너뜁니다
   (Edge Function 을 아직 배포하지 않아도 1·3·4 단계로 동작합니다).
   ============================================================ */
export async function resolveLink(raw, opts = {}) {
  const url = String(raw || "").trim();
  const { bbox = null, kind = null, resolveShort = null } = opts;

  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, candidates: [], reason: "주소가 아니에요. https:// 로 시작하는 링크를 붙여넣어주세요." };
  }

  /* 1단계 — 주소 자체에 좌표가 있나 */
  const direct = coordsFromUrl(url);
  if (direct) {
    return {
      ok: true,
      place: {
        name: nameFromUrl(url) || "이름 없는 장소",
        lat: direct.lat, lng: direct.lng,
        url, kind: kind || "spot", source: "link",
        address: "", kakao_place_id: null,
      },
    };
  }

  /* 2단계 — 단축 주소면 서버가 Location 헤더만 따라가 줍니다 */
  if (isShortUrl(url) && typeof resolveShort === "function") {
    try {
      const got = await resolveShort(url);
      if (got && inKorea(got.lat, got.lng)) {
        return {
          ok: true,
          place: {
            name: got.name || nameFromUrl(url) || "이름 없는 장소",
            lat: got.lat, lng: got.lng,
            url, kind: kind || "spot", source: "link",
            address: got.address || "", kakao_place_id: null,
          },
        };
      }
    } catch (_) { /* 3단계로 */ }
  }

  /* 3단계 — 이름을 뽑아 카카오로 검색 */
  const guess = nameFromUrl(url);
  if (guess) {
    try {
      const hits = await searchByKeyword(guess, { bbox, size: 8, kind });
      if (hits.length) {
        return {
          ok: false,
          candidates: hits.map((h) => ({ ...h, url })),
          reason: `"${guess}" 로 찾아봤어요. 맞는 곳을 골라주세요.`,
        };
      }
    } catch (_) { /* 4단계로 */ }
  }

  /* 4단계 — 직접 알려주기 */
  return {
    ok: false,
    candidates: [],
    reason: hintFor(url),
  };
}
