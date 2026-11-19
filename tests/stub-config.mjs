/* ============================================================
   테스트용 config.js 갈아끼우기

   ★ 왜 필요한가

   테스트가 진짜 app/assets/config.js 를 읽으면, 사장님이 키를 넣는
   순간 테스트가 우수수 깨집니다. 진짜 고장과 "설정이 바뀐 것"을
   구분할 수 없게 되고, 그러면 테스트를 안 믿게 됩니다.

   그래서 브라우저가 config.js 를 요청할 때 가로채서, 값만 바꾼
   사본을 돌려줍니다.

   ★ 왜 사본을 "만들지" 않고 진짜 파일을 고쳐서 쓰는가

   config.js 에는 값 말고도 hasBackend() / roomUrl() 같은 함수가
   있습니다. 테스트용으로 따로 베껴 쓰면 진짜 파일이 바뀔 때 둘이
   어긋나고, 테스트는 더 이상 진짜를 검증하지 않게 됩니다.
   그래서 진짜 파일을 읽어 "값 네 줄만" 바꿉니다.
   ============================================================ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = join(HERE, "..", "app", "assets", "config.js");

/* 기본값은 "아무것도 설정 안 함" — 네트워크를 전혀 타지 않는 상태 */
const EMPTY = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  KAKAO_JS_KEY: "",
  R2_PUBLIC_BASE: "",
};

/* 서버가 있는 척할 때 쓰는 가짜 주소.
   실제로 접속되면 안 되므로, 존재하지 않는 .invalid 도메인을 씁니다
   (RFC 2606 에서 "절대 등록되지 않는다"고 못박은 이름입니다). */
export const FAKE_SUPABASE = {
  SUPABASE_URL: "https://test.supabase.invalid",
  SUPABASE_ANON_KEY: "sb_publishable_test_0000000000000000000000",
};

export function configSource(values = {}) {
  const want = { ...EMPTY, ...values };
  let src = readFileSync(REAL, "utf8");

  for (const [name, value] of Object.entries(want)) {
    const re = new RegExp(`^export const ${name} = ".*?";$`, "m");
    if (!re.test(src)) {
      throw new Error(
        `config.js 에서 ${name} 줄을 못 찾았습니다. ` +
        `파일 모양이 바뀌었다면 tests/stub-config.mjs 도 같이 고쳐야 합니다.`
      );
    }
    src = src.replace(re, `export const ${name} = ${JSON.stringify(value)};`);
  }
  return src;
}

/* 브라우저 컨텍스트 하나에 적용. page.goto 전에 불러야 합니다. */
export async function stubConfig(ctx, values = {}) {
  const body = configSource(values);
  await ctx.route("**/assets/config.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      /* 브라우저가 앞선 요청을 캐시해두면 갈아끼우기가 조용히 무시됩니다 */
      headers: { "cache-control": "no-store" },
      body,
    })
  );
}
