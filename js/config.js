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
// 카카오맵 키는 index.html 의 <script> 주소에 있습니다 (생태지도 앱의 JavaScript 키 '기후변화', SDK 도메인: k35451964.github.io). 카카오 개발자 콘솔에 이 사이트 주소를 등록해야 지도가 뜸

// ===== 미래 시나리오 (고정) =====
const SCENARIO = {
    label: '아주 먼 미래 · 고탄소 시나리오(SSP5-8.5)',
    short: '아주 먼 미래',
    tiny: '미래', // 휴대폰처럼 좁은 화면의 [지금 | 미래] 전환 버튼
    period: '아주 먼 미래',
    years: '2081~2100년', // 실제 전망 기간 (화면 표기는 '아주 먼 미래', 근거 자료에는 이 기간을 그대로 보여 줌)
    // 기후변화로 오르는 연평균 기온(℃): 대구 북구, SSP5-8.5, 21세기 후반기(2081~2100) − 현재(2000~2019)
    // 출처: 기상청 「대구광역시 기후변화 전망보고서 2023」 표 4-4 (14.0℃ → 20.4℃)
    // 다른 학교라면 그 지역 광역시도 전망보고서의 시군구 값으로 바꾸세요. (기후정보포털 climate.go.kr)
    dT: 6.4,
    dTNote: '대구 북구, 기상청 전망',
};

// 우리 동네 환경 표 (비교 화면 '우리 동네 환경'). null 이면 '자료 준비 중'으로 보입니다.
// 출처: 기상청 「대구광역시 기후변화 전망보고서 2023」 대구 북구 (현재 2000~2019 / SSP5-8.5 2081~2100)
const LOCAL_CLIMATE = {
    annualTempNow: 14.0, // 연평균 기온 지금(℃) — 표 3-1
    hotDaysNow: 31.8, // 폭염일수 지금(일, 일 최고기온 33℃ 이상) — 표 4-36
    hotDaysFuture: 119.5, // 폭염일수 2081~2100년(일) — 표 4-36
};

// ===== 도시 열섬 =====
// 학교 둘레(반지름 radius_m)가 도심처럼 모두 건물·아스팔트로 덮이면 +fullUrbanC℃, 덮인 비율만큼 더함
// 근거: 대구기상청 — 대구 도심과 외곽의 낮 최고기온 차이 최대 3℃ (대경기후변화포럼, 2017)
const HEAT_ISLAND = { fullUrbanC: 3.0 };

// ===== 생물 계절 =====
// [미래 보기] 연출 빠르기: 1 = 기본(약 45초), 1.5 = 더 빠르게, 0.8 = 더 천천히
const PLAY_SPEED = 1;

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

// ===== 국가 기후변화 생물지표종 100종 (2024 개정) =====
// 출처: 국립생물자원관 한반도의 생물다양성 「(2024) 기후변화 생물지표 100종」 지정목록 (산천어/송어는 두 이름으로 나눔)
// [국명, 학명(속 종소명)] — 이름이나 학명이 같으면 '생물지표종'으로 표시합니다.
const CLIMATE_INDICATORS = [
    ['노루궁뎅이', 'Hericium erinaceus'],
    ['마귀광대버섯', 'Amanita pantherina'],
    ['큰갓버섯', 'Macrolepiota procera'],
    ['팽나무버섯', 'Flammulina velutipes'],
    ['황소비단그물버섯', 'Suillus bovinus'],
    ['청각', 'Codium fragile'],
    ['작은구슬산호말', 'Corallina pilulifera'],
    ['지충이', 'Sargassum thunbergii'],
    ['도깨비쇠고비', 'Cyrtomium falcatum'],
    ['발풀고사리', 'Dicranopteris linearis'],
    ['봉의꼬리', 'Pteris multifida'],
    ['실고사리', 'Lygodium japonicum'],
    ['콩짜개덩굴', 'Lemmaphyllum microphyllum'],
    ['개비자나무', 'Cephalotaxus harringtonia'],
    ['구상나무', 'Abies koreana'],
    ['개구리발톱', 'Semiaquilegia adoxoides'],
    ['개미탑', 'Haloragis micrantha'],
    ['거지덩굴', 'Cayratia japonica'],
    ['검노린재', 'Symplocos tanakana'],
    ['계요등', 'Paederia scandens'],
    ['굴거리나무', 'Daphniphyllum macropodum'],
    ['금창초', 'Ajuga decumbens'],
    ['까치밥나무', 'Ribes mandshuricum'],
    ['꿩의바람꽃', 'Anemone raddeana'],
    ['낚시제비꽃', 'Viola grypoceras'],
    ['노각나무', 'Stewartia koreana'],
    ['다정큼나무', 'Rhaphiolepis indica'],
    ['돈나무', 'Pittosporum tobira'],
    ['등대풀', 'Euphorbia helioscopia'],
    ['멀구슬나무', 'Melia azedarach'],
    ['멀꿀', 'Stauntonia hexaphylla'],
    ['보리밥나무', 'Elaeagnus macrophylla'],
    ['사람주나무', 'Neoshirakia japonica'],
    ['사스래나무', 'Betula ermanii'],
    ['사스레피나무', 'Eurya japonica'],
    ['상산', 'Orixa japonica'],
    ['송악', 'Hedera rhombea'],
    ['수리딸기', 'Rubus corchorifolius'],
    ['얼레지', 'Erythronium japonicum'],
    ['왕모시풀', 'Boehmeria pannosa'],
    ['자금우', 'Ardisia japonica'],
    ['자주괴불주머니', 'Corydalis incisa'],
    ['참배암차즈기', 'Salvia chanroenica'],
    ['참식나무', 'Neolitsea sericea'],
    ['천선과나무', 'Ficus erecta'],
    ['층꽃나무', 'Caryopteris incana'],
    ['큰앵초', 'Primula jesoana'],
    ['후박나무', 'Machilus thunbergii'],
    ['큰천남성', 'Arisaema ringens'],
    ['큰입술갈고둥', 'Nerita albicilla'],
    ['긴호랑거미', 'Argiope bruennichi'],
    ['대륙납거미', 'Uroctea lesserti'],
    ['말꼬마거미', 'Parasteatoda tepidariorum'],
    ['산왕거미', 'Araneus ventricosus'],
    ['검은큰따개비', 'Tetraclita japonica'],
    ['각시메뚜기', 'Patanga japonica'],
    ['남방노랑나비', 'Eurema mandarina'],
    ['남색이마잠자리', 'Brachydiplax chalybea'],
    ['넓적배사마귀', 'Hierodula patellifera'],
    ['대륙좀잠자리', 'Sympetrum striolatum'],
    ['말매미', 'Cryptotympana atrata'],
    ['먹그림나비', 'Dichorragia nesimachus'],
    ['무늬박이제비나비', 'Papilio helenus'],
    ['물결부전나비', 'Lampides boeticus'],
    ['방패광대노린재', 'Cantao ocellatus'],
    ['북방아시아실잠자리', 'Ischnura elegans'],
    ['뾰족부전나비', 'Curetis acuta'],
    ['사슴풍뎅이', 'Dicronocephalus adamsi'],
    ['연분홍실잠자리', 'Ceriagrion nipponicum'],
    ['좀매부리', 'Euconocephalus nasutus'],
    ['철써기', 'Mecopoda niponensis'],
    ['큰그물강도래', 'Pteronarcys sachalina'],
    ['푸른아시아실잠자리', 'Ischnura senegalensis'],
    ['푸른큰수리팔랑나비', 'Choaspes benjaminii'],
    ['금강모치', 'Rhynchocypris kumgangensis'],
    ['북방종개', 'Iksookimia pacifica'],
    ['빙어', 'Hypomesus nipponensis'],
    ['산천어', 'Oncorhynchus masou'],
    ['송어', 'Oncorhynchus masou'],
    ['연어', 'Oncorhynchus keta'],
    ['계곡산개구리', 'Rana huanrenensis'],
    ['큰산개구리', 'Rana uenoi'],
    ['한국꼬리치레도롱뇽', 'Onychodactylus koreanus'],
    ['검은이마직박구리', 'Pycnonotus sinensis'],
    ['꾀꼬리', 'Oriolus chinensis'],
    ['노랑배진박새', 'Parus venustulus'],
    ['대륙검은지빠귀', 'Turdus merula'],
    ['동박새', 'Zosterops japonicus'],
    ['되지빠귀', 'Turdus hortulorum'],
    ['붉은부리찌르레기', 'Sturnus sericeus'],
    ['뻐꾸기', 'Cuculus canorus'],
    ['산솔새', 'Phylloscopus coronatus'],
    ['소쩍새', 'Otus sunia'],
    ['쇠물닭', 'Gallinula chloropus'],
    ['쇠백로', 'Egretta garzetta'],
    ['왜가리', 'Ardea cinerea'],
    ['제비', 'Hirundo rustica'],
    ['청둥오리', 'Anas platyrhynchos'],
    ['해오라기', 'Nycticorax nycticorax'],
    ['황로', 'Bubulcus ibis'],
    ['흰날개해오라기', 'Ardeola bacchus'],
];
// ===== 새로 올 생물 후보 (남방계 기후변화 생물지표종) =====
// 학반 기록만으로는 '더 따뜻한 곳에 사는 생물'을 찾기 어려울 때(기록이 한 지역·한 계절에 몰려 있을 때) 이 목록에서 채움.
// 위 국가 기후변화 생물지표종 가운데, 주로 남부 지방에 살고 기온이 오르면 북쪽으로 퍼질 것으로 예상되는 육상 생물만 골랐음.
const SOUTHERN_CANDIDATES = [
    ['후박나무', 'Machilus thunbergii', '목본'],
    ['돈나무', 'Pittosporum tobira', '목본'],
    ['멀구슬나무', 'Melia azedarach', '목본'],
    ['사스레피나무', 'Eurya japonica', '목본'],
    ['다정큼나무', 'Rhaphiolepis indica', '목본'],
    ['참식나무', 'Neolitsea sericea', '목본'],
    ['굴거리나무', 'Daphniphyllum macropodum', '목본'],
    ['천선과나무', 'Ficus erecta', '목본'],
    ['송악', 'Hedera rhombea', '목본'],
    ['멀꿀', 'Stauntonia hexaphylla', '목본'],
    ['금창초', 'Ajuga decumbens', '초본'],
    ['거지덩굴', 'Cayratia japonica', '초본'],
    ['도깨비쇠고비', 'Cyrtomium falcatum', '초본'],
    ['남방노랑나비', 'Eurema mandarina', '곤충'],
    ['넓적배사마귀', 'Hierodula patellifera', '곤충'],
    ['무늬박이제비나비', 'Papilio helenus', '곤충'],
    ['물결부전나비', 'Lampides boeticus', '곤충'],
    ['먹그림나비', 'Dichorragia nesimachus', '곤충'],
    ['방패광대노린재', 'Cantao ocellatus', '곤충'],
    ['푸른아시아실잠자리', 'Ischnura senegalensis', '곤충'],
    ['동박새', 'Zosterops japonicus', '기타 생물'],
    ['검은이마직박구리', 'Pycnonotus sinensis', '기타 생물'],
];
const NEWCOMER_MIN = 5; // 새로 온 생물을 적어도 이만큼 보여 줌 (기록에서 찾은 종 + 위 후보)

const INDICATOR_NAMES = new Set(CLIMATE_INDICATORS.map((x) => x[0]));
const INDICATOR_SCI = new Set(CLIMATE_INDICATORS.map((x) => x[1].toLowerCase()));
function isClimateIndicator(name, sci) {
    if (INDICATOR_NAMES.has(String(name || '').trim())) return true;
    const sp = String(sci || '').trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();
    return !!sp && INDICATOR_SCI.has(sp);
}

// ===== 근거 자료 (비교 화면 '근거 자료' 카드) =====
const SOURCES = [
    {
        title: '미래 기온',
        body: `${SCENARIO.years} 고탄소 시나리오(SSP5-8.5)에서 대구 북구 연평균 기온 ${LOCAL_CLIMATE.annualTempNow.toFixed(1)}℃ → ${(LOCAL_CLIMATE.annualTempNow + SCENARIO.dT).toFixed(1)}℃ (+${SCENARIO.dT}℃), 폭염일수 ${LOCAL_CLIMATE.hotDaysNow}일 → ${LOCAL_CLIMATE.hotDaysFuture}일`,
        from: '기상청 「대구광역시 기후변화 전망보고서 2023」 (국가 기후변화 표준 시나리오, 현재 2000~2019년 대비). 참고: 같은 시나리오에서 남한 평균 +6.3℃',
    },
    {
        title: '생물이 견디는 기온',
        body: '티치타카 생태지도의 모든 관찰 기록(다른 학교·지역 포함)에서, 같은 계절(±30일)에 그 생물이 관찰된 날의 가장 낮은~가장 높은 평균 기온을 그 생물이 견딘 기온 범위로 봄. 미래 기온이 이 범위를 벗어나는 만큼 줄어듦',
        from: '티치타카 관찰 기록 + 기상청 지상(ASOS) 일자료 · 생태학의 열 안전 여유(thermal safety margin) 개념',
    },
    {
        title: '새로 온 생물',
        body: '우리 학교에는 없고, 같은 계절에 우리보다 따뜻한 날·곳에서 관찰된 생물 가운데 미래 기온에 맞는 종. 기록만으로 부족하면, 주로 남부 지방에 살고 기온이 오르면 북쪽으로 퍼질 것으로 예상되는 국가 기후변화 생물지표종에서 채움',
        from: '티치타카 관찰 기록 + 국립생물자원관 「(2024) 기후변화 생물지표 100종」',
    },
    {
        title: '서식지(녹지)',
        body: '키워드 시설이 들어선 자리의 생물은 사라짐. 생물이 기록된 곳(15m 칸)을 녹지(서식지)로 보고, 시설이 덮은 비율을 녹지 감소로 계산. 시설 넓이는 종류별 대략값',
        from: '1차시 학생 키워드 + 시설 넓이 가정(작음 약 1,250㎡ / 중간 약 5,000㎡ / 큼 약 15,000㎡)',
    },
    {
        title: '도시 열섬',
        body: `학교 둘레가 도심처럼 모두 건물·아스팔트로 덮이면 +${HEAT_ISLAND.fullUrbanC}℃로 보고, 덮인 비율만큼 기온을 더함 (예: 20% 덮이면 +${(HEAT_ISLAND.fullUrbanC * 0.2).toFixed(1)}℃)`,
        from: '대구기상청: 대구 도심과 외곽의 낮 최고기온 차이 최대 3℃ (2017 대경기후변화포럼)',
    },
    {
        title: '기후변화 생물지표종',
        body: '기후변화로 계절 활동·분포·개체 수 변화가 뚜렷하거나 뚜렷할 것으로 예상되어 정부가 조사·관리하는 100종. 우리 기록 속 지표종에 🌡️ 표시',
        from: '국립생물자원관 「(2024) 기후변화 생물지표 100종」 (한반도의 생물다양성 species.nibr.go.kr)',
    },
    {
        title: '개화 시기',
        body: `봄 기온 1℃ 상승마다 개화 ${PHENOLOGY.springDaysPerC}일 빨라짐`,
        from: '국내 연구: 꽃 7종의 개화 시기 분석 (이화여대 연구진)',
    },
];
