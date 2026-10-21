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
  const { server, url, calls } = await mock.start();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-e2e-'));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-export-'));
  const app = await electron.launch({
    // E2E_APP 指向打包后的可执行文件时，测试的是安装包里的应用（代码在 app.asar 中）。
    executablePath: process.env.E2E_APP || require('electron'),
    args: process.env.E2E_APP ? ['--no-sandbox', '--disable-gpu'] : ['--no-sandbox', '--disable-gpu', ROOT],
    env: { ...process.env, INTERVIEW_DATA_DIR: dataDir, INTERVIEW_FAKE_MEDIA: '1' },
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
  await page.click('#genPlan');
  await page.waitForSelector('.section .q', { timeout: 30000 });
  check((await page.locator('.section .q').count()) === 4, 'plan shows 4 questions in sections');
  check((await page.textContent('.plan')).includes('竞品分析平台'), 'plan shows generated plain-language question');
  await page.locator('[data-rewrite]').nth(1).click();
  await page.waitForFunction(() => document.body.textContent.includes('换个说法：报告是怎么生成的？'));
  check(true, 'rewrite replaces a question');
  await page.locator('.section [data-ask]').first().click();
  await shot('3-plan');

  // 3. 面试中：录音约 12 秒（两段），边录边转写
  await page.click('[data-tab-go=live]');
  await page.click('#recStart');
  await page.waitForSelector('#recStop').catch(async () => { await shot('err-live'); console.log('TOAST', await page.textContent('#toast')); });
  await page.waitForTimeout(3000);
  if (process.env.E2E_VERBOSE) console.log('REC', await page.textContent('#recTime'), await page.textContent('#recHint').catch(() => ''), await page.textContent('#toast'));
  await page.waitForFunction(() => document.querySelector('#transcript')?.textContent.includes('段：候选人说'), null, { timeout: 30000 })
    .catch(async (e) => { console.log('DEBUG', await page.textContent('#recTime'), '|', await page.textContent('#transcript'), '|', fs.readdirSync(dataDir + '/interviews').map((d) => fs.readdirSync(`${dataDir}/interviews/${d}/audio`)).join()); throw e; });
  check(true, 'first segment transcribed while recording');
  await page.fill('#notes', '项目讲得清楚，应变偏弱。');
  // 录到第 13 秒以后再结束，保证除了完整的第一段外还有一段收尾的录音。
  await page.waitForFunction(() => { const [m, s] = document.querySelector('#recTime').textContent.split(':').map(Number); return m * 60 + s >= 13; }, null, { timeout: 30000 });
  await shot('4-live');
  await page.click('#recStop');
  await page.waitForSelector('#recStart', { timeout: 30000 });
  const dirs = fs.readdirSync(path.join(dataDir, 'interviews'));
  const ivDir = path.join(dataDir, 'interviews', dirs[0]);
  check(fs.existsSync(path.join(ivDir, '完整录音.wav')), 'full recording saved');
  check(fs.readdirSync(path.join(ivDir, 'audio')).length >= 2, 'recording split into segments');
  const saved = JSON.parse(fs.readFileSync(path.join(ivDir, 'interview.json'), 'utf8'));
  if (process.env.E2E_VERBOSE) console.log('SAVED', saved.transcript.length, JSON.stringify(saved.notes), saved.status);
  check(saved.transcript.length >= 2 && saved.notes.includes('应变偏弱'), 'transcript and notes persisted');
  check(fs.existsSync(path.join(ivDir, 'resume.pdf')), 'résumé file stored with the interview');
  // 面试题：当前题「已问，下一题」；转写：区分面试官 / 候选人。
  const askedBefore = await page.textContent('#askedCount');
  await page.click('[data-ask-next]');
  check((await page.textContent('#askedCount')) !== askedBefore && (await page.locator('.q-row.done').count()) >= 2, 'live: mark asked and move to next question');
  await page.click('#splitSpeakers');
  await page.waitForSelector('.turn.them', { timeout: 30000 });
  check((await page.locator('.turn.me').count()) === 1 && (await page.textContent('.turn.them')).includes('候选人说'), 'transcript split into interviewer and candidate');
  await shot('4-live-speakers');

  // 4. 评估、改分、导出
  await page.click('.steps [data-tab=eval]');
  await page.click('#genEval').catch(async (e) => { await shot('err-eval'); console.log('EVALBTN', await page.textContent('#tabBody')); throw e; });
  await page.waitForSelector('.dim-card', { timeout: 30000 });
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

  const evalCall = calls.find((c) => c.body.includes('五个维度评估'));
  check(evalCall && evalCall.body.includes('应变偏弱') && evalCall.body.includes('段：候选人说') && evalCall.body.includes('候选人：'), 'evaluation prompt includes notes and the labelled transcript');
  check(errors.length === 0, `no renderer errors ${errors.join(' | ')}`);
  await app.close();
  server.close();
  if (failures.length) { console.error(`\nFAILED: ${failures.length}`); process.exit(1); }
  console.log('\nE2E passed');
})().catch((err) => { console.error(err); process.exit(1); });
