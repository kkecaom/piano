// Offline rendering of a performance to a 24-bit stereo WAV, through the exact same
// sampler and mastering chain used for live playback.

import { AudioEngine } from './engine.js';

const TAIL = 4;

export async function renderPerformance(perf, bank, settings, opts, onProgress = () => {}) {
  const { rate = 1, transpose = 0, usePedal = true, muted = {}, sampleRate = 48000 } = opts;
  const duration = perf.duration / rate + TAIL;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const engine = new AudioEngine(ctx, bank, settings);
  engine.sampler.maxVoices = Infinity; // voices are scheduled ahead in bulk; never steal
  const notes = perf.notes;

  const pedalEdges = [];
  if (usePedal) for (const p of perf.pedals) pedalEdges.push([p.start, true], [p.end, false]);
  pedalEdges.sort((a, b) => a[0] - b[0]);

  // Schedule in windows using suspend() so the graph never holds the whole piece at once.
  const WINDOW = 2;
  let ni = 0, pi = 0;
  const scheduleUntil = (t) => {
    while (ni < notes.length && notes[ni].start / rate < t) {
      const n = notes[ni++];
      if (muted[n.hand]) continue;
      const midi = n.midi + transpose;
      if (midi < 21 || midi > 108) continue;
      const v = engine.sampler.noteOn(midi, n.vel, n.start / rate);
      if (v) v.release((usePedal ? n.damp : n.end) / rate);
    }
    while (pi < pedalEdges.length && pedalEdges[pi][0] / rate < t) {
      const [time, down] = pedalEdges[pi++];
      engine.pedal(down, time / rate);
    }
  };
  scheduleUntil(WINDOW);
  for (let t = WINDOW / 2; t < duration; t += WINDOW / 2) {
    const at = t;
    ctx.suspend(at).then(() => {
      scheduleUntil(at + WINDOW);
      onProgress(Math.min(1, at / duration));
      ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  onProgress(1);
  return buffer;
}

/** Encode an AudioBuffer as a 24-bit PCM WAV with TPDF dither. */
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const bytesPerSample = 3;
  const dataSize = len * ch * bytesPerSample;
  const out = new DataView(new ArrayBuffer(44 + dataSize));
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  out.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * bytesPerSample, true);
  out.setUint16(32, ch * bytesPerSample, true);
  out.setUint16(34, 24, true);
  writeStr(36, 'data');
  out.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  const scale = 8388607;
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const dither = (Math.random() - Math.random()) / scale;
      let v = Math.max(-1, Math.min(1, chans[c][i] + dither));
      v = Math.round(v * scale);
      out.setUint8(o, v & 0xff);
      out.setUint8(o + 1, (v >> 8) & 0xff);
      out.setUint8(o + 2, (v >> 16) & 0xff);
      o += 3;
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
