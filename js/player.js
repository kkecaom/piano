// Sample-accurate playback scheduler.
//
// A timer (in a Worker, so it keeps running in background tabs) wakes every ~20 ms and
// schedules every note that begins within the next LOOKAHEAD seconds directly on the
// AudioContext clock. Damper releases are scheduled the same way, so tempo changes,
// pauses and seeks always stay consistent with what is sounding.

const LOOKAHEAD = 0.22;
const START_DELAY = 0.06;
const END_TAIL = 2.2;

function makeTimer(cb) {
  try {
    const src = 'let id=null;onmessage=e=>{if(e.data==="start"){if(id===null)id=setInterval(()=>postMessage(0),20);}else{clearInterval(id);id=null;}};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = cb;
    return { start: () => w.postMessage('start'), stop: () => w.postMessage('stop') };
  } catch {
    let id = null;
    return {
      start: () => { if (id === null) id = setInterval(cb, 20); },
      stop: () => { clearInterval(id); id = null; },
    };
  }
}

export class Player extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.perf = null;
    this.playing = false;
    this.rate = 1;
    this.transpose = 0;
    this.usePedal = true;
    this.muted = { L: false, R: false };
    this.position = 0;
    this.anchorCtx = 0;
    this.anchorSong = 0;
    this.nextNote = 0;
    this.nextPedal = 0;
    this.pending = [];
    this.pedalEdges = [];
    this.timer = makeTimer(() => this.tick());
  }

  get ctx() { return this.engine.ctx; }

  load(perf) {
    this.stopSound();
    this.perf = perf;
    this.position = 0;
    this.pedalEdges = [];
    for (const p of perf.pedals) {
      this.pedalEdges.push({ time: p.start, down: true });
      this.pedalEdges.push({ time: p.end, down: false });
    }
    this.pedalEdges.sort((a, b) => a.time - b.time);
    this.emit('load');
  }

  get duration() { return this.perf ? this.perf.duration : 0; }

  songAt(ctxTime) { return this.anchorSong + (ctxTime - this.anchorCtx) * this.rate; }
  ctxAt(songTime) { return this.anchorCtx + (songTime - this.anchorSong) / this.rate; }

  /** Current position as heard (compensates for output latency), for visuals. */
  get time() {
    if (!this.playing) return this.position;
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.max(this.anchorSong, this.songAt(this.ctx.currentTime - latency));
  }

  play() {
    if (!this.perf || this.playing) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (this.position >= this.duration) this.position = 0;
    this.anchorCtx = this.ctx.currentTime + START_DELAY;
    this.anchorSong = this.position;
    this.resetCursors(this.position);
    this.playing = true;
    this.timer.start();
    this.tick();
    this.emit('state');
  }

  pause() {
    if (!this.playing) return;
    this.position = Math.min(this.duration, this.songAt(this.ctx.currentTime));
    this.playing = false;
    this.timer.stop();
    this.stopSound();
    this.emit('state');
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    if (!this.perf) return;
    t = Math.max(0, Math.min(this.duration, t));
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.stopSound();
      this.anchorCtx = this.ctx.currentTime + 0.03;
      this.anchorSong = t;
      this.resetCursors(t);
      this.tick();
    }
    this.position = t;
    this.emit('seek');
  }

  setRate(r) {
    if (this.playing) {
      const now = this.ctx.currentTime;
      this.anchorSong = this.songAt(now);
      this.anchorCtx = now;
    }
    this.rate = r;
  }

  setTranspose(n) {
    this.transpose = n;
    // Voices already sounding keep their pitch; new notes use the new transposition.
  }

  resetCursors(t) {
    const notes = this.perf.notes;
    let lo = 0, hi = notes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].start < t - 1e-4) lo = m + 1; else hi = m; }
    this.nextNote = lo;
    this.nextPedal = 0;
    while (this.nextPedal < this.pedalEdges.length && this.pedalEdges[this.nextPedal].time < t) this.nextPedal++;
    // Restore the pedal state at the seek point.
    const down = this.usePedal && this.perf.pedals.some((p) => p.start <= t && t < p.end);
    this.engine.pedal(down, this.ctx.currentTime);
    this.pending = [];
  }

  stopSound() {
    this.engine.sampler.allNotesOff(this.ctx.currentTime, 0.05);
    this.engine.pedal(false, this.ctx.currentTime);
    this.pending = [];
  }

  tick() {
    if (!this.playing || !this.perf) return;
    const now = this.ctx.currentTime;
    const horizon = this.songAt(now + LOOKAHEAD);
    const notes = this.perf.notes;
    const sampler = this.engine.sampler;

    while (this.nextNote < notes.length && notes[this.nextNote].start < horizon) {
      const n = notes[this.nextNote++];
      if (this.muted[n.hand]) continue;
      const midi = n.midi + this.transpose;
      if (midi < 21 || midi > 108) continue;
      const voice = sampler.noteOn(midi, n.vel, this.ctxAt(n.start));
      if (voice) this.pending.push({ voice, at: this.usePedal ? n.damp : n.end });
    }

    if (this.pending.length) {
      const keep = [];
      for (const p of this.pending) {
        if (p.at < horizon) p.voice.release(this.ctxAt(p.at));
        else keep.push(p);
      }
      this.pending = keep;
    }

    while (this.nextPedal < this.pedalEdges.length && this.pedalEdges[this.nextPedal].time < horizon) {
      const e = this.pedalEdges[this.nextPedal++];
      if (this.usePedal) this.engine.pedal(e.down, this.ctxAt(e.time));
    }

    const heard = this.songAt(now);
    if (heard >= this.duration + END_TAIL / Math.max(0.5, this.rate)) {
      this.playing = false;
      this.timer.stop();
      this.position = this.duration;
      this.emit('state');
      this.emit('end');
    }
  }

  /** Notes sounding (key held) at song time t. Used by the keyboard renderer. */
  activeNotes(t, out = []) {
    out.length = 0;
    if (!this.perf) return out;
    const notes = this.perf.notes;
    const from = t - this.perf.maxNoteLength;
    let lo = 0, hi = notes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].start < from) lo = m + 1; else hi = m; }
    for (let i = lo; i < notes.length && notes[i].start <= t; i++) {
      const n = notes[i];
      if (n.end > t) out.push(n);
    }
    return out;
  }

  pedalDownAt(t) {
    if (!this.perf || !this.usePedal) return false;
    const ps = this.perf.pedals;
    let lo = 0, hi = ps.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (ps[m].end <= t) lo = m + 1;
      else if (ps[m].start > t) hi = m - 1;
      else return true;
    }
    return false;
  }

  emit(type) { this.dispatchEvent(new Event(type)); }
}
