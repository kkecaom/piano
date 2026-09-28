// Procedural room impulse responses for the ConvolverNode.
//
// Each room is a stereo, decorrelated noise tail with:
//   - a pre-delay and a handful of discrete early reflections,
//   - a smooth diffuse onset,
//   - frequency-dependent decay (high frequencies die away faster, as in real halls),
//   - an exponential envelope that reaches -60 dB at the room's RT60.

import { rng } from '../music/theory.js';

export const ROOMS = {
  studio:    { label: 'Studio',       rt60: 0.9, preDelay: 0.006, damping: 0.55, early: 0.55, size: 0.35 },
  salon:     { label: 'Salon',        rt60: 1.6, preDelay: 0.012, damping: 0.45, early: 0.5,  size: 0.55 },
  hall:      { label: 'Concert Hall', rt60: 2.6, preDelay: 0.022, damping: 0.4,  early: 0.45, size: 0.8 },
  cathedral: { label: 'Cathedral',    rt60: 5.5, preDelay: 0.035, damping: 0.32, early: 0.35, size: 1 },
};

/**
 * Build the impulse response as raw Float32Arrays (pure function: easy to test, reusable across contexts).
 */
export function renderImpulse(sampleRate, room, seed = 7) {
  const { rt60, preDelay, damping, early, size } = room;
  const length = Math.ceil(sampleRate * (rt60 * 1.15 + preDelay + 0.05));
  const channels = [new Float32Array(length), new Float32Array(length)];
  const rand = rng(seed);
  const pre = Math.floor(preDelay * sampleRate);
  const decayK = 6.907755 / rt60; // ln(1000): amplitude reaches -60 dB at rt60

  // Early reflections: sparse taps, slightly different per ear.
  const taps = 14;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < taps; i++) {
      const t = preDelay + (0.004 + Math.pow(rand(), 1.4) * 0.075 * (0.5 + size));
      const idx = Math.floor(t * sampleRate);
      if (idx >= length) continue;
      const amp = early * (0.9 - i / taps * 0.6) * (rand() < 0.5 ? -1 : 1) * Math.exp(-decayK * (t - preDelay) * 0.6);
      channels[c][idx] += amp * 0.6;
      if (idx + 1 < length) channels[c][idx + 1] += amp * 0.3; // tiny smear so taps are not clicks
    }
  }

  // Diffuse tail with time-varying one-pole low-pass (brightness falls as the tail decays).
  const onset = 0.018 + size * 0.03; // seconds for the diffuse field to build up
  for (let c = 0; c < 2; c++) {
    const ch = channels[c];
    let lp = 0;
    let lp2 = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp(-decayK * t) * (t < onset ? Math.sin((t / onset) * Math.PI / 2) : 1);
      // Cutoff glides from ~11 kHz down to ~1.2 kHz across the tail (damping controls how fast).
      const glide = Math.min(1, t / (rt60 * (1.1 - damping)));
      const fc = 11000 * Math.pow(1200 / 11000, glide);
      const a = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);
      const n = rand() * 2 - 1;
      lp += a * (n - lp);
      lp2 += a * (lp - lp2);
      ch[i] += lp2 * env * 1.6;
    }
  }

  // Remove DC and normalise energy so that switching rooms keeps a similar loudness.
  let energy = 0;
  for (let c = 0; c < 2; c++) {
    const ch = channels[c];
    let mean = 0;
    for (let i = 0; i < length; i++) mean += ch[i];
    mean /= length;
    for (let i = 0; i < length; i++) { ch[i] -= mean; energy += ch[i] * ch[i]; }
  }
  const norm = 1 / Math.sqrt(energy / 2 + 1e-9) * 0.9;
  for (const ch of channels) for (let i = 0; i < length; i++) ch[i] *= norm;
  return channels;
}

export function createImpulseBuffer(ctx, roomKey, roomOverride) {
  const room = roomOverride || ROOMS[roomKey] || ROOMS.hall;
  const [l, r] = renderImpulse(ctx.sampleRate, room);
  const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.copyToChannel(l, 0);
  buf.copyToChannel(r, 1);
  return buf;
}
