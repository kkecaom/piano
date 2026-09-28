// "Reverie": an algorithmic composer that writes a new, complete piano piece from a seed.
//
// It works like a songwriter rather than a random note generator:
//   - picks a key, metre, tempo and two contrasting chord progressions (8-bar periods
//     that end with a real cadence);
//   - invents a one-bar rhythmic motif and develops it: statement, variation,
//     sequence on the new harmony, cadence;
//   - melody notes on strong beats are chord tones, weak beats move by step;
//   - form: intro · A · B · A' (octave up, harmonised in thirds/sixths) · climax
//     (melody in octaves over octave bass) · A'' (hushed) · coda with a borrowed chord;
//   - expressive tempo (phrase-end ritardandi), dynamics arcs and legato pedalling.

import { Score } from './score.js';
import { rng } from './theory.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Each progression is [phrase 1, phrase 2]; entries are scale degrees (0 = tonic),
// a nested pair means two chords in one bar.
const PROGRESSIONS = {
  major: [
    [[0, 4, 5, 3], [0, 4, [3, 4], 0]],
    [[5, 3, 0, 4], [5, 3, [1, 4], 0]],
    [[3, 4, 2, 5], [3, 4, [1, 4], 0]],
    [[0, 2, 3, 4], [0, 2, [3, 4], 0]],
    [[0, 5, 3, 4], [0, 5, [1, 4], 0]],
    [[3, 0, 4, 5], [3, 0, [1, 4], 0]],
  ],
  minor: [
    [[0, 5, 2, 6], [0, 5, [3, 4], 0]],
    [[5, 6, 0, 2], [5, 6, [3, 4], 0]],
    [[0, 3, 6, 2], [5, 3, [4, 4], 0]],
    [[0, 6, 5, 4], [0, 6, [5, 4], 0]],
  ],
};

const RHYTHMS = {
  4: {
    motif: [[1.5, 0.5, 1, 1], [1, 0.5, 0.5, 2], [-1, 0.5, 0.5, 1.5, 0.5], [2, 1, 1], [1, 1, 1.5, 0.5],
      [-0.5, 0.5, 0.5, 0.5, 1.5, 0.5], [1.5, 0.5, 2], [0.5, 0.5, 1, 1, 1]],
    cadence: [[2, 2], [1, 1, 2], [4], [1.5, 0.5, 2], [3, 1]],
  },
  3: {
    motif: [[1.5, 0.5, 1], [2, 1], [1, 1, 1], [-1, 1, 1], [1, 0.5, 0.5, 1], [0.5, 0.5, 2]],
    cadence: [[3], [1, 2], [2, 1]],
  },
};

export function composeReverie(seed = 1) {
  const rand = rng(seed * 9973 + 3);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const minor = rand() < 0.32;
  const scale = minor ? MINOR : MAJOR;
  const tonicPc = minor ? pick([9, 4, 2, 11, 0, 7]) : pick([1, 3, 8, 10, 0, 5, 2, 7]);
  const meter = rand() < 0.3 ? 3 : 4;
  const bpm = meter === 3 ? 72 + Math.floor(rand() * 12) : 58 + Math.floor(rand() * 14);
  const tonic4 = 60 + tonicPc > 66 ? 48 + tonicPc : 60 + tonicPc; // tonic near middle C
  const [progA, progB] = (() => {
    const list = PROGRESSIONS[minor ? 'minor' : 'major'];
    const a = pick(list);
    let b = pick(list);
    for (let i = 0; i < 6 && b === a; i++) b = pick(list);
    return [a, b];
  })();

  const keyName = `${KEY_NAMES[tonicPc]} ${minor ? 'minor' : 'major'}`;
  const s = new Score({
    title: `Reverie No. ${seed}`,
    subtitle: `Improvised by Nocturne · ${keyName}`,
    bpm, beatsPerBar: meter, seed,
  });

  // ----- pitch helpers (melody lives in scale-step space) -----
  const midiOf = (step) => tonic4 + Math.floor(step / 7) * 12 + scale[((step % 7) + 7) % 7];
  const degreeOf = (step) => ((step % 7) + 7) % 7;
  let melLo = 0;
  while (midiOf(melLo) < 63) melLo++;
  const melHi = melLo + 10;

  const chordDegrees = (deg) => [deg % 7, (deg + 2) % 7, (deg + 4) % 7];
  const isChordTone = (step, deg) => chordDegrees(deg).includes(degreeOf(step));
  // Minor keys use a major dominant: raise the 7th degree over chord V.
  const melodyMidi = (step, deg) => {
    let m = midiOf(step);
    if (minor && deg === 4 && degreeOf(step) === 6) m += 1;
    return m;
  };

  // Left-hand voicing: root, fifth, octave, (ninth), tenth.
  const lhVoicing = (deg) => {
    const rootPc = (tonicPc + scale[deg]) % 12;
    let root = 36 + ((rootPc - 36 % 12 + 12) % 12);
    if (root > 45) root -= 12;
    if (root < 34) root += 12;
    const third = (scale[(deg + 2) % 7] - scale[deg] + 12) % 12 + (minor && deg === 4 ? 1 : 0);
    const fifth = (scale[(deg + 4) % 7] - scale[deg] + 12) % 12;
    const ninthOk = !(deg === 2 && !minor) && !(deg === 6 && !minor) && !(minor && (deg === 4 || deg === 1));
    const ninth = (scale[(deg + 1) % 7] - scale[deg] + 12) % 12 + 12;
    return [root, root + fifth, root + 12, ninthOk ? root + ninth : root + fifth + 12, root + 12 + third];
  };

  // ----- melody invention -----
  const chooseChordTone = (prev, deg, dir) => {
    let best = null, bestScore = Infinity;
    for (let st = melLo; st <= melHi; st++) {
      if (!isChordTone(st, deg)) continue;
      const leap = Math.abs(st - prev);
      if (leap > 5) continue;
      const score = Math.abs(st - (prev + dir * 2)) + (st === prev ? 1.2 : 0) + rand() * 1.1;
      if (score < bestScore) { bestScore = score; best = st; }
    }
    return best ?? Math.max(melLo, Math.min(melHi, prev));
  };

  const strongBeat = (t) => (meter === 4 ? Math.abs(t % 2) < 1e-6 : Math.abs(t) < 1e-6);

  /** Fill one bar of melody over `deg` with a rhythm; returns [{t, dur, step}]. */
  const inventBar = (rhythm, deg, prev, dir) => {
    const out = [];
    let t = 0;
    for (const d of rhythm) {
      const dur = Math.abs(d);
      if (d > 0) {
        let st;
        if (strongBeat(t) || !out.length) st = chooseChordTone(prev, deg, dir);
        else {
          const r = rand();
          st = prev + (r < 0.72 ? dir : r < 0.88 ? -dir : 2 * dir);
          st = Math.max(melLo, Math.min(melHi, st));
        }
        if (st >= melHi - 1) dir = -1;
        if (st <= melLo + 1) dir = 1;
        out.push({ t, dur, step: st });
        prev = st;
      }
      t += dur;
    }
    return out;
  };

  /** Repeat a bar's shape on a new harmony (a melodic sequence), snapping strong beats to chord tones. */
  const sequenceBar = (model, deg, prev) => {
    if (!model.length) return model;
    const start = chooseChordTone(prev, deg, model[0].step >= prev ? 1 : -1);
    const shift = start - model[0].step;
    return model.map((n) => {
      let st = Math.max(melLo, Math.min(melHi, n.step + shift));
      if (strongBeat(n.t) && !isChordTone(st, deg)) st += isChordTone(st + 1, deg) ? 1 : -1;
      return { ...n, step: st };
    });
  };

  const cadenceBar = (deg, prev, closed) => {
    const rhythm = pick(RHYTHMS[meter].cadence);
    const targets = closed && deg === 0 ? [0, 7] : chordDegrees(deg).slice(1);
    let goal = null, bestD = Infinity;
    for (let st = melLo; st <= melHi; st++) {
      if (!targets.includes(degreeOf(st)) && !(closed && degreeOf(st) === 0 && deg === 0)) continue;
      const dd = Math.abs(st - prev) + (st > prev ? 0.3 : 0);
      if (dd < bestD) { bestD = dd; goal = st; }
    }
    goal ??= prev;
    const notes = [];
    let t = 0;
    rhythm.forEach((d, i) => {
      const last = i === rhythm.length - 1;
      let st = last ? goal : goal + (rhythm.length - 1 - i) * (prev > goal ? 1 : -1);
      if (!last && strongBeat(t) && !isChordTone(st, deg)) st = goal + (prev > goal ? 2 : -2);
      notes.push({ t, dur: d, step: Math.max(melLo, Math.min(melHi, st)) });
      t += d;
    });
    return notes;
  };

  /** A full 8-bar period: returns bars as [{ chords: [deg...], mel: [...] }]. */
  const invent = (prog) => {
    const bars = [];
    let prev = melLo + 4 + Math.floor(rand() * 3);
    const motif = pick(RHYTHMS[meter].motif);
    const answer = rand() < 0.5 ? motif : pick(RHYTHMS[meter].motif);
    let model = null;
    prog.forEach((phrase, pi) => {
      phrase.forEach((entry, bi) => {
        const chords = Array.isArray(entry) ? entry : [entry];
        const deg = chords[0];
        let mel;
        const dir = bi < 2 ? 1 : -1;
        if (bi === 0) { mel = inventBar(motif, deg, prev, rand() < 0.75 ? 1 : -1); if (pi === 0) model = mel; }
        else if (bi === 1) mel = inventBar(answer, deg, prev, dir);
        else if (bi === 2) mel = sequenceBar(pi === 0 ? model : bars[2].mel, deg, prev);
        else mel = cadenceBar(chords[chords.length - 1], prev, pi === prog.length - 1);
        if (pi === 1 && bi === 0) mel = sequenceBar(model, deg, bars[0].mel[0]?.step ?? prev);
        if (mel.length) prev = mel[mel.length - 1].step;
        bars.push({ chords, mel });
      });
    });
    return bars;
  };

  const themeA = invent(progA);
  const themeB = invent(progB);

  // ----- writing it out -----
  let bar = 1;
  const pedal = [];
  const writeLH = (chords, style, vel) => {
    const per = meter / chords.length;
    chords.forEach((deg, i) => {
      const v = lhVoicing(deg);
      const b = s.bar(bar) + i * per;
      pedal.push(b);
      if (style === 'block') {
        s.note('L', b, [v[0], v[1], v[2]], per, { len: per, vel, roll: 0.035 });
      } else if (style === 'octave') {
        s.note('L', b, [v[0] - 12, v[0]], per, { len: per * 0.98, vel: vel * 1.15 });
        const ord = meter === 4 ? (per === 4 ? [1, 2, 4, 3, 2, 4, 3] : [1, 2, 4]) : (per === 3 ? [1, 2, 4, 2, 1] : [1]);
        s.figure('L', b + 0.5, v, ord.slice(0, per * 2 - 1), 0.5, { hold: 0.5, vel: vel * 0.8 });
      } else if (style === 'flow') {
        const base = meter === 4 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 1, 2, 3, 4, 3];
        const ord = [...base, ...base].slice(0, per * 4);
        s.figure('L', b, v, ord, 0.25, { hold: (k) => (k === 0 ? per : 0.25), vel, shape: (k) => (k === 0 ? 1.2 : k % 4 === 0 ? 0.95 : 0.85) });
      } else {
        const base = meter === 4 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 1, 2, 4, 2, 1];
        s.figure('L', b, v, base.slice(0, per * 2), 0.5, { hold: (k) => (k === 0 ? per : 0.5), vel, shape: (k) => (k === 0 ? 1.15 : 0.9) });
      }
    });
  };

  const writeMelody = (mel, deg, { octave = 0, vel = 1, harmonize = false, octaves = false } = {}) => {
    const b0 = s.bar(bar);
    for (const n of mel) {
      const m = melodyMidi(n.step, deg) + octave * 12;
      const pitches = [m];
      if (octaves) pitches.push(m - 12);
      if (harmonize && n.dur >= 1 && strongBeat(n.t)) {
        for (const gap of [2, 5, 3]) {
          const low = n.step - gap;
          if (isChordTone(low, deg)) { pitches.push(melodyMidi(low, deg) + octave * 12); break; }
        }
      }
      s.note('R', b0 + n.t, pitches, n.dur, { len: n.dur * 0.97, vel, accent: strongBeat(n.t) ? 0.05 : 0 });
    }
  };

  const section = (theme, style, lhVel, opts = {}) => {
    for (const b of theme) {
      writeLH(b.chords, style, lhVel);
      writeMelody(b.mel, b.chords[0], opts);
      bar++;
    }
  };

  const phraseArc = (startBar, bars, base, peak) => {
    s.dyn(s.bar(startBar), base);
    s.dyn(s.bar(startBar + Math.floor(bars * 0.6)), peak);
    s.dyn(s.bar(startBar + bars) - 0.5, base);
  };

  const ritTo = (factor) => {
    const end = s.bar(bar);
    s.ramp(end - meter, end, bpm * factor).tempo(end, bpm);
  };

  // Intro: two bars of accompaniment with a few high bell tones.
  s.dyn(0, 0.28);
  for (const deg of [0, minor ? 5 : 3]) {
    writeLH([deg], 'arp', 0.5);
    const v = lhVoicing(deg);
    s.note('R', s.bar(bar) + meter - 1, v[4] + 24, 1, { vel: 0.55 });
    bar++;
  }
  phraseArc(bar, 8, 0.36, 0.46);
  section(themeA, 'arp', 0.56);
  ritTo(0.9);
  phraseArc(bar, 8, 0.44, 0.56);
  section(themeB, 'arp', 0.6);
  ritTo(0.9);
  phraseArc(bar, 8, 0.5, 0.62);
  section(themeA, 'flow', 0.52, { octave: 1, harmonize: true });
  ritTo(0.85);
  phraseArc(bar, 8, 0.62, 0.74);
  section(themeB, 'octave', 0.62, { octave: 1, octaves: true, harmonize: true });
  ritTo(0.8);
  phraseArc(bar, 8, 0.3, 0.36);
  section(themeA, 'block', 0.45, { octave: 1, vel: 0.9 });
  ritTo(0.9);

  // Coda: IV – iv (borrowed) – I, slowing down.
  const coda = bar;
  s.dyn(s.bar(coda), 0.3).dyn(s.bar(coda + 3), 0.22);
  s.ramp(s.bar(coda), s.bar(coda + 3), bpm * 0.7);
  let codaStep = melLo + 6;
  const codaNote = (deg, borrowed = false) => {
    codaStep = chooseChordTone(codaStep, deg, -1);
    // The borrowed iv lowers the chord's third (the 6th degree of the key).
    return melodyMidi(codaStep, deg) + 12 - (borrowed && degreeOf(codaStep) === 5 ? 1 : 0);
  };
  writeLH([3], 'arp', 0.46);
  s.note('R', s.bar(bar), [codaNote(3)], meter, { len: meter, vel: 0.75 });
  bar++;
  // Borrowed minor subdominant (major keys); minor keys simply keep their iv.
  const iv = lhVoicing(3).map((m, i) => (!minor && i === 4 ? m - 1 : m));
  pedal.push(s.bar(bar));
  s.figure('L', s.bar(bar), iv, (meter === 4 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 1, 2, 4, 2, 1]), 0.5, { hold: (k) => (k === 0 ? meter : 0.5), vel: 0.42 });
  s.note('R', s.bar(bar), [codaNote(3, !minor)], meter, { len: meter, vel: 0.7 });
  bar++;
  writeLH([0], 'arp', 0.4);
  s.note('R', s.bar(bar), [codaNote(0)], meter, { len: meter, vel: 0.7 });
  bar++;
  const end = s.bar(bar);
  const tonicLow = lhVoicing(0);
  s.note('L', end, [tonicLow[0], tonicLow[1], tonicLow[2]], meter * 2, { len: meter * 2, vel: 0.85, roll: 0.04 });
  const topChord = [7, 9, 11, 14].map((st) => midiOf(st));
  s.note('R', end, topChord, meter * 2, { len: meter * 2, vel: 0.8, roll: 0.05 });
  s.dyn(end, 0.22);
  pedal.push(end);
  s.pedalChanges(pedal);
  s.pedal(end + 0.1, end + meter * 2 + 3);

  const perf = s.build();
  perf.meta.generated = true;
  perf.meta.key = keyName;
  return perf;
}
