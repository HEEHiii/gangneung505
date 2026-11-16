/* ============================================================
   505 강릉여행 — 투표 / 경비 / 추가된 숙소·맛집 / 일정 저장소
   구글 시트 + 앱스 스크립트

   설치 방법은 SETUP.md 를 보세요. 이 파일은 통째로 복사해서
   앱스 스크립트 편집기에 붙여넣으면 됩니다.

   ※ 이미 예전 버전을 올려두셨다면, 이 내용으로 다시 붙여넣고
     반드시 [배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포] 를
     해주세요. 저장만 해서는 반영되지 않습니다.
   ============================================================ */

var SHEET_VOTES    = 'votes';
var SHEET_EXPENSES = 'expenses';
var SHEET_ITEMS    = 'items';   // 친구들이 추가한 숙소 · 맛집
var SHEET_DOCS     = 'docs';    // 일정표처럼 통째로 저장되는 것

/* ---------- 시트 준비 ---------- */
function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function votesSheet_()    { return sheet_(SHEET_VOTES,    ['ts', 'voter', 'itemId', 'value']); }
function expensesSheet_() { return sheet_(SHEET_EXPENSES, ['id', 'ts', 'item', 'amount', 'payer']); }
function itemsSheet_()    { return sheet_(SHEET_ITEMS,    ['id', 'kind', 'ts', 'json']); }
function docsSheet_()     { return sheet_(SHEET_DOCS,     ['key', 'ts', 'json']); }

/* ============================================================
   읽기 — 한 번에 다 내려줍니다 (요청 횟수를 줄이려고)
   ============================================================ */
function doGet(e) {
  try {
    var type = (e && e.parameter && e.parameter.type) || '';

    // 링크에서 이름·좌표 알아내기 (브라우저는 CORS 때문에 못 함)
    if (type === 'resolve') {
      return json_(resolveLink_((e.parameter.url || '').trim()));
    }

    var me = (e && e.parameter && e.parameter.voter) || '';

    /* --- 투표: 같은 (voter, itemId) 는 마지막 기록만 유효 --- */
    var latest = {};
    rows_(votesSheet_()).forEach(function (r) {
      latest[r[1] + '\u0000' + r[2]] = { voter: r[1], itemId: r[2], value: Number(r[3]) };
    });
    var counts = {}, mine = [];
    Object.keys(latest).forEach(function (k) {
      var v = latest[k];
      if (v.value !== 1) return;
      counts[v.itemId] = (counts[v.itemId] || 0) + 1;
      if (v.voter === me) mine.push(v.itemId);
    });

    /* --- 경비 --- */
    var expenses = rows_(expensesSheet_())
      .filter(function (r) { return r[0]; })
      .map(function (r) {
        return { id: r[0], ts: Number(r[1]), item: r[2], amount: Number(r[3]), payer: r[4] };
      });

    /* --- 친구들이 추가한 숙소 · 맛집 --- */
    var items = [];
    rows_(itemsSheet_()).forEach(function (r) {
      if (!r[0]) return;
      try {
        var data = JSON.parse(r[3]);
        data.id = r[0];
        data.kind = r[1];
        data.added = true;
        items.push(data);
      } catch (_) {}
    });

    /* --- 일정표 같은 통짜 문서 --- */
    var docs = {};
    rows_(docsSheet_()).forEach(function (r) {
      if (!r[0]) return;
      try { docs[r[0]] = JSON.parse(r[2]); } catch (_) {}
    });

    return json_({ counts: counts, mine: mine, expenses: expenses, items: items, docs: docs });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

/* ============================================================
   쓰기
   ============================================================ */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);

    var type = (e && e.parameter && e.parameter.type) || '';
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    /* ---------- 투표 ---------- */
    if (type === 'vote') {
      if (!body.voter || !body.itemId) return json_({ error: 'voter/itemId 누락' });
      votesSheet_().appendRow([
        Date.now(), String(body.voter), String(body.itemId), Number(body.value) ? 1 : 0,
      ]);
      return json_({ ok: true });
    }

    /* ---------- 경비 ---------- */
    if (type === 'expense-add') {
      expensesSheet_().appendRow([
        String(body.id || ('e' + Date.now())),
        Number(body.ts || Date.now()),
        String(body.item || '').slice(0, 60),
        Number(body.amount || 0),
        String(body.payer || '').slice(0, 20),
      ]);
      return json_({ ok: true });
    }

    if (type === 'expense-del') {
      return deleteById_(expensesSheet_(), body.id);
    }

    /* ---------- 추가된 숙소 · 맛집 ---------- */
    if (type === 'item-add') {
      if (!body.id || !body.kind) return json_({ error: 'id/kind 누락' });
      var data = body.data || {};
      // 저장 용량이 터지지 않게 적당히 자릅니다
      var slim = JSON.stringify(data).slice(0, 4000);
      itemsSheet_().appendRow([String(body.id), String(body.kind), Date.now(), slim]);
      return json_({ ok: true });
    }

    if (type === 'item-del') {
      return deleteById_(itemsSheet_(), body.id);
    }

    /* ---------- 일정표 등 통짜 문서 ---------- */
    if (type === 'doc-set') {
      if (!body.key) return json_({ error: 'key 누락' });
      var sd = docsSheet_();
      var data2 = JSON.stringify(body.data == null ? null : body.data).slice(0, 40000);
      var rows = rows_(sd);
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === String(body.key)) {
          sd.getRange(i + 2, 2, 1, 2).setValues([[Date.now(), data2]]);
          return json_({ ok: true });
        }
      }
      sd.appendRow([String(body.key), Date.now(), data2]);
      return json_({ ok: true });
    }

    return json_({ error: '알 수 없는 type: ' + type });
  } catch (err) {
    return json_({ error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function deleteById_(sh, id) {
  var data = rows_(sh);
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sh.deleteRow(i + 2);
      break;
    }
  }
  return json_({ ok: true });
}

/* ============================================================
   링크에서 이름 · 좌표 알아내기

   브라우저는 CORS 때문에 네이버·에어비앤비 페이지를 못 읽습니다.
   여기(구글 서버)에서는 읽을 수 있어서 대신 받아와 줍니다.

   되는 것 : 네이버 지도 공유링크(naver.me), 네이버 예약, 에어비앤비
   안 되는 것: 네이버 플레이스(m.place) — 자동 접속을 막아둬서 자주 실패합니다
              이럴 땐 페이지에서 "지도에서 찍기"로 넣으면 됩니다
   ============================================================ */

var FETCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function inKorea_(lat, lng) {
  return lat > 33 && lat < 39.5 && lng > 124 && lng < 132;
}

function fetch_(url, follow) {
  return UrlFetchApp.fetch(url, {
    followRedirects: !!follow,
    muteHttpExceptions: true,
    validateHttpsCertificates: true,
    headers: {
      'User-Agent': FETCH_UA,
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
}

/* 리다이렉트 주소 자체에 좌표가 박혀 있는 경우 (naver.me 공유링크) */
function fromRedirect_(loc) {
  var lat = loc.match(/[?&]lat=(-?\d+\.\d+)/);
  var lng = loc.match(/[?&]lng=(-?\d+\.\d+)/);
  if (!lat || !lng) return null;
  var la = parseFloat(lat[1]), ln = parseFloat(lng[1]);
  if (!inKorea_(la, ln)) return null;
  var t = loc.match(/[?&]title=([^&]*)/);
  var name = '';
  if (t) { try { name = decodeURIComponent(t[1].replace(/\+/g, ' ')); } catch (_) {} }
  return { lat: la, lng: ln, name: name, source: 'naver-share' };
}

/* HTML 본문에서 찾기 */
function fromHtml_(html) {
  var pairs = [
    // 네이버 예약
    [/"posLat"\s*:\s*"?(-?\d+\.\d+)"?/, /"posLong"\s*:\s*"?(-?\d+\.\d+)"?/, 'naver-booking'],
    // 에어비앤비
    [/"lat(?:itude)?"\s*:\s*"?(-?\d+\.\d+)"?/, /"l(?:ng|ongitude)"\s*:\s*"?(-?\d+\.\d+)"?/, 'airbnb'],
    // 네이버 플레이스 (y=위도, x=경도)
    [/"y"\s*:\s*"(-?\d+\.\d+)"/, /"x"\s*:\s*"(-?\d+\.\d+)"/, 'naver-place'],
  ];

  for (var i = 0; i < pairs.length; i++) {
    var a = html.match(pairs[i][0]), b = html.match(pairs[i][1]);
    if (!a || !b) continue;
    var la = parseFloat(a[1]), ln = parseFloat(b[1]);
    if (!inKorea_(la, ln)) continue;
    return { lat: la, lng: ln, source: pairs[i][2] };
  }
  return null;
}

function nameFromHtml_(html) {
  var pats = [
    /"serviceName"\s*:\s*"([^"]{1,40})"/,
    /<meta\s+property="og:title"\s+content="([^"]{1,60})"/i,
    /<title>([^<]{1,60})<\/title>/i,
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = html.match(pats[i]);
    if (!m) continue;
    var s = m[1].replace(/\s+/g, ' ').trim();
    // 의미 없는 기본 제목은 버립니다
    if (!s || /^(네이버 플레이스|네이버 예약|Airbnb|에어비앤비)$/i.test(s)) continue;
    return s.slice(0, 40);
  }
  return '';
}

function addressFromHtml_(html) {
  var m = html.match(/"(?:roadAddress|address)"\s*:\s*"([^"]{5,90})"/);
  if (!m) return '';
  return m[1].split('(')[0].replace(/\s+/g, ' ').trim().slice(0, 60);
}

function resolveLink_(url) {
  if (!/^https?:\/\//i.test(url)) return { error: '주소 형식이 아니에요' };

  try {
    // 리다이렉트를 직접 따라가며, 중간 주소에 좌표가 있는지 봅니다
    var current = url, hops = 0, res = null;
    while (hops < 6) {
      res = fetch_(current, false);
      var code = res.getResponseCode();
      if (code < 300 || code >= 400) break;

      var h = res.getAllHeaders();
      var loc = h['Location'] || h['location'];
      if (!loc) break;
      if (loc.indexOf('http') !== 0) {
        loc = current.replace(/^(https?:\/\/[^\/]+).*$/, '$1') +
              (loc.charAt(0) === '/' ? '' : '/') + loc;
      }

      var hit = fromRedirect_(loc);
      if (hit) return hit;

      current = loc;
      hops++;
    }

    var status = res.getResponseCode();
    if (status === 429) {
      return { error: '사이트가 자동 조회를 막았어요. 지도에서 찍어주세요.' };
    }
    if (status >= 400) {
      return { error: '페이지를 열지 못했어요 (' + status + '). 지도에서 찍어주세요.' };
    }

    var html = res.getContentText();
    var pos = fromHtml_(html);
    if (!pos) {
      return { error: '이 링크에서는 위치를 못 찾았어요. 지도에서 찍어주세요.' };
    }

    pos.name = nameFromHtml_(html);
    pos.address = addressFromHtml_(html);
    return pos;

  } catch (err) {
    return { error: '조회 중 문제가 생겼어요. 지도에서 찍어주세요.' };
  }
}
