'use strict';
// 端到端测试：启动真实的桌面应用，连接模拟的大模型 / 转写服务，走完整流程。
// 运行：xvfb-run -a node test/e2e.js   （需要 Playwright；截图输出到 $E2E_SHOTS，默认不保存）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const mock = require('./mock-server');

const ROOT = path.join(__dirname, '..');
const shots = process.env.E2E_SHOTS;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); console.log(`${ok ? '✓' : '✗'} ${message}`); };

(async () => {
  const { server, url, calls, setAsr } = await mock.start();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-e2e-'));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-export-'));
  // 虚拟麦克风的声音：1.5 秒“说话”（带起伏的音调）+ 1.2 秒安静，循环播放，用来测试说话检测和按停顿切段。
  const speech = path.join(dataDir, 'speech.wav');
  {
    const rate = 16000, on = 1.5 * rate, total = 2.7 * rate, pcm = Buffer.alloc(total * 2);
    for (let n = 0; n < on; n++) pcm.writeInt16LE(Math.round(Math.sin(n / rate * 2 * Math.PI * (220 + 80 * Math.sin(n / rate * 6))) * 9000 * (0.6 + 0.4 * Math.sin(n / rate * 9))), n * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(speech, Buffer.concat([header, pcm]));
  }
  const app = await electron.launch({
    // E2E_APP 指向打包后的可执行文件时，测试的是安装包里的应用（代码在 app.asar 中）。
    executablePath: process.env.E2E_APP || require('electron'),
    args: process.env.E2E_APP ? ['--no-sandbox', '--disable-gpu'] : ['--no-sandbox', '--disable-gpu', ROOT],
    env: { ...process.env, INTERVIEW_DATA_DIR: dataDir, INTERVIEW_FAKE_MEDIA: '1', INTERVIEW_FAKE_AUDIO: speech },
  });
  app.process().stderr.on('data', (d) => { if (process.env.E2E_VERBOSE) process.stderr.write(d); });
  app.process().stdout.on('data', (d) => { if (process.env.E2E_VERBOSE) process.stdout.write(d); });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewportSize({ width: 1320, height: 860 }).catch(() => {});
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  // 系统对话框改为直接返回测试文件路径。
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.pdf] });
    dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: `${files.out}/${opts.defaultPath.split(/[\\/]/).pop()}` });
  }, { pdf: path.join(__dirname, 'fixtures', 'resume.pdf'), out: exportDir });

  // 1. 首次启动进入设置页
  await page.waitForSelector('#settingsForm');
  check(true, 'first launch opens settings');
  await page.selectOption('select[name=provider]', 'custom');
  await page.fill('input[name=baseURL]', url);
  await page.fill('input[name=model]', 'mock-model');
  await page.fill('input[name=apiKey]', 'test-key');
  await page.uncheck('input[name=asrUseChatKey]');
  await page.fill('input[name=asrKey]', 'test-key');
  await page.fill('input[name=asrBaseURL]', url);
  await page.fill('input[name=chunkSeconds]', '10');
  await page.click('#testLLM');
  await page.waitForSelector('#testLLMResult.ok', { timeout: 15000 });
  await page.click('#testASR');
  await page.waitForSelector('#testASRResult.ok', { timeout: 15000 });
  check(true, 'connection tests pass');
  await shot('1-settings');
  await page.click('#settingsForm button[type=submit]');

  // 2. 新建面试，上传 PDF 简历，生成面试题
  await page.click('#newInterview');
  await page.waitForSelector('#drop');
  await page.fill('#nameInput', '王小明');
  await page.click('#drop');
  await page.waitForFunction(() => document.querySelector('#resumeText')?.value.includes('王小明'));
  check(true, 'PDF résumé imported');
  await shot('2-resume');
  // 2. 音频调试：面试官试录转写、模拟候选人说话并转写。
  await page.click('[data-tab-go=audio]');
  await page.waitForSelector('#audioBox #micSelect');
  await page.waitForSelector('#speak-mic.on', { timeout: 15000 });
  check(true, 'audio step: speaking detected on the microphone');
  check((await page.locator('.badge.ok').count()) === 0, 'audio step: nothing marked as passed before testing');
  // 面试官读给定的句子：转写对得上才算通过；对不上要提示。
  setAsr('今天天气不错');
  await page.click('#testMic');
  await page.waitForSelector('.side-card:first-child .lines li.mismatch', { timeout: 30000 });
  check((await page.locator('.badge.ok').count()) === 0, 'audio step: a transcript that does not match the sentence is not accepted');
  setAsr('我们先从你最近做的一个项目聊起，说说你具体负责哪一块。');
  await page.waitForSelector('.side-card:first-child .lines li.ok', { timeout: 30000 });
  check((await page.textContent('.side-card:first-child .lines li.ok')).includes('准确'), 'audio step: interviewer sentence transcribed and matched');
  await page.click('#testMic'); // 停止测试，避免和模拟候选人混在一起
  setAsr('您好我叫王小明，最近两年主要在做智能体和知识库问答的项目');
  await page.click('#simCand');
  await page.waitForSelector('.side-card:nth-child(2) .lines li.ok', { timeout: 30000 })
    .catch(async (e) => { console.log('SIM', await page.textContent('#audioBox')); throw e; });
  check((await page.locator('.badge.ok').count()) === 2, 'audio step: simulated candidate played, heard and transcribed');
  check(calls.some((c) => c.url.endsWith('/audio/speech')), 'audio step: simulated candidate voice synthesized with GLM-TTS');
  await page.click('#playTone');
  await page.waitForSelector('#toneYes', { timeout: 10000 });
  await page.click('#toneYes');
  check((await page.textContent('#audioBox')).includes('播放设备正常'), 'audio step: test tone played and confirmed');
  setAsr(null);
  await shot('2-audio');
  // 3. 生成面试题
  await page.click('[data-tab-go=plan]');
  await page.click('#genPlan');
  await page.waitForSelector('#stream-plan .q.streaming', { timeout: 30000 });
  check(true, 'questions stream in while the plan is being generated');
  await shot('3-plan-streaming');
  await page.waitForSelector('.section .q:not(.streaming)', { timeout: 30000 });
  check((await page.locator('.section .q').count()) === 4, 'plan shows 4 questions in sections');
  check((await page.textContent('.plan')).includes('竞品分析平台'), 'plan shows generated plain-language question');
  await page.locator('[data-rewrite]').nth(1).click();
  await page.waitForFunction(() => document.body.textContent.includes('换个说法：报告是怎么生成的？'));
  check(true, 'rewrite replaces a question');
  await page.locator('.section [data-ask]').first().click();
  await shot('3-plan');

  // 3. 面试中：录音约 12 秒（两段），边录边转写
  await page.click('[data-tab-go=live]');
  check((await page.textContent('.rec-note')).includes('音频已调试'), 'live page shows the audio check passed');
  await page.click('#recStart');
  await page.waitForSelector('#recStop').catch(async () => { await shot('err-live'); console.log('TOAST', await page.textContent('#toast')); });
  await page.waitForTimeout(3000);
  if (process.env.E2E_VERBOSE) console.log('REC', await page.textContent('#recTime'), await page.textContent('#recHint').catch(() => ''), await page.textContent('#toast'));
  await page.waitForFunction(() => document.querySelector('#transcript')?.textContent.includes('段：候选人说'), null, { timeout: 30000 })
    .catch(async (e) => { console.log('DEBUG', await page.textContent('#recTime'), '|', await page.textContent('#transcript'), '|', fs.readdirSync(dataDir + '/interviews').map((d) => fs.readdirSync(`${dataDir}/interviews/${d}/audio`)).join()); throw e; });
  check(true, 'first segment transcribed while recording');
  // AI 副驾：面试官问出准备好的第 3 题，自动跳到这题并标为已问；点「看看答得怎样」给出要点覆盖和追问建议。
  setAsr('好，那我换个问题：要是业务说每周自动更新，只重写有新资料的章节，你会怎么改呢？');
  await page.waitForFunction(() => document.querySelector('#liveQuestions .current h3')?.textContent.includes('每周自动更新'), null, { timeout: 30000 });
  check((await page.textContent('.q-row.on em')).includes('已问'), 'copilot: asked question recognised from the transcript and marked asked');
  setAsr(null);
  await page.waitForTimeout(4000);
  await page.click('#liveQuestions [data-review]');
  await page.waitForSelector('.copilot-comment', { timeout: 30000 });
  check((await page.locator('.points.reviewed li.hit').count()) === 1 && (await page.textContent('.copilot-follow')).includes('哪些章节'), 'copilot: answer reviewed with covered points and a follow-up');
  await shot('4-copilot');
  await page.fill('#notes', '项目讲得清楚，应变偏弱。');
  // 录到第 13 秒以后再结束，保证除了完整的第一段外还有一段收尾的录音。
  await page.waitForFunction(() => { const [m, s] = document.querySelector('#recTime').textContent.split(':').map(Number); return m * 60 + s >= 13; }, null, { timeout: 30000 });
  const currentBefore = await page.textContent('#liveQuestions .current h3');
  await page.click('[data-ask-next]');
  check((await page.textContent('#liveQuestions .current h3')) !== currentBefore && (await page.locator('.q-row.done').count()) >= 2, 'live: mark asked and move to the next unasked question');
  await shot('4-live');
  // 5. 结束面试：自动进入评估报告，先区分说话人，再流式生成评估。
  await page.click('#recStop');
  await page.waitForSelector('#stream-eval .dim-card', { timeout: 30000 });
  check(true, 'ending the interview generates the report automatically, streaming');
  await page.waitForSelector('.dim-card select', { timeout: 30000 });
  const dirs = fs.readdirSync(path.join(dataDir, 'interviews'));
  const ivDir = path.join(dataDir, 'interviews', dirs[0]);
  check(fs.existsSync(path.join(ivDir, '完整录音.wav')), 'full recording saved');
  check(fs.readdirSync(path.join(ivDir, 'audio')).length >= 2, 'recording split into segments');
  const saved = JSON.parse(fs.readFileSync(path.join(ivDir, 'interview.json'), 'utf8'));
  if (process.env.E2E_VERBOSE) console.log('SAVED', saved.transcript.length, JSON.stringify(saved.notes), saved.status);
  check(saved.transcript.length >= 2 && saved.notes.includes('应变偏弱'), 'transcript and notes persisted');
  check(fs.existsSync(path.join(ivDir, 'resume.pdf')), 'résumé file stored with the interview');
  check(saved.dialogue?.length >= 2 && saved.dialogue.some((t) => t.speaker === '候选人' && t.text.includes('候选人说')), 'interviewer and candidate separated before the evaluation');
  check(saved.audioCheck?.interviewer && saved.audioCheck?.candidate, 'audio check result stored with the interview');

  // 评估：改分、导出
  check((await page.locator('.dim-card').count()) === 5, 'five dimensions scored');
  check((await page.textContent('.verdict-panel')).includes('待定'), 'verdict shown');
  await page.selectOption('[data-score="0"]', '3');
  await page.waitForFunction(() => document.querySelector('.dim-card')?.textContent.includes('已手动调整'));
  check(true, 'manual score adjustment saved');
  await shot('5-eval');
  await page.click('#exportPdf');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('已导出'));
  await page.click('#exportMd');
  await page.waitForTimeout(500);
  const exported = fs.readdirSync(exportDir);
  const pdf = exported.find((f) => f.endsWith('.pdf')), md = exported.find((f) => f.endsWith('.md'));
  check(pdf && fs.statSync(path.join(exportDir, pdf)).size > 5000, 'PDF report exported');
  check(md && fs.readFileSync(path.join(exportDir, md), 'utf8').includes('| 专业度 | 3 |'), 'Markdown report reflects manual score');

  // 5. 面试记录列表
  await page.click('.nav [data-go=home]');
  await page.waitForSelector('.tr[data-open]');
  check((await page.textContent('.table')).includes('王小明') && (await page.textContent('.table')).includes('已评估'), 'list shows evaluated interview');
  await shot('6-home');

  // 6. 重新开始面试：打开记录，清空录音、转写和报告，简历和题目保留。
  await page.click('.tr[data-open]');
  await page.click('.steps [data-tab=live]');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  await page.click('#restartInterview');
  await page.waitForFunction(() => document.querySelector('#recStart')?.textContent.includes('开始面试') && !document.querySelector('#recStart').textContent.includes('继续'));
  const restarted = JSON.parse(fs.readFileSync(path.join(ivDir, 'interview.json'), 'utf8'));
  check(!restarted.transcript.length && !restarted.evaluation && restarted.plan && !fs.existsSync(path.join(ivDir, 'audio')) && (await page.textContent('#askedCount')).startsWith('已问 0'), 'restart clears recording, transcript and report but keeps the plan');

  const evalCall = calls.find((c) => c.body.includes('五个维度评估'));
  check(evalCall && evalCall.body.includes('应变偏弱') && evalCall.body.includes('段：候选人说') && evalCall.body.includes('候选人：'), 'evaluation prompt includes notes and the labelled transcript');
  check(errors.length === 0, `no renderer errors ${errors.join(' | ')}`);
  await app.close();
  server.close();
  if (failures.length) { console.error(`\nFAILED: ${failures.length}`); process.exit(1); }
  console.log('\nE2E passed');
})().catch((err) => { console.error(err); process.exit(1); });
