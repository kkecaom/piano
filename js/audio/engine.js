// Audio graph: sampler → tone shaping → (dry + hall reverb + pedal resonance) → glue compressor → limiter → out.
//
// The same class drives both the live AudioContext and an OfflineAudioContext used for
// exporting a performance to a WAV file, so what you hear is exactly what you export.

import { Sampler } from './sampler.js';
import { createImpulseBuffer, ROOMS } from './reverb.js';

export const DEFAULT_SOUND = {
  room: 'hall',
  reverb: 0.32,       // wet amount 0..1
  brightness: 0.6,    // 0..1
  stereoWidth: 0.7,   // 0..1
  releaseNoise: 0.5,  // 0..1 key/damper mechanics
  resonance: 0.5,     // sympathetic string resonance with the sustain pedal down
  volume: 0.8,
};

export class AudioEngine {
  /**
   * @param {BaseAudioContext} ctx
   * @param {import('./sample-bank.js').SampleBank} bank
   * @param {object} settings
   * @param {Map<string, AudioBuffer>} [irCache] reuse impulse responses between contexts
   */
  constructor(ctx, bank, settings = {}, irCache = new Map()) {
    this.ctx = ctx;
    this.bank = bank;
    this.irCache = irCache;
    this.settings = { ...DEFAULT_SOUND, ...settings };

    // Tone shaping on the piano bus.
    this.input = ctx.createGain();
    this.lowShelf = ctx.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 110;
    this.lowShelf.gain.value = 1.5;
    this.mud = ctx.createBiquadFilter();
    this.mud.type = 'peaking';
    this.mud.frequency.value = 280;
    this.mud.Q.value = 0.9;
    this.mud.gain.value = -1.5;
    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = 3200;
    this.presence.Q.value = 0.7;
    this.air = ctx.createBiquadFilter();
    this.air.type = 'highshelf';
    this.air.frequency.value = 9000;
    this.input.connect(this.lowShelf).connect(this.mud).connect(this.presence).connect(this.air);

    // Dry / wet.
    this.dry = ctx.createGain();
    this.reverbSend = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.reverbReturn = ctx.createGain();
    this.reverbHP = ctx.createBiquadFilter(); // keep the bass out of the reverb: clearer, less boom
    this.reverbHP.type = 'highpass';
    this.reverbHP.frequency.value = 180;
    this.air.connect(this.dry);
    this.air.connect(this.reverbSend).connect(this.reverbHP).connect(this.convolver).connect(this.reverbReturn);

    // Sympathetic resonance: with the dampers lifted, every string on the instrument
    // vibrates in sympathy. Modelled as a bright, short "soundboard" room whose send
    // opens only while the sustain pedal is down.
    this.resSend = ctx.createGain();
    this.resSend.gain.value = 0;
    this.resConvolver = ctx.createConvolver();
    this.resConvolver.buffer = this.impulse('soundboard');
    this.resReturn = ctx.createGain();
    this.air.connect(this.resSend).connect(this.resConvolver).connect(this.resReturn);

    // Glue compression and a safety limiter.
    this.bus = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 2.2;
    this.comp.attack.value = 0.025;
    this.comp.release.value = 0.3;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.dry.connect(this.bus);
    this.reverbReturn.connect(this.bus);
    this.resReturn.connect(this.bus);
    this.bus.connect(this.comp).connect(this.limiter).connect(this.master);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);
    this.master.connect(ctx.destination);

    this.sampler = new Sampler(ctx, bank, this.input);
    this.applySettings(this.settings);
  }

  impulse(key) {
    const cacheKey = `${key}@${this.ctx.sampleRate}`;
    if (!this.irCache.has(cacheKey)) {
      const room = key === 'soundboard'
        ? { rt60: 1.4, preDelay: 0.001, damping: 0.25, early: 0.2, size: 0.1 }
        : ROOMS[key];
      this.irCache.set(cacheKey, createImpulseBuffer(this.ctx, room ? key : 'hall', room));
    }
    return this.irCache.get(cacheKey);
  }

  applySettings(patch) {
    const s = Object.assign(this.settings, patch);
    const t = this.ctx.currentTime;
    if ('room' in patch) this.convolver.buffer = this.impulse(s.room);
    // Keep perceived loudness roughly constant as the wet amount changes.
    this.dry.gain.setTargetAtTime(1 - s.reverb * 0.35, t, 0.03);
    this.reverbSend.gain.setTargetAtTime(1, t, 0.03);
    this.reverbReturn.gain.setTargetAtTime(s.reverb * 0.9, t, 0.03);
    this.presence.gain.setTargetAtTime((s.brightness - 0.5) * 3, t, 0.03);
    this.air.gain.setTargetAtTime((s.brightness - 0.5) * 6, t, 0.03);
    this.master.gain.setTargetAtTime(Math.pow(s.volume, 1.6) * 1.1, t, 0.03);
    this.sampler.brightness = s.brightness;
    this.sampler.releaseNoise = s.releaseNoise;
    if ('stereoWidth' in patch) this.sampler.setStereoWidth(s.stereoWidth);
  }

  /** Sustain pedal state change at time `when` (drives sympathetic resonance). */
  pedal(down, when) {
    const g = this.resSend.gain;
    when = Math.max(when, this.ctx.currentTime);
    g.cancelScheduledValues(when);
    g.setTargetAtTime(down ? this.settings.resonance * 0.16 : 0, when, down ? 0.06 : 0.12);
  }

  get currentTime() { return this.ctx.currentTime; }
}
