// J. S. Bach: Prelude in C major, BWV 846 (Well-Tempered Clavier, Book I), 1722. Public domain.
// Every bar except the last three is the same figure over a five-note chord:
//   left hand: n1 (held two beats), n2 (held from the second sixteenth)
//   right hand: n3 n4 n5 n3 n4 n5, twice per bar.

import { Score } from '../score.js';

const CHORDS = [
  'C4 E4 G4 C5 E5', 'C4 D4 A4 D5 F5', 'B3 D4 G4 D5 F5', 'C4 E4 G4 C5 E5',
  'C4 E4 A4 E5 A5', 'C4 D4 F#4 A4 D5', 'B3 D4 G4 D5 G5', 'B3 C4 E4 G4 C5',
  'A3 C4 E4 G4 C5', 'D3 A3 D4 F#4 C5', 'G3 B3 D4 G4 B4', 'G3 Bb3 E4 G4 C#5',
  'F3 A3 D4 A4 D5', 'F3 Ab3 D4 F4 B4', 'E3 G3 C4 G4 C5', 'E3 F3 A3 C4 F4',
  'D3 F3 A3 C4 F4', 'G2 D3 G3 B3 F4', 'C3 E3 G3 C4 E4', 'C3 G3 Bb3 C4 E4',
  'F2 F3 A3 C4 E4', 'F#2 C3 A3 C4 Eb4', 'Ab2 F3 B3 C4 D4', 'G2 F3 G3 B3 D4',
  'G2 E3 G3 C4 E4', 'G2 D3 G3 C4 F4', 'G2 D3 G3 B3 F4', 'G2 Eb3 A3 C4 F#4',
  'G2 E3 G3 C4 G4', 'G2 D3 G3 C4 F4', 'G2 D3 G3 B3 F4', 'C2 C3 G3 Bb3 E4',
];

export function bachPrelude() {
  const s = new Score({
    title: 'Prelude in C major, BWV 846',
    subtitle: 'J. S. Bach · The Well-Tempered Clavier',
    bpm: 68, beatsPerBar: 4, seed: 846,
  });

  // Dynamic arc: calm opening, growing through the diminished harmonies, a long
  // dominant pedal climax, then a quiet close.
  s.dyn(0, 0.34).dyn(s.bar(4), 0.4).dyn(s.bar(8), 0.36).dyn(s.bar(12), 0.46).dyn(s.bar(16), 0.4)
    .dyn(s.bar(19), 0.38).dyn(s.bar(22), 0.52).dyn(s.bar(24), 0.6).dyn(s.bar(28), 0.66)
    .dyn(s.bar(31), 0.56).dyn(s.bar(33), 0.46).dyn(s.bar(35), 0.4);

  // Breathing tempo: tiny easing at phrase ends, broadening into the end.
  s.ramp(s.bar(4) - 1, s.bar(4), 64).tempo(s.bar(5), 68)
    .ramp(s.bar(19) - 1, s.bar(19), 63).tempo(s.bar(20), 67)
    .ramp(s.bar(32), s.bar(34), 60).ramp(s.bar(34), s.bar(35), 50);

  const q = 0.25; // sixteenth note
  CHORDS.forEach((chord, i) => {
    const [n1, n2, n3, n4, n5] = chord.split(' ');
    const b = s.bar(i + 1);
    for (const half of [0, 2]) {
      const t = b + half;
      s.note('L', t, n1, 2, { len: 1.96, vel: 0.95 });
      s.note('L', t + q, n2, 1.75, { len: 1.7, vel: 0.82 });
      s.figure('R', t + 2 * q, [n3, n4, n5], [0, 1, 2, 0, 1, 2], q, {
        hold: q,
        shape: (k) => (k === 2 || k === 5 ? 1.02 : 0.9),
      });
    }
  });

  // Bars 33–34: the free figures over the tonic pedal.
  const b33 = s.bar(33);
  s.note('L', b33, 'C2', 8, { len: 7.9, vel: 0.95 });
  s.line('L', b33 + q, 'C3/0.25', { vel: 0.8 });
  s.line('R', b33 + 2 * q, 'F3/0.25 A3 C4 F4 C4 A3 C4 A3 F3 A3 F3 D3 F3 D3', { vel: 0.9 });
  s.line('L', b33 + 4 + q, 'B2/0.25', { vel: 0.8 });
  s.line('R', b33 + 4 + 2 * q, 'G3/0.25 B3 D4 F4 D4 B3 D4 B3 G3 B3 D3 F3 E3 D3', { vel: 0.9 });

  // Final chord, gently rolled.
  const b35 = s.bar(35);
  s.note('L', b35, ['C2', 'C3'], 4, { len: 4, vel: 0.9 });
  s.note('R', b35, ['E4', 'G4', 'C5'], 4, { len: 4, vel: 0.9, roll: 0.045 });

  // Pedal: one harmony per bar, lifted cleanly at each change.
  s.pedalEvery(0, s.bar(35), 4);
  s.pedal(s.bar(35) + 0.1, s.bar(36) + 2);
  return s.build();
}
