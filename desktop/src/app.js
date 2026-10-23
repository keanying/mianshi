'use strict';
(() => {
const api = window.api;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const state = { view: 'home', tab: 'resume', id: null, interview: null, info: null, settings: null, busy: {}, stream: {}, rec: null, recState: 'idle', segErrors: new Map() };
const STATUS = { draft: '待出题', ready: '已出题', done: '已面试', evaluated: '已评估' };
const DIM_COLORS = { 专业度: 'd1', 自驱力: 'd2', 性格特质: 'd3', 逻辑思维: 'd4', 适应力: 'd5' };
// 题目类别：开场 / 简历项目 / 岗位画像 / 技术框架 / 做事方式（旧数据的 basic 算技术）
const KIND = { warmup: '开场', gate: '门槛', resume: '项目', profile: '画像', tech: '技术', basic: '技术', behavior: '做事方式' };
const kindChip = (src) => (KIND[src] ? `<i class="kind k-${src === 'basic' ? 'tech' : src}">${KIND[src]}</i>` : '');
// 难度标签和预计用时（旧数据没有这两项就不显示）
const diffChip = (q) => (q.difficulty ? `<i class="diff d-${{ 难: 'hard', 中: 'mid', 易: 'easy' }[q.difficulty]}">${q.difficulty}</i>` : '');
const sectionMinutes = (sec) => sec.questions.reduce((a, q) => a + (q.minutes || 0), 0);
const sectionHead = (sec) => `${kindChip(sec.source)}${esc(sec.title)}<span>${sec.questions.length} 题${sectionMinutes(sec) ? ` · 约 ${sectionMinutes(sec)} 分钟` : ''}</span>`;
const VERDICT_CLASS = { 强烈推荐: 'v1', 推荐: 'v2', 待定: 'v3', 不推荐: 'v4' };

// ---------- 工具 ----------
// 通知：ok 完成（默认）/ info 提示 / warn 提醒 / error 出错。出错的停留久一点，鼠标停在上面时不消失。
let toastTimer;
const TOAST_ICON = { ok: '✓', info: 'i', warn: '!', error: '✕' };
function toast(message, type = 'ok') {
  const el = $('#toast');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="t-ico">${TOAST_ICON[type] || 'i'}</i><p>${esc(message)}</p><button class="t-close" title="关闭">×</button>`;
  el.hidden = false;
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  const hide = () => { el.hidden = true; };
  el.querySelector('.t-close').onclick = hide;
  const arm = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hide, type === 'error' || type === 'warn' ? 6000 : 3000); };
  el.onmouseenter = () => clearTimeout(toastTimer);
  el.onmouseleave = arm;
  arm();
}
// ---------- 下拉菜单（参照 Semi Design Dropdown）----------
// groups: [{ title?, items: [{ value, label, icon?, extra?, tag?, selected?, disabled?, type?: 'tertiary'|'warning'|'danger' }] }]
// 浮层挂在 body 上、按触发按钮定位（下方放不下就往上弹）；↑↓ 移动、回车选择、Esc / 点外面关闭。
let ddClose = null, ddAnchor = null;
function dropdown(anchor, groups, { onPick, align = 'left', minWidth = 0, compact = false } = {}) {
  ddClose?.();
  const hasCheck = groups.some((g) => g.items.some((x) => 'selected' in x));
  const menu = document.createElement('div');
  menu.className = `dd-menu${compact ? ' compact' : ''}`;
  menu.setAttribute('role', 'menu');
  let n = 0;
  const vals = [];
  menu.innerHTML = groups.map((g, gi) => `${gi ? '<div class="dd-divider"></div>' : ''}${g.title ? `<div class="dd-title">${esc(g.title)}</div>` : ''}${g.items.map((x) => {
    vals.push(x.value);
    return `<button type="button" role="menuitem" class="dd-item ${x.selected ? 'selected' : ''} ${x.type || ''}" data-i="${n++}" ${x.disabled ? 'disabled' : ''}>
      ${hasCheck ? `<span class="dd-check">${x.selected ? icon('check') : ''}</span>` : ''}${x.icon ? `<span class="dd-icon">${icon(x.icon)}</span>` : ''}<span class="dd-label">${esc(x.label)}</span>${x.extra ? `<span class="dd-extra ${x.tag ? 'tag' : ''}">${esc(x.extra)}</span>` : ''}</button>`;
  }).join('')}`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
  menu.style.minWidth = `${Math.max(minWidth, r.width)}px`;
  const below = vh - r.bottom - 12, above = r.top - 12, up = below < Math.min(menu.scrollHeight, 320) && above > below;
  menu.style.maxHeight = `${Math.max(160, Math.min(520, up ? above : below))}px`;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(vw - w - 8, align === 'right' ? r.right - w : r.left))}px`;
  menu.style.top = `${up ? r.top - h - 4 : r.bottom + 4}px`;
  if (up) menu.classList.add('up');
  anchor.setAttribute('aria-expanded', 'true');
  const items = () => [...menu.querySelectorAll('.dd-item:not(:disabled)')];
  const close = (refocus = true) => {
    menu.remove(); ddClose = null; anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeQuiet); document.removeEventListener('scroll', onScroll, true);
    if (refocus) anchor.focus();
  };
  const closeQuiet = () => close(false);
  const onScroll = (e) => { if (!menu.contains(e.target)) close(false); };
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(false); };
  const onKey = (e) => {
    const xs = items(), k = xs.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); xs[(k + (e.key === 'ArrowDown' ? 1 : xs.length - 1)) % xs.length]?.focus(); }
    if (e.key === ' ') e.stopPropagation();
  };
  menu.addEventListener('click', (e) => { const b = e.target.closest('.dd-item'); if (b && !b.disabled) { close(); onPick?.(vals[Number(b.dataset.i)]); } });
  menu.addEventListener('mousemove', (e) => { const b = e.target.closest('.dd-item:not(:disabled)'); if (b && b !== document.activeElement) b.focus({ preventScroll: true }); });
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeQuiet);
  document.addEventListener('scroll', onScroll, true);
  ddClose = closeQuiet;
  ddAnchor = anchor;
  const sel = menu.querySelector('.dd-item.selected:not(:disabled)') || items()[0];
  sel?.focus({ preventScroll: true });
  sel?.scrollIntoView({ block: 'nearest' });
}
// 把页面上的原生 <select> 换成上面的下拉菜单：原生的仍在（透明、不占位置），选中后照常触发 change，原有逻辑不用改。
function enhanceSelect(sel) {
  sel.dataset.dd = '1';
  sel.classList.add('native-sel');
  sel.tabIndex = -1;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-trigger';
  btn.setAttribute('aria-haspopup', 'menu');
  if (sel.id) btn.id = `${sel.id}-dd`;
  const sync = () => { btn.innerHTML = `<span>${esc(sel.selectedOptions[0]?.textContent || '')}</span>${icon('chevD')}`; btn.disabled = sel.disabled; };
  sync();
  sel.addEventListener('change', sync);
  sel.after(btn);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (btn.getAttribute('aria-expanded') === 'true') { ddClose?.(); return; }
    const opt = (o) => ({ value: o.value, label: o.textContent, selected: o.selected, disabled: o.disabled });
    const groups = [];
    for (const c of sel.children) {
      if (c.tagName === 'OPTGROUP') groups.push({ title: c.label, items: [...c.children].map(opt) });
      else if (groups.length && !groups.at(-1).title) groups.at(-1).items.push(opt(c));
      else groups.push({ items: [opt(c)] });
    }
    dropdown(btn, groups, { onPick: (v) => { if (sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } } });
  });
}
// 数字输入框加上 − / + 按钮（参照 HeroUI NumberInput），按 min / max / step 限定范围。
function enhanceNumber(input) {
  input.dataset.num = '1';
  const wrap = document.createElement('span');
  wrap.className = 'num';
  input.before(wrap);
  const btn = (d, label) => `<button type="button" class="num-btn" data-d="${d}" aria-label="${label}" tabindex="-1">${d < 0 ? '−' : '+'}</button>`;
  wrap.insertAdjacentHTML('beforeend', btn(-1, '减少'));
  wrap.appendChild(input);
  wrap.insertAdjacentHTML('beforeend', btn(1, '增加'));
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.num-btn');
    if (!b) return;
    e.preventDefault();
    const step = Number(input.step) || 1, min = input.min === '' ? -Infinity : Number(input.min), max = input.max === '' ? Infinity : Number(input.max);
    input.value = Math.min(max, Math.max(min, (Number(input.value) || 0) + step * Number(b.dataset.d)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
// 页面重绘时：新出现的下拉框换成自定义样式；触发按钮被换掉了（例如音频调试页刷新）就把打开的菜单关掉。
new MutationObserver(() => {
  document.querySelectorAll('select:not([data-dd])').forEach(enhanceSelect);
  document.querySelectorAll('input[type=number]:not([data-num])').forEach(enhanceNumber);
  if (ddClose && !ddAnchor?.isConnected) ddClose();
}).observe(document.body, { childList: true, subtree: true });

// 按钮水波纹（参照 RippleButton）：按下时从点击位置扩散一圈，600ms 后淡出。颜色由 CSS 变量 --ripple 决定。
const RIPPLE_TARGETS = '.btn, .tabs button, .filters button, .dd-trigger, .score-btn, .tick, .q-row';
document.addEventListener('pointerdown', (e) => {
  const el = e.button === 0 && e.target.closest(RIPPLE_TARGETS);
  if (!el || el.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove());
}, true);
// 应用内确认框（代替系统弹窗）：返回 true / false。危险操作默认聚焦「取消」，Esc 取消，点遮罩取消。
function ask({ title, body = '', ok = '确定', cancel = '取消', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-mask';
    wrap.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-ico ${danger ? 'danger' : ''}">${danger ? icon('alert') : icon('info')}</div>
      <div class="modal-text"><h3 id="modalTitle">${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}</div>
      <div class="modal-actions"><button class="btn" data-cancel>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button></div></div>`;
    const prevFocus = document.activeElement;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); wrap.classList.add('out'); setTimeout(() => wrap.remove(), 120); prevFocus?.focus?.(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Tab') { // 焦点留在弹窗里
        const bs = [...wrap.querySelectorAll('button')], k = bs.indexOf(document.activeElement);
        e.preventDefault(); bs[(k + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
      }
      e.stopPropagation();
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-cancel]')) done(false);
      else if (e.target.closest('[data-ok]')) done(true);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector(danger ? '[data-cancel]' : '[data-ok]').focus();
  });
}
async function call(promise, { quiet = false } = {}) {
  const res = await promise;
  if (!res.ok) {
    if (!quiet) toast(res.error, 'error');
    const err = new Error(res.error);
    err.handled = true;
    throw err;
  }
  return res.data;
}
const ignoreHandled = (err) => { if (!err.handled) { console.error(err); toast(err.message, 'error'); } };
const fmtTime = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtDate = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
const allQuestions = (plan) => (plan ? plan.sections.flatMap((s) => s.questions) : []);
const transcriptText = (i) => (i.transcript || []).filter((t) => !t.echo).map((t) => t.text).filter(Boolean).join('\n');
// 输入框的改动先攒起来，停顿 400ms 后一次写盘；任何会重新读取面试记录的操作之前都先 flushSave，避免改动被旧数据覆盖。
let pending = null, saveTimer = null;
function saveField(patch) {
  if (pending && pending.id !== state.id) flushSave();
  pending = { ...(pending || {}), id: state.id, ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (!pending) return;
  const patch = pending;
  pending = null;
  await api.interviews.save(patch).catch(() => {});
}
// 线条图标（24×24，跟随文字颜色）
const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  back: '<path d="m15 18-6-6 6-6"/>', chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>', chevU: '<path d="m18 15-6-6-6 6"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7.5 5-3 5 3-1.5-7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
const STEPS = [['resume', '候选人'], ['audio', '音频调试'], ['plan', '面试题'], ['live', '面试中'], ['eval', '评估报告']];
const stepDone = (i) => ({
  resume: Boolean(i.resume?.trim()), audio: Boolean(i.audioCheck?.interviewer), plan: Boolean(i.plan),
  live: Boolean(i.audioParts || (i.transcript || []).length), eval: Boolean(i.evaluation),
});
// 证据原话自带引号时去掉，样式会统一加上
const unquote = (x) => x.replace(/^[“"「『]+|[”"」』]+$/g, '');
// 总评拆成一句一条
const summaryList = (text) => {
  const xs = String(text || '').split(/(?<=[。！？；])/).map((x) => x.trim()).filter(Boolean);
  return xs.length ? `<ul class="summary-list">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
};
// 五维雷达图
function radarSVG(e) {
  const n = e.dimensions.length, cx = 120, cy = 112, R = 78;
  const pt = (k, r) => { const a = -Math.PI / 2 + k * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const poly = (f) => e.dimensions.map((d, k) => pt(k, f(d)).map((v) => v.toFixed(1)).join(',')).join(' ');
  const rings = [1, 2, 3, 4, 5].map((v) => `<polygon points="${poly(() => R * v / 5)}" fill="none" stroke="#e5e8ee"/>`).join('');
  const axes = e.dimensions.map((d, k) => { const [x, y] = pt(k, R); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e8ee"/>`; }).join('');
  const labels = e.dimensions.map((d, k) => { const [x, y] = pt(k, R + 18); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11.5" fill="#64748b">${esc(d.name)}</text>`; }).join('');
  return `<svg class="radar" viewBox="0 0 240 220" aria-label="五维得分">${rings}${axes}<polygon points="${poly((d) => R * d.score / 5)}" fill="#5b45e02e" stroke="#5b45e0" stroke-width="2"/>${labels}</svg>`;
}
const average = (e) => Math.round(e.dimensions.reduce((a, d) => a + d.score, 0) / e.dimensions.length * 10) / 10;

// ---------- 导航 ----------
function setNav() {
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.go === state.view || (state.view === 'interview' && b.dataset.go === 'home')));
}
async function go(view) {
  if (state.recState !== 'idle' && view !== 'interview') { toast('正在录音，请先结束录音。', 'warn'); return; }
  await flushSave();
  stopCheck();
  document.body.classList.remove('focus');
  state.view = view;
  setNav();
  if (view === 'overview') await renderOverview();
  if (view === 'home') await renderHome();
  if (view === 'positions') await renderPositions();
  if (view === 'settings') await renderSettings();
}
const loadPositions = async () => { state.positions = await call(api.positions.list()).catch(() => state.positions || []); return state.positions; };
// 级别标签：五个级别各一个颜色
const levelChip = (level) => (level ? `<i class="lv lv${Levels.LEVEL_NAMES.indexOf(level) + 1}">${esc(level)}</i>` : '');
const passChip = (passed) => (passed == null ? '' : `<i class="pass-chip ${passed ? 'ok' : 'bad'}">${passed ? '达标' : '未达标'}</i>`);
document.querySelector('.nav').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
$('#newInterview').addEventListener('click', async () => {
  if (state.recState !== 'idle') { toast('正在录音，请先结束录音。', 'warn'); return; }
  try {
    const i = await call(api.interviews.create({}));
    await openInterview(i.id, 'resume');
  } catch (err) { ignoreHandled(err); }
});

// ---------- 面试记录 ----------
async function renderHome() {
  state.homeList = await call(api.interviews.list()).catch(() => []);
  await loadPositions();
  state.home = state.home || { q: '', status: '', pos: '', page: 1 };
  const s = state.settings, h = state.home;
  const setupHint = !s?.apiKeyHint ? `<div class="notice">还没有配置模型。先到 <button class="link" data-go-settings>设置</button> 里选择 GLM 或 DeepSeek 并填写 API Key。</div>` : '';
  main.innerHTML = `<div class="page-scroll"><header class="page-head"><h1>面试</h1></header>
   ${setupHint}<div class="home-bar"><div class="row"><label class="search">${icon('search')}<input id="homeSearch" placeholder="搜索姓名或岗位" value="${esc(h.q)}">${h.q ? '<button class="clear" id="clearSearch" title="清空">×</button>' : ''}</label>
    ${state.positions.length ? `<span class="home-pos"><select id="homePos" aria-label="按岗位筛选"><option value="">全部岗位</option>${state.positions.map((p) => `<option value="${p.id}" ${h.pos === p.id ? 'selected' : ''}>${esc(p.title)} · ${esc(p.level)}</option>`).join('')}</select></span>` : ''}</div>
    <div class="filters" id="homeFilters" role="tablist" aria-label="按状态筛选">${homeFiltersHTML()}</div></div>
   <div id="homeTable">${homeTableHTML()}</div></div>`;
  const refresh = () => { $('#homeFilters').innerHTML = homeFiltersHTML(); $('#homeTable').innerHTML = homeTableHTML(); };
  $('#homeSearch').addEventListener('input', (e) => {
    h.q = e.target.value; h.page = 1; refresh();
    const label = $('.search'), btn = $('#clearSearch');
    if (h.q && !btn) label.insertAdjacentHTML('beforeend', '<button class="clear" id="clearSearch" title="清空">×</button>');
    if (!h.q) btn?.remove();
  });
  $('.search').addEventListener('click', (e) => { if (e.target.id === 'clearSearch') { h.q = ''; h.page = 1; $('#homeSearch').value = ''; e.target.remove(); refresh(); $('#homeSearch').focus(); } });
  $('#homeFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (b) { h.status = b.dataset.status; h.page = 1; refresh(); } });
  $('#homePos')?.addEventListener('change', (e) => { h.pos = e.target.value; h.page = 1; refresh(); });
}
// 搜索词和岗位筛选（状态筛选另算）
const homeMatch = (i) => {
  const h = state.home, q = h.q.trim().toLowerCase();
  return (!h.pos || i.positionId === h.pos) && (!q || `${i.name} ${i.position}`.toLowerCase().includes(q));
};
// 状态筛选：每个状态后面带数量（数量按当前搜索词算）
function homeFiltersHTML() {
  const h = state.home, rows = (state.homeList || []).filter(homeMatch);
  return [['', '全部'], ...Object.entries(STATUS)].map(([k, v]) => `<button role="tab" data-status="${k}" class="${h.status === k ? 'on' : ''}" aria-selected="${h.status === k}">${v}<i>${rows.filter((i) => !k || i.status === k).length}</i></button>`).join('');
}
function homeTableHTML() {
  const h = state.home, all = state.homeList || [], PAGE = 10;
  if (!all.length) return `<div class="empty"><h3>还没有面试记录</h3><p>点击左上角「添加候选人」开始；建议先在「岗位」里设好岗位和达标线。</p></div>`;
  const rows = all.filter((i) => (!h.status || i.status === h.status) && homeMatch(i));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  h.page = Math.min(h.page, pages);
  const shown = rows.slice((h.page - 1) * PAGE, h.page * PAGE);
  const avatar = (name) => `<i class="avatar a${([...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) + 1}">${esc((name || '?').slice(0, 1))}</i>`;
  return `<div class="table"><div class="tr th"><span>候选人</span><span>应聘岗位</span><span>面试时间</span><span>当前状态</span><span>评估结论 / 得分</span><span>操作</span></div>
   ${shown.map((i) => `<div class="tr" data-open="${i.id}"><span class="who-cell">${avatar(i.name)}${esc(i.name || '未命名候选人')}</span><span class="pos-cell">${i.position ? `<span>${esc(i.position)}</span>${levelChip(i.level)}` : '<span class="muted">—</span>'}</span><span class="muted">${fmtDate(i.createdAt)}</span><span><i class="badge s-${i.status}">${STATUS[i.status] || i.status}</i></span><span class="verdict-cell">${i.verdict ? `<i class="verdict ${VERDICT_CLASS[i.verdict] || ''}">${esc(i.verdict)}</i><span class="score ${VERDICT_CLASS[i.verdict] || ''}">${i.average ?? ''}</span>${passChip(i.passed)}` : '<span class="muted">—</span>'}</span><span><button class="trash" data-remove="${i.id}" title="删除">${icon('trash')}</button></span></div>`).join('')
   || '<div class="tr"><span class="muted">没有符合条件的面试</span></div>'}
   <div class="table-foot"><span>显示第 ${rows.length ? (h.page - 1) * PAGE + 1 : 0}-${(h.page - 1) * PAGE + shown.length} 场面试，共 ${rows.length} 场</span><span class="row"><button class="btn" data-page="-1" ${h.page > 1 ? '' : 'disabled'}>上一页</button><button class="btn" data-page="1" ${h.page < pages ? '' : 'disabled'}>下一页</button></span></div></div>`;
}
main.addEventListener('click', async (e) => {
  if (e.target.closest('[data-go-settings]')) { go('settings'); return; }
  if (e.target.closest('[data-go-positions]')) { e.preventDefault(); go('positions'); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    e.stopPropagation();
    const name = state.homeList?.find((x) => x.id === rm.dataset.remove)?.name || '这场面试';
    if (!await ask({ title: `删除「${name}」？`, body: '简历、录音、转写和评估报告都会被删除，无法恢复。', ok: '删除', danger: true })) return;
    if (await call(api.interviews.remove(rm.dataset.remove)).catch(() => false)) { toast('已删除'); renderHome(); }
    return;
  }
  const page = e.target.closest('[data-page]');
  if (page && state.view === 'home') { state.home.page += Number(page.dataset.page); $('#homeTable').innerHTML = homeTableHTML(); return; }
  const open = e.target.closest('[data-open]');
  if (open && state.view === 'home') openInterview(open.dataset.open);
});

// ---------- 概览 ----------
// 首页：几个关键数字、评估结果（达标率环形图 + 五维平均分）、每周面试数、各岗位进展、待处理的面试。
// 状态色（达标 / 未达标 / 进行中）固定，旁边都带文字，不靠颜色区分。
const STATUS_COLOR = { pass: '#0ca30c', fail: '#d03b3b', open: '#c9ccda' };
const TODO = { draft: ['待出题', 'resume'], ready: ['待面试', 'live'], done: ['待评估', 'eval'] };
async function renderOverview() {
  const [list, positions] = await Promise.all([call(api.interviews.list()).catch(() => []), loadPositions()]);
  const now = new Date(), monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const head = `<header class="page-head"><div><h1>概览</h1><p>${now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p></div>
   <button class="btn cta" data-ov-add>${icon('plus')}添加候选人</button></header>`;
  if (!list.length) { main.innerHTML = `<div class="page-scroll ov">${head}${onboardingHTML(positions)}</div>`; return; }
  const evaluated = list.filter((i) => i.dims), judged = evaluated.filter((i) => i.passed != null);
  const passed = judged.filter((i) => i.passed).length;
  const month = list.filter((i) => i.createdAt >= monthStart).length;
  const kpi = (ico, cls, label, value, sub) => `<div class="kpi"><i class="kpi-ico ${cls}">${icon(ico)}</i><div><span>${label}</span><b>${value}</b><small>${sub}</small></div></div>`;
  main.innerHTML = `<div class="page-scroll ov">${head}
   <div class="kpis">
    ${kpi('users', 'k1', '面试总数', list.length, `${positions.length} 个岗位`)}
    ${kpi('calendar', 'k2', '本月新增', month, `${now.getMonth() + 1} 月`)}
    ${kpi('clipboard', 'k3', '已评估', evaluated.length, `还有 ${list.length - evaluated.length} 场未评估`)}
    ${kpi('award', 'k4', '达标率', judged.length ? `${Math.round(passed / judged.length * 100)}%` : '—', judged.length ? `${passed} / ${judged.length} 人达标` : '关联岗位后才判断')}
   </div>
   <div class="ov-grid">
    <section class="panel ov-result">${resultHTML(evaluated, judged, passed)}</section>
    <div class="ov-mid">
     <section class="panel">${weeklyHTML(list)}</section>
     <section class="panel">${byPositionHTML(list, positions)}</section>
    </div>
    <section class="panel ov-todo">${todoHTML(list)}${insightHTML(evaluated)}</section>
   </div></div>`;
}
function onboardingHTML(positions) {
  const s = state.settings;
  const step = (done, n, title, text, btn) => `<div class="ob-step ${done ? 'done' : ''}"><i>${done ? icon('check') : n}</i><div><b>${title}</b><p>${text}</p></div>${done ? '<span class="ok small">已完成</span>' : btn}</div>`;
  return `<section class="panel onboarding"><h2>开始第一场面试</h2><p class="muted">三步就能用起来：</p>
   ${step(Boolean(s?.apiKeyHint), 1, '配置模型', '选择 DeepSeek 或智谱，填写 API Key；语音转写需要智谱的 Key。', '<button class="btn" data-go-settings>去设置</button>')}
   ${step(positions.length > 0, 2, '新建岗位', '填写岗位名称、级别、岗位要求、技术栈和达标线。', '<button class="btn" data-go-positions>去新建</button>')}
   ${step(false, 3, '添加候选人', '选择岗位、上传简历，调试音频后生成面试题，开始面试。', '<button class="btn primary" data-ov-add>添加候选人</button>')}</section>`;
}
// 评估结果：达标 / 未达标 / 未判断（没关联岗位）的环形图，下面是五个维度的平均分。
function resultHTML(evaluated, judged, passed) {
  const failed = judged.length - passed, unjudged = evaluated.length - judged.length;
  const parts = [['pass', '达标', passed], ['fail', '未达标', failed], ['open', '未判断', unjudged]].filter((x) => x[2]);
  const total = evaluated.length, R = 70, C = 2 * Math.PI * R, GAP = parts.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = parts.map(([k, label, n]) => {
    const len = n / total * C;
    const arc = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${STATUS_COLOR[k]}" stroke-width="14" stroke-dasharray="${Math.max(0, len - GAP)} ${C}" stroke-dashoffset="${-offset}" data-tt="${label}：${n} 人（${Math.round(n / total * 100)}%）"/>`;
    offset += len;
    return arc;
  }).join('');
  const dims = Levels.DIMS.map((d, k) => {
    const xs = evaluated.map((i) => i.dims[k]).filter((x) => typeof x === 'number');
    const avg = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
    return `<div class="dim-avg" data-tt="${d}：${xs.length} 人平均 ${avg ?? '—'} 分"><span>${d}</span><b>${avg ?? '—'}</b><i class="mini ${DIM_COLORS[d]}"><em style="width:${(avg || 0) / 5 * 100}%"></em></i></div>`;
  }).join('');
  return `<div class="card-head"><h2>评估结果</h2><span class="muted small">共 ${total} 人已评估</span></div>
   ${total ? `<div class="ring-wrap"><svg class="ring" viewBox="0 0 180 180" role="img" aria-label="达标 ${passed} 人，未达标 ${failed} 人，未判断 ${unjudged} 人">
     <circle cx="90" cy="90" r="${R}" fill="none" stroke="#eef0f6" stroke-width="14"/><g transform="rotate(-90 90 90)">${arcs}</g></svg>
     <div class="ring-center"><span>达标率</span><b>${judged.length ? Math.round(passed / judged.length * 100) : '—'}<small>${judged.length ? '%' : ''}</small></b><em>${passed} / ${judged.length || 0} 人</em></div></div>
    <div class="legend">${parts.map(([k, label, n]) => `<span><i style="background:${STATUS_COLOR[k]}"></i>${label} ${n}</span>`).join('')}</div>`
    : '<p class="muted ov-empty">还没有评估过的面试</p>'}
   <div class="mini-label" style="margin-top:18px">五个维度平均分</div><div class="dim-avgs">${dims}</div>`;
}
// 每周面试数（最近 8 周，按周一开始算）：单一序列的面积折线图，悬停看每周数字。
function weeklyHTML(list) {
  const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const start = monday(new Date());
  const weeks = Array.from({ length: 8 }, (_, k) => { const d = new Date(start); d.setDate(d.getDate() - (7 - k) * 7); return d; });
  const counts = weeks.map((w, k) => list.filter((i) => { const t = new Date(i.createdAt); return t >= w && (k === 7 || t < weeks[k + 1]); }).length);
  const W = 520, H = 170, L = 28, T = 16, B = 26, max = Math.max(2, ...counts), top = Math.ceil(max / 2) * 2;
  const x = (k) => L + k * (W - L - 12) / 7, y = (v) => T + (H - T - B) * (1 - v / top);
  const pts = counts.map((v, k) => [x(k), y(v)]);
  // 平滑曲线：相邻点之间用三次贝塞尔，控制点取水平中点
  const path = pts.map(([px, py], k) => (k ? `C${(pts[k - 1][0] + px) / 2},${pts[k - 1][1]} ${(pts[k - 1][0] + px) / 2},${py} ${px},${py}` : `M${px},${py}`)).join(' ');
  const ticks = [0, top / 2, top];
  const label = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const thisWeek = counts[7], lastWeek = counts[6];
  return `<div class="card-head"><div><h2>每周面试数</h2><span class="muted small">最近 8 周</span></div><div class="delta"><b>${thisWeek}</b><span class="${thisWeek >= lastWeek ? 'up' : 'down'}">本周 · 比上周 ${thisWeek >= lastWeek ? '+' : ''}${thisWeek - lastWeek}</span></div></div>
   <svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="最近 8 周每周面试数：${counts.join('、')}">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join('')}
    <path d="${path} L${x(7)},${y(0)} L${x(0)},${y(0)} Z" class="area"/>
    <path d="${path}" class="line"/>
    ${weeks.map((w, k) => `<text x="${x(k)}" y="${H - 6}" class="axis" text-anchor="middle">${k === 7 ? '本周' : label(w)}</text>`).join('')}
    ${pts.map(([px, py], k) => `<g class="pt" data-tt="${k === 7 ? '本周' : `${label(weeks[k])} 那周`}：${counts[k]} 场"><circle cx="${px}" cy="${py}" r="12" class="hit"/><circle cx="${px}" cy="${py}" r="4.5" class="dot ${k === 7 ? 'last' : ''}"/></g>`).join('')}
   </svg>`;
}
// 各岗位进展：每个岗位一条横向堆叠条（达标 / 未达标 / 进行中），最多 6 个岗位。
function byPositionHTML(list, positions) {
  const rows = positions.map((p) => {
    const xs = list.filter((i) => i.positionId === p.id);
    return { p, pass: xs.filter((i) => i.passed === true).length, fail: xs.filter((i) => i.passed === false).length, open: xs.filter((i) => i.passed == null).length, total: xs.length };
  }).filter((r) => r.total).sort((a, b) => b.total - a.total).slice(0, 6);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const seg = (k, n, label, r) => (n ? `<i style="width:${n / max * 100}%;background:${STATUS_COLOR[k]}" data-tt="${esc(r.p.title)} · ${label} ${n} 人"></i>` : '');
  return `<div class="card-head"><h2>各岗位进展</h2><div class="legend small-legend"><span><i style="background:${STATUS_COLOR.pass}"></i>达标</span><span><i style="background:${STATUS_COLOR.fail}"></i>未达标</span><span><i style="background:${STATUS_COLOR.open}"></i>进行中</span></div></div>
   ${rows.length ? `<div class="hbars">${rows.map((r) => `<div class="hbar"><span class="hb-name">${esc(r.p.title)}${levelChip(r.p.level)}</span><span class="hb-track">${seg('pass', r.pass, '达标', r)}${seg('fail', r.fail, '未达标', r)}${seg('open', r.open, '进行中', r)}</span><b>${r.total}</b></div>`).join('')}</div>`
    : `<p class="muted ov-empty">还没有关联岗位的面试。${positions.length ? '添加候选人时选择岗位就会出现在这里。' : '<button class="link" data-go-positions>先新建岗位</button>'}</p>`}`;
}
// 待处理：还没出题、还没面试、还没评估的面试，最近的在前。
function todoHTML(list) {
  const xs = list.filter((i) => TODO[i.status]).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 6);
  const avatar = (name) => `<i class="avatar a${([...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) + 1}">${esc((name || '?').slice(0, 1))}</i>`;
  return `<div class="card-head"><h2>待处理</h2><button class="link small" data-go-home>全部面试</button></div>
   ${xs.length ? `<div class="todo">${xs.map((i) => `<button class="todo-row" data-ov-open="${i.id}" data-ov-tab="${TODO[i.status][1]}">${avatar(i.name)}<span><b>${esc(i.name || '未命名候选人')}</b><small>${esc(i.position || '未填写岗位')}${i.level ? ` · ${esc(i.level)}` : ''}</small></span><em class="todo-tag t-${i.status}">${TODO[i.status][0]}</em></button>`).join('')}</div>`
    : '<p class="muted ov-empty">都处理完了</p>'}`;
}
// 一句提示：已评估的人里最弱的维度，提醒出题时多准备这方面的题。
function insightHTML(evaluated) {
  if (evaluated.length < 2) return '<div class="tip-box">评估过两位以上候选人后，这里会提示大家普遍偏弱的地方。</div>';
  const avgs = Levels.DIMS.map((d, k) => [d, evaluated.reduce((a, i) => a + (i.dims[k] || 0), 0) / evaluated.length]);
  const [weak, v] = avgs.sort((a, b) => a[1] - b[1])[0];
  return `<div class="tip-box">已评估的 ${evaluated.length} 位候选人里，<b>${weak}</b> 普遍最弱（平均 ${v.toFixed(1)} 分）。出题时可以多准备这方面的题，门槛题里也可以放一道。</div>`;
}
main.addEventListener('click', async (e) => {
  if (state.view !== 'overview') return;
  if (e.target.closest('[data-ov-add]')) { $('#newInterview').click(); return; }
  if (e.target.closest('[data-go-home]')) { go('home'); return; }
  const o = e.target.closest('[data-ov-open]');
  if (o) openInterview(o.dataset.ovOpen, o.dataset.ovTab);
});
// 图表悬停提示：带 data-tt 的图形，鼠标停上去显示一行说明。
const chartTip = document.createElement('div');
chartTip.className = 'chart-tip';
chartTip.hidden = true;
document.body.appendChild(chartTip);
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest?.('[data-tt]');
  if (!el) { chartTip.hidden = true; return; }
  chartTip.textContent = el.dataset.tt;
  chartTip.hidden = false;
  const w = chartTip.offsetWidth;
  chartTip.style.left = `${Math.min(window.innerWidth - w - 8, e.clientX + 14)}px`;
  chartTip.style.top = `${e.clientY + 16}px`;
});

// ---------- 岗位 ----------
// 每个岗位：名称 + 级别（初级~专家）+ 岗位要求 + 达标线（平均分和每个维度的最低分）。添加候选人时选岗位，就把这些带进面试。
async function renderPositions() {
  const [list, interviews] = await Promise.all([loadPositions(), call(api.interviews.list()).catch(() => [])]);
  const stat = (id) => {
    const xs = interviews.filter((x) => x.positionId === id);
    return { total: xs.length, judged: xs.filter((x) => x.passed != null).length, passed: xs.filter((x) => x.passed).length };
  };
  main.innerHTML = `<div class="page-scroll"><header class="page-head"><h1>岗位</h1><button class="btn primary" id="newPosition">${icon('plus')}新建岗位</button></header>
   ${list.length ? `<div class="pos-grid">${list.map((p) => positionCardHTML(p, stat(p.id))).join('')}</div>`
    : `<div class="empty"><h3>还没有岗位</h3><p>新建岗位：填写岗位名称、选择级别（初级 / 中级 / 高级 / 资深 / 专家），设置达标线。添加候选人时选择岗位，出题和评估都会按这个级别的要求来。</p><button class="btn primary" id="newPosition2">${icon('plus')}新建岗位</button></div>`}</div>`;
  for (const b of main.querySelectorAll('#newPosition, #newPosition2')) b.addEventListener('click', () => editPosition());
}
function positionCardHTML(p, st) {
  return `<article class="pos-card" data-pos="${p.id}">
   <div class="pos-top"><div class="pos-title"><h3>${esc(p.title)}</h3>${levelChip(p.level)}</div>
    <span class="pos-tools"><button class="nav-icon" data-pos-edit="${p.id}" title="编辑">${icon('edit')}</button><button class="nav-icon danger" data-pos-remove="${p.id}" title="删除">${icon('trash')}</button></span></div>
   <p class="pos-jd">${p.jd ? esc(p.jd) : '<span class="muted">没有填写岗位要求</span>'}</p>
   ${p.skills ? `<div class="pos-skills">${p.skills.split(/[,，、;；\s]+/).filter(Boolean).slice(0, 8).map((k) => `<i>${esc(k)}</i>`).join('')}</div>` : ''}
   <div class="pos-pass"><div class="pos-pass-head"><span>达标线</span><b>平均 ≥ ${p.pass.average}</b></div>
    ${Levels.DIMS.map((d) => `<div class="pos-dim"><span>${d}</span><i class="pos-bar ${DIM_COLORS[d]}"><b style="width:${p.pass.dims[d] / 5 * 100}%"></b></i><em>${p.pass.dims[d]}</em></div>`).join('')}</div>
   <div class="pos-foot"><span class="muted small">${st.total ? `${st.total} 位候选人${st.judged ? ` · 达标 ${st.passed} / ${st.judged}` : ''}` : '还没有候选人'}</span><button class="btn outline" data-pos-add="${p.id}">${icon('plus')}添加候选人</button></div>
  </article>`;
}
main.addEventListener('click', async (e) => {
  if (state.view !== 'positions') return;
  const edit = e.target.closest('[data-pos-edit]');
  if (edit) { editPosition(state.positions.find((p) => p.id === edit.dataset.posEdit)); return; }
  const rm = e.target.closest('[data-pos-remove]');
  if (rm) {
    const p = state.positions.find((x) => x.id === rm.dataset.posRemove);
    if (!await ask({ title: `删除岗位「${p.title} · ${p.level}」？`, body: '已经面试过的候选人不受影响（他们的岗位和达标线已经单独保存）。', ok: '删除', danger: true })) return;
    await call(api.positions.remove(p.id)).catch(ignoreHandled);
    toast('岗位已删除');
    renderPositions();
    return;
  }
  const add = e.target.closest('[data-pos-add]');
  if (add) {
    const p = state.positions.find((x) => x.id === add.dataset.posAdd);
    try {
      const i = await call(api.interviews.create({ positionId: p.id, position: p.title, level: p.level, pass: p.pass, jd: p.jd, skills: p.skills || '' }));
      await openInterview(i.id, 'resume');
    } catch (err) { ignoreHandled(err); }
  }
});
// 新建 / 编辑岗位的弹窗。切换级别时填入该级别的默认达标线（之后可以逐项调整）。
function editPosition(p) {
  const draft = p ? structuredClone(p) : { title: '', level: '中级', jd: '', pass: Levels.defaultPass('中级') };
  const wrap = document.createElement('div');
  wrap.className = 'modal-mask';
  const scoreInput = (name, value, label) => `<label class="pass-row"><span>${label}</span><input type="number" name="${name}" min="0" max="5" step="0.5" value="${value}"></label>`;
  wrap.innerHTML = `<form class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="posTitle" autocomplete="off">
    <div class="sheet-head"><h3 id="posTitle">${p ? '编辑岗位' : '新建岗位'}</h3><button type="button" class="t-close" data-cancel title="关闭">×</button></div>
    <div class="sheet-body">
     <label class="field"><span class="label">岗位名称</span><input name="title" value="${esc(draft.title)}" placeholder="例如：智能体开发工程师"></label>
     <div class="field"><span class="label">级别</span>
      <div class="modes level-seg" role="radiogroup" aria-label="级别">${Levels.LEVEL_NAMES.map((l) => `<label><input type="radio" name="level" value="${l}" ${draft.level === l ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <p class="hint" id="levelDesc">${esc(Levels.LEVELS[draft.level].desc)}</p></div>
     <label class="field"><span class="label">岗位要求（职位画像）<span>出题和评估都会参考</span></span><textarea name="jd" rows="5" placeholder="岗位职责、要具备的能力、加分项…">${esc(draft.jd)}</textarea></label>
     <label class="field"><span class="label">技术栈<span>会专门出语言和框架的题</span></span><input name="skills" value="${esc(draft.skills || '')}" placeholder="例如：Python、FastAPI、LangChain、LangGraph、Milvus"></label>
     <div class="field"><span class="label">达标线<span>评估后平均分和每个维度都不低于这里，才算达标</span></span>
      <div class="pass-grid" id="passGrid">${scoreInput('average', draft.pass.average, '<b>五项平均</b>')}${Levels.DIMS.map((d) => scoreInput(`dim:${d}`, draft.pass.dims[d], `<i class="dot ${DIM_COLORS[d]}"></i>${d}`)).join('')}</div></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn" data-cancel>取消</button><button type="submit" class="btn primary">${p ? '保存' : '创建岗位'}</button></div>
   </form>`;
  const form = wrap.querySelector('form'), f = form.elements;
  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.classList.add('out'); setTimeout(() => wrap.remove(), 120); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.dd-menu')) { e.preventDefault(); close(); } };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-cancel]')) close(); });
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'level') return;
    const def = Levels.defaultPass(e.target.value);
    f.average.value = def.average;
    for (const d of Levels.DIMS) f[`dim:${d}`].value = def.dims[d];
    $('#levelDesc', wrap).textContent = `${Levels.LEVELS[e.target.value].desc}。已填入「${e.target.value}」的默认达标线，可以逐项调整。`;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!f.title.value.trim()) { f.title.focus(); toast('请填写岗位名称', 'warn'); return; }
    const saved = { ...(p || {}), title: f.title.value, level: f.level.value, jd: f.jd.value.trim(), skills: f.skills.value.trim(), pass: { average: Number(f.average.value), dims: Object.fromEntries(Levels.DIMS.map((d) => [d, Number(f[`dim:${d}`].value)])) } };
    try {
      await call(api.positions.save(saved));
      close();
      toast(p ? '岗位已保存' : '岗位已创建');
      if (state.view === 'positions') renderPositions();
    } catch (err) { ignoreHandled(err); }
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
  f.title.focus();
}

// ---------- 设置 ----------
async function renderSettings() {
  const s = state.settings = await call(api.settings.get());
  const P = state.info.providers;
  const tab = state.settingsTab || 'llm';
  const pane = (k) => `data-pane="${k}" ${tab === k ? '' : 'hidden'}`;
  main.innerHTML = `<div class="page-scroll"><header class="page-head"><div><h1>设置</h1><p>配置大模型和语音服务。简历、转写内容会发送给你选择的模型服务商处理。</p></div></header>
  <nav class="tabs" role="tablist" id="settingsTabs">${SETTINGS_TABS.map(([k, label, hk]) => `<button type="button" role="tab" data-stab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${label}${hk ? `<i class="tdot ${health[hk].status}" data-hk="${hk}"></i>` : ''}</button>`).join('')}</nav>
  <form class="settings" id="settingsForm" autocomplete="off">
   <section class="panel" ${pane('llm')}><h2>出题和评估用的大模型</h2>
    <div class="two"><label>服务商<select name="provider">${Object.entries(P).map(([k, p]) => `<option value="${k}" ${s.provider === k ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
    <label>模型<input name="model" list="modelList" value="${esc(s.model)}"><datalist id="modelList">${(P[s.provider]?.models || []).map((m) => `<option value="${m}">`).join('')}</datalist></label></div>
    <label>接口地址<input name="baseURL" value="${esc(s.baseURL)}" placeholder="https://…"></label>
    <label>API Key<input name="apiKey" type="password" placeholder="${esc(s.apiKeyHint || '粘贴 API Key')}"></label>
    <label class="switch-row"><span><b>关闭深度思考</b><small>出题、评估更快更省；个别不支持关闭的模型会自动照常调用</small></span><input type="checkbox" class="switch" role="switch" name="noThinking" ${s.thinking ? '' : 'checked'}></label>
    <div class="row"><button class="btn" type="button" id="testLLM">测试连接</button><span class="muted" id="testLLMResult"></span></div>
   </section>
   <section class="panel" ${pane('asr')}><h2>语音转写与朗读（智谱）</h2>
    <label class="switch-row"><span><b>录音时自动转写</b><small>按说话停顿切段、边录边转；关掉的话可以面试后导入会议软件的转写</small></span><input type="checkbox" class="switch" role="switch" name="asrEnabled" ${s.asrEnabled ? 'checked' : ''}></label>
    <label class="switch-row"><span><b>与「文本大模型」共用 API Key</b><small>文本大模型选的是智谱时打开；用 DeepSeek 时关掉，另填智谱的 Key</small></span><input type="checkbox" class="switch" role="switch" name="asrUseChatKey" ${s.asrUseChatKey ? 'checked' : ''}></label>
    <label class="asr-key" ${s.asrUseChatKey ? 'hidden' : ''}>智谱 API Key<input name="asrKey" type="password" placeholder="${esc(s.asrKeyHint || '粘贴智谱 API Key')}"></label>
    <div class="two"><label>接口地址<input name="asrBaseURL" value="${esc(s.asrBaseURL)}"></label>
    <label>转写模型<input name="asrModel" list="asrModels" value="${esc(s.asrModel)}"><datalist id="asrModels"><option value="glm-asr-2512"><option value="glm-asr"></datalist></label></div>
    <label>每段最长（秒）<input name="chunkSeconds" type="number" min="10" max="28" value="${s.chunkSeconds}"></label>
    <div class="row"><button class="btn" type="button" id="testASR">测试转写</button><span class="muted" id="testASRResult"></span></div>
    <p class="hint">DeepSeek 没有语音服务：用 DeepSeek 出题和评估时，转写和朗读仍需要一个智谱的 Key。不想录音的话，也可以面试后导入飞书妙记、腾讯会议等导出的转写文本。</p>
   </section>
   <section class="panel" ${pane('defaults')}><h2>出题默认值</h2>
    <label>每场题目数量<input name="questionCount" type="number" min="8" max="40" value="${s.questionCount}"></label>
    <p class="hint">岗位名称、级别、岗位要求和达标线在左侧「岗位」里设置，添加候选人时选择岗位即可带入。</p>
   </section>
   <div ${pane('system')} class="sys">
    <section class="panel"><div class="panel-head"><h2>系统自检</h2><button class="btn" type="button" id="recheckHealth2">${icon('refresh')}重新检测</button></div><div id="sysHealth">${healthRowsHTML()}</div></section>
    <section class="panel"><h2>本机数据</h2>
     <div class="kv-row"><span>数据目录</span><button class="link" type="button" id="openData">${esc(state.info.dataDir)}</button></div>
     <div class="kv-row"><span>API Key 保存方式</span><b>${s.encrypted ? '系统钥匙串加密保存' : '本机保存（系统不支持钥匙串加密）'}</b></div>
     <p class="hint">简历、题目、录音、转写和评估都只保存在这台电脑上；生成题目、转写和评估时，相关内容会发送给你选择的模型服务商。录音前请告知候选人并征得同意。</p></section>
    <section class="panel"><h2>关于</h2>
     <div class="kv-row"><span>版本</span><b>面试助手 ${esc(state.info.version)}</b></div>
     <div class="kv-row"><span>系统</span><b>${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[state.info.platform] || esc(state.info.platform)}</b></div></section>
   </div>
   <div class="settings-foot" ${tab === 'system' ? 'hidden' : ''}><p class="hint">切换标签不会丢失未保存的修改，最后点一次保存即可。</p><button class="btn primary big" type="submit">保存设置</button></div>
  </form></div>`;
  $('#settingsTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stab]');
    if (!b) return;
    state.settingsTab = b.dataset.stab;
    main.querySelectorAll('[data-stab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    main.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== state.settingsTab; });
    $('.settings-foot').hidden = state.settingsTab === 'system';
  });
  $('#recheckHealth2').addEventListener('click', () => runHealth());
  const form = $('#settingsForm');
  form.provider.addEventListener('change', () => {
    const p = P[form.provider.value];
    if (p.baseURL) form.baseURL.value = p.baseURL;
    if (p.models[0]) form.model.value = p.models[0];
    $('#modelList').innerHTML = p.models.map((m) => `<option value="${m}">`).join('');
    form.asrUseChatKey.checked = form.provider.value === 'glm';
    $('.asr-key', form).hidden = form.asrUseChatKey.checked;
  });
  form.asrUseChatKey.addEventListener('change', () => { $('.asr-key', form).hidden = form.asrUseChatKey.checked; });
  const collect = () => ({
    provider: form.provider.value, baseURL: form.baseURL.value.trim(), model: form.model.value.trim(), apiKey: form.apiKey.value, thinking: !form.noThinking.checked,
    asrEnabled: form.asrEnabled.checked, asrUseChatKey: form.asrUseChatKey.checked, asrKey: form.asrKey.value,
    asrBaseURL: form.asrBaseURL.value.trim(), asrModel: form.asrModel.value.trim(), chunkSeconds: Number(form.chunkSeconds.value),
    questionCount: Number(form.questionCount.value),
  });
  const saveAll = async () => { state.settings = await call(api.settings.save(collect())); renderSideFoot(); };
  form.addEventListener('submit', async (e) => { e.preventDefault(); try { await saveAll(); toast('设置已保存'); renderSettings(); runHealth(); } catch (err) { ignoreHandled(err); } });
  // 测试结果同时更新侧栏的系统自检
  const test = (btn, out, fn, key) => $(btn).addEventListener('click', async () => {
    $(out).textContent = '测试中…';
    try {
      await saveAll();
      $(out).textContent = `✓ ${await call(fn(), { quiet: true })}`; $(out).className = 'ok';
      setHealth(key, 'ok');
    } catch (err) { $(out).textContent = `✗ ${err.message}`; $(out).className = 'bad'; setHealth(key, 'bad', err.message); }
  });
  test('#testLLM', '#testLLMResult', api.settings.testLLM, 'llm');
  test('#testASR', '#testASRResult', api.settings.testASR, 'asr');
  $('#openData').addEventListener('click', () => api.openDataDir());
}
// ---------- 系统自检（侧栏底部）----------
// 大模型、语音转写各发一次最小的真实请求，麦克风看系统里有没有输入设备。绿色正常，红色不正常（鼠标停在上面看原因）。
const health = { llm: { status: 'wait' }, asr: { status: 'wait' }, mic: { status: 'wait' } };
let healthRun = 0;
function setHealth(key, status, msg = '') {
  health[key] = { status, msg };
  renderSideFoot();
}
async function runHealth() {
  const s = state.settings, run = ++healthRun;
  const check = async (key, fn) => {
    setHealth(key, 'checking');
    try { const msg = await fn(); if (run === healthRun) setHealth(key, msg === 'off' ? 'off' : 'ok'); } catch (err) { if (run === healthRun) setHealth(key, 'bad', err.message); }
  };
  await Promise.all([
    check('llm', async () => { if (!s.apiKeyHint) throw new Error('未配置 API Key'); await call(api.settings.testLLM(), { quiet: true }); }),
    check('asr', async () => {
      if (!s.asrEnabled) return 'off';
      if (!(s.asrUseChatKey ? s.apiKeyHint : s.asrKeyHint)) throw new Error('未配置智谱 API Key');
      await call(api.settings.testASR(), { quiet: true });
    }),
    checkMic(),
  ]);
}
async function checkMic() {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  setHealth('mic', inputs.length ? 'ok' : 'bad', inputs.length ? '' : '没有找到麦克风：请插上麦克风或耳机');
}
navigator.mediaDevices?.addEventListener('devicechange', () => { checkMic().catch(() => {}); });
function renderSideFoot() {
  if (!state.settings) { $('#sideFoot').innerHTML = ''; return; }
  const bad = Object.values(health).filter((h) => h.status === 'bad').length;
  const all = Object.values(health), overall = bad ? 'bad' : all.some((h) => h.status === 'checking' || h.status === 'wait') ? 'checking' : 'ok';
  const foot = $('#sideFoot');
  foot.innerHTML = `<button class="health-btn ${overall}" id="healthBtn" ${foot.classList.contains('open') ? '' : `data-tip="系统自检：${overall === 'ok' ? '正常' : overall === 'bad' ? `${bad} 项异常` : '检测中'}"`} aria-label="系统自检">${icon('pulse')}<i class="sdot"></i></button>
   <div class="health-pop"><div class="k"><span>系统自检${bad ? `<b class="bad-count">${bad} 项异常</b>` : ''}</span><button class="link" id="recheckHealth" ${all.some((h) => h.status === 'checking') ? 'disabled' : ''}>重新检测</button></div>${healthRowsHTML()}</div>`;
  // 设置页里的标签小圆点和「系统设置」里的自检列表也跟着更新
  main.querySelectorAll('.tdot[data-hk]').forEach((d) => { d.className = `tdot ${health[d.dataset.hk].status}`; });
  const sys = $('#sysHealth');
  if (sys) sys.innerHTML = healthRowsHTML();
}
const SETTINGS_TABS = [['llm', '文本大模型', 'llm'], ['asr', '语音大模型', 'asr'], ['defaults', '默认设置', ''], ['system', '系统设置', '']];
function healthRowsHTML() {
  // 只显示状态，不显示模型名；异常时下面一行写原因
  const TEXT = { wait: '等待检测', checking: '检测中…', ok: '正常', off: '已关闭' };
  const rows = [['llm', '大模型'], ['asr', '语音转写'], ['mic', '麦克风']];
  return `<ul class="health">${rows.map(([k, label]) => {
    const h = health[k];
    return `<li class="${h.status}" title="${esc(h.msg || TEXT[h.status])}"><i class="hdot"></i><b>${label}</b><em>${esc(h.status === 'bad' ? '异常' : TEXT[h.status])}</em><small>${esc(h.status === 'bad' ? h.msg : '')}</small></li>`;
  }).join('')}</ul>`;
}
$('#sideFoot').addEventListener('click', (e) => {
  if (e.target.closest('#recheckHealth')) { runHealth(); return; }
  if (e.target.closest('#healthBtn')) { $('#sideFoot').classList.toggle('open'); renderSideFoot(); }
});
// 点自检弹层外面就收起
document.addEventListener('mousedown', (e) => {
  const foot = $('#sideFoot');
  if (foot.classList.contains('open') && !foot.contains(e.target)) { foot.classList.remove('open'); renderSideFoot(); }
});

// ---------- 单场面试 ----------
async function openInterview(id, tab) {
  await flushSave();
  state.view = 'interview';
  state.id = id;
  state.current = null;
  state.openQ = null;
  state.interview = await call(api.interviews.get(id));
  await loadPositions();
  const i = state.interview;
  state.tab = tab || (i.evaluation ? 'eval' : i.status === 'done' ? 'eval' : i.plan ? 'plan' : 'resume');
  setNav();
  renderInterview();
}
const headPosText = (i) => (i.position ? `/ ${esc(i.position)}${i.level ? ` · ${esc(i.level)}` : ''}` : '');
function renderInterview() {
  const i = state.interview;
  main.innerHTML = `<header class="iv-head">
   <div class="iv-title"><button class="back" data-back title="返回面试记录">${icon('back')}</button><h1 id="headName">${esc(i.name || '未命名候选人')}</h1><span class="pos" id="headPos">${headPosText(i)}</span><div class="iv-actions" id="ivActions"></div></div>
   <nav class="steps" id="steps"></nav>
  </header><section class="tab-body" id="tabBody"></section>`;
  renderTab();
}
function refreshSteps() {
  const nav = $('#steps');
  if (!nav) return;
  const i = state.interview, done = stepDone(i);
  nav.innerHTML = STEPS.map(([k, label], n) => {
    const cur = state.tab === k;
    return `<button data-tab="${k}" class="${cur ? 'is-current' : ''} ${done[k] && !cur ? 'done' : ''}"><i class="n">${done[k] && !cur ? '✓' : n + 1}</i><span>${label}</span></button>`;
  }).join('');
}
main.addEventListener('click', (e) => {
  if (state.view !== 'interview') return;
  if (e.target.closest('[data-back]')) { go('home'); return; }
  const t = e.target.closest('.steps [data-tab]');
  if (t) {
    if (state.recState !== 'idle' && t.dataset.tab !== 'live') { toast('正在录音，录音结束后再切换。', 'warn'); return; }
    flushSave();
    state.tab = t.dataset.tab;
    renderTab();
  }
});
function renderTab() {
  const body = $('#tabBody');
  if (state.tab !== 'audio') stopCheck();
  document.body.classList.toggle('focus', state.tab === 'live' && state.recState !== 'idle');
  body.className = `tab-body${state.tab === 'live' ? ' live-mode' : ''}`;
  const actions = $('#ivActions');
  if (actions) actions.innerHTML = '';
  refreshSteps();
  ({ resume: renderResume, audio: renderAudio, plan: renderPlan, live: renderLive, eval: renderEval })[state.tab](body);
}
const progressText = (task) => `<span class="progress" id="progress-${task}">正在连接模型…</span>`;
// ---------- 流式预览 ----------
// 模型边输出，界面边把已经收到的部分渲染成题目卡片 / 评估卡片（解析见 partial-json.js）。
const streamFrames = {};
api.onProgress((p) => {
  if (p.id !== state.id) return;
  const el = document.getElementById(`progress-${p.task}`);
  if (el) el.textContent = p.thinking && !p.text ? `模型思考中…（${p.received} 字）` : `正在生成…已收到 ${p.received} 字`;
  if (typeof p.text !== 'string') return;
  state.stream[p.task] = p.text;
  if (streamFrames[p.task]) return;
  streamFrames[p.task] = requestAnimationFrame(() => {
    streamFrames[p.task] = 0;
    const box = document.getElementById(`stream-${p.task}`);
    const data = parsePartialJSON(state.stream[p.task]);
    if (!box || !data) return;
    // 停在底部时跟着新内容往下走；往上翻看时不打扰。
    const scroller = document.querySelector('.tab-body'), follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    box.innerHTML = (p.task === 'plan' ? planStreamHTML : evalStreamHTML)(data);
    if (follow) scroller.scrollTop = scroller.scrollHeight;
  });
});
const list = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x) : []);
function planStreamHTML(p) {
  const c = p.candidate || {}, sections = Array.isArray(p.sections) ? p.sections : [];
  const all = sections.flatMap((s) => (Array.isArray(s?.questions) ? s.questions : []));
  const last = all.at(-1);
  return `<div class="panel summary"><div class="eyebrow">候选人速览</div><p class="quote">${c.summary ? esc(c.summary) : '<span class="muted">正在读简历…</span>'}</p>
    ${list(c.highlights).length ? `<h4>${icon('target')}值得深挖</h4><ul>${list(c.highlights).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
   <div class="plan-bar"><span class="count">已生成 <b>${all.filter((q) => q?.q).length}</b> 道题</span></div>
   ${sections.filter((s) => s?.title).map((s) => `<section class="section"><h2>${kindChip(s.source)}${esc(s.title)}<span>${(s.questions || []).length} 题</span></h2>${(Array.isArray(s.questions) ? s.questions : []).filter((q) => q?.q).map((q) => `<article class="q streaming ${q === last ? 'typing' : ''}">
     <div class="q-main">${q.dim ? `<i class="dim ${DIM_COLORS[q.dim] || ''}">${esc(q.dim)}</i>` : ''}<div class="q-text"><h3>${esc(q.q)}</h3>${q.why ? `<p class="sub">${esc(q.why)}</p>` : ''}</div>${q === last ? '<span class="q-actions muted small">生成中…</span>' : ''}</div>
     ${list(q.points).length || q.follow ? `<div class="q-detail"><div><div class="mini-label">回答要点</div><ul class="checks">${list(q.points).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div>${q.follow ? `<div class="mini-label">追问</div><p class="follow-box">${esc(q.follow)}</p>` : ''}</div></div>` : ''}</article>`).join('')}</section>`).join('')}`;
}
function evalStreamHTML(e) {
  const dims = (Array.isArray(e.dimensions) ? e.dimensions : []).filter((d) => d?.name);
  const o = e.overall || {};
  return `${o.verdict || o.summary ? `<div class="panel verdict-panel"><div><div class="verdict-line"><i class="verdict-big ${VERDICT_CLASS[o.verdict] || ''}">${esc(o.verdict || '…')}</i>${o.level ? `<span class="level-chip">${esc(o.level)}</span>` : ''}</div>${summaryList(o.summary)}</div></div>` : ''}
   <div class="dims">${dims.map((d, k) => `<div class="panel dim-card ${k === dims.length - 1 && !o.verdict ? 'typing' : ''}">
    <div class="dim-top"><i class="dim ${DIM_COLORS[d.name] || ''}">${esc(d.name)}</i><span class="score-pick"><b>${typeof d.score === 'number' ? d.score : '…'}</b></span></div>
    <div class="score-bar ${DIM_COLORS[d.name] || ''}"><i style="width:${typeof d.score === 'number' ? d.score / 5 * 100 : 0}%"></i></div>
    <p>${esc(d.reason || '')}</p>${list(d.evidence).length ? `<ul class="evidence">${list(d.evidence).map((x) => `<li>${esc(unquote(x))}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
   ${dims.length ? '' : '<p class="muted stream-wait">正在阅读转写，马上开始给分…</p>'}`;
}


// 1 简历
// 应聘岗位：有岗位时从下拉里选（带入名称、级别、要求和达标线），没有岗位时直接填名称。
function positionPickerHTML(i) {
  if (!state.positions.length) return `<label><span class="label">应聘岗位<button class="link small" data-go-positions>去设置岗位</button></span><input id="posInput" value="${esc(i.position)}" placeholder="例如：智能体开发工程师"></label>`;
  return `<label><span class="label">应聘岗位<button class="link small" data-go-positions>管理岗位</button></span><select id="posSelect"><option value="">不关联岗位</option>${state.positions.map((p) => `<option value="${p.id}" ${i.positionId === p.id ? 'selected' : ''}>${esc(p.title)} · ${esc(p.level)}</option>`).join('')}</select></label>`;
}
// 关联岗位：把岗位当时的设置复制到这场面试（之后改岗位不会影响已经面过的人）。
function linkPosition(i, p) {
  const patch = p ? { positionId: p.id, position: p.title, level: p.level, pass: p.pass, jd: p.jd, skills: p.skills || '' } : { positionId: '', level: '', pass: null };
  Object.assign(i, patch);
  saveField(patch);
}
function renderResume(body) {
  const i = state.interview;
  body.innerHTML = `<div class="tab-inner"><div class="grid-2">
   <div class="panel"><div class="card-title">${icon('file')}候选人简历</div>
    <div class="basic"><label><span class="label">候选人姓名</span><input id="nameInput" value="${esc(i.name)}" placeholder="例如：刘贵平"></label>
     ${positionPickerHTML(i)}</div>
    ${!i.positionId && state.positions.length ? `<label class="field"><span class="label">岗位名称（不关联岗位时手动填写）</span><input id="posInput" value="${esc(i.position)}" placeholder="例如：智能体开发工程师"></label>` : ''}
    ${i.positionId && i.pass ? `<p class="pos-linked">${levelChip(i.level)}<span>达标线：平均 ≥ ${i.pass.average}，${Levels.DIMS.map((d) => `${d} ≥ ${i.pass.dims[d]}`).join('、')}</span></p>` : ''}
    <div class="drop" id="drop">${icon('upload')}<strong>把简历拖到这里，或点击选择文件</strong><span>支持 PDF、TXT 格式 · 文件只在本机解析</span></div>
    <div class="parsed"><span>解析结果（可直接粘贴或修改）</span>${i.resumeName ? `<span class="file-chip">简历：${esc(i.resumeName)}</span>` : ''}</div>
    <textarea id="resumeText" rows="14" placeholder="上传后这里会显示读取到的简历文字">${esc(i.resume)}</textarea>
   </div>
   <div class="panel"><div class="card-title">${icon('target')}岗位要求${i.positionId ? '<span class="muted small" style="font-weight:400">从岗位带入，改动只对这场面试生效</span>' : '（可选）'}</div>
    <textarea id="jdText" rows="13" placeholder="岗位职责、要具备的能力，出题会围绕这些来问">${esc(i.jd)}</textarea>
    <label class="field" style="margin-top:14px"><span class="label">技术栈<span>会专门出语言和框架的题</span></span><input id="skillsInput" value="${esc(i.skills || '')}" placeholder="例如：Python、FastAPI、LangChain"></label>
    <p class="info-note">${icon('info')}<span>填好姓名、岗位和简历后，下一步先调试麦克风和耳机，再生成面试题。</span></p>
   </div></div></div>
   <div class="action-bar"><span class="muted small">${i.resume.trim() ? `简历约 ${i.resume.replace(/\s/g, '').length} 字` : '还没有简历内容'}</span><button class="btn primary big" data-tab-go="audio">下一步：调试音频 ${icon('chevR')}</button></div>`;
  const drop = $('#drop');
  const importFile = async (path) => {
    if (!path) return;
    drop.classList.add('loading');
    try {
      await flushSave(); // 先存下刚输入的姓名、岗位，否则导入结果会把它们覆盖回旧值
      state.interview = await call(api.resume.import(state.id, path));
      toast('简历已读取');
      renderResume(body);
      refreshSteps();
    } catch (err) { ignoreHandled(err); } finally { drop.classList.remove('loading'); }
  };
  drop.addEventListener('click', async () => importFile(await call(api.resume.pick()).catch(() => null)));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importFile(api.resume.pathOf(f)); });
  $('#nameInput').addEventListener('input', (e) => { i.name = e.target.value; saveField({ name: i.name }); $('#headName').textContent = i.name || '未命名候选人'; });
  $('#posInput')?.addEventListener('input', (e) => { i.position = e.target.value; saveField({ position: i.position }); $('#headPos').innerHTML = headPosText(i); });
  $('#posSelect')?.addEventListener('change', (e) => { linkPosition(i, state.positions.find((p) => p.id === e.target.value)); renderResume(body); $('#headPos').innerHTML = headPosText(i); });
  $('#resumeText').addEventListener('input', (e) => { i.resume = e.target.value; saveField({ resume: i.resume }); });
  $('#jdText').addEventListener('input', (e) => { i.jd = e.target.value; saveField({ jd: i.jd }); });
  $('#skillsInput').addEventListener('input', (e) => { i.skills = e.target.value; saveField({ skills: i.skills }); });
}
async function generatePlan() {
  const i = state.interview;
  if (!i.resume.trim()) { toast('请先上传或粘贴简历。', 'warn'); return; }
  if (i.plan && !await ask({ title: '重新生成面试题？', body: '现有题目、「换个问法」的改动和「已问」标记都会被覆盖。', ok: '重新生成', danger: true })) return;
  state.busy.plan = true;
  state.stream.plan = '';
  state.openQ = null;
  // 直接切到「面试题」，边生成边显示。
  state.tab = 'plan';
  renderInterview();
  try {
    await flushSave();
    state.interview = await call(api.plan.generate(i.id));
    toast('面试题已生成');
  } catch (err) { ignoreHandled(err); }
  state.busy.plan = false;
  if (state.view === 'interview' && state.id === i.id) renderInterview();
}

// 2 面试题
function questionCard(q) {
  const open = state.openQ === q.id;
  return `<article class="q ${q.asked ? 'asked' : ''} ${open ? 'open' : ''}" data-q="${q.id}">
   <div class="q-main" data-toggle-q="${q.id}"><i class="dim ${DIM_COLORS[q.dim] || ''}">${esc(q.dim)}</i>
    <div class="q-text"><h3>${esc(q.q)}</h3><p class="sub">${diffChip(q)}${q.kind && KIND[q.kind] ? `<span>${KIND[q.kind]}</span>` : ''}${q.minutes ? `<span>约 ${q.minutes} 分钟</span>` : ''}${q.why ? `<span>${esc(q.why)}</span>` : ''}</p></div>
    <span class="q-actions"><button class="link" data-rewrite="${q.id}">换个问法</button><button class="tick ${q.asked ? 'on' : ''}" data-ask="${q.id}">${q.asked ? '✓ 已问' : '标记已问'}</button><span class="muted">${icon(open ? 'chevU' : 'chevD')}</span></span></div>
   <div class="q-detail"><div><div class="mini-label">回答要点</div><ul class="checks">${q.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
     ${q.follow ? `<div class="mini-label" style="margin-top:14px">追问</div><p class="follow-box">${esc(q.follow)}</p>` : ''}</div>
    <div class="signals">${q.good ? `<p class="good"><b>答得不错的表现</b>${esc(q.good)}</p>` : ''}${q.bad ? `<p class="bad"><b>需要警惕</b>${esc(q.bad)}</p>` : ''}</div></div></article>`;
}
// 各类题目数量：项目 7 · 画像 4 · 技术 5 · 做事方式 3
function kindCounts(p) {
  const n = {};
  for (const s of p.sections) for (const q of s.questions) { const k = KIND[q.kind] || KIND[s.source] || '项目'; n[k] = (n[k] || 0) + 1; }
  const gate = p.sections.filter((s) => s.source === 'gate');
  const gateText = gate.length ? `前 ${gate.reduce((a, s) => a + sectionMinutes(s), 0) || 15} 分钟门槛题 ${gate.reduce((a, s) => a + s.questions.length, 0)} 道 · ` : '';
  return gateText + ['开场', '项目', '画像', '技术', '做事方式'].filter((k) => n[k]).map((k) => `${k} ${n[k]}`).join(' · ');
}
function renderPlan(body) {
  const i = state.interview, p = i.plan;
  if (state.busy.plan) {
    const data = parsePartialJSON(state.stream.plan);
    body.innerHTML = `<div class="tab-inner"><div class="plan streaming-plan"><div class="stream-head">${progressText('plan')}<span class="muted">题目会一道道出现，生成完可以「换个问法」和标记已问</span></div><div id="stream-plan">${data ? planStreamHTML(data) : '<p class="muted stream-wait">正在读简历、准备题目…</p>'}</div></div></div>`;
    return;
  }
  if (!p) {
    body.innerHTML = `<div class="tab-inner"><div class="empty gen-plan"><h3>生成面试题</h3><p>会生成：开场热身、简历里每个项目的追问、岗位基础题、做事方式题（自驱力 / 性格 / 适应力），全部用大白话，并附回答要点和追问。题目会边生成边显示。</p>
     ${i.resume.trim() ? `<button class="btn primary big" id="genPlan">${icon('sparkle')}生成面试题</button>` : '<p class="warn">还没有简历内容。</p><button class="btn primary" data-tab-go="resume">去「1 候选人」上传简历</button>'}</div></div>`;
    $('#genPlan')?.addEventListener('click', generatePlan);
    return;
  }
  const qs = allQuestions(p), asked = qs.filter((q) => q.asked).length;
  if (state.openQ == null) state.openQ = (qs.find((q) => !q.asked) || qs[0])?.id;
  const verify = p.verify.map((v) => `<li>${esc(v.point)}${v.ask ? `<span class="ask">可以问：${esc(v.ask)}</span>` : ''}</li>`).join('') || p.candidate.doubts.map((x) => `<li>${esc(x)}</li>`).join('');
  body.innerHTML = `<div class="tab-inner"><div class="plan">
   <div class="panel summary"><div class="eyebrow">候选人速览</div><p class="quote">${esc(p.candidate.summary)}</p>
    <div class="grid-2"><div><h4>${icon('target')}值得深挖</h4><ul>${p.candidate.highlights.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
    <div><h4>${icon('alert')}需要核实</h4><ul>${verify || '<li class="muted">—</li>'}</ul></div></div></div>
   <div class="plan-bar"><span class="count"><span>共 <b>${qs.length}</b> 道题</span><span>已问 <b>${asked}</b></span><span class="kinds">${kindCounts(p)}</span></span><span class="row"><button class="btn" id="genPlan">${icon('refresh')}重新生成</button><button class="btn primary" data-tab-go="live">开始面试 ${icon('chevR')}</button></span></div>
   ${p.sections.map((s) => `<section class="section ${s.source === 'gate' ? 'gate' : ''}"><h2>${sectionHead(s)}</h2>${s.source === 'gate' ? '<p class="gate-hint">先问这几道：最难、最能看出是否达到目标级别，前 15 分钟答不好基本可以判断不合适。</p>' : ''}${s.questions.map((q) => questionCard(q)).join('')}</section>`).join('')}
  </div></div>`;
  $('#genPlan').addEventListener('click', generatePlan);
}
main.addEventListener('click', async (e) => {
  if (state.view !== 'interview') return;
  const goTab = e.target.closest('[data-tab-go]');
  if (goTab) { state.tab = goTab.dataset.tabGo; renderInterview(); return; }
  const ask = e.target.closest('[data-ask]');
  if (ask) {
    const q = allQuestions(state.interview.plan).find((x) => x.id === ask.dataset.ask);
    q.asked = !q.asked;
    api.interviews.save({ id: state.id, plan: state.interview.plan });
    refreshSteps();
    if (ask.closest('#liveQuestions')) { refreshLiveQuestions(); return; }
    const card = ask.closest('.q');
    card.classList.toggle('asked', q.asked);
    ask.classList.toggle('on', q.asked);
    ask.textContent = q.asked ? '✓ 已问' : '标记已问';
    return;
  }
  const mark = e.target.closest('[data-mark]');
  if (mark) {
    const cur = currentQuestion(allQuestions(state.interview.plan)), n = Number(mark.dataset.mark);
    cur.marks = { ...(cur.marks || {}), [n]: !(cur.marks?.[n] ?? cur.review?.covered[n] ?? false) };
    savePlan();
    refreshLiveQuestions();
    return;
  }
  const pick = e.target.closest('[data-pick]');
  if (pick) { setCurrent(allQuestions(state.interview.plan).find((q) => q.id === pick.dataset.pick)); return; }
  const review = e.target.closest('[data-review]');
  if (review) { runReview(allQuestions(state.interview.plan).find((q) => q.id === review.dataset.review), { manual: true }); return; }
  const play = e.target.closest('[data-play]');
  if (play) { playPart(Number(play.dataset.play)); return; }
  const askNext = e.target.closest('[data-ask-next]');
  if (askNext) {
    const qs = allQuestions(state.interview.plan), q = qs.find((x) => x.id === askNext.dataset.askNext);
    q.asked = true;
    api.interviews.save({ id: state.id, plan: state.interview.plan });
    const after = [...qs.slice(qs.indexOf(q) + 1), ...qs.slice(0, qs.indexOf(q))].find((x) => !x.asked);
    setCurrent(after || q);
    return;
  }
  const rw = e.target.closest('[data-rewrite]');
  if (rw) {
    await flushSave();
    rw.disabled = true;
    rw.textContent = '改写中…';
    try {
      state.interview = await call(api.plan.rewrite(state.id, rw.dataset.rewrite));
      const q = allQuestions(state.interview.plan).find((x) => x.id === rw.dataset.rewrite);
      rw.closest('.q').outerHTML = questionCard(q);
    } catch (err) { ignoreHandled(err); rw.disabled = false; rw.textContent = '换个问法'; }
    return;
  }
  // 点题目那一行展开 / 收起回答要点（点行里的按钮不算）
  const toggle = e.target.closest('[data-toggle-q]');
  if (toggle && !e.target.closest('button')) {
    const id = toggle.dataset.toggleQ, prev = state.openQ;
    state.openQ = prev === id ? '' : id;
    for (const qid of [prev, id]) {
      const card = qid && main.querySelector(`.q[data-q="${qid}"]`);
      if (card) card.outerHTML = questionCard(allQuestions(state.interview.plan).find((x) => x.id === qid));
    }
  }
});

// ---------- 2 音频调试 ----------
// 两路声音各挂一个说话检测（Listener）：音量条和「正在说话」只在真的有人说话时亮；
// 点「开始测试」后，每说完一句就自动转写。模拟候选人：电脑朗读一段话（真的播放出来），
// 从候选人那一路录到这句话再转写。每次进入这一步都重新测试，不沿用上次的结果。
const SAMPLE = '您好，我叫王小明，最近两年主要在做智能体和知识库问答的项目。';
const READ_ALOUD = '我们先从你最近做的一个项目聊起，说说你具体负责哪一块。';
const PASS = 0.6; // 转写和应有的句子至少对上 60% 才算通过
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freshCheck = () => ({ streams: {}, listeners: {}, inputs: [], outputs: [], testing: {}, lines: { mic: [], cand: [] }, note: {}, passed: {}, sim: null, lastClip: null, error: '' });
let check = freshCheck();
function stopCheck() {
  for (const l of Object.values(check.listeners)) l.close().catch(() => {});
  for (const s of Object.values(check.streams)) s.getTracks().forEach((t) => t.stop());
  window.speechSynthesis?.cancel();
  check = freshCheck();
}
async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  check.inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  check.defaultInput = all.find((d) => d.kind === 'audioinput' && d.deviceId === 'default');
  check.outputs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
// 面对面时候选人和面试官共用麦克风，「候选人」这一路就是麦克风那一路。
const candKey = () => (state.settings.recordMode === 'online' ? 'cand' : 'mic');
function attach(key, stream) {
  check.listeners[key]?.close().catch(() => {});
  check.streams[key]?.getTracks().forEach((t) => t.stop());
  check.streams[key] = stream;
  check.listeners[key] = new Listener(stream, {
    onLevel: ({ level, speaking }) => {
      const bar = document.getElementById(`meter-${key}`), dot = document.getElementById(`speak-${key}`);
      if (bar) bar.style.width = `${Math.min(100, level * 400)}%`;
      if (dot) { dot.classList.toggle('on', speaking); dot.textContent = speaking ? '● 正在说话' : '○ 安静'; }
      // 模拟候选人时面试官的麦克风也在响：电脑里的声音漏进了麦克风（串音）。
      if (speaking && key === 'mic' && check.sim?.key === 'cand') check.sim.micHeard = true;
    },
    onUtterance: (wav) => heard(key, wav),
  });
}
async function openMic() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(state.settings.micId));
  } catch (err) {
    if (!state.settings.micId) throw err;
    state.settings = await call(api.settings.save({ micId: '' })); // 保存的设备拔掉了：退回系统默认
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(''));
  }
  attach('mic', stream);
}
async function openCandidate() {
  check.note.candErr = '';
  try {
    attach('cand', await candidateStream(state.settings.candidateSource));
  } catch (err) {
    check.note.candErr = state.settings.candidateSource === 'system'
      ? '这台电脑录不到系统声音。可以改选「立体声混音」或虚拟声卡（Windows：VB-CABLE；macOS：BlackHole）。'
      : `打不开这个设备：${err.message}`;
  }
}
async function startCheck() {
  if (check.listeners.mic || check.starting || state.recState !== 'idle') return;
  check.starting = true;
  try {
    await call(api.audio.askMic());
    await openMic();
    await listDevices();
    if (state.settings.recordMode === 'online') await openCandidate();
  } catch (err) {
    check.error = /Permission|NotAllowed/i.test(err.name + err.message) ? '没有麦克风权限：请在系统设置里允许「面试助手」使用麦克风，然后点「重新检测」。' : `打不开麦克风：${err.message}`;
  }
  check.starting = false;
  refreshAudio();
}
// 听到一句话：模拟候选人等待中的归候选人；否则在「开始测试」状态下归这一路。
async function heard(key, wav) {
  let who = null;
  if (check.sim && check.sim.key === key) { who = 'cand'; check.sim.got = true; }
  else if (check.testing[key === 'cand' ? 'cand' : 'mic']) who = key === 'cand' ? 'cand' : 'mic';
  if (!who) return;
  if (who === 'mic') check.lastClip = wav;
  // 面试官读的是给定句子，模拟候选人朗读的是 SAMPLE，都能和转写比对；真人测试没有标准答案，只看有没有转出字。
  const expected = who === 'mic' ? READ_ALOUD : check.sim ? SAMPLE : '';
  const line = { text: '', status: 'pending', sim: Boolean(check.sim && who === 'cand'), expected };
  check.lines[who] = [line, ...check.lines[who]].slice(0, 2);
  refreshAudio();
  try {
    line.text = await call(api.audio.test(wav), { quiet: true });
    // 没转出字（多半是噪声）就不列出来，免得刷屏；模拟候选人时才提示。
    if (!line.text && !line.sim) { check.lines[who] = check.lines[who].filter((l) => l !== line); refreshAudio(); return; }
    line.score = expected && line.text ? coverage(expected, line.text) : null;
    line.status = !line.text ? 'empty' : line.score !== null && line.score < PASS ? 'mismatch' : 'ok';
    if (line.status === 'ok') {
      check.passed[who] = true;
      markChecked(who === 'mic' ? 'interviewer' : 'candidate');
    }
  } catch (err) {
    line.status = 'error';
    line.text = err.message;
  }
  refreshAudio();
}
function markChecked(who) {
  const i = state.interview;
  i.audioCheck = { ...(i.audioCheck || {}), [who]: true, at: new Date().toISOString() };
  saveField({ audioCheck: i.audioCheck });
  refreshSteps();
}
// 朗读用的中文语音：语音列表是异步加载的，第一次取常常是空的，要等一下。
async function chineseVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  let voices = synth.getVoices();
  if (!voices.length) {
    await Promise.race([new Promise((r) => synth.addEventListener('voiceschanged', r, { once: true })), sleep(1500)]);
    voices = synth.getVoices();
  }
  return voices.find((v) => /^zh/i.test(v.lang)) || null;
}
const outputName = () => check.outputs.find((d) => d.deviceId === state.settings.outputId)?.label || '系统默认播放设备';
// 播放一段 wav：用选定的播放设备（setSinkId），播完或超时返回。
async function playWav(bytes, maxMs = 15000) {
  const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
  if (state.settings.outputId && audio.setSinkId) await audio.setSinkId(state.settings.outputId);
  await audio.play();
  await Promise.race([new Promise((r) => { audio.onended = r; }), sleep(maxMs)]);
  audio.pause();
}
function beepWav() {
  const rate = 16000, n = Math.round(rate * 0.8), b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, t) => [...t].forEach((c, k) => b.setUint8(o + k, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) b.setInt16(44 + k * 2, Math.round(Math.sin(k / rate * 2 * Math.PI * 660) * 9000 * Math.min(1, k / 800, (n - k) / 800)), true);
  return b.buffer;
}
async function playSample() {
  // 首选：智谱 GLM-TTS 合成的朗读（缓存），从选定的播放设备放出来。
  try {
    const wav = check.ttsWav || (check.ttsWav = await call(api.audio.tts(SAMPLE), { quiet: true }));
    check.note.sim = `▶ 正在从「${outputName()}」播放模拟候选人的声音…`;
    refreshAudio();
    await playWav(wav);
    return;
  } catch { /* 合成不可用时退回系统朗读 */ }
  const zh = await chineseVoice();
  if (zh) {
    check.note.sim = `▶ 正在用系统语音朗读（从系统默认播放设备出来）…`;
    refreshAudio();
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(SAMPLE);
      Object.assign(u, { voice: zh, lang: zh.lang, rate: 1, volume: 1, onend: resolve, onerror: resolve });
      window.speechSynthesis.speak(u);
      setTimeout(resolve, 12000);
    });
    return;
  }
  if (!check.lastClip) throw new Error('这台电脑没有中文朗读语音。请先在左边「开始测试」说一句话，再用你的这句录音来模拟候选人。');
  check.note.sim = '▶ 这台电脑没有中文朗读语音，正在播放你刚才说的那句话来模拟候选人';
  refreshAudio();
  await playWav(check.lastClip, 13000).catch(() => {});
}
async function simulateCandidate() {
  const key = candKey();
  if (key === 'cand' && !check.listeners.cand) await openCandidate();
  if (!check.listeners[key]) { refreshAudio(); return; }
  check.sim = { key, got: false };
  check.note.sim = '';
  refreshAudio();
  try {
    await playSample();
    // 朗读结束后再等一会儿，让最后一句的停顿被检测到。
    for (let t = 0; t < 25 && !check.sim.got; t++) await sleep(100);
    check.note.crosstalk = key === 'cand' && check.sim.micHeard
      ? '⚠ 模拟候选人说话时，你的麦克风也录到了这段声音：电脑的声音漏进了麦克风。面试时候选人的话会被记成两遍（面试官一遍、候选人一遍）。请戴耳机，或把扬声器音量调小、麦克风离扬声器远一点，再模拟一次。'
      : '';
    check.note.sim = check.sim.got ? '' : (key === 'cand'
      ? '✗ 播放了，但候选人那一路没录到声音：确认耳机是系统默认播放设备，或换一个候选人声音来源'
      : '✗ 播放了，但麦克风没录到：把扬声器音量调大，或让麦克风离扬声器近一点再试');
  } catch (err) {
    check.note.sim = `✗ ${err.message}`;
  }
  check.sim = null;
  refreshAudio();
}
async function playTone() {
  check.note.tone = `▶ 正在从「${outputName()}」播放「嘀」…`;
  check.toneAsk = false;
  refreshAudio();
  try {
    await playWav(beepWav(), 3000);
    check.note.tone = '';
    check.toneAsk = true;
  } catch (err) {
    check.note.tone = `✗ 播放失败：${err.message}。换一个播放设备试试。`;
  }
  refreshAudio();
}
const deviceOptions = (list, selected) => `<option value="" ${selected ? '' : 'selected'}>系统默认</option>${list.map((d, k) => `<option value="${esc(d.deviceId)}" ${d.deviceId === selected ? 'selected' : ''}>${esc(d.label || `设备 ${k + 1}`)}</option>`).join('')}`;
const LINE_TEXT = { pending: '转写中…', empty: '没识别出文字：靠近一点、说清楚一点再试', error: '' };
const pct = (x) => `${Math.round(x * 100)}%`;
function linesHTML(lines, hint) {
  if (!lines.length) return `<p class="lines-empty">${hint}</p>`;
  return `<ul class="lines">${lines.map((l) => {
    const tag = l.sim ? '<em>模拟</em>' : '';
    const body = l.status === 'ok' ? `「${esc(l.text)}」${tag}${l.score != null ? `<small>准确 ${pct(l.score)}</small>` : ''}`
      : l.status === 'mismatch' ? `转写出来的和${l.sim ? '朗读' : '要读'}的不一样（只对上 ${pct(l.score)}）：「${esc(l.text)}」${tag}<small>可能录到了别的声音、音量太小或离得太远</small>`
      : esc(LINE_TEXT[l.status] || l.text);
    return `<li class="${l.status}"><b>${l.status === 'ok' ? '✓' : l.status === 'pending' ? '…' : '✗'}</b><span>${body}</span></li>`;
  }).join('')}</ul>`;
}
function audioHTML() {
  const s = state.settings, online = s.recordMode === 'online';
  if (check.error) return `<div class="tab-inner"><div class="audio-wrap"><div class="panel"><p class="note bad">${esc(check.error)}</p><button class="btn" id="recheck">重新检测</button></div></div></div>`;
  const status = (done, label) => `<span class="badge ${done ? 'ok' : 'pending'}">${done ? '✓' : '○'} ${label}</span>`;
  const note = (text) => (text ? `<p class="note ${text.startsWith('✗') ? 'bad' : text.startsWith('✓') ? 'ok' : ''}">${esc(text)}</p>` : '');
  return `<div class="tab-inner"><div class="audio-wrap">
   <div class="seg"><div class="modes" role="radiogroup" aria-label="面试方式">
    <label><input type="radio" name="recordMode" value="offline" ${online ? '' : 'checked'}> 面对面</label>
    <label><input type="radio" name="recordMode" value="online" ${online ? 'checked' : ''}> 线上（戴耳机）</label></div></div>
   <p class="mode-hint">${online ? '线上：你的麦克风 = 面试官；会议软件里对方的声音单独录一路 = 候选人。' : '面对面：一个麦克风录下双方，结束后由模型区分面试官和候选人。'}</p>
   <div class="audio-grid">
    <section class="panel side-card">
     <div class="card-title">${icon('mic')}面试官（我）<span class="speak" id="speak-mic">○ 安静</span></div>
     <label class="field"><span class="label">麦克风</span><select id="micSelect">${deviceOptions(check.inputs, s.micId)}</select></label>
     <div class="field"><span class="label">输入音量</span><div class="meter"><i id="meter-mic"></i></div></div>
     <div class="label">请朗读下面这句话</div>
     <p class="read-aloud">「${READ_ALOUD}」</p>
     <button class="btn wide ${check.testing.mic ? '' : 'outline'}" id="testMic" ${check.listeners.mic ? '' : 'disabled'}>${check.testing.mic ? '停止测试' : '开始测试'}</button>
     ${check.testing.mic ? '<p class="hint subtle-link">请读上面这句话，读完停一下就会自动转写</p>' : ''}
     ${linesHTML(check.lines.mic, '点「开始测试」，读一遍上面的句子')}
    </section>
    <section class="panel side-card">
     <div class="card-title">${icon('headphones')}候选人${online && check.listeners.cand ? '<span class="speak" id="speak-cand">○ 安静</span>' : ''}</div>
     <div class="field"><span class="label">播放设备（你的耳机）</span><div class="inline"><select id="outSelect">${deviceOptions(check.outputs, s.outputId)}</select><button class="btn" id="playTone">${icon('play')}播放测试音</button></div>
      ${check.toneAsk ? '<div class="tone-ask">听到「嘀」声了吗？<span><button id="toneYes">听到了</button><button id="toneNo">没听到</button></span></div>' : ''}</div>
     ${note(check.note.tone)}
     ${check.toneHelp ? '<p class="note bad">没听到：确认耳机已连接、系统音量没静音，或者在上面换一个播放设备再试。蓝牙耳机要先在系统里连上才会出现在列表里。</p>' : ''}
     ${online ? `<label class="field"><span class="label">声音来源</span><select id="candSelect"><option value="system" ${s.candidateSource === 'system' ? 'selected' : ''}>电脑声音（推荐：会议软件里对方的声音）</option>${candidateInputs().length ? `<optgroup label="其他输入设备（装了虚拟声卡 / 立体声混音才需要）">${candidateInputs().map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === s.candidateSource ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</optgroup>` : ''}</select></label>
      ${remoteDeskWarning()}
      ${check.listeners.cand ? '<div class="field"><span class="label">声音来源音量</span><div class="meter"><i id="meter-cand"></i></div></div>' : ''}${note(check.note.candErr)}`
     : '<p class="hint" style="margin:0 0 16px">面对面：候选人和你共用左边的麦克风。</p>'}
     <button class="btn wide ${check.sim ? '' : 'outline'}" id="simCand" ${check.sim ? 'disabled' : ''}>${check.sim ? '测试中…' : '开始测试（系统将播放样例并识别）'}</button>
     ${online && check.listeners.cand ? `<button class="link subtle-link" id="testCand">${check.testing.cand ? '停止真人测试' : '对方已在会议里？改用真人测试'}</button>` : ''}
     ${note(check.note.sim)}
     ${check.note.crosstalk ? `<p class="note warn-note">${esc(check.note.crosstalk)}</p>` : ''}
     ${linesHTML(check.lines.cand, '点上面的按钮，电脑会朗读一句话并转写')}
    </section>
   </div></div></div>
  <div class="action-bar"><div class="badges">${status(check.passed.mic, '面试官转写正常')}${status(check.passed.cand, '候选人转写正常')}</div>
   <button class="btn primary big" data-tab-go="plan">下一步：生成面试题 ${icon('chevR')}</button></div>`;
}
// 远程控制软件（ToDesk、向日葵等）的虚拟麦克风不是会议里对方的声音，常带底噪，选错时提醒。
function remoteDeskWarning() {
  const d = check.inputs.find((x) => x.deviceId === state.settings.candidateSource);
  return d && /todesk|sunlogin|向日葵|anydesk|teamviewer|rustdesk|parsec|oray/i.test(d.label)
    ? `<p class="note warn-note">「${esc(d.label)}」是远程控制软件的虚拟麦克风，不是会议里对方的声音。请改选「电脑声音」。</p>` : '';
}
// 候选人的声音不能和面试官用同一个麦克风，否则两路是同一个声音。
function candidateInputs() {
  const mic = check.inputs.find((d) => d.deviceId === state.settings.micId) || check.defaultInput;
  return check.inputs.filter((d) => !mic || (d.deviceId !== mic.deviceId && (!d.groupId || d.groupId !== mic.groupId)));
}
function renderAudio(body) {
  body.innerHTML = `<div id="audioBox">${audioHTML()}</div>`;
  startCheck();
}
function refreshAudio() {
  const box = $('#audioBox');
  if (box) box.innerHTML = audioHTML();
}
main.addEventListener('change', async (e) => {
  if (!e.target.closest('#audioBox')) return;
  const id = e.target.id, value = e.target.value;
  if (e.target.name === 'recordMode') {
    state.settings = await call(api.settings.save({ recordMode: value }));
    check.lines.cand = [];
    check.passed.cand = false;
    if (value === 'online') await openCandidate();
    refreshAudio();
  }
  if (id === 'micSelect') { state.settings = await call(api.settings.save({ micId: value })); check.lines.mic = []; await openMic().catch((err) => { check.error = `打不开这个麦克风：${err.message}`; }); refreshAudio(); }
  if (id === 'outSelect') { state.settings = await call(api.settings.save({ outputId: value })); check.note.tone = ''; refreshAudio(); }
  if (id === 'candSelect') { state.settings = await call(api.settings.save({ candidateSource: value })); check.lines.cand = []; await openCandidate(); refreshAudio(); }
});
main.addEventListener('click', async (e) => {
  if (!e.target.closest('#audioBox')) return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'testMic') { check.testing.mic = !check.testing.mic; refreshAudio(); }
  if (b.id === 'testCand') { check.testing.cand = !check.testing.cand; refreshAudio(); }
  if (b.id === 'simCand') simulateCandidate();
  if (b.id === 'listenCand') { await openCandidate(); refreshAudio(); }
  if (b.id === 'playTone') playTone();
  if (b.id === 'toneYes') { check.toneAsk = false; check.toneHelp = false; check.note.tone = '✓ 播放设备正常'; refreshAudio(); }
  if (b.id === 'toneNo') { check.toneAsk = false; check.toneHelp = true; refreshAudio(); }
  if (b.id === 'recheck') { stopCheck(); startCheck(); }
});

// 3 面试中：上方是录音条；左边是面试题（当前题展开，下面是题目列表），右边是转写和现场笔记。
const SPEAKER_CLASS = { 面试官: 'me', 候选人: 'them' };
function currentQuestion(qs) {
  return qs.find((q) => q.id === state.current) || qs.find((q) => !q.asked) || qs[0];
}
// ---------- 面试中 AI 副驾 ----------
// 1. 从面试官的话里认出问到了哪道准备好的题：自动跳到这题、标为已问。
// 2. 候选人答完（5 秒没有新的话、回答够长）：自动看要点答到了哪些，给一句点评和追问建议。
const recNow = () => state.rec?.elapsed ?? state.interview.audioSeconds ?? 0;
function savePlan() { api.interviews.save({ id: state.id, plan: state.interview.plan }); }
// 这题的回答：从问到这题开始，到下一道题被问到为止，候选人说的话（分不清说话人时取全部）。
function answerFor(q) {
  if (q.askedAt == null) return '';
  const qs = allQuestions(state.interview.plan);
  const until = Math.min(...qs.map((x) => x.askedAt).filter((t) => t != null && t > q.askedAt), Infinity);
  return (state.interview.transcript || [])
    .filter((t) => t.text && !t.echo && t.start >= q.askedAt - 0.5 && t.start < until && t.speaker !== '面试官')
    .sort((a, b) => a.start - b.start).map((t) => t.text).join('');
}
async function runReview(q, { manual = false } = {}) {
  const answer = answerFor(q);
  if (answer.replace(/\s/g, '').length < (manual ? 10 : 50)) {
    if (manual) toast(q.askedAt == null ? '这题还没开始问（录音中切到这题或系统认出这题后才开始计）' : '候选人对这题说的话还太少', 'warn');
    return;
  }
  state.reviewing = q.id;
  refreshLiveQuestions();
  try {
    q.review = await call(api.live.review(state.id, q.id, answer), { quiet: !manual });
  } catch { /* 自动点评失败不打扰面试官 */ }
  state.reviewing = null;
  refreshLiveQuestions();
}
// 什么时候自动点评：候选人停了 5 秒；面试官又开口了（两路录音时，说明这段回答告一段落）；
// 或者回答又多了 200 字。点评过的题，回答多出 60 字以上才重新点评。
let reviewTimer = 0;
function maybeReview() {
  if (state.recState !== 'recording' || state.reviewing) return;
  const q = currentQuestion(allQuestions(state.interview.plan));
  const len = q ? answerFor(q).length : 0;
  if (q && len >= 50 && (!q.review || len - q.review.chars >= 60)) runReview(q);
}
function scheduleReview(seg) {
  clearTimeout(reviewTimer);
  const q = currentQuestion(allQuestions(state.interview.plan));
  if (q && seg?.speaker === '面试官') return maybeReview();
  if (q && answerFor(q).length - (q.review?.chars || 0) >= 200) return maybeReview();
  reviewTimer = setTimeout(maybeReview, 5000);
}
// 切换当前题：录音中第一次切到一道题时，记下从什么时候开始问；离开的那道题如果还没点评就点评一下。
function setCurrent(q, { at = null, auto = false } = {}) {
  const qs = allQuestions(state.interview.plan), prev = currentQuestion(qs);
  if (state.recState !== 'idle' && q.askedAt == null) q.askedAt = at ?? recNow();
  if (auto) q.asked = true;
  state.current = q.id;
  savePlan();
  if (prev && prev !== q && !prev.review && state.recState !== 'idle') runReview(prev);
  refreshLiveQuestions();
  if (auto) {
    const el = $('#liveQuestions .current');
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
}
function detectQuestion(seg) {
  if (state.recState !== 'recording' || !seg.text || seg.speaker === '候选人' || seg.echo?.includes(seg.index)) return;
  const qs = allQuestions(state.interview.plan);
  const hit = matchQuestion(seg.text, qs);
  if (!hit) return;
  if (hit.q === currentQuestion(qs) && hit.q.askedAt != null) return;
  setCurrent(hit.q, { at: seg.start, auto: true });
}
// AI 副驾：总评 + 合理性 / 可信度 / 级别匹配三行判断 + 下一步追问。
const JUDGE_CLASS = { 合理: 'good', 部分合理: 'mid', 不合理: 'weak', 可信: 'good', 存疑: 'mid', 不可信: 'weak', 符合: 'good', 高于: 'good', 低于: 'weak' };
function copilotHTML(q) {
  const r = q.review, busy = state.reviewing === q.id, lv = state.interview.level;
  const LEVEL = { 好: 'good', 一般: 'mid', 弱: 'weak' };
  const row = (label, value, note) => (value ? `<div class="cp-row"><span class="cp-label">${label}</span><i class="lvl ${JUDGE_CLASS[value] || 'mid'}">${esc(value)}</i><span class="cp-note">${esc(note || '')}</span></div>` : '');
  return `<div class="copilot">
    <div class="copilot-head"><b>${icon('sparkle')}AI 副驾</b><span class="muted">${busy ? '正在看候选人的回答…' : r ? `点评于 ${new Date(r.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}，回答继续变长会自动更新` : '候选人答完会自动点评，也可以随时点右边'}</span>
     <span class="right-side">${r ? `<i class="lvl ${LEVEL[r.level] || 'mid'}">${esc(r.level)}</i>` : ''}<button class="link" data-review="${q.id}" ${busy ? 'disabled' : ''}>${r ? '重新点评' : '看看答得怎样'}</button></span></div>
    ${r ? `<p class="copilot-comment">${esc(r.comment)}</p>
     ${r.sound || r.credible || r.fit ? `<div class="cp-rows">${row('合理性', r.sound, r.soundNote)}${row('可信度', r.credible, r.credibleNote)}${row(lv ? `对照${esc(lv)}` : '级别', r.fit ? `${r.fit}${lv || ''}` : '', r.fitNote)}</div>` : ''}
     ${r.follow.length ? `<div class="copilot-follow"><b>${r.next === '换题' ? '可以换题，或问' : '建议追问'}</b><div>${r.follow.map((f) => `<p>${esc(f)}</p>`).join('')}</div></div>` : ''}` : ''}
   </div>`;
}
// 实时评估：把已经点评过的题汇总成到目前为止的判断（不额外调用模型）。
function liveSummaryHTML(qs) {
  const rs = qs.filter((q) => q.review).map((q) => q.review), lv = state.interview.level;
  if (!rs.length) return '<div class="live-sum empty-sum">实时评估：候选人答完题后，这里汇总到目前为止的判断</div>';
  const count = (key, v) => rs.filter((r) => r[key] === v).length;
  const good = count('level', '好'), mid = count('level', '一般'), weak = count('level', '弱');
  const doubt = count('credible', '存疑') + count('credible', '不可信'), wrong = count('sound', '不合理');
  const fits = { 低于: count('fit', '低于'), 符合: count('fit', '符合'), 高于: count('fit', '高于') }, judged = fits.低于 + fits.符合 + fits.高于;
  const fitText = !judged ? '' : fits.低于 > judged / 2 ? `整体低于${lv || '目标级别'}` : fits.高于 > judged / 2 ? `可能高于${lv || '目标级别'}` : `基本符合${lv || '目标级别'}`;
  const pct = (n) => `${n / rs.length * 100}%`;
  // 门槛题：至少点评过一半（且不少于 2 道，门槛题不足 2 道时要全部点评）才给结论——大多弱或低于目标级别就提示可以提前结束。
  const gateQs = state.interview.plan.sections.filter((x) => x.source === 'gate').flatMap((x) => x.questions), gateRs = gateQs.filter((q) => q.review).map((q) => q.review);
  const gateBad = gateRs.filter((r) => r.level === '弱' || r.fit === '低于' || r.credible === '不可信').length;
  const gateLine = gateQs.length && gateRs.length * 2 >= gateQs.length && gateRs.length >= Math.min(2, gateQs.length)
    ? (gateBad * 2 > gateRs.length ? `<div class="ls-gate bad">门槛题 ${gateRs.length} 道里 ${gateBad} 道没达到，可以考虑提前结束</div>` : `<div class="ls-gate ok">门槛题基本过关，继续往下问</div>`) : '';
  return `<div class="live-sum">${gateLine}<div class="ls-head"><b>实时评估</b><span>已点评 ${rs.length} 题</span></div>
   <div class="ls-bar"><i class="good" style="width:${pct(good)}"></i><i class="mid" style="width:${pct(mid)}"></i><i class="weak" style="width:${pct(weak)}"></i></div>
   <div class="ls-line"><span>好 ${good} · 一般 ${mid} · 弱 ${weak}</span>${fitText ? `<b class="${fits.低于 > judged / 2 ? 'bad' : 'ok'}">${fitText}</b>` : ''}</div>
   ${doubt || wrong ? `<div class="ls-line warn">${doubt ? `存疑 ${doubt} 题` : ''}${doubt && wrong ? ' · ' : ''}${wrong ? `不合理 ${wrong} 题` : ''}，留意追问核实</div>` : ''}</div>`;
}
function currentHTML(qs) {
  if (!qs.length) return '<div class="empty"><h3>还没有面试题</h3><p>可以先去「3 面试题」生成，也可以直接录音。</p></div>';
  const cur = currentQuestion(qs);
  const hit = (n) => cur.marks?.[n] ?? cur.review?.covered[n];
  // 一张卡片从上到下：题目 → 回答要点 → 追问 → 判断信号 → AI 副驾 → 操作；每块同样的留白和字号。题号、分组、维度看左边的题目列表。
  return `<article class="current" data-q="${cur.id}">
    <header class="cur-head"><h3>${esc(cur.q)}</h3></header>
    <section class="cur-block"><div class="mini-label">回答要点<span>点一下标记答到了</span></div>
     <ul class="points ${cur.review ? 'reviewed' : ''}">${cur.points.map((p, n) => `<li class="${hit(n) ? 'hit' : cur.review || cur.marks?.[n] === false ? 'miss' : ''}" data-mark="${n}">${esc(p)}</li>`).join('')}</ul></section>
    ${cur.follow ? `<section class="cur-block"><div class="mini-label">追问</div><p class="follow-line">${esc(cur.follow)}</p></section>` : ''}
    ${cur.good || cur.bad ? `<section class="cur-block cur-signals">${cur.good ? `<p><b class="good">好的表现</b><span>${esc(cur.good)}</span></p>` : ''}${cur.bad ? `<p><b class="bad">需要警惕</b><span>${esc(cur.bad)}</span></p>` : ''}</section>` : ''}
    ${copilotHTML(cur)}
    <footer class="cur-foot"><div class="keys"><span><kbd>←</kbd><kbd>→</kbd>切换</span><span><kbd>空格</kbd>已问，下一题</span></div>
     <span class="row" style="margin-left:auto">${cur.asked ? `<button class="btn" data-ask="${cur.id}">取消已问</button>` : ''}<button class="btn primary" data-ask-next="${cur.id}">${cur.asked ? `下一道没问的 ${icon('chevR')}` : `${icon('check')}已问，下一题`}</button></span></footer>
   </article>`;
}
function qListHTML(qs) {
  if (!qs.length) return '<p class="muted small" style="padding:16px 18px">还没有面试题</p>';
  const cur = currentQuestion(qs), LV = { 好: 'good', 一般: 'mid', 弱: 'weak' };
  return state.interview.plan.sections.map((s) => `<h4>${s.source === 'gate' ? kindChip('gate') : ''}${esc(s.title)}</h4>${s.questions.map((q) => `<button class="q-row ${q === cur ? 'on' : ''} ${q.asked ? 'done' : ''}" data-pick="${q.id}"><em><i class="dot ${DIM_COLORS[q.dim] || ''}"></i>${q.asked ? '✓ 已问' : q === cur ? '当前' : esc(q.dim)}${q.review ? `<i class="lvl ${LV[q.review.level] || 'mid'}">${esc(q.review.level)}</i>` : ''}</em><span>${esc(q.q)}</span></button>`).join('')}`).join('');
}
function transcriptColHTML() {
  const i = state.interview, rec = state.recState;
  const tools = rec === 'idle' ? `${needsSpeakers(i) ? `<button class="link" id="splitSpeakers" ${state.busy.speakers ? 'disabled' : ''}>${state.busy.speakers ? progressText('speakers') : '区分面试官 / 候选人'}</button>` : ''}${i.audioParts ? '<button class="link" id="openAudio">打开录音</button><button class="link" id="retranscribe">重新转写</button>' : ''}<button class="link" id="importTranscript">导入</button><button class="link" id="editTranscript">编辑</button>${state.segErrors.size ? '<button class="link" id="retrySegments">重试失败的段</button>' : ''}`
    : '<span class="chip">● 边录边转</span>';
  return `<div class="col-head">实时转写<span class="tools">${tools}</span></div>
   <div class="transcript" id="transcript">${transcriptHTML()}</div>
   <div class="notes-box"><div class="mini-label">现场笔记</div><textarea id="notes" rows="5" placeholder="记下关键回答、印象、要追问的点…（评估时会一起参考）">${esc(i.notes)}</textarea></div>`;
}
function renderLive(body) {
  const i = state.interview, s = state.settings, rec = state.recState;
  const qs = allQuestions(i.plan), online = s.recordMode === 'online';
  const checked = i.audioCheck?.interviewer && (i.audioCheck?.candidate || !online);
  const modeText = state.rec ? (state.rec.twoTracks ? '线上：我的麦克风记为面试官，电脑声音记为候选人' : `只录麦克风${state.rec.systemAudioError ? `（${state.rec.systemAudioError}）` : ''}，结束后可区分说话人`) : '';
  document.body.classList.toggle('focus', rec !== 'idle');
  body.innerHTML = `<div class="rec-bar ${rec}">
    <div class="rec-time" id="recTime">${fmtTime(state.rec?.elapsed ?? i.audioSeconds ?? 0)}</div>
    ${rec === 'idle' ? '' : '<div class="level"><i id="level"></i></div>'}
    ${rec === 'idle' ? `<div class="modes" role="radiogroup" aria-label="面试方式">
      <label><input type="radio" name="recordMode" value="offline" ${online ? '' : 'checked'}> 面对面</label>
      <label><input type="radio" name="recordMode" value="online" id="systemAudio" ${online ? 'checked' : ''}> 线上（戴耳机）</label></div>`
    : `<p class="hint" id="recHint"><b>${esc(i.name || '候选人')}</b> · ${rec === 'paused' ? '已暂停' : '录音中'} · ${esc(modeText)}</p>`}
    <div class="rec-buttons">
     ${rec === 'idle' && !i.evaluation && !checked ? `<button class="chip warn-chip" data-tab-go="audio">${icon('alert')}音频还没调试</button>` : ''}
     ${rec === 'idle' && i.evaluation ? `<button class="btn primary big" id="restartInterview">${icon('refresh')}重新开始</button>` : ''}
     ${rec === 'idle' && !i.evaluation && (i.audioParts || (i.transcript || []).length) ? '<button class="btn big" id="restartInterview">重新开始</button>' : ''}
     ${rec === 'idle' && !i.evaluation ? `<button class="btn rec big" id="recStart">● ${i.audioParts ? '继续面试' : '开始面试'}</button>` : ''}
     ${rec === 'recording' ? '<button class="btn big" id="recPause">暂停</button>' : ''}
     ${rec === 'paused' ? '<button class="btn big" id="recResume">继续</button>' : ''}
     ${rec !== 'idle' ? '<button class="btn dark big" id="recStop">结束面试</button>' : ''}
    </div>
   </div>
   <div class="board">
    <section class="col col-list"><div class="col-head">面试题<span class="chip" id="askedCount">已问 ${qs.filter((q) => q.asked).length} / ${qs.length}</span></div><div id="liveSum">${liveSummaryHTML(qs)}</div><div class="q-list" id="qList">${qListHTML(qs)}</div></section>
    <section class="col col-main" id="liveQuestions">${currentHTML(qs)}</section>
    <section class="col col-side" id="transcriptCol">${transcriptColHTML()}</section>
   </div>`;
  $('#notes').addEventListener('input', (e) => { i.notes = e.target.value; saveField({ notes: i.notes }); });
  body.querySelectorAll('[name=recordMode]').forEach((r) => r.addEventListener('change', async () => {
    state.settings = await call(api.settings.save({ recordMode: r.value }));
    renderLive(body);
  }));
  $('#recStart')?.addEventListener('click', startRecording);
  $('#restartInterview')?.addEventListener('click', async () => {
    try {
      if (!await ask({ title: '重新开始这场面试？', body: '录音、转写、现场笔记和评估报告都会清空，无法恢复。简历和面试题会保留。', ok: '清空并重新开始', danger: true })) return;
      await flushSave();
      const fresh = await call(api.interviews.restart(state.id));
      if (!fresh) return;
      state.interview = fresh;
      state.segErrors.clear();
      state.current = null;
      toast('已清空，可以重新开始面试');
      renderLive(body);
      refreshSteps();
    } catch (err) { ignoreHandled(err); }
  });
  $('#recPause')?.addEventListener('click', () => { state.rec.pause(); state.recState = 'paused'; renderLive(body); });
  $('#recResume')?.addEventListener('click', () => { state.rec.resume(); state.recState = 'recording'; renderLive(body); });
  $('#recStop')?.addEventListener('click', stopRecording);
  $('#splitSpeakers')?.addEventListener('click', splitSpeakers);
  $('#openAudio')?.addEventListener('click', () => call(api.audio.open(state.id)).catch(ignoreHandled));
  $('#retranscribe')?.addEventListener('click', retranscribe);
  $('#importTranscript')?.addEventListener('click', importTranscript);
  $('#editTranscript')?.addEventListener('click', editTranscript);
  $('#retrySegments')?.addEventListener('click', retrySegments);
  const t = $('#transcript');
  t.scrollTop = t.scrollHeight;
  $('#qList .q-row.on')?.scrollIntoView({ block: 'nearest' });
}
function refreshLiveQuestions() {
  const box = $('#liveQuestions');
  if (!box) return;
  const qs = allQuestions(state.interview.plan);
  box.innerHTML = currentHTML(qs);
  $('#qList').innerHTML = qListHTML(qs);
  $('#askedCount').textContent = `已问 ${qs.filter((q) => q.asked).length} / ${qs.length}`;
  $('#liveSum').innerHTML = liveSummaryHTML(qs);
  $('#qList .q-row.on')?.scrollIntoView({ block: 'nearest' });
}
// 只有一路麦克风或导入的文字时，转写里没有说话人，需要模型区分。
const needsSpeakers = (i) => !i.dialogue?.length && (i.transcript || []).some((t) => t.text && !t.speaker);
function transcriptHTML() {
  const i = state.interview, echoes = (i.transcript || []).filter((t) => t.echo).length;
  const echoNote = echoes ? `<p class="echo-note">已去掉 ${echoes} 段重复：你的麦克风录到了候选人的声音（多半是没戴耳机、声音从扬声器出来了）。戴上耳机就不会再出现。</p>` : '';
  return echoNote + transcriptBody(i);
}
function transcriptBody(i) {
  const turn = (cls, who, time, text) => `<div class="turn ${cls}"><div class="who"><span>${who}</span>${time}</div><p>${text}</p></div>`;
  if (i.dialogue?.length) return i.dialogue.map((t) => turn(SPEAKER_CLASS[t.speaker] || '', esc(t.speaker), '', esc(t.text))).join('');
  const segs = [...(i.transcript || [])].filter((s) => (s.text || s.source !== 'asr') && !s.echo);
  for (const [index, e] of state.segErrors) if (!segs.some((s) => s.index === index)) segs.push({ index, start: e.start, speaker: e.speaker, error: e.error });
  segs.sort((a, b) => a.start - b.start || a.index - b.index);
  if (!segs.length) return '<p class="empty-hint">录音开始后，转写会一段段出现在这里。<br>也可以面试结束后导入飞书妙记、腾讯会议等导出的文字。</p>';
  return segs.map((s) => {
    const time = `<time>${s.source === 'asr' || s.error ? fmtTime(s.start) : '文本'}</time>`;
    if (s.error) return turn('err', esc(s.speaker || '转写失败'), time, `这一段转写失败：${esc(s.error)}`);
    const play = s.source === 'asr' && state.recState === 'idle';
    return `<div class="turn ${SPEAKER_CLASS[s.speaker] || 'plain'}${play ? ' playable' : ''}"${play ? ` data-play="${s.index}" title="点击回放这一段"` : ''}><div class="who"><span>${esc(s.speaker || '')}</span>${time}</div><p>${esc(s.text)}</p></div>`;
  }).join('');
}
function refreshTranscript() {
  const t = $('#transcript');
  if (!t) return;
  const atBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
  t.innerHTML = transcriptHTML();
  if (atBottom) t.scrollTop = t.scrollHeight;
}
api.onSegment((seg) => {
  if (seg.id !== state.id || !state.interview) return;
  if (seg.error) state.segErrors.set(seg.index, { start: seg.start, speaker: seg.speaker, error: seg.error });
  else {
    state.segErrors.delete(seg.index);
    const tr = (state.interview.transcript || []).filter((t) => t.index !== seg.index);
    tr.push({ index: seg.index, start: seg.start, end: seg.end, speaker: seg.speaker, text: seg.text, source: 'asr' });
    for (const t of tr) if (seg.echo?.includes(t.index)) t.echo = true;
    state.interview.transcript = tr;
    state.interview.dialogue = null;
    detectQuestion(seg);
    scheduleReview(seg);
  }
  refreshTranscript();
});
// 面试中途插拔耳机会切换音频设备，录音可能中断或录错设备，马上提醒。
navigator.mediaDevices?.addEventListener('devicechange', () => {
  if (state.recState === 'recording') toast('音频设备变了（是不是插拔了耳机？）。请确认录音和转写还在正常进行。', 'warn');
});
// 复盘：点转写里的某一句，回放这一段录音。
let playing = null;
async function playPart(index) {
  try {
    playing?.pause();
    const bytes = await call(api.audio.part(state.id, index));
    playing = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
    if (state.settings.outputId && playing.setSinkId) await playing.setSinkId(state.settings.outputId).catch(() => {});
    await playing.play();
  } catch (err) { ignoreHandled(err); }
}
const pendingChunks = new Set();
async function startRecording() {
  const i = state.interview, s = state.settings;
  if ((i.transcript || []).some((t) => t.source !== 'asr')) {
    if (!await ask({ title: '接着录音？', body: '当前转写是导入或手动编辑的文本，开始录音后新的转写会接在后面。', ok: '开始录音' })) return;
  }
  stopCheck(); // 释放检查用的麦克风，交给正式录音
  try {
    await call(api.audio.askMic());
    state.interview = await call(api.interviews.get(state.id));
    const fresh = state.interview;
    const rec = new Recorder({
      chunkSeconds: s.chunkSeconds,
      onChunk: ({ index, start, wav, speaker, silent }) => {
        const p = api.audio.chunk(state.id, index, start, wav, { speaker, silent }).finally(() => pendingChunks.delete(p));
        pendingChunks.add(p);
      },
      onLevel: (v) => { const el = $('#level'); if (el) el.style.width = `${Math.min(100, v * 160)}%`; const t = $('#recTime'); if (t) t.textContent = fmtTime(rec.elapsed); },
    });
    await rec.start({ micId: s.micId, candidate: s.recordMode === 'online' ? s.candidateSource : '', startIndex: fresh.audioParts || 0, startOffset: fresh.audioSeconds || 0 });
    state.rec = rec;
    state.recState = 'recording';
    // 开始录音时屏幕上的那道题，就从现在开始算它的回答。
    const first = state.interview.plan && currentQuestion(allQuestions(state.interview.plan));
    if (first && first.askedAt == null) { first.askedAt = fresh.audioSeconds || 0; savePlan(); }
    renderLive($('#tabBody'));
  } catch (err) {
    if (err.handled) return;
    toast(/Permission|NotAllowed/i.test(err.name + err.message) ? '没有麦克风权限，请在系统设置里允许「面试助手」使用麦克风。' : `无法开始录音：${err.message}`, 'error');
  }
}
async function stopRecording() {
  const btn = $('#recStop');
  if (btn) { btn.disabled = true; btn.textContent = '正在收尾…'; }
  await state.rec.stop();
  await Promise.all([...pendingChunks]);
  await flushSave();
  state.recState = 'idle';
  try {
    const res = await call(api.audio.finish(state.id));
    state.interview = res.interview;
    state.rec = null;
    // 结束面试后直接进入「评估报告」并自动生成。
    state.tab = 'eval';
    renderInterview();
    if (transcriptText(state.interview).replace(/\s/g, '').length >= 50) generateEval({ auto: true });
    else toast('录音已保存。转写内容太少，没法生成报告，可以在「4 面试中」导入转写后再评估。', 'warn');
  } catch (err) { ignoreHandled(err); }
}
async function importTranscript() {
  try {
    await flushSave();
    const text = await call(api.transcript.pick());
    if (!text) return;
    if ((state.interview.transcript || []).length && !await ask({ title: '替换当前转写？', body: '导入的文字会替换现在的转写内容。', ok: '导入并替换', danger: true })) return;
    state.interview = await call(api.interviews.save({ id: state.id, transcript: [{ index: 0, start: 0, text: text.trim(), source: 'import' }], dialogue: null, status: state.interview.status === 'evaluated' ? 'evaluated' : 'done' }));
    state.segErrors.clear();
    toast('转写已导入');
    renderLive($('#tabBody'));
  } catch (err) { ignoreHandled(err); }
}
function editTranscript() {
  const col = $('#transcriptCol');
  col.innerHTML = `<div class="col-head">编辑转写<span class="tools"><button class="link" id="cancelEdit">取消</button><button class="link" id="saveEdit"><b>保存</b></button></span></div>
   <textarea id="transcriptEditor">${esc(transcriptText(state.interview))}</textarea><p class="hint" style="margin:0 16px 14px">可以直接粘贴会议软件导出的文字。保存后按整段文本处理。</p>`;
  $('#cancelEdit').addEventListener('click', () => renderLive($('#tabBody')));
  $('#saveEdit').addEventListener('click', async () => {
    const text = $('#transcriptEditor').value.trim();
    state.interview = await call(api.interviews.save({ id: state.id, transcript: text ? [{ index: 0, start: 0, text, source: 'edited' }] : [], dialogue: null }));
    state.segErrors.clear();
    renderLive($('#tabBody'));
  });
}
async function splitSpeakers() {
  state.busy.speakers = true;
  renderLive($('#tabBody'));
  try {
    await flushSave();
    state.interview = await call(api.transcript.speakers(state.id));
    toast('已区分面试官和候选人');
  } catch (err) { ignoreHandled(err); }
  state.busy.speakers = false;
  if (state.tab === 'live') renderLive($('#tabBody'));
}
async function retranscribe() {
  if ((state.interview.transcript || []).some((t) => t.text) && !await ask({ title: '重新转写整场面试？', body: '会用保存的录音重新转写，替换现在的转写内容（包括手动编辑过的）。', ok: '重新转写', danger: true })) return;
  const btn = $('#retranscribe');
  btn.disabled = true;
  btn.textContent = '重新转写中…';
  try {
    await flushSave();
    const res = await call(api.audio.retranscribe(state.id));
    state.interview = res.interview;
    toast(res.failed ? `转写完成，${res.failed} 段失败，可以稍后点「重试失败的段」` : `已重新转写 ${res.done} 段`, res.failed ? 'warn' : 'ok');
    if (!res.failed) state.segErrors.clear();
  } catch (err) { ignoreHandled(err); }
  if (state.tab === 'live') renderLive($('#tabBody'));
}
async function retrySegments() {
  const btn = $('#retrySegments');
  btn.disabled = true;
  btn.textContent = '重试中…';
  try {
    const res = await call(api.audio.retry(state.id));
    state.interview = res.interview;
    state.segErrors.clear();
    toast(`已重新转写 ${res.fixed} 段`);
  } catch (err) { ignoreHandled(err); }
  renderLive($('#tabBody'));
}

// 4 评估
// 达标判定横幅：按这场面试关联岗位的达标线（平均分 + 每个维度最低分）判断。
function passBannerHTML(i, j) {
  if (!j) return i.evaluation && !i.pass ? '<p class="pass-banner none">这场面试没有关联岗位，不判断是否达标。在「1 候选人」里选择岗位后即可按该岗位的达标线判断。</p>' : '';
  const why = [...(j.averageOk ? [] : [`平均 ${j.average}（要求 ${i.pass.average}）`]), ...j.fails.map((f) => `${f.name} ${f.score}（要求 ${f.need}）`)];
  return `<div class="pass-banner ${j.passed ? 'ok' : 'bad'}"><i class="pb-ico">${icon(j.passed ? 'check' : 'alert')}</i>
   <div><b>${j.passed ? `达到「${esc(i.position)} · ${esc(i.level)}」的要求` : `未达到「${esc(i.position)} · ${esc(i.level)}」的要求`}</b>
   <span>${j.passed ? `平均 ${j.average}（要求 ${i.pass.average}），五个维度都不低于达标线` : `差距：${esc(why.join('、'))}`}</span></div></div>`;
}
function renderEval(body) {
  const i = state.interview, e = i.evaluation;
  const textLen = transcriptText(i).replace(/\s/g, '').length;
  const actions = $('#ivActions');
  if (actions) {
    actions.innerHTML = `${state.busy.eval ? progressText('eval') : ''}${e ? `<button class="btn" id="exportMd">${icon('download')}导出 Markdown</button><button class="btn" id="exportPdf">${icon('download')}导出 PDF</button>` : ''}
     <button class="btn ${e ? 'primary' : 'primary'}" id="genEval" ${state.busy.eval || textLen < 50 ? 'disabled' : ''}>${icon(e ? 'refresh' : 'sparkle')}${e ? '重新评估' : '生成评估'}</button>`;
  }
  const intro = `<p class="muted small">根据转写${i.notes ? '和现场笔记' : ''}评估专业度、自驱力、性格特质、逻辑思维、适应力，每项 0~5 分 · 转写约 ${textLen} 字</p>`;
  if (state.busy.eval) {
    const data = parsePartialJSON(state.stream.eval);
    const wait = state.evalStage === 'speakers' ? '正在区分面试官和候选人的话…' : '正在阅读转写，马上开始给分…';
    body.innerHTML = `<div class="tab-inner"><div class="eval">${intro}<div class="eval" id="stream-eval">${data ? evalStreamHTML(data) : `<p class="muted stream-wait">${wait}</p>`}</div></div></div>`;
  } else if (!e) {
    body.innerHTML = `<div class="tab-inner"><div class="eval">${textLen < 50 ? `<div class="empty"><h3>还没有足够的转写内容</h3><p>在「4 面试中」录音，或导入会议转写文本后再来评估。</p><button class="btn" data-tab-go="live">去录音 / 导入转写</button></div>`
      : `<div class="empty"><h3>还没有评估报告</h3><p>转写约 ${textLen} 字。点右上角「生成评估」，会按五个维度打分并给出结论。</p></div>`}</div></div>`;
  } else {
    const avg = average(e), j = Levels.judge(e, i.pass), need = (d) => i.pass?.dims?.[d.name];
    body.innerHTML = `<div class="tab-inner"><div class="eval">${intro}${passBannerHTML(i, j)}
     <div class="panel verdict-panel"><div><div class="verdict-line"><i class="verdict-big ${VERDICT_CLASS[e.overall.verdict] || ''}">${esc(e.overall.verdict)}</i><span class="avg">${avg}<span>/ 5</span></span>${e.overall.level ? `<span class="level-chip" title="模型根据面试表现判断的实际水平">实际水平 · ${esc(e.overall.level)}</span>` : ''}</div>
      ${summaryList(e.overall.summary)}</div>${radarSVG(e)}</div>
     <div class="dims">${e.dimensions.map((d, k) => `<div class="panel dim-card">
      <div class="dim-top"><span class="dim-name"><i class="dim ${DIM_COLORS[d.name] || ''}">${esc(d.name)}</i>${need(d) != null ? `<small class="need ${d.score < need(d) ? 'bad' : ''}">达标线 ${need(d)}</small>` : ''}</span>
       <span class="score-pick"><button class="score-btn" data-score="${k}" aria-haspopup="listbox" title="点击调整分数">${d.score}${icon('chevD')}</button></span></div>
      <div class="score-bar ${DIM_COLORS[d.name] || ''}"><i style="width:${d.score / 5 * 100}%"></i>${need(d) != null ? `<b class="need-mark" style="left:${need(d) / 5 * 100}%" title="达标线 ${need(d)}"></b>` : ''}</div>
      <p>${esc(d.reason)}</p>${d.evidence.length ? `<ul class="evidence">${d.evidence.map((x) => `<li>${esc(unquote(x))}</li>`).join('')}</ul>` : ''}
      ${!d.enough || d.manual ? `<div class="proof-row">${d.enough ? '' : '<span class="proof weak">证据不足</span>'}${d.manual ? '<span class="manual">已手动调整</span>' : ''}</div>` : ''}</div>`).join('')}${rhythmHTML(i)}</div>
     <div class="grid-3 three">
      <div class="panel p-good"><h3>${icon('check')}优点</h3><ul>${e.strengths.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
      <div class="panel p-bad"><h3>${icon('alert')}风险</h3><ul>${e.risks.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
      <div class="panel p-next"><h3>${icon('target')}下一轮建议追问</h3><ul>${e.nextRound.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
     </div>
     <div class="panel gaps"><h3 class="mini-label">没覆盖到 / 证据不足</h3><p>${esc(e.gaps || '无')}</p></div></div></div>`;
  }
  $('#genEval')?.addEventListener('click', () => generateEval());
  $('#exportPdf')?.addEventListener('click', () => exportReport('pdf'));
  $('#exportMd')?.addEventListener('click', () => exportReport('md'));
  body.querySelectorAll('[data-score]').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openScorePop(btn, e.dimensions[Number(btn.dataset.score)], async (score) => {
      const d = e.dimensions[Number(btn.dataset.score)];
      d.aiScore ??= d.score; // 记下 AI 原始给分，方便恢复
      d.score = score;
      d.manual = score !== d.aiScore;
      state.interview = await call(api.interviews.save({ id: state.id, evaluation: e }));
      renderEval(body);
    });
  }));
}
// 改分：点分数弹出紧凑的下拉菜单，0~5 每 0.5 一档，右侧是对应的打分标准；AI 原始给分带「AI」标记，选它就是恢复。
const SCORE_SHORT = ['没有体现', '明显不足', '偏弱', '合格', '良好', '优秀'];
function openScorePop(anchor, d, onPick) {
  const ai = d.aiScore ?? d.score;
  const scores = Array.from({ length: 11 }, (_, n) => (10 - n) / 2);
  dropdown(anchor, [
    { items: scores.map((v) => ({ value: v, label: String(v), selected: v === d.score, extra: v === ai ? 'AI' : Number.isInteger(v) ? SCORE_SHORT[v] : '', tag: v === ai })) },
  ], { align: 'right', minWidth: 132, compact: true, onPick: (v) => { if (v !== d.score) onPick(v); } });
}
// 回答节奏（线上两路录音才有准确时间）：说话占比、候选人开口前停多久。只做参考，不进打分。
function rhythmHTML(i) {
  const r = rhythm(i.transcript);
  if (r.share == null) return '';
  const min = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒` : `${Math.round(sec)} 秒`);
  return `<div class="panel rhythm"><h3>${icon('info')} 回答节奏 · 仅供参考，不计入打分</h3>
   <div class="kv"><span>候选人说话占比</span><b>${Math.round(r.share * 100)}%</b></div>
   <div class="rhythm-bar"><i style="width:${Math.round(r.share * 100)}%"></i></div>
   <div class="kv"><span>候选人 / 面试官</span><b class="acc">${min(r.talk.候选人)} / ${min(r.talk.面试官)}</b></div>
   ${r.avg != null ? `<div class="kv" style="margin-top:10px"><span>开口前平均停顿（${r.waits.length} 次）</span><b>${r.avg.toFixed(1)} 秒</b></div>` : ''}
   ${r.share < 0.5 ? '<p class="hint">面试官说得比候选人还多，可以多给对方展开的机会。</p>' : ''}
   ${r.steady ? `<p class="note warn-note">每次开口前都停了 ${r.avg.toFixed(1)} 秒左右，而且很一致。可能是在组织语言，也可能是在看提示工具，建议下一轮多追问具体细节、打断后换个条件再问。</p>` : ''}</div>`;
}
async function generateEval({ auto = false } = {}) {
  const i = state.interview;
  if (!auto && i.evaluation && !await ask({ title: '重新评估？', body: '当前的评估报告会被覆盖，包括你手动调整过的分数。', ok: '重新评估', danger: true })) return;
  await flushSave();
  state.busy.eval = true;
  state.stream.eval = '';
  // 面对面录的转写还没分说话人时，先区分面试官和候选人，评估只看候选人说的话。
  if (needsSpeakers(i)) {
    state.evalStage = 'speakers';
    renderTab();
    try { state.interview = await call(api.transcript.speakers(i.id), { quiet: true }); } catch { /* 区分失败也照常评估 */ }
  }
  state.evalStage = 'eval';
  renderTab();
  try {
    state.interview = await call(api.evaluate(i.id));
    toast('评估报告已生成');
  } catch (err) { ignoreHandled(err); }
  state.busy.eval = false;
  if (state.view === 'interview' && state.tab === 'eval') renderTab();
}
async function exportReport(format) {
  try {
    const file = await call(api.exportReport(state.id, format));
    if (file) toast(`已导出：${file}`);
  } catch (err) { ignoreHandled(err); }
}

// 面试中快捷键：← → 切换题目，空格 = 已问、下一题（在输入框里打字时不生效）
document.addEventListener('keydown', (e) => {
  if (state.view !== 'interview' || state.tab !== 'live' || e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const qs = allQuestions(state.interview.plan), next = qs[qs.indexOf(currentQuestion(qs)) + (e.key === 'ArrowRight' ? 1 : -1)];
    e.preventDefault();
    if (next) setCurrent(next);
    return;
  }
  const btn = e.key === ' ' && $('#liveQuestions [data-ask-next]');
  if (!btn) return;
  e.preventDefault();
  btn.click();
});

// ---------- 启动 ----------
window.addEventListener('beforeunload', (e) => { flushSave(); if (state.recState !== 'idle') { e.preventDefault(); e.returnValue = ''; } });
(async () => {
  try {
    state.info = await call(api.info());
    state.settings = await call(api.settings.get());
    renderSideFoot();
    runHealth();
    await go(state.settings.apiKeyHint ? 'overview' : 'settings');
    if (!state.settings.apiKeyHint) toast('先配置模型和 API Key，就可以开始使用了。', 'info');
  } catch (err) { ignoreHandled(err); }
})();
})();
