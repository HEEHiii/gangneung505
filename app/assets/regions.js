/* ============================================================
   지역 목록

   ★ 지역을 추가하려면 이 파일에 한 줄만 넣으면 됩니다.
     큐레이션 관광지 파일(pois/<code>.json)은 없어도 됩니다 —
     없으면 카카오 지도에서 관광명소를 실시간으로 찾아 채웁니다.

   각 항목의 뜻:
     code      파일 이름과 주소에 쓰는 영문 키 (바꾸면 기존 방이 깨집니다)
     name      사람에게 보이는 이름
     center    지도가 처음 열리는 위치 [위도, 경도]
               — 대략이면 됩니다. 정확한 장소 좌표가 아니라 "화면 중심"입니다
     level     카카오 지도 확대 단계. 1이 가장 가깝고 14가 가장 멉니다
               (Leaflet 과 반대 방향입니다)
     bbox      장소를 검색할 범위 [[남서위도, 남서경도], [북동위도, 북동경도]]
               — 이 안에서만 찾으므로 "같은 이름 다른 도시"가 섞이지 않습니다
     hubQuery  출발·귀가 지점을 찾을 검색어 (예: "강릉역")
               ★ 좌표를 적지 않는 이유: 방을 만들 때 카카오에서 이 이름으로
                 찾아 좌표를 가져옵니다. 손으로 적은 좌표가 틀릴 일이 없고,
                 역이 이전해도 저절로 맞습니다. 못 찾으면 그냥 비워두고
                 일정은 숙소부터 시작합니다.
   ============================================================ */

export const REGIONS = [
  /* ───────── 강원 ───────── */
  { code: "gangneung",  name: "강릉",   center: [37.7519, 128.8761], level: 8,
    bbox: [[37.66, 128.72], [37.92, 129.06]], hubQuery: "강릉역" },
  { code: "sokcho",     name: "속초",   center: [38.2070, 128.5918], level: 8,
    bbox: [[38.13, 128.47], [38.29, 128.68]], hubQuery: "속초고속버스터미널" },
  { code: "yangyang",   name: "양양",   center: [38.0754, 128.6190], level: 9,
    bbox: [[37.95, 128.46], [38.19, 128.74]], hubQuery: "양양국제공항" },
  { code: "chuncheon",  name: "춘천",   center: [37.8813, 127.7300], level: 9,
    bbox: [[37.77, 127.58], [37.99, 127.88]], hubQuery: "춘천역" },
  { code: "gapyeong",   name: "가평",   center: [37.8315, 127.5105], level: 9,
    bbox: [[37.70, 127.33], [37.95, 127.68]], hubQuery: "가평역" },
  { code: "pyeongchang", name: "평창",  center: [37.5200, 128.4500], level: 10,
    bbox: [[37.24, 128.23], [37.73, 128.72]], hubQuery: "진부역" },

  /* ───────── 제주 ───────── */
  { code: "jeju",       name: "제주",   center: [33.3800, 126.5500], level: 11,
    bbox: [[33.17, 126.13], [33.58, 126.99]], hubQuery: "제주국제공항" },

  /* ───────── 경상 ───────── */
  { code: "busan",      name: "부산",   center: [35.1600, 129.0600], level: 9,
    bbox: [[35.04, 128.86], [35.30, 129.25]], hubQuery: "부산역" },
  { code: "gyeongju",   name: "경주",   center: [35.8400, 129.2100], level: 9,
    bbox: [[35.70, 129.05], [35.98, 129.42]], hubQuery: "경주역" },
  { code: "tongyeong",  name: "통영",   center: [34.8544, 128.4331], level: 9,
    bbox: [[34.72, 128.29], [34.95, 128.58]], hubQuery: "통영종합버스터미널" },
  { code: "geoje",      name: "거제",   center: [34.8806, 128.6211], level: 9,
    bbox: [[34.72, 128.48], [35.02, 128.78]], hubQuery: "고현버스터미널" },
  { code: "namhae",     name: "남해",   center: [34.8376, 127.8923], level: 9,
    bbox: [[34.70, 127.73], [34.97, 128.07]], hubQuery: "남해공용터미널" },
  { code: "pohang",     name: "포항",   center: [36.0190, 129.3435], level: 9,
    bbox: [[35.90, 129.20], [36.16, 129.49]], hubQuery: "포항역" },
  { code: "andong",     name: "안동",   center: [36.5684, 128.7294], level: 9,
    bbox: [[36.44, 128.55], [36.70, 128.92]], hubQuery: "안동역" },

  /* ───────── 전라 ───────── */
  { code: "yeosu",      name: "여수",   center: [34.7604, 127.6622], level: 9,
    bbox: [[34.63, 127.52], [34.87, 127.82]], hubQuery: "여수엑스포역" },
  { code: "suncheon",   name: "순천",   center: [34.9506, 127.4873], level: 9,
    bbox: [[34.84, 127.33], [35.08, 127.65]], hubQuery: "순천역" },
  { code: "jeonju",     name: "전주",   center: [35.8242, 127.1480], level: 8,
    bbox: [[35.74, 127.02], [35.92, 127.27]], hubQuery: "전주역" },
  { code: "gunsan",     name: "군산",   center: [35.9676, 126.7368], level: 9,
    bbox: [[35.86, 126.58], [36.08, 126.89]], hubQuery: "군산역" },

  /* ───────── 충청 · 수도권 ───────── */
  { code: "taean",      name: "태안",   center: [36.7456, 126.2980], level: 10,
    bbox: [[36.56, 126.11], [36.95, 126.45]], hubQuery: "태안버스터미널" },
  { code: "ganghwa",    name: "강화",   center: [37.7470, 126.4878], level: 10,
    bbox: [[37.57, 126.29], [37.92, 126.63]], hubQuery: "강화버스터미널" },
];

/* 코드로 지역 찾기. 없는 코드면 null — 호출하는 쪽에서 "직접 검색"으로 만든
   방이라는 뜻이므로, 방에 저장된 center/bbox 를 그대로 쓰면 됩니다. */
export function regionByCode(code) {
  if (!code) return null;
  return REGIONS.find((r) => r.code === code) || null;
}

/* 날짜로 계절 테마 기본값을 고릅니다.
   3~5월 봄 / 6~8월 여름 / 9~11월 가을 / 12~2월 겨울.
   사용자가 바꿀 수 있고, 이건 처음 제안값일 뿐입니다. */
export function seasonFor(dateStr) {
  const m = Number(String(dateStr || "").slice(5, 7));
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  if (m === 12 || m === 1 || m === 2) return "winter";
  return "summer";
}

export const THEMES = [
  { key: "spring", label: "봄" },
  { key: "summer", label: "여름" },
  { key: "autumn", label: "가을" },
  { key: "winter", label: "겨울" },
];
