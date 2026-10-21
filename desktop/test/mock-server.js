'use strict';
// 模拟 OpenAI 兼容的大模型接口（流式）和智谱语音转写接口，供单元测试与端到端测试使用。
const http = require('http');

const PLAN = {
  candidate: { summary: '7 年经验，做过多 Agent 竞品分析和知识库问答', highlights: ['CarScope 多 Agent'], doubts: ['召回率口径不清'] },
  verify: [{ point: '项目时间和公司对应关系', ask: '这几个项目分别是在哪家公司做的？' }],
  sections: [
    { title: '开场热身', source: 'basic', questions: [{ q: '先简单说说你最近在做什么吧？', why: '热身', points: ['说清角色', '说清项目'], follow: '你在里面具体负责哪块？', dim: '逻辑思维', good: '先结论后细节', bad: '流水账' }] },
    { title: '项目一：CarScope', source: 'resume', questions: [
      { q: '你们那个竞品分析平台，一份报告是怎么一步步生成出来的？', why: '看是否真做过', points: ['数据从哪来', '怎么对比', '怎么出报告'], follow: '哪一步最容易出错？', dim: '专业度', good: '讲得出取舍', bad: '只报组件名' },
      { q: '要是业务说每周自动更新，只重写有新资料的章节，你会怎么改？', why: '应变', points: ['章节和资料挂钩', '只重跑受影响章节'], follow: '怎么知道哪些资料是新的？', dim: '适应力', good: '先问清楚再改', bad: '全部重新生成' } ] },
    { title: '做事方式', source: 'behavior', questions: [{ q: '最近一次主动去学新东西是什么？学完用上了吗？', why: '自驱力', points: ['有具体例子', '有结果'], follow: '是谁让你学的？', dim: '自驱力', good: '自己找的', bad: '说不出例子' }] },
  ],
};
const EVAL = {
  dimensions: [
    { name: '专业度', score: 2.5, reason: '能讲清自己的流程，设计题停在表面。', evidence: ['“我觉得可能就需要重新生成了”'], enough: true },
    { name: '自驱力', score: 3, reason: '主动学习新框架。', evidence: ['自己研究过 harness'], enough: true },
    { name: '性格特质', score: 3.5, reason: '被指出问题时坦诚接受。', evidence: ['“可以这么理解”'], enough: true },
    { name: '逻辑思维', score: 3, reason: '会分点回答。', evidence: ['“第一点…第二点…”'], enough: true },
    { name: '适应力', score: 2, reason: '条件变化后回到通用兜底。', evidence: ['“告诉用户系统繁忙”'], enough: true },
  ],
  overall: { level: '中级', verdict: '待定', summary: '项目讲得清楚，设计和应变偏弱。' },
  strengths: ['表达有条理'], risks: ['应变偏弱'], nextRound: ['问问模型微调项目'], gaps: '微调项目没问到',
};

const control = { asr: null };
function start(port = 0) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      body = Buffer.concat(body);
      calls.push({ url: req.url, auth: req.headers.authorization, body: body.toString('utf8').slice(0, 20000) });
      if (req.headers.authorization !== 'Bearer test-key') { res.writeHead(401); res.end('{"error":"bad key"}'); return; }
      if (req.url.endsWith('/audio/transcriptions')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // 测试可以用 setAsr(text) 指定识别结果（例如模拟面试官问出某道题）；不指定时返回一段候选人的回答。
        res.end(JSON.stringify({ text: control.asr ?? `第${calls.filter((c) => c.url.endsWith('/audio/transcriptions')).length}段：候选人说我觉得可能就需要重新生成了，向量库那边做一个幂等更新，有重复的证据就不再写入。` }));
        return;
      }
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
      const payload = JSON.parse(body.toString('utf8'));
      // 模拟不支持关闭思考的模型（如 GLM-5.3）：带 thinking.disabled 时报 400。
      if (payload.model === 'always-think' && payload.thinking?.type === 'disabled') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"thinking.type=disabled is not supported for this model"}}');
        return;
      }
      const prompt = payload.messages.map((m) => m.content).join('\n');
      let answer = '正常';
      if (prompt.includes('请准备大约')) answer = '```json\n' + JSON.stringify(PLAN) + '\n```';
      else if (prompt.includes('五个维度评估')) answer = JSON.stringify(EVAL);
      else if (prompt.includes('请区分说话人')) answer = JSON.stringify({ turns: [{ from: 1, to: 1, speaker: '面试官' }, { from: 2, to: 999, speaker: '候选人' }] });
      else if (prompt.includes('面试现场给面试官做助手')) answer = JSON.stringify({ covered: [true, false], level: '一般', comment: '思路对，但没说怎么判断哪些资料是新的', follow: ['你怎么知道哪些章节要重写？'] });
      else if (prompt.includes('换一种更口语')) answer = JSON.stringify({ q: '换个说法：报告是怎么生成的？', points: ['数据来源', '对比方式'], follow: '最难的一步？' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // 先发一段 reasoning_content 模拟思考模型，再分块发正文。
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '思考中' } }] })}\n\n`);
      // 长回答放慢输出，模拟真实的流式生成，便于检查边生成边显示。
      const pieces = [];
      for (let i = 0; i < answer.length; i += 50) pieces.push(answer.slice(i, i + 50));
      const delay = answer.length > 200 ? 60 : 0;
      (function next() {
        if (!pieces.length) { res.end('data: [DONE]\n\n'); return; }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces.shift() } }] })}\n\n`);
        if (delay) setTimeout(next, delay); else next();
      })();
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, calls, setAsr: (text) => { control.asr = text; }, url: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { start, PLAN, EVAL };
