// Polyphonic, velocity-layered piano sampler.
//
// Per voice:   layer A source ─ gain ┐
//              layer B source ─ gain ┴─ low-pass (velocity/brightness) ─ envelope ─ per-key pan ─ out
//
// Behaviour modelled after a real grand:
//   - equal-power crossfade between the two recorded strike strengths around the velocity,
//     plus a continuous velocity-dependent tone filter, so dynamics are smooth, not stepped;
//   - dampers: releasing a key damps the string with a pitch-dependent time constant
//     (heavy bass strings take longer to stop); the top ~20 keys have no dampers and ring on;
//   - re-striking a key that is still sounding replaces the old vibration;
//   - key-release / damper noise from the Salamander release recordings;
//   - voice stealing so dense passages never overload the audio thread.

import { SampleBank } from './sample-bank.js';

const UNDAMPED_FROM = 89; // F6 and above: no dampers on a concert grand
const MAX_VOICES = 110;

export class Sampler {
  constructor(ctx, bank, destination) {
    this.ctx = ctx;
    this.bank = bank;
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
    this.output.connect(destination);
    this.voices = [];
    this.byKey = new Map();
    this.brightness = 0.6;
    this.releaseNoise = 0.5;
    this.stereoWidth = 0.7;
    this.panners = new Map();
    this.maxVoices = MAX_VOICES;
  }

  setStereoWidth(w) {
    this.stereoWidth = w;
    for (const [midi, p] of this.panners) p.pan.value = this.panFor(midi);
  }

  panFor(midi) {
    // Player's perspective: bass to the left, treble to the right.
    return Math.max(-1, Math.min(1, ((midi - 64.5) / 43.5) * this.stereoWidth * 0.75));
  }

  panner(midi) {
    let p = this.panners.get(midi);
    if (!p) {
      p = this.ctx.createStereoPanner();
      p.pan.value = this.panFor(midi);
      p.connect(this.output);
      this.panners.set(midi, p);
    }
    return p;
  }

  /** Choose up to two layers and their equal-power weights for a velocity (0..1). */
  layerMix(velocity) {
    const layers = this.bank.readyLayers();
    const v = Math.max(1, velocity * 127);
    if (layers.length === 1) return [{ layer: layers[0], gain: Math.min(1, v / layers[0].vel) }];
    if (v <= layers[0].vel) {
      // Below the softest recording: attenuate that recording further.
      return [{ layer: layers[0], gain: Math.pow(v / layers[0].vel, 1.25) }];
    }
    for (let i = 0; i < layers.length - 1; i++) {
      const a = layers[i], b = layers[i + 1];
      if (v <= b.vel) {
        const x = (v - a.vel) / (b.vel - a.vel);
        if (x < 0.06) return [{ layer: a, gain: 1 }];
        if (x > 0.94) return [{ layer: b, gain: 1 }];
        return [
          { layer: a, gain: Math.cos(x * Math.PI / 2) },
          { layer: b, gain: Math.sin(x * Math.PI / 2) },
        ];
      }
    }
    return [{ layer: layers[layers.length - 1], gain: 1 }];
  }

  /**
   * Strike a key.
   * @param {number} midi 21..108
   * @param {number} velocity 0..1
   * @param {number} when AudioContext time
   * @returns {Voice|null}
   */
  noteOn(midi, velocity, when) {
    if (!this.bank.ready || midi < 21 || midi > 108) return null;
    const ctx = this.ctx;
    when = Math.max(when, ctx.currentTime);

    // A re-struck string replaces its previous vibration.
    const prev = this.byKey.get(midi);
    if (prev) for (const v of prev) v.release(when, 0.09, false);

    const base = SampleBank.nearestSampled(midi);
    const rate = Math.pow(2, (midi - base) / 12);
    const v01 = Math.max(0.01, Math.min(1, velocity));

    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = -2;
    const bright = 0.5 + this.brightness;
    filter.frequency.value = Math.min(20000, 1150 * bright * Math.pow(2, v01 * 4.2) * Math.pow(2, (midi - 60) / 36));
    filter.connect(env);
    env.connect(this.panner(midi));
    env.gain.setValueAtTime(1, when);

    const sources = [];
    let end = when;
    for (const { layer, gain } of this.layerMix(v01)) {
      const buffer = layer.buffers.get(base);
      if (!buffer) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(filter);
      src.start(when);
      sources.push(src);
      end = Math.max(end, when + buffer.duration / rate);
    }
    if (!sources.length) return null;

    // Smooth out the very end of the recording in case a note is held beyond it.
    const fadeStart = end - 0.35;
    if (fadeStart > when + 0.05) {
      env.gain.setValueAtTime(1, fadeStart);
      env.gain.linearRampToValueAtTime(0, end - 0.01);
    }

    const voice = new Voice(this, midi, v01, when, end, sources, env, filter);
    sources[0].onended = () => voice.dispose();
    this.voices.push(voice);
    if (!this.byKey.has(midi)) this.byKey.set(midi, new Set());
    this.byKey.get(midi).add(voice);

    if (this.voices.length > this.maxVoices) this.steal(when);
    return voice;
  }

  steal(when) {
    // Prefer voices already damped, then the oldest/quietest.
    let best = null, bestScore = Infinity;
    for (const v of this.voices) {
      if (v.stolen || v.start >= when) continue;
      const age = when - v.start;
      const score = (v.releasedAt <= when ? -100 : 0) + v.velocity * 10 - age;
      if (score < bestScore) { bestScore = score; best = v; }
    }
    if (best) { best.stolen = true; best.release(when, 0.03, false); }
  }

  playReleaseNoise(midi, velocity, when) {
    if (this.releaseNoise <= 0) return;
    const buf = this.bank.release.get(midi);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = this.releaseNoise * 0.22 * (0.35 + 0.65 * velocity);
    src.connect(g).connect(this.panner(midi));
    src.start(when);
  }

  /** Damp everything (used on pause / seek / stop). */
  allNotesOff(when = this.ctx.currentTime, tau = 0.04) {
    for (const v of this.voices) v.release(when, tau, false, true);
  }
}

class Voice {
  constructor(sampler, midi, velocity, start, end, sources, env, filter) {
    this.sampler = sampler;
    this.midi = midi;
    this.velocity = velocity;
    this.start = start;
    this.end = end;
    this.sources = sources;
    this.env = env;
    this.filter = filter;
    this.releasedAt = Infinity;
    this.disposed = false;
    this.stolen = false;
  }

  /**
   * Damp the string at `when`. Calling again with a later time is a no-op; an earlier
   * time wins (e.g. a re-strike or a seek overrides a pedal-held release).
   * @param {number} when
   * @param {number} [tau] exponential time constant; defaults to a pitch-dependent damper time
   * @param {boolean} [noise] play key-release noise
   * @param {boolean} [force] damp even undamped (top-octave) strings
   */
  release(when, tau, noise = true, force = false) {
    if (this.disposed) return;
    const ctx = this.sampler.ctx;
    when = Math.max(when, this.start, ctx.currentTime);
    if (when >= this.releasedAt) return;
    const undamped = this.midi >= UNDAMPED_FROM && tau === undefined && !force;
    if (noise && when - this.start > 0.06) this.sampler.playReleaseNoise(this.midi, this.velocity, when);
    if (undamped) return; // no damper: let it ring out naturally
    if (tau === undefined) {
      const lowness = (108 - this.midi) / 87;
      tau = 0.035 + 0.24 * lowness * lowness;
    }
    this.releasedAt = when;
    const g = this.env.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(when);
    else g.cancelScheduledValues(when);
    g.setTargetAtTime(0, when, tau);
    const stopAt = when + tau * 9;
    if (stopAt < this.end) for (const s of this.sources) s.stop(stopAt);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const s = this.sampler;
    const i = s.voices.indexOf(this);
    if (i >= 0) s.voices.splice(i, 1);
    s.byKey.get(this.midi)?.delete(this);
    try { this.env.disconnect(); } catch { /* already disconnected */ }
  }
}
