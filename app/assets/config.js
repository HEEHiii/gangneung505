/* ============================================================
   config.js — 사장님이 직접 채우는 유일한 파일

   ★ 여기 들어가는 값은 전부 "공개되어도 되는" 값입니다.
     브라우저가 알아야 작동하므로 숨길 수가 없고, 숨길 필요도 없습니다.
     진짜 비밀(service role key, 카카오 REST key)은 절대 넣지 마세요.

   ── 비워두면? ────────────────────────────────────────────
   아무것도 안 넣어도 페이지가 돌아갑니다.
     · SUPABASE_URL 이 비면 → "이 브라우저에만 저장" 모드
       (혼자서 전부 눌러볼 수 있지만 친구와 합쳐지지 않습니다)
     · KAKAO_JS_KEY 가 비면 → 지도 자리에 안내판
       (목록과 투표는 그대로 됩니다)
   그래서 키를 받기 전에도 화면을 만들고 눌러볼 수 있습니다.
   ============================================================ */


/* ------------------------------------------------------------
   1) Supabase — 데이터 저장소
      supabase.com 에서 프로젝트를 만들고 (지역은 Seoul 권장)
      Project Settings → API 에서 두 값을 복사해 넣으세요.

      Project Settings → "API Keys" 메뉴  (General 아님, JWT Keys 아님)

      Project URL              → SUPABASE_URL
      anon public              → SUPABASE_ANON_KEY
        또는 sb_publishable_…  → SUPABASE_ANON_KEY   (새 형식, 같은 자리)

      ⚠️ service_role / sb_secret_… 은 절대 넣지 마세요.
         모든 잠금을 무시하는 키라 누구나 전체 데이터를 지울 수 있습니다.
   ------------------------------------------------------------ */
export const SUPABASE_URL = "https://iprdjwxcqwtqvksponlg.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_wup-58Iico2mODpqWmWubQ_nR1AzQNu";


/* ------------------------------------------------------------
   2) 카카오 지도 — developers.kakao.com
      내 애플리케이션 → 앱 키 → "JavaScript 키" (REST API 키 아님!)

      ★ 같이 해야 하는 설정
        앱 설정 → 플랫폼 → Web → 사이트 도메인에 아래 둘을 모두 등록
          https://<내아이디>.github.io
          http://localhost:8080        ← 없으면 로컬 테스트가 조용히 실패
   ------------------------------------------------------------ */
export const KAKAO_JS_KEY = "e23289f2dcaab6a5e4a84be7808dadf5";


/* ------------------------------------------------------------
   2-1) 방장이 로그인할 때 쓸 서비스

   ★ 로그인하는 사람은 "방을 만드는 사람" 한 명뿐입니다.
     링크를 받은 친구들은 로그인 화면을 아예 안 봅니다.
     그래서 여기를 뭘로 두든 친구들 경험은 똑같습니다.

   ── 왜 기본이 구글인가 ──────────────────────────────────
   Supabase 의 카카오 로그인은 닉네임·프로필사진·"이메일" 세 가지를
   항상 요구하도록 고정돼 있고, 우리가 끌 수 없습니다.
   그런데 카카오에서 이메일은 비즈앱(사업자 인증)을 해야 열립니다.
   그래서 개인 개발자는 카카오 로그인이 KOE205 로 막힙니다.
     → https://github.com/supabase/supabase/issues/36878

   비즈앱 전환이 끝나면 "kakao" 로 바꾸고, 카카오 동의항목에서
   프로필 사진과 카카오계정(이메일)을 켜면 그대로 동작합니다.

   쓸 수 있는 값: "google" | "github" | "kakao"
   (Supabase → Authentication → Providers 에서 켜둔 것이어야 합니다.
    구글은 Google Cloud 에서 OAuth 클라이언트를 따로 만들어야 하고,
    깃허브는 저장소 계정만 있으면 3분이면 됩니다.)
   ------------------------------------------------------------ */
export const LOGIN_PROVIDER = "kakao";


/* ------------------------------------------------------------
   2-2) 짧은 링크 풀기 함수의 이름

   naver.me 같은 짧은 주소를 자동으로 풀어주는 Edge Function 의
   이름입니다. 안 올렸으면 그냥 두세요 — 없으면 이름 검색과
   주소 붙여넣기로 조용히 넘어갑니다.

   ★ 왜 설정으로 뺐는가
   Supabase 는 함수를 만들 때 정해진 이름(slug)을 나중에 못 바꿉니다.
   설정 화면의 Name 을 고쳐도 "slug and endpoint URL will remain the
   same" 이라고 쓰여 있듯 주소는 그대로입니다. 그래서 실수로 다른
   이름으로 만들면 함수를 지우고 다시 만들어야 하는데, 여기 한 줄을
   고치는 쪽이 훨씬 쉽습니다.

   확인하는 법: Supabase 대시보드에서 그 함수를 열었을 때
   주소창의 /functions/<여기>/details 부분이 진짜 이름입니다.
   ------------------------------------------------------------ */
export const RESOLVE_FN = "resolve-link-ts";


/* ------------------------------------------------------------
   3) 사진 갤러리

   사진은 Supabase 저장소(비공개 사진함)에 들어갑니다.
   Cloudflare 계정도, 신용카드도, 따로 넣을 열쇠도 필요 없습니다.

   ★ 공개 주소를 적는 칸이 없습니다 — 일부러입니다.

     사진함을 공개로 두면 주소를 아는 사람은 비밀번호 없이도 볼 수
     있고, 한 번 복사해 간 주소는 비밀번호를 바꿔도 계속 살아
     있습니다. 그래서 비공개로 두고, 방에 들어온 사람에게만
     "한 시간 동안만 유효한 주소"를 발급합니다.
     사진 자체는 저장소에서 바로 오므로 느려지지 않습니다.

   ★ 용량

     올릴 때 긴 변 2048px 로 줄이므로 한 장이 300~500KB 입니다.
     무료 1GB 로 2,000장쯤 되니 친구들끼리 쓰기에는 넉넉합니다.
     사람이 많아져 모자라면 그때 Cloudflare R2 로 옮기면 됩니다.

   PHOTO_FN : 사진 주소를 내주는 Edge Function 이름
              (Supabase 주소창의 /functions/<여기>/details)

   ★ 함수를 안 올렸으면 갤러리가 "이 브라우저에만 저장" 모드로
     돕니다. 혼자 눌러볼 수는 있지만 친구에게는 안 보이고
     30장까지이며, 화면에 그렇게 적힙니다.
   ------------------------------------------------------------ */
export const PHOTO_FN = "photo-upload-url-index-ts";


/* ============================================================
   아래는 건드리지 않아도 됩니다
   ============================================================ */

/* ------------------------------------------------------------
   시험용 — 주소에 ?login=kakao 를 붙인 그 한 번만 다른 수단으로

   왜 필요한가: 새 로그인(예: 카카오 비즈 앱 심사 통과)이 진짜로
   되는지는 실제로 해보기 전까지 알 수 없습니다. 그렇다고 위
   LOGIN_PROVIDER 를 바꿔서 확인하면, 안 될 경우 그동안 아무도
   방을 못 만듭니다. 그래서 기본값은 건드리지 않고 주소로만
   시험합니다.

   돌아오는 주소에는 이 값이 안 실립니다(auth.js 가 pathname 으로
   다시 만듭니다). 한 번 들어오면 세션이 남으므로 그걸로 충분합니다.

   아는 이름만 받습니다 — 오타가 Supabase 까지 가서 엉뚱한 오류로
   나타나지 않도록.
   ------------------------------------------------------------ */
const LOGIN_CHOICES = ["google", "github", "kakao"];

export function loginProvider() {
  try {
    const want = new URLSearchParams(location.search).get("login");
    if (want && LOGIN_CHOICES.includes(want)) return want;
  } catch (_) { /* location 이 없는 곳(테스트 등)에서는 기본값 */ }
  return LOGIN_PROVIDER;
}

/* 로그인 버튼에 쓸 이름 — 설정과 화면 문구가 어긋나지 않게 한 곳에서 만듭니다 */
export const loginName = () => {
  const p = loginProvider();
  return { kakao: "카카오", google: "구글", github: "깃허브" }[p] || p;
};

/* 서버에 저장하며 친구와 합칠 수 있는 상태인가 */
export const hasBackend = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/* 지도를 띄울 수 있는 상태인가 */
export const hasMap = () => !!KAKAO_JS_KEY;

/* 사진 갤러리는 설정값으로 판단하지 않습니다.
   Edge Function 에 한 번 물어보고 답으로 압니다 (store.js 참고) —
   공개 주소가 없어졌으므로 여기서 알 방법이 없고, 물어보는 쪽이
   "적어뒀는데 실제로는 안 되는" 상태를 만들지 않습니다. */

/* 방 링크 만들기 — /app/room.html?r=<slug>
   기존 505 사이트를 루트에 그대로 두고 새 서비스는 /app/ 아래에 있으므로,
   주소를 직접 조립하지 않고 지금 페이지 위치를 기준으로 계산합니다. */
export function roomUrl(slug) {
  const base = location.pathname.replace(/\/[^/]*$/, "/");
  return `${location.origin}${base}room.html?r=${encodeURIComponent(slug)}`;
}
