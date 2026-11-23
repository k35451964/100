'use strict';
// 발표: 조별 포스터 갤러리, 포스터 올리기, 크게 보기(발표), 익명 별점, 결과 공개

const CRITERIA = [
    ['aesthetic', '미적 완성도'],
    ['creativity', '창의성'],
    ['solving', '문제 해결력'],
];
const GAL = { modal: null, mine: new Map(), results: [] };

async function openGallery() {
    GAL.modal = openModal({ title: '🖼️ 포스터 갤러리', size: 'full', className: 'gallery-modal', body: '<div id="gallery-body" class="gallery-body"><p class="muted">불러오는 중…</p></div>', onClose: () => (GAL.modal = null) });
    await galleryRefresh();
}

async function galleryRefresh() {
    if (!GAL.modal || !$('gallery-body')) return;
    const c = APP.cls;
    const posters = APP.posters;
    try {
        const mine = await API.myRatings(posters.map((p) => p.id));
        GAL.mine = new Map(mine.map((r) => [r.poster_id, r]));
        GAL.results = isTeacher() || c.results_open ? await API.results(c.id) : [];
    } catch (err) {
        toast(friendlyError(err), 'error');
    }
    const teams = Array.from({ length: c.team_count }, (_, i) => i + 1);
    const byTeam = new Map(posters.map((p) => [p.team, p]));
    const resByTeam = new Map(GAL.results.map((r) => [r.team, r]));
    const ranked = GAL.results.filter((r) => r.raters > 0).sort((a, b) => b.total - a.total);
    const rankOf = new Map(ranked.map((r, i) => [r.team, i + 1]));

    let head = '';
    if (isTeacher()) {
        const done = GAL.results.reduce((a, r) => a + r.raters, 0);
        head = `<div class="gal-bar">
            <span class="muted">별점 ${done}개 모임 · 누가 몇 점을 줬는지는 선생님도 볼 수 없어요</span>
            <button class="btn ${c.results_open ? '' : 'btn-primary'}" id="results-toggle">${c.results_open ? '🙈 결과 다시 숨기기' : '🏆 결과 공개'}</button>
        </div>`;
    } else {
        // 갤러리 워크: 우리 조 포스터를 책상 위 태블릿에 크게 띄우고, 다른 조를 돌며 별점
        const others = posters.filter((p) => p.team !== c.myTeam);
        const ratedN = others.filter((p) => GAL.mine.has(p.id)).length;
        const mineP = c.myTeam ? byTeam.get(c.myTeam) : null;
        const progress = c.results_open
            ? '<span class="muted">🏆 결과가 공개됐어요</span>'
            : others.length
              ? `<span class="rate-progress${ratedN === others.length ? ' done' : ''}">${ratedN === others.length ? '✅ 별점을 다 줬어요' : `⭐ 별점 ${ratedN}/${others.length}조`}</span>`
              : '<span class="muted">다른 조 포스터가 올라오면 별점을 주세요 (이름 없이)</span>';
        head = `<div class="gal-bar"><span>${c.myTeam ? `우리 조: <b>${c.myTeam}조</b>` : '조 배정 전이에요'}</span>
            ${progress}
            ${mineP && mineP.image_url ? '<button class="btn btn-small btn-violet" id="show-mine">📺 우리 조 포스터 띄우기</button>' : ''}</div>`;
    }
    let podium = '';
    if (c.results_open && ranked.length) {
        podium = `<div class="results">
            <h3>🏆 결과</h3>
            <table class="data results-table"><thead><tr><th>순위</th><th>조</th>${CRITERIA.map(([, l]) => `<th>${l}</th>`).join('')}<th>평균</th><th>참여</th></tr></thead>
            <tbody>${ranked
                .map(
                    (r, i) => `<tr><td class="rank rank-${i + 1}">${i + 1}</td><td><b>${r.team}조</b> ${esc(r.title || '')}</td>
                    ${CRITERIA.map(([k]) => `<td>${starBar(r[k])}</td>`).join('')}<td><b>${Number(r.total).toFixed(2)}</b></td><td class="muted">${r.raters}명</td></tr>`
                )
                .join('')}</tbody></table></div>`;
    }
    const cards = teams
        .map((team) => {
            const p = byTeam.get(team);
            const mineTeam = !isTeacher() && c.myTeam === team;
            const canEdit = isTeacher() || mineTeam;
            const rated = p && GAL.mine.get(p.id);
            const res = resByTeam.get(team);
            const rank = c.results_open ? rankOf.get(team) : null;
            let actions = '';
            if (canEdit) actions += `<button class="btn btn-small" data-edit="${team}">✏️ ${p ? '포스터 바꾸기' : '포스터 올리기'}</button>`;
            if (p && !isTeacher() && !mineTeam && !c.results_open) actions += `<button class="btn btn-small ${rated ? '' : 'btn-primary'}" data-rate="${p.id}">⭐ ${rated ? '별점 바꾸기' : '별점 주기'}</button>`;
            if (p && isTeacher()) actions += `<button class="btn btn-small btn-danger" data-del="${p.id}" title="포스터 지우기">🗑</button>`;
            return `<article class="poster-card${mineTeam ? ' mine' : ''}">
                ${rank ? `<div class="rank-badge rank-${rank}">${rank}위</div>` : ''}
                <button class="poster-img" ${p && p.image_url ? `data-show="${team}"` : 'disabled'}>
                    ${p && p.image_url ? `<img src="${esc(p.image_url)}" alt="${team}조 포스터" loading="lazy">` : '<span class="muted">아직 포스터가 없어요</span>'}
                </button>
                <div class="poster-info">
                    <h4>${team}조${p && p.title ? ` · ${esc(p.title)}` : ''}${mineTeam ? ' <span class="tag">우리 조</span>' : ''}</h4>
                    ${p && p.description ? `<p class="poster-desc">${esc(p.description)}</p>` : ''}
                    ${rated ? `<p class="muted small">내 별점: ${CRITERIA.map(([k, l]) => `${l} ${rated[k]}`).join(' · ')}</p>` : ''}
                    ${isTeacher() && res ? `<p class="muted small">별점 ${res.raters}명${res.raters ? ` · 평균 ${Number(res.total).toFixed(2)}` : ''}</p>` : ''}
                    <div class="poster-actions">${actions}</div>
                </div>
            </article>`;
        })
        .join('');
    $('gallery-body').innerHTML = `${head}${podium}<div class="poster-grid">${cards}</div>`;
    const body = $('gallery-body');
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openPosterEditor(Number(b.dataset.edit))));
    body.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => openRating(Number(b.dataset.rate))));
    body.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => openPresentation(Number(b.dataset.show))));
    body.querySelectorAll('[data-del]').forEach((b) =>
        b.addEventListener('click', async () => {
            const p = APP.posters.find((x) => x.id === Number(b.dataset.del));
            if (!p || !(await confirmBox(`${p.team}조 포스터를 지울까요? 받은 별점도 함께 지워져요.`, '지우기'))) return;
            try {
                await API.deletePoster(p);
                APP.posters = await API.posters(APP.cls.id);
                galleryRefresh();
            } catch (err) {
                toast(friendlyError(err), 'error');
            }
        })
    );
    const sm = $('show-mine');
    if (sm) sm.addEventListener('click', () => openPresentation(c.myTeam, { single: true }));
    const rt = $('results-toggle');
    if (rt)
        rt.addEventListener('click', async () => {
            try {
                await API.updateClassroom(c.id, { results_open: !c.results_open });
                c.results_open = !c.results_open;
                galleryRefresh();
            } catch (err) {
                toast(friendlyError(err), 'error');
            }
        });
}

function starBar(v) {
    if (v === null || v === undefined) return '-';
    const n = Number(v);
    return `<span class="stars" style="--v:${(n / 5) * 100}%" aria-label="${n.toFixed(2)}점"></span> ${n.toFixed(1)}`;
}

// 포스터 올리기·바꾸기 (조마다 1장)
function openPosterEditor(team) {
    const old = APP.posters.find((p) => p.team === team) || null;
    const m = openModal({
        title: `✏️ ${team}조 포스터`,
        size: 'wide',
        body: `<form class="form poster-form" id="poster-form">
            <div class="poster-preview" id="poster-preview">${old && old.image_url ? `<img src="${esc(old.image_url)}" alt="">` : '<span class="muted">생성형 AI로 만든 포스터 그림을 골라 주세요</span>'}</div>
            <label>포스터 그림 (png·jpg, 10MB까지)<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" ${old ? '' : 'required'}></label>
            <label>조 이름<input name="title" maxlength="40" value="${esc(old ? old.title : '')}" placeholder="예: 지구지킴이"></label>
            <label>포스터 설명 (두 생태지도를 비교해 알아낸 것, 해결 방안 등)<textarea name="description" rows="7">${esc(old ? old.description : '')}</textarea></label>
            <div class="row-end"><button type="submit" class="btn btn-primary btn-lg">저장</button></div>
        </form>`,
    });
    const form = $('poster-form');
    form.file.addEventListener('change', () => {
        const f = form.file.files[0];
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) {
            toast('그림이 너무 커요. 10MB 이하로 골라 주세요.', 'error');
            form.file.value = '';
            return;
        }
        $('poster-preview').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
    });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = '올리는 중…';
        try {
            await API.savePoster(APP.cls.id, team, { title: form.title.value.trim(), description: form.description.value.trim(), file: form.file.files[0] || null, old });
            APP.posters = await API.posters(APP.cls.id);
            m.close();
            toast('포스터를 저장했어요.', 'ok');
            galleryRefresh();
        } catch (err) {
            toast(friendlyError(err), 'error');
            btn.disabled = false;
            btn.textContent = '저장';
        }
    });
}

// 별점 (익명, 1~5점 × 3기준)
function openRating(posterId) {
    const p = APP.posters.find((x) => x.id === posterId);
    if (!p) return;
    const old = GAL.mine.get(posterId) || {};
    const scores = { aesthetic: old.aesthetic || 0, creativity: old.creativity || 0, solving: old.solving || 0 };
    const m = openModal({
        title: `⭐ ${p.team}조${p.title ? ` · ${esc(p.title)}` : ''} 별점`,
        size: 'small',
        body: `<p class="muted small">이름 없이 저장돼요. 결과가 공개되기 전까지 바꿀 수 있어요.</p>
            ${CRITERIA.map(([k, l]) => `<div class="rate-row"><span>${l}</span><div class="star-input" data-k="${k}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n}점">★</button>`).join('')}</div></div>`).join('')}
            <div class="row-end"><button class="btn btn-primary btn-lg" id="rate-save">저장</button></div>`,
    });
    const paint = () =>
        m.body.querySelectorAll('.star-input').forEach((row) => {
            row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) <= scores[row.dataset.k]));
        });
    m.body.querySelectorAll('.star-input').forEach((row) =>
        row.addEventListener('click', (e) => {
            const b = e.target.closest('[data-n]');
            if (!b) return;
            scores[row.dataset.k] = Number(b.dataset.n);
            paint();
        })
    );
    paint();
    $('rate-save').addEventListener('click', async () => {
        if (CRITERIA.some(([k]) => !scores[k])) return toast('세 가지 모두 별점을 골라 주세요.', 'error');
        try {
            await API.rate(posterId, scores);
            m.close();
            toast('별점을 저장했어요.', 'ok');
            galleryRefresh();
        } catch (err) {
            toast(friendlyError(err), 'error');
        }
    });
}

// 크게 보기 (전자칠판 발표 / 갤러리 워크: single = 우리 조 포스터만, 책상 위 태블릿에 띄워 둠)
function openPresentation(team, { single = false } = {}) {
    const teams = single ? [team] : APP.posters.filter((p) => p.image_url).map((p) => p.team).sort((a, b) => a - b);
    let i = Math.max(0, teams.indexOf(team));
    const wrap = document.createElement('div');
    wrap.className = `present${single ? ' single' : ''}`;
    document.body.appendChild(wrap);
    const draw = () => {
        const p = APP.posters.find((x) => x.team === teams[i]);
        wrap.innerHTML = `<button class="present-x" aria-label="닫기">✕</button>
            <button class="present-nav prev" aria-label="이전">‹</button>
            <div class="present-img"><img src="${esc(p.image_url)}" alt="${p.team}조 포스터"></div>
            <aside class="present-side"><h2>${p.team}조${p.title ? `<br><span>${esc(p.title)}</span>` : ''}</h2><p>${esc(p.description || '')}</p></aside>
            <button class="present-nav next" aria-label="다음">›</button>`;
        wrap.querySelector('.present-x').onclick = close;
        wrap.querySelector('.prev').onclick = () => move(-1);
        wrap.querySelector('.next').onclick = () => move(1);
    };
    const move = (d) => {
        i = (i + d + teams.length) % teams.length;
        draw();
    };
    const onKey = (e) => {
        if (['Escape', 'ArrowRight', 'ArrowLeft'].includes(e.key)) e.stopPropagation(); // 뒤의 갤러리 창은 그대로
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowRight') move(1);
        if (e.key === 'ArrowLeft') move(-1);
    };
    function close() {
        wrap.remove();
        document.removeEventListener('keydown', onKey, true);
    }
    document.addEventListener('keydown', onKey, true);
    draw();
}
