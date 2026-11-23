'use strict';
// 공용 도우미: 글자 안전 처리, 알림 토스트, 창(모달), 확인 창

const $ = (id) => document.getElementById(id);
const fin = Number.isFinite;

// 사용자가 입력한 값(키워드, 조 이름, 설명, 닉네임 등)을 화면에 넣을 때는 꼭 esc()로 감쌉니다. (XSS 방지)
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const TYPE_EMOJI = { 목본: '🌳', 초본: '🌿', 곤충: '🐞', '기타 생물': '🐾' };
const TYPE_COLOR = { 목본: '#047857', 초본: '#65a30d', 곤충: '#ea580c', '기타 생물': '#7c3aed' };
const typeEmoji = (t) => TYPE_EMOJI[t] || '🌱';

function fmt1(x) {
    return fin(x) ? (Math.round(x * 10) / 10).toFixed(1) : '-';
}
function fmtTemp(x) {
    return fin(x) ? `${fmt1(x)}℃` : '-';
}

// 잠깐 떴다 사라지는 안내
function toast(message, kind = 'info') {
    let box = $('toasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toasts';
        document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
}

// 창 열기. body 는 HTML 글자 (사용자 입력은 esc 필수). 돌려줌: { el, body, close }
function openModal({ title, body = '', size = '', onClose = null, className = '' }) {
    const wrap = document.createElement('div');
    wrap.className = `modal ${className}`;
    wrap.innerHTML = `<div class="modal-box ${size}" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>${title}</h2><button type="button" class="icon-btn modal-x" aria-label="닫기">✕</button></div>
        <div class="modal-body">${body}</div></div>`;
    document.body.appendChild(wrap);
    const close = () => {
        if (!wrap.isConnected) return;
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        if (onClose) onClose();
    };
    const onKey = (e) => {
        if (e.key === 'Escape' && wrap === document.querySelector('.modal:last-of-type')) close();
    };
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.modal-x').addEventListener('click', close);
    wrap.addEventListener('click', (e) => {
        if (e.target === wrap) close();
    });
    return { el: wrap, body: wrap.querySelector('.modal-body'), close };
}

function confirmBox(message, okText = '확인') {
    return new Promise((resolve) => {
        const m = openModal({
            title: '확인',
            size: 'small',
            body: `<p class="confirm-text">${esc(message)}</p><div class="row-end"><button class="btn" data-no>취소</button><button class="btn btn-primary" data-yes>${esc(okText)}</button></div>`,
            onClose: () => resolve(false),
        });
        m.body.querySelector('[data-yes]').addEventListener('click', () => {
            resolve(true);
            m.close();
        });
        m.body.querySelector('[data-no]').addEventListener('click', () => m.close());
    });
}

function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

// 한국어 조사: josa('쑥', '이', '가') → '이', josa('개망초', '이', '가') → '가'
function josa(word, withFinal, withoutFinal) {
    const ch = String(word || '').trim().slice(-1);
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? withFinal : withoutFinal;
    if (/[0-9]/.test(ch)) return '013678'.includes(ch) ? withFinal : withoutFinal;
    if (/[a-z]/i.test(ch)) return /[lmnr]/i.test(ch) ? withFinal : withoutFinal;
    return `${withFinal}(${withoutFinal})`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 서버 오류를 알아듣기 쉬운 말로
function friendlyError(err) {
    const msg = String(err?.message || err || '');
    if (/invalid code/.test(msg)) return '학반 코드가 맞지 않아요. 선생님께 받은 코드를 다시 확인해 주세요.';
    if (/login required|JWT|not authenticated/i.test(msg)) return '로그인이 필요해요.';
    if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 맞지 않아요.';
    if (/Email not confirmed/i.test(msg)) return '이메일 인증이 아직 안 됐어요. 메일함을 확인해 주세요.';
    if (/row-level security|not allowed|permission denied/i.test(msg)) return '이 작업을 할 권한이 없어요.';
    if (/relation .* does not exist|Could not find the (table|function)/i.test(msg)) return '사이트 설정(SQL)이 아직 안 됐어요. 선생님께 알려 주세요.';
    if (/Failed to fetch|NetworkError/i.test(msg)) return '인터넷 연결을 확인해 주세요.';
    return msg || '문제가 생겼어요. 다시 시도해 주세요.';
}
