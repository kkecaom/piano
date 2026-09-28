// Falling-notes view: every note descends towards its key and lands exactly when it
// sounds. Glowing impact light, rising sparks, octave guide lines and a soft ambient
// light that breathes with the music's loudness.

import { isBlack } from '../music/theory.js';
import { HAND_COLORS, rgba } from './keyboard.js';

const MAX_PARTICLES = 700;

export class Waterfall {
  constructor(canvas, keyboard) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyboard = keyboard;
    this.pxPerSec = 150;
    this.particlesOn = true;
    this.particles = [];
    this.lit = new Set();       // notes already sparked
    this.glowSprites = {};
    this.level = 0;
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.bg = null;
  }

  sprite(hand) {
    if (this.glowSprites[hand]) return this.glowSprites[hand];
    const c = HAND_COLORS[hand] || HAND_COLORS.R;
    const s = document.createElement('canvas');
    s.width = s.height = 128;
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, rgba([255, 250, 240], 0.9));
    grad.addColorStop(0.18, rgba(c.main, 0.65));
    grad.addColorStop(0.5, rgba(c.hot, 0.18));
    grad.addColorStop(1, rgba(c.hot, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.glowSprites[hand] = s;
    return s;
  }

  drawBackground(ctx, W, H) {
    if (!this.bg || this.bg.w !== W || this.bg.h !== H || this.bg.kbw !== this.keyboard.whiteW) {
      const off = document.createElement('canvas');
      const dpr = this.dpr;
      off.width = Math.round(W * dpr);
      off.height = Math.round(H * dpr);
      const g = off.getContext('2d');
      g.scale(dpr, dpr);
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#0b0a0e');
      grad.addColorStop(1, '#111016');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // Guide lines at every C and F (like a piano roll).
      for (const [m, k] of this.keyboard.keys) {
        if (k.black) continue;
        const pc = m % 12;
        if (pc === 0 || pc === 5) {
          g.fillStyle = pc === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.028)';
          g.fillRect(Math.round(k.x), 0, 1, H);
        }
      }
      // Floor glow line where notes meet the keys.
      const floor = g.createLinearGradient(0, H - 40, 0, H);
      floor.addColorStop(0, 'rgba(231,194,125,0)');
      floor.addColorStop(1, 'rgba(231,194,125,0.06)');
      g.fillStyle = floor;
      g.fillRect(0, H - 40, W, 40);
      this.bg = { canvas: off, w: W, h: H, kbw: this.keyboard.whiteW };
    }
    ctx.drawImage(this.bg.canvas, 0, 0, W, H);
  }

  /**
   * @param {object} p
   * @param {object|null} p.perf       performance (notes sorted by start)
   * @param {number} p.time            current song time
   * @param {number} p.transpose
   * @param {{L:boolean,R:boolean}} p.muted
   * @param {Array} p.live             live-played notes [{midi, hand, vel, age}]
   * @param {number} p.level           0..1 loudness for ambient light
   * @param {number} dt
   */
  draw({ perf, time, transpose = 0, muted = {}, live = [], level = 0, playing = false }, dt) {
    const ctx = this.ctx;
    const W = this.width, H = this.height;
    if (!W || !H) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx, W, H);

    // Ambient light that follows loudness.
    this.level += (level - this.level) * Math.min(1, dt * 6);
    if (this.level > 0.01) {
      const amb = ctx.createRadialGradient(W / 2, H * 1.1, 0, W / 2, H * 1.1, H * 1.25);
      amb.addColorStop(0, `rgba(231,194,125,${(0.12 * this.level).toFixed(3)})`);
      amb.addColorStop(1, 'rgba(231,194,125,0)');
      ctx.fillStyle = amb;
      ctx.fillRect(0, 0, W, H);
    }

    const kb = this.keyboard;
    const pps = this.pxPerSec;
    const glows = [];

    if (perf) {
      const notes = perf.notes;
      const horizon = time + H / pps;
      const from = time - perf.maxNoteLength;
      let lo = 0, hi = notes.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].start < from) lo = m + 1; else hi = m; }
      const radius = Math.max(2, Math.min(6, kb.whiteW * 0.22));

      // Two passes so black-key notes are drawn over white-key notes.
      for (const pass of [false, true]) {
        for (let i = lo; i < notes.length; i++) {
          const n = notes[i];
          if (n.start > horizon) break;
          if (n.end < time) continue;
          const midi = n.midi + transpose;
          if (isBlack(midi) !== pass) continue;
          const k = kb.keys.get(midi);
          if (!k) continue;
          const yBottom = H - (n.start - time) * pps;
          const yTop = Math.max(-10, H - (n.end - time) * pps);
          const active = n.start <= time && n.end > time;
          const dim = muted[n.hand] ? 0.28 : 1;
          const c = HAND_COLORS[n.hand] || HAND_COLORS.R;
          const w = k.black ? k.w * 0.92 : k.w * 0.84;
          const x = k.x + (k.w - w) / 2;
          const h = Math.max(4, Math.min(yBottom, H) - yTop);
          const velA = 0.55 + n.vel * 0.45;

          const grad = ctx.createLinearGradient(0, yTop, 0, yTop + h);
          if (active) {
            grad.addColorStop(0, rgba(c.main, 0.95 * dim));
            grad.addColorStop(1, rgba([255, 244, 222], 0.98 * dim));
          } else {
            grad.addColorStop(0, rgba(k.black ? c.hot : c.main, 0.62 * velA * dim));
            grad.addColorStop(1, rgba(c.main, 0.95 * velA * dim));
          }
          ctx.fillStyle = grad;
          roundRect(ctx, x, yTop, w, h, radius);
          ctx.fill();
          // Crisp outline + inner highlight for a glassy look.
          ctx.strokeStyle = rgba(active ? [255, 250, 235] : c.hot, (active ? 0.8 : 0.45) * dim);
          ctx.lineWidth = 1;
          roundRect(ctx, x + 0.5, yTop + 0.5, w - 1, h - 1, radius);
          ctx.stroke();
          ctx.fillStyle = `rgba(255,255,255,${(0.16 * dim).toFixed(3)})`;
          ctx.fillRect(x + 2, yTop + 2, Math.max(1, w * 0.18), Math.max(0, h - 4));

          if (active && !muted[n.hand]) {
            glows.push({ x: k.x + k.w / 2, hand: n.hand, vel: n.vel, w: k.w, fresh: time - n.start < 0.12 });
            if (!this.lit.has(n)) {
              this.lit.add(n);
              if (playing) this.spark(k.x + k.w / 2, H, n.hand, n.vel, k.w);
            }
          }
        }
      }
      if (this.lit.size > 2000) {
        for (const n of this.lit) if (n.end < time - 1 || n.start > time + 1) this.lit.delete(n);
      }
    }

    // Live-played notes rise upward from the keys.
    for (const ln of live) {
      const k = kb.keys.get(ln.midi);
      if (!k) continue;
      const c = HAND_COLORS.live;
      const w = k.black ? k.w * 0.92 : k.w * 0.84;
      const x = k.x + (k.w - w) / 2;
      const yBottom = H - (ln.released ? (ln.age - ln.heldFor) * pps : 0);
      const yTop = H - ln.age * pps;
      if (yBottom < 0) continue;
      const grad = ctx.createLinearGradient(0, yTop, 0, yBottom);
      grad.addColorStop(0, rgba(c.hot, 0.5));
      grad.addColorStop(1, rgba(c.main, 0.95));
      ctx.fillStyle = grad;
      roundRect(ctx, x, yTop, w, Math.max(4, yBottom - yTop), 4);
      ctx.fill();
      if (!ln.released) glows.push({ x: k.x + k.w / 2, hand: 'live', vel: ln.vel, w: k.w, fresh: ln.age < 0.12 });
      if (!ln.sparked) { ln.sparked = true; this.spark(k.x + k.w / 2, H, 'live', ln.vel, k.w); }
    }

    // Impact glows.
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of glows) {
      const spr = this.sprite(gl.hand);
      const size = Math.max(48, gl.w * 4.2) * (0.7 + gl.vel * 0.5) * (gl.fresh ? 1.25 : 1);
      ctx.globalAlpha = 0.55 + gl.vel * 0.35;
      ctx.drawImage(spr, gl.x - size / 2, H - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // Particles.
    if (this.particlesOn) this.updateParticles(ctx, dt);
    ctx.globalCompositeOperation = 'source-over';
  }

  spark(x, y, hand, vel, keyW) {
    if (!this.particlesOn) return;
    const c = HAND_COLORS[hand] || HAND_COLORS.R;
    const n = Math.round(4 + vel * 10);
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * keyW * 0.8,
        y: y - 2,
        vx: (Math.random() - 0.5) * 60,
        vy: -(60 + Math.random() * 180 * (0.5 + vel)),
        life: 0,
        max: 0.5 + Math.random() * 0.9,
        size: 1 + Math.random() * 2.2,
        color: Math.random() < 0.5 ? c.main : c.hot,
      });
    }
  }

  updateParticles(ctx, dt) {
    const ps = this.particles;
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;       // a little gravity
      p.vx *= 1 - dt * 1.5;  // air drag
      const a = 1 - p.life / p.max;
      ctx.fillStyle = rgba(p.color, a * 0.9);
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ps[j++] = p;
    }
    ps.length = j;
  }

  clearEffects() {
    this.particles.length = 0;
    this.lit.clear();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
