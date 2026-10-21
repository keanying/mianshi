'use strict';
// 文字比对：去掉标点空格后求最长公共子序列，看 expected 有多少字在 actual 里按顺序出现（0~1）。
// 用于：模拟候选人时检查转写对不对；面试中从转写里认出面试官问的是哪道题。
(() => {
const clean = (s) => String(s || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

function coverage(expected, actual) {
  const a = [...clean(expected)], b = [...clean(actual)];
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length] / a.length;
}

// 在一句转写里找最像的那道题：题目的字有 55% 以上按顺序出现在这句话里才算问到了。
function matchQuestion(text, questions, threshold = 0.55) {
  let best = null;
  for (const q of questions) {
    if (clean(q.q).length < 4 || clean(text).length < clean(q.q).length * 0.4) continue;
    const score = coverage(q.q, text);
    if (score >= threshold && (!best || score > best.score)) best = { q, score };
  }
  return best;
}

// 串音：线上面试没戴耳机时，候选人的声音从扬声器出来又被面试官的麦克风录到，两路会出现同一句话。
// 时间重叠、内容基本相同的，留在候选人那一路，面试官那一路标为 echo（界面隐藏、评估不用）。
function markEcho(transcript, seg) {
  const marked = [];
  if (!seg.speaker || seg.text.replace(/\s/g, '').length < 4) return marked;
  for (const other of transcript) {
    if (!other.speaker || other.speaker === seg.speaker || !other.text || other.index === seg.index) continue;
    const overlap = seg.start < (other.end ?? other.start + 15) + 1.5 && other.start < (seg.end ?? seg.start + 15) + 1.5;
    if (!overlap) continue;
    const [short, long] = seg.text.length <= other.text.length ? [seg.text, other.text] : [other.text, seg.text];
    if (coverage(short, long) < 0.6) continue;
    const mic = seg.speaker === '面试官' ? seg : other;
    if (!mic.echo) { mic.echo = true; marked.push(mic.index); }
  }
  return marked;
}

// 回答节奏：两路录音带时间，统计双方说话时长、候选人每次开口前停了多久。
function rhythm(transcript) {
  const segs = (transcript || []).filter((t) => t.text && !t.echo && t.speaker && t.end != null).sort((a, b) => a.start - b.start);
  const talk = { 面试官: 0, 候选人: 0 }, waits = [];
  segs.forEach((t, k) => {
    talk[t.speaker] = (talk[t.speaker] || 0) + Math.max(0, t.end - t.start);
    const prev = segs[k - 1];
    if (t.speaker === '候选人' && prev?.speaker === '面试官') {
      const gap = t.start - prev.end;
      if (gap >= 0 && gap <= 20) waits.push(gap);
    }
  });
  const total = talk.面试官 + talk.候选人;
  const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
  const sd = waits.length ? Math.sqrt(waits.reduce((a, b) => a + (b - avg) ** 2, 0) / waits.length) : null;
  return { talk, share: total ? talk.候选人 / total : null, waits, avg, sd, steady: waits.length >= 3 && avg >= 3 && sd <= 1.2 };
}

const api = { coverage, matchQuestion, markEcho, rhythm };
if (typeof module === 'object' && module.exports) module.exports = api;
else Object.assign(window, api);
})();
