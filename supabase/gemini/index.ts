// =====================================================================
// Supabase Edge Function: gemini
//
// 브라우저 대신 이 서버 함수가 Gemini API를 부릅니다.
//   - Gemini API 키는 Supabase 비밀값(GEMINI_API_KEY)에만 있고, 사이트 코드에는 없습니다.
//   - 로그인한 사용자만, 하루 정해진 횟수(AI_DAILY_LIMIT)까지만 쓸 수 있습니다.
//   - 프롬프트도 여기 있어서, 이 함수를 아무 질문이나 하는 데 쓸 수 없습니다.
//
// 요청 (POST JSON)
//   { task: 'identify', images: [{ data: '<base64>', mimeType: 'image/jpeg' }, ...최대 3장],
//     categoryHint: '곤충'(선택), month: 11(선택), lat: 35.89, lon: 128.61(선택) }          → { text, model }
//   { task: 'features', name: '민들레' }                                              → { text, model }
//   { task: 'classify_keywords', keywords: ['맥도날드', 'PC방', ...최대 80개] }          → { text, model }
//     (기후변화 생태 수업 사이트 '100': 학생이 쓴 '학교 주변에 있으면 좋겠는 것'을 시설 종류로 분류)
//
// 비밀값 (Supabase 대시보드 → Edge Functions → Secrets)
//   GEMINI_API_KEY   (필수) Google AI Studio에서 받은 키
//   AI_DAILY_LIMIT   (선택) 1인당 하루 AI 사용 횟수, 기본 30
//   ALLOWED_ORIGINS  (선택) 쉼표로 구분한 허용 사이트 주소, 기본 https://teachitaka.kro.kr
//
// 필요한 DB 설정: supabase/ai_usage.sql (하루 사용 횟수 기록)
//               supabase/species_v6.sql (선택: 국가생물종목록. 올려 두면 아래처럼 후보를 한 번 더 확인)
//
// 국가생물종목록 확인: 동정 후보 중 목록에 없는 종이 있으면, 목록에 실린 같은 속의 종들을 알려 주고
// 한 번 더 고르게 합니다. (하루 사용 횟수는 1번만 셈. 응답에 refined: true)
// =====================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// 공개용 키 (브라우저 코드에도 있는 값). 사용자 확인 요청에만 씁니다.
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'sb_publishable_BxFfTP94V9MbhWPghvkRdw_FT1Jl-_a';
const DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') || 30);
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || 'https://teachitaka.kro.kr,http://localhost:8000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const ID_MODEL = 'gemini-2.5-pro'; // 종 동정: 정확한 모델
const FAST_MODEL = 'gemini-2.5-flash'; // 특징 작성 + 동정 모델이 실패할 때 대신
const MAX_IMAGE_BASE64 = 6 * 1024 * 1024; // 사진 한 장 약 4.5MB까지
const MAX_IMAGES = 3;
const CATEGORIES = ['초본', '목본', '곤충', '기타 생물'];

function corsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        Vary: 'Origin',
    };
}

function json(body, status, origin) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    });
}

// ---------- 프롬프트 ----------

const IDENTIFY_SCHEMA = {
    type: 'OBJECT',
    properties: {
        isLiving: { type: 'BOOLEAN' },
        candidates: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    name: { type: 'STRING' },
                    scientificName: { type: 'STRING' },
                    score: { type: 'NUMBER' },
                    reason: { type: 'STRING' },
                    category: { type: 'STRING', enum: CATEGORIES },
                    familyKo: { type: 'STRING' },
                    familyLa: { type: 'STRING' },
                    genusKo: { type: 'STRING' },
                    genusLa: { type: 'STRING' },
                },
                required: ['name', 'scientificName', 'score', 'reason', 'category', 'familyKo', 'familyLa', 'genusKo', 'genusLa'],
            },
        },
    },
    required: ['isLiving', 'candidates'],
};

// context: { categoryHint, month, lat, lon, imageCount }
function identifyPrompt(context) {
    const lines = [];
    if (context.imageCount > 1) lines.push(`- 사진 ${context.imageCount}장은 같은 개체를 여러 부분·각도에서 찍은 것이다. 모두 함께 보고 판단하라.`);
    if (context.month) lines.push(`- 관찰 시기: ${context.month}월. 이 시기에 보이는 모습(개화·결실·성충 출현 시기 등)과 맞는 종을 우선 고려하라.`);
    if (context.lat != null && context.lon != null)
        lines.push(`- 관찰 위치: 위도 ${context.lat}, 경도 ${context.lon} 부근. 이 지역에 실제로 분포하는 종을 우선 고려하라.`);
    if (CATEGORIES.includes(context.categoryHint))
        lines.push(`- 관찰자가 고른 종류: ${context.categoryHint} (참고만 하고, 사진과 다르면 무시하라).`);

    return `당신은 생태 기록 플랫폼 '네이처링(Naturing)'의 수석 생물 분류학자이다.
사진 속 생물(식물·곤충·동물·버섯 등)을 동정하라. 대한민국 생태계(자생종, 귀화종)를 우선하되, 수족관 생물이나 전 세계의 흔한 외래종·관상용 생물일 수도 있다.
${lines.length ? '\n[관찰 정보]\n' + lines.join('\n') + '\n' : ''}
[관찰 방법]
- 잎의 모양·배열·가장자리, 꽃잎 수와 색, 줄기, 열매 / 몸의 무늬·색·더듬이·다리·날개맥 등 동정에 쓰이는 형질을 먼저 꼼꼼히 확인하라.
- 사진 속 워터마크나 글씨는 무시하고 생물체에만 집중하라.

[후보 규칙]
1. 가능성이 높은 순서로 최대 3개의 후보를 제시하라. 확신이 아주 높으면 1~2개만 제시해도 된다.
2. name 은 정확한 공식 한국어 국명이다. 한국 공식 명칭이 없으면 가장 널리 쓰이는 번역명을 쓴다.
   외래어 단순 직역(예: Golden Barrel Cactus → '황금사자')은 피하고 실제 통용되는 명칭(예: '금호')을 쓴다.
3. 사진만으로 종까지 구별하기 어려우면 억지로 종을 고르지 말고 '제비꽃속', '나비목' 처럼 속·과·목 수준의 이름을 후보로 써라.
4. scientificName 은 학명이다. (속 수준이면 속명만)
5. score 는 그 후보가 정답일 확률(0~100)이다. 모든 후보의 score 합은 100을 넘지 않는다.
6. reason 은 이 사진에서 실제로 보이는 구별 포인트를 40자 이내의 평어체(~이다, ~한다)로 쓴다.
7. category 는 '초본'(풀), '목본'(나무·관목·목본 덩굴), '곤충', '기타 생물'(곤충이 아닌 동물·버섯·이끼 등) 중 하나다.
8. familyKo / familyLa 는 그 후보가 속한 과의 한국어 이름과 학명(예: 호랑나비과 / Papilionidae),
   genusKo / genusLa 는 속의 한국어 이름과 학명(예: 호랑나비속 / Papilio)이다. 모르면 빈 문자열로 둔다.
9. 장난감·조형물·그림 등 살아 있는 생물이 확실히 아니면 isLiving 을 false 로, candidates 를 빈 배열로 답하라.`;
}

function featuresPrompt(name) {
    return `'${name}'의 생물학적 관찰 특징을 모바일 도감 앱에 들어갈 수 있게 아주 간결하게 작성해 줘.

[절대 규칙]
1. 인사말, 서론, 결론 등 불필요한 텍스트는 절대 쓰지 마라.
2. 반드시 아래 [출력 템플릿]과 똑같은 형식으로 딱 3줄만 출력하라.
3. 모든 문장의 끝은 반드시 '~이다', '~한다', '~다'로 끝나는 평어체(해라체)만 사용하라. ('~요', '~습니다', '~에요' 절대 금지)
4. 각 항목은 중학생도 이해하기 쉽게 20~30자 내외로 짧고 명확하게 요약하라.
5. '${name}'이(가) 실제 생물 이름이 아니면 세 줄 모두 '정보를 찾을 수 없다.'로 채워라.

[출력 템플릿]
- 형태: (형태 요약)
- 서식지: (서식지 요약)
- 특징: (특징 요약)

[올바른 출력 예시]
- 형태: 잎은 넓은 달걀 모양이고 가장자리에 톱니가 있다.
- 서식지: 주로 햇볕이 잘 드는 산기슭이나 들판에서 자란다.
- 특징: 봄에 노란색 꽃이 피며 곤충들이 많이 모여든다.`;
}

// ---------- 키워드 분류 (수업 사이트 100) ----------
// 종류마다 사이트에서 정한 크기(넓이)와 영향이 있습니다. AI는 종류와 크기 조정만 고르고, 교사가 확인·수정합니다.

const KEYWORD_CATEGORIES = ['food', 'shop', 'mall', 'housing', 'road', 'leisure', 'sports', 'transport', 'factory', 'public', 'green', 'other'];
const KEYWORD_SCHEMA = {
    type: 'OBJECT',
    properties: {
        items: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    keyword: { type: 'STRING' },
                    category: { type: 'STRING', enum: KEYWORD_CATEGORIES },
                    size: { type: 'STRING', enum: ['S', 'M', 'L'] },
                    emission: { type: 'BOOLEAN' },
                    note: { type: 'STRING' },
                },
                required: ['keyword', 'category', 'size', 'emission', 'note'],
            },
        },
    },
    required: ['items'],
};

function keywordPrompt(keywords) {
    return `고등학생들이 "우리 학교 주변에 있으면 좋겠는 것"을 자유롭게 적었다. 각 항목이 학교 주변에 실제로 생긴다면 어떤 시설인지 분류하라.

[종류(category)]
- food: 음식점·카페·패스트푸드 (예: 맥도날드, 스타벅스, 떡볶이집)
- shop: 작은 가게·편의시설 (예: 편의점, 다이소, PC방, 노래방, 문구점, 학원)
- mall: 대형 상가·마트·백화점·쇼핑몰
- housing: 아파트·주택·기숙사·오피스텔
- road: 도로·주차장·주유소
- leisure: 놀이·문화 시설 (예: 놀이공원, 영화관, 워터파크, 찜질방, 볼링장)
- sports: 운동 시설 (예: 축구장, 체육관, 수영장, 헬스장)
- transport: 교통 시설 (예: 지하철역, 버스터미널, 기차역, 공항)
- factory: 공장·발전소·물류창고
- public: 공공·의료·교육 시설 (예: 도서관, 병원, 주민센터)
- green: 공원·숲·정원·텃밭·나무처럼 녹지를 늘리는 것
- other: 시설이 아니거나 분류하기 어려운 것 (예: 사람, 기분, 날씨)

[크기(size)] 그 시설이 보통 차지하는 땅 넓이
- S: 작은 건물 하나 (약 1,000㎡ 안팎, 예: 편의점, 카페, 패스트푸드점)
- M: 큰 건물이나 넓은 시설 (약 5,000㎡ 안팎, 예: 체육관, 영화관, 주차장)
- L: 아주 넓은 단지 (약 15,000㎡ 이상, 예: 아파트 단지, 대형마트, 놀이공원, 역)

[emission] 그 시설이 운영되며 자동차 통행·냉난방·전력으로 온실가스를 눈에 띄게 많이 내면 true (green, other 는 false)
[note] 분류 이유를 15자 이내로 쓴다.

[규칙]
- keyword 는 입력과 똑같이 쓴다. 입력 순서대로, 빠짐없이 답한다.
- 장난·욕설·의미 없는 글은 other 로 분류하고 note 에 '분류 어려움'이라고 쓴다.

[입력]
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}`;
}

// ---------- Gemini 호출 (모델을 차례로 시도) ----------

async function callGemini(models, body) {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY 비밀값이 설정되지 않았습니다.');
    let lastError = 'AI 응답 없음';
    for (const model of models) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify(body),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                lastError = `${model}: ${res.status} ${data?.error?.message || ''}`;
                continue;
            }
            const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
            if (text) return { text, model };
            lastError = `${model}: 빈 응답`;
        } catch (err) {
            lastError = `${model}: ${err?.message || err}`;
        }
    }
    throw new Error(lastError);
}

// ---------- 국가생물종목록으로 후보 확인 (species_v6.sql) ----------

const LIST_PER_GENUS = 40; // 속마다 알려 줄 종 수

// 학명 → 비교용 열쇠 (사이트의 js/species.js 와 같은 규칙)
function speciesKeys(scientificName) {
    const words = String(scientificName || '')
        .replace(/[()[\]]/g, ' ')
        .replace(/×\s*/g, '')
        .trim()
        .split(/\s+/);
    const genus = (words[0] || '').toLowerCase();
    const epithet = words[1] || '';
    if (!/^[a-z][a-z-]+$/.test(genus)) return { genus: '', sp: '' };
    return { genus, sp: /^[a-z][a-z-]+$/.test(epithet) ? `${genus} ${epithet}` : '' };
}

// 종목록은 누구나 읽을 수 있으므로 공개용 키로 읽습니다.
async function listSelect(query) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/species_list?${query}`, { headers: { apikey: PUBLIC_KEY } });
    if (!res.ok) throw new Error(`species_list ${res.status}`);
    return await res.json();
}
const inValues = (values) => encodeURIComponent(`(${values.map((v) => `"${String(v).replace(/["\\]/g, '')}"`).join(',')})`);

function refinePrompt(candidates, unlisted, listText) {
    return `

[국가생물종목록 확인]
당신은 처음에 아래 후보를 냈다.
${candidates.map((c) => `- ${c.name} (${c.scientificName}) ${c.score}%`).join('\n')}
이 중 다음 후보는 대한민국 국가생물종목록(국립생물자원관)에 없다.
${unlisted.map((c) => `- ${c.name} (${c.scientificName})`).join('\n')}

아래는 국가생물종목록에 실린, 후보와 같은 속의 종이다. (국명 / 학명)
${listText}

사진을 다시 꼼꼼히 보고 최종 후보를 다시 제시하라.
- 사진과 맞는 종이 위 목록에 있으면 목록의 국명과 학명을 그대로 써라.
- 목록에 없는 외래종·원예종·수입종이 확실하면 그 후보를 그대로 두어도 된다.
- 목록의 종들과 사진을 구별할 수 없으면 속 수준 이름을 써도 된다.
- 나머지 규칙은 위와 같다.`;
}

// 동정 결과를 종목록과 비교해, 목록에 없는 종이 있으면 같은 속의 목록 종을 알려 주고 다시 고르게 합니다.
// 반환: 다시 고른 { text, model } 또는 null (그대로 쓰기)
async function refineWithSpeciesList(first, geminiBody) {
    let parsed;
    try {
        parsed = JSON.parse(first.text);
    } catch (_) {
        return null;
    }
    const candidates = (Array.isArray(parsed?.candidates) ? parsed.candidates : []).filter((c) => c && c.name).slice(0, 3);
    if (!parsed.isLiving || !candidates.length) return null;
    try {
        const keys = candidates.map((c) => speciesKeys(c.scientificName || c.genusLa));
        const sps = [...new Set(keys.map((k) => k.sp).filter(Boolean))];
        const names = [...new Set(candidates.map((c) => String(c.name).trim()).filter(Boolean))];
        const [bySp, byName] = await Promise.all([
            sps.length ? listSelect(`select=sp_key&sp_key=in.${inValues(sps)}&limit=100`) : [],
            names.length ? listSelect(`select=ko_name&ko_name=in.${inValues(names)}&limit=100`) : [],
        ]);
        const spSet = new Set(bySp.map((r) => r.sp_key));
        const nameSet = new Set(byName.map((r) => r.ko_name));
        // 종 수준 후보인데 학명도 국명도 목록에 없는 것
        const unlisted = candidates.filter((c, i) => keys[i].sp && !spSet.has(keys[i].sp) && !nameSet.has(String(c.name).trim()));
        if (!unlisted.length) return null;

        const genera = [...new Set(keys.map((k) => k.genus).filter(Boolean))].slice(0, 3);
        if (!genera.length) return null;
        const or = encodeURIComponent(`(${genera.map((g) => `sp_key.like."${g} *"`).join(',')})`);
        const rows = await listSelect(`select=ko_name,sci_name,sp_key&or=${or}&order=ko_name&limit=400`);
        const listText = genera
            .map((g) => {
                const inGenus = rows.filter((r) => r.sp_key.startsWith(g + ' ') && r.ko_name).slice(0, LIST_PER_GENUS);
                if (!inGenus.length) return '';
                return `[${g[0].toUpperCase()}${g.slice(1)}]\n` + inGenus.map((r) => `- ${r.ko_name} / ${r.sci_name}`).join('\n');
            })
            .filter(Boolean)
            .join('\n');
        if (!listText) return null; // 같은 속의 목록 종이 없으면 그대로 (외래 속일 수 있음)

        const parts = geminiBody.contents[0].parts;
        const body = {
            ...geminiBody,
            contents: [{ parts: [{ text: parts[0].text + refinePrompt(candidates, unlisted, listText) }, ...parts.slice(1)] }],
        };
        const second = await callGemini([...new Set([first.model, FAST_MODEL])], body);
        const again = JSON.parse(second.text);
        if (!again || !Array.isArray(again.candidates) || !again.candidates.length) return null;
        return second;
    } catch (err) {
        console.warn('종목록 확인 건너뜀:', err?.message || err);
        return null;
    }
}

// ---------- 로그인 확인 + 하루 사용 횟수 차감 ----------
// 사용자의 로그인 토큰으로 DB 함수 use_ai_quota 를 부릅니다.
// (로그인하지 않았으면 DB가 거절하므로 로그인 확인도 함께 됩니다)
async function useQuota(authHeader) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/use_ai_quota`, {
        method: 'POST',
        headers: { apikey: PUBLIC_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_limit: DAILY_LIMIT }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const msg = String(data?.message || '');
        if (res.status === 401 || res.status === 403 || msg.includes('login required') || msg.includes('JWT')) {
            return { ok: false, status: 401, error: '로그인이 필요해요.' };
        }
        return { ok: false, status: 500, error: '사용 횟수를 확인하지 못했어요. (ai_usage.sql 실행 여부 확인)' };
    }
    if (Number(data) < 0) return { ok: false, status: 429, error: `오늘 AI 사용 횟수(${DAILY_LIMIT}회)를 모두 썼어요.` };
    return { ok: true, remaining: Number(data) };
}

// ---------- 요청 처리 ----------

export async function handler(req) {
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

    // 브라우저에서 온 요청이면 허용한 사이트에서 온 것만 받습니다.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: '허용되지 않은 사이트입니다.' }, 403, origin);

    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: '로그인이 필요해요.' }, 401, origin);

    let payload;
    try {
        payload = await req.json();
    } catch (_) {
        return json({ error: '요청 형식이 올바르지 않아요.' }, 400, origin);
    }

    let geminiBody;
    let models;
    if (payload?.task === 'identify') {
        // 사진 목록 (예전 형식 { image, mimeType } 도 받음)
        const rawImages = Array.isArray(payload.images)
            ? payload.images
            : payload.image
              ? [{ data: payload.image, mimeType: payload.mimeType }]
              : [];
        const images = rawImages.slice(0, MAX_IMAGES).map((img) => ({
            data: String(img?.data || ''),
            mimeType: String(img?.mimeType || 'image/jpeg'),
        }));
        if (!images.length) return json({ error: '사진이 없어요.' }, 400, origin);
        for (const img of images) {
            if (!img.data || img.data.length > MAX_IMAGE_BASE64) return json({ error: '사진이 없거나 너무 커요.' }, 400, origin);
            if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(img.mimeType)) return json({ error: '지원하지 않는 사진 형식이에요.' }, 400, origin);
        }
        const month = Number(payload.month);
        const lat = Number(payload.lat);
        const lon = Number(payload.lon);
        const hasLocation = payload.lat != null && payload.lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
        const context = {
            imageCount: images.length,
            categoryHint: String(payload.categoryHint || payload.category || ''),
            month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
            lat: hasLocation ? Math.round(lat * 100) / 100 : null, // 약 1km 단위로만
            lon: hasLocation ? Math.round(lon * 100) / 100 : null,
        };
        geminiBody = {
            contents: [
                {
                    parts: [
                        { text: identifyPrompt(context) },
                        ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
                    ],
                },
            ],
            generationConfig: { temperature: 0.0, responseMimeType: 'application/json', responseSchema: IDENTIFY_SCHEMA },
        };
        models = [ID_MODEL, FAST_MODEL];
    } else if (payload?.task === 'features') {
        const name = String(payload.name || '').trim();
        if (!name || name.length > 40) return json({ error: '생물 이름을 확인해 주세요.' }, 400, origin);
        geminiBody = { contents: [{ parts: [{ text: featuresPrompt(name) }] }] };
        models = [FAST_MODEL];
    } else if (payload?.task === 'classify_keywords') {
        const keywords = (Array.isArray(payload.keywords) ? payload.keywords : [])
            .map((k) => String(k || '').trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 80);
        if (!keywords.length) return json({ error: '분류할 키워드가 없어요.' }, 400, origin);
        geminiBody = {
            contents: [{ parts: [{ text: keywordPrompt(keywords) }] }],
            generationConfig: { temperature: 0.0, responseMimeType: 'application/json', responseSchema: KEYWORD_SCHEMA },
        };
        models = [FAST_MODEL];
    } else {
        return json({ error: '알 수 없는 작업이에요.' }, 400, origin);
    }

    const quota = await useQuota(authHeader);
    if (!quota.ok) return json({ error: quota.error }, quota.status, origin);

    try {
        const result = await callGemini(models, geminiBody);
        if (payload.task === 'identify') {
            const refined = await refineWithSpeciesList(result, geminiBody);
            if (refined) return json({ ...refined, refined: true, remaining: quota.remaining }, 200, origin);
        }
        return json({ ...result, remaining: quota.remaining }, 200, origin);
    } catch (err) {
        console.error('Gemini 실패:', err?.message || err);
        return json({ error: 'AI 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.' }, 502, origin);
    }
}

Deno.serve(handler);
