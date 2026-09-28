// A small score-writing toolkit for the built-in pieces.
//
// Music is written in beats with a compact text notation and rendered to a performance
// with an expressive tempo map (ritardandi, rubato), dynamic curves, pianistic
// pedalling and subtle humanisation (voicing, melody lead, rolled chords).
//
// Line notation (whitespace separated, `|` bar lines are ignored):
//   C5  F#4  Bb3        a note; duration defaults to the previous token's
//   C5/1.5              1.5 beats long
//   C4+E4+G4/2          a chord
//   r/1                 rest
//   modifiers after the duration:  >  accent   '  staccato   ^  rolled chord   ~ held into the next note
//   e.g.  E5/0.5>  C4+G4+E5/2^

import { noteToMidi, rng, gauss, clamp } from './theory.js';
import { finalize } from '../midi/performance.js';

export class Score {
  constructor({ title, subtitle = '', bpm = 72, beatsPerBar = 4, seed = 1 }) {
    this.title = title;
    this.subtitle = subtitle;
    this.beatsPerBar = beatsPerBar;
    this.seed = seed;
    this.events = [];                          // { hand, beat, midi, dur, vel, accent, roll, len }
    this.tempoPts = [{ beat: 0, bpm, linear: false }];
    this.dynPts = [{ beat: 0, level: 0.5 }];
    this.pedalsBeats = [];
  }

  bar(n) { return (n - 1) * this.beatsPerBar; } // 1-based bar number -> beat

  // ---------- Tempo ----------
  bpmAt(beat) {
    const pts = this.tempoPts;
    let prev = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.beat > beat) {
        if (p.linear) return prev.bpm + (p.bpm - prev.bpm) * (beat - prev.beat) / (p.beat - prev.beat);
        return prev.bpm;
      }
      prev = p;
    }
    return prev.bpm;
  }

  tempo(beat, bpm) { this.insertTempo({ beat, bpm, linear: false }); return this; }

  /** Gradual change from the tempo at `from` to `bpm` at `to` (ritardando / accelerando). */
  ramp(from, to, bpm) {
    const start = this.bpmAt(from);
    this.insertTempo({ beat: from, bpm: start, linear: false });
    this.insertTempo({ beat: to, bpm, linear: true });
    return this;
  }

  insertTempo(pt) {
    this.tempoPts = this.tempoPts.filter((p) => Math.abs(p.beat - pt.beat) > 1e-9);
    this.tempoPts.push(pt);
    this.tempoPts.sort((a, b) => a.beat - b.beat);
  }

  /** Beat -> seconds, integrating the tempo curve exactly. */
  timeMap() {
    const pts = this.tempoPts;
    const segs = [];
    let t = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!b) { segs.push({ b0: a.beat, b1: Infinity, v0: a.bpm, v1: a.bpm, t0: t }); break; }
      const v0 = a.bpm;
      const v1 = b.linear ? b.bpm : a.bpm;
      segs.push({ b0: a.beat, b1: b.beat, v0, v1, t0: t });
      t += segDur(b.beat - a.beat, v0, v1, b.beat - a.beat);
    }
    return (beat) => {
      let s = segs[0];
      for (const seg of segs) { if (seg.b0 <= beat) s = seg; else break; }
      return s.t0 + segDur(beat - s.b0, s.v0, s.v1, s.b1 - s.b0);
    };
  }

  // ---------- Dynamics ----------
  dyn(beat, level) {
    this.dynPts = this.dynPts.filter((p) => Math.abs(p.beat - beat) > 1e-9);
    this.dynPts.push({ beat, level });
    this.dynPts.sort((a, b) => a.beat - b.beat);
    return this;
  }

  levelAt(beat) {
    const pts = this.dynPts;
    if (beat <= pts[0].beat) return pts[0].level;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].beat >= beat) {
        const a = pts[i - 1], b = pts[i];
        return a.level + (b.level - a.level) * (beat - a.beat) / (b.beat - a.beat || 1);
      }
    }
    return pts[pts.length - 1].level;
  }

  // ---------- Notes ----------
  note(hand, beat, pitch, dur, opts = {}) {
    const midis = Array.isArray(pitch) ? pitch : [pitch];
    for (const p of midis) {
      const midi = typeof p === 'number' ? p : noteToMidi(p);
      this.events.push({
        hand, beat, midi, dur,
        len: opts.len ?? dur * (opts.legato ?? 0.96),
        vel: opts.vel ?? 1,
        accent: opts.accent ?? 0,
        roll: midis.length > 1 && opts.roll ? opts.roll : 0,
      });
    }
    return this;
  }

  /**
   * Write a line in text notation starting at `beat`. Returns the beat after the last token.
   * opts: { vel: multiplier, legato: fraction of duration held, octave: shift }
   */
  line(hand, beat, text, opts = {}) {
    let dur = 1;
    let b = beat;
    const shift = (opts.octave || 0) * 12;
    for (const tok of text.split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const m = /^([^/]+?)(?:\/([\d.]+))?([>'^~]*)$/.exec(tok);
      if (!m) throw new Error(`Bad token "${tok}" in ${this.title}`);
      if (m[2]) dur = parseFloat(m[2]);
      const mods = m[3] || '';
      if (m[1] !== 'r') {
        const pitches = m[1].split('+').map((p) => noteToMidi(p) + shift);
        const legato = mods.includes("'") ? 0.42 : mods.includes('~') ? 1.12 : (opts.legato ?? 0.96);
        this.note(hand, b, pitches, dur, {
          len: dur * legato,
          vel: opts.vel ?? 1,
          accent: mods.includes('>') ? 0.14 : 0,
          roll: mods.includes('^') ? 0.03 : 0,
        });
      }
      b += dur;
    }
    return b;
  }

  /**
   * Broken-chord figure. `notes` is a list of pitches, `order` indexes into it, one entry
   * per `step` beats. Each note is held for `hold` beats (default: its step).
   */
  figure(hand, beat, notes, order, step, opts = {}) {
    const ms = notes.map((n) => (typeof n === 'number' ? n : noteToMidi(n)));
    order.forEach((idx, i) => {
      if (idx === null || idx === undefined) return;
      const hold = typeof opts.hold === 'function' ? opts.hold(i) : (opts.hold ?? step);
      this.note(hand, beat + i * step, ms[idx], hold, { len: hold * 0.98, vel: (opts.vel ?? 1) * (opts.shape ? opts.shape(i) : 1) });
    });
    return beat + order.length * step;
  }

  // ---------- Pedal ----------
  pedal(fromBeat, toBeat) { this.pedalsBeats.push([fromBeat, toBeat]); return this; }

  /**
   * Legato ("syncopated") pedalling: lift exactly as each new harmony sounds, catch it just after.
   * `changes` is a list of beats where the harmony changes; the last entry closes the final pedal.
   */
  pedalChanges(changes) {
    for (let i = 0; i < changes.length - 1; i++) {
      this.pedalsBeats.push([changes[i] + 0.12, changes[i + 1] + 0.04]);
    }
    return this;
  }

  /** Change pedal every `every` beats between two beats. */
  pedalEvery(from, to, every) {
    const ch = [];
    for (let b = from; b < to - 1e-9; b += every) ch.push(b);
    ch.push(to);
    return this.pedalChanges(ch);
  }

  // ---------- Render ----------
  build({ humanize = true } = {}) {
    const toSec = this.timeMap();
    const rand = rng(this.seed * 7919 + 17);
    const notes = [];

    // Group simultaneous notes per hand to voice chords like a pianist.
    const groups = new Map();
    for (const e of this.events) {
      const k = `${e.hand}@${e.beat.toFixed(4)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }

    for (const group of groups.values()) {
      group.sort((a, b) => a.midi - b.midi);
      const top = group[group.length - 1];
      const bottom = group[0];
      const jitter = humanize ? gauss(rand) * 0.005 : 0;
      group.forEach((e, idx) => {
        let vel = this.levelAt(e.beat) * e.vel * (1 + e.accent);
        if (group.length > 1) {
          if (e === top && e.hand === 'R') vel *= 1.12;           // bring out the melody
          else if (e === bottom && e.hand === 'L') vel *= 1.04;   // support from the bass
          else vel *= 0.88;                                       // inner voices recede
        }
        if (humanize) vel *= 1 + gauss(rand) * 0.035;
        // Map the score's dynamic scale onto the instrument: even pianissimo should
        // speak with a real (soft) hammer strike rather than fade into nothing.
        vel = 0.1 + vel * 0.95;
        let start = toSec(e.beat) + jitter;
        if (e.roll) start += idx * e.roll;
        else if (humanize && group.length > 1 && e === top && e.hand === 'R') start -= 0.008; // melody lead
        if (humanize) start += gauss(rand) * 0.003;
        const end = toSec(e.beat + e.len);
        notes.push({ midi: e.midi, vel: clamp(vel, 0.03, 1), start: Math.max(0, start), end: Math.max(end, start + 0.05), hand: e.hand });
      });
    }

    const pedals = this.pedalsBeats
      .map(([a, b]) => ({ start: toSec(a), end: toSec(b) }))
      .sort((a, b) => a.start - b.start);
    // Merge overlaps (the pedal is a single on/off state).
    const merged = [];
    for (const p of pedals) {
      const last = merged[merged.length - 1];
      if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
      else merged.push({ ...p });
    }
    const perf = finalize({ title: this.title, subtitle: this.subtitle, notes, pedals: merged });
    perf.meta = { autoPedal: false };
    return perf;
  }
}

/** Seconds spent over `beats` beats while the tempo moves linearly from v0 to v1 across `span` beats. */
function segDur(beats, v0, v1, span) {
  if (beats <= 0) return 0;
  if (Math.abs(v1 - v0) < 1e-9 || !isFinite(span)) return (60 * beats) / v0;
  const k = (v1 - v0) / span;          // bpm per beat
  const vb = v0 + k * beats;
  return (60 / k) * Math.log(vb / v0);
}
