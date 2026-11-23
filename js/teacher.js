'use strict';
// 교사 관리 창: 학반 / 지도·기록 / 조 편성 / 키워드 분류 / 미래·발표

const TP = { modal: null, tab: 'class', draft: null, clans: null };
const TP_TABS = [
    ['class', '🏫 학반'],
    ['source', '🗺️ 지도·기록'],
    ['teams', '👥 조 편성'],
    ['keywords', '🤖 키워드 분류'],
    ['future', '🌍 미래·발표'],
];

function openTeacherPanel(tab) {
    if (!isTeacher()) return;
    if (tab) TP.tab = tab;
    TP.draft = null;
    TP.modal = openModal({
        title: '⚙️ 관리',
        size: 'full',
        className: 'teacher-modal',
        body: `<nav class="tabs-row" id="tp-tabs">${TP_TABS.map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</nav><div id="tp-body" class="tp-body"></div>`,
        onClose: () => (TP.modal = null),
    });
    $('tp-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]');
        if (!b) return;
        TP.tab = b.dataset.t;
        renderTeacherPanel();
    });
    renderTeacherPanel();
}

function teacherPanelRefresh(section) {
    if (!TP.modal || !$('tp-body')) return;
    if (!section || section === TP.tab) {
        if (TP.tab === 'keywords' && TP.draft) return; // 분류를 고치는 중이면 그대로
        if (TP.tab === 'class' && document.activeElement && TP.modal.el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
        renderTeacherPanel();
    }
}

const DATA_KEYS = ['center_lat', 'center_lon', 'radius_m', 'source_kind', 'source_clan_id', 'date_from', 'date_to'];
async function saveClass(patch, msg = '저장했어요.') {
    try {
        const prevMode = APP.cls.mode;
        const updated = await API.updateClassroom(APP.cls.id, patch);
        Object.assign(APP.cls, updated);
        if (APP.cls.mode !== prevMode) renderClassroom(); // 1차시 ↔ 2차시 화면 바꾸기
        const keys = Object.keys(patch);
        if (keys.some((k) => DATA_KEYS.includes(k))) APP.data = null;
        if (keys.some((k) => DATA_KEYS.includes(k) || k === 'analysis' || k === 'future_seed')) APP.future = null;
        toast(msg, 'ok');
        refreshClassroom();
        return true;
    } catch (err) {
        toast(friendlyError(err), 'error');
        return false;
    }
}

async function renderTeacherPanel() {
    document.querySelectorAll('#tp-tabs [data-t]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === TP.tab)));
    const body = $('tp-body');
    const c = APP.cls;
    if (TP.tab === 'class') {
        body.innerHTML = `
            <div class="tp-grid">
                <div class="tp-card code-card"><span>학생 참여 코드</span><b class="big-code">${esc(c.code)}</b><span class="muted small">학생은 생태지도 계정으로 로그인한 뒤 이 코드를 넣어요.</span></div>
                <div class="tp-card">
                    <h3>수업 단계</h3>
                    <div class="seg big" id="mode-seg">
                        <button data-mode="1" aria-pressed="${c.mode === 1}">1차시<br><small>키워드 쓰기만 보임</small></button>
                        <button data-mode="2" aria-pressed="${c.mode === 2}">2차시<br><small>지도·비교·발표</small></button>
                    </div>
                    <p class="muted small">바꾸면 학생 화면도 바로 바뀌어요.</p>
                </div>
                <form class="tp-card form" id="class-form">
                    <h3>학반 정보</h3>
                    <label>학반 이름<input name="name" maxlength="40" value="${esc(c.name)}" required></label>
                    <label>조 수<input name="teams" type="number" min="1" max="12" value="${c.team_count}" required></label>
                    <button class="btn btn-primary" type="submit">저장</button>
                </form>
                <div class="tp-card danger-zone">
                    <h3>학반 지우기</h3>
                    <p class="muted small">키워드·조·포스터·별점이 모두 지워져요. 생태지도 기록은 그대로예요.</p>
                    <button class="btn btn-danger" id="class-delete">학반 지우기</button>
                </div>
            </div>`;
        $('mode-seg').addEventListener('click', (e) => {
            const b = e.target.closest('[data-mode]');
            if (b && Number(b.dataset.mode) !== c.mode) saveClass({ mode: Number(b.dataset.mode) }, `${b.dataset.mode}차시 화면으로 바꿨어요.`).then(() => renderTeacherPanel());
        });
        $('class-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const f = e.target;
            saveClass({ name: f.name.value.trim(), team_count: Math.max(1, Math.min(12, Number(f.teams.value) || 5)) });
        });
        $('class-delete').addEventListener('click', async () => {
            if (!(await confirmBox(`'${c.name}' 학반을 지울까요? 되돌릴 수 없어요.`, '지우기'))) return;
            try {
                await API.deleteClassroom(c.id);
                TP.modal.close();
                APP.classrooms = await API.myClassrooms(APP.user);
                showLobby();
            } catch (err) {
                toast(friendlyError(err), 'error');
            }
        });
        return;
    }

    if (TP.tab === 'source') {
        if (!TP.clans) {
            body.innerHTML = '<p class="muted">불러오는 중…</p>';
            try {
                TP.clans = await API.clans();
            } catch (_) {
                TP.clans = [];
            }
            if (TP.tab !== 'source') return;
        }
        const center = fin(c.center_lat) ? `${c.center_lat.toFixed(5)}, ${c.center_lon.toFixed(5)}` : '정하지 않음 (기록들의 가운데)';
        body.innerHTML = `
            <form class="form tp-form" id="source-form">
                <h3>생물 기록은 어디서 가져올까요?</h3>
                <label class="radio"><input type="radio" name="kind" value="members" ${c.source_kind === 'members' ? 'checked' : ''}> 이 학반 학생들이 생태지도에 올린 기록</label>
                <label class="radio"><input type="radio" name="kind" value="clan" ${c.source_kind === 'clan' ? 'checked' : ''}> 생태지도 클랜의 기록
                    <select name="clan">${TP.clans.map((k) => `<option value="${k.id}" ${c.source_clan_id === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
                <label class="radio"><input type="radio" name="kind" value="area" ${c.source_kind === 'area' ? 'checked' : ''}> 지도 범위 안의 모든 생태지도 기록 (누가 올렸든)</label>
                <div class="row">
                    <label>이 날짜부터<input type="date" name="from" value="${c.date_from || ''}"></label>
                    <label>이 날짜까지<input type="date" name="to" value="${c.date_to || ''}"></label>
                </div>
                <p class="muted small">1차시에 기록한 날만 고르면 그날의 생태지도가 '지금'이 돼요. 비우면 모든 날.</p>
                <h3>지도 범위 (학교)</h3>
                <p>가운데: <b id="center-text">${center}</b></p>
                <div class="row">
                    <button type="button" class="btn" id="center-from-map" ${APP.screen === 'map' && MS.map ? '' : 'disabled'}>지금 지도 가운데로 정하기</button>
                    <button type="button" class="btn" id="center-reset">기록들의 가운데로</button>
                </div>
                <p class="muted small">2차시 화면에서 지도를 학교로 옮긴 뒤 누르세요.</p>
                <label>반지름 (m)<input type="number" name="radius" min="100" max="3000" step="50" value="${c.radius_m}"></label>
                <button class="btn btn-primary btn-lg" type="submit">저장하고 다시 불러오기</button>
            </form>`;
        const form = $('source-form');
        let pendingCenter = { lat: c.center_lat, lon: c.center_lon };
        $('center-from-map').addEventListener('click', () => {
            pendingCenter = MS.map.getCenter();
            $('center-text').textContent = `${pendingCenter.lat.toFixed(5)}, ${pendingCenter.lon.toFixed(5)} (저장 전)`;
        });
        $('center-reset').addEventListener('click', () => {
            pendingCenter = { lat: null, lon: null };
            $('center-text').textContent = '기록들의 가운데 (저장 전)';
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const kind = form.kind.value;
            const ok = await saveClass({
                source_kind: kind,
                source_clan_id: kind === 'clan' && form.clan.value ? Number(form.clan.value) : null,
                date_from: form.from.value || null,
                date_to: form.to.value || null,
                center_lat: pendingCenter.lat,
                center_lon: pendingCenter.lon,
                radius_m: Math.max(100, Math.min(3000, Number(form.radius.value) || 500)),
            });
            if (ok) {
                APP.data = null;
                APP.future = null;
                if (APP.screen === 'map') showMapScreen();
            }
        });
        return;
    }

    if (TP.tab === 'teams') {
        body.innerHTML = '<p class="muted">불러오는 중…</p>';
        let members = [];
        try {
            members = await API.members(c.id);
        } catch (err) {
            body.innerHTML = `<p>${esc(friendlyError(err))}</p>`;
            return;
        }
        if (TP.tab !== 'teams') return;
        const opts = (t) => `<option value="">-</option>${Array.from({ length: c.team_count }, (_, i) => `<option value="${i + 1}" ${t === i + 1 ? 'selected' : ''}>${i + 1}조</option>`).join('')}`;
        const counts = Array.from({ length: c.team_count }, (_, i) => members.filter((m) => m.team === i + 1).length);
        body.innerHTML = `
            <div class="row between"><p>참여한 학생 <b>${members.length}명</b> · ${counts.map((n, i) => `${i + 1}조 ${n}명`).join(' · ')}</p>
                <button class="btn" id="auto-teams">들어온 순서대로 1~${c.team_count}조 나누기</button></div>
            ${
                members.length
                    ? `<table class="data"><thead><tr><th>닉네임</th><th>조</th><th></th></tr></thead><tbody>${members
                          .map((m) => `<tr><td>${esc(m.nickname || '이름 없음')}</td><td><select data-team="${esc(m.user_id)}">${opts(m.team)}</select></td><td><button class="btn btn-small btn-danger" data-kick="${esc(m.user_id)}">내보내기</button></td></tr>`)
                          .join('')}</tbody></table>`
                    : `<p class="muted">아직 아무도 들어오지 않았어요. 학생들에게 코드 <b>${esc(c.code)}</b>를 알려 주세요.</p>`
            }`;
        body.querySelectorAll('[data-team]').forEach((s) =>
            s.addEventListener('change', async () => {
                try {
                    await API.setTeam(c.id, s.dataset.team, s.value ? Number(s.value) : null);
                    toast('조를 바꿨어요.', 'ok');
                } catch (err) {
                    toast(friendlyError(err), 'error');
                }
            })
        );
        body.querySelectorAll('[data-kick]').forEach((b) =>
            b.addEventListener('click', async () => {
                if (!(await confirmBox('이 학생을 학반에서 내보낼까요?', '내보내기'))) return;
                await API.removeMember(c.id, b.dataset.kick).catch((err) => toast(friendlyError(err), 'error'));
                renderTeacherPanel();
            })
        );
        $('auto-teams').addEventListener('click', async () => {
            if (!(await confirmBox('들어온 순서대로 조를 다시 나눌까요? 지금 정한 조는 바뀌어요.', '나누기'))) return;
            for (let i = 0; i < members.length; i++) await API.setTeam(c.id, members[i].user_id, (i % c.team_count) + 1);
            toast('조를 나눴어요.', 'ok');
            renderTeacherPanel();
        });
        return;
    }

    if (TP.tab === 'keywords') {
        const groups = groupKeywords(APP.keywords);
        const saved = (c.analysis && c.analysis.items) || {};
        const draft = TP.draft || Object.fromEntries(groups.map((g) => [g.key, saved[g.key] ? { ...saved[g.key] } : { ...classifyByRules(g.text), unsaved: true }]));
        const anyUnsaved = groups.some((g) => !saved[g.key]);
        const catOpts = (v) => Object.entries(KEYWORD_CATEGORIES).map(([k, x]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${x.emoji} ${x.label}</option>`).join('');
        const sizeOpts = (v) => Object.entries(SIZE_LABEL).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
        body.innerHTML = `
            <div class="row between">
                <p>키워드 <b>${APP.keywords.length}개</b> (서로 다른 것 ${groups.length}개) · ${c.analysis ? `마지막 저장 ${esc(new Date(c.analysis.updatedAt).toLocaleString('ko-KR'))}` : '<b class="warn">아직 분류를 저장하지 않았어요</b>'}</p>
                <div class="row"><button class="btn btn-primary" id="kw-ai">🤖 AI로 분류하기</button><button class="btn btn-primary" id="kw-save">💾 분류 저장</button></div>
            </div>
            <p class="muted small">AI가 고른 종류·크기를 확인하고 틀린 것은 고쳐 주세요. 저장해야 미래 생태지도에 반영돼요. ${anyUnsaved ? '저장하지 않은 키워드는 단어 규칙으로 임시 분류돼 있어요.' : ''}</p>
            ${
                groups.length
                    ? `<div class="table-scroll"><table class="data kw-table"><thead><tr><th>키워드</th><th>쓴 수</th><th>종류</th><th>크기 (땅 넓이)</th><th>온실가스</th><th>메모</th><th></th></tr></thead><tbody>${groups
                          .map((g) => {
                              const a = draft[g.key];
                              return `<tr data-key="${esc(g.key)}"><td><b>${esc(g.text)}</b>${a.unsaved ? ' <span class="tag">미저장</span>' : ''}</td><td>${g.count}</td>
                                <td><select data-f="category">${catOpts(a.category)}</select></td>
                                <td><select data-f="size">${sizeOpts(a.size)}</select></td>
                                <td><input type="checkbox" data-f="emission" ${a.emission ? 'checked' : ''}></td>
                                <td class="muted small">${esc(a.note || '')}</td>
                                <td><button class="btn btn-small btn-danger" data-delkw="${esc(g.key)}" title="이 키워드 지우기">🗑</button></td></tr>`;
                          })
                          .join('')}</tbody></table></div>`
                    : '<p class="muted">아직 키워드가 없어요. 1차시 화면에서 학생들이 쓰면 여기에 모여요.</p>'
            }`;
        TP.draft = draft;
        body.querySelectorAll('tr[data-key]').forEach((tr) => {
            tr.querySelectorAll('[data-f]').forEach((inp) =>
                inp.addEventListener('change', () => {
                    const a = TP.draft[tr.dataset.key];
                    a[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value;
                    if (inp.dataset.f === 'category') {
                        a.size = KEYWORD_CATEGORIES[a.category].size;
                        a.emission = KEYWORD_CATEGORIES[a.category].emission;
                        tr.querySelector('[data-f=size]').value = a.size;
                        tr.querySelector('[data-f=emission]').checked = a.emission;
                    }
                    a.by = 'teacher';
                    a.unsaved = true;
                })
            );
        });
        body.querySelectorAll('[data-delkw]').forEach((b) =>
            b.addEventListener('click', async () => {
                const g = groups.find((x) => x.key === b.dataset.delkw);
                if (!g || !(await confirmBox(`'${g.text}' 키워드 ${g.count}개를 지울까요?`, '지우기'))) return;
                await API.deleteKeywords(g.ids).catch((err) => toast(friendlyError(err), 'error'));
                APP.keywords = await API.keywords(c.id);
                delete TP.draft[g.key];
                renderTeacherPanel();
            })
        );
        $('kw-ai').addEventListener('click', async () => {
            if (!groups.length) return;
            const btn = $('kw-ai');
            btn.disabled = true;
            btn.textContent = '🤖 분류하는 중…';
            try {
                const items = await API.classifyKeywords(groups.map((g) => g.text));
                items.forEach((it, i) => {
                    const g = groups.find((x) => x.text === it.keyword) || groups[i];
                    if (!g || !KEYWORD_CATEGORIES[it.category]) return;
                    TP.draft[g.key] = { category: it.category, size: SIZE_RADIUS[it.size] ? it.size : KEYWORD_CATEGORIES[it.category].size, emission: !!it.emission, note: it.note || '', by: 'ai', unsaved: true };
                });
                toast('AI가 분류했어요. 확인한 뒤 [분류 저장]을 눌러 주세요.', 'ok');
            } catch (err) {
                toast(`AI 분류를 못 했어요 (${friendlyError(err)}). 단어 규칙으로 분류해 두었으니 직접 고쳐 주세요.`, 'error');
            }
            renderTeacherPanel();
        });
        $('kw-save').addEventListener('click', async () => {
            const items = {};
            groups.forEach((g) => {
                const a = TP.draft[g.key];
                items[g.key] = { category: a.category, size: a.size, emission: !!a.emission, note: a.note || '', by: a.by || 'rule' };
            });
            const ok = await saveClass({ analysis: { items, updatedAt: new Date().toISOString() } }, '분류를 저장했어요. 미래 생태지도에 반영돼요.');
            if (ok) {
                TP.draft = null;
                APP.future = null;
                renderTeacherPanel();
            }
        });
        return;
    }

    if (TP.tab === 'future') {
        let results = [];
        try {
            results = await API.results(c.id);
        } catch (_) {
            results = [];
        }
        if (TP.tab !== 'future') return;
        body.innerHTML = `
            <div class="tp-grid">
                <div class="tp-card">
                    <h3>🌍 미래 생태지도</h3>
                    <p class="muted small">${esc(SCENARIO.label)} · 키워드 분류를 저장한 뒤 재생하세요.</p>
                    <button class="btn btn-hot btn-lg" id="tp-play">▶ 미래 보기 재생 (전자칠판)</button>
                    <label class="switch"><input type="checkbox" id="tp-future-open" ${c.future_open ? 'checked' : ''}> 학생 화면에 미래 생태지도 열기</label>
                    <p class="muted small">재생이 끝나면 자동으로 열려요.</p>
                    <button class="btn" id="tp-reseed">🔀 시설 배치 다시 섞기</button>
                </div>
                <div class="tp-card">
                    <h3>🏆 발표 별점</h3>
                    <label class="switch"><input type="checkbox" id="tp-results" ${c.results_open ? 'checked' : ''}> 결과(평균·순위) 모두에게 공개</label>
                    <p class="muted small">공개하면 별점 주기가 닫혀요. 누가 몇 점을 줬는지는 선생님도 볼 수 없어요.</p>
                    <table class="data"><thead><tr><th>조</th><th>별점 수</th><th>평균</th></tr></thead><tbody>${
                        results.length ? results.map((r) => `<tr><td>${r.team}조 ${esc(r.title || '')}</td><td>${r.raters}</td><td>${r.raters ? Number(r.total).toFixed(2) : '-'}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">올라온 포스터가 없어요</td></tr>'
                    }</tbody></table>
                </div>
            </div>`;
        $('tp-play').addEventListener('click', async () => {
            if (!c.analysis && !(await confirmBox('키워드 분류를 저장하지 않았어요. 단어 규칙으로 임시 분류한 채로 재생할까요?', '재생'))) return;
            TP.modal.close();
            if (c.mode !== 2) await saveClass({ mode: 2 }, '2차시 화면으로 바꿨어요.');
            const wait = () => (MS.map ? Promise.resolve() : sleep(300).then(wait));
            await wait();
            playFuture();
        });
        $('tp-future-open').addEventListener('change', (e) => saveClass({ future_open: e.target.checked }, e.target.checked ? '학생에게 미래 지도를 열었어요.' : '미래 지도를 다시 닫았어요.'));
        $('tp-results').addEventListener('change', (e) => saveClass({ results_open: e.target.checked }, e.target.checked ? '결과를 공개했어요.' : '결과를 다시 숨겼어요.'));
        $('tp-reseed').addEventListener('click', async () => {
            if (await confirmBox('키워드 시설의 위치를 새로 섞을까요? 학생 화면의 미래 지도도 바뀌어요.', '섞기')) saveClass({ future_seed: Math.floor(Math.random() * 1e6) }, '배치를 새로 섞었어요.');
        });
    }
}
