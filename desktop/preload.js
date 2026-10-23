'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  info: call('app:info'),
  settings: { get: call('settings:get'), save: call('settings:save'), testLLM: call('settings:testLLM'), testASR: call('settings:testASR') },
  openDataDir: call('data:open'),
  showFile: call('file:show'),
  interviews: { list: call('interviews:list'), create: call('interviews:create'), get: call('interviews:get'), save: call('interviews:save'), remove: call('interviews:remove'), restart: call('interviews:restart') },
  positions: { list: call('positions:list'), save: call('positions:save'), remove: call('positions:remove') },
  live: { review: call('live:review') },
  resume: { pick: call('resume:pick'), import: call('resume:import'), pathOf: (file) => webUtils.getPathForFile(file) },
  plan: { generate: call('plan:generate'), rewrite: call('plan:rewrite') },
  audio: { chunk: call('audio:chunk'), finish: call('audio:finish'), retry: call('audio:retry'), retranscribe: call('audio:retranscribe'), test: call('audio:test'), tts: call('audio:tts'), open: call('audio:open'), part: call('audio:part'), askMic: call('media:askMic') },
  transcript: { pick: call('transcript:pick'), speakers: call('transcript:speakers') },
  evaluate: call('eval:generate'),
  exportReport: call('report:export'),
  onProgress: on('llm:progress'),
  onSegment: on('asr:segment'),
});
