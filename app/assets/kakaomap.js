/* ============================================================
   kakaomap.js — 카카오 지도

   원래 Leaflet(OpenStreetMap) 이었습니다. 카카오로 바꾼 이유는
   지도 자체보다 "장소를 이름으로 검색해서 추가"가 되기 때문입니다.
   (OSM 은 한국 장소 검색이 약해서 링크 긁기에 계속 의존해야 했습니다)

   ★ 바깥에 보이는 함수 이름과 모양을 Leaflet 판과 똑같이 맞췄습니다.
     app.js 의 호출부를 거의 고치지 않아도 됩니다.

   ★ 핀이 HTML 이라 전환이 쌉니다.
     Leaflet 의 divIcon 과 카카오의 CustomOverlay 가 둘 다 HTML 문자열을
     받으므로 style.css 의 .pin-lodging / .pin-food / .pin-spot 가 그대로
     살아 있습니다.

   ★ 확대 단계가 거꾸로입니다.
     Leaflet zoom 은 클수록 가깝고, 카카오 level 은 작을수록 가깝습니다.
     (Leaflet zoom 11 ≈ 카카오 level 8)
   ============================================================ */

import { bboxOf } from "./geo.js";
import { esc } from "./dom.js";

/* ============================================================
   SDK 불러오기

   키가 없으면 지도를 못 띄우지만, 그렇다고 페이지 전체가 죽으면
   안 됩니다. 키를 받기 전에도 나머지 화면을 눌러볼 수 있어야 하고,
   테스트에서도 지도 없이 돌려야 합니다.
   그래서 실패하면 false 를 돌려주고, createMap 이 알아서
   "지도를 띄울 수 없다"는 안내판으로 대체합니다.
   ============================================================ */
let sdkPromise = null;

export function loadKakao(appkey) {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.Map) {
      return resolve(true);            // 테스트에서 미리 넣어둔 경우
    }
    if (!appkey) {
      console.warn("[지도] 카카오 JavaScript 키가 없습니다. 지도 없이 동작합니다.");
      return resolve(false);
    }

    const s = document.createElement("script");
    // libraries=services 가 없으면 장소 검색(Places)이 없습니다 — 반드시 필요합니다
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appkey)}` +
            `&libraries=services&autoload=false`;
    s.async = true;
    s.onload = () => {
      try {
        window.kakao.maps.load(() => resolve(true));
      } catch (e) {
        console.warn("[지도] SDK 초기화 실패", e);
        resolve(false);
      }
    };
    s.onerror = () => {
      // 거의 항상 도메인 등록 누락입니다
      console.warn("[지도] SDK 를 불러오지 못했습니다. 카카오 개발자 콘솔의 " +
                   "플랫폼 > Web 사이트 도메인에 지금 주소가 등록돼 있는지 확인하세요.");
      resolve(false);
    };
    document.head.appendChild(s);
  });

  return sdkPromise;
}

export function kakaoReady() {
  return !!(window.kakao && window.kakao.maps && window.kakao.maps.Map);
}


/* ============================================================
   지도 없이도 앱이 돌게 하는 대체 구현

   메서드 이름은 전부 같고 아무것도 하지 않습니다.
   호출하는 쪽에 "지도가 있나?" 분기를 뿌리지 않기 위한 것입니다.
   ============================================================ */
function stubMap(elId, reason) {
  const el = document.getElementById(elId);
  if (el) {
    el.classList.add("map-off");
    el.innerHTML =
      `<div class="map-off-note">` +
      `<strong>지도를 띄울 수 없어요</strong>` +
      `<span>${esc(reason)}</span>` +
      `<span class="muted">목록과 투표는 그대로 쓸 수 있어요.</span>` +
      `</div>`;
  }
  const noop = () => {};
  return {
    map: null, ok: false,
    container: () => el,
    setLodgings: (list) => (list || []).filter((d) => d.lat != null).length,
    setSpots: noop, setPoints: noop,
    goTo: noop, select: noop, filter: noop,
    fit: noop, fitPoints: noop, clearSelect: noop,
    startPick: (cb) => { if (cb) cb(null); },   // 찍기를 즉시 포기 → 좌표 직접 입력으로
    cancelPick: noop, showPick: noop, refresh: noop,
  };
}


/* ============================================================
   createMap
   opts: { center: [lat,lng], level: 1~14 }
   ============================================================ */
export function createMap(elId, opts = {}) {
  const el = document.getElementById(elId);
  if (!el) throw new Error(`지도를 넣을 요소가 없습니다: #${elId}`);
  if (!kakaoReady()) {
    return stubMap(elId, "카카오 지도 키가 설정되지 않았거나 도메인이 등록되지 않았어요.");
  }

  const K = window.kakao.maps;
  const center = opts.center || [37.5665, 126.9780];
  const ll = (lat, lng) => new K.LatLng(lat, lng);

  el.classList.remove("map-off");
  el.innerHTML = "";

  const map = new K.Map(el, {
    center: ll(center[0], center[1]),
    level: opts.level || 8,
  });

  // 모바일에서 페이지 스크롤을 가로채지 않도록 꺼두고, 한 번 누르면 켭니다
  map.setZoomable(false);
  K.event.addListener(map, "click", () => map.setZoomable(true));
  el.addEventListener("mouseleave", () => map.setZoomable(false));

  /* ---------- 상태 ---------- */
  const markers = {};        // id -> { ov, el, no, lat, lng, kind }
  let lodgingOvs = [];       // filter() 로 켜고 끄기 위해 따로 들고 있습니다
  let spotOvs = [];
  let bounds = null;         // 숙소 전체 범위
  let pointBounds = null;    // 맛집 전체 범위
  let picking = null;
  let pickOv = null;
  let visible = { lodging: true, spot: true };

  /* ---------- 말풍선 ----------
     카카오 InfoWindow 는 Marker 를 요구하는데 우리는 CustomOverlay 를
     쓰므로, 말풍선도 CustomOverlay 하나를 재사용합니다. */
  const bubbleEl = document.createElement("div");
  bubbleEl.className = "map-bubble";
  const bubble = new K.CustomOverlay({
    content: bubbleEl, yAnchor: 1.45, zIndex: 5, clickable: true,
  });
  let bubbleOpen = false;

  function openBubble(lat, lng, html) {
    bubbleEl.innerHTML = `<div class="map-bubble-in">${html}</div>`;
    bubble.setPosition(ll(lat, lng));
    bubble.setMap(map);
    bubbleOpen = true;
  }
  function closeBubble() {
    if (bubbleOpen) { bubble.setMap(null); bubbleOpen = false; }
  }

  /* ---------- 핀 만들기 ----------
     Leaflet divIcon 과 달리 CustomOverlay 에는 click 이벤트가 없습니다.
     그래서 내용을 DOM 으로 만들어 직접 listener 를 답니다. */
  function pinEl(html, onClick) {
    const wrap = document.createElement("div");
    wrap.className = "pin-wrap";
    wrap.innerHTML = html;
    if (onClick) {
      wrap.addEventListener("click", (e) => {
        e.stopPropagation();   // 지도 click(=찍기 모드) 으로 번지지 않게
        onClick();
      });
    }
    return wrap;
  }

  function lodgingHtml(no, selected) {
    return `<div class="pin-lodging${selected ? " sel" : ""}"><span>${no}</span></div>`;
  }
  function foodHtml(cat, name) {
    const cls = cat === "cafe" ? "pin-food cafe" : cat === "spot" ? "pin-spot big" : "pin-food";
    return `<div class="${cls}"></div><span class="pin-label">${esc(name)}</span>`;
  }
  function spotHtml(name) {
    return `<div class="pin-spot"></div><span class="pin-label sm">${esc(name)}</span>`;
  }

  function clearOvs(arr) { arr.forEach((o) => o.setMap(null)); arr.length = 0; }

  /* ---------- 지도 클릭 = 위치 찍기 ---------- */
  K.event.addListener(map, "click", (e) => {
    if (!picking) { closeBubble(); return; }
    const lat = +e.latLng.getLat().toFixed(6);
    const lng = +e.latLng.getLng().toFixed(6);
    api.showPick(lat, lng);
    const cb = picking;
    picking = null;
    el.classList.remove("picking");
    cb({ lat, lng });
  });

  /* ============================================================
     바깥에 보이는 부분 — Leaflet 판과 같은 모양
     ============================================================ */
  const api = {
    map,
    ok: true,
    container: () => el,

    /* 숙소 핀 (번호 달린 파란 핀) */
    setLodgings(list, onPick) {
      clearOvs(lodgingOvs);
      Object.keys(markers).forEach((k) => {
        if (markers[k].kind === "lodging") delete markers[k];
      });

      const pts = [];
      (list || []).forEach((d, i) => {
        if (d.lat == null || d.lng == null) return;
        const no = i + 1;
        const node = pinEl(lodgingHtml(no, false), () => {
          openBubble(d.lat, d.lng,
            `<strong>${esc(d.name)}</strong>` +
            (d.address ? `<br><span class="sub">${esc(d.address)}</span>` : "") +
            (d.approx ? `<br><span class="sub">※ 대략 위치</span>` : ""));
          if (onPick) onPick(d.id);
        });
        const ov = new K.CustomOverlay({
          position: ll(d.lat, d.lng), content: node,
          yAnchor: 1, zIndex: 3, clickable: true,
        });
        if (visible.lodging) ov.setMap(map);
        lodgingOvs.push(ov);
        markers[d.id] = { ov, el: node, no, lat: d.lat, lng: d.lng, kind: "lodging" };
        pts.push({ lat: d.lat, lng: d.lng });
      });

      bounds = bboxOf(pts, 0.02);
      return pts.length;
    },

    /* 관광지 핀 (작은 회색 점) — 숙소 탭의 배경 역할 */
    setSpots(list) {
      clearOvs(spotOvs);
      (list || []).forEach((s) => {
        if (s.lat == null || s.lng == null) return;
        const node = pinEl(spotHtml(s.name), () => {
          openBubble(s.lat, s.lng, `<strong>${esc(s.name)}</strong>` +
            (s.tag ? `<br><span class="sub">${esc(s.tag)}</span>` : ""));
        });
        const ov = new K.CustomOverlay({
          position: ll(s.lat, s.lng), content: node,
          yAnchor: 0.5, zIndex: 1, clickable: true,
        });
        if (visible.spot) ov.setMap(map);
        spotOvs.push(ov);
      });
    },

    /* 맛집 핀 — 이 탭에서는 주인공이라 또렷하게 */
    setPoints(list) {
      clearOvs(spotOvs);
      Object.keys(markers).forEach((k) => {
        if (markers[k].kind !== "lodging") delete markers[k];
      });

      const pts = [];
      (list || []).forEach((s) => {
        if (s.lat == null || s.lng == null) return;
        const node = pinEl(foodHtml(s.kind || s.cat, s.name), () => {
          openBubble(s.lat, s.lng,
            `<strong>${esc(s.name)}</strong>` +
            (s.note ? `<br><span class="sub">${esc(s.note)}</span>` : "") +
            (s.approx ? `<br><span class="sub">※ 대략 위치</span>` : ""));
        });
        const ov = new K.CustomOverlay({
          position: ll(s.lat, s.lng), content: node,
          yAnchor: 1, zIndex: 2, clickable: true,
        });
        ov.setMap(map);
        spotOvs.push(ov);
        markers[s.id] = { ov, el: node, no: 0, lat: s.lat, lng: s.lng, kind: s.kind || s.cat };
        pts.push({ lat: s.lat, lng: s.lng });
      });

      pointBounds = bboxOf(pts, 0.01);
      if (pointBounds) api.fitPoints();
    },

    /* 카드 클릭 → 지도 이동 */
    goTo(id) {
      const hit = markers[id];
      if (!hit) return;
      map.panTo(ll(hit.lat, hit.lng));
      if (map.getLevel() > 5) map.setLevel(5, { animate: true });
    },

    /* 숙소 카드 선택 → 핀 강조 + 이동 */
    select(id, fly = true) {
      Object.entries(markers).forEach(([mid, m]) => {
        if (m.kind !== "lodging") return;
        const inner = m.el.firstElementChild;
        if (inner) inner.classList.toggle("sel", mid === id);
      });
      const hit = markers[id];
      if (!hit) return;
      if (fly) {
        map.panTo(ll(hit.lat, hit.lng));
        if (map.getLevel() > 5) map.setLevel(5, { animate: true });
      }
    },

    /* 전부 / 숙소만 / 관광지만 */
    filter(mode) {
      visible.lodging = mode !== "spot";
      visible.spot = mode !== "lodging";
      lodgingOvs.forEach((o) => o.setMap(visible.lodging ? map : null));
      spotOvs.forEach((o) => o.setMap(visible.spot ? map : null));
    },

    /* 전체 보기로 되돌리기 */
    fit() { setBounds(bounds); },
    fitPoints() { setBounds(pointBounds); },

    clearSelect() {
      Object.values(markers).forEach((m) => {
        const inner = m.el && m.el.firstElementChild;
        if (inner) inner.classList.remove("sel");
      });
      closeBubble();
    },

    /* ---------- 지도에서 위치 찍기 ----------
       좌표를 모르는 친구도 지도를 눌러 위치를 정할 수 있게. */
    startPick(onPick) {
      api.cancelPick();
      closeBubble();
      picking = onPick;
      el.classList.add("picking");
    },

    cancelPick() {
      picking = null;
      el.classList.remove("picking");
      if (pickOv) { pickOv.setMap(null); pickOv = null; }
    },

    showPick(lat, lng) {
      if (pickOv) pickOv.setMap(null);
      pickOv = new K.CustomOverlay({
        position: ll(lat, lng),
        content: pinEl('<div class="pin-pick"></div>'),
        yAnchor: 1, zIndex: 9,
        clickable: false,   // 지도 클릭을 삼켜서 찍기 모드를 깨뜨리지 않게
      });
      pickOv.setMap(map);
      map.panTo(ll(lat, lng));
    },

    /* 숨어 있던 탭이 보일 때 반드시 불러야 지도가 제대로 그려집니다
       (Leaflet 의 invalidateSize 와 같은 역할) */
    refresh() {
      setTimeout(() => {
        map.relayout();
        if (bounds || pointBounds) setBounds(bounds || pointBounds);
      }, 60);
    },
  };

  function setBounds(bb) {
    if (!bb) return;
    const [[swLat, swLng], [neLat, neLng]] = bb;
    const b = new K.LatLngBounds(ll(swLat, swLng), ll(neLat, neLng));
    map.setBounds(b, 40, 40, 40, 40);   // 카카오는 여백을 px 로 받습니다
  }

  return api;
}
