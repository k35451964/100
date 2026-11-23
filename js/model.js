'use strict';
// 미래 생태지도 계산 (화면과 상관없는 순수 계산)
//
// 1차시 키워드 → 시설로 바꿔 학교 주변에 배치 → 세 가지 원인을 차례로 적용합니다.
//   ① 서식지 상실: 시설이 들어선 자리의 생물은 사라짐
//   ② 도시 열섬: 녹지가 건물·아스팔트로 바뀐 넓이만큼 온도가 더 오름 (HEAT_ISLAND)
//   ③ 기후변화: 고정 시나리오만큼 기온이 오름 (SCENARIO)
// 그다음 남은 생물마다 '견딘 기온 범위'(같은 계절에 관찰된 날의 가장 낮은~높은 평균 기온)를
// 미래 기온과 비교해 살아남을지 정합니다. 같은 학반이면 언제 계산해도 결과가 같습니다(future_seed).

const DAY_MS = 86400000;
const CELL_M = 15; // 서식지(녹지) 칸 크기
const RATIO_CAP = 3;
const LOST_AT = 0.3; // 이보다 작으면 사라짐
const DOWN_AT = 0.85; // 이 이하면 일부 사라짐
const UP_AT = 1.15;
const MAX_NEW_SPECIES = 8;

// ===== 날짜 =====

function doyOf(y, m, d) {
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY_MS) + 1;
}
function parseObsDate(text, yearMonth) {
    let m = String(text || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) {
        const ym = String(yearMonth || '').match(/(\d{4})\D+(\d{1,2})/);
        if (!ym) return null;
        m = [null, ym[1], ym[2], '15'];
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
    return { year, month, day, doy: Math.min(365, doyOf(year, month, day)), iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
function doyToMonthDay(doy) {
    const t = new Date(Date.UTC(2025, 0, 1) + (Math.round(doy) - 1) * DAY_MS);
    return { month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}
function formatDoy(doy) {
    const { month, day } = doyToMonthDay(doy);
    return `${month}월 ${day}일`;
}
function doyDist(a, b) {
    const d = Math.abs(a - b) % 365;
    return Math.min(d, 365 - d);
}

// ===== 공용 =====

const isNum = Number.isFinite;
const hasLoc = (r) => isNum(r.lat) && isNum(r.lon);
const hasTemp = (r) => isNum(r.tavg);

function toNum(v) {
    if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v);
    return isNum(n) ? n : NaN;
}
function distMeters(a, b) {
    const lat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
    return Math.hypot((b.lon - a.lon) * Math.cos(lat) * 111320, (b.lat - a.lat) * 110540);
}
function meanOf(values) {
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
}
function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const i = (sorted.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
// 정해진 씨앗으로 늘 같은 순서의 난수
function seededRandom(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hash01(seed, key) {
    let h = (seed ^ 0x9e3779b9) >>> 0;
    const s = String(key);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return seededRandom(h)();
}

// ===== 생태지도 기록 정리 =====

const LEGACY_TYPES = { 나무: '목본', 꽃: '초본', 풀: '초본', 미정: '정보 부족' };
const PLACEHOLDER_NAMES = ['정보 부족', '임시 기록'];
const RECORD_TYPES = ['목본', '초본', '곤충', '기타 생물'];

// 생태지도 기록 한 줄(+날씨) → 시뮬레이션용 기록. 이름이 정해지지 않은 기록은 null
function normalizeRecord(row, weather) {
    const type = LEGACY_TYPES[row.type] || row.type;
    const name = String(row.name || '').trim();
    if (!name || PLACEHOLDER_NAMES.includes(name) || !RECORD_TYPES.includes(type)) return null;
    const date = parseObsDate(row.date, row.yearMonth);
    if (!date) return null;
    let lat = toNum(row.lat);
    let lon = toNum(row.lon);
    if (!isNum(lat) || !isNum(lon)) {
        const pts = (row.path && Array.isArray(row.path.coords) ? row.path.coords : [])
            .map((c) => ({ lat: toNum(c.lat), lon: toNum(c.lon) }))
            .filter(hasLoc);
        lat = pts.length ? meanOf(pts.map((p) => p.lat)) : NaN;
        lon = pts.length ? meanOf(pts.map((p) => p.lon)) : NaN;
    }
    const w = weather && weather.status === 'ok' ? weather : null;
    return {
        id: row.id,
        name,
        sci: String(row.scientificName || '').trim(),
        type,
        lat,
        lon,
        year: date.year,
        doy: date.doy,
        iso: date.iso,
        userId: row.user_id || null,
        imageUrl: row.imageUrl || '',
        tavg: w ? toNum(w.tavg) : NaN,
        tmax: w ? toNum(w.tmax) : NaN,
    };
}

// ===== 키워드 =====

function keywordKey(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, '').trim();
}

function classifyByRules(text) {
    const t = String(text || '');
    const hit = KEYWORD_RULES.find(([, re]) => re.test(t));
    const category = hit ? hit[0] : 'other';
    return { category, size: KEYWORD_CATEGORIES[category].size, emission: KEYWORD_CATEGORIES[category].emission, note: hit ? '단어로 분류' : '분류 어려움', by: 'rule' };
}

// 같은 키워드끼리 묶기 (띄어쓰기·대소문자 무시) → [{ key, text, count }] 많은 순
function groupKeywords(keywords) {
    const map = new Map();
    keywords.forEach((k) => {
        const key = keywordKey(k.text);
        if (!key) return;
        if (!map.has(key)) map.set(key, { key, text: String(k.text).trim(), count: 0, ids: [] });
        const g = map.get(key);
        g.count++;
        g.ids.push(k.id);
    });
    return [...map.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'ko'));
}

// 묶은 키워드 + 분류 결과(교사 확인본) → 시설 목록 재료
function keywordItems(groups, analysis) {
    const saved = (analysis && analysis.items) || {};
    return groups.map((g) => {
        const a = saved[g.key] || classifyByRules(g.text);
        const cat = KEYWORD_CATEGORIES[a.category] ? a.category : 'other';
        return {
            key: g.key,
            text: g.text,
            count: g.count,
            category: cat,
            size: SIZE_RADIUS[a.size] ? a.size : KEYWORD_CATEGORIES[cat].size,
            emission: cat === 'green' || cat === 'other' ? false : a.emission !== false,
        };
    });
}

// ===== 지도 좌표 (학교 가운데 기준 m) =====

function makeProjection(center) {
    const k = Math.cos((center.lat * Math.PI) / 180) * 111320;
    return {
        toXY: (p) => ({ x: (p.lon - center.lon) * k, y: (p.lat - center.lat) * 110540 }),
        toLatLon: (x, y) => ({ lat: center.lat + y / 110540, lon: center.lon + x / k }),
    };
}

// ===== 시설 배치 =====
// 큰 시설부터, 생물이 기록된 곳(녹지) 가운데 학교에 가까운 곳을 우선으로 겹치지 않게 놓습니다.
function placeFacilities(items, habitatPts, center, radiusM, rng) {
    const proj = makeProjection(center);
    const placed = [];
    const list = items
        .filter((it) => it.category !== 'other')
        .map((it) => ({ ...it, radius: SIZE_RADIUS[it.size] * Math.min(1.6, 1 + 0.15 * (it.count - 1)) }))
        .sort((a, b) => b.radius - a.radius || b.count - a.count);
    const candidates = habitatPts
        .map((p) => ({ ...p, w: rng() * (0.4 + Math.hypot(p.x, p.y) / radiusM) }))
        .sort((a, b) => a.w - b.w);
    const free = (x, y, r, slack) => placed.every((f) => Math.hypot(f.x - x, f.y - y) >= (f.radius + r) * slack);
    list.forEach((it) => {
        let spot = null;
        for (const slack of [1, 0.75, 0.5]) {
            spot = candidates.find((c) => Math.hypot(c.x, c.y) + it.radius * 0.3 <= radiusM && free(c.x, c.y, it.radius, slack));
            if (spot) break;
            for (let i = 0; i < 80 && !spot; i++) {
                const ang = rng() * Math.PI * 2;
                const dist = Math.sqrt(rng()) * Math.max(10, radiusM - it.radius);
                const x = Math.cos(ang) * dist;
                const y = Math.sin(ang) * dist;
                if (free(x, y, it.radius, slack)) spot = { x, y };
            }
            if (spot) break;
        }
        if (!spot) {
            const ang = rng() * Math.PI * 2;
            const dist = Math.sqrt(rng()) * radiusM;
            spot = { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
        }
        placed.push({ ...it, x: spot.x, y: spot.y, ...proj.toLatLon(spot.x, spot.y) });
    });
    return placed;
}

// 여러 원이 덮는 넓이(㎡) — 5m 칸으로 셈
function unionArea(circles) {
    const cells = new Set();
    const step = 5;
    circles.forEach((c) => {
        for (let x = Math.floor((c.x - c.radius) / step); x <= Math.ceil((c.x + c.radius) / step); x++) {
            for (let y = Math.floor((c.y - c.radius) / step); y <= Math.ceil((c.y + c.radius) / step); y++) {
                if (Math.hypot(x * step - c.x, y * step - c.y) <= c.radius) cells.add(`${x},${y}`);
            }
        }
    });
    return cells.size * step * step;
}

// ===== 생물이 견디는 기온 =====

function buildTempGrid(records) {
    const grid = new Map();
    records.forEach((r) => {
        if (!hasLoc(r) || !hasTemp(r)) return;
        const key = `${Math.floor(r.lat * 10)},${Math.floor(r.lon * 10)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(r);
    });
    return grid;
}
// 이 위치·날짜 주변(10km, ±15일) 관찰일의 평균 기온 = 우리 동네의 그 계절 기온
function localTempAt(grid, lat, lon, doy) {
    const cy = Math.floor(lat * 10);
    const cx = Math.floor(lon * 10);
    const vals = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            (grid.get(`${cy + dy},${cx + dx}`) || []).forEach((r) => {
                if (doyDist(r.doy, doy) <= NICHE.localDays && distMeters(r, { lat, lon }) <= NICHE.localKm * 1000) vals.push(r.tavg);
            });
        }
    }
    return vals.length ? meanOf(vals) : NaN;
}
// 같은 계절(±seasonDays)에 관찰된 날들의 기온 → 견딘 범위 { lo, hi, n, days }
function nicheAt(list, doy, trim = false) {
    const vals = [];
    const days = new Set();
    for (const r of list) {
        if (doyDist(r.doy, doy) > NICHE.seasonDays) continue;
        vals.push(r.tavg);
        days.add(r.year * 1000 + r.doy);
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    return {
        lo: trim ? quantile(vals, 0.05) : vals[0],
        hi: trim ? quantile(vals, 0.95) : vals[vals.length - 1],
        n: vals.length,
        days: days.size,
    };
}
const nicheOk = (n) => n && n.n >= NICHE.minRefs && n.days >= 2;
function suitability(t, niche) {
    const d = t < niche.lo ? niche.lo - t : t > niche.hi ? t - niche.hi : 0;
    return Math.exp(-(d * d) / (2 * NICHE.sigmaTail * NICHE.sigmaTail));
}
function suitabilityRatio(T, dT, niche) {
    return Math.min(RATIO_CAP, suitability(T + dT, niche) / Math.max(suitability(T, niche), 1e-6));
}

// ===== 미래 생태지도 만들기 =====
// input: { records(지금, 학반 기록), allRecords(생태지도 전체: 견딘 기온의 근거), keywords, analysis,
//          center, radiusM, seed }
function buildFuture(input) {
    const rng = seededRandom(input.seed || 1);
    const located = input.records.filter(hasLoc);
    const center = input.center && hasLoc(input.center) ? input.center : located.length ? { lat: meanOf(located.map((r) => r.lat)), lon: meanOf(located.map((r) => r.lon)) } : { lat: 35.8906, lon: 128.6121 };
    const radiusM = input.radiusM || 500;
    const proj = makeProjection(center);
    const study = input.records.filter((r) => !hasLoc(r) || distMeters(r, center) <= radiusM * 1.5);

    // ① 시설 배치와 서식지 상실
    const groups = groupKeywords(input.keywords || []);
    const items = keywordItems(groups, input.analysis);
    const habitatPts = [];
    const cellSet = new Set();
    study.forEach((r) => {
        if (!hasLoc(r)) return;
        const p = proj.toXY(r);
        const key = `${Math.floor(p.x / CELL_M)},${Math.floor(p.y / CELL_M)}`;
        if (!cellSet.has(key)) {
            cellSet.add(key);
            habitatPts.push({ x: (Math.floor(p.x / CELL_M) + 0.5) * CELL_M, y: (Math.floor(p.y / CELL_M) + 0.5) * CELL_M });
        }
    });
    const facilities = placeFacilities(items, habitatPts, center, radiusM, rng);
    const built = facilities.filter((f) => f.category !== 'green');
    const greens = facilities.filter((f) => f.category === 'green');
    const insideBuilt = (x, y) => built.some((f) => Math.hypot(f.x - x, f.y - y) <= f.radius);
    const lostCells = habitatPts.filter((c) => insideBuilt(c.x, c.y)).length;
    const builtArea = unionArea(built);
    const greenArea = unionArea(greens);
    const circleArea = Math.PI * radiusM * radiusM;

    // ② 열섬, ③ 기후변화
    const heatIsland = (Math.max(0, builtArea - greenArea) / 1e6) * HEAT_ISLAND.perKm2;
    const dT = SCENARIO.dT + heatIsland;

    // 남은 생물의 반응
    const all = input.allRecords && input.allRecords.length ? input.allRecords : input.records;
    const bySpecies = new Map();
    const byType = new Map();
    all.forEach((r) => {
        if (!hasTemp(r)) return;
        if (!bySpecies.has(r.name)) bySpecies.set(r.name, []);
        bySpecies.get(r.name).push(r);
        if (!byType.has(r.type)) byType.set(r.type, []);
        byType.get(r.type).push(r);
    });
    const grid = buildTempGrid(all);
    const seed = input.seed || 1;

    const fates = study.map((r) => {
        if (hasLoc(r)) {
            const p = proj.toXY(r);
            if (insideBuilt(p.x, p.y)) return { rec: r, fate: 'habitat' };
        }
        let T = hasLoc(r) ? localTempAt(grid, r.lat, r.lon, r.doy) : NaN;
        if (!isNum(T) && hasTemp(r)) T = r.tavg;
        if (!isNum(T)) return { rec: r, fate: 'unknown' };
        let niche = nicheAt(bySpecies.get(r.name) || [], r.doy);
        let fromGroup = false;
        if (!nicheOk(niche)) {
            niche = nicheAt(byType.get(r.type) || [], r.doy, true);
            fromGroup = true;
            if (!nicheOk(niche)) return { rec: r, fate: 'unknown', T };
        }
        const ratio = suitabilityRatio(T, dT, niche);
        let fate = 'ok';
        if (ratio < LOST_AT) fate = 'heat';
        else if (ratio <= DOWN_AT) fate = hash01(seed, r.id) < 1 - ratio ? 'heat' : 'weak';
        else if (ratio >= UP_AT) fate = 'up';
        return { rec: r, fate, T, niche, ratio, fromGroup };
    });

    const newcomers = findNewcomers(study, all, bySpecies, grid, dT, center, radiusM, habitatPts, built, proj, rng);
    return summarize({ center, radiusM, facilities, items, groups, fates, newcomers, dT, heatIsland, builtArea, greenArea, circleArea, lostCells, habitatCells: habitatPts.length });
}

// 우리 학교에는 없고, 같은 계절에 우리보다 따뜻한 날·곳에서만 관찰된 종 가운데 미래 기온이 그 범위에 드는 종
function findNewcomers(study, all, bySpecies, grid, dT, center, radiusM, habitatPts, built, proj, rng) {
    const here = new Set(study.map((r) => r.name));
    const months = new Map();
    study.forEach((r) => {
        if (!hasLoc(r)) return;
        const T = localTempAt(grid, r.lat, r.lon, r.doy);
        if (!isNum(T)) return;
        const m = doyToMonthDay(r.doy).month;
        if (!months.has(m)) months.set(m, { T: [], doy: [] });
        months.get(m).T.push(T);
        months.get(m).doy.push(r.doy);
    });
    const monthList = [...months.entries()].map(([month, v]) => ({ month, T: meanOf(v.T), doy: Math.round(meanOf(v.doy)) }));
    const out = [];
    bySpecies.forEach((list, name) => {
        if (here.has(name) || list.length < NICHE.minRefs) return;
        let best = null;
        monthList.forEach((m) => {
            const niche = nicheAt(list, m.doy);
            if (!nicheOk(niche) || !(niche.lo > m.T)) return;
            const now = suitability(m.T, niche);
            const fut = suitability(m.T + dT, niche);
            if (fut >= 0.8 && (!best || fut - now > best.gain)) best = { month: m.month, T: m.T, lo: niche.lo, hi: niche.hi, refs: niche.n, gain: fut - now };
        });
        if (best) {
            const sample = list.find((r) => r.imageUrl) || list[0];
            out.push({ name, type: sample.type, sci: sample.sci, imageUrl: sample.imageUrl || '', ...best });
        }
    });
    out.sort((a, b) => b.gain - a.gain || b.refs - a.refs);
    const free = habitatPts.filter((c) => !built.some((f) => Math.hypot(f.x - c.x, f.y - c.y) <= f.radius + 10));
    return out.slice(0, MAX_NEW_SPECIES).map((s, i) => {
        const spot = free.length ? free[Math.floor(rng() * free.length)] : { x: (rng() - 0.5) * radiusM, y: (rng() - 0.5) * radiusM };
        const pos = proj.toLatLon(spot.x + (rng() - 0.5) * 12, spot.y + (rng() - 0.5) * 12);
        return { ...s, id: `new-${i}`, ...pos, isNew: true };
    });
}

function summarize(ctx) {
    const { fates, newcomers } = ctx;
    const speciesMap = new Map();
    fates.forEach((f) => {
        const r = f.rec;
        if (!speciesMap.has(r.name)) speciesMap.set(r.name, { name: r.name, type: r.type, sci: r.sci, imageUrl: '', now: 0, future: 0, fates: {}, lo: NaN, hi: NaN, fromGroup: false, firstDoy: 999 });
        const s = speciesMap.get(r.name);
        s.now++;
        if (!s.imageUrl && r.imageUrl) s.imageUrl = r.imageUrl;
        if (!s.sci && r.sci) s.sci = r.sci;
        s.fates[f.fate] = (s.fates[f.fate] || 0) + 1;
        if (f.fate !== 'habitat' && f.fate !== 'heat') s.future++;
        if (f.niche && !isNum(s.lo)) {
            s.lo = f.niche.lo;
            s.hi = f.niche.hi;
            s.fromGroup = f.fromGroup;
        }
        if (r.doy < s.firstDoy) s.firstDoy = r.doy;
    });
    const species = [...speciesMap.values()];
    species.forEach((s) => {
        s.status = s.future === 0 ? 'gone' : s.future < s.now ? 'declined' : 'survived';
    });
    const types = RECORD_TYPES.map((type) => {
        const list = species.filter((s) => s.type === type);
        const newOfType = newcomers.filter((n) => n.type === type).length;
        return {
            type,
            speciesNow: list.length,
            speciesFuture: list.filter((s) => s.future > 0).length + newOfType,
            recordsNow: list.reduce((a, s) => a + s.now, 0),
            recordsFuture: list.reduce((a, s) => a + s.future, 0) + newOfType,
        };
    });
    const springShift = -PHENOLOGY.springDaysPerC * ctx.dT;
    const phenology = species
        .filter((s) => s.future > 0 && s.firstDoy <= 150 && (s.type === '목본' || s.type === '초본'))
        .sort((a, b) => a.firstDoy - b.firstDoy)
        .slice(0, 12)
        .map((s) => ({ name: s.name, type: s.type, now: s.firstDoy, future: Math.max(1, Math.round(s.firstDoy + springShift)) }));
    const built = ctx.facilities.filter((f) => f.category !== 'green');
    const emitters = built.filter((f) => f.emission).length;
    const greenLossPct = ctx.habitatCells ? (100 * ctx.lostCells) / ctx.habitatCells : 0;
    const imperviousPct = (100 * ctx.builtArea) / ctx.circleArea;

    // 알림: 생태계를 바꾼 요인들 (제목 없이 하나씩)
    const alerts = [];
    if (built.length) alerts.push({ icon: '🌳', text: '학교 주변 녹지', value: `−${Math.round(greenLossPct)}%` });
    if (built.length) alerts.push({ icon: '🏗️', text: '건물·아스팔트로 덮인 땅', value: `+${imperviousPct.toFixed(1)}%p` });
    if (built.length) alerts.push({ icon: '🔥', text: '도시 열섬 (지표면 온도)', value: `+${ctx.heatIsland.toFixed(2)}℃` });
    if (emitters) alerts.push({ icon: '🏭', text: '온실가스를 내는 시설', value: `${emitters}곳` });
    alerts.push({ icon: '🌍', text: '전 세계 온실가스 배출', value: '계속 많이' });

    return {
        center: ctx.center,
        radiusM: ctx.radiusM,
        facilities: ctx.facilities,
        keywordGroups: ctx.groups,
        fates,
        newcomers,
        species,
        types,
        phenology,
        springShift,
        alerts,
        env: {
            dTClimate: SCENARIO.dT,
            heatIsland: ctx.heatIsland,
            dT: ctx.dT,
            greenLossPct,
            imperviousPct,
            builtAreaM2: ctx.builtArea,
            greenAreaM2: ctx.greenArea,
            facilities: built.length,
            greenFacilities: ctx.facilities.length - built.length,
            emitters,
        },
        counts: {
            speciesNow: species.length,
            speciesFuture: species.filter((s) => s.future > 0).length + newcomers.length,
            recordsNow: fates.length,
            recordsFuture: fates.filter((f) => f.fate !== 'habitat' && f.fate !== 'heat').length + newcomers.length,
            gone: species.filter((s) => s.status === 'gone').length,
            declined: species.filter((s) => s.status === 'declined').length,
            survived: species.filter((s) => s.status === 'survived').length,
            newcomers: newcomers.length,
            lostHabitat: fates.filter((f) => f.fate === 'habitat').length,
            lostHeat: fates.filter((f) => f.fate === 'heat').length,
        },
    };
}

if (typeof module !== 'undefined') {
    module.exports = { parseObsDate, normalizeRecord, groupKeywords, keywordItems, classifyByRules, buildFuture, formatDoy };
}
