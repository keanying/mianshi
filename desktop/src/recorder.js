'use strict';
// 录音：麦克风（可选再混入电脑声音），重采样为 16kHz 单声道 16 位 PCM，每 N 秒切成一个 wav 分段交给回调。
(() => {
const TARGET_RATE = 16000;

function encodeWav(int16) {
  const buffer = new ArrayBuffer(44 + int16.length * 2), view = new DataView(buffer);
  const text = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + int16.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, int16.length * 2, true);
  new Int16Array(buffer, 44).set(int16);
  return buffer;
}

class Recorder {
  constructor({ chunkSeconds = 25, onChunk, onLevel }) {
    this.chunkSeconds = chunkSeconds;
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.state = 'idle';
  }

  async start({ systemAudio = false, startIndex = 0, startOffset = 0 } = {}) {
    this.streams = [];
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.streams.push(mic);
    this.systemAudioError = '';
    if (systemAudio) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        display.getVideoTracks().forEach((t) => t.stop()); // 只要声音
        if (display.getAudioTracks().length) this.streams.push(display);
        else this.systemAudioError = '没有拿到电脑声音';
      } catch (err) {
        this.systemAudioError = '当前系统不支持录制电脑声音';
      }
    }
    this.ctx = new AudioContext();
    const mix = this.ctx.createGain();
    for (const s of this.streams) if (s.getAudioTracks().length) this.ctx.createMediaStreamSource(s).connect(mix);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    mix.connect(this.analyser);
    // ScriptProcessor 足够满足 16kHz 语音采集，且不需要额外的 worklet 文件。
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    mix.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this.ratio = this.ctx.sampleRate / TARGET_RATE;
    this.pos = 0;
    this.pending = [];
    this.pendingLength = 0;
    this.index = startIndex;
    this.elapsed = startOffset;
    this.chunkStart = startOffset;
    this.processor.onaudioprocess = (e) => {
      if (this.state !== 'recording') return;
      const input = e.inputBuffer.getChannelData(0);
      const out = new Int16Array(Math.floor((input.length - this.pos) / this.ratio) + 1);
      let n = 0;
      for (; this.pos < input.length; this.pos += this.ratio) {
        const i = Math.floor(this.pos), frac = this.pos - i;
        const v = i + 1 < input.length ? input[i] * (1 - frac) + input[i + 1] * frac : input[i];
        const c = Math.max(-1, Math.min(1, v));
        out[n++] = c < 0 ? c * 0x8000 : c * 0x7fff;
      }
      this.pos -= input.length;
      this.pending.push(out.subarray(0, n));
      this.pendingLength += n;
      this.elapsed += input.length / this.ctx.sampleRate;
      if (this.pendingLength >= this.chunkSeconds * TARGET_RATE) this.flush();
    };
    this.state = 'recording';
    this.meter();
  }

  meter() {
    if (!this.analyser || this.state === 'idle') return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    if (this.onLevel) this.onLevel(this.state === 'recording' ? peak : 0);
    this.raf = requestAnimationFrame(() => this.meter());
  }

  flush() {
    if (!this.pendingLength) return;
    const all = new Int16Array(this.pendingLength);
    let o = 0;
    for (const p of this.pending) { all.set(p, o); o += p.length; }
    this.pending = [];
    this.pendingLength = 0;
    const index = this.index++, start = this.chunkStart;
    this.chunkStart = this.elapsed;
    if (this.onChunk) this.onChunk({ index, start, wav: encodeWav(all) });
  }

  pause() { if (this.state === 'recording') { this.state = 'paused'; this.flush(); } }
  resume() { if (this.state === 'paused') { this.state = 'recording'; this.chunkStart = this.elapsed; } }

  async stop() {
    if (this.state === 'idle') return;
    this.state = 'stopping';
    this.flush();
    cancelAnimationFrame(this.raf);
    this.processor.onaudioprocess = null;
    this.processor.disconnect();
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await this.ctx.close();
    this.state = 'idle';
  }
}

window.Recorder = Recorder;
})();
