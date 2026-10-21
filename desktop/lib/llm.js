'use strict';
// 大模型调用：GLM 与 DeepSeek 都提供 OpenAI 兼容的 /chat/completions 接口，这里统一按流式读取。

const PROVIDERS = {
  glm: {
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5', 'glm-4.7', 'glm-4.6', 'glm-4-flash'],
    asr: true,
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    asr: false,
  },
  custom: { label: '自定义（OpenAI 兼容）', baseURL: '', models: [], asr: false },
};

class LLMError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function friendlyHttpError(status, body) {
  const snippet = String(body || '').slice(0, 300);
  if (status === 401 || status === 403) return new LLMError('API Key 无效或没有权限，请在「设置」里检查。', { status, detail: snippet });
  if (status === 404) return new LLMError('接口地址或模型名称不对，请在「设置」里检查。', { status, detail: snippet });
  if (status === 429) return new LLMError('调用太频繁或额度不足，请稍后再试或检查账户余额。', { status, detail: snippet });
  if (status >= 500) return new LLMError('模型服务暂时不可用，请稍后重试。', { status, detail: snippet });
  return new LLMError(`模型接口返回错误（${status}）。`, { status, detail: snippet });
}

const joinURL = (base, path) => String(base || '').replace(/\/+$/, '') + path;

// 解析 SSE 流：逐行读取 "data: {...}"，累积 delta.content；reasoning_content 只计入进度不进入结果。
async function readStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return text;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      if (event.error) throw new LLMError(event.error.message || '模型返回错误', { detail: JSON.stringify(event.error) });
      const delta = event.choices?.[0]?.delta || {};
      const piece = delta.content || '';
      received += piece.length + (delta.reasoning_content || '').length;
      text += piece;
      if (onDelta) onDelta({ received, thinking: !piece && Boolean(delta.reasoning_content) });
    }
  }
  return text;
}

async function chat({ baseURL, apiKey, model, messages, temperature = 0.4, onDelta, timeoutMs = 300000 }) {
  if (!baseURL || !model) throw new LLMError('还没有配置模型，请先到「设置」里填写。');
  if (!apiKey) throw new LLMError('还没有填写 API Key，请先到「设置」里填写。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(joinURL(baseURL, '/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature, stream: true }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new LLMError('模型响应超时，请重试。');
      throw new LLMError('连不上模型服务，请检查网络或接口地址。', { detail: err.message });
    }
    if (!response.ok) throw friendlyHttpError(response.status, await response.text());
    const type = response.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) return await readStream(response, onDelta);
    // 少数网关忽略 stream 参数，直接返回完整 JSON。
    const json = await response.json();
    return json.choices?.[0]?.message?.content || '';
  } catch (err) {
    if (err.name === 'AbortError') throw new LLMError('模型响应超时，请重试。');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// 从模型输出里取出 JSON：去掉 ```json 围栏，截取最外层花括号，容忍结尾多余逗号。
function extractJSON(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new LLMError('模型没有返回有效内容，请重试。', { detail: s.slice(0, 300) });
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
    } catch (err) {
      throw new LLMError('模型返回的格式不完整，请重试。', { detail: err.message });
    }
  }
}

// 要求 JSON 的调用：解析失败时把原输出交回模型修正一次。
async function chatJSON(options) {
  const text = await chat(options);
  try {
    return extractJSON(text);
  } catch {
    const repaired = await chat({
      ...options,
      temperature: 0,
      messages: [...options.messages, { role: 'assistant', content: text },
        { role: 'user', content: '上面的输出不是合法 JSON。请只输出修正后的完整 JSON，不要任何解释或代码块标记。' }],
    });
    return extractJSON(repaired);
  }
}

module.exports = { PROVIDERS, LLMError, chat, chatJSON, extractJSON, readStream };
