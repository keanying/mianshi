'use strict';
(() => {
const api = window.api;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const state = { view: 'home', tab: 'resume', id: null, interview: null, info: null, settings: null, busy: {}, stream: {}, rec: null, recState: 'idle', segErrors: new Map() };
const STATUS = { draft: '待出题', ready: '已出题', done: '已面试', evaluated: '已评估' };
const DIM_COLORS = { 专业度: 'd1', 自驱力: 'd2', 性格特质: 'd3', 逻辑思维: 'd4', 适应力: 'd5' };
const VERDICT_CLASS = { 强烈推荐: 'v1', 推荐: 'v2', 待定: 'v3', 不推荐: 'v4' };

// ---------- 工具 ----------
let toastTimer;
function toast(message, type = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, type === 'error' ? 6000 : 3000);
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
const average = (e) => Math.round(e.dimensions.reduce((a, d) => a + d.score, 0) / e.dimensions.length * 10) / 10;

// ---------- 导航 ----------
function setNav() {
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.go === state.view || (state.view === 'interview' && b.dataset.go === 'home')));
}
async function go(view) {
  if (state.recState !== 'idle' && view !== 'interview') { toast('正在录音，请先结束录音。', 'error'); return; }
  await flushSave();
  stopCheck();
  state.view = view;
  setNav();
  if (view === 'home') await renderHome();
  if (view === 'settings') await renderSettings();
}
document.querySelector('.nav').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
$('#newInterview').addEventListener('click', async () => {
  if (state.recState !== 'idle') { toast('正在录音，请先结束录音。', 'error'); return; }
  try {
    const i = await call(api.interviews.create({}));
    await openInterview(i.id, 'resume');
  } catch (err) { ignoreHandled(err); }
});

// ---------- 面试记录 ----------
async function renderHome() {
  const list = await call(api.interviews.list()).catch(() => []);
  const s = state.settings;
  const setupHint = !s?.apiKeyHint ? `<div class="notice">还没有配置模型。先到 <button class="link" data-go-settings>设置</button> 里选择 GLM 或 DeepSeek 并填写 API Key。</div>` : '';
  main.innerHTML = `<header class="page-head"><div><h1>面试记录</h1><p>${list.length} 场面试 · 流程：添加候选人 → 调试音频 → 生成面试题 → 开始面试 → 评估报告</p></div></header>${setupHint}
  ${list.length ? `<div class="table"><div class="tr th"><span>候选人</span><span>岗位</span><span>时间</span><span>状态</span><span>结论</span><span></span></div>
   ${list.map((i) => `<div class="tr" data-open="${i.id}"><span class="strong">${esc(i.name || '未命名候选人')}</span><span>${esc(i.position || '—')}</span><span class="muted">${fmtDate(i.createdAt)}</span><span><i class="badge s-${i.status}">${STATUS[i.status] || i.status}</i></span><span>${i.verdict ? `<i class="verdict ${VERDICT_CLASS[i.verdict] || ''}">${esc(i.verdict)}</i> <span class="muted">${i.average ?? ''}</span>` : '<span class="muted">—</span>'}</span><span class="right"><button class="link danger" data-remove="${i.id}">删除</button></span></div>`).join('')}</div>`
   : `<div class="empty"><h3>还没有面试记录</h3><p>点击左上角「添加候选人」，填写简历和岗位开始。</p></div>`}`;
}
main.addEventListener('click', async (e) => {
  if (e.target.closest('[data-go-settings]')) { go('settings'); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) { e.stopPropagation(); if (await call(api.interviews.remove(rm.dataset.remove)).catch(() => false)) renderHome(); return; }
  const open = e.target.closest('[data-open]');
  if (open && state.view === 'home') openInterview(open.dataset.open);
});

// ---------- 设置 ----------
async function renderSettings() {
  const s = state.settings = await call(api.settings.get());
  const P = state.info.providers;
  main.innerHTML = `<header class="page-head"><div><h1>设置</h1><p>配置大模型和语音转文字。简历、转写内容会发送给你选择的模型服务商。</p></div></header>
  <form class="panel form" id="settingsForm" autocomplete="off">
   <h2>大模型</h2>
   <label>服务商<select name="provider">${Object.entries(P).map(([k, p]) => `<option value="${k}" ${s.provider === k ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
   <label>接口地址<input name="baseURL" value="${esc(s.baseURL)}" placeholder="https://…"></label>
   <label>模型<input name="model" list="modelList" value="${esc(s.model)}"><datalist id="modelList">${(P[s.provider]?.models || []).map((m) => `<option value="${m}">`).join('')}</datalist></label>
   <label>API Key<input name="apiKey" type="password" placeholder="${esc(s.apiKeyHint || '粘贴 API Key')}"></label>
   <label class="check"><input type="checkbox" name="noThinking" ${s.thinking ? '' : 'checked'}> 关闭深度思考（出题、评估更快更省；个别不支持关闭的模型会自动照常调用）</label>
   <div class="row"><button class="btn" type="button" id="testLLM">测试连接</button><span class="muted" id="testLLMResult"></span></div>
   <h2>语音转文字（智谱 GLM-ASR）</h2>
   <label class="check"><input type="checkbox" name="asrEnabled" ${s.asrEnabled ? 'checked' : ''}> 录音时自动转写（按说话停顿切段，每段最长 ${s.chunkSeconds} 秒，边录边转）</label>
   <label class="check"><input type="checkbox" name="asrUseChatKey" ${s.asrUseChatKey ? 'checked' : ''}> 与上面的大模型共用 API Key（大模型选的是智谱时勾选）</label>
   <label class="asr-key" ${s.asrUseChatKey ? 'hidden' : ''}>智谱 API Key<input name="asrKey" type="password" placeholder="${esc(s.asrKeyHint || '粘贴智谱 API Key')}"></label>
   <label>接口地址<input name="asrBaseURL" value="${esc(s.asrBaseURL)}"></label>
   <label>模型<input name="asrModel" list="asrModels" value="${esc(s.asrModel)}"><datalist id="asrModels"><option value="glm-asr-2512"><option value="glm-asr"></datalist></label>
   <label>每段最长（秒）<input name="chunkSeconds" type="number" min="10" max="28" value="${s.chunkSeconds}"></label>
   <div class="row"><button class="btn" type="button" id="testASR">测试转写</button><span class="muted" id="testASRResult"></span></div>
   <p class="hint">用 DeepSeek 出题和评估时，转写仍需要一个智谱的 Key（DeepSeek 没有语音转文字）。不想录音的话，也可以面试后导入飞书妙记、腾讯会议等导出的转写文本。</p>
   <h2>出题默认值</h2>
   <label>默认岗位<input name="position" value="${esc(s.position)}" placeholder="例如：AI 智能体开发工程师"></label>
   <label>岗位要求<textarea name="jd" rows="4" placeholder="可选。写上岗位职责和要求，出的基础题会更贴合">${esc(s.jd)}</textarea></label>
   <label>每场题目数量<input name="questionCount" type="number" min="8" max="40" value="${s.questionCount}"></label>
   <div class="row end"><button class="btn primary" type="submit">保存设置</button></div>
   <p class="hint">数据保存在本机：<button class="link" type="button" id="openData">${esc(state.info.dataDir)}</button>${s.encrypted ? ' · API Key 已用系统钥匙串加密保存' : ''}</p>
  </form>`;
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
    position: form.position.value.trim(), jd: form.jd.value.trim(), questionCount: Number(form.questionCount.value),
  });
  const saveAll = async () => { state.settings = await call(api.settings.save(collect())); renderSideFoot(); };
  form.addEventListener('submit', async (e) => { e.preventDefault(); try { await saveAll(); toast('设置已保存'); renderSettings(); } catch (err) { ignoreHandled(err); } });
  const test = (btn, out, fn) => $(btn).addEventListener('click', async () => {
    $(out).textContent = '测试中…';
    try { await saveAll(); $(out).textContent = `✓ ${await call(fn(), { quiet: true })}`; $(out).className = 'ok'; } catch (err) { $(out).textContent = `✗ ${err.message}`; $(out).className = 'bad'; }
  });
  test('#testLLM', '#testLLMResult', api.settings.testLLM);
  test('#testASR', '#testASRResult', api.settings.testASR);
  $('#openData').addEventListener('click', () => api.openDataDir());
}
function renderSideFoot() {
  const s = state.settings, p = state.info?.providers?.[s?.provider];
  $('#sideFoot').innerHTML = s ? `<span>模型：${esc(p?.label || '')} · ${esc(s.model)}</span><span>${s.apiKeyHint ? 'API Key 已配置' : '<b>未配置 API Key</b>'}</span>` : '';
}

// ---------- 单场面试 ----------
async function openInterview(id, tab) {
  await flushSave();
  state.view = 'interview';
  state.id = id;
  state.current = null;
  state.interview = await call(api.interviews.get(id));
  const i = state.interview;
  state.tab = tab || (i.evaluation ? 'eval' : i.status === 'done' ? 'eval' : i.plan ? 'plan' : 'resume');
  setNav();
  renderInterview();
}
function renderInterview() {
  const i = state.interview;
  const tabs = [['resume', '1 候选人'], ['audio', '2 音频调试'], ['plan', '3 面试题'], ['live', '4 面试中'], ['eval', '5 评估报告']];
  main.innerHTML = `<header class="page-head interview-head">
   <div class="who"><button class="link back" data-back>← 面试记录</button>
    <input class="name-input" id="nameInput" value="${esc(i.name)}" placeholder="候选人姓名">
    <input class="pos-input" id="posInput" value="${esc(i.position)}" placeholder="应聘岗位"></div>
   <nav class="steps">${tabs.map(([k, label]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${label}</button>`).join('')}</nav>
  </header><section class="tab-body" id="tabBody"></section>`;
  $('#nameInput').addEventListener('input', (e) => { i.name = e.target.value; saveField({ name: i.name }); });
  $('#posInput').addEventListener('input', (e) => { i.position = e.target.value; saveField({ position: i.position }); });
  renderTab();
}
main.addEventListener('click', (e) => {
  if (state.view !== 'interview') return;
  if (e.target.closest('[data-back]')) { go('home'); return; }
  const t = e.target.closest('.steps [data-tab]');
  if (t) {
    if (state.recState !== 'idle' && t.dataset.tab !== 'live') { toast('正在录音，录音结束后再切换。', 'error'); return; }
    flushSave();
    state.tab = t.dataset.tab;
    document.querySelectorAll('.steps button').forEach((b) => b.classList.toggle('active', b === t));
    renderTab();
  }
});
function renderTab() {
  const body = $('#tabBody');
  if (state.tab !== 'audio') stopCheck();
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
    const scroller = document.querySelector('.main'), follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    box.innerHTML = (p.task === 'plan' ? planStreamHTML : evalStreamHTML)(data);
    if (follow) scroller.scrollTop = scroller.scrollHeight;
  });
});
const list = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x) : []);
function planStreamHTML(p) {
  const c = p.candidate || {}, sections = Array.isArray(p.sections) ? p.sections : [];
  const all = sections.flatMap((s) => (Array.isArray(s?.questions) ? s.questions : []));
  const last = all.at(-1);
  return `<div class="panel summary"><h2>候选人速览</h2><p class="lead">${c.summary ? esc(c.summary) : '<span class="muted">正在读简历…</span>'}</p>
    ${list(c.highlights).length ? `<h4>值得深挖</h4><ul>${list(c.highlights).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
   <div class="plan-bar"><span>已生成 ${all.filter((q) => q?.q).length} 道题</span></div>
   ${sections.filter((s) => s?.title).map((s) => `<section class="section"><h2>${esc(s.title)}<span>${(s.questions || []).length} 题</span></h2>${(Array.isArray(s.questions) ? s.questions : []).filter((q) => q?.q).map((q) => `<article class="q streaming ${q === last ? 'typing' : ''}">
     <div class="q-top">${q.dim ? `<i class="dim ${DIM_COLORS[q.dim] || ''}">${esc(q.dim)}</i>` : ''}${q.why ? `<span class="q-why">${esc(q.why)}</span>` : ''}${q === last ? '<span class="q-actions muted">生成中…</span>' : ''}</div>
     <h3>${esc(q.q)}</h3>${list(q.points).length ? `<ul class="points">${list(q.points).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${q.follow ? `<p class="follow"><b>追问</b>${esc(q.follow)}</p>` : ''}</article>`).join('')}</section>`).join('')}`;
}
function evalStreamHTML(e) {
  const dims = (Array.isArray(e.dimensions) ? e.dimensions : []).filter((d) => d?.name);
  const o = e.overall || {};
  return `${o.verdict || o.summary ? `<div class="panel verdict-panel"><div class="verdict-big ${VERDICT_CLASS[o.verdict] || ''}">${esc(o.verdict || '…')}</div><div><div class="muted">${esc(o.level || '')}</div></div><p class="lead">${esc(o.summary || '')}</p></div>` : ''}
   <div class="dims">${dims.map((d, k) => `<div class="panel dim-card ${k === dims.length - 1 && !o.verdict ? 'typing' : ''}">
    <div class="dim-top"><i class="dim ${DIM_COLORS[d.name] || ''}">${esc(d.name)}</i><b>${typeof d.score === 'number' ? d.score : '…'}</b><span class="muted">/ 5</span></div>
    <div class="score-bar"><i style="width:${typeof d.score === 'number' ? d.score / 5 * 100 : 0}%"></i></div>
    <p>${esc(d.reason || '')}</p>${list(d.evidence).length ? `<ul class="evidence">${list(d.evidence).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
   ${dims.length ? '' : '<p class="muted stream-wait">正在阅读转写，马上开始给分…</p>'}`;
}


// 1 简历
function renderResume(body) {
  const i = state.interview;
  body.innerHTML = `<div class="grid-2">
   <div class="panel">
    <div class="drop" id="drop"><strong>把简历拖到这里，或点击选择文件</strong><span>支持 PDF、TXT · 文件只在本机解析</span></div>
    ${i.resumeName ? `<p class="muted small">已导入：${esc(i.resumeName)}</p>` : ''}
    <label class="field">简历内容（可直接粘贴或修改）<textarea id="resumeText" rows="18" placeholder="上传后这里会显示读取到的简历文字">${esc(i.resume)}</textarea></label>
   </div>
   <div class="panel">
    <label class="field">岗位要求（可选）<textarea id="jdText" rows="8" placeholder="写上岗位职责和要求，基础题会更贴合">${esc(i.jd)}</textarea></label>
    <div class="actions"><button class="btn primary big" data-tab-go="audio">下一步：调试音频 →</button></div>
    <p class="hint">填好候选人姓名、应聘岗位（页面顶部），上传简历，有岗位要求的话贴在上面。下一步调试麦克风和耳机，然后生成面试题。</p>
   </div></div>`;
  const drop = $('#drop');
  const importFile = async (path) => {
    if (!path) return;
    drop.classList.add('loading');
    try {
      await flushSave(); // 先存下刚输入的姓名、岗位，否则导入结果会把它们覆盖回旧值
      state.interview = await call(api.resume.import(state.id, path));
      toast('简历已读取');
      renderResume(body);
    } catch (err) { ignoreHandled(err); } finally { drop.classList.remove('loading'); }
  };
  drop.addEventListener('click', async () => importFile(await call(api.resume.pick()).catch(() => null)));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importFile(api.resume.pathOf(f)); });
  $('#resumeText').addEventListener('input', (e) => { i.resume = e.target.value; saveField({ resume: i.resume }); });
  $('#jdText').addEventListener('input', (e) => { i.jd = e.target.value; saveField({ jd: i.jd }); });
}
async function generatePlan() {
  const i = state.interview;
  if (!i.resume.trim()) { toast('请先上传或粘贴简历。', 'error'); return; }
  if (i.plan && !confirm('重新生成会覆盖现有题目和「已问」标记，确定吗？')) return;
  state.busy.plan = true;
  state.stream.plan = '';
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
function questionCard(q, { compact = false } = {}) {
  return `<article class="q ${q.asked ? 'asked' : ''}" data-q="${q.id}">
   <div class="q-top"><i class="dim ${DIM_COLORS[q.dim] || ''}">${esc(q.dim)}</i>${q.why ? `<span class="q-why">${esc(q.why)}</span>` : ''}
    <span class="q-actions">${compact ? '' : `<button class="link" data-rewrite="${q.id}">换个问法</button>`}<button class="tick ${q.asked ? 'on' : ''}" data-ask="${q.id}">${q.asked ? '✓ 已问' : '标记已问'}</button></span></div>
   <h3>${esc(q.q)}</h3>
   <details ${compact ? '' : 'open'}><summary>回答要点</summary>
    <ul class="points">${q.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    ${q.follow ? `<p class="follow"><b>追问</b>${esc(q.follow)}</p>` : ''}
    ${q.good || q.bad ? `<div class="signals">${q.good ? `<p class="good"><b>不错</b>${esc(q.good)}</p>` : ''}${q.bad ? `<p class="bad"><b>警惕</b>${esc(q.bad)}</p>` : ''}</div>` : ''}
   </details></article>`;
}
function renderPlan(body) {
  const i = state.interview, p = i.plan;
  if (state.busy.plan) {
    const data = parsePartialJSON(state.stream.plan);
    body.innerHTML = `<div class="plan streaming-plan"><div class="stream-head">${progressText('plan')}<span class="muted">题目会一道道出现，生成完可以「换个问法」和标记已问</span></div><div id="stream-plan">${data ? planStreamHTML(data) : '<p class="muted stream-wait">正在读简历、准备题目…</p>'}</div></div>`;
    return;
  }
  if (!p) {
    body.innerHTML = `<div class="empty gen-plan"><h3>生成面试题</h3><p>会生成：开场热身、简历里每个项目的追问、岗位基础题、做事方式题（自驱力 / 性格 / 适应力），全部用大白话，并附回答要点和追问。题目会边生成边显示。</p>
     ${i.resume.trim() ? '<button class="btn primary big" id="genPlan">生成面试题</button>' : '<p class="warn">还没有简历内容。</p><button class="btn primary" data-tab-go="resume">去「1 候选人」上传简历</button>'}</div>`;
    $('#genPlan')?.addEventListener('click', generatePlan);
    return;
  }
  const qs = allQuestions(p), asked = qs.filter((q) => q.asked).length;
  body.innerHTML = `<div class="plan">
   <div class="panel summary"><h2>候选人速览</h2><p class="lead">${esc(p.candidate.summary)}</p>
    <div class="grid-2 tight"><div><h4>值得深挖</h4><ul>${p.candidate.highlights.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
    <div><h4>需要核实</h4><ul>${p.verify.map((v) => `<li>${esc(v.point)}${v.ask ? `<span class="ask">可以问：${esc(v.ask)}</span>` : ''}</li>`).join('') || p.candidate.doubts.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div></div></div>
   <div class="plan-bar"><span>${qs.length} 道题 · 已问 ${asked}</span><span><button class="btn" id="genPlan">重新生成</button> <button class="btn primary" data-tab-go="live">开始面试 →</button></span></div>
   ${p.sections.map((s) => `<section class="section"><h2>${esc(s.title)}<span>${s.questions.length} 题</span></h2>${s.questions.map((q) => questionCard(q)).join('')}</section>`).join('')}
  </div>`;
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
    if (ask.closest('#liveQuestions')) { refreshLiveQuestions(); return; }
    const card = ask.closest('.q');
    card.classList.toggle('asked', q.asked);
    ask.classList.toggle('on', q.asked);
    ask.textContent = q.asked ? '✓ 已问' : '标记已问';
    return;
  }
  const pick = e.target.closest('[data-pick]');
  if (pick) { setCurrent(allQuestions(state.interview.plan).find((q) => q.id === pick.dataset.pick)); return; }
  const review = e.target.closest('[data-review]');
  if (review) { runReview(allQuestions(state.interview.plan).find((q) => q.id === review.dataset.review), { manual: true }); return; }
  const play = e.target.closest('[data-play]');
  if (play) { playPart(Number(play.dataset.play)); return; }
  const step = e.target.closest('[data-step]');
  if (step) {
    const qs = allQuestions(state.interview.plan), k = qs.indexOf(currentQuestion(qs)) + Number(step.dataset.step);
    if (qs[k]) setCurrent(qs[k]);
    return;
  }
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
    if (state.settings.recordMode === 'online' && state.settings.candidateSource !== 'system') await openCandidate();
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
  check.lines[who] = [line, ...check.lines[who]].slice(0, 4);
  refreshAudio();
  try {
    line.text = await call(api.audio.test(wav), { quiet: true });
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
async function playSample() {
  const zh = await chineseVoice();
  if (zh) {
    check.note.sim = `▶ 正在朗读（${zh.name}）：「${SAMPLE}」`;
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
  const audio = new Audio(URL.createObjectURL(new Blob([check.lastClip], { type: 'audio/wav' })));
  if (state.settings.outputId && audio.setSinkId) await audio.setSinkId(state.settings.outputId).catch(() => {});
  await Promise.race([audio.play().then(() => new Promise((r) => { audio.onended = r; })), sleep(13000)]).catch(() => {});
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
  const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
  osc.frequency.value = 660;
  gain.gain.value = 0.2;
  osc.connect(gain).connect(dest);
  const audio = new Audio();
  audio.srcObject = dest.stream;
  try {
    if (state.settings.outputId && audio.setSinkId) await audio.setSinkId(state.settings.outputId);
    osc.start();
    await audio.play();
    await sleep(900);
    check.note.tone = '播放了一声「嘀」，听到了说明耳机 / 扬声器正常';
  } catch (err) {
    check.note.tone = `✗ 播放失败：${err.message}`;
  }
  osc.stop();
  audio.pause();
  ctx.close();
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
const meterHTML = (key) => `<div class="voice"><div class="meter"><i id="meter-${key}"></i></div><span class="speak" id="speak-${key}">○ 安静</span></div>`;
function audioHTML() {
  const s = state.settings, online = s.recordMode === 'online', ck = candKey();
  if (check.error) return `<div class="panel"><p class="note bad">${esc(check.error)}</p><button class="btn" id="recheck">重新检测</button></div>`;
  const status = (done, label) => `<span class="badge ${done ? 'ok' : ''}">${done ? '✓' : '○'} ${label}</span>`;
  const note = (text) => (text ? `<p class="note ${text.startsWith('✗') ? 'bad' : ''}">${esc(text)}</p>` : '');
  return `<div class="audio-top"><div class="modes" role="radiogroup" aria-label="面试方式">
    <label><input type="radio" name="recordMode" value="offline" ${online ? '' : 'checked'}> 面对面</label>
    <label><input type="radio" name="recordMode" value="online" ${online ? 'checked' : ''}> 线上（戴耳机）</label></div>
   <p class="hint">${online ? '线上：你的麦克风 = 面试官；会议软件里对方的声音单独录一路 = 候选人。' : '面对面：一个麦克风录下双方，结束后由模型区分面试官和候选人。'}</p></div>
  <div class="audio-grid">
   <section class="panel side-card">
    <h3><i class="spk-dot me"></i>面试官（我）</h3>
    <label class="field-row">麦克风<select id="micSelect">${deviceOptions(check.inputs, s.micId)}</select></label>
    ${meterHTML('mic')}
    <div class="row"><button class="btn ${check.testing.mic ? '' : 'primary'}" id="testMic" ${check.listeners.mic ? '' : 'disabled'}>${check.testing.mic ? '停止测试' : '开始测试'}</button><span class="muted small">${check.testing.mic ? '请读下面这句话，读完停一下就会自动转写' : '点「开始测试」，然后读下面这句话'}</span></div>
    <p class="read-aloud">「${READ_ALOUD}」</p>
    ${linesHTML(check.lines.mic, '还没测试')}
   </section>
   <section class="panel side-card">
    <h3><i class="spk-dot them"></i>候选人</h3>
    ${online ? `<label class="field-row">声音来源<select id="candSelect"><option value="system" ${s.candidateSource === 'system' ? 'selected' : ''}>电脑声音（会议软件里对方的声音）</option>${candidateInputs().map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === s.candidateSource ? 'selected' : ''}>输入设备：${esc(d.label)}</option>`).join('')}</select></label>
     ${check.listeners.cand ? meterHTML('cand') : '<div class="row"><button class="btn" id="listenCand">开始监听候选人声音</button></div>'}${note(check.note.candErr)}`
    : '<p class="muted small">面对面：候选人和你共用左边的麦克风。</p>'}
    <label class="field-row">播放设备<select id="outSelect">${deviceOptions(check.outputs, s.outputId)}</select><button class="btn" id="playTone">播放测试音</button></label>
    ${note(check.note.tone)}
    <div class="row"><button class="btn primary" id="simCand" ${check.sim || (online && !check.listeners.cand && check.note.candErr) ? 'disabled' : ''}>${check.sim ? '正在模拟…' : '▶ 模拟候选人说话'}</button>
     ${online && check.listeners.cand ? `<button class="btn" id="testCand">${check.testing.cand ? '停止真人测试' : '真人测试'}</button>` : ''}</div>
    <p class="muted small">模拟：电脑朗读「${SAMPLE}」${online ? '，从候选人那一路录下来再转写（朗读声音从系统默认播放设备出来）' : '，从扬声器播放、由麦克风录下来再转写'}。</p>
    ${note(check.note.sim)}
    ${check.note.crosstalk ? `<p class="note warn-note">${esc(check.note.crosstalk)}</p>` : ''}
    ${linesHTML(check.lines.cand, online ? '还没测试：点「模拟候选人说话」，或对方在会议里时点「真人测试」' : '还没测试：点「模拟候选人说话」')}
   </section>
  </div>
  <div class="panel audio-next"><div>${status(check.passed.mic, '面试官转写正常')}${status(check.passed.cand, '候选人转写正常')}</div>
   <button class="btn primary big" data-tab-go="plan">下一步：生成面试题 →</button></div>`;
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
    if (value === 'online' && state.settings.candidateSource !== 'system') await openCandidate();
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
    if (manual) toast(q.askedAt == null ? '这题还没开始问（录音中切到这题或系统认出这题后才开始计）' : '候选人对这题说的话还太少', 'error');
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
function copilotHTML(q) {
  const r = q.review, busy = state.reviewing === q.id;
  const LEVEL = { 好: 'good', 一般: 'mid', 弱: 'weak' };
  return `<div class="copilot">
    <div class="copilot-head"><b>AI 副驾</b><span class="muted">${busy ? '正在看候选人的回答…' : r ? `答完后自动点评 · ${new Date(r.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '候选人答完会自动点评；也可以随时点右边'}</span>
     <button class="link" data-review="${q.id}" ${busy ? 'disabled' : ''}>${r ? '重新点评' : '看看答得怎样'}</button></div>
    ${r ? `<p class="copilot-comment"><i class="lvl ${LEVEL[r.level] || 'mid'}">${esc(r.level)}</i>${esc(r.comment)}</p>
     ${r.follow.length ? `<div class="copilot-follow"><b>可以追问</b>${r.follow.map((f) => `<p>${esc(f)}</p>`).join('')}</div>` : ''}` : ''}
   </div>`;
}
function liveQuestionHTML(qs) {
  if (!qs.length) return '<p class="muted">还没有生成面试题，也可以直接录音。</p>';
  const cur = currentQuestion(qs), sec = state.interview.plan.sections.find((s) => s.questions.includes(cur));
  const k = qs.indexOf(cur);
  return `<article class="current" data-q="${cur.id}">
    <div class="q-top"><i class="dim ${DIM_COLORS[cur.dim] || ''}">${esc(cur.dim)}</i><span>${esc(sec?.title || '')} · 第 ${k + 1} / ${qs.length} 题</span>
     <span class="q-actions"><button class="link" data-step="-1" ${k ? '' : 'disabled'}>← 上一题</button><button class="link" data-step="1" ${k < qs.length - 1 ? '' : 'disabled'}>下一题 →</button></span></div>
    <h3>${esc(cur.q)}</h3>
    <ul class="points ${cur.review ? 'reviewed' : ''}">${cur.points.map((p, n) => `<li class="${cur.review ? (cur.review.covered[n] ? 'hit' : 'miss') : ''}">${esc(p)}</li>`).join('')}</ul>
    ${cur.follow ? `<p class="follow"><b>追问</b>${esc(cur.follow)}</p>` : ''}
    ${cur.good || cur.bad ? `<div class="signals">${cur.good ? `<p class="good"><b>不错</b>${esc(cur.good)}</p>` : ''}${cur.bad ? `<p class="bad"><b>警惕</b>${esc(cur.bad)}</p>` : ''}</div>` : ''}
    ${copilotHTML(cur)}
    <div class="current-actions">${cur.asked ? `<button class="btn" data-ask="${cur.id}">取消已问</button>` : ''}<button class="btn primary" data-ask-next="${cur.id}">${cur.asked ? '下一道没问的 →' : '✓ 已问，下一题'}</button></div>
   </article>
   <div class="q-list">${state.interview.plan.sections.map((s) => `<h4>${esc(s.title)}</h4>${s.questions.map((q) => `<button class="q-row ${q === cur ? 'on' : ''} ${q.asked ? 'done' : ''}" data-pick="${q.id}"><i class="dot ${DIM_COLORS[q.dim] || ''}"></i><span>${esc(q.q)}</span><em>${q.review ? `<i class="lvl ${{ 好: 'good', 一般: 'mid', 弱: 'weak' }[q.review.level] || 'mid'}">${esc(q.review.level)}</i>` : ''}${q.asked ? '✓ 已问' : esc(q.dim)}</em></button>`).join('')}`).join('')}</div>`;
}
function renderLive(body) {
  const i = state.interview, s = state.settings, rec = state.recState;
  const qs = allQuestions(i.plan), online = s.recordMode === 'online';
  const checked = i.audioCheck?.interviewer && (i.audioCheck?.candidate || !online);
  const modeText = state.rec ? (state.rec.twoTracks ? '线上：我的麦克风记为面试官，电脑声音记为候选人' : `只录麦克风${state.rec.systemAudioError ? `（${state.rec.systemAudioError}）` : ''}，结束后可区分说话人`) : '';
  body.innerHTML = `<div class="panel rec-bar ${rec}">
    <div class="rec-time" id="recTime">${fmtTime(state.rec?.elapsed ?? i.audioSeconds ?? 0)}</div>
    ${rec === 'idle' ? '' : '<div class="level"><i id="level"></i></div>'}
    ${rec === 'idle' ? `<div class="modes" role="radiogroup" aria-label="面试方式">
      <label><input type="radio" name="recordMode" value="offline" ${online ? '' : 'checked'}> 面对面</label>
      <label><input type="radio" name="recordMode" value="online" id="systemAudio" ${online ? 'checked' : ''}> 线上（戴耳机）</label></div>`
    : `<p class="hint" id="recHint">${rec === 'paused' ? '已暂停' : '录音中'} · ${esc(modeText)}</p>`}
    <div class="rec-buttons">
     ${rec === 'idle' && (i.audioParts || (i.transcript || []).length || i.evaluation) ? '<button class="btn" id="restartInterview">重新开始面试</button>' : ''}
     ${rec === 'idle' ? `<button class="btn rec big" id="recStart">● ${i.audioParts ? '继续面试（接着录）' : '开始面试'}</button>` : ''}
     ${rec === 'recording' ? '<button class="btn big" id="recPause">暂停</button>' : ''}
     ${rec === 'paused' ? '<button class="btn big" id="recResume">继续</button>' : ''}
     ${rec !== 'idle' ? '<button class="btn primary big" id="recStop">结束面试</button>' : ''}
    </div>
   </div>
   ${rec === 'idle' ? `<p class="hint rec-note">点「开始面试」后自动录音、边录边转写。录音前请告知候选人并征得同意。${s.asrEnabled ? '' : ' 自动转写已关闭，可在面试后导入转写文本。'}${checked ? ' <span class="ok">✓ 音频已调试</span>' : ' <b class="warn">音频还没调试好</b>'}<button class="link" data-tab-go="audio">${checked ? '重新调试' : '去调试音频'}</button></p>` : ''}
   <div class="live">
    <section class="panel live-questions">
     <div class="panel-head"><h2>面试题</h2><span class="muted" id="askedCount">已问 ${qs.filter((q) => q.asked).length} / ${qs.length}</span></div>
     <div id="liveQuestions">${liveQuestionHTML(qs)}</div>
    </section>
    <div class="live-side">
     <section class="panel transcript-panel">
      <div class="panel-head"><h2>转写</h2><span class="tools">${rec === 'idle' ? `${needsSpeakers(i) ? `<button class="link" id="splitSpeakers" ${state.busy.speakers ? 'disabled' : ''}>${state.busy.speakers ? progressText('speakers') : '区分面试官 / 候选人'}</button>` : ''}${i.audioParts ? '<button class="link" id="openAudio">打开录音</button><button class="link" id="retranscribe">重新转写</button>' : ''}<button class="link" id="importTranscript">导入</button><button class="link" id="editTranscript">编辑</button>${state.segErrors.size ? '<button class="link" id="retrySegments">重试失败的段</button>' : ''}` : ''}</span></div>
      <div class="transcript" id="transcript">${transcriptHTML()}</div>
     </section>
     <section class="panel notes-panel"><h2>现场笔记</h2><textarea id="notes" rows="6" placeholder="记下关键回答、印象、要追问的点…（评估时会一起参考）">${esc(i.notes)}</textarea></section>
    </div>
   </div>`;
  $('#notes').addEventListener('input', (e) => { i.notes = e.target.value; saveField({ notes: i.notes }); });
  body.querySelectorAll('[name=recordMode]').forEach((r) => r.addEventListener('change', async () => {
    state.settings = await call(api.settings.save({ recordMode: r.value }));
    renderLive(body);
  }));
  $('#recStart')?.addEventListener('click', startRecording);
  $('#restartInterview')?.addEventListener('click', async () => {
    try {
      await flushSave();
      const fresh = await call(api.interviews.restart(state.id));
      if (!fresh) return;
      state.interview = fresh;
      state.segErrors.clear();
      state.current = null;
      toast('已清空，可以重新开始面试');
      renderLive(body);
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
}
function refreshLiveQuestions() {
  const box = $('#liveQuestions');
  if (!box) return;
  const qs = allQuestions(state.interview.plan);
  box.innerHTML = liveQuestionHTML(qs);
  $('#askedCount').textContent = `已问 ${qs.filter((q) => q.asked).length} / ${qs.length}`;
  box.querySelector('.q-row.on')?.scrollIntoView({ block: 'nearest' });
}
// 只有一路麦克风或导入的文字时，转写里没有说话人，需要模型区分。
const needsSpeakers = (i) => !i.dialogue?.length && (i.transcript || []).some((t) => t.text && !t.speaker);
function transcriptHTML() {
  const i = state.interview, echoes = (i.transcript || []).filter((t) => t.echo).length;
  const echoNote = echoes ? `<p class="echo-note">已去掉 ${echoes} 段重复：你的麦克风录到了候选人的声音（多半是没戴耳机、声音从扬声器出来了）。戴上耳机就不会再出现。</p>` : '';
  return echoNote + transcriptBody(i);
}
function transcriptBody(i) {
  if (i.dialogue?.length) {
    return i.dialogue.map((t) => `<div class="turn ${SPEAKER_CLASS[t.speaker] || ''}"><b>${esc(t.speaker)}</b><p>${esc(t.text)}</p></div>`).join('');
  }
  const segs = [...(i.transcript || [])].filter((s) => (s.text || s.source !== 'asr') && !s.echo);
  for (const [index, e] of state.segErrors) if (!segs.some((s) => s.index === index)) segs.push({ index, start: e.start, speaker: e.speaker, error: e.error });
  segs.sort((a, b) => a.start - b.start || a.index - b.index);
  if (!segs.length) return '<p class="muted">录音开始后，转写会一段段出现在这里。也可以面试结束后导入飞书妙记、腾讯会议等导出的文字。</p>';
  return segs.map((s) => {
    const time = `<time>${s.source === 'asr' || s.error ? fmtTime(s.start) : '文本'}</time>`;
    if (s.error) return `<div class="turn err">${time}<b>${esc(s.speaker || '')}</b><p>这一段转写失败：${esc(s.error)}</p></div>`;
    const play = s.source === 'asr' && state.recState === 'idle' ? ` data-play="${s.index}" title="点击回放这一段"` : '';
    return `<div class="turn ${SPEAKER_CLASS[s.speaker] || 'plain'}${play ? ' playable' : ''}"${play}>${time}${s.speaker ? `<b>${esc(s.speaker)}</b>` : ''}<p>${esc(s.text)}</p></div>`;
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
  if (state.recState === 'recording') toast('音频设备变了（是不是插拔了耳机？）。请确认录音和转写还在正常进行。', 'error');
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
    if (!confirm('当前转写是导入或手动编辑的文本，开始录音后会接在后面。继续吗？')) return;
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
    else toast('录音已保存。转写内容太少，没法生成报告，可以在「4 面试中」导入转写后再评估。', 'error');
  } catch (err) { ignoreHandled(err); }
}
async function importTranscript() {
  try {
    await flushSave();
    const text = await call(api.transcript.pick());
    if (!text) return;
    if ((state.interview.transcript || []).length && !confirm('导入会替换当前的转写内容，确定吗？')) return;
    state.interview = await call(api.interviews.save({ id: state.id, transcript: [{ index: 0, start: 0, text: text.trim(), source: 'import' }], dialogue: null, status: state.interview.status === 'evaluated' ? 'evaluated' : 'done' }));
    state.segErrors.clear();
    toast('转写已导入');
    renderLive($('#tabBody'));
  } catch (err) { ignoreHandled(err); }
}
function editTranscript() {
  const panel = $('.transcript-panel');
  panel.innerHTML = `<div class="panel-head"><h2>编辑转写</h2><span class="tools"><button class="link" id="cancelEdit">取消</button><button class="btn primary" id="saveEdit">保存</button></span></div>
   <textarea id="transcriptEditor" rows="18">${esc(transcriptText(state.interview))}</textarea><p class="hint">可以直接粘贴会议软件导出的文字。保存后按整段文本处理。</p>`;
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
  if ((state.interview.transcript || []).some((t) => t.text) && !confirm('用保存的录音重新转写整场面试，会替换现在的转写内容。继续吗？')) return;
  const btn = $('#retranscribe');
  btn.disabled = true;
  btn.textContent = '重新转写中…';
  try {
    await flushSave();
    const res = await call(api.audio.retranscribe(state.id));
    state.interview = res.interview;
    toast(res.failed ? `转写完成，${res.failed} 段失败，可以稍后点「重试失败的段」` : `已重新转写 ${res.done} 段`, res.failed ? 'error' : undefined);
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
function renderEval(body) {
  const i = state.interview, e = i.evaluation;
  const textLen = transcriptText(i).replace(/\s/g, '').length;
  const head = `<div class="panel eval-head"><div><h2>评估报告</h2><p class="muted">根据转写${i.notes ? '和现场笔记' : ''}评估：专业度、自驱力、性格特质、逻辑思维、适应力，每项 0~5 分。转写约 ${textLen} 字。</p></div>
   <div class="actions">${state.busy.eval ? progressText('eval') : ''}<button class="btn ${e ? '' : 'primary big'}" id="genEval" ${state.busy.eval || textLen < 50 ? 'disabled' : ''}>${e ? '重新评估' : '生成评估'}</button>
   ${e ? '<button class="btn" id="exportMd">导出 Markdown</button><button class="btn primary" id="exportPdf">导出 PDF</button>' : ''}</div></div>`;
  if (state.busy.eval) {
    const data = parsePartialJSON(state.stream.eval);
    const wait = state.evalStage === 'speakers' ? '正在区分面试官和候选人的话…' : '正在阅读转写，马上开始给分…';
    body.innerHTML = head + `<div class="eval" id="stream-eval">${data ? evalStreamHTML(data) : `<p class="muted stream-wait">${wait}</p>`}</div>`;
  } else if (!e) {
    body.innerHTML = head + (textLen < 50 ? `<div class="empty"><h3>还没有足够的转写内容</h3><p>在「4 面试中」录音，或导入会议转写文本后再来评估。</p><button class="btn" data-tab-go="live">去录音 / 导入转写</button></div>` : '');
  } else {
    const avg = average(e);
    body.innerHTML = head + `<div class="eval">
     <div class="panel verdict-panel"><div class="verdict-big ${VERDICT_CLASS[e.overall.verdict] || ''}">${esc(e.overall.verdict)}</div><div><div class="avg">${avg}<span>/ 5</span></div><div class="muted">${esc(e.overall.level)} · 五项平均</div></div><p class="lead">${esc(e.overall.summary)}</p></div>
     <div class="dims">${e.dimensions.map((d, k) => `<div class="panel dim-card">
      <div class="dim-top"><i class="dim ${DIM_COLORS[d.name] || ''}">${esc(d.name)}</i>
       <select data-score="${k}" aria-label="${esc(d.name)}分数">${Array.from({ length: 11 }, (_, n) => n / 2).map((v) => `<option value="${v}" ${v === d.score ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="muted">/ 5${d.manual ? ' · 已手动调整' : ''}${d.enough ? '' : ' · 证据不足'}</span></div>
      <div class="score-bar"><i style="width:${d.score / 5 * 100}%"></i></div>
      <p>${esc(d.reason)}</p>${d.evidence.length ? `<ul class="evidence">${d.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>
     <div class="grid-3">
      <div class="panel"><h3>优点</h3><ul>${e.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="panel"><h3>风险</h3><ul>${e.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="panel"><h3>下一轮建议追问</h3><ul>${e.nextRound.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
     </div>
     <div class="panel"><h3>没覆盖到 / 证据不足</h3><p>${esc(e.gaps || '无')}</p></div>${rhythmHTML(i)}</div>`;
  }
  $('#genEval')?.addEventListener('click', () => generateEval());
  $('#exportPdf')?.addEventListener('click', () => exportReport('pdf'));
  $('#exportMd')?.addEventListener('click', () => exportReport('md'));
  body.querySelectorAll('[data-score]').forEach((sel) => sel.addEventListener('change', async () => {
    const d = e.dimensions[Number(sel.dataset.score)];
    d.score = Number(sel.value);
    d.manual = true;
    state.interview = await call(api.interviews.save({ id: state.id, evaluation: e }));
    renderEval(body);
  }));
}
// 回答节奏（线上两路录音才有准确时间）：说话占比、候选人开口前停多久。只做参考，不进打分。
function rhythmHTML(i) {
  const r = rhythm(i.transcript);
  if (r.share == null) return '';
  const min = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒` : `${Math.round(sec)} 秒`);
  return `<div class="panel rhythm"><h3>回答节奏 <span class="muted small">仅供参考，不计入打分</span></h3>
   <div class="rhythm-bar"><i style="width:${Math.round(r.share * 100)}%"></i></div>
   <p>候选人说话 ${min(r.talk.候选人)}（${Math.round(r.share * 100)}%），面试官 ${min(r.talk.面试官)}。${r.share < 0.5 ? '面试官说得比候选人还多，可以多给对方展开的机会。' : ''}</p>
   ${r.avg != null ? `<p>面试官问完后，候选人平均停 ${r.avg.toFixed(1)} 秒再开口（${r.waits.length} 次）。</p>` : ''}
   ${r.steady ? `<p class="warn-note note">每次开口前都停了 ${r.avg.toFixed(1)} 秒左右，而且很一致。可能是在组织语言，也可能是在看提示工具，建议下一轮多追问具体细节、打断后换个条件再问。</p>` : ''}</div>`;
}
async function generateEval({ auto = false } = {}) {
  const i = state.interview;
  if (!auto && i.evaluation && !confirm('重新评估会覆盖当前评估（包括手动调整的分数），确定吗？')) return;
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

// ---------- 启动 ----------
window.addEventListener('beforeunload', (e) => { flushSave(); if (state.recState !== 'idle') { e.preventDefault(); e.returnValue = ''; } });
(async () => {
  try {
    state.info = await call(api.info());
    state.settings = await call(api.settings.get());
    renderSideFoot();
    await go(state.settings.apiKeyHint ? 'home' : 'settings');
    if (!state.settings.apiKeyHint) toast('先配置模型和 API Key，就可以开始使用了。');
  } catch (err) { ignoreHandled(err); }
})();
})();
