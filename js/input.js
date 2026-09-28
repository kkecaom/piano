// Live input: computer keyboard (two rows, like a piano) and any connected MIDI keyboard.

// Lower row starts at C3, upper row at C4 (black keys on the row above each).
const KEYMAP = {
  z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59, ',': 60, l: 61, '.': 62, ';': 63, '/': 64,
  q: 60, 2: 61, w: 62, 3: 63, e: 64, r: 65, 5: 66, t: 67, 6: 68, y: 69, 7: 70, u: 71, i: 72, 9: 73, o: 74, 0: 75, p: 76,
};

export function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' && el.type !== 'range' && el.type !== 'checkbox' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function bindComputerKeyboard({ noteOn, noteOff, getShift }) {
  const down = new Map();
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(document.activeElement)) return;
    const k = e.key.toLowerCase();
    if (!(k in KEYMAP) || e.repeat) return;
    if (down.has(k)) return;
    const midi = KEYMAP[k] + (getShift?.() || 0);
    down.set(k, midi);
    noteOn(midi, 0.72);
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (!down.has(k)) return;
    noteOff(down.get(k));
    down.delete(k);
  });
  window.addEventListener('blur', () => {
    for (const midi of down.values()) noteOff(midi);
    down.clear();
  });
}

export async function bindMidiInput({ noteOn, noteOff, pedal, onDevices }) {
  if (!navigator.requestMIDIAccess) return false;
  let access;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return false;
  }
  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      names.push(input.name);
      input.onmidimessage = (msg) => {
        const [st, d1, d2] = msg.data;
        const kind = st & 0xf0;
        if (kind === 0x90 && d2 > 0) noteOn(d1, d2 / 127);
        else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) noteOff(d1);
        else if (kind === 0xb0 && d1 === 64) pedal(d2 >= 64);
      };
    }
    onDevices?.(names);
  };
  access.onstatechange = attach;
  attach();
  return true;
}
