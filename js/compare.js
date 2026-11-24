'use strict';
// 시뮬레이션 전과 비교 (2차시 전개 1)
//   기본: (가) 두 지도 (나) 종류별 숫자 (다) 종 목록
//   펼쳐 보기: (마) 우리 동네 환경 (바) 근거 자료 (라) 개화 시기
// 종 카드에는 '원인'을 쓰지 않고 '특성'(같은 계절에 관찰된 기온 등)만 보여 줍니다. 원인은 학생이 추론합니다.

const CMP = { metric: 'species', list: 'gone' };
const SERIES = { now: '#2a78d6', future: '#eb6834' }; // 지금 / 미래

async function openCompare() {
    const f = await ensureFuture();
    const c = f.counts;
    const m = openModal({
        title: `⚖️ 시뮬레이션 전과 비교 — 지금 vs ${esc(SCENARIO.short)}`,
        size: 'full',
        className: 'compare-modal',
        body: `
        <div class="cmp-stats">
            <div class="stat"><span>생물 종</span><b>${c.speciesNow} → ${c.speciesFuture}<small>종</small></b></div>
            <div class="stat"><span>생물 기록</span><b>${c.recordsNow} → ${c.recordsFuture}<small>건</small></b></div>
            <div class="stat"><span>사라진 종</span><b>${c.gone}<small>종</small></b></div>
            <div class="stat"><span>새로 온 종</span><b>${c.newcomers}<small>종</small></b></div>
        </div>
        ${predictCompareHtml()}
        <section class="cmp-sec">
            <h3>두 생태지도</h3>
            <div class="mini-maps">
                <figure><figcaption>지금 (1차시 기록)</figcaption><svg class="mini" id="mini-now" viewBox="0 0 400 400" role="img" aria-label="지금 생태지도"></svg></figure>
                <figure><figcaption>${esc(SCENARIO.short)} (시뮬레이션)</figcaption><svg class="mini" id="mini-future" viewBox="0 0 400 400" role="img" aria-label="미래 생태지도"></svg></figure>
            </div>
            <div class="map-legend inline"><span><i class="lg lg-ok"></i>생물</span><span><i class="lg lg-gone">✕</i>사라진 생물</span><span><i class="lg lg-new">★</i>새로 온 생물</span><span><i class="lg lg-fac"></i>새로 생긴 시설</span></div>
        </section>
        <section class="cmp-sec">
            <div class="sec-head"><h3>종류별로 보면</h3>
                <div class="seg small" id="metric-seg"><button data-m="species">종 수</button><button data-m="records">기록 수</button></div></div>
            <div class="chart-legend"><span><i style="background:${SERIES.now}"></i>지금</span><span><i style="background:${SERIES.future}"></i>${esc(SCENARIO.short)}</span></div>
            <div id="type-chart"></div>
        </section>
        <section class="cmp-sec">
            <h3>어떤 생물이 바뀌었을까?</h3>
            ${indicatorSummary(f)}
            <div class="tabs-row" id="list-tabs"></div>
            <div class="species-grid" id="species-grid"></div>
        </section>
        <details class="cmp-more"><summary>🏘️ 우리 동네 환경은 어떻게 바뀌었을까?</summary><div id="env-table"></div></details>
        <details class="cmp-more"><summary>🌸 봄꽃은 언제 필까?</summary><div id="pheno-table"></div></details>
        <details class="cmp-more"><summary>📚 이 시뮬레이션의 근거 자료</summary><div id="source-list"></div></details>`,
    });
    drawMini($('mini-now'), f, false);
    drawMini($('mini-future'), f, true);
    $('metric-seg').addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        CMP.metric = b.dataset.m;
        renderTypeChart(f);
    });
    renderTypeChart(f);
    renderSpeciesLists(f);
    renderEnv(f);
    renderPheno(f);
    $('source-list').innerHTML = SOURCES.map((s) => `<div class="source"><b>${esc(s.title)}</b><p>${esc(s.body)}</p><span class="muted small">출처: ${esc(s.from)}</span></div>`).join('');
    return m;
}

// 우리 기록 속 국가 기후변화 생물지표종
function indicatorSummary(f) {
    const here = f.species.filter((s) => s.indicator);
    const comers = f.newcomers.filter((n) => n.indicator);
    if (!here.length && !comers.length) return '<p class="muted small">우리 기록에는 국가 기후변화 생물지표종(100종)이 없어요.</p>';
    const by = (st) => here.filter((s) => s.status === st).length;
    return `<p class="ind-summary">🌡️ 우리 기록 속 <b>국가 기후변화 생물지표종 ${here.length}종</b>
        — 사라짐 ${by('gone')} · 줄어듦 ${by('declined')} · 남음 ${by('survived')}${comers.length ? ` · 새로 옴 ${comers.length}` : ''}</p>`;
}

// (가) 작은 지도 두 개 (같은 축척)
function drawMini(svg, f, future) {
    const R = f.radiusM;
    const k = Math.cos((f.center.lat * Math.PI) / 180) * 111320;
    const s = 185 / R;
    const P = (p) => ({ x: 200 + (p.lon - f.center.lon) * k * s, y: 200 - (p.lat - f.center.lat) * 110540 * s });
    let out = `<circle cx="200" cy="200" r="${R * s}" class="mini-area"/>`;
    if (future) {
        f.facilities.forEach((x) => {
            const p = P(x);
            out += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(x.radius * s).toFixed(1)}" class="mini-fac${x.category === 'green' ? ' green' : ''}"><title>${esc(x.text)}</title></circle>`;
        });
    }
    f.fates.forEach((x) => {
        const r = x.rec;
        if (!fin(r.lat)) return;
        const p = P(r);
        const gone = future && (x.fate === 'habitat' || x.fate === 'heat');
        const part = future && !gone && x.partial;
        if (r.coords) {
            const pts = r.coords.map((c) => P(c)).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
            const color = gone ? '#9ca3af' : TYPE_COLOR[r.type];
            const dash = gone || part ? ' stroke-dasharray="4 3"' : '';
            out += r.shape === 'area'
                ? `<polygon points="${pts}" fill="${color}" fill-opacity="${gone || part ? 0.2 : 0.35}" stroke="${color}" stroke-width="1.5"${dash}/>`
                : `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"${dash}/>`;
        }
        out += gone
            ? `<text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" class="mini-gone">✕<title>${esc(r.name)}</title></text>`
            : `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${TYPE_COLOR[r.type]}" class="mini-dot"${part ? ' fill-opacity="0.45"' : ''}><title>${esc(r.name)}${part ? ' (일부만 남음)' : ''}</title></circle>`;
    });
    if (future) {
        f.newcomers.forEach((n) => {
            const p = P(n);
            out += `<text x="${p.x.toFixed(1)}" y="${(p.y + 6).toFixed(1)}" class="mini-new">★<title>${esc(n.name)}</title></text>`;
        });
    }
    svg.innerHTML = out;
}

// (나) 종류별 막대 (지금 vs 미래)
function renderTypeChart(f) {
    document.querySelectorAll('#metric-seg [data-m]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === CMP.metric)));
    const key = CMP.metric === 'species' ? ['speciesNow', 'speciesFuture'] : ['recordsNow', 'recordsFuture'];
    const unit = CMP.metric === 'species' ? '종' : '건';
    const max = Math.max(1, ...f.types.flatMap((t) => [t[key[0]], t[key[1]]]));
    const W = 640;
    const H = 230;
    const base = 196;
    const top = 26;
    const groupW = W / f.types.length;
    const barW = Math.min(46, groupW / 3.2);
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="종류별 ${unit} 비교">`;
    svg += `<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="axis"/>`;
    f.types.forEach((t, i) => {
        const cx = groupW * i + groupW / 2;
        [0, 1].forEach((j) => {
            const v = t[key[j]];
            const h = ((base - top) * v) / max;
            const x = cx + (j === 0 ? -barW - 3 : 3);
            svg += `<rect x="${x}" y="${base - h}" width="${barW}" height="${Math.max(0, h)}" rx="4" fill="${j === 0 ? SERIES.now : SERIES.future}"><title>${t.type} ${j === 0 ? '지금' : SCENARIO.short}: ${v}${unit}</title></rect>`;
            svg += `<text x="${x + barW / 2}" y="${base - h - 6}" text-anchor="middle" class="bar-val">${v}</text>`;
        });
        svg += `<text x="${cx}" y="${base + 22}" text-anchor="middle" class="bar-label">${typeEmoji(t.type)} ${t.type}</text>`;
    });
    svg += '</svg>';
    $('type-chart').innerHTML = svg;
}

// (다) 종 목록
function renderSpeciesLists(f) {
    // 기록이 많은 종부터 (익숙한 생물이 먼저 보이게). 한 번에 12종씩 보여 주고 [더 보기]
    const byRecords = (a, b) => b.now - a.now || a.name.localeCompare(b.name, 'ko');
    const lists = {
        gone: { label: '사라진 종', items: f.species.filter((s) => s.status === 'gone').sort(byRecords) },
        declined: { label: '줄어든 종', items: f.species.filter((s) => s.status === 'declined').sort(byRecords) },
        survived: { label: '남은 종', items: f.species.filter((s) => s.status === 'survived').sort(byRecords) },
        new: { label: '새로 온 종', items: f.newcomers },
    };
    const PAGE = 12;
    let shown = PAGE;
    const draw = () => {
        $('list-tabs').innerHTML = Object.entries(lists)
            .map(([k, v]) => `<button data-l="${k}" aria-pressed="${CMP.list === k}">${v.label} <b>${v.items.length}</b></button>`)
            .join('');
        const items = lists[CMP.list].items;
        const rest = items.length - shown;
        $('species-grid').innerHTML = items.length
            ? items.slice(0, shown).map((s) => speciesCard(s, CMP.list)).join('') +
              (rest > 0
                  ? `<div class="sp-more"><span class="muted">${shown}종 보는 중 · ${rest}종 더 있음 (기록이 많은 종부터)</span><button class="btn btn-small" data-more="1">${Math.min(PAGE, rest)}종 더 보기</button>${rest > PAGE ? '<button class="btn btn-small" data-more="all">모두 보기</button>' : ''}</div>`
                  : '')
            : '<p class="muted">해당하는 생물이 없어요.</p>';
    };
    $('list-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-l]');
        if (!b) return;
        CMP.list = b.dataset.l;
        shown = PAGE;
        draw();
    });
    $('species-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-more]');
        if (!b) return;
        shown = b.dataset.more === 'all' ? Infinity : shown + PAGE;
        draw();
    });
    draw();
}

function speciesCard(s, kind) {
    const pic = s.imageUrl ? `<img src="${esc(s.imageUrl)}" alt="" loading="lazy">` : `<span class="sp-emoji">${typeEmoji(s.type)}</span>`;
    let lines = '';
    if (kind === 'new' && s.fromList) {
        lines = '<li>지금은 주로 남부 지방에 사는 생물</li><li>기온이 오르면 북쪽으로 퍼질 것으로 예상됨</li>';
    } else if (kind === 'new') {
        lines = `<li>다른 지역에서 ${s.month}월 무렵 관찰</li><li>그때 기온 ${fmt1(s.lo)}~${fmt1(s.hi)}℃ (기록 ${s.refs}건)</li>`;
    } else {
        lines = `<li>기록 ${s.now}건 → ${s.future}건</li>`;
        if (fin(s.lo)) lines += `<li>같은 계절에 관찰된 기온 ${fmt1(s.lo)}~${fmt1(s.hi)}℃${s.fromGroup ? ' (같은 종류 평균)' : ''}</li>`;
    }
    return `<div class="sp-card sp-${kind}">
        <div class="sp-pic">${pic}</div>
        <div class="sp-body">${s.indicator ? '<span class="ind-badge" title="국가 기후변화 생물지표종 (2024)">🌡️ 기후변화 생물지표종</span>' : ''}<b>${esc(s.name)}</b><span class="muted small">${typeEmoji(s.type)} ${esc(s.type)}${s.sci ? ` · <i>${esc(s.sci)}</i>` : ''}</span><ul>${lines}</ul></div>
    </div>`;
}

// (마) 우리 동네 환경
function renderEnv(f) {
    const e = f.env;
    const L = LOCAL_CLIMATE;
    const ready = (v) => (v === null || v === undefined ? '<span class="muted">자료 준비 중</span>' : v);
    const rows = [
        ['평균 기온 변화', `<b>+${e.dT.toFixed(1)}℃</b>`, `기후변화 +${e.dTClimate.toFixed(1)}℃ (${esc(SCENARIO.dTNote)}) + 도시 열섬 +${e.heatIsland.toFixed(1)}℃`],
        ['연평균 기온', L.annualTempNow == null ? ready(null) : `${fmt1(L.annualTempNow)}℃ → <b>${fmt1(L.annualTempNow + e.dT)}℃</b>`, '기상청 기후정보포털'],
        ['폭염일수 (일 최고 33℃ 이상)', L.hotDaysNow == null ? ready(null) : `${L.hotDaysNow}일 → <b>${L.hotDaysFuture}일</b>`, '기상청 기후정보포털'],
        ['녹지 (생물이 기록된 곳)', `<b>−${Math.round(e.greenLossPct)}%</b>`, '키워드 시설이 들어선 만큼'],
        ['건물·아스팔트로 덮인 땅', `<b>+${e.imperviousPct.toFixed(1)}%p</b>`, `학교 둘레 반지름 ${f.radiusM}m 안 기준 (약 ${Math.round(e.builtAreaM2).toLocaleString()}㎡)`],
        ['새로 생긴 시설', `<b>${e.facilities}곳</b>${e.greenFacilities ? ` + 녹지 ${e.greenFacilities}곳` : ''}`, `온실가스를 내는 시설 ${e.emitters}곳`],
    ];
    $('env-table').innerHTML = `<table class="data"><thead><tr><th>항목</th><th>지금 → ${esc(SCENARIO.short)}</th><th>설명</th></tr></thead><tbody>${rows
        .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="muted small">${r[2]}</td></tr>`)
        .join('')}</tbody></table>`;
}

// (라) 봄꽃 시기
function renderPheno(f) {
    if (!f.phenology.length) {
        $('pheno-table').innerHTML = '<p class="muted">봄(5월까지)에 기록된 식물이 없어요.</p>';
        return;
    }
    $('pheno-table').innerHTML = `<p class="muted small">봄 기온이 1℃ 오를 때 개화가 ${PHENOLOGY.springDaysPerC}일 빨라진다는 연구를 적용했어요. (기온 +${f.env.dT.toFixed(1)}℃ → 약 ${Math.round(-f.springShift)}일)</p>
        <table class="data"><thead><tr><th>식물</th><th>지금 기록한 날</th><th>${esc(SCENARIO.short)} 예상</th></tr></thead><tbody>${f.phenology
            .map((p) => `<tr><td>${typeEmoji(p.type)} ${esc(p.name)}</td><td>${formatDoy(p.now)}</td><td><b>${formatDoy(p.future)}</b></td></tr>`)
            .join('')}</tbody></table>`;
}
