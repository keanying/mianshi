'use strict';
// 设置：保存在用户数据目录的 settings.json。API Key 用系统钥匙串（Electron safeStorage）加密后再写盘。
const fs = require('fs');
const path = require('path');
const { PROVIDERS } = require('./llm');
const { DEFAULT_ASR } = require('./asr');

const DEFAULTS = {
  provider: 'glm',
  baseURL: PROVIDERS.glm.baseURL,
  model: PROVIDERS.glm.models[0],
  thinking: false, // 默认关闭模型的深度思考
  recordMode: 'offline', // offline 面对面一个麦克风；online 线上面试，另录候选人的声音
  micId: '', // 面试官麦克风，空为系统默认
  outputId: '', // 耳机 / 扬声器，空为系统默认（只用于播放测试音）
  candidateSource: 'system', // 线上面试时候选人声音来源：system 电脑声音，或某个输入设备 id
  asrEnabled: true,
  asrBaseURL: DEFAULT_ASR.baseURL,
  asrModel: DEFAULT_ASR.model,
  asrUseChatKey: true,
  chunkSeconds: 15,
  questionCount: 20,
  position: '',
  jd: '',
};

function createSettings(root, safeStorage) {
  const file = path.join(root, 'settings.json');
  const canEncrypt = () => Boolean(safeStorage?.isEncryptionAvailable?.());
  const seal = (value) => {
    if (!value) return '';
    return canEncrypt() ? `enc:${safeStorage.encryptString(value).toString('base64')}` : `plain:${value}`;
  };
  const open = (stored) => {
    if (!stored) return '';
    if (stored.startsWith('enc:')) {
      try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')); } catch { return ''; }
    }
    return stored.startsWith('plain:') ? stored.slice(6) : '';
  };
  const read = () => {
    let s;
    try { s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { s = { ...DEFAULTS }; }
    // 旧版保存的已下线模型名，换成对应的新模型。
    const renamed = PROVIDERS[s.provider]?.retired?.[s.model];
    if (renamed) s.model = renamed;
    return s;
  };

  // 给界面看的版本：不返回明文 Key，只返回是否已填和末四位。
  function getPublic() {
    const s = read();
    const hint = (k) => (k ? `已保存（…${k.slice(-4)}）` : '');
    const { apiKeySealed, asrKeySealed, ...rest } = s;
    return { ...rest, apiKeyHint: hint(open(apiKeySealed)), asrKeyHint: hint(open(asrKeySealed)), encrypted: canEncrypt() };
  }

  function getSecret() {
    const s = read();
    const apiKey = open(s.apiKeySealed);
    return { ...s, apiKey, asrKey: s.asrUseChatKey ? apiKey : open(s.asrKeySealed) };
  }

  function save(patch) {
    const s = read();
    const { apiKey, asrKey, ...rest } = patch;
    const next = { ...s, ...rest };
    if (typeof apiKey === 'string' && apiKey.trim()) next.apiKeySealed = seal(apiKey.trim());
    if (typeof asrKey === 'string' && asrKey.trim()) next.asrKeySealed = seal(asrKey.trim());
    next.chunkSeconds = Math.min(28, Math.max(10, Number(next.chunkSeconds) || DEFAULTS.chunkSeconds));
    next.questionCount = Math.min(40, Math.max(8, Number(next.questionCount) || DEFAULTS.questionCount));
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 1));
    return getPublic();
  }

  return { getPublic, getSecret, save };
}

module.exports = { createSettings, DEFAULTS };
