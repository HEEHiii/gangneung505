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
export const KAKAO_JS_KEY = "";


/* ------------------------------------------------------------
   3) 사진 갤러리 (3단계) — 아직 비워두세요
      Cloudflare R2 를 쓸 때 공개 읽기 주소를 넣습니다.
      비어 있으면 갤러리 탭이 아예 숨습니다.
   ------------------------------------------------------------ */
export const R2_PUBLIC_BASE = "";


/* ============================================================
   아래는 건드리지 않아도 됩니다
   ============================================================ */

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
