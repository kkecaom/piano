// L. van Beethoven: Bagatelle No. 25 in A minor "Für Elise", WoO 59, 1810. Public domain.
// Arranged: the opening theme with its repeat, the C-major episode, and the return.
// One beat = one eighth note (3/8 time, three beats per bar).

import { Score } from '../score.js';

export function furElise() {
  const s = new Score({
    title: 'Für Elise',
    subtitle: 'L. van Beethoven · Bagatelle in A minor, WoO 59 (arr.)',
    bpm: 150, beatsPerBar: 3, seed: 59,
  });

  let b = 0;
  const R = (text, at = b) => s.line('R', at, text);
  const L = (text, at = b) => s.line('L', at, text, { vel: 0.72 });
  const pedalBar = (at) => s.pedal(at + 0.1, at + 2.85);

  // Pick-up.
  R('E5/0.5 D#5');
  b += 1;

  const themeBars = (ending) => {
    R('E5/0.5 D#5 E5 B4 D5 C5'); b += 3;
    R('A4/1 r/0.5 C4/0.5 E4 A4'); L('A2/0.5 E3 A3'); pedalBar(b); b += 3;
    R('B4/1 r/0.5 E4/0.5 G#4 B4'); L('E2/0.5 E3 G#3'); pedalBar(b); b += 3;
    R('C5/1 r/0.5 E4/0.5 E5 D#5'); L('A2/0.5 E3 A3'); pedalBar(b); b += 3;
    R('E5/0.5 D#5 E5 B4 D5 C5'); b += 3;
    R('A4/1 r/0.5 C4/0.5 E4 A4'); L('A2/0.5 E3 A3'); pedalBar(b); b += 3;
    R('B4/1 r/0.5 E4/0.5 C5 B4'); L('E2/0.5 E3 G#3'); pedalBar(b); b += 3;
    if (ending === 1) { R('A4/1 r/1 E5/0.5 D#5'); L('A2/0.5 E3 A3'); pedalBar(b); }
    else if (ending === 2) { R('A4/1 r/0.5 B4/0.5 C5 D5'); L('A2/0.5 E3 A3'); pedalBar(b); }
    else { R('A4/3'); L('A2/0.5 E3 A3/2'); s.pedal(b + 0.1, b + 9); }
    b += 3;
  };

  // Theme, twice.
  s.dyn(0, 0.34);
  themeBars(1);
  s.ramp(b - 3, b, 138).tempo(b, 150);
  s.dyn(b, 0.36);
  themeBars(2);

  // Episode in C major: lighter, a little brighter.
  const ep = b;
  s.dyn(ep, 0.42).dyn(ep + 9, 0.52).dyn(ep + 12, 0.4);
  R('E5/1.5 G4/0.5 F5 E5'); L('C3/0.5 G3 C4'); pedalBar(b); b += 3;
  R('D5/1.5 F4/0.5 E5 D5'); L('G2/0.5 G3 B3'); pedalBar(b); b += 3;
  R('C5/1.5 E4/0.5 D5 C5'); L('A2/0.5 E3 A3'); pedalBar(b); b += 3;
  R('B4/1 r/1 E5/0.5 D#5'); L('E2/0.5 E3 G#3'); pedalBar(b); b += 3;
  // The lingering E–D# oscillation that leads back to the theme.
  s.dyn(b, 0.3);
  R('E5/0.5 D#5 E5 D#5 E5 D#5');
  s.ramp(b, b + 3, 118).tempo(b + 3, 150);
  b += 3;

  // Return of the theme, closing softly.
  s.dyn(b, 0.34).dyn(b + 18, 0.3);
  const last = b + 21;
  s.ramp(last - 3, last + 3, 110);
  themeBars(3);
  s.dyn(last, 0.26);
  return s.build();
}
