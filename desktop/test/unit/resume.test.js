'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readResume } = require('../../lib/resume');

test('reads Chinese text from a PDF résumé', async () => {
  const text = await readResume(path.join(__dirname, '..', 'fixtures', 'resume.pdf'));
  assert.match(text, /王小明/);
  assert.match(text, /人工转接率下\s*降 ?35%/);
  assert.match(text, /项目二：企业知识库问答/);
});

test('reads UTF-8 and GBK text files, rejects other formats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  const content = '李四，Java 后端转大模型应用开发，做过 NL2SQL 平台和风控决策引擎，熟悉 LangGraph。';
  fs.writeFileSync(path.join(dir, 'a.txt'), content);
  assert.strictEqual(await readResume(path.join(dir, 'a.txt')), content);
  fs.writeFileSync(path.join(dir, 'b.txt'), Buffer.from(new TextEncoder().encode(content)));
  fs.writeFileSync(path.join(dir, 'c.docx'), 'x');
  await assert.rejects(readResume(path.join(dir, 'c.docx')), /只支持/);
  fs.writeFileSync(path.join(dir, 'short.txt'), '太短');
  await assert.rejects(readResume(path.join(dir, 'short.txt')), /太少/);
});
