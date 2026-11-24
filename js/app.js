'use strict';
// 앱 시작과 화면 전환: 로그인 → 학반 고르기·참여 → 1차시(키워드) / 2차시(지도) 화면
// (마지막에 불러옵니다)

const APP = {
    api: null,
    user: null,
    profile: null,
    classrooms: [],
    cls: null, // 지금 들어온 학반 (+ isTeacher, myTeam)
    keywords: [],
    posters: [],
    data: null, // { all, records } 생태지도 기록
    future: null, // buildFuture 결과
    unsub: null,
    screen: null, // 'login' | 'lobby' | 'keywords' | 'map'
};
window.API = null;

const isTeacher = () => !!(APP.cls && APP.cls.isTeacher);

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
    // 너무 오래 걸리면 안내
    setTimeout(() => {
        const card = document.querySelector('#app .spinner + p'); // 처음 '불러오는 중' 화면이 그대로일 때만
        if (card) card.innerHTML = '오래 걸리고 있어요. 인터넷 연결을 확인하고 <a href="javascript:location.reload()">새로고침</a>해 주세요.';
    }, 15000);
    const q = new URLSearchParams(location.search);
    APP.api = window.API = q.get('demo') === '1' ? DemoAPI : LiveAPI;
    document.body.classList.toggle('demo', APP.api.mode === 'demo');
    try {
        await API.init();
    } catch (err) {
        $('app').innerHTML = `<div class="center-card"><h1>🌍 사이트를 열지 못했어요</h1><p>${esc(friendlyError(err))}</p>
            <p class="muted">서버 없이 둘러보려면 <a href="?demo=1">예시 모드</a>로 열어 보세요.</p></div>`;
        return;
    }
    APP.user = await API.currentUser();
    // 로그인 상태를 먼저 확인한 뒤에 변화를 듣습니다. (먼저 들으면 처음 알림을 '방금 로그인'으로 착각해 새로고침이 반복됨)
    API.onAuthChange((u) => {
        const was = APP.user ? APP.user.id : null;
        if ((u ? u.id : null) !== was) location.reload();
    });
    if (!APP.user) return showLogin();
    await enter();
}

async function enter() {
    try {
        APP.profile = await API.profile(APP.user);
        APP.classrooms = await API.myClassrooms(APP.user);
    } catch (err) {
        $('app').innerHTML = `<div class="center-card"><h1>문제가 생겼어요</h1><p>${esc(friendlyError(err))}</p><button class="btn" onclick="location.reload()">다시 시도</button></div>`;
        return;
    }
    const q = new URLSearchParams(location.search);
    // QR(?join=코드)로 들어오면 바로 학반에 참여
    const joinCode = q.get('join');
    if (joinCode) {
        q.delete('join');
        try {
            history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
        } catch (_) {
            /* 파일로 연 경우 */
        }
        try {
            const id = Number(await API.joinClassroom(joinCode));
            APP.classrooms = await API.myClassrooms(APP.user);
            return openClassroom(id);
        } catch (err) {
            toast(`학반 코드 ${joinCode}: ${friendlyError(err)}`, 'error');
        }
    }
    let wanted = Number(q.get('c'));
    if (!wanted) {
        try {
            wanted = Number(localStorage.getItem(`hb100_last_${APP.user.id}`));
        } catch (_) {
            wanted = 0;
        }
    }
    const found = APP.classrooms.find((c) => c.id === wanted) || (APP.classrooms.length === 1 ? APP.classrooms[0] : null);
    if (found) openClassroom(found.id);
    else showLobby();
}

// ===== 로그인 =====

function showLogin() {
    APP.screen = 'login';
    const demo = API.mode === 'demo';
    $('app').innerHTML = `
        <div class="center-card login-card">
            <div class="logo">🌍</div>
            <h1>아주 먼 미래, 우리 학교 생태지도</h1>
            <p class="muted">티치타카 AI 생태지도 계정으로 로그인해요.</p>
            ${
                demo
                    ? `<div class="demo-login">
                        <p class="demo-badge">🧪 예시 모드 — 서버 없이 이 브라우저에서만 동작해요</p>
                        <button class="btn btn-primary btn-lg" data-as="teacher">🧑‍🏫 교사로 둘러보기</button>
                        <button class="btn btn-lg" data-as="student">🙋 학생으로 둘러보기 (2조)</button>
                    </div>`
                    : `<form id="login-form" class="form">
                        <label>이메일<input type="email" name="email" required autocomplete="username"></label>
                        <label>비밀번호<input type="password" name="password" required autocomplete="current-password"></label>
                        <button class="btn btn-primary btn-lg" type="submit">로그인</button>
                        <p class="form-error" id="login-error"></p>
                    </form>
                    <p class="muted small">계정이 없거나 비밀번호를 잊었다면 <a href="${TEACHITAKA_URL}" target="_blank" rel="noopener">티치타카 생태지도</a>에서 가입·찾기를 해 주세요.</p>`
            }
        </div>`;
    if (demo) {
        $('app').querySelectorAll('[data-as]').forEach((b) => b.addEventListener('click', () => API.signIn(b.dataset.as)));
        return;
    }
    $('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const btn = f.querySelector('button');
        btn.disabled = true;
        $('login-error').textContent = '';
        try {
            await API.signIn(f.email.value.trim(), f.password.value);
        } catch (err) {
            $('login-error').textContent = friendlyError(err);
            btn.disabled = false;
        }
    });
}

async function logout() {
    if (APP.unsub) APP.unsub();
    await API.signOut();
}

// ===== 학반 고르기·참여 =====

function showLobby() {
    APP.screen = 'lobby';
    if (APP.unsub) APP.unsub();
    APP.unsub = null;
    APP.cls = null;
    const canTeach = ['teacher', 'admin'].includes(APP.profile.role);
    const list = APP.classrooms
        .map(
            (c) => `<button class="class-item" data-open="${c.id}">
                <b>🏫 ${esc(c.name)}</b>
                <span class="muted">${c.isTeacher ? `담당 교사 · 코드 ${esc(c.code)}` : c.myTeam ? `${c.myTeam}조` : '조 배정 전'} · ${c.mode === 1 ? '1차시' : '2차시'}</span>
            </button>`
        )
        .join('');
    $('app').innerHTML = `
        <div class="center-card lobby">
            <div class="lobby-head">
                <h1>안녕하세요, ${esc(APP.profile.nickname)}님 👋</h1>
                <button class="btn btn-small" id="logout-btn">로그아웃</button>
            </div>
            <form id="join-form" class="join-form">
                <label for="join-code">선생님께 받은 <b>학반 코드</b></label>
                <div class="row"><input id="join-code" maxlength="8" placeholder="예: AB12CD" autocomplete="off" required><button class="btn btn-primary" type="submit">들어가기</button></div>
                <p class="form-error" id="join-error"></p>
            </form>
            ${list ? `<h2>내 학반</h2><div class="class-list">${list}</div>` : ''}
            ${
                canTeach
                    ? `<details class="create-box" ${APP.classrooms.some((c) => c.isTeacher) ? '' : 'open'}>
                        <summary>🧑‍🏫 새 학반 만들기</summary>
                        <form id="create-form" class="form">
                            <label>학반 이름<input name="name" maxlength="40" placeholder="예: 2학년 3반" required></label>
                            <label>조 수<input name="teams" type="number" min="1" max="12" value="5" required></label>
                            <button class="btn btn-primary" type="submit">만들기</button>
                        </form>
                    </details>`
                    : ''
            }
        </div>`;
    $('logout-btn').addEventListener('click', logout);
    $('app').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openClassroom(Number(b.dataset.open))));
    $('join-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const id = await API.joinClassroom($('join-code').value);
            APP.classrooms = await API.myClassrooms(APP.user);
            openClassroom(Number(id));
        } catch (err) {
            $('join-error').textContent = friendlyError(err);
        }
    });
    const cf = $('create-form');
    if (cf)
        cf.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const c = await API.createClassroom({ name: cf.name.value.trim(), teamCount: Number(cf.teams.value) || 5 });
                APP.classrooms = await API.myClassrooms(APP.user);
                openClassroom(c.id);
                toast(`학반을 만들었어요. 학생들에게 코드 ${c.code}를 알려 주세요.`, 'ok');
            } catch (err) {
                toast(friendlyError(err), 'error');
            }
        });
}

// ===== 학반 화면 =====

async function openClassroom(id) {
    const c = APP.classrooms.find((x) => x.id === id);
    if (!c) return showLobby();
    APP.cls = c;
    APP.data = null;
    APP.future = null;
    try {
        localStorage.setItem(`hb100_last_${APP.user.id}`, String(id));
    } catch (_) {
        /* 무시 */
    }
    const q = new URLSearchParams(location.search);
    q.set('c', id);
    try {
        history.replaceState(null, '', `${location.pathname}?${q}`);
    } catch (_) {
        /* 파일로 연 경우 */
    }
    if (APP.unsub) APP.unsub();
    APP.unsub = API.subscribe(id, {
        onClassroom: () => refreshClassroom(),
        onKeywords: () => refreshKeywords(),
        onPosters: () => refreshPosters(),
        onMembers: () => refreshClassroom(), // 조 배정이 바뀌면 왼쪽 위 '○조'를 바로 바꿈
        onPredictions: () => refreshPredictions(),
    });
    // 실시간 연결이 끊겼을 때를 대비해, 조가 아직 없으면 20초마다 한 번 확인
    clearInterval(APP.teamPoll);
    APP.teamPoll = setInterval(() => {
        if (APP.cls && !APP.cls.isTeacher && !APP.cls.myTeam && !document.hidden) refreshClassroom();
    }, 20000);
    [APP.keywords, APP.posters, APP.predictions] = await Promise.all([API.keywords(id), API.posters(id), API.predictions(id)]);
    renderClassroom();
}

function renderClassroom() {
    if (!APP.cls) return;
    if (APP.cls.mode === 1) showKeywordScreen();
    else showMapScreen();
}

// 학반 설정이 바뀌면 (교사가 모드·미래 열기·결과 공개 등을 바꿈)
const refreshClassroom = debounce(async () => {
    if (!APP.cls) return;
    const before = APP.cls;
    APP.classrooms = await API.myClassrooms(APP.user);
    const now = APP.classrooms.find((c) => c.id === before.id);
    if (!now) {
        toast('학반이 없어졌어요.', 'error');
        return showLobby();
    }
    APP.cls = now;
    const futureKeys = ['center_lat', 'center_lon', 'radius_m', 'future_seed', 'source_kind', 'source_clan_id', 'date_from', 'date_to'];
    if (futureKeys.some((k) => before[k] !== now[k])) APP.data = null;
    if (futureKeys.some((k) => before[k] !== now[k]) || JSON.stringify(before.analysis) !== JSON.stringify(now.analysis)) APP.future = null;
    if (before.mode !== now.mode) return renderClassroom();
    if (!now.isTeacher && before.myTeam !== now.myTeam && now.myTeam) toast(`${now.myTeam}조로 배정됐어요!`, 'ok');
    onClassroomChanged(before, now);
}, 150);

const refreshKeywords = debounce(async () => {
    if (!APP.cls) return;
    APP.keywords = await API.keywords(APP.cls.id);
    APP.future = null;
    onKeywordsChanged();
}, 150);

const refreshPosters = debounce(async () => {
    if (!APP.cls) return;
    APP.posters = await API.posters(APP.cls.id);
    onPostersChanged();
}, 150);

const refreshPredictions = debounce(async () => {
    if (!APP.cls) return;
    APP.predictions = await API.predictions(APP.cls.id);
    if (typeof predictRefresh === 'function') predictRefresh();
}, 150);

function onClassroomChanged(before, now) {
    if (APP.screen === 'map') mapScreenClassroomChanged(before, now);
    if (typeof predictRefresh === 'function') predictRefresh();
    if (typeof galleryRefresh === 'function') galleryRefresh();
    if (typeof teacherPanelRefresh === 'function') teacherPanelRefresh();
    renderHeader();
}
function onKeywordsChanged() {
    if (APP.screen === 'keywords') renderBubbles();
    if (APP.screen === 'map') mapScreenKeywordsChanged();
    if (typeof teacherPanelRefresh === 'function') teacherPanelRefresh('keywords');
}
function onPostersChanged() {
    if (typeof galleryRefresh === 'function') galleryRefresh();
}

// 왼쪽 위: 학반·조
function headerHtml() {
    const c = APP.cls;
    const who = isTeacher() ? `🧑‍🏫 담당 교사 · 코드 <b class="code">${esc(c.code)}</b>` : c.myTeam ? `<b class="team-badge">${c.myTeam}조</b>` : '<span class="muted">조 배정 전</span>';
    return `<div class="class-card" id="class-card">
        <div class="class-name">🏫 ${esc(c.name)}</div>
        <div class="class-who">${who}</div>
        <div class="class-actions">
            ${isTeacher() ? '<button class="btn btn-small btn-primary" data-act="teacher">⚙️ 관리</button>' : ''}
            <button class="btn btn-small" data-act="lobby" title="학반 바꾸기">🏠</button>
        </div>
    </div>`;
}
function renderHeader() {
    const el = $('class-card');
    if (el) el.outerHTML = headerHtml();
    bindHeader();
}
function bindHeader() {
    const el = $('class-card');
    if (!el) return;
    el.querySelectorAll('[data-act]').forEach((b) =>
        b.addEventListener('click', () => {
            if (b.dataset.act === 'teacher') openTeacherPanel();
            if (b.dataset.act === 'lobby') showLobby();
        })
    );
}

// ===== 생태지도 기록 불러오기 =====

async function loadClassData() {
    if (APP.data) return APP.data;
    const c = APP.cls;
    const [rows, weather] = await Promise.all([API.observations(), API.weather()]);
    const wById = new Map(weather.map((w) => [w.observation_id, w]));
    const all = rows.map((r) => normalizeRecord(r, wById.get(r.id))).filter(Boolean);
    let records;
    if (c.source_kind === 'clan' && c.source_clan_id != null) {
        const ids = new Set(await API.clanMemberIds(c.source_clan_id));
        records = all.filter((r) => ids.has(r.userId));
    } else if (c.source_kind === 'area') {
        records = all;
    } else {
        const ids = new Set(await API.memberIds(c.id));
        records = all.filter((r) => ids.has(r.userId));
    }
    if (c.date_from) records = records.filter((r) => r.iso >= c.date_from);
    if (c.date_to) records = records.filter((r) => r.iso <= c.date_to);
    const center = classCenter(records);
    records = records.filter((r) => !fin(r.lat) || distMeters(r, center) <= c.radius_m);
    APP.data = { all, records, center };
    return APP.data;
}

function classCenter(records) {
    const c = APP.cls;
    if (fin(c.center_lat) && fin(c.center_lon)) return { lat: c.center_lat, lon: c.center_lon };
    const pts = (records || []).filter((r) => fin(r.lat));
    if (pts.length) return { lat: meanOf(pts.map((r) => r.lat)), lon: meanOf(pts.map((r) => r.lon)) };
    return { lat: 35.8906, lon: 128.6121 };
}

async function ensureFuture() {
    if (APP.future) return APP.future;
    const d = await loadClassData();
    APP.future = buildFuture({
        records: d.records,
        allRecords: d.all,
        keywords: APP.keywords,
        analysis: APP.cls.analysis,
        center: d.center,
        radiusM: APP.cls.radius_m,
        seed: APP.cls.future_seed,
    });
    return APP.future;
}
