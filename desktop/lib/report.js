'use strict';
// 评估报告：生成 Markdown 和用于导出 PDF 的 HTML。

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const average = (e) => Math.round(e.dimensions.reduce((a, d) => a + d.score, 0) / e.dimensions.length * 10) / 10;
const dateOf = (iso) => (iso || '').slice(0, 10);

function toMarkdown(i) {
  const e = i.evaluation;
  const lines = [`# 面试评估：${i.name || '未命名候选人'}`, '', `- 岗位：${i.position || '—'}`, `- 日期：${dateOf(i.createdAt)}`];
  if (e) {
    lines.push(`- 结论：**${e.overall.verdict}** · ${e.overall.level} · 平均 ${average(e)} / 5`, '', '## 整体评价', '', e.overall.summary, '', '## 五维评分', '', '| 维度 | 分数 | 理由 |', '|---|---|---|');
    for (const d of e.dimensions) lines.push(`| ${d.name} | ${d.score}${d.enough ? '' : '（证据不足）'} | ${d.reason.replace(/\|/g, '/')} |`);
    for (const d of e.dimensions) if (d.evidence.length) lines.push('', `**${d.name}的依据**`, ...d.evidence.map((x) => `- ${x}`));
    lines.push('', '## 优点', ...e.strengths.map((x) => `- ${x}`), '', '## 风险', ...e.risks.map((x) => `- ${x}`), '', '## 下一轮建议追问', ...e.nextRound.map((x) => `- ${x}`), '', `**未覆盖 / 证据不足**：${e.gaps || '无'}`);
  }
  if (i.notes) lines.push('', '## 面试官笔记', '', i.notes);
  return lines.join('\n') + '\n';
}

function toHTML(i) {
  const e = i.evaluation;
  const bar = (score) => `<span class="bar"><i style="width:${score / 5 * 100}%"></i></span>`;
  const list = (items) => (items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">无</p>');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>面试评估 · ${esc(i.name)}</title><style>
body{font:13px/1.75 "PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;margin:36px 44px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:15px;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
.meta{color:#64748b;margin:0 0 18px}.verdict{display:inline-block;padding:2px 10px;border-radius:999px;background:#0f172a;color:#fff;font-weight:600;margin-right:8px}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #eef1f5;padding:8px 6px;text-align:left;vertical-align:top}th{color:#64748b;font-weight:600;font-size:12px}
.bar{display:inline-block;width:80px;height:6px;background:#eef1f5;border-radius:3px;vertical-align:middle;margin-right:8px}.bar i{display:block;height:100%;background:#0f766e;border-radius:3px}
.ev{color:#475569;font-size:12px;margin:4px 0 0;padding-left:16px}.muted{color:#94a3b8}.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
</style></head><body>
<h1>面试评估：${esc(i.name || '未命名候选人')}</h1>
<p class="meta">${esc(i.position || '岗位未填写')} · ${esc(dateOf(i.createdAt))}</p>
${e ? `<p><span class="verdict">${esc(e.overall.verdict)}</span>${esc(e.overall.level)} · 平均 ${average(e)} / 5</p>
<p>${esc(e.overall.summary)}</p>
<h2>五维评分</h2><table><tr><th style="width:90px">维度</th><th style="width:150px">分数</th><th>理由与依据</th></tr>
${e.dimensions.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${bar(d.score)}${d.score}${d.enough ? '' : ' <span class="muted">证据不足</span>'}</td><td>${esc(d.reason)}${d.evidence.length ? `<ul class="ev">${d.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</td></tr>`).join('')}
</table>
<div class="cols"><div><h2>优点</h2>${list(e.strengths)}</div><div><h2>风险</h2>${list(e.risks)}</div></div>
<h2>下一轮建议追问</h2>${list(e.nextRound)}
<h2>未覆盖 / 证据不足</h2><p>${esc(e.gaps || '无')}</p>` : '<p class="muted">尚未生成评估。</p>'}
${i.notes ? `<h2>面试官笔记</h2><p style="white-space:pre-wrap">${esc(i.notes)}</p>` : ''}
</body></html>`;
}

module.exports = { toMarkdown, toHTML, average };
