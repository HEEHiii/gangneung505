/* ============================================================
   RPC 계약 검증 — JS 와 SQL 이 같은 말을 하고 있는가

   실행: node tests/rpc-contract.check.mjs

   왜 필요한가:
     supa.js 가 p_voter 를 보내는데 SQL 함수가 p_voter_key 를 받으면,
     Supabase 는 "함수를 찾을 수 없다(PGRST202)"는 애매한 오류만 냅니다.
     문법 오류도 아니고 SQL 테스트에도 안 걸립니다 — 실제 사용자가
     버튼을 누르는 순간에만 터집니다.

     SQL 파일이 배포되는 실체이므로, 파일에서 직접 서명을 뽑아
     supa.js 의 RPC 표와 대조합니다.

   같이 확인하는 것:
     · 이름·인자·순서가 같은가
     · 로그인이 필요한 함수 목록(NEEDS_LOGIN)이 실제 GRANT 와 같은가
     · GRANT 를 깜빡한 함수가 없는가  ← 이게 제일 조용한 실수입니다
   ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RPC, NEEDS_LOGIN } from "../app/assets/supa.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* 마이그레이션 전부를 읽습니다. 0002 만 읽으면 나중에 추가한 함수가
   검사에서 빠져서, 계약이 어긋나도 조용히 통과합니다. */
const MIG = join(ROOT, "supabase/migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const rawSql = files.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n");

/* ★ 줄 끝 주석(-- …)을 먼저 걷어냅니다.
   서명 옆에 "p_days jsonb  -- [{day_index, ...}]" 처럼 설명을 달면
   파서가 그 안의 단어를 인자 이름으로 착각합니다. 실제로 그랬습니다.
   문자열 안의 -- 까지 지우지 않도록 따옴표 밖에서만 자릅니다. */
const stripComments = (src) => src.split("\n").map((line) => {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === "-" && line[i + 1] === "-") return line.slice(0, i);
  }
  return line;
}).join("\n");

const sql = stripComments(rawSql);
console.log("── 읽은 마이그레이션\n  " + files.join(", ") + "\n");

let fails = 0;
const ok = (cond, what) => {
  if (cond) console.log("  OK    " + what);
  else { console.log("  실패  " + what); fails++; }
};

/* ============================================================
   SQL 파일에서 public 함수 서명 뽑기
   ============================================================ */
function parseFunctions(src) {
  const out = {};
  const re = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    // 괄호 균형을 맞춰 인자 목록 끝을 찾습니다 (jsonb 기본값에 괄호가 있을 수 있음)
    let depth = 1, i = re.lastIndex;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    const inner = src.slice(re.lastIndex, i - 1);

    const params = [];
    let buf = "", d = 0, q = false;
    for (const c of inner + ",") {
      if (c === "'") q = !q;
      if (!q && c === "(") d++;
      if (!q && c === ")") d--;
      if (!q && d === 0 && c === ",") { params.push(buf); buf = ""; continue; }
      buf += c;
    }

    out[name] = params
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split(/\s+/)[0]);   // "p_token text" → "p_token"
  }
  return out;
}

/* GRANT EXECUTE 줄에서 누가 쓸 수 있는지 뽑기 */
function parseGrants(src) {
  const out = {};
  // grant execute on function public.NAME( ... ) to A, B;
  const re = /grant\s+execute\s+on\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*\n?\s*to\s+([^;]+);/gi;
  let m;
  while ((m = re.exec(src))) {
    const roles = m[3].split(",").map((r) => r.trim()).filter(Boolean).sort();
    out[m[1]] = roles;
  }
  return out;
}

const sqlFns = parseFunctions(sql);
const grants = parseGrants(sql);

console.log("── SQL 에서 찾은 함수");
console.log("  " + Object.keys(sqlFns).join(", "));
console.log("");

/* ============================================================
   1. 양쪽 목록이 같은가
   ============================================================ */
console.log("── 함수 목록");

/* ★ 브라우저가 아니라 서버 조각(Edge Function)이 부르는 함수들.

   supa.js 의 RPC 표는 "브라우저가 부르는 것" 목록입니다. 여기 것들은
   Edge Function 이 서버에서 부르므로 그 표에 없는 게 맞습니다.
   그래도 anon 에 GRANT 는 되어 있어야 합니다 — Edge Function 이
   anon 키로 부르니까요.

   이 목록에 적지 않고 그냥 넘어가게 만들면, 나중에 쓰지 않는 함수가
   열린 채 남아도 아무도 모르게 됩니다. 그래서 예외는 "여기 적은
   것만" 으로 못박습니다. */
const SERVER_ONLY = new Set(["resolve_allow"]);

const jsNames = Object.keys(RPC).sort();
const sqlNames = Object.keys(sqlFns).sort();

for (const n of jsNames) {
  ok(sqlNames.includes(n), `supa.js 의 ${n} 가 SQL 에 있음`);
}
for (const n of sqlNames) {
  if (SERVER_ONLY.has(n)) {
    ok(true, `SQL 의 ${n} 는 서버 조각 전용 (브라우저는 안 부름)`);
    continue;
  }
  ok(jsNames.includes(n), `SQL 의 ${n} 가 supa.js 에 있음`);
}

/* ============================================================
   2. 인자 이름과 순서
   ============================================================ */
console.log("── 인자 이름과 순서");
for (const n of jsNames) {
  if (!sqlFns[n]) continue;
  const a = RPC[n].join(", ");
  const b = sqlFns[n].join(", ");
  ok(a === b, `${n}(${b || "—"})${a === b ? "" : `  ← supa.js 는 (${a || "—"})`}`);
}

/* ============================================================
   3. 권한 — 로그인이 필요한 함수가 실제로 그렇게 잠겨 있는가
   ============================================================ */
console.log("── 권한");
for (const n of jsNames) {
  const roles = grants[n];
  ok(!!roles, `${n} 에 GRANT 가 있음${roles ? "" : "  ← GRANT 를 깜빡하면 아무도 못 부릅니다"}`);
  if (!roles) continue;

  const anonCanCall = roles.includes("anon");
  const shouldNeedLogin = NEEDS_LOGIN.has(n);

  if (shouldNeedLogin) {
    ok(!anonCanCall,
      `${n} 는 로그인 전용 (anon 에게 열려 있지 않음)${anonCanCall ? "  ← 누구나 부를 수 있습니다!" : ""}`);
    ok(roles.includes("authenticated"), `${n} 가 authenticated 에게 열려 있음`);
  } else {
    ok(anonCanCall,
      `${n} 는 누구나 호출 (anon 포함)${anonCanCall ? "" : "  ← 친구들이 못 씁니다"}`);
  }
}

/* GRANT 는 있는데 supa.js 가 모르는 함수 — 열어둘 생각이 없었던 것일 수 있습니다 */
console.log("── 의도하지 않은 공개");
for (const n of Object.keys(grants)) {
  if (SERVER_ONLY.has(n)) {
    ok(true, `GRANT 된 ${n} 는 서버 조각이 씁니다 (의도한 공개)`);
    continue;
  }
  ok(jsNames.includes(n),
    `GRANT 된 ${n} 가 supa.js 에도 있음${jsNames.includes(n) ? "" : "  ← 쓰지 않는데 열려 있습니다"}`);
}

/* ============================================================
   4. 스냅샷 모양 — 서버와 로컬 모드가 같은 키를 돌려주는가

   화면 코드는 두 모드를 구분하지 않습니다. 키가 어긋나면 로컬에서는
   잘 되는데 서버에서만 "undefined" 가 뜨는(또는 반대의) 버그가 됩니다.
   양쪽을 같은 목록에 못박아 둡니다.
   (로컬 쪽은 tests/store.spec.mjs 가 같은 목록으로 확인합니다)
   ============================================================ */
console.log("── 스냅샷 키");
const EXPECTED_SNAPSHOT_KEYS =
  ["comments", "counts", "expenses", "itinerary", "mine", "places", "room", "unchanged", "updated_at"];

{
  /* room_snapshot 본문에서 최상위 jsonb_build_object 의 키만 뽑습니다.

     ★ lastIndexOf 입니다. 뒤 마이그레이션이 create or replace 로 다시
       정의하면 데이터베이스는 "마지막" 것을 씁니다. 첫 번째를 읽으면
       한참 전에 바뀐 모양을 계속 맞다고 하게 됩니다 (실제로 0004 가
       expenses 를 더했는데 이 검사가 못 봤습니다). */
  const i = sql.lastIndexOf("function public.room_snapshot");
  const body = sql.slice(i, sql.indexOf("$$;", i));

  // unchanged 가 먼저 반환되는 짧은 경로도 같은 키 둘을 씁니다
  const hasShort = /jsonb_build_object\(\s*'unchanged',\s*true,\s*'updated_at'/.test(body);
  ok(hasShort, "변경 없을 때 {unchanged, updated_at} 만 돌려줌 (전송량 절약)");

  // 긴 경로: 들여쓰기 4칸(최상위) 자리의 'key' 만 모읍니다
  const long = body.slice(body.lastIndexOf("return jsonb_build_object("));
  const found = [...long.matchAll(/^\s{4}'(\w+)',/gm)].map((m) => m[1]).sort();

  const want = EXPECTED_SNAPSHOT_KEYS.join(",");
  ok(found.join(",") === want,
    `서버 스냅샷 키가 (${want})${found.join(",") === want ? "" : `  ← SQL 은 (${found.join(",")})`}`);
}

/* ============================================================
   5. app 스키마 함수가 공개되지 않았는가
   ============================================================ */
console.log("── 내부 함수 비공개");
const appGrant = /grant\s+execute\s+on\s+function\s+app\./i.test(sql);
ok(!appGrant, "app 스키마 함수에 GRANT 가 없음 (내부 전용 유지)");
ok(/revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+app/i.test(sql),
  "app 스키마 함수를 일괄 회수함");
ok(/alter\s+default\s+privileges[\s\S]{0,80}revoke\s+execute/i.test(sql),
  "앞으로 만드는 함수도 기본으로 닫아둠");

/* ============================================================
   결과
   ============================================================ */
console.log("");
if (fails === 0) console.log("전부 통과 — JS 와 SQL 이 같은 말을 합니다");
else { console.log(`실패 ${fails}건`); process.exit(1); }
