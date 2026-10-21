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

test('report renders markdown and html', () => {
  const i = { name: '张三', position: 'Agent', createdAt: '2026-10-21T08:00:00Z', notes: '<b>注意</b>', evaluation: prompts.normalizeEvaluation(mock.EVAL) };
  assert.match(report.toMarkdown(i), /\| 专业度 \| 2.5 \|/);
  const html = report.toHTML(i);
  assert.match(html, /待定/);
  assert.ok(!html.includes('<b>注意</b>'), 'notes are escaped');
});
