/* ============================================================
   505 강릉여행 — 데이터 파일
   ★ 내용을 바꾸고 싶으면 이 파일만 고치면 됩니다.

   approx:true  →  좌표가 "대략"이라는 뜻. 카드와 지도에 '대략 위치'
                   배지가 붙습니다. 정확한 좌표를 넣었으면 지우세요.

   좌표 쉽게 구하는 법:
     구글 지도에서 해당 위치를 길게 누르면 37.7743, 128.9444 처럼
     숫자 두 개가 나옵니다. 앞이 lat, 뒤가 lng 입니다.
   ============================================================ */

const TRIP = {
  title : "505 강릉여행",
  start : "2027-01-23",   // 토
  end   : "2027-01-24",   // 일
  nights: 1,
  people: 4,
};

/* ───────── 숙소 후보 ───────── */
const LODGINGS = [
  {
    id: "l1",
    name: "오붓한강릉",
    url: "https://m.place.naver.com/accommodation/1523779067/room?entry=plt&businessCategory=pension&level=top&guest=4&checkin=20270123&checkout=20270124",
    lat: 37.8255, lng: 128.8560, approx: true,
    area: "사천면 방동리",
    capacity: "", price: "",
    note: "사천해변 근처. 소나무 뷰로 알려진 곳.",
  },
  {
    id: "l2",
    name: "스테이밤밤",
    url: "https://m.booking.naver.com/booking/3/bizes/1560719/items/7289621?area=plt&endDate=2027-01-24&lang=ko&startDate=2027-01-23&tab=book&theme=place",
    lat: 37.7090, lng: 128.9570, approx: true,
    area: "강동면 산성우리",
    capacity: "기준 2인 / 최대 4인", price: "",
    note: "밤나무에 둘러싸인 마당 있는 독채. 기준 인원 초과 시 1인 1박 2만원 추가.",
  },
  {
    id: "l3",
    name: "스테이감사야",
    url: "https://m.booking.naver.com/booking/3/bizes/839264/items/5036290?area=ple&endDate=2027-01-24&lang=ko&startDate=2027-01-23&tab=book&theme=place",
    lat: 37.8115, lng: 128.8720, approx: true,
    area: "하남길",
    capacity: "", price: "",
    note: "체크인 15:00 / 체크아웃 11:00.",
  },
  {
    id: "l4",
    name: "안목을높이다",
    url: "https://naver.me/5DZGIS4l",
    lat: 37.7743199, lng: 128.9444467, approx: false,
    area: "안목해변 커피거리",
    capacity: "", price: "",
    note: "안목 커피거리 바로 앞. 5곳 중 바다에 가장 가깝습니다.",
  },
  {
    id: "l5",
    name: "강릉 ease",
    url: "https://www.airbnb.co.kr/rooms/1746239649272238571?check_in=2027-01-23&check_out=2027-01-24&guests=4&adults=4",
    lat: 37.7620, lng: 128.8960, approx: true,
    area: "강릉역 인근",
    capacity: "기준 4인 / 최대 6인", price: "",
    note: "강릉역 1번 출구 도보 10분. 실내 자쿠지, 퀸 침대 2개, 짐 보관 가능.",
  },
];

/* ───────── 해변 · 관광지 ─────────
   cat: beach(해변) | sight(관광지) | hub(교통·시장)
   dist:true 를 붙이면 숙소 카드에 "여기까지 몇 km" 가 표시됩니다. */
const SPOTS = [
  { id:"s1",  name:"경포해변",        cat:"beach", lat:37.7955, lng:128.9105, dist:true },
  { id:"s2",  name:"안목해변 커피거리", cat:"beach", lat:37.7745, lng:128.9480, dist:true },
  { id:"s3",  name:"강문해변",        cat:"beach", lat:37.7886, lng:128.9199 },
  { id:"s4",  name:"사천진해변",      cat:"beach", lat:37.8308, lng:128.8752 },
  { id:"s5",  name:"주문진항",        cat:"beach", lat:37.8930, lng:128.8300 },
  { id:"s6",  name:"정동진",          cat:"beach", lat:37.6906, lng:129.0335 },
  { id:"s7",  name:"경포대",          cat:"sight", lat:37.7925, lng:128.8966 },
  { id:"s8",  name:"오죽헌",          cat:"sight", lat:37.7792, lng:128.8780 },
  { id:"s9",  name:"선교장",          cat:"sight", lat:37.7866, lng:128.8846 },
  { id:"s10", name:"초당순두부마을",   cat:"sight", lat:37.7900, lng:128.9110 },
  { id:"s11", name:"하슬라아트월드",   cat:"sight", lat:37.6983, lng:129.0286 },
  { id:"s12", name:"대관령양떼목장",   cat:"sight", lat:37.6903, lng:128.7374 },
  { id:"s13", name:"강릉역",          cat:"hub",   lat:37.7637, lng:128.8990, dist:true },
  { id:"s14", name:"강릉중앙시장",     cat:"hub",   lat:37.7540, lng:128.8964 },
  { id:"s15", name:"월화거리",        cat:"hub",   lat:37.7570, lng:128.8960 },
];

/* ───────── 맛집 · 카페 ─────────
   초안입니다. 가보고 싶은 곳을 자유롭게 추가·삭제하세요.
   좌표는 모두 대략이라 지도에서 보고 맞춰주세요. */
const FOODS = [
  { id:"f1", name:"테라로사 커피공장",  cat:"cafe", lat:37.6878, lng:128.8686, approx:true, note:"구정면. 강릉 커피의 시작점" },
  { id:"f2", name:"보헤미안 박이추커피", cat:"cafe", lat:37.8560, lng:128.8300, approx:true, note:"연곡. 핸드드립" },
  { id:"f3", name:"산토리니",          cat:"cafe", lat:37.7745, lng:128.9470, approx:true, note:"안목 커피거리 오션뷰" },
  { id:"f4", name:"초당할머니순두부",    cat:"food", lat:37.7900, lng:128.9105, approx:true, note:"초당동 순두부" },
  { id:"f5", name:"엄지네포장마차",      cat:"food", lat:37.7630, lng:128.8970, approx:true, note:"꼬막비빔밥. 웨이팅 김" },
  { id:"f6", name:"교동짬뽕",          cat:"food", lat:37.7700, lng:128.8820, approx:true, note:"강릉 짬뽕 터줏대감" },
];

const FOOD_CATS = [
  { key:"all",  label:"전부" },
  { key:"food", label:"식당" },
  { key:"cafe", label:"카페" },
];

/* ───────── 일정 ─────────
   fixed:true 는 숙소 체크인/아웃처럼 이미 정해진 것.
   나머지는 숙소가 정해지면 채워 넣으세요. */
const ITINERARY = [
  {
    date: "2027-01-23", label: "1일차", dow: "토",
    slots: [
      { time:"",      title:"강릉 도착",            note:"KTX / 자차 — 정해지면 적기" },
      { time:"15:00", title:"숙소 체크인",          note:"숙소 확정 후 확인", fixed:true },
      { time:"",      title:"저녁",                 note:"" },
      { time:"",      title:"야경 · 산책",          note:"" },
    ],
  },
  {
    date: "2027-01-24", label: "2일차", dow: "일",
    slots: [
      { time:"",      title:"아침",                 note:"" },
      { time:"11:00", title:"숙소 체크아웃",        note:"숙소 확정 후 확인", fixed:true },
      { time:"",      title:"점심",                 note:"" },
      { time:"",      title:"귀가",                 note:"" },
    ],
  },
];
