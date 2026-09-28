// Standard MIDI File (SMF) reader: formats 0, 1 and 2, running status, tempo maps,
// SMPTE time division, sustain / soft pedal controllers and track names.

export class MidiParseError extends Error {}

class Reader {
  constructor(bytes) { this.b = bytes; this.p = 0; }
  get eof() { return this.p >= this.b.length; }
  u8() { if (this.p >= this.b.length) throw new MidiParseError('Unexpected end of file'); return this.b[this.p++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  u32() { return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8(); }
  str(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  bytes(n) { const out = this.b.subarray(this.p, this.p + n); this.p += n; return out; }
  vlq() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.u8();
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new MidiParseError('Bad variable-length quantity');
  }
}

function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('gb18030').decode(bytes); } catch { /* decoder unavailable */ }
  return Array.from(bytes, (c) => String.fromCharCode(c)).join('');
}

/**
 * Parse raw SMF bytes into tracks of absolute-tick events.
 * @param {ArrayBuffer|Uint8Array} data
 */
export function parseMidi(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(bytes);

  // Some files carry a RIFF (RMID) wrapper: skip to the MThd chunk.
  let start = 0;
  for (let i = 0; i + 4 <= bytes.length && i < 4096; i++) {
    if (bytes[i] === 0x4d && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) { start = i; break; }
  }
  r.p = start;
  if (r.str(4) !== 'MThd') throw new MidiParseError('Not a MIDI file (missing MThd header)');
  const hlen = r.u32();
  const format = r.u16();
  const ntracks = r.u16();
  const division = r.u16();
  r.p += hlen - 6;

  let ticksPerBeat = division;
  let smpte = null;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8);
    const tpf = division & 0xff;
    smpte = { fps: fps === 29 ? 29.97 : fps, ticksPerFrame: tpf };
    ticksPerBeat = null;
  }

  const tracks = [];
  for (let t = 0; t < ntracks && !r.eof; t++) {
    let id;
    try { id = r.str(4); } catch { break; }
    const len = r.u32();
    const end = Math.min(r.p + len, bytes.length);
    if (id !== 'MTrk') { r.p = end; t--; continue; }
    const events = [];
    let tick = 0;
    let status = 0;
    let name = '';
    try {
      while (r.p < end) {
        tick += r.vlq();
        let b = r.u8();
        if (b === 0xff) {
          const type = r.u8();
          const l = r.vlq();
          const payload = r.bytes(l);
          if (type === 0x51 && l === 3) {
            events.push({ tick, type: 'tempo', usPerBeat: (payload[0] << 16) | (payload[1] << 8) | payload[2] });
          } else if (type === 0x58 && l >= 2) {
            events.push({ tick, type: 'timesig', num: payload[0], den: Math.pow(2, payload[1]) });
          } else if (type === 0x59 && l >= 2) {
            events.push({ tick, type: 'keysig', sf: (payload[0] << 24) >> 24, minor: payload[1] === 1 });
          } else if (type === 0x03 && !name) {
            name = decodeText(payload).trim();
          } else if (type === 0x2f) {
            break;
          }
          continue;
        }
        if (b === 0xf0 || b === 0xf7) { r.p += r.vlq(); continue; }
        let d1;
        if (b & 0x80) { status = b; d1 = r.u8(); } else { if (!status) throw new MidiParseError('Running status without status byte'); d1 = b; }
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        if (kind === 0xc0 || kind === 0xd0) { if (kind === 0xc0) events.push({ tick, type: 'program', channel, program: d1 }); continue; }
        const d2 = r.u8();
        if (kind === 0x90 && d2 > 0) events.push({ tick, type: 'on', channel, note: d1, vel: d2 });
        else if (kind === 0x80 || kind === 0x90) events.push({ tick, type: 'off', channel, note: d1 });
        else if (kind === 0xb0) events.push({ tick, type: 'cc', channel, cc: d1, value: d2 });
      }
    } catch (e) {
      if (!(e instanceof MidiParseError)) throw e;
      // Truncated track: keep what we have.
    }
    r.p = end;
    tracks.push({ name, events });
  }
  if (!tracks.length) throw new MidiParseError('The MIDI file has no tracks');
  return { format, ticksPerBeat, smpte, tracks };
}

/** Build a tick → seconds converter from all tempo events (format 1 keeps them in track 0). */
export function makeTimeMap(midi) {
  if (midi.smpte) {
    const secPerTick = 1 / (midi.smpte.fps * midi.smpte.ticksPerFrame);
    return { toSeconds: (tick) => tick * secPerTick, tempos: [{ tick: 0, sec: 0, usPerBeat: 500000 }] };
  }
  const tempoEvents = [];
  const trackSet = midi.format === 2 ? [midi.tracks[0]] : midi.tracks;
  for (const tr of trackSet) for (const e of tr.events) if (e.type === 'tempo') tempoEvents.push(e);
  tempoEvents.sort((a, b) => a.tick - b.tick);
  const tpb = midi.ticksPerBeat || 480;
  const segs = [{ tick: 0, sec: 0, usPerBeat: 500000 }];
  for (const e of tempoEvents) {
    const last = segs[segs.length - 1];
    const sec = last.sec + ((e.tick - last.tick) * last.usPerBeat) / 1e6 / tpb;
    if (e.tick === last.tick) { last.usPerBeat = e.usPerBeat; continue; }
    segs.push({ tick: e.tick, sec, usPerBeat: e.usPerBeat });
  }
  const toSeconds = (tick) => {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].tick <= tick) lo = mid; else hi = mid - 1; }
    const s = segs[lo];
    return s.sec + ((tick - s.tick) * s.usPerBeat) / 1e6 / tpb;
  };
  return { toSeconds, tempos: segs };
}
