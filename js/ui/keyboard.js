// 88-key keyboard rendered on a canvas: ivory and ebony keys with depth, key travel when
// pressed, hand-coloured glow, optional note names, and pointer (mouse / multi-touch) play.

import { isBlack, midiToName, MIDI_MIN, MIDI_MAX } from '../music/theory.js';

export const HAND_COLORS = {
  R: { main: [242, 180, 90], hot: [255, 143, 77] },
  L: { main: [88, 199, 232], hot: [95, 124, 240] },
  live: { main: [178, 140, 255], hot: [230, 120, 220] },
};

// Horizontal offset of each black key relative to the gap between its white neighbours,
// as on a real keyboard (C# and F# lean left, D# and A# lean right).
const BLACK_SHIFT = { 1: -0.12, 3: 0.12, 6: -0.16, 8: 0, 10: 0.16 };

export class Keyboard {
  constructor(canvas, { onPress, onRelease } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.lo = MIDI_MIN;
    this.hi = MIDI_MAX;
    this.showLabels = false;
    this.keys = new Map();       // midi -> { x, w, black }
    this.state = new Map();      // midi -> { hand, vel, amount }  (amount animates key travel)
    this.pointers = new Map();   // pointerId -> midi
    this.layout();
    this.bindPointer();
  }

  setRange(lo, hi) {
    // Snap to white keys so the edges look right.
    while (isBlack(lo)) lo--;
    while (isBlack(hi)) hi++;
    this.lo = Math.max(MIDI_MIN, lo);
    this.hi = Math.min(MIDI_MAX, hi);
    this.layout();
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.height = `${height}px`;
    this.layout();
  }

  layout() {
    const W = this.width || 1000;
    const H = this.height || 160;
    let whites = 0;
    for (let m = this.lo; m <= this.hi; m++) if (!isBlack(m)) whites++;
    const ww = W / whites;
    this.whiteW = ww;
    this.blackW = ww * 0.6;
    this.blackH = H * 0.63;
    this.keys.clear();
    let x = 0;
    for (let m = this.lo; m <= this.hi; m++) {
      if (!isBlack(m)) {
        this.keys.set(m, { x, w: ww, black: false });
        x += ww;
      }
    }
    for (let m = this.lo; m <= this.hi; m++) {
      if (isBlack(m)) {
        const left = this.keys.get(m - 1);
        if (!left) continue;
        const gapX = left.x + ww;
        const cx = gapX + BLACK_SHIFT[m % 12] * this.blackW;
        this.keys.set(m, { x: cx - this.blackW / 2, w: this.blackW, black: true });
      }
    }
    this.gradients = null;
  }

  /** Horizontal centre and width of a key (for the waterfall to line up with). */
  keyGeom(midi) {
    const k = this.keys.get(midi);
    if (k) return k;
    return null;
  }

  // ---------- interaction ----------
  keyAt(px, py) {
    if (py < this.blackH) {
      for (const [m, k] of this.keys) if (k.black && px >= k.x && px < k.x + k.w) return m;
    }
    for (const [m, k] of this.keys) if (!k.black && px >= k.x && px < k.x + k.w) return m;
    return null;
  }

  bindPointer() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top, (e.clientY - r.top) / r.height];
    };
    const press = (e) => {
      const [x, y, fy] = pos(e);
      const m = this.keyAt(x, y);
      if (m === null) return;
      this.pointers.set(e.pointerId, m);
      // Striking nearer the front of the key plays louder.
      const vel = Math.min(1, 0.4 + fy * 0.6);
      this.onPress?.(m, vel);
    };
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      press(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const [x, y] = pos(e);
      const m = this.keyAt(x, y);
      const prev = this.pointers.get(e.pointerId);
      if (m !== prev) {
        this.onRelease?.(prev);
        this.pointers.delete(e.pointerId);
        if (m !== null) press(e);
      }
    });
    const up = (e) => {
      const m = this.pointers.get(e.pointerId);
      if (m !== undefined) { this.onRelease?.(m); this.pointers.delete(e.pointerId); }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  // ---------- rendering ----------
  /**
   * @param {Map<number, {hand: string, vel: number}>} pressed keys currently down
   * @param {number} dt seconds since last frame (for key travel animation)
   */
  draw(pressed, dt) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    const W = this.width, H = this.height;
    if (!W || !H) return;

    // Animate key travel: fast press, slightly slower return.
    for (const [m, st] of this.state) {
      if (!pressed.has(m)) {
        st.amount = Math.max(0, st.amount - dt * 14);
        if (st.amount === 0) this.state.delete(m);
      }
    }
    for (const [m, p] of pressed) {
      let st = this.state.get(m);
      if (!st) { st = { amount: 0 }; this.state.set(m, st); }
      st.hand = p.hand;
      st.vel = p.vel;
      st.amount = Math.min(1, st.amount + dt * 40);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!this.gradients) this.makeGradients();
    const g = this.gradients;
    const ww = this.whiteW;
    const r = Math.min(5, ww * 0.18);

    // White keys.
    for (const [m, k] of this.keys) {
      if (k.black) continue;
      const st = this.state.get(m);
      const a = st ? st.amount : 0;
      const depth = a * 3.5;
      const x = k.x + 0.5, w = k.w - 1;
      const h = H - 1 - depth * 0.4;
      ctx.fillStyle = g.white;
      roundRectBottom(ctx, x, 0, w, h, r);
      ctx.fill();
      if (st && a > 0) {
        const c = HAND_COLORS[st.hand] || HAND_COLORS.R;
        const alpha = (0.45 + 0.45 * (st.vel ?? 0.7)) * a;
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, rgba(c.hot, alpha * 0.55));
        grad.addColorStop(0.55, rgba(c.main, alpha * 0.85));
        grad.addColorStop(1, rgba(c.main, alpha));
        ctx.fillStyle = grad;
        roundRectBottom(ctx, x, 0, w, h, r);
        ctx.fill();
        // Shadow at the top where the key dips under the fallboard.
        ctx.fillStyle = `rgba(0,0,0,${0.25 * a})`;
        ctx.fillRect(x, 0, w, 6 * a);
      } else {
        // Front lip of an unpressed key.
        ctx.fillStyle = g.lip;
        ctx.fillRect(x + 1, h - 7, w - 2, 7 - r * 0.2);
      }
      if (this.showLabels && m % 12 === 0) {
        ctx.fillStyle = 'rgba(40,34,30,0.55)';
        ctx.font = `600 ${Math.max(8, Math.min(11, ww * 0.42))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(midiToName(m), k.x + k.w / 2, h - 12);
      }
    }
    // Separator shading between whites.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (const [, k] of this.keys) if (!k.black) ctx.fillRect(k.x, 0, 1, H);

    // Black keys.
    const bh = this.blackH;
    for (const [m, k] of this.keys) {
      if (!k.black) continue;
      const st = this.state.get(m);
      const a = st ? st.amount : 0;
      const h = bh - a * 3;
      // Cast shadow on the white keys.
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      roundRectBottom(ctx, k.x + 1.5, 0, k.w, h + 3, 2.5);
      ctx.fill();
      ctx.fillStyle = g.black;
      roundRectBottom(ctx, k.x, 0, k.w, h, 2.5);
      ctx.fill();
      // Bevelled top surface.
      const inset = k.w * 0.14;
      const topH = h - 7 + a * 4;
      ctx.fillStyle = a > 0 ? g.blackTopPressed : g.blackTop;
      roundRectBottom(ctx, k.x + inset, 0, k.w - inset * 2, topH, 2);
      ctx.fill();
      if (st && a > 0) {
        const c = HAND_COLORS[st.hand] || HAND_COLORS.R;
        const alpha = (0.55 + 0.4 * (st.vel ?? 0.7)) * a;
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, rgba(c.hot, alpha * 0.5));
        grad.addColorStop(1, rgba(c.main, alpha));
        ctx.fillStyle = grad;
        roundRectBottom(ctx, k.x + 1, 0, k.w - 2, h - 1, 2);
        ctx.fill();
      } else {
        // Specular highlight.
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(k.x + inset + 1, topH - 18, 1.2, 14);
      }
    }

    // Top shadow from the fallboard / felt.
    ctx.fillStyle = g.topShadow;
    ctx.fillRect(0, 0, W, 10);
  }

  makeGradients() {
    const ctx = this.ctx;
    const H = this.height;
    const white = ctx.createLinearGradient(0, 0, 0, H);
    white.addColorStop(0, '#d9d4c8');
    white.addColorStop(0.07, '#f4f1ea');
    white.addColorStop(0.8, '#fbfaf6');
    white.addColorStop(1, '#e7e2d6');
    const lip = ctx.createLinearGradient(0, H - 8, 0, H);
    lip.addColorStop(0, 'rgba(0,0,0,0.0)');
    lip.addColorStop(1, 'rgba(0,0,0,0.12)');
    const black = ctx.createLinearGradient(0, 0, 0, this.blackH);
    black.addColorStop(0, '#0c0b0d');
    black.addColorStop(1, '#1b191d');
    const blackTop = ctx.createLinearGradient(0, 0, 0, this.blackH);
    blackTop.addColorStop(0, '#141216');
    blackTop.addColorStop(0.85, '#2c2a30');
    blackTop.addColorStop(1, '#3a373f');
    const blackTopPressed = ctx.createLinearGradient(0, 0, 0, this.blackH);
    blackTopPressed.addColorStop(0, '#0f0e11');
    blackTopPressed.addColorStop(1, '#232126');
    const topShadow = ctx.createLinearGradient(0, 0, 0, 10);
    topShadow.addColorStop(0, 'rgba(0,0,0,0.55)');
    topShadow.addColorStop(1, 'rgba(0,0,0,0)');
    this.gradients = { white, lip, black, blackTop, blackTopPressed, topShadow };
  }
}

function roundRectBottom(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.closePath();
}

export function rgba(c, a) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}
