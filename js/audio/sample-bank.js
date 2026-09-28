// Loads the Salamander Grand Piano V3 recordings (CC BY 3.0, Alexander Holm).
//
// The instrument was sampled every minor third (A0, C1, D#1, F#1, A1, ... C8) at
// several strike strengths. We ship four velocity layers (4, 8, 12 and 16 of the
// original 16) plus the 88 key-release recordings. Every played pitch is at most one
// semitone away from a real recording, so repitching artefacts are negligible.

import { synthesizePianoSample } from './synth-samples.js';

export const SAMPLED_NOTES = [];
for (let m = 21; m <= 108; m += 3) SAMPLED_NOTES.push(m);

const FILE_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const fileName = (midi) => FILE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);

// Layers in loudness order. `vel` is the nominal MIDI velocity each recording represents.
export const LAYERS = [
  { dir: 'v4', vel: 34 },
  { dir: 'v8', vel: 66 },
  { dir: 'v12', vel: 98 },
  { dir: 'v16', vel: 127 },
];

// Load the two middle layers first so the piano is playable as early as possible.
const LOAD_ORDER = [1, 2, 0, 3];

export class SampleBank {
  constructor(baseUrl = 'assets/samples/') {
    this.baseUrl = baseUrl;
    this.layers = LAYERS.map((l) => ({ ...l, buffers: new Map(), ready: false }));
    this.release = new Map(); // midi -> AudioBuffer
    this.synthetic = false;
    this.ready = false;
  }

  /** Available layers (in loudness order) that have finished loading. */
  readyLayers() {
    return this.layers.filter((l) => l.ready);
  }

  async load(ctx, onProgress = () => {}) {
    const total = SAMPLED_NOTES.length * LAYERS.length + 88;
    let done = 0;
    const tick = () => onProgress(++done / total);

    const fetchDecode = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = await res.arrayBuffer();
      return await ctx.decodeAudioData(data);
    };

    // Probe one file first: if the page was opened from disk (file://) fetch fails and
    // we fall back to the built-in synthesized piano instead of hanging.
    try {
      await fetchDecode(`${this.baseUrl}v8/${fileName(60)}.mp3`);
    } catch (err) {
      console.warn('Piano samples unavailable, using synthesized piano.', err);
      await this.buildSynthetic(ctx, onProgress);
      return;
    }

    let firstPlayable = null;
    const firstReady = new Promise((r) => (firstPlayable = r));

    const loadLayers = (async () => {
      for (const li of LOAD_ORDER) {
        const layer = this.layers[li];
        await Promise.all(SAMPLED_NOTES.map(async (midi) => {
          try {
            layer.buffers.set(midi, await fetchDecode(`${this.baseUrl}${layer.dir}/${fileName(midi)}.mp3`));
          } catch (e) {
            console.warn('Sample failed', layer.dir, midi, e);
          }
          tick();
        }));
        layer.ready = layer.buffers.size === SAMPLED_NOTES.length;
        if (layer.ready && !this.ready) { this.ready = true; firstPlayable(); }
      }
    })();

    const loadReleases = (async () => {
      const jobs = [];
      for (let k = 1; k <= 88; k++) {
        jobs.push(fetchDecode(`${this.baseUrl}release/rel${k}.mp3`)
          .then((b) => this.release.set(20 + k, b))
          .catch(() => {})
          .finally(tick));
      }
      await Promise.all(jobs);
    })();

    // Resolve as soon as one full layer is ready; the rest keeps streaming in.
    await Promise.race([firstReady, loadLayers.then(() => {
      if (!this.ready) throw new Error('No sample layer could be loaded');
    })]);
    this.fullyLoaded = Promise.all([loadLayers, loadReleases]);
  }

  async buildSynthetic(ctx, onProgress) {
    this.synthetic = true;
    // Two synthetic layers (soft / hard) generated offline with an additive model.
    this.layers = [
      { dir: 'synth-soft', vel: 50, buffers: new Map(), ready: false },
      { dir: 'synth-hard', vel: 120, buffers: new Map(), ready: false },
    ];
    let done = 0;
    const total = SAMPLED_NOTES.length * 2;
    for (const layer of this.layers) {
      for (const midi of SAMPLED_NOTES) {
        const ch = synthesizePianoSample(ctx.sampleRate, midi, layer.vel / 127);
        const buf = ctx.createBuffer(1, ch.length, ctx.sampleRate);
        buf.copyToChannel(ch, 0);
        layer.buffers.set(midi, buf);
        onProgress(++done / total);
        if (done % 6 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      }
      layer.ready = true;
    }
    this.ready = true;
    this.fullyLoaded = Promise.resolve();
  }

  /** Nearest recorded pitch for a key (always within one semitone). */
  static nearestSampled(midi) {
    const i = Math.round((midi - 21) / 3);
    return SAMPLED_NOTES[Math.max(0, Math.min(SAMPLED_NOTES.length - 1, i))];
  }
}
