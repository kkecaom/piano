// Minimal Standard MIDI File writer used by the tests to build fixtures in memory.

const vlq = (n) => {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];

/**
 * @param {Array<Array<{tick:number, bytes:number[]}>>} tracks absolute-tick raw events
 * @param {{format?:number, ppq?:number, runningStatus?:boolean}} opts
 */
export function writeMidi(tracks, { format = 1, ppq = 480, runningStatus = false } = {}) {
  const out = [...'MThd'].map((c) => c.charCodeAt(0)).concat(u32(6), u16(format), u16(tracks.length), u16(ppq));
  for (const events of tracks) {
    const sorted = [...events].sort((a, b) => a.tick - b.tick);
    const body = [];
    let last = 0;
    let status = 0;
    for (const e of sorted) {
      body.push(...vlq(e.tick - last));
      last = e.tick;
      let bytes = e.bytes;
      if (runningStatus && bytes[0] < 0xf0 && bytes[0] === status) bytes = bytes.slice(1);
      else if (bytes[0] < 0xf0) status = bytes[0];
      body.push(...bytes);
    }
    body.push(0, 0xff, 0x2f, 0);
    out.push(...[...'MTrk'].map((c) => c.charCodeAt(0)), ...u32(body.length), ...body);
  }
  return new Uint8Array(out);
}

export const on = (tick, note, vel = 80, ch = 0) => ({ tick, bytes: [0x90 | ch, note, vel] });
export const off = (tick, note, ch = 0, useZeroVel = false) => ({ tick, bytes: useZeroVel ? [0x90 | ch, note, 0] : [0x80 | ch, note, 64] });
export const cc = (tick, num, value, ch = 0) => ({ tick, bytes: [0xb0 | ch, num, value] });
export const tempo = (tick, bpm) => {
  const us = Math.round(60e6 / bpm);
  return { tick, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] };
};
export const trackName = (name) => {
  const b = [...new TextEncoder().encode(name)];
  return { tick: 0, bytes: [0xff, 0x03, ...vlq(b.length), ...b] };
};

/** A two-hand C-major study: right-hand scale, left-hand chords, pedal per bar, tempo change. */
export function scaleStudy({ pedal = true } = {}) {
  const rh = [trackName('Right Hand')];
  const lh = [trackName('Left Hand')];
  const conductor = [tempo(0, 120), tempo(1920 * 2, 60)];
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  scale.forEach((n, i) => { rh.push(on(i * 240, n, 90), off(i * 240 + 220, n)); });
  [[48, 52, 55], [41, 45, 48], [43, 47, 50], [48, 52, 55]].forEach((ch, bar) => {
    for (const n of ch) lh.push(on(bar * 1920, n, 60, 1), off(bar * 1920 + 1800, n, 1, true));
    if (pedal) lh.push(cc(bar * 1920 + 60, 64, 127, 1), cc(bar * 1920 + 1900, 64, 0, 1));
  });
  return writeMidi([conductor, rh, lh], { runningStatus: true });
}
