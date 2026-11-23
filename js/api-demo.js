'use strict';
// 예시 모드 (주소에 ?demo=1) — 서버 없이 이 브라우저 안에서만 동작하는 가짜 데이터
// 화면을 미리 둘러보거나, 서버 설정 전에 연습할 때 씁니다. 다른 탭끼리는 실시간으로 이어집니다.
// ⚠️ 생물 기록·키워드·포스터·별점은 모두 가짜(예시)입니다.

const DemoAPI = (() => {
    const STORE_KEY = 'hb100_demo_v1';
    const USER_KEY = 'hb100_demo_user';
    const CENTER = { lat: 35.8906, lon: 128.6121 }; // 예시 캠퍼스
    const listeners = new Set();
    let channel = null;
    let state = null;
    let authCb = null;

    const TEACHER = { id: 'demo-teacher', nickname: '시연 선생님', role: 'teacher' };
    const STUDENTS = Array.from({ length: 25 }, (_, i) => ({ id: `demo-s${i + 1}`, nickname: `학생${String(i + 1).padStart(2, '0')}`, role: 'member', team: (i % 5) + 1 }));
    const ME_STUDENT = STUDENTS[6]; // 학생07 (2조)

    function rand(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seedState() {
        const r = rand(100);
        const kw = [
            ['맥도날드', 4], ['스타벅스', 3], ['PC방', 3], ['편의점', 3], ['다이소', 2], ['이마트', 2], ['노래방', 2], ['공원', 2],
            ['아파트', 1], ['영화관', 1], ['수영장', 1], ['놀이공원', 1], ['주차장', 1], ['지하철역', 1], ['마라탕', 1], ['볼링장', 1],
            ['올리브영', 1], ['탕후루', 1], ['헬스장', 1], ['기숙사', 1], ['도서관', 1], ['코인노래방', 1],
        ];
        let kid = 1;
        const keywords = [];
        kw.forEach(([text, n]) => {
            for (let i = 0; i < n; i++) keywords.push({ id: kid++, classroom_id: 1, text, created_at: new Date(Date.UTC(2026, 10, 20, 0, kid)).toISOString() });
        });
        const posterInfo = [
            ['지구지킴이', '맥도날드·이마트 같은 시설이 녹지를 덮자 곤충 기록이 크게 줄었다. 줄어든 생물은 같은 계절에 서늘한 날 관찰되던 종이 많아서, 기온이 오른 것이 원인이라고 추론했다. 해결: 학교 화단에 자생 초본 심기.'],
            ['초록발자국', '2100년에는 봄꽃이 한 달쯤 빨리 핀다. 꽃과 곤충의 만남이 어긋날 수 있다. 해결: 같은 장소를 해마다 같은 달에 기록하는 생태 모니터링.'],
            ['2100 경고단', '녹지 감소 → 열섬, 온실가스 → 기후변화. 남쪽에서만 보이던 생물이 새로 들어왔다. 해결: 학교 옥상 녹화와 대중교통 이용 캠페인.'],
            ['숲을 지켜조', '생물 종 수가 절반 넘게 줄었다. 사라진 생물 대부분은 시설 자리가 아닌 곳에서도 사라졌다 = 더위 때문. 해결: 나무 그늘 길 만들기.'],
            ['열섬 탈출', '건물과 아스팔트가 늘수록 더 뜨거워진다. 해결: 주차장 대신 잔디블록, 쿨루프.'],
        ];
        const posters = posterInfo.map(([title, description], i) => ({
            id: i + 1,
            classroom_id: 1,
            team: i + 1,
            title,
            description,
            image_url: `demo/poster-${i + 1}.png`,
            image_path: null,
            updated_at: new Date().toISOString(),
        }));
        const ratings = [];
        posters.forEach((p) => {
            STUDENTS.filter((s) => s.team !== p.team && s.id !== ME_STUDENT.id).forEach((s) => {
                if (r() < 0.75) {
                    const base = [4, 3.6, 4.2, 3.4, 3.8][p.team - 1];
                    const sc = () => Math.max(1, Math.min(5, Math.round(base + (r() - 0.5) * 2.4)));
                    ratings.push({ poster_id: p.id, rater_id: s.id, aesthetic: sc(), creativity: sc(), solving: sc() });
                }
            });
        });
        return {
            nextId: 1000,
            classrooms: [
                {
                    id: 1,
                    name: '시연용 2학년 3반',
                    code: 'DEMO23',
                    teacher_id: TEACHER.id,
                    team_count: 5,
                    mode: 1,
                    center_lat: CENTER.lat,
                    center_lon: CENTER.lon,
                    radius_m: 450,
                    source_kind: 'area',
                    source_clan_id: null,
                    date_from: null,
                    date_to: null,
                    analysis: null,
                    future_seed: 2026,
                    future_open: false,
                    results_open: false,
                    created_at: new Date().toISOString(),
                },
            ],
            members: STUDENTS.map((s) => ({ classroom_id: 1, user_id: s.id, nickname: s.nickname, team: s.team, joined_at: new Date().toISOString() })),
            keywords,
            posters,
            ratings,
        };
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            state = raw ? JSON.parse(raw) : seedState();
        } catch (_) {
            state = seedState();
        }
    }
    function save(event) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (_) {
            /* 저장 못 해도 이 탭에서는 동작 */
        }
        emit(event);
        if (channel) channel.postMessage(event);
    }
    function emit(event) {
        listeners.forEach((l) => l(event));
    }
    function me() {
        let id = null;
        try {
            id = sessionStorage.getItem(USER_KEY);
        } catch (_) {
            /* 없음 */
        }
        if (id === TEACHER.id) return TEACHER;
        return STUDENTS.find((s) => s.id === id) || null;
    }
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

    // ----- 예시 생물 기록 (캠퍼스 + 다른 지역) -----
    let recordCache = null;
    function buildRecords() {
        if (recordCache) return recordCache;
        const r = rand(20261123);
        const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
        const sites = {
            campus: { lat: CENTER.lat, lon: CENTER.lon, spread: 0.0016, temps: [0.6, 3.2, 8.4, 14.6, 19.8, 23.6, 26.4, 26.9, 22.3, 16.3, 9.3, 2.6] },
            daegu2: { lat: 35.8562, lon: 128.5584, spread: 0.002, temps: [0.6, 3.2, 8.4, 14.6, 19.8, 23.6, 26.4, 26.9, 22.3, 16.3, 9.3, 2.6] },
            ulsan: { lat: 35.5384, lon: 129.3114, spread: 0.002, temps: [2.4, 4.4, 8.6, 13.9, 18.4, 21.6, 25.3, 26.2, 22.0, 16.8, 10.6, 4.4] },
            south: { lat: 34.7604, lon: 127.6622, spread: 0.002, temps: [6.0, 7.4, 11.0, 16.0, 20.0, 23.0, 26.2, 27.4, 24.4, 19.6, 13.8, 8.2] },
            jeju: { lat: 33.2541, lon: 126.56, spread: 0.002, temps: [7.8, 8.6, 11.5, 15.6, 19.5, 22.8, 26.8, 28.0, 24.8, 20.3, 15.0, 10.1] },
        };
        // 이름, 종류, 학명, 보이는 달, 나오는 곳(c 캠퍼스·d 대구·u 울산·s 남해안·j 제주), 기록될 가능성
        const pool = [
            ['개망초', '초본', 'Erigeron annuus', [5, 6, 7, 8, 9, 10], 'cdus', 0.8], ['서양민들레', '초본', 'Taraxacum officinale', [3, 4, 5, 6, 10, 11], 'cdusj', 0.7],
            ['토끼풀', '초본', 'Trifolium repens', [5, 6, 7, 8, 9, 10], 'cdus', 0.7], ['강아지풀', '초본', 'Setaria viridis', [6, 7, 8, 9, 10, 11], 'cdus', 0.6],
            ['쑥', '초본', 'Artemisia indica', [4, 5, 6, 7, 8, 9, 10, 11], 'cdus', 0.6], ['괭이밥', '초본', 'Oxalis corniculata', [4, 5, 6, 7, 8, 9, 10, 11], 'cdu', 0.5],
            ['냉이', '초본', 'Capsella bursa-pastoris', [3, 4, 5], 'cdu', 0.6], ['큰개불알풀', '초본', 'Veronica persica', [2, 3, 4, 5], 'cdus', 0.6],
            ['애기똥풀', '초본', 'Chelidonium majus var. asiaticum', [4, 5, 6, 7], 'cd', 0.5], ['제비꽃', '초본', 'Viola mandshurica', [3, 4, 5], 'cd', 0.5],
            ['구절초', '초본', 'Chrysanthemum zawadskii var. latilobum', [9, 10, 11], 'cd', 0.4], ['미국쑥부쟁이', '초본', 'Symphyotrichum pilosum', [9, 10, 11], 'cdus', 0.5],
            ['털머위', '초본', 'Farfugium japonicum', [10, 11, 12], 'sj', 0.6], ['왕벚나무', '목본', 'Prunus × yedoensis', [3, 4, 5, 6, 10, 11], 'cdusj', 0.7],
            ['느티나무', '목본', 'Zelkova serrata', [4, 5, 6, 7, 8, 9, 10, 11], 'cdus', 0.6], ['은행나무', '목본', 'Ginkgo biloba', [4, 5, 6, 7, 8, 9, 10, 11], 'cdu', 0.7],
            ['소나무', '목본', 'Pinus densiflora', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'cdus', 0.5], ['이팝나무', '목본', 'Chionanthus retusus', [5, 6], 'cdu', 0.6],
            ['당단풍나무', '목본', 'Acer pseudosieboldianum', [4, 5, 6, 10, 11], 'cd', 0.4], ['신갈나무', '목본', 'Quercus mongolica', [4, 5, 6, 10, 11], 'cd', 0.35],
            ['개나리', '목본', 'Forsythia koreana', [3, 4, 5], 'cdu', 0.6], ['동백나무', '목본', 'Camellia japonica', [1, 2, 3, 4, 11, 12], 'usj', 0.7],
            ['후박나무', '목본', 'Machilus thunbergii', [4, 5, 6, 10, 11], 'sj', 0.6], ['팔손이', '목본', 'Fatsia japonica', [10, 11, 12], 'sj', 0.5],
            ['배추흰나비', '곤충', 'Pieris rapae', [4, 5, 6, 9, 10], 'cdus', 0.6], ['호박벌', '곤충', 'Bombus ussurensis', [5, 6, 7], 'cd', 0.4],
            ['양봉꿀벌', '곤충', 'Apis mellifera', [4, 5, 6, 7, 8, 9, 10], 'cdus', 0.6], ['칠성무당벌레', '곤충', 'Coccinella septempunctata', [4, 5, 6, 10], 'cdu', 0.5],
            ['노랑나비', '곤충', 'Colias erate', [5, 6, 9, 10], 'cdu', 0.4], ['네발나비', '곤충', 'Polygonia c-aureum', [6, 7, 9, 10, 11], 'cdu', 0.4],
            ['고추잠자리', '곤충', 'Crocothemis servilia', [7, 8, 9, 10], 'cdus', 0.5], ['왕사마귀', '곤충', 'Tenodera sinensis', [8, 9, 10, 11], 'cdu', 0.4],
            ['꽃등에', '곤충', 'Eristalis tenax', [4, 5, 6, 10, 11], 'cdus', 0.5], ['남방부전나비', '곤충', 'Zizeeria maha', [6, 7, 8, 9, 10, 11], 'usj', 0.7],
            ['먹부전나비', '곤충', 'Tongeia fischeri', [5, 6, 9, 10], 'sj', 0.5], ['남방노랑나비', '곤충', 'Eurema mandarina', [6, 7, 8, 9, 10, 11], 'sj', 0.6],
            ['무당거미', '기타 생물', 'Trichonephila clavata', [8, 9, 10, 11], 'cdus', 0.5], ['까치', '기타 생물', 'Pica serica', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'cdus', 0.5],
            ['직박구리', '기타 생물', 'Hypsipetes amaurotis', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'cdusj', 0.5], ['청설모', '기타 생물', 'Sciurus vulgaris', [3, 4, 5, 6, 9, 10, 11], 'cd', 0.35],
        ];
        const surveys = [
            ['campus', 2026, 4, 9], ['campus', 2026, 6, 4], ['campus', 2026, 6, 11], ['campus', 2026, 11, 5],
            ['daegu2', 2025, 4, 15], ['daegu2', 2025, 6, 10], ['daegu2', 2025, 11, 4],
            ['ulsan', 2025, 4, 9], ['ulsan', 2025, 5, 29], ['ulsan', 2025, 6, 19], ['ulsan', 2025, 10, 30], ['ulsan', 2026, 11, 12],
            ['south', 2025, 4, 3], ['south', 2025, 6, 11], ['south', 2025, 11, 13], ['south', 2026, 4, 16], ['south', 2026, 6, 9], ['south', 2026, 11, 4],
            ['jeju', 2025, 4, 2], ['jeju', 2025, 6, 13], ['jeju', 2025, 11, 7], ['jeju', 2026, 11, 10],
        ];
        const rows = [];
        const weather = [];
        let id = 1;
        surveys.forEach(([key, year, month, day]) => {
            const site = sites[key];
            const tavg = Math.round((site.temps[month - 1] + gauss() * 1.8) * 10) / 10;
            const tmax = Math.round((tavg + 4 + r() * 3) * 10) / 10;
            pool.forEach(([name, type, sci, months, where, prob]) => {
                if (!where.includes(key[0]) || !months.includes(month) || r() > prob) return;
                const copies = key === 'campus' ? 1 + Math.floor(r() * 4) : 1 + Math.floor(r() * 2);
                for (let c = 0; c < copies; c++) {
                    const uid = key === 'campus' ? (r() < 0.3 ? TEACHER.id : STUDENTS[Math.floor(r() * STUDENTS.length)].id) : `other-${key}`;
                    rows.push({
                        id,
                        name,
                        scientificName: sci,
                        type,
                        lat: site.lat + gauss() * site.spread,
                        lon: site.lon + gauss() * site.spread * 1.2,
                        path: null,
                        date: `${year}. ${month}. ${day}`,
                        yearMonth: `${year}-${String(month).padStart(2, '0')}`,
                        user_id: uid,
                        imageUrl: '',
                    });
                    weather.push({ observation_id: id, status: 'ok', tavg, tmax });
                    id++;
                }
            });
        });
        // 선(이동 경로)·면(군락) 예시 기록 몇 개 (캠퍼스, 2026년 6월 4일)
        const shapes = [
            ['개망초', '초본', 'area', [[0.0009, -0.0012], [0.0013, -0.0004], [0.0007, 0.0001], [0.0003, -0.0008]]],
            ['토끼풀', '초본', 'area', [[-0.0011, 0.0006], [-0.0007, 0.0013], [-0.0013, 0.0017], [-0.0017, 0.0009]]],
            ['쑥', '초본', 'area', [[-0.0004, -0.0019], [0.0, -0.0014], [-0.0005, -0.0011], [-0.0009, -0.0016]]],
            ['배추흰나비', '곤충', 'line', [[0.0002, 0.0004], [0.0006, 0.0011], [0.0004, 0.0018], [0.0009, 0.0024]]],
            ['양봉꿀벌', '곤충', 'line', [[-0.0016, -0.0006], [-0.0012, -0.0001], [-0.0014, 0.0003]]],
        ];
        shapes.forEach(([name, type, shape, pts]) => {
            const sci = (pool.find((x) => x[0] === name) || [])[2] || '';
            rows.push({
                id,
                name,
                scientificName: sci,
                type,
                lat: null,
                lon: null,
                path: { shape, coords: pts.map(([dy, dx]) => ({ lat: CENTER.lat + dy, lon: CENTER.lon + dx })) },
                date: '2026. 6. 4',
                yearMonth: '2026-06',
                user_id: TEACHER.id,
                imageUrl: '',
            });
            const camp = weather.find((w) => rows.find((r) => r.id === w.observation_id && r.date === '2026. 6. 4'));
            weather.push({ observation_id: id, status: 'ok', tavg: camp ? camp.tavg : 23.5, tmax: camp ? camp.tmax : 29 });
            id++;
        });
        recordCache = { rows, weather };
        return recordCache;
    }

    return {
        mode: 'demo',
        TEACHER,
        STUDENTS,
        ME_STUDENT,

        async init() {
            load();
            try {
                channel = new BroadcastChannel('hb100_demo');
                channel.onmessage = (e) => {
                    load();
                    emit(e.data);
                };
            } catch (_) {
                channel = null;
            }
            const q = new URLSearchParams(location.search);
            if (q.get('as') === 'teacher') sessionStorage.setItem(USER_KEY, TEACHER.id);
            if (q.get('as') === 'student') sessionStorage.setItem(USER_KEY, ME_STUDENT.id);
        },
        reset() {
            state = seedState();
            save({ table: 'all' });
        },

        async currentUser() {
            const u = me();
            return u ? { id: u.id } : null;
        },
        onAuthChange(cb) {
            authCb = cb;
        },
        async signIn(who) {
            sessionStorage.setItem(USER_KEY, who === 'student' ? ME_STUDENT.id : TEACHER.id);
            if (authCb) authCb({ id: me().id });
        },
        async signOut() {
            sessionStorage.removeItem(USER_KEY);
            if (authCb) authCb(null);
        },
        async profile(user) {
            const u = user.id === TEACHER.id ? TEACHER : STUDENTS.find((s) => s.id === user.id);
            return { id: u.id, nickname: u.nickname, role: u.role };
        },

        async myClassrooms(user) {
            await wait();
            return state.classrooms
                .filter((c) => c.teacher_id === user.id || state.members.some((m) => m.classroom_id === c.id && m.user_id === user.id))
                .map((c) => {
                    const m = state.members.find((x) => x.classroom_id === c.id && x.user_id === user.id);
                    return { ...clone(c), isTeacher: c.teacher_id === user.id, isMember: !!m, myTeam: m ? m.team : null };
                });
        },
        async joinClassroom(code) {
            await wait();
            const c = state.classrooms.find((x) => x.code === String(code).trim().toUpperCase());
            if (!c) throw new Error('invalid code');
            const u = me();
            if (!state.members.some((m) => m.classroom_id === c.id && m.user_id === u.id)) {
                state.members.push({ classroom_id: c.id, user_id: u.id, nickname: u.nickname, team: null, joined_at: new Date().toISOString() });
                save({ table: 'members', classroomId: c.id });
            }
            return c.id;
        },
        async createClassroom({ name, teamCount }) {
            const c = { ...clone(state.classrooms[0] || {}), id: state.nextId++, name, code: Math.random().toString(36).slice(2, 8).toUpperCase(), teacher_id: me().id, team_count: teamCount, mode: 1, analysis: null, future_open: false, results_open: false };
            state.classrooms.push(c);
            save({ table: 'classrooms', classroomId: c.id });
            return clone(c);
        },
        async updateClassroom(id, patch) {
            const c = state.classrooms.find((x) => x.id === id);
            Object.assign(c, clone(patch));
            save({ table: 'classrooms', classroomId: id });
            return clone(c);
        },
        async deleteClassroom(id) {
            state.classrooms = state.classrooms.filter((x) => x.id !== id);
            save({ table: 'classrooms', classroomId: id });
        },
        async members(classroomId) {
            return clone(state.members.filter((m) => m.classroom_id === classroomId));
        },
        async setTeam(classroomId, userId, team) {
            const m = state.members.find((x) => x.classroom_id === classroomId && x.user_id === userId);
            if (m) m.team = team;
            save({ table: 'members', classroomId });
        },
        async removeMember(classroomId, userId) {
            state.members = state.members.filter((x) => !(x.classroom_id === classroomId && x.user_id === userId));
            save({ table: 'members', classroomId });
        },

        async keywords(classroomId) {
            return clone(state.keywords.filter((k) => k.classroom_id === classroomId));
        },
        async addKeyword(classroomId, text) {
            state.keywords.push({ id: state.nextId++, classroom_id: classroomId, text, created_at: new Date().toISOString() });
            save({ table: 'keywords', classroomId });
        },
        async deleteKeywords(ids) {
            const set = new Set(ids);
            const cid = (state.keywords.find((k) => set.has(k.id)) || {}).classroom_id;
            state.keywords = state.keywords.filter((k) => !set.has(k.id));
            save({ table: 'keywords', classroomId: cid });
        },
        async classifyKeywords(texts) {
            await wait(900); // 예시 모드에서는 AI 대신 단어 규칙으로 분류
            return texts.map((t) => ({ keyword: t, ...classifyByRules(t), note: '예시 모드: 단어 규칙' }));
        },

        async posters(classroomId) {
            return clone(state.posters.filter((p) => p.classroom_id === classroomId));
        },
        async savePoster(classroomId, team, { title, description, file, old }) {
            let image_url = old ? old.image_url : '';
            if (file) {
                image_url = await new Promise((resolve) => {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result);
                    fr.readAsDataURL(file);
                });
            }
            let p = state.posters.find((x) => x.classroom_id === classroomId && x.team === team);
            if (!p) {
                p = { id: state.nextId++, classroom_id: classroomId, team };
                state.posters.push(p);
            }
            Object.assign(p, { title, description, image_url, image_path: null, updated_at: new Date().toISOString() });
            save({ table: 'posters', classroomId });
            return clone(p);
        },
        async deletePoster(poster) {
            state.posters = state.posters.filter((p) => p.id !== poster.id);
            state.ratings = state.ratings.filter((r) => r.poster_id !== poster.id);
            save({ table: 'posters', classroomId: poster.classroom_id });
        },
        async myRatings(posterIds) {
            const u = me();
            return clone(state.ratings.filter((r) => r.rater_id === u.id && posterIds.includes(r.poster_id)));
        },
        async rate(posterId, scores) {
            const u = me();
            const p = state.posters.find((x) => x.id === posterId);
            const c = state.classrooms.find((x) => x.id === p.classroom_id);
            const m = state.members.find((x) => x.classroom_id === c.id && x.user_id === u.id);
            if (!m || c.results_open || m.team === p.team) throw new Error('not allowed');
            const old = state.ratings.find((r) => r.poster_id === posterId && r.rater_id === u.id);
            if (old) Object.assign(old, scores);
            else state.ratings.push({ poster_id: posterId, rater_id: u.id, ...scores });
            save({ table: 'ratings', classroomId: c.id });
        },
        async results(classroomId) {
            const c = state.classrooms.find((x) => x.id === classroomId);
            const u = me();
            if (c.teacher_id !== u.id && !c.results_open) return [];
            const avg = (l, f) => (l.length ? Math.round((l.reduce((a, x) => a + f(x), 0) / l.length) * 100) / 100 : null);
            return state.posters
                .filter((p) => p.classroom_id === classroomId)
                .map((p) => {
                    const l = state.ratings.filter((r) => r.poster_id === p.id);
                    return {
                        poster_id: p.id,
                        team: p.team,
                        title: p.title,
                        raters: l.length,
                        aesthetic: avg(l, (x) => x.aesthetic),
                        creativity: avg(l, (x) => x.creativity),
                        solving: avg(l, (x) => x.solving),
                        total: avg(l, (x) => (x.aesthetic + x.creativity + x.solving) / 3),
                    };
                });
        },

        subscribe(classroomId, { onClassroom, onKeywords, onPosters }) {
            const fn = (e) => {
                if (e.table === 'all') {
                    onClassroom && onClassroom(e);
                    onKeywords && onKeywords(e);
                    onPosters && onPosters(e);
                    return;
                }
                if (e.classroomId !== classroomId) return;
                if (e.table === 'classrooms' && onClassroom) onClassroom(e);
                if (e.table === 'keywords' && onKeywords) onKeywords(e);
                if ((e.table === 'posters' || e.table === 'ratings') && onPosters) onPosters(e);
            };
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        async observations() {
            await wait(300);
            return clone(buildRecords().rows);
        },
        async weather() {
            return clone(buildRecords().weather);
        },
        async memberIds(classroomId) {
            return state.members.filter((m) => m.classroom_id === classroomId).map((m) => m.user_id);
        },
        async clans() {
            return [{ id: -1, name: '예시: 캠퍼스 생태지도' }];
        },
        async clanMemberIds() {
            return [TEACHER.id, ...STUDENTS.map((s) => s.id)];
        },
    };
})();
