// Fallback piano tone generator, used only when the recorded samples cannot be fetched
// (for example when index.html is opened straight from disk). It renders a short
// "sample" per sampled pitch with an additive model of a struck string:
//   - stretched (inharmonic) partials: f_n = n f0 sqrt(1 + B n^2),
//   - per-partial two-stage decay (fast "prompt" sound + slow "aftersound"),
//   - three slightly detuned strings per note (beating, chorus),
//   - hammer position comb filtering and a short felt-thump noise burst.

import { midiToFreq, rng } from '../music/theory.js';

export function synthesizePianoSample(sampleRate, midi, velocity) {
  const f0 = midiToFreq(midi);
  const dur = Math.max(1.8, Math.min(6.5, 8 - (midi - 21) * 0.075));
  const n = Math.floor(dur * sampleRate);
  const out = new Float32Array(n);
  const rand = rng(midi * 131 + Math.round(velocity * 100));

  const B = 0.00008 * Math.pow(2, (midi - 21) / 20);          // inharmonicity grows up the keyboard
  const maxPartials = Math.min(18, Math.floor((sampleRate * 0.45) / f0));
  const brightness = 0.35 + velocity * 0.65;
  const hammerPos = 1 / 7.3;
  const detune = [0, 0.9];

  for (let k = 1; k <= maxPartials; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > sampleRate * 0.45) break;
    // Spectral envelope: hammer comb filter * roll-off depending on strike strength.
    const comb = Math.abs(Math.sin(Math.PI * k * hammerPos)) + 0.08;
    const rolloff = Math.pow(k, -(1.9 - brightness * 1.1)) * Math.exp(-(fk / (1800 + 9000 * brightness)));
    const amp = comb * rolloff;
    if (amp < 1e-4) continue;
    const fastT = 0.25 + 1.2 / (1 + fk / 400);
    const slowT = (2.5 + 18 / (1 + fk / 150)) * (1.3 - (midi - 21) / 150);
    const d1 = Math.exp(-1 / (fastT * sampleRate));
    const d2 = Math.exp(-1 / (slowT * sampleRate));
    const strings = midi >= 32 && k <= 6 ? 2 : 1; // detuned unison only where beating is audible
    const phase0 = rand() * Math.PI * 2;
    for (let s = 0; s < strings; s++) {
      const f = fk * (1 + detune[s] * 0.0009 * (1 + k * 0.02));
      const w = (2 * Math.PI * f) / sampleRate;
      const a = amp / strings;
      // Oscillator by complex rotation, envelopes by recurrence: no per-sample sin/exp calls.
      const cw = Math.cos(w), sw = Math.sin(w);
      let x = Math.cos(phase0 + s * 0.7), y = Math.sin(phase0 + s * 0.7);
      let e1 = 0.65 * a, e2 = 0.35 * a;
      for (let i = 0; i < n; i++) {
        out[i] += (e1 + e2) * y;
        const nx = x * cw - y * sw;
        y = x * sw + y * cw;
        x = nx;
        e1 *= d1; e2 *= d2;
      }
    }
  }

  // Hammer thump: very short low-passed noise burst.
  let lp = 0;
  const thumpLen = Math.floor(0.03 * sampleRate);
  for (let i = 0; i < thumpLen; i++) {
    lp += 0.08 * ((rand() * 2 - 1) - lp);
    out[i] += lp * 0.5 * velocity * (1 - i / thumpLen);
  }

  // Soft attack (2 ms), fade the tail, normalise.
  const att = Math.floor(0.002 * sampleRate);
  for (let i = 0; i < att; i++) out[i] *= i / att;
  const fade = Math.floor(0.2 * sampleRate);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = (0.25 + 0.65 * velocity) / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}
