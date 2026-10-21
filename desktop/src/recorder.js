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

// 按停顿切段：攒够 minSeconds 后遇到 PAUSE 秒的安静就切，最长不超过 chunkSeconds。
// 一段里几乎没有声音时标记 silent，主进程不送去转写（省钱，也避免转写服务把噪声识别成文字）。
const MIN_SECONDS = 4, PAUSE = 0.6, QUIET = 0.012, SPEECH = 0.02;

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

  // systemAudio：线上面试时另录电脑声音。拿到后麦克风记为面试官、电脑声音记为候选人，分两路转写；
  // 拿不到（或面对面面试）时只录麦克风，说话人在面试后由模型区分。
  async start({ systemAudio = false, startIndex = 0, startOffset = 0 } = {}) {
    this.streams = [];
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.streams.push(mic);
    this.systemAudioError = '';
    let display = null;
    if (systemAudio) {
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        display.getVideoTracks().forEach((t) => t.stop()); // 只要声音
        if (display.getAudioTracks().length) this.streams.push(display);
        else { this.systemAudioError = '没有拿到电脑声音'; display = null; }
      } catch (err) {
        this.systemAudioError = '当前系统不支持录制电脑声音';
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

window.Recorder = Recorder;
})();
