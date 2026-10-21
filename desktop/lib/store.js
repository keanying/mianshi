'use strict';
// 本地存储：每场面试一个目录 interviews/<id>/，内含 interview.json、简历原件和录音分段。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore(root) {
  const base = path.join(root, 'interviews');
  fs.mkdirSync(base, { recursive: true });
  const dirOf = (id) => {
    if (!/^[\w-]+$/.test(id)) throw new Error('无效的面试编号');
    return path.join(base, id);
  };
  const fileOf = (id) => path.join(dirOf(id), 'interview.json');

  // 先写临时文件再改名，避免写到一半崩溃导致记录损坏。
  function writeJSON(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
  }

  function create(fields = {}) {
    const now = new Date();
    const id = `${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
    fs.mkdirSync(path.join(dirOf(id), 'audio'), { recursive: true });
    const interview = {
      id, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      name: '', position: '', jd: '', resume: '', resumeFile: '',
      plan: null, transcript: [], notes: '', evaluation: null, status: 'draft',
      ...fields,
    };
    writeJSON(fileOf(id), interview);
    return interview;
  }

  function get(id) {
    return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
  }

  function save(interview) {
    const current = get(interview.id);
    const next = { ...current, ...interview, updatedAt: new Date().toISOString() };
    writeJSON(fileOf(interview.id), next);
    return next;
  }

  function list() {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(fileOf(d.name)))
      .map((d) => {
        try {
          const i = get(d.name);
          const scores = i.evaluation?.dimensions?.map((x) => x.score) || [];
          return {
            id: i.id, name: i.name, position: i.position, createdAt: i.createdAt, updatedAt: i.updatedAt, status: i.status,
            verdict: i.evaluation?.overall?.verdict || '',
            average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null,
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function remove(id) {
    fs.rmSync(dirOf(id), { recursive: true, force: true });
  }

  function saveResumeFile(id, sourcePath) {
    const name = `resume${path.extname(sourcePath).toLowerCase()}`;
    fs.copyFileSync(sourcePath, path.join(dirOf(id), name));
    return name;
  }

  const audioDir = (id) => path.join(dirOf(id), 'audio');
  function saveChunk(id, index, buffer) {
    fs.mkdirSync(audioDir(id), { recursive: true });
    const file = path.join(audioDir(id), `part-${String(index).padStart(4, '0')}.wav`);
    fs.writeFileSync(file, buffer);
    return file;
  }

  // 把所有分段（16kHz 单声道 16 位 PCM）拼成一个完整录音。
  function mergeAudio(id) {
    const parts = fs.existsSync(audioDir(id)) ? fs.readdirSync(audioDir(id)).filter((f) => /^part-\d+\.wav$/.test(f)).sort() : [];
    if (!parts.length) return null;
    const pcm = parts.map((f) => fs.readFileSync(path.join(audioDir(id), f)).subarray(44));
    const data = Buffer.concat(pcm), header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(data.length, 40);
    const file = path.join(dirOf(id), '完整录音.wav');
    fs.writeFileSync(file, Buffer.concat([header, data]));
    return file;
  }

  return { base, dirOf, create, get, save, list, remove, saveResumeFile, saveChunk, mergeAudio };
}

module.exports = { createStore };
