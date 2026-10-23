'use strict';
// 岗位：名称、级别、岗位要求和达标线，保存在数据目录下的 positions.json。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIMS, LEVEL_NAMES, defaultPass } = require('../src/levels');

const clampScore = (v, fallback) => {
  const n = Math.round(Number(v) * 2) / 2;
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : fallback;
};

// 整理成稳定结构：级别不认识时按中级，分数限制在 0~5、步长 0.5。
function normalize(p) {
  const level = LEVEL_NAMES.includes(p.level) ? p.level : '中级';
  const def = defaultPass(level);
  return {
    id: p.id,
    title: String(p.title || '').trim() || '未命名岗位',
    level,
    jd: String(p.jd || ''),
    pass: {
      average: clampScore(p.pass?.average, def.average),
      dims: Object.fromEntries(DIMS.map((d) => [d, clampScore(p.pass?.dims?.[d], def.dims[d])])),
    },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function createPositions(root) {
  const file = path.join(root, 'positions.json');
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  };
  const write = (list) => {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
    fs.renameSync(tmp, file);
  };

  const list = () => read();
  const get = (id) => read().find((p) => p.id === id) || null;

  // 新建（没有 id）或更新。
  function save(input) {
    const all = read(), now = new Date().toISOString();
    const old = input.id && all.find((p) => p.id === input.id);
    const next = normalize({ ...old, ...input, id: old ? old.id : crypto.randomBytes(4).toString('hex'), createdAt: old?.createdAt || now, updatedAt: now });
    write(old ? all.map((p) => (p.id === old.id ? next : p)) : [...all, next]);
    return next;
  }

  function remove(id) {
    write(read().filter((p) => p.id !== id));
    return true;
  }

  return { list, get, save, remove };
}

module.exports = { createPositions, normalize };
