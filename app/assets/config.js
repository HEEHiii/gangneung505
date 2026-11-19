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
export const LOGIN_PROVIDER = "google";


/* ------------------------------------------------------------
   3) 사진 갤러리 (3단계) — 아직 비워두세요
      Cloudflare R2 를 쓸 때 공개 읽기 주소를 넣습니다.
      비어 있으면 갤러리 탭이 아예 숨습니다.
   ------------------------------------------------------------ */
export const R2_PUBLIC_BASE = "";


/* ============================================================
   아래는 건드리지 않아도 됩니다
   ============================================================ */

/* 로그인 버튼에 쓸 이름 — 설정과 화면 문구가 어긋나지 않게 한 곳에서 만듭니다 */
export const loginName = () =>
  ({ kakao: "카카오", google: "구글", github: "깃허브" }[LOGIN_PROVIDER] || LOGIN_PROVIDER);

/* 서버에 저장하며 친구와 합칠 수 있는 상태인가 */
export const hasBackend = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/* 지도를 띄울 수 있는 상태인가 */
export const hasMap = () => !!KAKAO_JS_KEY;

/* 사진 갤러리를 켤 수 있는 상태인가 */
export const hasGallery = () => !!R2_PUBLIC_BASE;

/* 방 링크 만들기 — /app/room.html?r=<slug>
   기존 505 사이트를 루트에 그대로 두고 새 서비스는 /app/ 아래에 있으므로,
   주소를 직접 조립하지 않고 지금 페이지 위치를 기준으로 계산합니다. */
export function roomUrl(slug) {
  const base = location.pathname.replace(/\/[^/]*$/, "/");
  return `${location.origin}${base}room.html?r=${encodeURIComponent(slug)}`;
}
