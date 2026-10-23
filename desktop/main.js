'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, session, safeStorage, desktopCapturer, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');
const { createStore } = require('./lib/store');
const { createSettings } = require('./lib/settings');
const { createPositions } = require('./lib/positions');
const { PROVIDERS, chat, chatJSON } = require('./lib/llm');
const { transcribe, synthesize, silentWav } = require('./lib/asr');
const { readResume, SUPPORTED } = require('./lib/resume');
const { markEcho } = require('./src/text-match');
const prompts = require('./lib/prompts');
const report = require('./lib/report');

// 测试时可指定数据目录，并使用虚拟麦克风。
if (process.env.INTERVIEW_DATA_DIR) app.setPath('userData', process.env.INTERVIEW_DATA_DIR);
if (process.env.INTERVIEW_FAKE_MEDIA) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  if (process.env.INTERVIEW_FAKE_AUDIO) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.INTERVIEW_FAKE_AUDIO);
}

let win, store, settings, positions;

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 1040, minHeight: 680,
    title: '面试助手',
    backgroundColor: '#f5f6f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // 外部链接用系统浏览器打开，不在应用内跳转。
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  // macOS 没有菜单时 ⌘C / ⌘V 等编辑快捷键会失效，所以保留最小菜单；其他系统不显示菜单栏。
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  store = createStore(app.getPath('userData'));
  settings = createSettings(app.getPath('userData'), safeStorage);
  positions = createPositions(app.getPath('userData'));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  // 线上面试时录制电脑声音：屏幕共享请求只取系统声音（loopback），画面在渲染进程里立即丢弃。
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => cb({ video: sources[0], audio: 'loopback' }))
      .catch(() => cb({}));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- IPC ----------
// 统一包装：把异常转成 {error} 返回给界面，避免渲染进程拿到难懂的堆栈。
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) {
      console.error(`[${channel}]`, err);
      return { ok: false, error: err.message || String(err), detail: err.detail || '' };
    }
  });
}
const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);
// 流式进度：每次带上已收到的全文，界面据此边生成边显示；最多每 100ms 发一次，最后一次总会发出。
function progress(id, task) {
  let last = 0, timer = null, latest = null;
  const flush = () => { timer = null; last = Date.now(); send('llm:progress', { id, task, ...latest }); };
  return (p) => {
    latest = p;
    if (Date.now() - last >= 100) flush();
    else if (!timer) timer = setTimeout(flush, 100);
  };
}

function llmOptions(extra = {}) {
  const s = settings.getSecret();
  return { baseURL: s.baseURL, apiKey: s.apiKey, model: s.model, thinking: s.thinking, ...extra };
}

handle('app:info', () => ({ providers: PROVIDERS, dimensions: prompts.DIMENSIONS, dataDir: app.getPath('userData'), version: app.getVersion(), platform: process.platform }));
handle('settings:get', () => settings.getPublic());
handle('settings:save', (patch) => settings.save(patch));
handle('settings:testLLM', async () => {
  const text = await chat(llmOptions({ messages: [{ role: 'user', content: '只回复两个字：正常' }], temperature: 0, timeoutMs: 60000 }));
  return text.trim().slice(0, 40) || '（空回复）';
});
handle('settings:testASR', async () => {
  const s = settings.getSecret();
  await transcribe({ baseURL: s.asrBaseURL, apiKey: s.asrKey, model: s.asrModel, wav: silentWav(1) });
  return '语音转文字接口可用';
});
handle('data:open', () => shell.openPath(app.getPath('userData')));

handle('interviews:list', () => store.list());
handle('interviews:create', (fields) => store.create(fields));

handle('positions:list', () => positions.list());
handle('positions:save', (p) => positions.save(p));
handle('positions:remove', (id) => positions.remove(id));
handle('interviews:get', (id) => store.get(id));
handle('interviews:save', (interview) => store.save(interview));
// 删除、重新开始前的确认在界面里做（应用内确认框）。
handle('interviews:remove', (id) => {
  store.remove(id);
  return true;
});

// 重新开始面试：清空录音、转写、评估和「已问」标记，简历和面试题保留。
handle('interviews:restart', (id) => {
  fs.rmSync(path.join(store.dirOf(id), 'audio'), { recursive: true, force: true });
  fs.rmSync(path.join(store.dirOf(id), '完整录音.wav'), { force: true });
  const i = store.get(id);
  for (const q of i.plan ? i.plan.sections.flatMap((s) => s.questions) : []) { q.asked = false; delete q.askedAt; delete q.review; }
  return store.save({ id, plan: i.plan, transcript: [], dialogue: null, evaluation: null, notes: '', parts: [], audioParts: 0, audioSeconds: 0, status: i.plan ? 'ready' : 'draft' });
});

handle('resume:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: '选择简历', properties: ['openFile'], filters: [{ name: '简历', extensions: SUPPORTED.map((e) => e.slice(1)) }] });
  return canceled ? null : filePaths[0];
});
handle('resume:import', async (id, file) => {
  const text = await readResume(file);
  const resumeFile = store.saveResumeFile(id, file);
  return store.save({ id, resume: text, resumeFile, resumeName: path.basename(file) });
});

handle('plan:generate', async (id) => {
  const i = store.get(id), s = settings.getPublic();
  if (!i.resume.trim()) throw new Error('请先上传或粘贴简历。');
  const raw = await chatJSON(llmOptions({
    messages: prompts.questionMessages({ resume: i.resume, position: i.position, level: i.level, jd: i.jd, count: s.questionCount }),
    onDelta: progress(id, 'plan'),
  }));
  return store.save({ id, plan: prompts.normalizeQuestions(raw), status: i.status === 'draft' ? 'ready' : i.status });
});
handle('plan:rewrite', async (id, qid) => {
  const i = store.get(id);
  const question = i.plan.sections.flatMap((s) => s.questions).find((q) => q.id === qid);
  if (!question) throw new Error('找不到这道题。');
  const raw = await chatJSON(llmOptions({ messages: prompts.rewriteMessages({ question, resume: i.resume }), temperature: 0.7 }));
  if (raw.q) question.q = String(raw.q);
  if (Array.isArray(raw.points) && raw.points.length) question.points = raw.points.map(String);
  if (raw.follow) question.follow = String(raw.follow);
  return store.save({ id, plan: i.plan });
});

// 录音分段：保存后排队转写，结果逐段推送给界面。
// speaker：两路录音时麦克风为「面试官」、电脑声音为「候选人」；只录麦克风时为空，面试后由模型区分。
// 各段并行转写（两路录音时串行会越积越慢）；「结束面试」时等所有段转完。
const pending = new Map();
const byTime = (a, b) => a.start - b.start || a.index - b.index;
function addSegment(id, seg) {
  const i = store.get(id);
  const transcript = [...(i.transcript || []).filter((t) => t.index !== seg.index), seg].sort(byTime);
  const echo = markEcho(transcript, seg);
  // 有新内容后，之前按句区分的说话人结果作废。
  store.save({ id, transcript, dialogue: null });
  return echo;
}
async function transcribeSegment(id, part, wav) {
  const s = settings.getSecret();
  const text = part.silent ? '' : await transcribe({ baseURL: s.asrBaseURL, apiKey: s.asrKey, model: s.asrModel, wav });
  const echo = addSegment(id, { index: part.index, start: part.start, end: part.end, speaker: part.speaker || '', text, source: 'asr' });
  return { text, echo };
}
handle('audio:chunk', (id, index, startSec, arrayBuffer, meta = {}) => {
  store.saveChunk(id, index, Buffer.from(arrayBuffer));
  // 记录已录到第几段、录到第几秒，「继续录音」时接着往后编号，不覆盖已有分段。
  const seconds = startSec + (arrayBuffer.byteLength - 44) / 32000;
  const part = { index, start: startSec, end: seconds, speaker: meta.speaker || '', silent: Boolean(meta.silent) };
  const cur = store.get(id);
  store.save({ id, audioParts: Math.max(cur.audioParts || 0, index + 1), audioSeconds: Math.max(cur.audioSeconds || 0, seconds), parts: [...(cur.parts || []).filter((p) => p.index !== index), part] });
  if (!settings.getSecret().asrEnabled) return { queued: false };
  if (!pending.has(id)) pending.set(id, new Set());
  const job = (async () => {
    try {
      const { text, echo } = await transcribeSegment(id, part, Buffer.from(arrayBuffer));
      send('asr:segment', { id, ...part, text, echo });
    } catch (err) {
      send('asr:segment', { id, ...part, error: err.message });
    }
  })();
  pending.get(id).add(job);
  job.finally(() => pending.get(id).delete(job));
  return { queued: true };
});
handle('audio:finish', async (id) => {
  await Promise.all([...(pending.get(id) || [])]);
  const file = store.mergeAudio(id, store.get(id).parts);
  return { file, interview: store.save({ id, status: 'done' }) };
});
handle('audio:retry', async (id) => {
  // 重新转写失败的分段。
  const i = store.get(id), s = settings.getSecret();
  const dir = path.join(store.dirOf(id), 'audio');
  const done = new Set((i.transcript || []).filter((t) => t.source === 'asr' && t.text !== undefined).map((t) => t.index));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^part-\d+\.wav$/.test(f)) : [];
  let fixed = 0;
  for (const f of files) {
    const index = Number(f.match(/\d+/)[0]);
    if (done.has(index)) continue;
    const part = (i.parts || []).find((p) => p.index === index) || { index, start: index * s.chunkSeconds, speaker: '' };
    await transcribeSegment(id, part, fs.readFileSync(path.join(dir, f)));
    fixed++;
  }
  return { fixed, interview: store.get(id) };
});
// 面试前检查：试录一小段，确认转写服务和麦克风都正常。
handle('audio:test', async (arrayBuffer) => {
  const s = settings.getSecret();
  return transcribe({ baseURL: s.asrBaseURL, apiKey: s.asrKey, model: s.asrModel, wav: Buffer.from(arrayBuffer) });
});
// 模拟候选人说话用的朗读音频：用 GLM-TTS 合成一次后缓存，界面用选定的播放设备播放。
handle('audio:tts', async (text) => {
  const crypto = require('crypto');
  const file = path.join(app.getPath('userData'), `tts-${crypto.createHash('md5').update(text).digest('hex').slice(0, 10)}.wav`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const s = settings.getSecret();
  const wav = await synthesize({ baseURL: s.asrBaseURL, apiKey: s.asrKey, text });
  fs.writeFileSync(file, wav);
  return wav;
});
// 重新转写整场录音：之前转写失败、Key 没配好或被当成静音跳过时，用保存下来的录音补救。
handle('audio:retranscribe', async (id) => {
  const i = store.get(id), s = settings.getSecret();
  const dir = path.join(store.dirOf(id), 'audio');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^part-\d+\.wav$/.test(f)).sort() : [];
  if (!files.length) throw new Error('这场面试没有保存的录音。');
  let done = 0, failed = 0;
  for (const f of files) {
    const index = Number(f.match(/\d+/)[0]);
    const part = { ...((i.parts || []).find((p) => p.index === index) || { index, start: index * s.chunkSeconds, speaker: '' }), silent: false };
    try {
      const { text, echo } = await transcribeSegment(id, part, fs.readFileSync(path.join(dir, f)));
      send('asr:segment', { id, ...part, text, echo });
      done++;
    } catch (err) {
      send('asr:segment', { id, ...part, error: err.message });
      failed++;
    }
  }
  return { done, failed, interview: store.get(id) };
});
// 复盘：取某一段录音，界面点转写的某一句就能回放。
handle('audio:part', (id, index) => {
  const file = path.join(store.dirOf(id), 'audio', `part-${String(index).padStart(4, '0')}.wav`);
  if (!fs.existsSync(file)) throw new Error('这一段的录音不在了。');
  return fs.readFileSync(file);
});
// 面试中 AI 副驾：候选人答完一题后，看要点覆盖了哪些、给出追问建议。
handle('live:review', async (id, qid, answer) => {
  const i = store.get(id);
  const question = i.plan?.sections.flatMap((s) => s.questions).find((q) => q.id === qid);
  if (!question) throw new Error('找不到这道题。');
  const raw = await chatJSON(llmOptions({ messages: prompts.reviewMessages({ question, answer }), temperature: 0.2, timeoutMs: 60000 }));
  const review = { ...prompts.normalizeReview(raw, question.points.length), chars: answer.length, at: new Date().toISOString() };
  // 点评期间面试官可能又标了已问：重新读一遍再写，避免覆盖。
  const fresh = store.get(id), target = fresh.plan?.sections.flatMap((s) => s.questions).find((q) => q.id === qid);
  if (target) { target.review = review; store.save({ id, plan: fresh.plan }); }
  return review;
});
handle('audio:open', (id) => {
  const file = path.join(store.dirOf(id), '完整录音.wav');
  if (!fs.existsSync(file)) throw new Error('还没有完整录音，结束录音后会自动生成。');
  return shell.openPath(file);
});
handle('transcript:speakers', async (id) => {
  const i = store.get(id), sentences = prompts.splitSentences(i.transcript);
  if (!sentences.length) throw new Error('还没有转写内容。');
  const raw = await chatJSON(llmOptions({
    messages: prompts.speakerMessages({ sentences, questions: i.plan ? i.plan.sections.flatMap((s) => s.questions) : [] }),
    temperature: 0,
    onDelta: progress(id, 'speakers'),
  }));
  return store.save({ id, dialogue: prompts.buildDialogue(sentences, raw) });
});
handle('transcript:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: '导入会议转写', properties: ['openFile'], filters: [{ name: '文本', extensions: ['txt', 'md', 'srt', 'vtt'] }] });
  if (canceled) return null;
  const buffer = fs.readFileSync(filePaths[0]);
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
});

handle('eval:generate', async (id) => {
  const i = store.get(id);
  const transcript = prompts.transcriptForEval(i);
  if (transcript.replace(/\s/g, '').length < 50) throw new Error('转写内容太少，没法评估。请先录音转写，或导入会议转写文本。');
  const questions = i.plan ? i.plan.sections.flatMap((s) => s.questions) : [];
  const raw = await chatJSON(llmOptions({
    messages: prompts.evaluationMessages({ resume: i.resume, position: i.position, level: i.level, pass: i.pass, jd: i.jd, questions, transcript, notes: i.notes }),
    temperature: 0.2,
    onDelta: progress(id, 'eval'),
  }));
  return store.save({ id, evaluation: prompts.normalizeEvaluation(raw), status: 'evaluated' });
});

handle('report:export', async (id, format) => {
  const i = store.get(id);
  const base = `面试评估-${i.name || '候选人'}-${(i.createdAt || '').slice(0, 10)}`;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出评估报告',
    defaultPath: path.join(app.getPath('documents'), `${base}.${format === 'md' ? 'md' : 'pdf'}`),
    filters: format === 'md' ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  if (format === 'md') {
    fs.writeFileSync(filePath, report.toMarkdown(i));
  } else {
    const pdfWin = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(report.toHTML(i))}`);
    fs.writeFileSync(filePath, await pdfWin.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
    pdfWin.destroy();
  }
  shell.showItemInFolder(filePath);
  return filePath;
});

handle('media:askMic', async () => {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.askForMediaAccess('microphone');
});
