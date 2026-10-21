'use strict';
// 录音：麦克风（线上面试时另录电脑声音），重采样为 16kHz 单声道 16 位 PCM，按停顿切成 wav 分段交给回调。
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

// 按停顿切段：攒够 MIN_SECONDS 后遇到 PAUSE 秒的安静就切，最长不超过 chunkSeconds，转写因此接近实时。
// 一段里完全没有声音（连轻声说话都没有）时标记 silent，主进程不送去转写。阈值故意放得很低，
// 宁可多转写几段空白，也不能把声音小的说话当成静音丢掉。
const MIN_SECONDS = 2.5, PAUSE = 0.5, QUIET = 0.01, SPEECH = 0.004;

// 麦克风约束：deviceId 为空时用系统默认设备。
const micConstraints = (deviceId) => ({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
// 候选人声音来源：system 为电脑声音（系统内录），否则是某个输入设备（如“立体声混音”、虚拟声卡）。
async function candidateStream(source) {
  if (!source) return null;
  if (source === 'system') {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    display.getVideoTracks().forEach((t) => t.stop()); // 只要声音
    if (!display.getAudioTracks().length) throw new Error('没有拿到电脑声音');
    return display;
  }
  return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: source }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
}

// 说话检测（音频调试用）：持续估计背景噪声，音量明显高于噪声并持续 0.15 秒才算开始说话，
// 安静 0.8 秒算说完一句，把这一句（含开头前 0.3 秒）交给 onUtterance 转写。
class Listener {
  constructor(stream, { onLevel, onUtterance, maxSeconds = 12 }) {
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.processor = this.ctx.createScriptProcessor(2048, 1, 1);
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    Object.assign(this, { onLevel, onUtterance, maxSeconds, ratio: this.ctx.sampleRate / TARGET_RATE, pos: 0 });
    Object.assign(this, { noise: 0.004, speaking: false, loudRun: 0, quietRun: 0, pre: [], buf: [], length: 0 });
    this.processor.onaudioprocess = (e) => this.process(e.inputBuffer.getChannelData(0));
  }

  resample(input) {
    const out = new Int16Array(Math.floor((input.length - this.pos) / this.ratio) + 1);
    let n = 0;
    for (; this.pos < input.length; this.pos += this.ratio) {
      const c = Math.max(-1, Math.min(1, input[Math.floor(this.pos)]));
      out[n++] = c < 0 ? c * 0x8000 : c * 0x7fff;
    }
    this.pos -= input.length;
    return out.subarray(0, n);
  }

  process(input) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length), seconds = input.length / this.ctx.sampleRate, pcm = this.resample(input);
    const threshold = Math.max(0.015, this.noise * 3);
    if (!this.speaking) {
      // 背景噪声：变小时马上跟上，变大时慢慢抬高（避免把说话当成噪声）。
      this.noise = rms < this.noise ? this.noise * 0.8 + rms * 0.2 : this.noise * 0.995 + rms * 0.005;
      this.pre.push(pcm);
      if (this.pre.length > Math.ceil(0.3 / seconds)) this.pre.shift();
      this.loudRun = rms > threshold ? this.loudRun + seconds : 0;
      if (this.loudRun >= 0.15) {
        this.speaking = true;
        this.buf = [...this.pre];
        this.length = this.buf.reduce((n, b) => n + b.length, 0);
        this.quietRun = 0;
      }
    } else {
      this.buf.push(pcm);
      this.length += pcm.length;
      this.quietRun = rms < threshold ? this.quietRun + seconds : 0;
      if (this.quietRun >= 0.8 || this.length >= this.maxSeconds * TARGET_RATE) {
        const all = new Int16Array(this.length);
        let o = 0;
        for (const b of this.buf) { all.set(b, o); o += b.length; }
        this.speaking = false;
        this.buf = [];
        this.pre = [];
        this.loudRun = 0;
        if (this.onUtterance) this.onUtterance(encodeWav(all));
      }
    }
    if (this.onLevel) this.onLevel({ level: rms, speaking: this.speaking });
  }

  close() {
    this.processor.onaudioprocess = null;
    this.processor.disconnect();
    this.source.disconnect();
    return this.ctx.close();
  }
}

class Track {
  constructor(rec, stream, speaker) {
    this.rec = rec;
    this.speaker = speaker;
    const ctx = rec.ctx;
    this.source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor 足够满足 16kHz 语音采集，且不需要额外的 worklet 文件。
    this.processor = ctx.createScriptProcessor(4096, 1, 1);
    this.source.connect(this.processor);
    this.source.connect(rec.analyser);
    this.processor.connect(ctx.destination);
    this.ratio = ctx.sampleRate / TARGET_RATE;
    this.pos = 0;
    this.pending = [];
    this.pendingLength = 0;
    this.elapsed = rec.startOffset;
    this.chunkStart = rec.startOffset;
    this.quietRun = 0;
    this.loud = false;
    this.processor.onaudioprocess = (e) => this.process(e.inputBuffer.getChannelData(0));
  }

  process(input) {
    if (this.rec.state !== 'recording') return;
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length), seconds = input.length / this.rec.ctx.sampleRate;
    this.quietRun = rms < QUIET ? this.quietRun + seconds : 0;
    if (rms >= SPEECH) this.loud = true;
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
    this.elapsed += seconds;
    const length = this.pendingLength / TARGET_RATE;
    if (length >= this.rec.chunkSeconds || (length >= MIN_SECONDS && this.quietRun >= PAUSE && this.loud)) this.flush();
  }

  flush() {
    if (!this.pendingLength) return;
    const all = new Int16Array(this.pendingLength);
    let o = 0;
    for (const p of this.pending) { all.set(p, o); o += p.length; }
    const start = this.chunkStart, silent = !this.loud;
    this.pending = [];
    this.pendingLength = 0;
    this.chunkStart = this.elapsed;
    this.loud = false;
    this.rec.emit({ start, wav: encodeWav(all), speaker: this.speaker, silent });
  }

  close() {
    this.processor.onaudioprocess = null;
    this.processor.disconnect();
    this.source.disconnect();
  }
}

class Recorder {
  constructor({ chunkSeconds = 25, onChunk, onLevel }) {
    this.chunkSeconds = chunkSeconds;
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.state = 'idle';
  }

  get elapsed() { return this.tracks?.[0]?.elapsed ?? this.startOffset ?? 0; }

  // candidate：线上面试时候选人声音的来源（'system' 电脑声音，或某个输入设备 id）。拿到后麦克风记为面试官、
  // 候选人声音单独一路，分两路转写；没有（面对面面试）时只录麦克风，说话人在面试后由模型区分。
  async start({ micId = '', candidate = '', startIndex = 0, startOffset = 0 } = {}) {
    this.streams = [];
    const mic = await navigator.mediaDevices.getUserMedia(micConstraints(micId));
    this.streams.push(mic);
    this.systemAudioError = '';
    let display = null;
    if (candidate) {
      try {
        display = await candidateStream(candidate);
        this.streams.push(display);
      } catch (err) {
        this.systemAudioError = candidate === 'system' ? '当前系统录不到电脑声音' : '打不开候选人声音的输入设备';
      }
    }
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.index = startIndex;
    this.startOffset = startOffset;
    this.twoTracks = Boolean(display);
    this.tracks = display ? [new Track(this, mic, '面试官'), new Track(this, display, '候选人')] : [new Track(this, mic, '')];
    this.state = 'recording';
    this.meter();
  }

  emit(chunk) { if (this.onChunk) this.onChunk({ index: this.index++, ...chunk }); }

  meter() {
    if (!this.analyser || this.state === 'idle') return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    if (this.onLevel) this.onLevel(this.state === 'recording' ? peak : 0);
    this.raf = requestAnimationFrame(() => this.meter());
  }

  flush() { this.tracks.forEach((t) => t.flush()); }

  pause() { if (this.state === 'recording') { this.state = 'paused'; this.flush(); } }
  resume() { if (this.state === 'paused') { this.state = 'recording'; this.tracks.forEach((t) => { t.chunkStart = t.elapsed; }); } }

  async stop() {
    if (this.state === 'idle') return;
    this.state = 'stopping';
    this.flush();
    cancelAnimationFrame(this.raf);
    this.tracks.forEach((t) => t.close());
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await this.ctx.close();
    this.state = 'idle';
  }
}

Object.assign(window, { Recorder, Listener, candidateStream, micConstraints });
})();
