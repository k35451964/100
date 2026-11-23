'use strict';
// 설정값 — 가장 먼저 불러옵니다.
//
// ⚠️ 시뮬레이션 수치(SCENARIO, HEAT_ISLAND, PHENOLOGY)는 수업의 근거가 되는 값입니다.
//    값을 바꾸면 SOURCES 의 출처 설명도 함께 고쳐 주세요. (비교 화면의 '근거 자료'에 그대로 보입니다)

// ===== 생태지도(티치타카)와 같은 Supabase =====
// publishable 키는 원래 공개용입니다. 실제 보안은 Supabase RLS 정책(supabase/100_setup.sql)이 지킵니다.
const SUPABASE_URL = 'https://friyvbyelxnrlrhktumm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_BxFfTP94V9MbhWPghvkRdw_FT1Jl-_a';
const TEACHITAKA_URL = 'https://teachitaka.kro.kr'; // 가입·비밀번호 찾기·탐사(기록)는 생태지도에서
// 카카오맵 키는 index.html 의 <script> 주소에 있습니다 (생태지도와 같은 키). 카카오 개발자 콘솔에 이 사이트 주소를 등록해야 지도가 뜸

// ===== 미래 시나리오 (고정) =====
const SCENARIO = {
    label: '2100년 무렵 · 고탄소 시나리오(SSP5-8.5)',
    short: '2100년',
    period: '2081~2100년',
    // 기후변화로 오르는 평균 기온(℃). 지금은 한반도 평균값 — 기후정보포털의 대구 북구 값으로 바꿀 예정
    dT: 7.0,
    dTNote: '한반도 평균 (대구 값 확인 예정)',
};

// 우리 동네 환경 표 (비교 화면 '우리 동네 환경'). null 이면 '자료 준비 중'으로 보입니다.
const LOCAL_CLIMATE = {
    annualTempNow: null, // 연평균 기온 지금(℃)
    hotDaysNow: null, // 폭염일수 지금(일)
    hotDaysFuture: null, // 폭염일수 미래(일)
};

// ===== 도시 열섬 =====
// 녹지가 줄어든 넓이(㎢)당 더해지는 온도(℃). 서울 25개 자치구 분석: 녹지 1㎢ 늘 때 지표면 온도 약 0.23~0.25℃ 낮아짐
const HEAT_ISLAND = { perKm2: 0.24 };

// ===== 생물 계절 =====
const PHENOLOGY = { springDaysPerC: 4.1 }; // 봄 기온 1℃ 오를 때 개화가 빨라지는 날 수

// ===== 생물 반응 (견딘 기온 범위) =====
const NICHE = {
    seasonDays: 30, // '같은 계절'로 볼 날짜 범위(±일)
    sigmaTail: 3, // 범위를 벗어났을 때 줄어드는 정도(℃)
    minRefs: 3, // 종 자체로 판단하려면 필요한 같은 계절 기록 수
    localKm: 10, // 우리 동네 기온: 반경(km)
    localDays: 15, //               ±일
};

// ===== 키워드 종류 =====
// size: S 약 1,250㎡(반지름 20m) / M 약 5,000㎡(40m) / L 약 15,000㎡(70m) — 대략적인 땅 넓이 가정
const SIZE_RADIUS = { S: 20, M: 40, L: 70 };
const SIZE_LABEL = { S: '작음 (약 1,250㎡)', M: '중간 (약 5,000㎡)', L: '큼 (약 15,000㎡)' };
const KEYWORD_CATEGORIES = {
    food: { label: '음식점·카페', emoji: '🍔', size: 'S', emission: true },
    shop: { label: '가게·편의시설', emoji: '🏪', size: 'S', emission: true },
    mall: { label: '대형 상가·마트', emoji: '🏬', size: 'L', emission: true },
    housing: { label: '아파트·주거', emoji: '🏢', size: 'L', emission: true },
    road: { label: '도로·주차장', emoji: '🅿️', size: 'M', emission: true },
    leisure: { label: '놀이·문화 시설', emoji: '🎢', size: 'M', emission: true },
    sports: { label: '운동 시설', emoji: '🏟️', size: 'M', emission: true },
    transport: { label: '교통 시설', emoji: '🚉', size: 'L', emission: true },
    factory: { label: '공장·발전소', emoji: '🏭', size: 'L', emission: true },
    public: { label: '공공·의료·교육', emoji: '🏥', size: 'M', emission: true },
    green: { label: '공원·숲·녹지', emoji: '🌳', size: 'M', emission: false },
    other: { label: '기타(시설 아님)', emoji: '💬', size: 'S', emission: false },
};

// AI를 쓸 수 없을 때 쓰는 간단한 분류 (교사가 다시 고칠 수 있음)
// 위에서부터 차례로 확인합니다. ('놀이공원'이 '공원'으로 잡히지 않도록 놀이·문화 시설을 먼저)
const KEYWORD_RULES = [
    ['leisure', /놀이공원|롯데월드|에버랜드|영화관|CGV|메가박스|볼링|워터파크|찜질방|오락실|방탈출|동물원|테마파크/],
    ['green', /공원|숲|정원|텃밭|나무|꽃밭|산책로|녹지|화단|수목원|식물원/],
    ['mall', /마트|백화점|쇼핑몰|코스트코|이마트|홈플러스|아울렛|스타필드|트레이더스|롯데몰/],
    ['housing', /아파트|주택|빌라|오피스텔|기숙사|원룸|집/],
    ['transport', /지하철|역$|터미널|공항|기차|버스정류|KTX|SRT/],
    ['road', /주차|도로|고속도로|터널|주유소|육교/],
    ['factory', /공장|발전소|물류|창고|소각장/],
    ['sports', /축구장|야구장|체육관|헬스|풋살|경기장|수영장|농구장|스케이트|골프|클라이밍/],
    ['food', /맥도날드|버거|롯데리아|맘스터치|치킨|피자|카페|스타벅스|투썸|메가커피|이디야|식당|빵|베이커리|떡볶이|분식|마라탕|탕후루|라멘|초밥|고깃집|뷔페|패스트푸드|서브웨이|KFC/i],
    ['public', /도서관|병원|약국|주민센터|우체국|경찰|소방|학교|학원|은행/],
    ['shop', /편의점|CU|GS25|세븐일레븐|다이소|올리브영|문구|PC방|피시방|노래방|코인|가게|상점|만화|무인|인생네컷|사진관|서점|아트박스/i],
];

// ===== 근거 자료 (비교 화면 '근거 자료' 카드) =====
const SOURCES = [
    {
        title: '미래 기온',
        body: `${SCENARIO.period} 고탄소 시나리오(SSP5-8.5)에서 한반도 평균 기온 +${SCENARIO.dT}℃`,
        from: '환경부·기상청 「한국 기후위기 평가보고서 2025」 (기상청 기후정보포털 국가 기후변화 표준 시나리오)',
    },
    {
        title: '생물이 견디는 기온',
        body: '티치타카 생태지도의 모든 관찰 기록(다른 학교·지역 포함)에서, 같은 계절(±30일)에 그 생물이 관찰된 날의 가장 낮은~가장 높은 평균 기온을 그 생물이 견딘 기온 범위로 봄. 미래 기온이 이 범위를 벗어나는 만큼 줄어듦',
        from: '티치타카 관찰 기록 + 기상청 지상(ASOS) 일자료 · 생태학의 열 안전 여유(thermal safety margin) 개념',
    },
    {
        title: '서식지(녹지)',
        body: '키워드 시설이 들어선 자리의 생물은 사라짐. 생물이 기록된 곳(15m 칸)을 녹지(서식지)로 보고, 시설이 덮은 비율을 녹지 감소로 계산. 시설 넓이는 종류별 대략값',
        from: '1차시 학생 키워드 + 시설 넓이 가정(작음 약 1,250㎡ / 중간 약 5,000㎡ / 큼 약 15,000㎡)',
    },
    {
        title: '도시 열섬',
        body: `줄어든 녹지 1㎢당 지표면 온도 +${HEAT_ISLAND.perKm2}℃를 더함`,
        from: '서울 25개 자치구 분석: 녹지 1㎢ 증가 시 지표면 온도 약 0.23~0.25℃ 감소 (그린피스, 2024)',
    },
    {
        title: '개화 시기',
        body: `봄 기온 1℃ 상승마다 개화 ${PHENOLOGY.springDaysPerC}일 빨라짐`,
        from: '국내 연구: 꽃 7종의 개화 시기 분석 (이화여대 연구진)',
    },
];
