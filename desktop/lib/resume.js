'use strict';
// 简历解析：PDF 用 pdf.js 在本地取文字，TXT / Markdown 直接读取。
// 注意：不要安装 pdf.js 的可选原生依赖 @napi-rs/canvas（见 .npmrc），它在 Electron 主进程里会崩溃。
const fs = require('fs');
const path = require('path');

const SUPPORTED = ['.pdf', '.txt', '.md'];

function decodeText(buffer) {
  const utf8 = buffer.toString('utf8');
  // 含大量替换字符说明不是 UTF-8，常见是 Windows 记事本保存的 GBK。
  if ((utf8.match(/�/g) || []).length > 3) {
    try { return new TextDecoder('gbk').decode(buffer); } catch { /* 运行时不支持 GBK 时退回 UTF-8 */ }
  }
  return utf8.replace(/^\uFEFF/, '');
}

async function pdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  // pdf.js 要求目录地址以 "/" 结尾；Windows 路径里的反斜杠也统一换成 "/"，否则在 Windows 上读 PDF 会报错。
  const dirURL = (name) => `${path.join(root, name).replace(/\\/g, '/')}/`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // 中文 PDF 常用 CID 字体，需要 cMap 才能还原文字。
    cMapUrl: dirURL('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dirURL('standard_fonts'),
    isEvalSupported: false,
    verbosity: 0,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    // 按行（y 坐标）归并文字片段，保留基本的换行结构。
    const lines = [];
    let lastY = null, line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; lastY = null; continue; }
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+$/, '')).filter(Boolean).join('\n'));
  }
  await task.destroy();
  return pages.join('\n\n');
}

async function readResume(file) {
  const ext = path.extname(file).toLowerCase();
  if (!SUPPORTED.includes(ext)) throw new Error('只支持 PDF、TXT、Markdown 格式的简历。');
  const buffer = fs.readFileSync(file);
  const text = (ext === '.pdf' ? await pdfText(buffer) : decodeText(buffer)).replace(/\n{3,}/g, '\n\n').trim();
  if (text.replace(/\s/g, '').length < 30) {
    throw new Error(ext === '.pdf'
      ? '这个 PDF 里几乎读不到文字，可能是扫描件或图片。请换文字版 PDF，或把简历内容复制到下面的文本框里。'
      : '简历内容太少，请检查文件。');
  }
  return text;
}

module.exports = { readResume, SUPPORTED };
