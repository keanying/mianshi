'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('../mock-server');
const { chat, chatJSON, extractJSON } = require('../../lib/llm');
const { transcribe, silentWav } = require('../../lib/asr');
const prompts = require('../../lib/prompts');
const { createStore } = require('../../lib/store');
const { createSettings } = require('../../lib/settings');
const report = require('../../lib/report');

test('extractJSON handles fences, prose and trailing commas', () => {
  assert.deepStrictEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepStrictEqual(extractJSON('好的，结果如下：{"a":[1,2,],}谢谢'), { a: [1, 2] });
  assert.throws(() => extractJSON('没有 JSON'));
});

test('chat streams content, ignores reasoning, reports progress', async () => {
  const { server, url } = await mock.start();
  const seen = [];
  const text = await chat({ baseURL: url, apiKey: 'test-key', model: 'm', messages: [{ role: 'user', content: 'hi' }], onDelta: (p) => seen.push(p) });
  assert.strictEqual(text, '正常');
  assert.ok(seen.some((p) => p.thinking));
  await assert.rejects(chat({ baseURL: url, apiKey: 'wrong', model: 'm', messages: [] }), /API Key 无效/);
  await assert.rejects(chat({ baseURL: url, apiKey: '', model: 'm', messages: [] }), /API Key/);
  server.close();
});

test('chat asks to turn thinking off and falls back when the model refuses', async () => {
  const { server, url, calls } = await mock.start();
  const base = { baseURL: url, apiKey: 'test-key', messages: [{ role: 'user', content: 'hi' }] };
  assert.strictEqual(await chat({ ...base, model: 'm', thinking: false }), '正常');
  assert.deepStrictEqual(JSON.parse(calls.at(-1).body).thinking, { type: 'disabled' });
  assert.strictEqual(await chat({ ...base, model: 'always-think', thinking: false }), '正常');
  assert.strictEqual(JSON.parse(calls.at(-1).body).thinking, undefined, 'retried without the thinking parameter');
  await chat({ ...base, model: 'm', thinking: true });
  assert.strictEqual(JSON.parse(calls.at(-1).body).thinking, undefined, 'thinking on sends no parameter');
  server.close();
});

test('question generation round trip produces normalized plan', async () => {
  const { server, url, calls } = await mock.start();
  const raw = await chatJSON({ baseURL: url, apiKey: 'test-key', model: 'm', messages: prompts.questionMessages({ resume: '简历内容', position: 'Agent 开发', count: 20 }) });
  const plan = prompts.normalizeQuestions(raw);
  assert.strictEqual(plan.sections.length, 3);
  assert.ok(plan.sections.every((s) => s.questions.every((q) => q.id && prompts.DIMENSIONS.includes(q.dim) && q.asked === false)));
  assert.match(calls[0].body, /大白话/);
  assert.match(calls[0].body, /岗位画像 profile/);
  assert.match(calls[0].body, /技术框架 tech/);
  assert.strictEqual(prompts.normalizeQuestions({ sections: [{ title: '基础', source: 'basic', questions: [{ q: '题' }] }] }).sections[0].source, 'tech', 'old basic sections count as tech');
  server.close();
});

test('evaluation normalization clamps scores and fills missing dimensions', () => {
  const e = prompts.normalizeEvaluation({ dimensions: [{ name: '专业度', score: 7 }, { name: '自驱力', score: 2.26 }], overall: { verdict: '随便' } });
  assert.deepStrictEqual(e.dimensions.map((d) => d.name), prompts.DIMENSIONS);
  assert.strictEqual(e.dimensions[0].score, 5);
  assert.strictEqual(e.dimensions[1].score, 2.5);
  assert.strictEqual(e.dimensions[2].enough, false);
  assert.strictEqual(e.overall.verdict, '待定');
});

test('transcribe uploads wav as multipart and reads text', async () => {
  const { server, url, calls } = await mock.start();
  const text = await transcribe({ baseURL: url, apiKey: 'test-key', model: 'glm-asr-2512', wav: silentWav(1) });
  assert.match(text, /第1段/);
  assert.match(calls[0].body, /name="model"\r\n\r\nglm-asr-2512/);
  assert.match(calls[0].body, /filename="segment.wav"/);
  server.close();
});

test('store keeps interviews, merges audio parts, lists summaries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-'));
  const store = createStore(dir);
  const i = store.create({ name: '张三' });
  store.save({ id: i.id, notes: '笔记' });
  assert.strictEqual(store.get(i.id).name, '张三');
  assert.strictEqual(store.get(i.id).notes, '笔记');
  store.saveChunk(i.id, 0, silentWav(1));
  store.saveChunk(i.id, 1, silentWav(2));
  const merged = fs.readFileSync(store.mergeAudio(i.id));
  assert.strictEqual(merged.readUInt32LE(40), 3 * 16000 * 2);
  store.save({ id: i.id, evaluation: prompts.normalizeEvaluation(mock.EVAL) });
  assert.strictEqual(store.list()[0].average, 2.8);
  assert.throws(() => store.get('../etc'));
});

test('settings never return the key in plain text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const fake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from([...s].reverse().join('')), decryptString: (b) => [...b.toString()].reverse().join('') };
  const s = createSettings(dir, fake);
  s.save({ apiKey: 'sk-secret-1234', provider: 'deepseek' });
  assert.match(s.getPublic().apiKeyHint, /1234/);
  assert.ok(!JSON.stringify(s.getPublic()).includes('sk-secret'));
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('sk-secret'));
  assert.strictEqual(s.getSecret().apiKey, 'sk-secret-1234');
  assert.strictEqual(s.getSecret().asrKey, 'sk-secret-1234');
  s.save({ apiKey: '' });
  assert.strictEqual(s.getSecret().apiKey, 'sk-secret-1234', 'empty input keeps the saved key');
  assert.strictEqual(s.getSecret().thinking, false, 'thinking is off by default');
  s.save({ model: 'deepseek-chat' });
  assert.strictEqual(s.getPublic().model, 'deepseek-v4-pro', 'retired DeepSeek model names are migrated');
});

test('speaker split keeps the text and labels each turn', () => {
  const transcript = [
    { index: 0, start: 0, text: '先简单说说你最近在做什么吧？我最近在做一个多 Agent 的竞品分析平台。主要负责检索那块。' },
    { index: 1, start: 25, text: '检索怎么做的？' },
  ];
  const sentences = prompts.splitSentences(transcript);
  assert.strictEqual(sentences.length, 4);
  const messages = prompts.speakerMessages({ sentences, questions: [{ q: '先简单说说你最近在做什么吧？' }] });
  assert.match(messages[1].content, /4\. 检索怎么做的？/);
  const dialogue = prompts.buildDialogue(sentences, { turns: [{ from: 1, to: 1, speaker: '面试官' }, { from: 2, to: 3, speaker: '候选人' }, { from: 4, to: 4, speaker: '面试官' }] });
  assert.deepStrictEqual(dialogue.map((t) => t.speaker), ['面试官', '候选人', '面试官']);
  assert.strictEqual(dialogue.map((t) => t.text).join(''), transcript.map((t) => t.text).join(''), 'text is kept verbatim');
  assert.match(prompts.transcriptForEval({ dialogue }), /^面试官：先简单说说/);
  // 两路录音自带说话人，不需要模型区分。
  assert.strictEqual(prompts.transcriptForEval({ transcript: [{ text: '你好', speaker: '面试官' }, { text: '', speaker: '候选人' }, { text: '您好', speaker: '候选人' }] }), '面试官：你好\n候选人：您好');
});

test('two-track recording is mixed back onto one timeline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-'));
  const store = createStore(dir);
  const iv = store.create({ name: 'x' });
  const wav = (samples) => { const b = Buffer.alloc(44 + samples.length * 2); samples.forEach((v, k) => b.writeInt16LE(v, 44 + k * 2)); return b; };
  store.saveChunk(iv.id, 0, wav(new Array(16000).fill(100)));          // 面试官 0~1 秒
  store.saveChunk(iv.id, 1, wav(new Array(16000).fill(200)));          // 候选人 0.5~1.5 秒
  const file = store.mergeAudio(iv.id, [{ index: 0, start: 0, speaker: '面试官' }, { index: 1, start: 0.5, speaker: '候选人' }]);
  const pcm = fs.readFileSync(file).subarray(44);
  assert.strictEqual(pcm.length / 2, 24000, '1.5 seconds long');
  assert.deepStrictEqual([pcm.readInt16LE(0), pcm.readInt16LE(12000 * 2), pcm.readInt16LE(20000 * 2)], [100, 300, 200]);
});

test('partial JSON from a stream is parsed as far as it goes', () => {
  const { parsePartialJSON } = require('../../src/partial-json');
  const full = JSON.stringify({ candidate: { summary: '7 年经验' }, sections: [{ title: '开场热身', questions: [{ q: '先说说你最近在做什么？', points: ['角色', '项目'] }, { q: '第二题' }] }] });
  assert.deepStrictEqual(parsePartialJSON('```json\n' + full + '\n```'), JSON.parse(full));
  const cut = full.indexOf('第二题') + 2; // 第二题只收到一半
  assert.strictEqual(parsePartialJSON(full.slice(0, cut)).sections[0].questions[1].q, '第二');
  for (let n = 20; n < full.length; n++) assert.ok(parsePartialJSON(full.slice(0, n)), `parses a prefix of length ${n}`);
  assert.strictEqual(parsePartialJSON('还没开始'), null);
});

test('text matching: transcription check, question recognition, echo, rhythm', () => {
  const { coverage, matchQuestion, markEcho, rhythm } = require('../../src/text-match');
  assert.ok(coverage('您好，我叫王小明。', '你好我叫王小明') > 0.8);
  assert.ok(coverage('您好，我叫王小明。', '今天天气不错') < 0.2);
  const qs = [{ q: '先简单说说你最近在做什么吧？' }, { q: '你们那个竞品分析平台，一份报告是怎么一步步生成出来的？' }];
  assert.strictEqual(matchQuestion('那个竞品分析平台的报告是怎么生成的呢', qs).q, qs[1]);
  assert.strictEqual(matchQuestion('我觉得还行吧', qs), null);
  // 面试官麦克风录到了扬声器里候选人的声音：同时间、同内容的那句标为串音。
  const tr = [{ index: 1, start: 50, end: 58, speaker: '候选人', text: '加一块牛肉，那是一张小熊的较量。' }, { index: 2, start: 50.3, end: 58, speaker: '面试官', text: '加一块牛肉，拿谁像来小熊的较量。' }, { index: 3, start: 60, end: 62, speaker: '面试官', text: '好的，下一个问题。' }];
  assert.deepStrictEqual(markEcho(tr, tr[1]), [2]);
  assert.ok(tr[1].echo && !tr[0].echo && !markEcho(tr, tr[2]).length);
  const r = rhythm([{ start: 0, end: 4, speaker: '面试官', text: '问' }, { start: 8, end: 20, speaker: '候选人', text: '答' }, { start: 21, end: 24, speaker: '面试官', text: '问' }, { start: 28, end: 40, speaker: '候选人', text: '答' }, { start: 41, end: 44, speaker: '面试官', text: '问' }, { start: 48.5, end: 60, speaker: '候选人', text: '答' }]);
  assert.ok(r.steady && Math.abs(r.avg - 4.17) < 0.01 && r.share > 0.7);
});

test('live review output is normalized', () => {
  assert.deepStrictEqual(prompts.normalizeReview({ covered: [true, 'yes'], level: '很好', credible: '存疑', fit: '高高', follow: ['追问一', '', '追问二', '追问三'] }, 3),
    { covered: [true, false, false], level: '一般', comment: '', sound: '', soundNote: '', credible: '存疑', credibleNote: '', fit: '', fitNote: '', next: '追问', follow: ['追问一', '追问二'] });
  const m = prompts.reviewMessages({ question: { q: '题', points: ['a', 'b'] }, answer: '回答', level: '中级', skills: 'Python', history: [{ q: '上一题', level: '弱', credible: '存疑', comment: '没细节' }] });
  assert.match(m[1].content, /1\. a\n2\. b/);
  assert.match(m[1].content, /目标级别：中级/);
  assert.match(m[1].content, /上一题 → 弱，存疑：没细节/);
  assert.match(m[0].content, /合理性[\s\S]*可信度[\s\S]*级别匹配/);
});

test('speech synthesis returns a wav for the simulated candidate', async () => {
  const { synthesize } = require('../../lib/asr');
  const { server, url, calls } = await mock.start();
  const wav = await synthesize({ baseURL: url, apiKey: 'test-key', text: '您好' });
  assert.strictEqual(wav.subarray(0, 4).toString(), 'RIFF');
  assert.deepStrictEqual(JSON.parse(calls.at(-1).body), { model: 'glm-tts', input: '您好', voice: 'female', response_format: 'wav' });
  server.close();
});

test('noise-only ASR output counts as silence', async () => {
  const { server, url, setAsr } = await mock.start();
  setAsr('#');
  assert.strictEqual(await transcribe({ baseURL: url, apiKey: 'test-key', model: 'm', wav: silentWav(1) }), '');
  setAsr(null);
  server.close();
});

test('report renders markdown and html', () => {
  const i = { name: '张三', position: 'Agent', createdAt: '2026-10-21T08:00:00Z', notes: '<b>注意</b>', evaluation: prompts.normalizeEvaluation(mock.EVAL) };
  assert.match(report.toMarkdown(i), /\| 专业度 \| 2.5 \|/);
  const html = report.toHTML(i);
  assert.match(html, /待定/);
  assert.ok(!html.includes('<b>注意</b>'), 'notes are escaped');
});

test('positions: save, normalise level and pass lines, remove', () => {
  const { createPositions } = require('../../lib/positions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-'));
  const positions = createPositions(dir);
  const p = positions.save({ title: ' 智能体开发工程师 ', level: '高级', jd: 'RAG', pass: { average: 3.74, dims: { 专业度: 9 } } });
  assert.strictEqual(p.title, '智能体开发工程师');
  assert.strictEqual(p.pass.average, 3.5);
  assert.strictEqual(p.pass.dims.专业度, 5);
  assert.strictEqual(p.pass.dims.自驱力, 3, 'missing dimension falls back to the level default');
  const q = positions.save({ ...p, level: '不存在', title: '改名' });
  assert.strictEqual(q.id, p.id);
  assert.strictEqual(q.level, '中级');
  assert.strictEqual(positions.list().length, 1);
  positions.remove(p.id);
  assert.deepStrictEqual(positions.list(), []);
});

test('levels: pass judgement checks the average and every dimension', () => {
  const { judge, defaultPass } = require('../../src/levels');
  const pass = defaultPass('中级');
  const ev = (scores) => ({ dimensions: ['专业度', '自驱力', '性格特质', '逻辑思维', '适应力'].map((name, k) => ({ name, score: scores[k] })) });
  assert.strictEqual(judge(ev([3, 3, 3, 3, 3]), pass).passed, true);
  const low = judge(ev([2.5, 4, 4, 4, 4]), pass);
  assert.strictEqual(low.passed, false);
  assert.deepStrictEqual(low.fails, [{ name: '专业度', score: 2.5, need: 3 }]);
  assert.strictEqual(judge(ev([3, 2.5, 2.5, 3, 2.5]), pass).averageOk, false);
  assert.strictEqual(judge(null, pass), null);
});

test('prompts carry the target level and pass line', () => {
  const { defaultPass } = require('../../src/levels');
  const q = prompts.questionMessages({ resume: '简历', position: '智能体开发', level: '资深', jd: '' })[1].content;
  assert.match(q, /目标级别：资深/);
  const e = prompts.evaluationMessages({ resume: '', position: 'x', level: '中级', pass: defaultPass('中级'), transcript: '转写' })[1].content;
  assert.match(e, /达标线：五项平均不低于 3/);
  assert.match(e, /专业度 3/);
  assert.strictEqual(prompts.normalizeEvaluation({ overall: { level: '专家' } }).overall.level, '专家');
});

test('questions are ordered hardest first: warm-up, gate, then by difficulty, behaviour last', () => {
  const q = (text, difficulty) => ({ q: text, difficulty });
  const plan = prompts.normalizeQuestions({ sections: [
    { title: '做事方式', source: 'behavior', questions: [q('b', '难')] },
    { title: '项目', source: 'resume', questions: [q('r1', '易'), q('r2', '中')] },
    { title: '技术', source: 'tech', questions: [q('t1', '难')] },
    { title: '门槛题', source: 'gate', questions: [q('g1', '中'), q('g2', '难')] },
    { title: '开场', source: 'warmup', questions: [q('w', '易')] },
  ] });
  assert.deepStrictEqual(plan.sections.map((x) => x.title), ['开场', '门槛题', '技术', '项目', '做事方式']);
  assert.deepStrictEqual(plan.sections[1].questions.map((x) => x.q), ['g2', 'g1']);
  assert.deepStrictEqual(plan.sections[3].questions.map((x) => x.q), ['r2', 'r1']);
  assert.strictEqual(plan.sections[1].questions[0].minutes, 3);
});

test('question angles: techs from skills first, random per generation, avoid list passed to the model', () => {
  const { pickAngles } = require('../../lib/angles');
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const a = pickAngles({ skills: 'Python、FastAPI', jd: '', resume: '用 Milvus 做了 RAG 知识库，Redis 缓存' }, rand);
  assert.deepStrictEqual(a.techs.slice(0, 2).map((t) => t.name), ['Python', 'FastAPI']);
  assert.ok(a.techs.some((t) => t.name === 'RAG / 检索') && a.techs.some((t) => t.name === 'Redis / 缓存'));
  assert.strictEqual(a.techs[0].angles.length, 4);
  assert.strictEqual(new Set(a.project).size, 6);
  const b = pickAngles({ skills: 'Python、FastAPI', jd: '', resume: '用 Milvus 做了 RAG 知识库，Redis 缓存' }, rand);
  assert.notDeepStrictEqual(a.techs[0].angles, b.techs[0].angles, 'a second generation picks different angles');
  assert.deepStrictEqual(pickAngles({ resume: '做过销售' }, rand).techs, []);
  const m = prompts.questionMessages({ resume: '简历', position: 'x', skills: 'Python', angles: a, avoid: ['上次问过的题'] })[1].content;
  assert.match(m, /【Python】/);
  assert.match(m, /上次问过的题/);
  assert.match(m, /basis/);
  assert.doesNotMatch(m, /比如 Python 的并发、生成器、装饰器/);
  assert.strictEqual(prompts.normalizeQuestions({ sections: [{ title: 't', source: 'tech', questions: [{ q: '题', basis: '简历：Milvus' }] }] }).sections[0].questions[0].basis, '简历：Milvus');
});
