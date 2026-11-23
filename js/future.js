'use strict';
// 2차시 지도 화면: 지금 ↔ 2100년 생태지도, [미래 보기] 연출(교사), 오른쪽 위 알림

const MS = {
    map: null,
    view: 'now', // 'now' | 'future'
    playing: false,
    alertsShown: false,
    drawnFuture: null,
};

function futureAvailable() {
    return isTeacher() || !!APP.cls.future_open;
}

async function showMapScreen() {
    const token = (MS.token = (MS.token || 0) + 1); // 연달아 불리면 마지막 것만 지도를 만듦
    MS.map = null;
    APP.screen = 'map';
    MS.view = 'now';
    MS.alertsShown = false;
    const teacher = isTeacher();
    $('app').innerHTML = `
        <div class="screen map-screen">
            <div id="main-map" class="main-map"></div>
            <div class="heat-tint" id="heat-tint"></div>
            <div class="hud-stack">
            <div class="hud-top">
                <div class="hud-tl">${headerHtml()}</div>
                <button class="bell" id="bell" title="알림" hidden>!<span id="bell-count"></span></button>
            </div>
            <div class="hud-row2">
                <div id="view-toggle"></div>
                <button class="btn btn-float btn-small-m" id="btn-keywords">💭 <span class="lbl">키워드</span></button>
            </div>
            <div class="alerts collapsed" id="alerts"></div>
            </div>
            <div class="hud-bottom">
                <div class="map-legend" id="map-legend"></div>
                <div class="hud-bar">
                    <button class="btn btn-float btn-big" id="btn-compare">⚖️ <span class="lbl-l">시뮬레이션 전과 비교</span><span class="lbl-s">비교</span></button>
                    ${teacher ? '<button class="btn btn-float btn-big btn-hot" id="btn-play">▶ <span class="lbl-l">미래 보기</span><span class="lbl-s">미래</span></button>' : ''}
                    <button class="btn btn-float btn-big btn-violet" id="btn-gallery">🖼️ 발표</button>
                </div>
            </div>
            <div class="map-status" id="map-status">생태지도 기록을 불러오는 중… 🌿</div>
            <div class="caption" id="caption" hidden></div>
            <div class="temp-counter" id="temp-counter" hidden></div>
        </div>`;
    bindHeader();
    $('btn-keywords').addEventListener('click', openKeywordOverlay);
    $('btn-compare').addEventListener('click', () => {
        if (!futureAvailable()) return toast('선생님이 미래 지도를 열면 볼 수 있어요.', 'info');
        openCompare();
    });
    $('btn-gallery').addEventListener('click', openGallery);
    $('bell').addEventListener('click', toggleAlerts);
    if (teacher) $('btn-play').addEventListener('click', playFuture);

    let d;
    try {
        d = await loadClassData();
    } catch (err) {
        $('map-status').textContent = `기록을 불러오지 못했어요: ${friendlyError(err)}`;
        return;
    }
    if (APP.screen !== 'map' || token !== MS.token) return;
    const map = await createMap($('main-map'), { center: d.center, radius: APP.cls.radius_m, onPick: showPick });
    if (APP.screen !== 'map' || token !== MS.token) return;
    MS.map = map;
    MS.drawnFuture = null;
    window.onresize = debounce(() => MS.map && MS.map.relayout(), 200);
    $('map-status').textContent = d.records.length ? '' : '이 학반의 생태지도 기록이 아직 없어요. (교사: ⚙️ 관리 → 지도·기록에서 출처 확인)';
    $('map-status').hidden = !!d.records.length;
    await ensureFuture();
    renderViewToggle();
    drawMap(); // 알림은 2100년 지도를 볼 때 뜸
}

function renderViewToggle() {
    const el = $('view-toggle');
    if (!el) return;
    if (!futureAvailable()) {
        el.innerHTML = '<div class="pill muted">지금의 우리 학교 생태지도</div>';
        return;
    }
    el.innerHTML = `<div class="seg">
        <button data-v="now" aria-pressed="${MS.view === 'now'}">지금</button>
        <button data-v="future" aria-pressed="${MS.view === 'future'}">${esc(SCENARIO.short)}</button>
    </div>`;
    el.querySelectorAll('[data-v]').forEach((b) =>
        b.addEventListener('click', () => {
            if (MS.playing) return;
            MS.view = b.dataset.v;
            renderViewToggle();
            drawMap();
            if (MS.view === 'future') showAlerts();
        })
    );
}

// 지금 보여 줄 모습 → 지도
function mapView(stage = null) {
    const f = APP.future;
    const d = APP.data;
    if (!f || !d) return { records: [] };
    const future = MS.view === 'future';
    const fateById = new Map(f.fates.map((x) => [x.rec.id, x.fate]));
    const records = d.records
        .filter((r) => fin(r.lat))
        .map((r) => {
            let state = 'now';
            if (future || stage) {
                const fate = fateById.get(r.id);
                const gone = fate === 'habitat' || fate === 'heat';
                state = stage ? (stage.gone.has(r.id) ? 'gone' : 'ok') : gone ? 'gone' : 'ok';
            }
            return { id: r.id, lat: r.lat, lon: r.lon, type: r.type, name: r.name, state };
        });
    const facilities = f.facilities.map((x) => ({
        key: x.key,
        lat: x.lat,
        lon: x.lon,
        radius: x.radius,
        emoji: KEYWORD_CATEGORIES[x.category].emoji,
        text: x.text,
        count: x.count,
        green: x.category === 'green',
        visible: stage ? stage.facilities.has(x.key) : future,
    }));
    const newcomers = f.newcomers.map((n) => ({ ...n, visible: stage ? stage.newcomers : future }));
    return { records, facilities, newcomers, area: { ...f.center, radius: f.radiusM } };
}

function drawMap(stage = null) {
    if (!MS.map) return;
    if (MS.drawnFuture !== APP.future) {
        MS.map.clear(); // 키워드·배치가 바뀌면 지도를 새로 그림
        MS.drawnFuture = APP.future;
    }
    MS.map.render(mapView(stage));
    const future = MS.view === 'future' || !!stage;
    $('map-legend').innerHTML = future
        ? '<span><i class="lg lg-ok"></i>남은 생물</span><span><i class="lg lg-gone">✕</i>사라진 생물</span><span><i class="lg lg-new">★</i>새로 온 생물</span><span><i class="lg lg-fac"></i>새로 생긴 시설</span>'
        : Object.keys(TYPE_COLOR).map((t) => `<span><i class="lg" style="background:${TYPE_COLOR[t]}"></i>${typeEmoji(t)} ${t}</span>`).join('');
    $('heat-tint').style.opacity = future && !stage ? '0.28' : $('heat-tint').style.opacity;
    if (!future && !stage) $('heat-tint').style.opacity = '0';
}

function showPick(r) {
    let state = '';
    if (r.state === 'new') state = '★ 새로 온 생물';
    else if (r.state === 'gone') state = '✕ 사라짐';
    else if (r.state === 'ok') state = '살아남음';
    const rec = APP.data && APP.data.records.find((x) => x.id === r.id);
    toast(`${typeEmoji(r.type)} ${r.name}${rec ? ` · ${rec.iso.replace(/-/g, '.')} 기록` : ''}${state ? ` · ${state}` : ''}`);
}

// ===== 미래 보기 연출 (교사 화면, 전자칠판) =====
async function playFuture() {
    if (MS.playing) return;
    if (!APP.keywords.length) return toast('1차시 키워드가 없어요.', 'error');
    MS.playing = true;
    $('btn-play').disabled = true;
    hideAlerts();
    const f = await ensureFuture();
    const d = APP.data;
    const stage = { facilities: new Set(), gone: new Set(), newcomers: false };
    const cap = $('caption');
    const counter = $('temp-counter');
    const tint = $('heat-tint');
    const say = async (html, ms) => {
        cap.innerHTML = html;
        cap.hidden = false;
        cap.classList.remove('show');
        void cap.offsetWidth;
        cap.classList.add('show');
        await sleep(ms);
    };
    MS.view = 'future';
    renderViewToggle();
    tint.style.opacity = '0';
    drawMap(stage);
    await say(`1차시에 우리가 바랐던 것들이<br><b>학교 주변에 생기면…</b>`, 2600);
    cap.hidden = true;

    // ① 시설이 하나씩 생기며 그 자리 생물이 사라짐
    const order = f.facilities.slice().sort((a, b) => a.count - b.count);
    const step = Math.max(160, Math.min(700, 7000 / Math.max(1, order.length)));
    const habitatGone = f.fates.filter((x) => x.fate === 'habitat' && fin(x.rec.lat)).map((x) => x.rec);
    for (const fac of order) {
        stage.facilities.add(fac.key);
        if (fac.category !== 'green') habitatGone.forEach((r) => distMeters(r, fac) <= fac.radius + 3 && stage.gone.add(r.id));
        drawMap(stage);
        await sleep(step);
    }
    habitatGone.forEach((r) => stage.gone.add(r.id)); // 경계에 걸친 기록까지
    drawMap(stage);
    await sleep(600);

    // ② 2100년까지 기온 상승 (+ 열섬)
    await say(`그리고 ${esc(SCENARIO.period)},<br>온실가스를 계속 많이 내뿜는다면 <b>(고탄소 시나리오)</b>`, 2800);
    cap.hidden = true;
    counter.hidden = false;
    const heatGone = f.fates.filter((x) => x.fate === 'heat').map((x) => x.rec.id);
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        counter.innerHTML = `🌡️ <b>+${(f.env.dT * k).toFixed(1)}℃</b><small>${esc(SCENARIO.short)}</small>`;
        tint.style.opacity = String(0.32 * k);
        heatGone.slice(0, Math.round(heatGone.length * k)).forEach((id) => stage.gone.add(id));
        drawMap(stage);
        await sleep(110);
    }
    await sleep(700);

    // ③ 새로 온 생물
    if (f.newcomers.length) {
        stage.newcomers = true;
        drawMap(stage);
        await say(`<b>★ 처음 보는 생물</b>이 나타났다`, 2200);
        cap.hidden = true;
    }

    // 정리
    const c = f.counts;
    await say(
        `<div class="sum-title">${esc(SCENARIO.short)}, 우리 학교 생태지도</div>
         <div class="sum-row"><span>생물 종</span><b>${c.speciesNow}종 → ${c.speciesFuture}종</b></div>
         <div class="sum-row"><span>생물 기록</span><b>${c.recordsNow}건 → ${c.recordsFuture}건</b></div>
         <div class="sum-q">무엇이 이런 변화를 일으켰을까?</div>`,
        4200
    );
    cap.hidden = true;
    counter.hidden = true;
    MS.playing = false;
    $('btn-play').disabled = false;
    MS.view = 'future';
    renderViewToggle();
    drawMap();
    showAlerts();
    if (!APP.cls.future_open) {
        try {
            await API.updateClassroom(APP.cls.id, { future_open: true });
            APP.cls.future_open = true;
        } catch (err) {
            toast(friendlyError(err), 'error');
        }
    }
}

// ===== 알림 (생태계를 바꾼 요인들, 제목 없이 하나씩) =====
async function showAlerts() {
    const f = APP.future;
    const box = $('alerts');
    if (!f || !box) return;
    $('bell').hidden = false;
    $('bell-count').textContent = f.alerts.length;
    if (MS.alertsShown) {
        box.classList.remove('collapsed');
        return;
    }
    MS.alertsShown = true;
    box.innerHTML = '';
    box.classList.remove('collapsed');
    for (const a of f.alerts) {
        const el = document.createElement('div');
        el.className = 'alert-card';
        el.innerHTML = `<span class="alert-icon">${a.icon}</span><span class="alert-text">${esc(a.text)}</span><b class="alert-value">${esc(a.value)}</b>`;
        box.appendChild(el);
        await sleep(900);
        if (APP.screen !== 'map') return;
    }
    // 좁은 화면에서는 지도를 가리지 않게 잠시 뒤 접음 (! 버튼으로 다시 보기)
    if (window.innerWidth <= 820) setTimeout(() => box.classList.add('collapsed'), 5000);
}
function hideAlerts() {
    const box = $('alerts');
    if (box) box.classList.add('collapsed');
}
function toggleAlerts() {
    const box = $('alerts');
    if (!box) return;
    if (!MS.alertsShown) return showAlerts();
    box.classList.toggle('collapsed');
}

// 학반 설정이 바뀌었을 때 (교사가 미래를 열거나 지도 범위를 바꿈)
async function mapScreenClassroomChanged(before, now) {
    if (!APP.data) return showMapScreen(); // 지도 범위·기록 출처가 바뀜
    await ensureFuture();
    renderViewToggle();
    drawMap();
    if (!before.future_open && now.future_open && !isTeacher()) {
        toast(`선생님이 ${SCENARIO.short} 생태지도를 열었어요!`, 'ok');
        MS.view = 'future';
        renderViewToggle();
        drawMap();
        showAlerts();
    }
}
async function mapScreenKeywordsChanged() {
    MS.alertsShown = false;
    await ensureFuture();
    drawMap();
}

// 2차시에도 1차시 키워드 다시 보기
function openKeywordOverlay() {
    const groups = groupKeywords(APP.keywords);
    const m = openModal({
        title: '💭 1차시에 우리가 바랐던 것들',
        size: 'wide',
        body: groups.length
            ? `<div class="kw-chips">${groups.map((g) => `<span class="kw-chip" style="--b:${bubbleColor(g.key)}">${esc(g.text)}${g.count > 1 ? `<small>${g.count}</small>` : ''}</span>`).join('')}</div>`
            : '<p class="muted">키워드가 없어요.</p>',
    });
    return m;
}
