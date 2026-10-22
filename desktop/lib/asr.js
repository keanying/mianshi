'use strict';
// 语音转文字：智谱 GLM-ASR 的 /audio/transcriptions 接口（multipart 上传 wav）。
// 单次请求有时长上限（约 30 秒），所以录音按段切分后逐段上传。
const { LLMError } = require('./llm');

const DEFAULT_ASR = { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-asr-2512' };

async function transcribe({ baseURL, apiKey, model, wav, timeoutMs = 90000 }) {
  if (!apiKey) throw new LLMError('还没有配置语音转文字的 API Key（智谱），请先到「设置」里填写。');
  const form = new FormData();
  form.append('model', model || DEFAULT_ASR.model);
  form.append('stream', 'false');
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'segment.wav');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(String(baseURL || DEFAULT_ASR.baseURL).replace(/\/+$/, '') + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? '语音转文字的 API Key 无效。'
        : response.status === 404 ? '语音转文字的接口地址或模型名称不对。'
        : `语音转文字失败（${response.status}）。`;
      throw new LLMError(message, { status: response.status, detail: body.slice(0, 300) });
    }
    let json;
    try { json = JSON.parse(body); } catch { json = { text: body }; }
    const text = String(json.text ?? json.result ?? json.data?.text ?? '').trim();
    // 只有噪声时识别服务会返回「#」之类的符号，没有任何字的结果当作没说话。
    return /[\p{L}\p{N}]/u.test(text) ? text : '';
  } catch (err) {
    if (err.name === 'AbortError') throw new LLMError('语音转文字超时。');
    if (err instanceof LLMError) throw err;
    throw new LLMError('连不上语音转文字服务，请检查网络。', { detail: err.message });
  } finally {
    clearTimeout(timer);
  }
}

// 语音合成：智谱 GLM-TTS（/audio/speech，和转写共用 Key），音频调试时用来“模拟候选人说话”。
async function synthesize({ baseURL, apiKey, text, voice = 'female', timeoutMs = 30000 }) {
  if (!apiKey) throw new LLMError('还没有配置智谱的 API Key。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(String(baseURL || DEFAULT_ASR.baseURL).replace(/\/+$/, '') + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'glm-tts', input: text, voice, response_format: 'wav' }),
      signal: controller.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok || body.subarray(0, 4).toString() !== 'RIFF') throw new LLMError(`语音合成失败（${response.status}）`, { status: response.status, detail: body.subarray(0, 300).toString() });
    return body;
  } catch (err) {
    if (err instanceof LLMError) throw err;
    throw new LLMError('连不上语音合成服务。', { detail: err.message });
  } finally {
    clearTimeout(timer);
  }
}

// 生成一段静音 wav，用于「测试连接」。
function silentWav(seconds = 1, sampleRate = 16000) {
  const samples = seconds * sampleRate, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

module.exports = { DEFAULT_ASR, transcribe, synthesize, silentWav };
