/* ============================================================
   카카오 지도 SDK 흉내내기 — 테스트용

   왜 가짜를 쓰는가:
     · 진짜 SDK 는 도메인 등록이 돼 있어야 하고(localhost 포함),
       테스트를 돌릴 때마다 무료 할당량을 깎습니다
     · 진짜 지도는 타일 로딩 때문에 결과가 들쭉날쭉해서
       "핀이 몇 개 그려졌나" 같은 단정이 불안정해집니다
     · 카카오가 SDK 를 바꾸면 우리 코드가 아닌 이유로 테스트가 깨집니다

   그래서 우리가 쓰는 API 만 최소한으로 흉내 냅니다.
   진짜 SDK 로 하는 확인은 휴대폰에서 손으로 한 번만 합니다.

   ★ 이 가짜는 overlay 내용을 실제로 DOM 에 붙입니다.
     그래야 "핀이 그려졌나 / 번호가 맞나 / 강조가 걸렸나" 를
     진짜 화면처럼 확인할 수 있습니다.
   ============================================================ */
(function () {
  const listeners = new WeakMap();

  function LatLng(lat, lng) { this._lat = lat; this._lng = lng; }
  LatLng.prototype.getLat = function () { return this._lat; };
  LatLng.prototype.getLng = function () { return this._lng; };

  function LatLngBounds(sw, ne) { this.sw = sw; this.ne = ne; }

  function KMap(el, opts) {
    this._el = el;
    this._center = opts.center;
    this._level = opts.level || 8;
    this._zoomable = true;
    this._relayouts = 0;
    this._bounds = null;

    // 오버레이가 붙을 층
    this._layer = document.createElement("div");
    this._layer.className = "stub-layer";
    el.appendChild(this._layer);

    window.__kmaps = window.__kmaps || {};
    if (el && el.id) window.__kmaps[el.id] = this;

    // 테스트가 지도 클릭을 흉내 낼 수 있게
    el.addEventListener("click", (e) => {
      if (e.__stubPin) return;                 // 핀 클릭은 지도 클릭이 아님
      const ll = e.__stubLatLng || new LatLng(37.5, 127.0);
      (listeners.get(this) || []).filter((l) => l.type === "click")
        .forEach((l) => l.fn({ latLng: ll }));
    });
  }
  KMap.prototype.setZoomable = function (v) { this._zoomable = !!v; };
  KMap.prototype.getLevel = function () { return this._level; };
  KMap.prototype.setLevel = function (v) { this._level = v; };
  KMap.prototype.getCenter = function () { return this._center; };
  KMap.prototype.panTo = function (ll) { this._center = ll; };
  KMap.prototype.setCenter = function (ll) { this._center = ll; };
  KMap.prototype.setBounds = function (b) { this._bounds = b; };
  KMap.prototype.relayout = function () { this._relayouts++; };
  KMap.prototype.getNode = function () { return this._el; };

  /* 테스트가 "지도가 어디를 보고 있나"를 잴 수 있게 꺼내 둡니다.
     실제 카카오 SDK 에는 없는, 이 스텁만의 통로입니다. */
  KMap.prototype.__center = function () {
    return this._center ? [this._center.getLat(), this._center.getLng()] : null;
  };

  function CustomOverlay(opts) {
    this._pos = opts.position;
    this._content = opts.content;
    this._clickable = opts.clickable !== false;
    this._map = null;
    this._node = null;
  }
  CustomOverlay.prototype.setMap = function (map) {
    if (!map) {
      if (this._node && this._node.parentNode) this._node.parentNode.removeChild(this._node);
      this._node = null; this._map = null;
      return;
    }
    this._map = map;
    const holder = document.createElement("div");
    holder.className = "stub-ov";
    holder.dataset.lat = this._pos ? this._pos.getLat() : "";
    holder.dataset.lng = this._pos ? this._pos.getLng() : "";
    if (typeof this._content === "string") holder.innerHTML = this._content;
    else if (this._content) holder.appendChild(this._content);
    // 핀 클릭이 지도 클릭으로 번지지 않게 표시
    holder.addEventListener("click", (e) => { e.__stubPin = true; }, true);
    map._layer.appendChild(holder);
    this._node = holder;
  };
  CustomOverlay.prototype.setPosition = function (ll) {
    this._pos = ll;
    if (this._node) {
      this._node.dataset.lat = ll.getLat();
      this._node.dataset.lng = ll.getLng();
    }
  };
  CustomOverlay.prototype.setContent = function (c) {
    if (!this._node) return;
    this._node.innerHTML = "";
    if (typeof c === "string") this._node.innerHTML = c;
    else if (c) this._node.appendChild(c);
  };

  /* ---------- 장소 검색 ----------
     테스트가 window.__stubPlaces 에 결과를 미리 꽂아둡니다.

     ★ bounds 를 실제로 반영합니다.
       그래야 "지역 안에서 먼저 찾고, 없으면 전국으로 다시 찾는다"는
       로직을 진짜로 확인할 수 있습니다. 범위를 무시하는 가짜였다면
       그 분기가 테스트에서 통째로 빠집니다. */
  function withinBounds(list, bounds) {
    if (!bounds) return list;
    const swLat = bounds.sw.getLat(), swLng = bounds.sw.getLng();
    const neLat = bounds.ne.getLat(), neLng = bounds.ne.getLng();
    return list.filter((r) => {
      const lat = parseFloat(r.y), lng = parseFloat(r.x);
      return lat >= swLat && lat <= neLat && lng >= swLng && lng <= neLng;
    });
  }

  function Places() {}
  Places.prototype.keywordSearch = function (q, cb, opts) {
    const all = (window.__stubPlaces && window.__stubPlaces.keyword) || {};
    const hit = withinBounds(all[q] || all["*"] || [], opts && opts.bounds);
    setTimeout(() => cb(hit, hit.length ? Status.OK : Status.ZERO_RESULT, {}), 0);
  };
  Places.prototype.categorySearch = function (code, cb, opts) {
    const all = (window.__stubPlaces && window.__stubPlaces.category) || {};
    const hit = withinBounds(all[code] || [], opts && opts.bounds);
    setTimeout(() => cb(hit, hit.length ? Status.OK : Status.ZERO_RESULT, {}), 0);
  };

  function Geocoder() {}
  Geocoder.prototype.addressSearch = function (addr, cb) {
    const all = (window.__stubPlaces && window.__stubPlaces.address) || {};
    const hit = all[addr] || [];
    setTimeout(() => cb(hit, hit.length ? Status.OK : Status.ZERO_RESULT), 0);
  };

  const Status = { OK: "OK", ZERO_RESULT: "ZERO_RESULT", ERROR: "ERROR" };

  window.kakao = {
    maps: {
      Map: KMap,
      LatLng,
      LatLngBounds,
      CustomOverlay,
      load: (cb) => cb(),
      event: {
        addListener(target, type, fn) {
          const arr = listeners.get(target) || [];
          arr.push({ type, fn });
          listeners.set(target, arr);
        },
      },
      services: { Places, Geocoder, Status, SortBy: { ACCURACY: "accuracy" } },
      __stub: true,
    },
  };
})();
