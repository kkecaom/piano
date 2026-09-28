// Small music-theory helpers shared by the audio engine, the notation parser and the UI.

export const MIDI_MIN = 21;   // A0, lowest key on an 88-key piano
export const MIDI_MAX = 108;  // C8, highest key

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" / "Bb3" / "E##5" / "Cb4" -> MIDI number (C4 = 60). */
export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#sb]*)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  let n = LETTER[m[1].toUpperCase()];
  for (const ch of m[2]) n += ch === 'b' ? -1 : 1;
  return n + (parseInt(m[3], 10) + 1) * 12;
}

export function midiToName(midi) {
  return NAMES_SHARP[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function isBlack(midi) {
  const pc = midi % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Deterministic PRNG (mulberry32) so humanisation and generated music are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roughly normal random number (mean 0, sd 1) from a uniform generator. */
export function gauss(rand) {
  return (rand() + rand() + rand() + rand() - 2) * 1.2247;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
