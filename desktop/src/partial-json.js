'use strict';
// 解析还没输出完的 JSON：模型流式输出时，把已经收到的部分补齐括号后解析，界面据此边生成边显示。
// 最后一个没写完的字符串保留已收到的部分；解析不了时退回到上一个逗号再试。
(() => {
function closeJSON(s) {
  const stack = [];
  let inString = false, escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inString) out += escaped ? '\\"' : '"';
  out = out.replace(/[\s,:]+$/, '');
  return out + stack.reverse().join('');
}

function parsePartialJSON(text) {
  let s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  s = s.slice(start).replace(/```\s*$/, '');
  for (let tries = 0; tries < 60 && s.length > 1; tries++) {
    try { return JSON.parse(closeJSON(s)); } catch { /* 退一步再试 */ }
    // 去掉最后一个逗号或开括号之后的半截内容（例如只写了键名、数字写到一半）。
    const cut = Math.max(s.lastIndexOf(','), s.lastIndexOf('{', s.length - 2), s.lastIndexOf('[', s.length - 2));
    if (cut <= 0) break;
    s = s.slice(0, s[cut] === ',' ? cut : cut + 1);
  }
  return null;
}

if (typeof module === 'object' && module.exports) module.exports = { parsePartialJSON };
else window.parsePartialJSON = parsePartialJSON;
})();
