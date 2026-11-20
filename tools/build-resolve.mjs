/* ============================================================
   resolve-link 를 한 파일로 합칩니다

   실행: node tools/build-resolve.mjs

   ★ 왜 필요한가

   Supabase 대시보드의 편집기에서는 파일을 여러 개 만들기가
   번거롭습니다. 그런데 우리 코드는 safe.js(판단 부분, 테스트 대상)와
   index.ts(네트워크 부분)로 나뉘어 있습니다.

   그래서 붙여넣기용 한 파일을 "손으로 만들지 않고" 기계로 만듭니다.
   손으로 베끼면 한쪽만 고쳐져 어긋나고, 그 어긋남은 배포한 뒤에야
   드러납니다. tests/resolve.check.mjs 가 이 파일이 최신인지 봅니다.
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..",
                 "supabase", "functions", "resolve-link");

export function buildBundle() {
  const safe = readFileSync(join(DIR, "safe.js"), "utf8");
  const index = readFileSync(join(DIR, "index.ts"), "utf8");

  /* safe.js 에서 export 문만 떼어냅니다 (한 파일이면 export 가 필요 없습니다) */
  const safeBody = safe
    .replace(/^export \{[^}]*\};?\s*$/m, "")
    .replace(/^export /gm, "")
    .trimEnd();

  /* index.ts 에서 safe.js 를 불러오는 줄을 떼어냅니다 */
  const indexBody = index
    .replace(/import \{[^}]*\} from "\.\/safe\.js";\s*/s, "")
    .trimStart();

  return `/* ────────────────────────────────────────────────────────────
   ⚠️ 이 파일은 기계가 만든 것입니다. 여기를 고치지 마세요.

   고칠 곳:
     supabase/functions/resolve-link/safe.js   (판단 · 테스트 대상)
     supabase/functions/resolve-link/index.ts  (네트워크)
   고친 뒤:  node tools/build-resolve.mjs

   쓰는 법: Supabase → Edge Functions → 함수 → Code 탭에서
            전부 지우고 이 파일 내용을 붙여넣은 뒤 Deploy.
   ──────────────────────────────────────────────────────────── */

${safeBody}

${indexBody}`;
}

/* 직접 실행했을 때만 파일로 씁니다 */
if (process.argv[1] && process.argv[1].endsWith("build-resolve.mjs")) {
  const out = join(DIR, "bundled.ts");
  writeFileSync(out, buildBundle(), "utf8");
  console.log("만들었습니다:", out);
}
