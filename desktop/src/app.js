'use strict';
(() => {
const api = window.api;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const state = { view: 'home', tab: 'resume', id: null, interview: null, info: null, settings: null, busy: {}, rec: null, recState: 'idle', segErrors: new Map() };
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
const transcriptText = (i) => (i.transcript || []).map((t) => t.text).filter(Boolean).join('\n');
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
  main.innerHTML = `<header class="page-head"><div><h1>面试记录</h1><p>${list.length} 场面试 · 新建面试后上传简历，即可生成大白话面试题</p></div></header>${setupHint}
  ${list.length ? `<div class="table"><div class="tr th"><span>候选人</span><span>岗位</span><span>时间</span><span>状态</span><span>结论</span><span></span></div>
   ${list.map((i) => `<div class="tr" data-open="${i.id}"><span class="strong">${esc(i.name || '未命名候选人')}</span><span>${esc(i.position || '—')}</span><span class="muted">${fmtDate(i.createdAt)}</span><span><i class="badge s-${i.status}">${STATUS[i.status] || i.status}</i></span><span>${i.verdict ? `<i class="verdict ${VERDICT_CLASS[i.verdict] || ''}">${esc(i.verdict)}</i> <span class="muted">${i.average ?? ''}</span>` : '<span class="muted">—</span>'}</span><span class="right"><button class="link danger" data-remove="${i.id}">删除</button></span></div>`).join('')}</div>`
   : `<div class="empty"><h3>还没有面试记录</h3><p>点击左上角「新建面试」，上传候选人简历开始。</p></div>`}`;
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
   <label class="check"><input type="checkbox" name="asrEnabled" ${s.asrEnabled ? 'checked' : ''}> 录音时自动转写（每段 ${s.chunkSeconds} 秒，边录边转）</label>
   <label class="check"><input type="checkbox" name="asrUseChatKey" ${s.asrUseChatKey ? 'checked' : ''}> 与上面的大模型共用 API Key（大模型选的是智谱时勾选）</label>
   <label class="asr-key" ${s.asrUseChatKey ? 'hidden' : ''}>智谱 API Key<input name="asrKey" type="password" placeholder="${esc(s.asrKeyHint || '粘贴智谱 API Key')}"></label>
   <label>接口地址<input name="asrBaseURL" value="${esc(s.asrBaseURL)}"></label>
   <label>模型<input name="asrModel" list="asrModels" value="${esc(s.asrModel)}"><datalist id="asrModels"><option value="glm-asr-2512"><option value="glm-asr"></datalist></label>
   <label>每段时长（秒）<input name="chunkSeconds" type="number" min="10" max="28" value="${s.chunkSeconds}"></label>
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
  state.interview = await call(api.interviews.get(id));
  const i = state.interview;
  state.tab = tab || (i.evaluation ? 'eval' : i.status === 'done' ? 'eval' : i.plan ? 'plan' : 'resume');
  setNav();
  renderInterview();
}
function renderInterview() {
  const i = state.interview;
  const tabs = [['resume', '1 简历'], ['plan', '2 面试题'], ['live', '3 面试中'], ['eval', '4 评估']];
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
  ({ resume: renderResume, plan: renderPlan, live: renderLive, eval: renderEval })[state.tab](body);
}
const progressText = (task) => `<span class="progress" id="progress-${task}">正在连接模型…</span>`;
api.onProgress((p) => {
  const el = document.getElementById(`progress-${p.task}`);
  if (el && p.id === state.id) el.textContent = p.thinking ? `模型思考中…（${p.received} 字）` : `正在生成…已收到 ${p.received} 字`;
});

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
    <div class="actions"><button class="btn primary big" id="genPlan" ${state.busy.plan ? 'disabled' : ''}>${i.plan ? '重新生成面试题' : '生成面试题'}</button>${state.busy.plan ? progressText('plan') : ''}</div>
    <p class="hint">会生成：开场热身、简历里每个项目的追问、岗位基础题、做事方式题（自驱力 / 性格 / 适应力），全部用大白话，并附回答要点。</p>
   </div></div>`;
  const drop = $('#drop');
  const importFile = async (path) => {
    if (!path) return;
    drop.classList.add('loading');
    try {
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
  $('#genPlan').addEventListener('click', generatePlan);
}
async function generatePlan() {
  const i = state.interview;
  if (!i.resume.trim()) { toast('请先上传或粘贴简历。', 'error'); return; }
  if (i.plan && !confirm('重新生成会覆盖现有题目和「已问」标记，确定吗？')) return;
  state.busy.plan = true;
  renderTab();
  try {
    await flushSave();
    state.interview = await call(api.plan.generate(i.id));
    state.busy.plan = false;
    state.tab = 'plan';
    renderInterview();
    toast('面试题已生成');
  } catch (err) { state.busy.plan = false; renderTab(); ignoreHandled(err); }
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
  if (!p) { body.innerHTML = `<div class="empty"><h3>还没有面试题</h3><p>先在「1 简历」里上传简历，再点「生成面试题」。</p><button class="btn primary" data-tab-go="resume">去上传简历</button></div>`; return; }
  const qs = allQuestions(p), asked = qs.filter((q) => q.asked).length;
  body.innerHTML = `<div class="plan">
   <div class="panel summary"><h2>候选人速览</h2><p class="lead">${esc(p.candidate.summary)}</p>
    <div class="grid-2 tight"><div><h4>值得深挖</h4><ul>${p.candidate.highlights.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
    <div><h4>需要核实</h4><ul>${p.verify.map((v) => `<li>${esc(v.point)}${v.ask ? `<span class="ask">可以问：${esc(v.ask)}</span>` : ''}</li>`).join('') || p.candidate.doubts.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div></div></div>
   <div class="plan-bar"><span>${qs.length} 道题 · 已问 ${asked}</span><span><button class="btn" data-tab-go="live">开始面试 →</button></span></div>
   ${p.sections.map((s) => `<section class="section"><h2>${esc(s.title)}<span>${s.questions.length} 题</span></h2>${s.questions.map((q) => questionCard(q)).join('')}</section>`).join('')}
  </div>`;
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
    const card = ask.closest('.q');
    card.classList.toggle('asked', q.asked);
    ask.classList.toggle('on', q.asked);
    ask.textContent = q.asked ? '✓ 已问' : '标记已问';
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

// 3 面试中
function renderLive(body) {
  const i = state.interview, s = state.settings, rec = state.recState;
  const qs = allQuestions(i.plan);
  body.innerHTML = `<div class="live">
   <div class="live-main">
    <div class="panel recorder">
     <div class="rec-row">
      <div class="rec-time" id="recTime">${fmtTime(state.rec?.elapsed ?? i.audioSeconds ?? 0)}</div>
      <div class="level"><i id="level"></i></div>
      <div class="rec-buttons">
       ${rec === 'idle' ? `<button class="btn rec big" id="recStart">● ${i.audioParts ? '继续录音' : '开始录音'}</button>` : ''}
       ${rec === 'recording' ? '<button class="btn big" id="recPause">暂停</button>' : ''}
       ${rec === 'paused' ? '<button class="btn big" id="recResume">继续</button>' : ''}
       ${rec !== 'idle' ? '<button class="btn primary big" id="recStop">结束面试</button>' : ''}
      </div>
     </div>
     ${rec === 'idle' ? `<label class="check"><input type="checkbox" id="systemAudio"> 同时录制电脑声音（线上面试用耳机时勾选）</label>
     <p class="hint">录音前请告知候选人并征得同意。${s.asrEnabled ? `录音每 ${s.chunkSeconds} 秒自动转写一段。` : '自动转写已关闭，可在面试后导入转写文本。'}</p>` : `<p class="hint" id="recHint">${rec === 'paused' ? '已暂停' : '录音中…'}${state.rec?.systemAudioError ? ` · ${esc(state.rec.systemAudioError)}，只录了麦克风` : ''}</p>`}
    </div>
    <div class="panel transcript-panel">
     <div class="panel-head"><h2>转写</h2><span class="tools">${rec === 'idle' ? `<button class="link" id="importTranscript">导入会议转写</button><button class="link" id="editTranscript">编辑全文</button>${state.segErrors.size ? '<button class="link" id="retrySegments">重试失败的段</button>' : ''}` : ''}</span></div>
     <div class="transcript" id="transcript">${transcriptHTML()}</div>
    </div>
    <div class="panel"><h2>现场笔记</h2><textarea id="notes" rows="5" placeholder="记下关键回答、印象、要追问的点…（评估时会一起参考）">${esc(i.notes)}</textarea></div>
   </div>
   <aside class="live-side panel">
    <div class="panel-head"><h2>面试题</h2><span class="muted" id="askedCount">${qs.filter((q) => q.asked).length} / ${qs.length}</span></div>
    ${qs.length ? i.plan.sections.map((sec) => `<h4 class="side-sec">${esc(sec.title)}</h4>${sec.questions.map((q) => questionCard(q, { compact: true })).join('')}`).join('') : '<p class="muted">还没有生成面试题，也可以直接录音。</p>'}
   </aside></div>`;
  $('#notes').addEventListener('input', (e) => { i.notes = e.target.value; saveField({ notes: i.notes }); });
  $('#recStart')?.addEventListener('click', startRecording);
  $('#recPause')?.addEventListener('click', () => { state.rec.pause(); state.recState = 'paused'; renderLive(body); });
  $('#recResume')?.addEventListener('click', () => { state.rec.resume(); state.recState = 'recording'; renderLive(body); });
  $('#recStop')?.addEventListener('click', stopRecording);
  $('#importTranscript')?.addEventListener('click', importTranscript);
  $('#editTranscript')?.addEventListener('click', editTranscript);
  $('#retrySegments')?.addEventListener('click', retrySegments);
  const t = $('#transcript');
  t.scrollTop = t.scrollHeight;
}
function transcriptHTML() {
  const segs = [...(state.interview.transcript || [])];
  for (const [index, e] of state.segErrors) if (!segs.some((s) => s.index === index)) segs.push({ index, start: e.start, error: e.error });
  segs.sort((a, b) => a.index - b.index);
  if (!segs.length) return '<p class="muted">录音开始后，转写会一段段出现在这里。也可以面试结束后导入飞书妙记、腾讯会议等导出的文字。</p>';
  return segs.map((s) => s.error ? `<p class="seg err"><time>${fmtTime(s.start)}</time>这一段转写失败：${esc(s.error)}</p>`
    : `<p class="seg"><time>${s.source === 'asr' ? fmtTime(s.start) : '文本'}</time>${esc(s.text) || '<span class="muted">（无语音）</span>'}</p>`).join('');
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
  if (seg.error) state.segErrors.set(seg.index, { start: seg.start, error: seg.error });
  else {
    state.segErrors.delete(seg.index);
    const tr = (state.interview.transcript || []).filter((t) => t.index !== seg.index);
    tr.push({ index: seg.index, start: seg.start, text: seg.text, source: 'asr' });
    state.interview.transcript = tr.sort((a, b) => a.index - b.index);
  }
  refreshTranscript();
});
const pendingChunks = new Set();
async function startRecording() {
  const i = state.interview, s = state.settings;
  if ((i.transcript || []).some((t) => t.source !== 'asr')) {
    if (!confirm('当前转写是导入或手动编辑的文本，开始录音后会接在后面。继续吗？')) return;
  }
  try {
    await call(api.audio.askMic());
    state.interview = await call(api.interviews.get(state.id));
    const fresh = state.interview;
    const rec = new Recorder({
      chunkSeconds: s.chunkSeconds,
      onChunk: ({ index, start, wav }) => {
        const p = api.audio.chunk(state.id, index, start, wav).finally(() => pendingChunks.delete(p));
        pendingChunks.add(p);
      },
      onLevel: (v) => { const el = $('#level'); if (el) el.style.width = `${Math.min(100, v * 160)}%`; const t = $('#recTime'); if (t) t.textContent = fmtTime(rec.elapsed); },
    });
    await rec.start({ systemAudio: $('#systemAudio')?.checked, startIndex: fresh.audioParts || 0, startOffset: fresh.audioSeconds || 0 });
    state.rec = rec;
    state.recState = 'recording';
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
    toast(res.file ? '录音已保存，转写完成' : '录音已结束');
    renderLive($('#tabBody'));
  } catch (err) { ignoreHandled(err); }
}
async function importTranscript() {
  try {
    await flushSave();
    const text = await call(api.transcript.pick());
    if (!text) return;
    if ((state.interview.transcript || []).length && !confirm('导入会替换当前的转写内容，确定吗？')) return;
    state.interview = await call(api.interviews.save({ id: state.id, transcript: [{ index: 0, start: 0, text: text.trim(), source: 'import' }], status: state.interview.status === 'evaluated' ? 'evaluated' : 'done' }));
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
    state.interview = await call(api.interviews.save({ id: state.id, transcript: text ? [{ index: 0, start: 0, text, source: 'edited' }] : [] }));
    state.segErrors.clear();
    renderLive($('#tabBody'));
  });
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
  const head = `<div class="panel eval-head"><div><h2>面试评估</h2><p class="muted">根据转写${i.notes ? '和现场笔记' : ''}评估：专业度、自驱力、性格特质、逻辑思维、适应力，每项 0~5 分。转写约 ${textLen} 字。</p></div>
   <div class="actions">${state.busy.eval ? progressText('eval') : ''}<button class="btn ${e ? '' : 'primary big'}" id="genEval" ${state.busy.eval || textLen < 50 ? 'disabled' : ''}>${e ? '重新评估' : '生成评估'}</button>
   ${e ? '<button class="btn" id="exportMd">导出 Markdown</button><button class="btn primary" id="exportPdf">导出 PDF</button>' : ''}</div></div>`;
  if (!e) {
    body.innerHTML = head + (textLen < 50 ? `<div class="empty"><h3>还没有足够的转写内容</h3><p>在「3 面试中」录音，或导入会议转写文本后再来评估。</p><button class="btn" data-tab-go="live">去录音 / 导入转写</button></div>` : '');
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
     <div class="panel"><h3>没覆盖到 / 证据不足</h3><p>${esc(e.gaps || '无')}</p></div></div>`;
  }
  $('#genEval')?.addEventListener('click', generateEval);
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
async function generateEval() {
  const i = state.interview;
  if (i.evaluation && !confirm('重新评估会覆盖当前评估（包括手动调整的分数），确定吗？')) return;
  await flushSave();
  state.busy.eval = true;
  renderTab();
  try {
    state.interview = await call(api.evaluate(i.id));
    toast('评估已生成');
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
