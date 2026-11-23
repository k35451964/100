'use strict';
// 지도: 카카오맵 (못 불러오면 간단한 점 지도로 대신)
//
// 화면 코드는 map.render(view) 로 지금 보여 줄 모습만 넘깁니다.
//   view.records    [{ id, lat, lon, type, name, state }]   state: 'now' | 'ok' | 'gone' | 'hidden'
//   view.facilities [{ key, lat, lon, radius, emoji, text, count, green, visible }]
//   view.newcomers  [{ id, lat, lon, name, type, visible }]
//   view.area       { lat, lon, radius } (선택: 학교 범위 원)

function kakaoReady(timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!window.kakao || !kakao.maps || typeof kakao.maps.load !== 'function') return resolve(false);
        const timer = setTimeout(() => resolve(false), timeoutMs);
        try {
            kakao.maps.load(() => {
                clearTimeout(timer);
                resolve(true);
            });
        } catch (_) {
            clearTimeout(timer);
            resolve(false);
        }
    });
}

async function createMap(el, { center, radius = 500, onPick = null, interactive = true } = {}) {
    const ok = await kakaoReady();
    if (ok) {
        try {
            return createKakaoMap(el, { center, radius, onPick, interactive });
        } catch (err) {
            console.warn('카카오 지도를 만들지 못했어요:', err);
        }
    }
    // 카카오가 안 되면 OpenStreetMap 지도 (카카오 개발자 콘솔에 이 주소가 등록되기 전 등)
    if (window.L && L.map) {
        try {
            return createLeafletMap(el, { center, radius, onPick, interactive });
        } catch (err) {
            console.warn('OpenStreetMap 지도를 만들지 못해 간단한 지도로 보여 줍니다:', err);
        }
    }
    return createSvgMap(el, { center, radius, onPick });
}

// ===== OpenStreetMap (Leaflet) =====
function createLeafletMap(el, { center, radius, onPick, interactive }) {
    el.innerHTML = '';
    const map = L.map(el, {
        zoomControl: interactive,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        touchZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
        attributionControl: true,
    });
    if (interactive) map.zoomControl.setPosition('topright');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const icon = (html, cls = '') => L.divIcon({ className: `lf-icon ${cls}`, html: `<div class="lf-center">${html}</div>`, iconSize: [0, 0] });
    const recs = new Map();
    const facs = new Map();
    const news = new Map();
    let areaCircle = null;
    function fitArea(c, r) {
        map.fitBounds(L.latLng(c.lat, c.lon).toBounds(r * 2), { padding: [10, 10] });
    }
    fitArea(center, radius);
    return {
        kind: 'leaflet',
        getCenter() {
            const c = map.getCenter();
            return { lat: c.lat, lon: c.lng };
        },
        fitArea,
        relayout() {
            map.invalidateSize();
        },
        render(view) {
            if (view.area && !areaCircle) {
                areaCircle = L.circle([view.area.lat, view.area.lon], { radius: view.area.radius, color: '#10b981', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
            }
            (view.records || []).forEach((r) => {
                let o = recs.get(r.id);
                if (!o) {
                    const m = L.marker([r.lat, r.lon], { icon: icon(`<div class="dot" style="--c:${TYPE_COLOR[r.type] || '#64748b'}"></div>`), keyboard: false });
                    if (onPick) m.on('click', () => onPick(r));
                    o = { m, shown: false, cls: '' };
                    recs.set(r.id, o);
                }
                const show = r.state !== 'hidden';
                if (show !== o.shown) {
                    show ? o.m.addTo(map) : o.m.remove();
                    o.shown = show;
                }
                const node = o.m.getElement() && o.m.getElement().querySelector('.dot');
                const cls = dotClass(r);
                if (node && node.className !== cls) node.className = cls;
                if (r.coords) {
                    const look = shapeLook(r);
                    if (!o.shape) {
                        const ll = r.coords.map((c) => [c.lat, c.lon]);
                        o.shape = r.shape === 'area' ? L.polygon(ll) : L.polyline(ll);
                        if (onPick) o.shape.on('click', () => onPick(r));
                    }
                    if (o.shapeKey !== look.key) {
                        o.shape.setStyle({ color: look.color, weight: look.weight, opacity: 0.9, dashArray: look.gone ? '5 5' : null, fillColor: look.color, fillOpacity: look.fillOpacity });
                        o.shapeKey = look.key;
                    }
                    const showShape = r.state !== 'hidden';
                    if (showShape !== !!o.shapeShown) {
                        showShape ? o.shape.addTo(map) : o.shape.remove();
                        o.shapeShown = showShape;
                    }
                }
            });
            (view.facilities || []).forEach((f) => {
                let o = facs.get(f.key);
                if (!o) {
                    const circle = L.circle([f.lat, f.lon], { radius: f.radius, color: f.green ? '#15803d' : '#475569', weight: 1, fillColor: f.green ? '#22c55e' : '#64748b', fillOpacity: f.green ? 0.3 : 0.55, interactive: false });
                    const label = L.marker([f.lat, f.lon], {
                        icon: icon(`<div class="fac${f.green ? ' fac-green' : ''}"><span class="fac-emoji">${f.emoji}</span><span class="fac-text">${esc(f.text)}</span>${f.count > 1 ? `<span class="fac-count">×${f.count}</span>` : ''}</div>`),
                        interactive: false,
                        zIndexOffset: 1000,
                    });
                    o = { circle, label, shown: false };
                    facs.set(f.key, o);
                }
                if (f.visible !== o.shown) {
                    if (f.visible) {
                        o.circle.addTo(map);
                        o.label.addTo(map);
                    } else {
                        o.circle.remove();
                        o.label.remove();
                    }
                    o.shown = f.visible;
                }
            });
            (view.newcomers || []).forEach((n) => {
                let o = news.get(n.id);
                if (!o) {
                    const m = L.marker([n.lat, n.lon], { icon: icon(`<div class="newcomer">★<span>${esc(n.name)}</span></div>`), zIndexOffset: 2000 });
                    if (onPick) m.on('click', () => onPick({ ...n, state: 'new' }));
                    o = { m, shown: false };
                    news.set(n.id, o);
                }
                if (n.visible !== o.shown) {
                    n.visible ? o.m.addTo(map) : o.m.remove();
                    o.shown = n.visible;
                }
            });
        },
        clear() {
            recs.forEach((o) => {
                o.m.remove();
                if (o.shape) o.shape.remove();
            });
            facs.forEach((o) => {
                o.circle.remove();
                o.label.remove();
            });
            news.forEach((o) => o.m.remove());
            recs.clear();
            facs.clear();
            news.clear();
            if (areaCircle) areaCircle.remove();
            areaCircle = null;
        },
    };
}

function dotClass(r) {
    return `dot dot-${r.state}`;
}

// 선·면 기록의 모양 (생태지도와 같게: 면은 종류 색 40% 채움, 선은 굵은 선 / 사라지면 회색 점선)
function shapeLook(r) {
    const gone = r.state === 'gone';
    const color = gone ? '#9ca3af' : TYPE_COLOR[r.type] || '#64748b';
    return { key: `${r.state}`, color, gone, fillOpacity: gone ? 0.18 : 0.4, weight: r.shape === 'area' ? 2 : 4 };
}

// ===== 카카오맵 =====
function createKakaoMap(el, { center, radius, onPick, interactive }) {
    el.innerHTML = '';
    const map = new kakao.maps.Map(el, {
        center: new kakao.maps.LatLng(center.lat, center.lon),
        level: radius > 700 ? 5 : 4,
        draggable: interactive,
        scrollwheel: interactive,
        disableDoubleClickZoom: !interactive,
    });
    if (interactive) map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    const recs = new Map();
    const facs = new Map();
    const news = new Map();
    let areaCircle = null;

    // 클러스터 (생태지도처럼 가까운 기록을 숫자 동그라미로 묶음, 누르면 확대). 지도 레벨 4 이상에서만 묶고, 3개 이상일 때만 묶음
    //   살아남은·지금 생물: 초록 동그라미 / 사라진 생물: 회색 ✕ 동그라미
    const hasCluster = !!kakao.maps.MarkerClusterer;
    const clusterStyle = (color, bg, border) => ({
        width: '40px',
        height: '40px',
        background: bg,
        borderRadius: '50%',
        color,
        textAlign: 'center',
        lineHeight: '34px',
        fontWeight: '900',
        fontSize: '14px',
        border: `3px solid ${border}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
    });
    let clusters = null;
    try {
        clusters = hasCluster
        ? {
              ok: new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 4, gridSize: 45, minClusterSize: 3, styles: [clusterStyle('#047857', 'rgba(255,255,255,0.95)', '#10b981')] }),
              gone: new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 4, gridSize: 45, minClusterSize: 3, texts: (n) => `✕${n}`, styles: [clusterStyle('#4b5563', 'rgba(229,231,235,0.95)', '#9ca3af')] }),
          }
        : null;
    } catch (err) {
        console.warn('클러스터를 쓰지 못해 점을 하나씩 보여 줍니다:', err);
        clusters = null;
    }
    // 묶음(숫자 동그라미)에 들어간 기록은 선·면 모양도 숨김 → 확대해서 풀리면 다시 보임
    const CLUSTER_MIN_LEVEL = 4;
    const CLUSTER_MIN_SIZE = 3;
    const inCluster = { ok: new Set(), gone: new Set() };
    function applyShapeVisibility() {
        recs.forEach((o, id) => {
            if (!o.shapeObj) return;
            const show = o.group !== null && !(clusters && (inCluster.ok.has(id) || inCluster.gone.has(id)));
            if (show !== o.shapeShown) {
                o.shapeObj.setMap(show ? map : null);
                o.shapeShown = show;
            }
        });
    }
    if (clusters) {
        ['ok', 'gone'].forEach((g) =>
            kakao.maps.event.addListener(clusters[g], 'clustered', (list) => {
                inCluster[g] = new Set();
                if (map.getLevel() >= CLUSTER_MIN_LEVEL) {
                    (list || []).forEach((c) => {
                        if (c.getSize() >= CLUSTER_MIN_SIZE) c.getMarkers().forEach((m) => m._rid != null && inCluster[g].add(m._rid));
                    });
                }
                applyShapeVisibility();
            })
        );
        kakao.maps.event.addListener(map, 'zoom_changed', () => {
            if (map.getLevel() < CLUSTER_MIN_LEVEL) {
                inCluster.ok = new Set();
                inCluster.gone = new Set();
                applyShapeVisibility();
            }
        });
    }

    function fitArea(c, r) {
        const k = Math.cos((c.lat * Math.PI) / 180) * 111320;
        const b = new kakao.maps.LatLngBounds();
        b.extend(new kakao.maps.LatLng(c.lat - r / 110540, c.lon - r / k));
        b.extend(new kakao.maps.LatLng(c.lat + r / 110540, c.lon + r / k));
        map.setBounds(b, 10, 10, 10, 10);
    }
    fitArea(center, radius);

    return {
        kind: 'kakao',
        getCenter() {
            const c = map.getCenter();
            return { lat: c.getLat(), lon: c.getLng() };
        },
        fitArea,
        relayout() {
            map.relayout();
        },
        render(view) {
            if (view.area && !areaCircle) {
                areaCircle = new kakao.maps.Circle({
                    center: new kakao.maps.LatLng(view.area.lat, view.area.lon),
                    radius: view.area.radius,
                    strokeWeight: 2,
                    strokeColor: '#10b981',
                    strokeOpacity: 0.6,
                    strokeStyle: 'dash',
                    fillOpacity: 0,
                });
                areaCircle.setMap(map);
            }
            const dirty = new Set();
            (view.records || []).forEach((r) => {
                let o = recs.get(r.id);
                if (!o) {
                    const node = document.createElement('div');
                    node.style.setProperty('--c', TYPE_COLOR[r.type] || '#64748b');
                    node.title = `${r.name} (${r.type})`;
                    if (onPick) node.addEventListener('click', () => onPick(r));
                    o = { node, ov: new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(r.lat, r.lon), content: node, xAnchor: 0.5, yAnchor: 0.5, clickable: true, zIndex: 2 }), shown: false, group: null };
                    o.ov._rid = r.id;
                    recs.set(r.id, o);
                }
                const cls = dotClass(r);
                if (o.node.className !== cls) o.node.className = cls;
                if (r.coords) {
                    const look = shapeLook(r);
                    if (!o.shapeObj) {
                        const path = r.coords.map((c) => new kakao.maps.LatLng(c.lat, c.lon));
                        o.shapeObj = r.shape === 'area' ? new kakao.maps.Polygon({ path, zIndex: 1 }) : new kakao.maps.Polyline({ path, zIndex: 1 });
                        if (onPick) kakao.maps.event.addListener(o.shapeObj, 'click', () => onPick(r));
                    }
                    if (o.shapeKey !== look.key) {
                        const opts = { strokeColor: look.color, strokeWeight: look.weight, strokeOpacity: 0.9, strokeStyle: look.gone ? 'shortdash' : 'solid' };
                        if (r.shape === 'area') Object.assign(opts, { fillColor: look.color, fillOpacity: look.fillOpacity });
                        o.shapeObj.setOptions(opts);
                        o.shapeKey = look.key;
                    }
                    if (!clusters) {
                        const showShape = r.state !== 'hidden';
                        if (showShape !== o.shapeShown) {
                            o.shapeObj.setMap(showShape ? map : null);
                            o.shapeShown = showShape;
                        }
                    }
                }
                if (clusters) {
                    const group = r.state === 'hidden' ? null : r.state === 'gone' ? 'gone' : 'ok';
                    if (group !== o.group) {
                        if (o.group) clusters[o.group].removeMarker(o.ov, true);
                        if (group) clusters[group].addMarker(o.ov, true);
                        if (o.group) dirty.add(o.group);
                        if (group) dirty.add(group);
                        o.group = group;
                    }
                } else {
                    const show = r.state !== 'hidden';
                    if (show !== o.shown) {
                        o.ov.setMap(show ? map : null);
                        o.shown = show;
                    }
                }
            });
            dirty.forEach((g) => clusters[g].redraw());
            if (clusters) applyShapeVisibility();
            (view.facilities || []).forEach((f) => {
                let o = facs.get(f.key);
                if (!o) {
                    const circle = new kakao.maps.Circle({
                        center: new kakao.maps.LatLng(f.lat, f.lon),
                        radius: f.radius,
                        strokeWeight: 1,
                        strokeColor: f.green ? '#15803d' : '#475569',
                        strokeOpacity: 0.8,
                        fillColor: f.green ? '#22c55e' : '#64748b',
                        fillOpacity: f.green ? 0.3 : 0.55,
                        zIndex: 1,
                    });
                    const node = document.createElement('div');
                    node.className = `fac${f.green ? ' fac-green' : ''}`;
                    node.innerHTML = `<span class="fac-emoji">${f.emoji}</span><span class="fac-text">${esc(f.text)}</span>${f.count > 1 ? `<span class="fac-count">×${f.count}</span>` : ''}`;
                    const label = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(f.lat, f.lon), content: node, xAnchor: 0.5, yAnchor: 0.5, zIndex: 5 });
                    o = { circle, label, shown: false };
                    facs.set(f.key, o);
                }
                if (f.visible !== o.shown) {
                    o.circle.setMap(f.visible ? map : null);
                    o.label.setMap(f.visible ? map : null);
                    o.shown = f.visible;
                }
            });
            facs.forEach((o, key) => {
                if (!(view.facilities || []).some((f) => f.key === key) && o.shown) {
                    o.circle.setMap(null);
                    o.label.setMap(null);
                    o.shown = false;
                }
            });
            (view.newcomers || []).forEach((n) => {
                let o = news.get(n.id);
                if (!o) {
                    const node = document.createElement('div');
                    node.className = 'newcomer';
                    node.innerHTML = `★<span>${esc(n.name)}</span>`;
                    if (onPick) node.addEventListener('click', () => onPick({ ...n, state: 'new' }));
                    o = { ov: new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(n.lat, n.lon), content: node, xAnchor: 0.5, yAnchor: 0.5, clickable: true, zIndex: 6 }), shown: false };
                    news.set(n.id, o);
                }
                if (n.visible !== o.shown) {
                    o.ov.setMap(n.visible ? map : null);
                    o.shown = n.visible;
                }
            });
        },
        clear() {
            if (clusters) {
                clusters.ok.clear();
                clusters.gone.clear();
            }
            recs.forEach((o) => {
                o.ov.setMap(null);
                if (o.shapeObj) o.shapeObj.setMap(null);
            });
            facs.forEach((o) => {
                o.circle.setMap(null);
                o.label.setMap(null);
            });
            news.forEach((o) => o.ov.setMap(null));
            recs.clear();
            facs.clear();
            news.clear();
            if (areaCircle) areaCircle.setMap(null);
            areaCircle = null;
        },
    };
}

// ===== 간단한 점 지도 (SVG) =====
function createSvgMap(el, { center, radius, onPick }) {
    const NS = 'http://www.w3.org/2000/svg';
    el.innerHTML = '';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'svg-map');
    el.appendChild(svg);
    let c0 = center;
    let r0 = radius;
    let W = 800;
    let H = 600;
    let scale = 1;
    const recNodes = new Map();
    const facNodes = new Map();
    const newNodes = new Map();
    const gArea = document.createElementNS(NS, 'g');
    const gFac = document.createElementNS(NS, 'g');
    const gShape = document.createElementNS(NS, 'g');
    const gRec = document.createElementNS(NS, 'g');
    const shapeNodes = new Map();
    const gLabel = document.createElementNS(NS, 'g');
    const gNew = document.createElementNS(NS, 'g');
    svg.append(gArea, gShape, gFac, gRec, gLabel, gNew);
    const note = document.createElementNS(NS, 'text');
    note.setAttribute('class', 'svg-note');
    note.textContent = '간단한 지도 (카카오 지도를 불러오지 못했어요)';
    svg.appendChild(note);

    function project(p) {
        const k = Math.cos((c0.lat * Math.PI) / 180) * 111320;
        return { x: W / 2 + (p.lon - c0.lon) * k * scale, y: H / 2 - (p.lat - c0.lat) * 110540 * scale };
    }
    function layout() {
        W = el.clientWidth || 800;
        H = el.clientHeight || 600;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        scale = (Math.min(W, H) / 2 - 16) / (r0 * 1.05);
        note.setAttribute('x', W / 2);
        note.setAttribute('y', 92);
        note.setAttribute('text-anchor', 'middle');
    }
    layout();
    let lastView = null;

    function draw(view) {
        lastView = view;
        if (view.area) {
            gArea.innerHTML = '';
            const p = project(view.area);
            const ring = document.createElementNS(NS, 'circle');
            ring.setAttribute('cx', p.x);
            ring.setAttribute('cy', p.y);
            ring.setAttribute('r', view.area.radius * scale);
            ring.setAttribute('class', 'svg-area');
            gArea.appendChild(ring);
        }
        (view.facilities || []).forEach((f) => {
            let o = facNodes.get(f.key);
            if (!o) {
                const circ = document.createElementNS(NS, 'circle');
                circ.setAttribute('class', `svg-fac${f.green ? ' green' : ''}`);
                const label = document.createElementNS(NS, 'text');
                label.setAttribute('class', 'svg-fac-label');
                label.textContent = `${f.emoji} ${f.text}`;
                gFac.appendChild(circ);
                gLabel.appendChild(label);
                o = { circ, label };
                facNodes.set(f.key, o);
            }
            const p = project(f);
            o.circ.setAttribute('cx', p.x);
            o.circ.setAttribute('cy', p.y);
            o.circ.setAttribute('r', Math.max(4, f.radius * scale));
            o.label.setAttribute('x', p.x);
            o.label.setAttribute('y', p.y + 4);
            o.circ.style.display = f.visible ? '' : 'none';
            o.label.style.display = f.visible ? '' : 'none';
        });
        (view.records || []).forEach((r) => {
            let node = recNodes.get(r.id);
            if (!node) {
                node = document.createElementNS(NS, 'g');
                node.innerHTML = '<circle r="5"></circle><path d="M-4,-4L4,4M4,-4L-4,4"></path>';
                node.style.setProperty('--c', TYPE_COLOR[r.type] || '#64748b');
                if (onPick) node.addEventListener('click', () => onPick(r));
                gRec.appendChild(node);
                recNodes.set(r.id, node);
            }
            const p = project(r);
            node.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
            node.setAttribute('class', `svg-dot svg-${r.state}`);
            if (r.coords) {
                let sh = shapeNodes.get(r.id);
                if (!sh) {
                    sh = document.createElementNS(NS, r.shape === 'area' ? 'polygon' : 'polyline');
                    if (onPick) sh.addEventListener('click', () => onPick(r));
                    gShape.appendChild(sh);
                    shapeNodes.set(r.id, sh);
                }
                const look = shapeLook(r);
                sh.setAttribute('points', r.coords.map((c) => project(c)).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '));
                sh.setAttribute('stroke', look.color);
                sh.setAttribute('stroke-width', look.weight);
                sh.setAttribute('stroke-dasharray', look.gone ? '5 4' : '');
                sh.setAttribute('fill', r.shape === 'area' ? look.color : 'none');
                sh.setAttribute('fill-opacity', look.fillOpacity);
                sh.setAttribute('stroke-linecap', 'round');
                sh.style.display = r.state === 'hidden' ? 'none' : '';
            }
        });
        (view.newcomers || []).forEach((n) => {
            let node = newNodes.get(n.id);
            if (!node) {
                node = document.createElementNS(NS, 'text');
                node.setAttribute('class', 'svg-new');
                node.textContent = `★ ${n.name}`;
                if (onPick) node.addEventListener('click', () => onPick({ ...n, state: 'new' }));
                gNew.appendChild(node);
                newNodes.set(n.id, node);
            }
            const p = project(n);
            node.setAttribute('x', p.x);
            node.setAttribute('y', p.y);
            node.style.display = n.visible ? '' : 'none';
        });
    }

    return {
        kind: 'svg',
        getCenter: () => ({ ...c0 }),
        fitArea(c, r) {
            c0 = c;
            r0 = r;
            layout();
            if (lastView) draw(lastView);
        },
        relayout() {
            layout();
            if (lastView) draw(lastView);
        },
        render: draw,
        clear() {
            [gArea, gShape, gFac, gRec, gLabel, gNew].forEach((g) => (g.innerHTML = ''));
            shapeNodes.clear();
            recNodes.clear();
            facNodes.clear();
            newNodes.clear();
        },
    };
}
