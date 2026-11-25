'use strict';
// 2차시 도입: 조별 예측
//   미래 보기 전에, 조별로 우리 기록에서 사라질 것 같은 생물 3가지를 고르고 까닭을 적습니다.
//   미래 지도가 열리면 예측과 결과를 나란히 보여 줍니다: ✔ 사라짐 / △ 줄어듦 / ✘ 남음
//   (전개 질의응답 ① "예측과 실제는 무엇이 달랐나요?")
//   저장 형식: species 배열의 각 항목 = '이름::gone' (예전 형식 '이름', '이름::declined|survived' 도 읽음)

const PRED_MAX = 3;
const PRED_SHOW = 20; // 처음에 보여 주는 후보 수 (기록 많은 순), [더 보기]로 늘림
const PRED = { modal: null, picked: null, reason: null, show: PRED_SHOW, q: '' }; // picked: Set(이름)
const GUESS = [
    ['gone', '사라질 것'],
    ['declined', '줄어들 것'],
    ['survived', '남을 것'],
];
const STATUS_LABEL = { gone: '사라짐', declined: '줄어듦', survived: '남음' };
const guessLabel = (g) => (GUESS.find(([k]) => k === g) || [, ''])[1];

function parseEntry(e) {
    const [name, guess] = String(e).split('::');
    return { name, guess: GUESS.some(([k]) => k === guess) ? guess : 'gone' };
}
const entriesOf = (p) => (p && Array.isArray(p.species) ? p.species.map(parseEntry) : []);

const predictionsReady = () => Array.isArray(APP.predictions);
const predictionOf = (team) => (APP.predictions || []).find((p) => p.team === team) || null;
const predictionsRevealed = () => !!(APP.cls && APP.cls.future_open);

// 우리 기록 속 생물 (기록 많은 순)
function predictCandidates() {
    const d = APP.data;
    if (!d) return [];
    const m = new Map();
    d.records.forEach((r) => {
        const s = m.get(r.name) || { name: r.name, type: r.type, n: 0 };
        s.n++;
        m.set(r.name, s);
    });
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ko'));
}

// 예측이 맞았는가: '사라질 것' → 사라짐 ✔ / 줄어듦 △ (방향은 맞음) / 남음 ✘
// (예전에 '줄어들 것'·'남을 것'으로 저장한 예측은 그대로 같은지 비교)
function predictVerdict({ name, guess }) {
    const s = APP.future && APP.future.species.find((x) => x.name === name);
    if (!s) return { cls: 'unknown', label: '기록 없음', hit: false, half: false };
    const actual = STATUS_LABEL[s.status] || s.status;
    if (guess === 'gone') {
        if (s.status === 'gone') return { cls: 'right', label: `✔ ${actual}`, hit: true, half: false };
        if (s.status === 'declined') return { cls: 'half', label: `△ ${actual}`, hit: false, half: true };
        return { cls: 'no', label: `✘ ${actual}`, hit: false, half: false };
    }
    return s.status === guess ? { cls: 'right', label: `✔ ${actual}`, hit: true, half: false } : { cls: 'no', label: `✘ 실제 ${actual}`, hit: false, half: false };
}

async function openPredict() {
    PRED.modal = openModal({
        title: '🔮 조별 예측',
        size: 'wide',
        className: 'predict-modal',
        body: '<div id="predict-body"><p class="muted">불러오는 중…</p></div>',
        onClose: () => {
            PRED.modal = null;
            PRED.picked = null;
            PRED.reason = null;
            PRED.show = PRED_SHOW;
            PRED.q = '';
        },
    });
    try {
        await ensureFuture();
    } catch (err) {
        toast(friendlyError(err), 'error');
    }
    predictRefresh();
}

function predictRefresh() {
    updatePredictButton();
    const body = $('predict-body');
    if (!PRED.modal || !body) return;
    if (!predictionsReady()) {
        body.innerHTML = `<p class="muted">예측 기능을 쓰려면 선생님이 Supabase에서 <code>supabase/100_update_2.sql</code>을 한 번 실행해야 해요.</p>`;
        return;
    }
    const c = APP.cls;
    const revealed = predictionsRevealed();
    const myTeam = !isTeacher() ? c.myTeam : null;
    // 쓰던 까닭은 다시 그려도 그대로
    if ($('pred-reason')) PRED.reason = $('pred-reason').value;
    let html = '';
    if (myTeam && !revealed) html += predictEditorHtml(myTeam);
    else if (!isTeacher() && !myTeam) html += '<p class="muted">조가 정해지면 조별로 예측할 수 있어요.</p>';
    html += predictBoardHtml({ revealed });
    if (revealed && APP.future) {
        const by = (st) => APP.future.species.filter((s) => s.status === st).length;
        html += `<p class="muted small">✔ 사라짐 · △ 줄어듦(사라지지는 않음) · ✘ 남음</p>`;
        html += `<p class="pred-actual">실제 결과: 사라짐 <b>${by('gone')}종</b> · 줄어듦 <b>${by('declined')}종</b> · 남음 <b>${by('survived')}종</b> · 새로 옴 <b>${APP.future.newcomers.length}종</b></p>`;
    }
    body.innerHTML = html;
    bindPredictEditor(myTeam);
}

function predictEditorHtml(team) {
    const saved = predictionOf(team);
    if (!PRED.picked) PRED.picked = new Set(entriesOf(saved).map((e) => e.name));
    const reason = PRED.reason !== null ? PRED.reason : saved ? saved.reason : '';
    const many = predictCandidates().length > PRED_SHOW;
    return `<section class="pred-edit">
        <h3>${team}조 예측 — 우리 지도의 생물 중 <b>사라질 것 같은 ${PRED_MAX}가지</b>는?</h3>
        <p class="muted small">1차시에 우리가 바란 시설이 모두 생기고 아주 먼 미래가 되면, 어떤 생물이 사라질까요? 많이 기록된 생물부터 보여요. 조원 누구나 고르고 바꿀 수 있고, 미래 지도가 열리면 잠겨요.</p>
        <div class="pred-picked" id="pred-picked">${predictPickedHtml()}</div>
        ${many ? `<input type="search" class="pred-search" id="pred-search" placeholder="🔍 생물 이름으로 찾기" value="${esc(PRED.q)}">` : ''}
        <div class="pred-chips" id="pred-chips">${predictChipsHtml()}</div>
        <label class="pred-reason-label">까닭<textarea id="pred-reason" rows="2" maxlength="500" placeholder="예: 개망초는 화단 자리에 건물이 들어서고, 소나무는 더위를 못 견딜 것 같아서">${esc(reason)}</textarea></label>
        <div class="row-end"><span class="muted small" id="pred-count">${PRED.picked.size}/${PRED_MAX}종</span><button class="btn btn-primary btn-lg" id="pred-save">저장</button></div>
    </section>`;
}

// 고른 생물 (누르면 빠짐)
function predictPickedHtml() {
    if (!PRED.picked.size) return '<span class="muted small">아래에서 사라질 것 같은 생물을 골라 주세요.</span>';
    return [...PRED.picked].map((n) => `<button type="button" class="pred-chip on" data-name="${esc(n)}">${esc(n)} ✕</button>`).join('');
}

// 후보: 검색어가 있으면 이름에 들어간 것, 없으면 기록 많은 순으로 PRED.show 개
function predictChipsHtml() {
    const all = predictCandidates();
    if (!all.length) return '<p class="muted">아직 생태지도 기록이 없어요.</p>';
    const q = PRED.q.trim();
    const list = q ? all.filter((s) => s.name.includes(q)) : all.slice(0, PRED.show);
    if (!list.length) return `<p class="muted small">'${esc(q)}'${josa(q, '이', '가')} 들어간 생물이 없어요.</p>`;
    const chips = list
        .map((s) => `<button type="button" class="pred-chip${PRED.picked.has(s.name) ? ' on' : ''}" data-name="${esc(s.name)}">${typeEmoji(s.type)} ${esc(s.name)}<small>${s.n}</small></button>`)
        .join('');
    const rest = q ? 0 : all.length - list.length;
    return chips + (rest > 0 ? `<button type="button" class="pred-more" data-more="1">더 보기 (+${Math.min(PRED_SHOW, rest)}종 / 남은 ${rest}종)</button>` : '');
}

function bindPredictEditor(team) {
    const body = $('predict-body');
    const edit = body && body.querySelector('.pred-edit');
    if (!edit) return;
    const redraw = () => {
        $('pred-picked').innerHTML = predictPickedHtml();
        $('pred-chips').innerHTML = predictChipsHtml();
        $('pred-count').textContent = `${PRED.picked.size}/${PRED_MAX}종`;
    };
    edit.addEventListener('click', (e) => {
        if (e.target.closest('[data-more]')) {
            PRED.show += PRED_SHOW;
            return redraw();
        }
        const b = e.target.closest('[data-name]');
        if (!b) return;
        const name = b.dataset.name;
        if (PRED.picked.has(name)) PRED.picked.delete(name);
        else if (PRED.picked.size >= PRED_MAX) return toast(`${PRED_MAX}가지까지 고를 수 있어요. 하나를 빼고 골라 주세요.`, 'info');
        else PRED.picked.add(name);
        redraw();
    });
    const search = $('pred-search');
    if (search)
        search.addEventListener('input', () => {
            PRED.q = search.value;
            $('pred-chips').innerHTML = predictChipsHtml();
        });
    $('pred-save').addEventListener('click', async (e) => {
        const save = e.currentTarget;
        if (!PRED.picked.size) return toast('사라질 것 같은 생물을 하나 이상 골라 주세요.', 'error');
        const reason = $('pred-reason').value.trim();
        if (!reason) return toast('까닭도 적어 주세요. (서식지, 더위 등)', 'error');
        save.disabled = true;
        try {
            const species = [...PRED.picked].map((n) => `${n}::gone`);
            await API.savePrediction(APP.cls.id, team, { species, reason });
            APP.predictions = await API.predictions(APP.cls.id);
            PRED.picked = null;
            PRED.reason = null;
            toast(`${team}조 예측을 저장했어요.`, 'ok');
            predictRefresh();
        } catch (err) {
            toast(friendlyError(err), 'error');
            save.disabled = false;
        }
    });
}

// 조별 예측 모아 보기 (revealed: 결과 함께) / onlyTeam: 한 조만
function predictBoardHtml({ revealed, onlyTeam = null, compact = false }) {
    const c = APP.cls;
    const teams = onlyTeam ? [onlyTeam] : Array.from({ length: c.team_count }, (_, i) => i + 1);
    const done = teams.filter((t) => predictionOf(t)).length;
    const cards = teams
        .map((t) => {
            const p = predictionOf(t);
            const mine = !isTeacher() && c.myTeam === t;
            const list = entriesOf(p);
            let score = '';
            if (revealed && list.length) {
                const vs = list.map(predictVerdict);
                const half = vs.filter((v) => v.half).length;
                score = `<span class="pred-score">✔ ${vs.filter((v) => v.hit).length}${half ? ` · △ ${half}` : ''} / ${list.length}</span>`;
            }
            return `<article class="pred-card${mine ? ' mine' : ''}">
                <h4>${t}조${mine ? ' <span class="tag">우리 조</span>' : ''}${score}</h4>
                ${
                    list.length
                        ? `<ul class="pred-list">${list
                              .map((e) => {
                                  const v = revealed ? predictVerdict(e) : null;
                                  return `<li><span>${esc(e.name)}${e.guess !== 'gone' ? ` <span class="pv-guess">${guessLabel(e.guess)}</span>` : ''}</span>${v ? `<span class="pv pv-${v.cls}">${v.label}</span>` : ''}</li>`;
                              })
                              .join('')}</ul>${p.reason ? `<p class="pred-why">💬 ${esc(p.reason)}</p>` : ''}`
                        : '<p class="muted small">아직 예측하지 않았어요</p>'
                }
            </article>`;
        })
        .join('');
    const head = onlyTeam ? '' : `<h3 class="pred-board-head">${revealed ? '🔮 예측과 결과' : '🔮 조별 예측 — 사라질 것 같은 생물'} <span class="muted small">${done}/${teams.length}조 예측함</span></h3>`;
    return `<section class="pred-board${compact ? ' compact' : ''}">${head}<div class="pred-grid">${cards}</div></section>`;
}

// 비교 화면 맨 위: 예측과 결과 (학생: 우리 조 / 교사: 모든 조)
function predictCompareHtml() {
    if (!predictionsReady() || !predictionsRevealed() || !(APP.predictions || []).length) return '';
    const team = !isTeacher() ? APP.cls.myTeam : null;
    if (team && !predictionOf(team)) return '';
    return `<section class="cmp-sec"><h3>🔮 ${team ? '우리 조' : '조별'} 예측은 맞았을까?</h3>
        ${predictBoardHtml({ revealed: true, onlyTeam: team, compact: true })}
        <p class="muted small">✔ 사라짐 · △ 줄어듦(사라지지는 않음) · ✘ 남음. 예측과 다른 생물은 왜 달랐을까요? 서식지가 덮였는지, 일부만 덮였는지, 견딘 기온 범위를 넘었는지 아래에서 찾아보세요.</p></section>`;
}

// 지도 화면의 [🔮 예측] 버튼 글자·강조
function updatePredictButton() {
    const b = $('btn-predict');
    if (!b) return;
    const revealed = predictionsRevealed();
    b.querySelector('.lbl').textContent = revealed ? '예측 결과' : '예측';
    const mine = !isTeacher() && APP.cls.myTeam;
    b.classList.toggle('pulse', !!(mine && !revealed && predictionsReady() && !predictionOf(mine)));
}
