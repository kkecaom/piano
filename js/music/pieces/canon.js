// J. Pachelbel: Canon in D (c. 1680). Public domain.
// A piano arrangement over the eight-chord ground: the bass never changes while the
// upper voices build variation upon variation, then fall away.

import { Score } from '../score.js';
import { noteToMidi } from '../theory.js';

const GROUND = [
  { root: 'D2', third: 4 }, { root: 'A1', third: 4 }, { root: 'B1', third: 3 }, { root: 'F#1', third: 3 },
  { root: 'G1', third: 4 }, { root: 'D2', third: 4 }, { root: 'G1', third: 4 }, { root: 'A1', third: 4 },
];

export function canonInD() {
  const s = new Score({
    title: 'Canon in D',
    subtitle: 'J. Pachelbel · piano arrangement',
    bpm: 64, beatsPerBar: 4, seed: 1680,
  });
  const CYCLE = 16; // beats (8 chords × 2 beats)

  // LH: flowing broken chords, root – fifth – octave – tenth, one chord per two beats.
  const lh = (cycle, style) => {
    GROUND.forEach((c, i) => {
      const r = noteToMidi(c.root) + (noteToMidi(c.root) < noteToMidi('C2') ? 12 : 0);
      const b = cycle * CYCLE + i * 2;
      if (style === 'arp') {
        s.figure('L', b, [r, r + 7, r + 12, r + 12 + c.third], [0, 1, 2, 3], 0.5, { hold: (k) => 2 - k * 0.5, vel: 0.62 });
      } else if (style === 'wide') {
        s.figure('L', b, [r - 12, r + 7, r + 12, r + 12 + c.third, r + 19], [0, 1, 2, 3, 4, 3, 2, 1], 0.25,
          { hold: (k) => (k === 0 ? 2 : 0.5), vel: 0.6, shape: (k) => (k === 0 ? 1.25 : 0.9) });
      } else if (style === 'octaves') {
        s.note('L', b, [r - 12, r], 2, { len: 1.95, vel: 0.78 });
        s.figure('L', b + 0.5, [r + 7, r + 12, r + 12 + c.third], [0, 1, 2], 0.5, { hold: 0.5, vel: 0.55 });
      } else {
        s.note('L', b, [r, r + 7], 2, { len: 1.95, vel: 0.6 });
      }
    });
  };

  const LINE1 = 'F#5/2 E5 D5 C#5 B4 A4 B4 C#5';
  const LINE2 = 'D5/2 C#5 B4 A4 G4 F#4 G4 E4';
  const LINE3 = 'D5/1 F#5 A5 G5 | F#5 D5 F#5 E5 | D5 B4 D5 A5 | G5 B5 A5 G5';
  const LINE4 = 'A5/0.5 G5 F#5 E5 C#5 D5 E5 C#5 | D5 C#5 B4 D5 C#5 B4 A4 C#5 | B4 A4 G4 B4 A4 G4 F#4 A4 | B4 D5 G5 D5 C#5 E5 A5 G5';

  // Cycle 1: the ground alone.
  s.dyn(0, 0.3);
  lh(0, 'arp');
  // Cycle 2: first voice.
  s.dyn(CYCLE, 0.36);
  lh(1, 'arp');
  s.line('R', CYCLE, LINE1, { legato: 0.98 });
  // Cycle 3: the canon in thirds.
  s.dyn(2 * CYCLE, 0.42);
  lh(2, 'arp');
  s.line('R', 2 * CYCLE, LINE1, { legato: 0.98 });
  s.line('R', 2 * CYCLE, LINE2, { legato: 0.98, vel: 0.8 });
  // Cycle 4: walking quarter notes over the second voice.
  s.dyn(3 * CYCLE, 0.48);
  lh(3, 'arp');
  s.line('R', 3 * CYCLE, LINE3);
  s.line('R', 3 * CYCLE, LINE2, { octave: -1, vel: 0.7, legato: 0.98 });
  // Cycle 5: eighth-note variation, wider accompaniment.
  s.dyn(4 * CYCLE, 0.52).dyn(5 * CYCLE - 2, 0.62);
  lh(4, 'wide');
  s.line('R', 4 * CYCLE, LINE4);
  // Cycle 6: climax, the first voice in octaves with full chords.
  s.dyn(5 * CYCLE, 0.7).dyn(6 * CYCLE - 4, 0.66);
  lh(5, 'octaves');
  const climax = ['F#5+A5+F#6', 'E5+A5+E6', 'D5+F#5+D6', 'C#5+F#5+C#6', 'B4+D5+B5', 'A4+D5+A5', 'B4+D5+B5', 'C#5+E5+C#6'];
  climax.forEach((c, i) => {
    s.line('R', 5 * CYCLE + i * 2, `${c}/1.5> ${c.split('+').slice(0, 2).join('+')}/0.5`);
  });
  // Cycle 7: quieter, the walking line up high.
  s.dyn(6 * CYCLE, 0.46).dyn(7 * CYCLE, 0.36);
  lh(6, 'arp');
  s.line('R', 6 * CYCLE, LINE3, { octave: 1, vel: 0.85 });
  // Cycle 8: farewell.
  s.dyn(7 * CYCLE, 0.32).dyn(8 * CYCLE, 0.24);
  lh(7, 'arp');
  s.line('R', 7 * CYCLE, LINE1, { legato: 0.98 });

  // Final D major chord.
  const end = 8 * CYCLE;
  s.note('L', end, ['D2', 'A2', 'D3'], 6, { len: 6 });
  s.note('R', end, ['F#4', 'A4', 'D5', 'F#5'], 6, { len: 6, roll: 0.05 });

  s.ramp(end - 6, end, 50);
  s.pedalEvery(0, end, 2);
  s.pedal(end + 0.1, end + 8);
  return s.build();
}
