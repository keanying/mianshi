'use strict';
// 提示词：出题、改写、评估。所有给面试官看的文字都要求大白话。

const DIMENSIONS = ['专业度', '自驱力', '性格特质', '逻辑思维', '适应力'];

const DIMENSION_GUIDE = `五个评估维度：
- 专业度：做过的事是否真懂，原理、取舍、踩过的坑能不能说清楚。
- 自驱力：有没有主动找事做、主动学、主动推动，而不是等安排。
- 性格特质：沟通方式、合作态度、面对压力和分歧时的表现、是否坦诚。
- 逻辑思维：回答有没有条理，能不能先说结论再说原因，数字和因果是否对得上。
- 适应力：条件变了、遇到没见过的问题时，能不能想出办法并说清为什么。`;

const PLAIN_RULES = `出题必须用大白话，像面对面聊天那样问：
1. 一句话只问一件事，尽量不超过 40 个字。
2. 不用书面腔：不要“请阐述”“请论述”“谈谈你对……的理解”“如何保证……的……性”。
3. 专业名词可以保留（比如 RAG、Redis），但整句话要像平时说话；如果名词偏冷门，用括号补一句白话解释。
4. 简历里的内容要具体点名（项目名、数字、做法），让候选人一听就知道问的是哪件事。
5. “回答要点”也写成大白话，面试官扫一眼就知道好回答应该提到什么。

反例 → 正例：
✗ 请阐述你在项目中对检索增强生成召回率优化的技术方案。
✓ 你们那个知识库问答，一开始老是找不到对的资料，后来是怎么改好的？
✗ 谈谈你对团队协作的理解。
✓ 你和同事意见不一样的时候，最后一般是怎么定下来的？举个例子。
✗ 如何保证分布式任务执行的幂等性？
✓ 同一个任务要是被执行了两次，会出什么事？你们是怎么防的？`;

const QUESTION_SCHEMA = `只输出一个 JSON 对象，不要任何解释，格式如下：
{
  "candidate": {
    "summary": "一句话说清这个人：几年经验、主要做什么",
    "highlights": ["值得深挖的亮点，2~4 条"],
    "doubts": ["简历里需要核实或看起来存疑的地方，0~4 条"]
  },
  "verify": [ { "point": "要核实的事", "ask": "开场怎么问（大白话）" } ],
  "sections": [
    {
      "title": "分组标题，例如：开场热身 / 项目一：XXX / 基础能力 / 做事方式",
      "source": "basic 或 resume 或 behavior",
      "questions": [
        {
          "q": "问题（大白话）",
          "why": "这题想了解什么（一句话）",
          "points": ["好回答应该提到的点，2~4 条，大白话"],
          "follow": "对方答完后可以追问的一句",
          "dim": "专业度 | 自驱力 | 性格特质 | 逻辑思维 | 适应力 之一",
          "good": "听到什么说明不错",
          "bad": "听到什么要警惕"
        }
      ]
    }
  ]
}`;

function questionMessages({ resume, position, jd, count = 20 }) {
  const basic = Math.max(3, Math.round(count * 0.25));
  const behavior = Math.max(3, Math.round(count * 0.2));
  const fromResume = Math.max(4, count - basic - behavior);
  return [
    {
      role: 'system',
      content: `你是一位经验丰富、说话接地气的面试官助手，帮面试官准备面试问题。\n\n${DIMENSION_GUIDE}\n\n${PLAIN_RULES}`,
    },
    {
      role: 'user',
      content: `应聘岗位：${position || '未填写'}\n岗位要求：${jd || '未填写，按岗位名称推断'}\n\n候选人简历（可能由 PDF 转出，排版可能有点乱）：\n"""\n${resume}\n"""\n\n请准备大约 ${count} 道面试题：
- 简历题约 ${fromResume} 道：按简历里的项目或经历分组，每组 2~4 道，先让对方讲清楚做了什么，再问具体做法和原因，最后问“如果条件变了怎么办”。
- 基础题约 ${basic} 道：岗位必备的基础知识，结合岗位要求出，同样用大白话。
- 做事方式题约 ${behavior} 道：考自驱力、性格特质、适应力，要求对方举真实例子。
五个维度都要有题覆盖。分组顺序：开场热身（1~2 道，轻松话题）→ 简历题 → 基础题 → 做事方式题。
输出前自查：每道题都像当面聊天时会说的话吗？有书面腔就改掉。\n\n${QUESTION_SCHEMA}`,
    },
  ];
}

function rewriteMessages({ question, resume }) {
  return [
    { role: 'system', content: `你帮面试官把面试题改得更口语、更好问。\n\n${PLAIN_RULES}` },
    {
      role: 'user',
      content: `原题：${question.q}\n这题想了解：${question.why || ''}\n${resume ? `候选人简历摘要（供参考）：\n${resume.slice(0, 1500)}\n` : ''}\n请换一种更口语、更具体的问法，考察目的不变。只输出 JSON：{"q":"新问法","points":["好回答应该提到的点，2~4 条"],"follow":"追问一句"}`,
    },
  ];
}

const EVAL_SCHEMA = `只输出一个 JSON 对象，不要任何解释，格式如下：
{
  "dimensions": [
    { "name": "专业度", "score": 0到5的数字（可以是 .5）, "reason": "为什么给这个分（大白话，2~3 句）", "evidence": ["候选人原话或具体表现，1~3 条"], "enough": true 或 false（证据是否足够） }
    // 五个维度都要有，顺序：专业度、自驱力、性格特质、逻辑思维、适应力
  ],
  "overall": {
    "level": "初级 | 中级 | 高级 | 资深",
    "verdict": "强烈推荐 | 推荐 | 待定 | 不推荐",
    "summary": "整体评价，3~5 句大白话"
  },
  "strengths": ["优点，2~4 条"],
  "risks": ["风险或短板，2~4 条"],
  "nextRound": ["下一轮建议重点追问的问题（大白话），2~4 条"],
  "gaps": "这场面试没覆盖到、证据不足的地方（没有就写“无”）"
}`;

const SCORE_GUIDE = `打分标准（0~5）：
0 = 完全没有体现或严重不符；1 = 明显不足；2 = 偏弱，说不清或需要反复引导；3 = 合格，能说清主线；4 = 良好，有自己的思考和实际证据；5 = 优秀，讲得透、能举一反三。
要求：
- 每个分数都要有候选人原话或具体表现做依据；转写里没有依据的维度，不要凭简历猜，标 enough=false 并保守给分（一般不高于 2.5），在 reason 里说明。
- 转写是语音识别结果，可能有错别字。标了「面试官：」「候选人：」的按标注理解，只依据候选人说的话打分；没标注的根据上下文判断哪些是候选人说的。
- 评价要具体，不要空话套话。`;

function evaluationMessages({ resume, position, jd, questions, transcript, notes }) {
  const askedList = (questions || []).filter((q) => q.asked).map((q) => `- ${q.q}`).join('\n');
  return [
    {
      role: 'system',
      content: `你是一位客观、严格、说话直白的面试评估助手，根据面试录音转写评估候选人。\n\n${DIMENSION_GUIDE}\n\n${SCORE_GUIDE}`,
    },
    {
      role: 'user',
      content: `应聘岗位：${position || '未填写'}\n岗位要求：${jd || '未填写'}\n\n简历（供对照，不能代替面试表现）：\n"""\n${(resume || '').slice(0, 8000)}\n"""\n\n${askedList ? `面试官标记为已问的题：\n${askedList}\n\n` : ''}${notes ? `面试官现场笔记：\n${notes}\n\n` : ''}面试转写：\n"""\n${transcript}\n"""\n\n请按五个维度评估这位候选人。\n\n${EVAL_SCHEMA}`,
    },
  ];
}

// ---------- 区分说话人 ----------
// 只录了一路麦克风（面对面面试）或导入的转写没有说话人时，把文字切成句子编号交给模型，
// 模型只回答每句是谁说的，文字本身原样保留，不让模型改写。
const SPEAKERS = ['面试官', '候选人'];

function splitSentences(transcript) {
  const out = [];
  for (const t of transcript || []) {
    const text = String(t.text || '').trim();
    if (!text || t.echo) continue;
    const parts = text.match(/[^。！？!?；;\n]+[。！？!?；;]*/g) || [text];
    for (let p of parts) {
      p = p.trim();
      // 没有标点的长句再按逗号切开，避免一句话里混着两个人。
      while (p.length > 80) {
        const cut = Math.max(p.lastIndexOf('，', 80), p.lastIndexOf(',', 80));
        const at = cut > 20 ? cut + 1 : 80;
        out.push({ text: p.slice(0, at), speaker: t.speaker || '' });
        p = p.slice(at).trim();
      }
      if (p) out.push({ text: p, speaker: t.speaker || '' });
    }
  }
  return out;
}

function speakerMessages({ sentences, questions }) {
  const list = sentences.map((s, k) => `${k + 1}. ${s.speaker ? `[${s.speaker}] ` : ''}${s.text}`).join('\n');
  const planned = (questions || []).slice(0, 40).map((q) => `- ${q.q}`).join('\n');
  return [
    { role: 'system', content: '你在整理面试录音的转写稿，判断每一句是面试官说的还是候选人说的。面试官通常提问、追问、介绍流程；候选人通常回答、讲自己的经历和项目。只输出 JSON。' },
    {
      role: 'user',
      content: `${planned ? `面试官准备的问题（面试官大概率会这样问）：\n${planned}\n\n` : ''}转写稿已按句编号（方括号里是已知的说话人，照抄即可）：\n"""\n${list}\n"""\n\n请区分说话人：把连续同一个人说的句子归成一段，按顺序覆盖第 1 句到第 ${sentences.length} 句，不要遗漏、不要重叠。只输出：\n{"turns": [{"from": 1, "to": 3, "speaker": "面试官"}, {"from": 4, "to": 9, "speaker": "候选人"}]}`,
    },
  ];
}

// 按模型给出的区间给每句定说话人，缺的沿用上一句；再把连续同一人的句子合成一段。
function buildDialogue(sentences, raw) {
  const who = new Array(sentences.length).fill('');
  for (const t of Array.isArray(raw?.turns) ? raw.turns : []) {
    if (!SPEAKERS.includes(t.speaker)) continue;
    const from = Math.max(1, Number(t.from) || 0), to = Math.min(sentences.length, Number(t.to) || 0);
    for (let n = from; n <= to; n++) who[n - 1] = t.speaker;
  }
  const turns = [];
  sentences.forEach((s, k) => {
    const last = turns.at(-1);
    const speaker = s.speaker || who[k] || last?.speaker || '面试官';
    if (last && last.speaker === speaker) last.text += s.text;
    else turns.push({ speaker, text: s.text });
  });
  return turns;
}

// 送去评估的转写：优先用区分好说话人的对话，其次用分路录音自带的说话人，最后才是原始文字。
function transcriptForEval(i) {
  if (i.dialogue?.length) return i.dialogue.map((t) => `${t.speaker}：${t.text}`).join('\n');
  const segs = (i.transcript || []).filter((t) => t.text && !t.echo);
  if (segs.some((t) => t.speaker)) return segs.map((t) => (t.speaker ? `${t.speaker}：${t.text}` : t.text)).join('\n');
  return segs.map((t) => t.text).join('\n');
}

// ---------- 面试中 AI 副驾 ----------
// 候选人答完一题：对照回答要点看覆盖了哪些，给一句点评和 1~2 个追问。要快，所以输出很短。
function reviewMessages({ question, answer }) {
  return [
    { role: 'system', content: `你在面试现场给面试官做助手。根据候选人刚才的回答（语音转写，可能有错字），快速判断这道题答得怎样。说大白话，简短。只输出 JSON。` },
    {
      role: 'user',
      content: `题目：${question.q}\n回答要点：\n${question.points.map((p, k) => `${k + 1}. ${p}`).join('\n')}\n${question.follow ? `准备好的追问：${question.follow}\n` : ''}\n候选人的回答：\n"""\n${String(answer).slice(-3000)}\n"""\n\n只输出：{"covered": [每条要点是否答到，true/false，顺序同上], "level": "好 | 一般 | 弱", "comment": "一句话点评（不超过 40 字）", "follow": ["建议马上追问的一句话（大白话），1~2 条"]}`,
    },
  ];
}
function normalizeReview(raw, pointCount) {
  const covered = Array.from({ length: pointCount }, (_, k) => raw?.covered?.[k] === true);
  return {
    covered,
    level: ['好', '一般', '弱'].includes(raw?.level) ? raw.level : '一般',
    comment: String(raw?.comment || '').slice(0, 80),
    follow: (Array.isArray(raw?.follow) ? raw.follow : []).map(String).filter(Boolean).slice(0, 2),
  };
}

// 把模型输出整理成稳定结构，缺字段时补默认值，分数限制在 0~5、步长 0.5。
function normalizeQuestions(raw) {
  const clampDim = (d) => (DIMENSIONS.includes(d) ? d : '专业度');
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).map((s, si) => ({
    title: String(s.title || `第 ${si + 1} 组`),
    source: ['basic', 'resume', 'behavior'].includes(s.source) ? s.source : 'resume',
    questions: (Array.isArray(s.questions) ? s.questions : []).filter((q) => q && q.q).map((q, qi) => ({
      id: `s${si + 1}q${qi + 1}`,
      q: String(q.q).trim(),
      why: String(q.why || ''),
      points: (Array.isArray(q.points) ? q.points : []).map(String).filter(Boolean),
      follow: String(q.follow || ''),
      dim: clampDim(q.dim),
      good: String(q.good || ''),
      bad: String(q.bad || ''),
      asked: false,
      note: '',
    })),
  })).filter((s) => s.questions.length);
  if (!sections.length) throw new Error('模型没有生成题目，请重试。');
  return {
    candidate: {
      summary: String(raw.candidate?.summary || ''),
      highlights: (raw.candidate?.highlights || []).map(String),
      doubts: (raw.candidate?.doubts || []).map(String),
    },
    verify: (Array.isArray(raw.verify) ? raw.verify : []).filter((v) => v && v.point).map((v) => ({ point: String(v.point), ask: String(v.ask || '') })),
    sections,
  };
}

function normalizeEvaluation(raw) {
  const byName = new Map((Array.isArray(raw.dimensions) ? raw.dimensions : []).map((d) => [d.name, d]));
  const dimensions = DIMENSIONS.map((name) => {
    const d = byName.get(name) || {};
    const score = Math.min(5, Math.max(0, Math.round(Number(d.score) * 2) / 2 || 0));
    return { name, score, reason: String(d.reason || '没有足够信息评估。'), evidence: (d.evidence || []).map(String), enough: d.enough !== false && byName.has(name) };
  });
  const verdicts = ['强烈推荐', '推荐', '待定', '不推荐'];
  const levels = ['初级', '中级', '高级', '资深'];
  return {
    dimensions,
    overall: {
      level: levels.includes(raw.overall?.level) ? raw.overall.level : '待定',
      verdict: verdicts.includes(raw.overall?.verdict) ? raw.overall.verdict : '待定',
      summary: String(raw.overall?.summary || ''),
    },
    strengths: (raw.strengths || []).map(String),
    risks: (raw.risks || []).map(String),
    nextRound: (raw.nextRound || []).map(String),
    gaps: String(raw.gaps || ''),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { DIMENSIONS, questionMessages, rewriteMessages, evaluationMessages, normalizeQuestions, normalizeEvaluation, splitSentences, speakerMessages, buildDialogue, transcriptForEval, reviewMessages, normalizeReview };
