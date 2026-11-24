'use strict';
// 1차시: "우리 학교 주변에 무엇이 있으면 좋겠나요?" 키워드 화면
// 익명으로 여러 개 쓸 수 있고, 쓰는 대로 교사·학생 화면에 동그라미로 뜹니다. (같은 말이 많을수록 큰 동그라미)

const BUBBLE_COLORS = ['#2563eb', '#0891b2', '#4f46e5', '#0ea5e9', '#1d4ed8', '#0d9488', '#6366f1', '#3b82f6'];
let kwMap = null;

function showKeywordScreen() {
    APP.screen = 'keywords';
    const teacher = isTeacher();
    $('app').innerHTML = `
        <div class="screen kw-screen">
            <div class="kw-bg" id="kw-bg"></div>
            <div class="hud-tl">${headerHtml()}</div>
            ${
                teacher
                    ? `<div class="hud-tr join-code-card">
                        <button type="button" class="qr-mini" id="qr-mini" title="QR 크게 보기">${qrSvg(joinUrl(APP.cls.code))}</button>
                        <div class="join-code-text">참여 코드<b>${esc(APP.cls.code)}</b><span class="muted small" id="kw-count"></span></div>
                        <button type="button" class="btn btn-small btn-green" id="btn-today">🗺️ 오늘의 생태지도</button>
                    </div>`
                    : ''
            }
            <h1 class="kw-question">우리 학교 주변에 <span>무엇이 있으면 좋겠나요?</span></h1>
            <div class="kw-cloud" id="kw-cloud" aria-live="polite"></div>
            <div class="kw-bottom">
                <form class="kw-input" id="kw-form" autocomplete="off">
                    <input id="kw-text" maxlength="30" placeholder="예: 맥도날드, 영화관, 수영장…" aria-label="키워드 입력">
                    <button class="btn btn-primary btn-lg" type="submit">올리기</button>
                </form>
                <div class="kw-foot">
                    <span>🙈 이름 없이 올라가요 · 여러 개 써도 돼요</span>
                    <a class="btn btn-small btn-green" href="${TEACHITAKA_URL}" target="_blank" rel="noopener">🌿 생태지도로 탐사하러 가기</a>
                </div>
            </div>
        </div>`;
    bindHeader();
    $('kw-form').addEventListener('submit', submitKeyword);
    if (teacher) {
        $('qr-mini').addEventListener('click', openJoinQr);
        fillQrWhenReady('qr-mini', APP.cls.code);
        $('btn-today').addEventListener('click', openTodayMap);
    }
    renderBubbles();
    window.addEventListener('resize', renderBubblesDebounced);
    // 뒤에 학교 지도를 흐리게
    kwMap = null;
    const center = classCenter([]);
    createMap($('kw-bg'), { center, radius: APP.cls.radius_m || 500, interactive: false }).then((m) => {
        kwMap = m;
        if (m.kind === 'svg') $('kw-bg').classList.add('kw-bg-plain');
    });
}

let lastSubmit = 0;
async function submitKeyword(e) {
    e.preventDefault();
    const input = $('kw-text');
    const text = input.value.trim().replace(/\s+/g, ' ');
    if (!text) return;
    if (Date.now() - lastSubmit < 800) return; // 연타 방지
    lastSubmit = Date.now();
    input.value = '';
    try {
        await API.addKeyword(APP.cls.id, text);
    } catch (err) {
        input.value = text;
        toast(friendlyError(err), 'error');
    }
    input.focus();
}

const renderBubblesDebounced = debounce(() => {
    if (APP.screen === 'keywords') renderBubbles();
}, 200);

function bubbleColor(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return BUBBLE_COLORS[h % BUBBLE_COLORS.length];
}

// 큰 동그라미부터 가운데에서 바깥으로 나선을 따라 겹치지 않게 놓습니다.
function packBubbles(groups, W, H) {
    const maxCount = Math.max(1, ...groups.map((g) => g.count));
    const unit = Math.max(26, Math.min(W, H) / 16);
    const items = groups.map((g) => ({ ...g, r: unit * (1 + 1.1 * Math.sqrt((g.count - 1) / Math.max(1, maxCount - 1 || 1))) * (g.count > 1 ? 1 : 0.95) }));
    // 화면에 다 안 들어가면 함께 줄임
    const area = items.reduce((a, it) => a + Math.PI * it.r * it.r, 0);
    const fit = Math.min(1, Math.sqrt((W * H * 0.5) / Math.max(area, 1)));
    items.forEach((it) => (it.r = Math.max(22, it.r * fit)));
    const placed = [];
    const cx = W / 2;
    const cy = H / 2;
    items.forEach((it) => {
        let spot = null;
        for (let t = 0; t < 4000 && !spot; t++) {
            const ang = t * 0.35;
            const rad = 2.2 * t * 0.35 * (Math.min(W, H) / 400);
            const x = cx + Math.cos(ang) * rad * (W / Math.max(W, H)) * 1.6;
            const y = cy + Math.sin(ang) * rad;
            if (x - it.r < 4 || x + it.r > W - 4 || y - it.r < 4 || y + it.r > H - 4) continue;
            if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + it.r + 6)) spot = { x, y };
        }
        if (!spot) spot = { x: 8 + Math.random() * (W - 16), y: 8 + Math.random() * (H - 16) };
        placed.push({ ...it, ...spot });
    });
    return placed;
}

function renderBubbles() {
    const cloud = $('kw-cloud');
    if (!cloud) return;
    const groups = groupKeywords(APP.keywords);
    const count = $('kw-count');
    if (count) count.textContent = `${APP.keywords.length}개 모임`;
    if (!groups.length) {
        cloud.innerHTML = '<div class="kw-empty">아직 아무도 쓰지 않았어요.<br>첫 번째로 적어 보세요! ✍️</div>';
        return;
    }
    const empty = cloud.querySelector('.kw-empty');
    if (empty) empty.remove();
    const W = cloud.clientWidth || 800;
    const H = cloud.clientHeight || 500;
    const placed = packBubbles(groups, W, H);
    const keep = new Set();
    placed.forEach((b) => {
        keep.add(b.key);
        let el = cloud.querySelector(`[data-key="${CSS.escape(b.key)}"]`);
        if (!el) {
            el = document.createElement('button');
            el.type = 'button';
            el.className = 'bubble pop';
            el.dataset.key = b.key;
            el.style.left = `${b.x}px`;
            el.style.top = `${b.y}px`;
            el.addEventListener('click', () => onBubbleClick(el.dataset.key));
            cloud.appendChild(el);
            setTimeout(() => el.classList.remove('pop'), 600);
        }
        el.style.background = bubbleColor(b.key);
        el.style.width = el.style.height = `${b.r * 2}px`;
        el.style.left = `${b.x}px`;
        el.style.top = `${b.y}px`;
        el.style.fontSize = `${Math.max(13, Math.min(34, b.r / Math.max(2.2, b.text.length * 0.42)))}px`;
        el.innerHTML = `<span>${esc(b.text)}</span>${b.count > 1 ? `<small>${b.count}</small>` : ''}`;
        el.title = isTeacher() ? '눌러서 지우기' : `${b.count}명`;
    });
    cloud.querySelectorAll('.bubble').forEach((el) => {
        if (!keep.has(el.dataset.key)) el.remove();
    });
}

async function onBubbleClick(key) {
    if (!isTeacher()) return;
    const g = groupKeywords(APP.keywords).find((x) => x.key === key);
    if (!g) return;
    if (!(await confirmBox(`'${g.text}' 키워드 ${g.count}개를 지울까요?`, '지우기'))) return;
    try {
        await API.deleteKeywords(g.ids);
    } catch (err) {
        toast(friendlyError(err), 'error');
    }
}

// ===== 참여 QR (1차시 도입: 사이트 접속) =====
function joinUrl(code) {
    const demo = API && API.mode === 'demo' ? 'demo=1&' : '';
    return `${location.origin}${location.pathname}?${demo}join=${encodeURIComponent(code)}`;
}
function qrSvg(text) {
    if (typeof qrcode !== 'function') return '<span class="qr-none">QR</span>'; // QR 도구를 못 불러오면 코드만
    try {
        const q = qrcode(0, 'M');
        q.addData(text);
        q.make();
        return q.createSvgTag(4, 2);
    } catch (_) {
        return '<span class="qr-none">QR</span>';
    }
}
// QR 도구는 따로 받으므로, 다 받으면 그때 그림
function fillQrWhenReady(id, code) {
    libReady('lib-qr', () => typeof qrcode === 'function', 10000).then((ok) => {
        const el = $(id);
        if (ok && el) el.innerHTML = qrSvg(joinUrl(code));
    });
}
function openJoinQr() {
    const code = APP.cls.code;
    openModal({
        title: '📱 학반 참여',
        size: 'wide',
        className: 'qr-modal',
        body: `<div class="qr-big" id="qr-big">${qrSvg(joinUrl(code))}</div>
            <p class="qr-code">참여 코드 <b>${esc(code)}</b></p>
            <p class="muted small qr-url">${esc(joinUrl(code))}</p>
            <p class="muted small">카메라로 찍으면 로그인 뒤 이 학반에 바로 들어와요.</p>`,
    });
    fillQrWhenReady('qr-big', code);
}

// ===== 오늘의 생태지도 (1차시 정리: 돌아보기) =====
async function openTodayMap() {
    const m = openModal({
        title: '🗺️ 오늘 모인 우리 학교 생태지도',
        size: 'full',
        className: 'today-modal',
        body: `<div class="today-wrap"><div id="today-map" class="today-map"></div><aside class="today-side" id="today-side"><p class="muted">기록을 불러오는 중… 🌿</p></aside></div>`,
    });
    APP.data = null; // 방금 올린 기록까지 새로 불러옴
    APP.future = null;
    let d;
    try {
        d = await loadClassData();
    } catch (err) {
        if ($('today-side')) $('today-side').textContent = `기록을 불러오지 못했어요: ${friendlyError(err)}`;
        return;
    }
    if (!m.el.isConnected) return;
    const species = new Map();
    d.records.forEach((r) => {
        const s = species.get(r.name) || { name: r.name, type: r.type, n: 0 };
        s.n++;
        species.set(r.name, s);
    });
    const list = [...species.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ko'));
    const byType = Object.keys(TYPE_COLOR)
        .map((t) => ({ t, n: list.filter((s) => s.type === t).length }))
        .filter((x) => x.n);
    $('today-side').innerHTML = `
        <div class="today-stats">
            <div class="stat"><span>생물 종</span><b>${list.length}<small>종</small></b></div>
            <div class="stat"><span>생물 기록</span><b>${d.records.length}<small>건</small></b></div>
        </div>
        <p class="today-types">${byType.map((x) => `<span><i class="lg" style="background:${TYPE_COLOR[x.t]}"></i>${typeEmoji(x.t)} ${esc(x.t)} ${x.n}종</span>`).join('')}</p>
        <h4>많이 기록된 생물</h4>
        <ol class="today-top">${list
            .slice(0, 10)
            .map((s) => `<li>${typeEmoji(s.type)} ${esc(s.name)} <span class="muted">${s.n}건</span></li>`)
            .join('')}</ol>
        <p class="today-q">생물이 가장 많이 모인 곳은 어디일까요? 왜 그럴까요?</p>`;
    const map = await createMap($('today-map'), { center: d.center, radius: APP.cls.radius_m, onPick: showPick });
    if (!m.el.isConnected) return;
    map.render({
        records: d.records.filter((r) => fin(r.lat)).map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, type: r.type, name: r.name, state: 'now', shape: r.shape, coords: r.coords })),
        facilities: [],
        newcomers: [],
        area: { ...d.center, radius: APP.cls.radius_m },
    });
}
