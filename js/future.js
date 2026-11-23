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
            <div class="subtitle" id="subtitle" aria-live="polite" hidden></div>
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
    const fateById = new Map(f.fates.map((x) => [x.rec.id, x]));
    const records = d.records
        .filter((r) => fin(r.lat))
        .map((r) => {
            let state = 'now';
            const x = fateById.get(r.id);
            if (future || stage) {
                const gone = x && (x.fate === 'habitat' || x.fate === 'heat');
                if (stage) state = stage.gone.has(r.id) ? 'gone' : stage.partial.has(r.id) ? 'partial' : 'ok';
                else state = gone ? 'gone' : x && x.partial ? 'partial' : 'ok';
            }
            return { id: r.id, lat: r.lat, lon: r.lon, type: r.type, name: r.name, state, shape: r.shape, coords: r.coords, cover: x ? x.cover : 0 };
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
    const anyPartial = stage ? stage.partial.size > 0 : APP.future && APP.future.counts.partial > 0;
    $('map-legend').innerHTML = future
        ? `<span><i class="lg lg-ok"></i>남은 생물</span>${anyPartial ? '<span><i class="lg lg-part"></i>일부만 남은 생물</span>' : ''}<span><i class="lg lg-gone">✕</i>사라진 생물</span><span><i class="lg lg-new">★</i>새로 온 생물</span><span><i class="lg lg-fac"></i>새로 생긴 시설</span>`
        : Object.keys(TYPE_COLOR).map((t) => `<span><i class="lg" style="background:${TYPE_COLOR[t]}"></i>${typeEmoji(t)} ${t}</span>`).join('');
    $('heat-tint').style.opacity = future && !stage ? '0.28' : $('heat-tint').style.opacity;
    if (!future && !stage) $('heat-tint').style.opacity = '0';
}

function showPick(r) {
    let state = '';
    if (r.state === 'new') state = '★ 새로 온 생물';
    else if (r.state === 'gone') state = '✕ 사라짐';
    else if (r.state === 'partial') state = `◐ 일부만 남음 (시설이 ${Math.round((r.cover || 0) * 100)}% 덮음)`;
    else if (r.state === 'ok') state = '살아남음';
    const rec = APP.data && APP.data.records.find((x) => x.id === r.id);
    const ind = isClimateIndicator(r.name, (rec && rec.sci) || r.sci) ? ' · 🌡️ 기후변화 생물지표종' : '';
    toast(`${typeEmoji(r.type)} ${r.name}${ind}${rec ? ` · ${rec.iso.replace(/-/g, '.')} 기록` : ''}${state ? ` · ${state}` : ''}`);
}

// ===== 미래 보기 연출 (교사 화면, 전자칠판) =====
// 자막 한 줄에 들어갈 생물 이름들: "개망초, 쑥" / "개망초, 쑥, 강아지풀 등 5종" + 조사
function nameList(names, withFinal, withoutFinal) {
    const shown = names.slice(0, 3);
    const more = names.length > 3 ? ` 등 ${names.length}종` : '';
    const last = more ? '종' : shown[shown.length - 1];
    return `<b>${shown.map(esc).join(', ')}${more}</b>${josa(last, withFinal, withoutFinal)}`;
}

// 기온이 오르는 동안 사람들의 삶 (기온 상승 단계마다 한 줄)
function peopleLines(w, hotDays) {
    return [
        `여름이 길어지고, 폭염일이 1년에 약 <b>${hotDays}일</b>로 늘어난다`,
        '밤에도 기온이 떨어지지 않아 잠 못 드는 밤(열대야)이 잦아진다',
        '사람들은 한낮 바깥 활동을 줄이고 에어컨을 더 오래 켠다',
        `봄꽃이 지금보다 약 <b>${Math.round(PHENOLOGY.springDaysPerC * w)}일</b> 빨리 핀다`,
        '더위로 쓰러지는 사람(온열질환자)이 늘어난다',
        '냉방에 쓰는 전기가 늘어, 온실가스도 더 나온다',
    ];
}

const PLAY_ABORT = { abort: true };
async function playFuture() {
    if (MS.playing) return;
    if (!APP.keywords.length) return toast('1차시 키워드가 없어요.', 'error');
    MS.playing = true;
    $('btn-play').disabled = true;
    hideAlerts();
    try {
        await runFuturePlay();
    } catch (err) {
        if (err !== PLAY_ABORT) throw err; // 연출 중 다른 화면으로 나가면 조용히 멈춤
    } finally {
        MS.playing = false;
        if ($('btn-play')) $('btn-play').disabled = false;
    }
}

async function runFuturePlay() {
    const token = MS.token;
    const f = await ensureFuture();
    const stage = { facilities: new Set(), gone: new Set(), partial: new Set(), newcomers: false };
    const cap = $('caption');
    const sub = $('subtitle');
    const counter = $('temp-counter');
    const tint = $('heat-tint');
    // 화면이 바뀌면(다른 화면, 지도 새로 그림) 연출을 멈춤
    const wait = async (ms) => {
        await sleep(ms / (PLAY_SPEED || 1));
        if (APP.screen !== 'map' || token !== MS.token || !document.body.contains(cap)) throw PLAY_ABORT;
    };
    const pop = (el, html) => {
        el.innerHTML = html;
        el.hidden = false;
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
    };
    const say = async (html, ms) => {
        pop(cap, html);
        await wait(ms);
    };
    // 아래쪽 자막: 버튼 줄 바로 위
    const line = async (html, ms) => {
        const bottom = document.querySelector('.hud-bottom');
        sub.style.bottom = `${(bottom ? bottom.offsetHeight : 100) + 26}px`;
        pop(sub, html);
        await wait(ms);
    };
    MS.view = 'future';
    renderViewToggle();
    tint.style.opacity = '0';
    sub.hidden = true;
    drawMap(stage);
    await say(`1차시에 우리가 바랐던 것들이<br><b>학교 주변에 생기면…</b>`, 2000);
    cap.hidden = true;

    // ① 시설이 하나씩 생기며 그 자리 생물이 사라짐 (자막: 이 자리에서 사라진 생물)
    const order = f.facilities.slice().sort((a, b) => a.count - b.count);
    const talks = (fac) => fac.category === 'green' || (fac.lostNames || []).length || (fac.partialNames || []).length;
    const talkStep = Math.max(800, Math.min(1300, 10000 / Math.max(1, order.filter(talks).length)));
    const quietStep = Math.max(150, Math.min(350, 3000 / Math.max(1, order.length)));
    for (const fac of order) {
        stage.facilities.add(fac.key);
        f.fates.forEach((x) => {
            if (x.facKey !== fac.key) return;
            if (x.fate === 'habitat') stage.gone.add(x.rec.id);
            else if (x.cover > 0) stage.partial.add(x.rec.id); // 덮이지 않은 부분은 다음 단계(기온)로
        });
        drawMap(stage);
        const emoji = KEYWORD_CATEGORIES[fac.category].emoji;
        const what = `${emoji} <b>${esc(fac.text)}</b>${josa(fac.text, '이', '가')}`;
        const lost = fac.lostNames || [];
        const part = (fac.partialNames || []).filter((n) => !lost.includes(n));
        if (fac.category === 'green') await line(`${what} 생겼습니다`, talkStep);
        else if (lost.length || part.length) {
            const lines = [];
            if (lost.length) lines.push(`${what} 들어서며 이 자리의 ${nameList(lost, '이', '가')} 사라졌습니다`);
            if (part.length) lines.push(`${lost.length ? '' : `${what} 들어서며 `}${nameList(part, '은', '는')} 서식지 일부만 남았습니다`);
            await line(lines.map((t, i) => (i ? `<small>${t}</small>` : t)).join('<br>'), talkStep);
        } else await wait(quietStep);
    }
    f.fates.forEach((x) => x.fate === 'habitat' && stage.gone.add(x.rec.id)); // 혹시 빠진 기록까지
    drawMap(stage);
    await line(`시설이 들어선 자리에서 생물 기록 <b>${f.counts.lostHabitat}건</b>이 사라졌습니다${f.counts.partial ? `<br><small>${f.counts.partial}건은 서식지 일부만 남았습니다</small>` : ''}`, 1800);
    sub.hidden = true;

    // ② 2100년까지 기온 상승 (+ 열섬). 견딘 범위를 먼저 넘는 생물부터 사라짐
    await say(`그리고 ${esc(SCENARIO.period)},<br>온실가스를 계속 많이 내뿜는다면 <b>(고탄소 시나리오)</b>`, 2200);
    cap.hidden = true;
    counter.hidden = false;
    const dT = f.env.dT;
    // 살기 좋은 정도가 85% 아래로 떨어지는 때 = 견딘 범위 위쪽 끝을 1.7℃ 넘을 때 (σ = 3℃)
    const heat = f.fates
        .filter((x) => x.fate === 'heat')
        .map((x) => ({ id: x.rec.id, name: x.rec.name, at: Math.min(dT, Math.max(0.2, (fin(x.margin) ? x.margin : dT) + 1.7)) }))
        .sort((a, b) => a.at - b.at);
    const statusOf = new Map(f.species.map((s) => [s.name, s.status]));
    const beats = 6;
    const sub8 = 6;
    const shownNames = new Set();
    for (let b = 1; b <= beats; b++) {
        const newly = [];
        for (let i = 1; i <= sub8; i++) {
            const k = (b - 1 + i / sub8) / beats;
            const w = dT * k;
            const hot = Math.round(LOCAL_CLIMATE.hotDaysNow + (LOCAL_CLIMATE.hotDaysFuture - LOCAL_CLIMATE.hotDaysNow) * k);
            counter.innerHTML = `🌡️ <b>+${w.toFixed(1)}℃</b><small>폭염일 약 ${hot}일</small>`;
            tint.style.opacity = String(0.32 * k);
            heat.forEach((h) => {
                if (h.at <= w + 1e-9 && !stage.gone.has(h.id)) {
                    stage.gone.add(h.id);
                    newly.push(h.name);
                }
            });
            drawMap(stage);
            await wait(70);
        }
        const k = b / beats;
        const hot = Math.round(LOCAL_CLIMATE.hotDaysNow + (LOCAL_CLIMATE.hotDaysFuture - LOCAL_CLIMATE.hotDaysNow) * k);
        const people = peopleLines(dT * k, hot)[b - 1];
        const names = [...new Set(newly)].filter((n) => !shownNames.has(n));
        names.forEach((n) => shownNames.add(n));
        const gone = names.filter((n) => statusOf.get(n) === 'gone');
        const fewer = names.filter((n) => statusOf.get(n) !== 'gone');
        let top = '';
        if (gone.length) top = `🥵 더위를 견디지 못한 ${nameList(gone, '이', '가')} 사라졌습니다`;
        else if (fewer.length) top = `🥵 더위로 ${nameList(fewer, '이', '가')} 줄어들었습니다`;
        if (gone.length && fewer.length) top += `<br><small>${nameList(fewer, '은', '는')} 줄어들었습니다</small>`;
        await line(top ? `${top}<br><small class="sub-people">👥 ${people}</small>` : `👥 ${people}`, top ? 2300 : 1600);
    }
    sub.hidden = true;
    await wait(300);

    // ③ 새로 온 생물
    if (f.newcomers.length) {
        stage.newcomers = true;
        drawMap(stage);
        await say(`<b>★ 처음 보는 생물</b>이 나타났다`, 1200);
        cap.hidden = true;
        await line(`★ 더 따뜻한 곳에 살던 ${nameList(f.newcomers.map((n) => n.name), '이', '가')} 우리 학교에 나타났습니다`, 2300);
        sub.hidden = true;
    }

    // 정리
    const c = f.counts;
    await say(
        `<div class="sum-title">${esc(SCENARIO.short)}, 우리 학교 생태지도</div>
         <div class="sum-row"><span>생물 종</span><b>${c.speciesNow}종 → ${c.speciesFuture}종</b></div>
         <div class="sum-row"><span>생물 기록</span><b>${c.recordsNow}건 → ${c.recordsFuture}건</b></div>
         <div class="sum-q">무엇이 이런 변화를 일으켰을까?</div>`,
        3600
    );
    cap.hidden = true;
    counter.hidden = true;
    MS.playing = false;
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
