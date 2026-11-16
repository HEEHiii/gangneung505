/* ============================================================
   map.js — Leaflet 지도 (OpenStreetMap)
   API 키가 필요 없는 무료 지도입니다.
   ============================================================ */

const GANGNEUNG = [37.7640, 128.9000];

/* 두 지점 사이 직선거리(km) — 하버사인 */
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function createMap(elId, opts = {}) {
  const map = L.map(elId, {
    center: opts.center || GANGNEUNG,
    zoom: opts.zoom || 11,
    scrollWheelZoom: false,   // 모바일에서 페이지 스크롤을 가로채지 않도록
    zoomControl: true,
  });

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // 데스크톱에서는 지도를 한 번 클릭하면 휠 줌이 켜지도록
  map.on("click", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());

  // "위치 찍기" 모드
  let picking = null, pickMarker = null;
  const pickIcon = L.divIcon({
    className: "",
    html: '<div class="pin-pick"></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
  map.on("click", e => {
    if (!picking) return;
    const { lat, lng } = e.latlng;
    api.showPick(lat, lng);
    const cb = picking;
    picking = null;
    map.getContainer().classList.remove("picking");
    cb({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
  });

  const lodgingLayer = L.layerGroup().addTo(map);
  const spotLayer = L.layerGroup().addTo(map);
  const markers = {};          // id -> marker
  let bounds = null;        // 숙소 전체가 들어오는 범위
  let pointBounds = null;   // 맛집 전체가 들어오는 범위

  function lodgingIcon(no, selected) {
    return L.divIcon({
      className: "",
      html: `<div class="pin-lodging${selected ? " sel" : ""}"><span>${no}</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28],
    });
  }

  function foodIcon(isCafe) {
    return L.divIcon({
      className: "",
      html: `<div class="pin-food${isCafe ? " cafe" : ""}"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 20],
      popupAnchor: [0, -20],
    });
  }

  const spotIcon = L.divIcon({
    className: "",
    html: '<div class="pin-spot"></div>',
    iconSize: [11, 11],
    iconAnchor: [5.5, 5.5],
    popupAnchor: [0, -6],
  });

  const api = {
    map,

    /* 숙소 핀 */
    setLodgings(list, onPick) {
      lodgingLayer.clearLayers();
      const pts = [];
      list.forEach((d, i) => {
        if (d.lat == null || d.lng == null) return;
        const m = L.marker([d.lat, d.lng], {
          icon: lodgingIcon(i + 1, false),
          title: d.name,
          zIndexOffset: 1000,
          alt: `숙소 ${i + 1} ${d.name}`,
        });
        m.bindPopup(
          `<strong>${esc(d.name)}</strong>` +
          (d.area ? `<br><span style="color:#73777d">${esc(d.area)}</span>` : "") +
          (d.approx ? `<br><span style="color:#73777d">※ 대략 위치</span>` : "")
        );
        m.on("click", () => onPick && onPick(d.id));
        m.addTo(lodgingLayer);
        markers[d.id] = { marker: m, no: i + 1 };
        pts.push([d.lat, d.lng]);
      });
      bounds = pts.length ? L.latLngBounds(pts).pad(0.35) : null;
      return pts.length;
    },

    /* 관광지 핀 */
    setSpots(list) {
      spotLayer.clearLayers();
      list.forEach(s => {
        L.marker([s.lat, s.lng], { icon: spotIcon, title: s.name, alt: s.name })
          .bindTooltip(s.name, { direction: "top", offset: [0, -6] })
          .bindPopup(`<strong>${esc(s.name)}</strong>`)
          .addTo(spotLayer);
      });
    },

    /* 맛집 핀 — 이 탭에서는 주인공이라 회색 점보다 또렷하게 */
    setPoints(list) {
      spotLayer.clearLayers();
      Object.keys(markers).forEach(k => delete markers[k]);
      const pts = [];
      list.forEach(s => {
        const m = L.marker([s.lat, s.lng], {
          icon: foodIcon(s.cat === "cafe"),
          title: s.name,
          alt: s.name,
        })
          .bindTooltip(s.name, { direction: "top", offset: [0, -24], opacity: 1 })
          .bindPopup(
            `<strong>${esc(s.name)}</strong>` +
            (s.note ? `<br><span style="color:#73777d">${esc(s.note)}</span>` : "") +
            (s.approx ? `<br><span style="color:#73777d">※ 대략 위치</span>` : "")
          )
          .addTo(spotLayer);
        markers[s.id] = { marker: m, no: 0 };
        pts.push([s.lat, s.lng]);
      });
      pointBounds = pts.length ? L.latLngBounds(pts).pad(0.25) : null;
      if (pointBounds) map.fitBounds(pointBounds);
    },

    /* 맛집 카드 클릭 → 지도 이동 */
    goTo(id) {
      const hit = markers[id];
      if (!hit) return;
      map.flyTo(hit.marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.6 });
      hit.marker.openPopup();
    },

    /* 카드 선택 → 지도 이동 */
    select(id, fly = true) {
      Object.entries(markers).forEach(([mid, { marker, no }]) => {
        marker.setIcon(lodgingIcon(no, mid === id));
      });
      const hit = markers[id];
      if (!hit) return;
      if (fly) map.flyTo(hit.marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.6 });
      hit.marker.openPopup();
    },

    filter(mode) {
      if (mode === "lodging") {
        map.addLayer(lodgingLayer); map.removeLayer(spotLayer);
      } else if (mode === "spot") {
        map.removeLayer(lodgingLayer); map.addLayer(spotLayer);
      } else {
        map.addLayer(lodgingLayer); map.addLayer(spotLayer);
      }
    },

    /* 전체 보기로 되돌리기 */
    fit() { if (bounds) map.fitBounds(bounds); },
    fitPoints() { if (pointBounds) map.fitBounds(pointBounds); },

    /* 고른 것 해제 — 핀 강조와 말풍선을 되돌립니다 */
    clearSelect() {
      Object.entries(markers).forEach(([, { marker, no }]) => {
        if (no) marker.setIcon(lodgingIcon(no, false));   // 숙소 핀만 강조 상태가 있음
      });
      map.closePopup();
    },

    /* ---------- 지도에서 위치 찍기 ----------
       좌표를 모르는 친구도 지도를 눌러 위치를 정할 수 있게. */
    startPick(onPick) {
      api.cancelPick();
      picking = onPick;
      map.getContainer().classList.add("picking");
    },

    cancelPick() {
      picking = null;
      map.getContainer().classList.remove("picking");
      if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
    },

    showPick(lat, lng) {
      if (pickMarker) map.removeLayer(pickMarker);
      pickMarker = L.marker([lat, lng], { icon: pickIcon, zIndexOffset: 2000 }).addTo(map);
      map.panTo([lat, lng]);
    },

    /* 탭이 숨겨져 있다가 보일 때 반드시 호출해야 타일이 제대로 그려집니다 */
    refresh() { setTimeout(() => map.invalidateSize(), 60); },
  };

  return api;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
