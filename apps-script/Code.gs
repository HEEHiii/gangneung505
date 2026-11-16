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
