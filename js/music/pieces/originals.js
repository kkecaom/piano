// Original compositions written for Nocturne (free to use with the app).

import { Score } from '../score.js';

/** "Paper Lanterns": a lyrical piece in E-flat major. */
export function paperLanterns() {
  const s = new Score({ title: 'Paper Lanterns', subtitle: 'Nocturne original · E♭ major', bpm: 66, beatsPerBar: 4, seed: 11 });
  const V = {
    'Eb': 'Eb2 Bb2 Eb3 F3 G3', 'Bb/D': 'D2 Bb2 D3 F3 Bb3', 'Cm': 'C2 G2 C3 D3 Eb3', 'Ab': 'Ab1 Eb2 Ab2 Bb2 C3',
    'Eb/G': 'G2 Bb2 Eb3 F3 G3', 'Fm7': 'F2 C3 Eb3 F3 Ab3', 'Bb': 'Bb1 F2 Bb2 C3 D3', 'Gm': 'G1 D2 G2 Bb2 D3',
    'Fm': 'F2 C3 F3 G3 Ab3', 'Abm': 'Ab1 Eb2 Ab2 Bb2 Cb3',
  };
  let bar = 1;
  const pedalChanges = [];
  // Left hand: rolling eighths, one or two harmonies per bar.
  const lh = (chords, vel = 0.58, style = 'arp') => {
    const per = 4 / chords.length;
    chords.forEach((c, i) => {
      const notes = V[c].split(' ');
      const b = s.bar(bar) + i * per;
      pedalChanges.push(b);
      if (style === 'arp') {
        const order = per === 4 ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 1, 2, 4];
        s.figure('L', b, notes, order, 0.5, { hold: (k) => (k === 0 ? per : 0.5), vel, shape: (k) => (k === 0 ? 1.15 : k === 4 ? 1 : 0.9) });
      } else if (style === 'octave') {
        const [root] = notes;
        s.note('L', b, [root, notes[2]], per, { len: per * 0.98, vel: vel * 1.2 });
        const upper = [notes[1], notes[2], notes[3], notes[4]];
        s.figure('L', b + 0.5, upper, per === 4 ? [0, 1, 2, 3, 2, 1, 0] : [0, 2, 3], 0.5, { hold: 0.5, vel: vel * 0.85 });
      } else {
        s.note('L', b, notes.slice(0, 3), per, { len: per, vel, roll: 0.03 });
      }
    });
    bar++;
  };
  const rh = (text, opts) => s.line('R', s.bar(bar), text, opts);
  const rhOct = (text) => { rh(text, { vel: 1 }); rh(text, { octave: -1, vel: 0.62 }); };

  // Intro
  s.dyn(0, 0.3);
  rh('r/2 Bb5/1 G5/1', { vel: 0.7 }); lh(['Eb']);
  rh('r/2 C6/1 Bb5/1', { vel: 0.7 }); lh(['Ab']);

  // A: the theme
  s.dyn(s.bar(3), 0.38);
  rh('r/1 G4/0.5 Ab4/0.5 Bb4/1.5 Eb5/0.5'); lh(['Eb']);
  rh('D5/1.5 C5/0.5 Bb4/2'); lh(['Bb/D']);
  rh('r/0.5 G4/0.5 C5/0.5 D5/0.5 Eb5/1.5 D5/0.5'); lh(['Cm']);
  rh('C5/1 Bb4/0.5 Ab4/0.5 Bb4/2'); lh(['Ab']);
  rh('r/1 G4/0.5 Ab4/0.5 Bb4/1.5 G5/0.5'); lh(['Eb/G']);
  rh('F5/1.5 Eb5/0.5 C5/2'); lh(['Ab']);
  rh('r/0.5 Ab4/0.5 C5/0.5 Eb5/0.5 F5/1 Eb5/0.5 C5/0.5'); lh(['Fm7']);
  s.ramp(s.bar(bar) + 2, s.bar(bar + 1), 60).tempo(s.bar(bar + 1), 66);
  rh('D5/2 r/0.5 Bb4/0.5 C5/0.5 D5/0.5'); lh(['Bb']);

  // A': the answer, rising
  s.dyn(s.bar(11), 0.44).dyn(s.bar(15), 0.54).dyn(s.bar(17), 0.46);
  rh('Eb5/1.5 D5/0.5 Eb5/1 G5/1'); lh(['Eb']);
  rh('F5/1.5 Eb5/0.5 D5/1 Bb4/1'); lh(['Bb/D']);
  rh('C5/1.5 D5/0.5 Eb5/1 G5/1'); lh(['Cm']);
  rh('Ab5/1.5 G5/0.5 F5/1 Eb5/1'); lh(['Ab']);
  rh('F5/1 Ab5/1 C6/1.5 Bb5/0.5'); lh(['Fm']);
  rh('G5/1.5 F5/0.5 Eb5/1 D5/1'); lh(['Eb/G']);
  rh('C5/1 Eb5/1 Ab5/1 G5/0.5 F5/0.5'); lh(['Ab']);
  s.ramp(s.bar(bar) + 1, s.bar(bar + 1), 58).tempo(s.bar(bar + 1), 68);
  rh('F5/2 Eb5/2'); lh(['Bb', 'Eb']);

  // B: climax, melody in octaves
  s.dyn(s.bar(19), 0.6).dyn(s.bar(22), 0.72).dyn(s.bar(25), 0.52);
  rhOct('C6/1.5 Bb5/0.5 Ab5/1 Eb5/1'); lh(['Ab'], 0.62, 'octave');
  rhOct('D6/1.5 C6/0.5 Bb5/1 F5/1'); lh(['Bb'], 0.62, 'octave');
  rhOct('G5/1 Bb5/1 D6/1.5 Eb6/0.5'); lh(['Gm'], 0.62, 'octave');
  rhOct('Eb6/1.5 D6/0.5 C6/2'); lh(['Cm'], 0.64, 'octave');
  rhOct('C6/1.5 Bb5/0.5 Ab5/1 C6/1'); lh(['Ab'], 0.66, 'octave');
  rhOct('Bb5/1.5 Ab5/0.5 F5/1 D5/1'); lh(['Bb'], 0.66, 'octave');
  rhOct('Eb5/1 G5/1 Bb5/1.5 Ab5/0.5'); lh(['Eb/G'], 0.6, 'octave');
  s.ramp(s.bar(bar) + 2, s.bar(bar + 1), 56).tempo(s.bar(bar + 1), 64);
  rhOct('C6/2 Bb5/1 D6/1'); lh(['Ab', 'Bb'], 0.58, 'octave');

  // A'': the theme again, high and quiet
  s.dyn(s.bar(27), 0.32).dyn(s.bar(34), 0.3);
  rh('Eb6/1 G5/0.5 Ab5/0.5 Bb5/1.5 Eb6/0.5'); lh(['Eb'], 0.5);
  rh('D6/1.5 C6/0.5 Bb5/2'); lh(['Bb/D'], 0.5);
  rh('r/0.5 G5/0.5 C6/0.5 D6/0.5 Eb6/1.5 D6/0.5'); lh(['Cm'], 0.5);
  rh('C6/1 Bb5/0.5 Ab5/0.5 Bb5/2'); lh(['Ab'], 0.5);
  rh('r/1 G5/0.5 Ab5/0.5 Bb5/1.5 G6/0.5'); lh(['Eb/G'], 0.5);
  rh('F6/1.5 Eb6/0.5 C6/2'); lh(['Ab'], 0.5);
  rh('r/0.5 Ab5/0.5 C6/0.5 Eb6/0.5 F6/1 Eb6/0.5 C6/0.5'); lh(['Fm7'], 0.48);
  rh('D6/3 r/1'); lh(['Bb'], 0.46);

  // Coda: the borrowed minor chord, then home.
  const coda = bar;
  s.dyn(s.bar(coda), 0.3).dyn(s.bar(coda + 3), 0.22);
  s.ramp(s.bar(coda), s.bar(coda + 3), 50);
  rh('Eb6/2 C6/2'); lh(['Ab'], 0.46);
  rh('Cb6/2 Ab5/2'); lh(['Abm'], 0.44);
  rh('G5/4'); lh(['Eb'], 0.42);
  const end = s.bar(bar);
  s.note('L', end, ['Eb2', 'Bb2', 'G3'], 6, { len: 6, vel: 0.9, roll: 0.04 });
  s.note('R', end, ['Bb4', 'Eb5', 'G5', 'Bb5'], 6, { len: 6, vel: 0.85, roll: 0.05 });
  s.dyn(end, 0.24);

  pedalChanges.push(end);
  s.pedalChanges(pedalChanges);
  s.pedal(end + 0.1, end + 8);
  return s.build();
}

/** "Letter Never Sent": a wistful waltz-song in A minor. */
export function letterNeverSent() {
  const s = new Score({ title: 'Letter Never Sent', subtitle: 'Nocturne original · A minor', bpm: 76, beatsPerBar: 3, seed: 23 });
  const V = {
    Am: 'A2 E3 A3 C4', F: 'F2 C3 F3 A3', C: 'C3 G3 C4 E4', G: 'G2 D3 G3 B3', Dm: 'D2 A2 D3 F3',
    E: 'E2 B2 E3 G#3', 'G/B': 'B2 D3 G3 B3', Em: 'E2 B2 E3 G3',
  };
  let bar = 1;
  const changes = [];
  const lh = (c, vel = 0.56) => {
    const b = s.bar(bar);
    changes.push(b);
    s.figure('L', b, V[c].split(' '), [0, 1, 2, 3, 2, 1], 0.5, { hold: (k) => (k === 0 ? 3 : 0.5), vel, shape: (k) => (k === 0 ? 1.15 : 0.9) });
    bar++;
  };
  const rh = (text, opts) => s.line('R', s.bar(bar), text, opts);

  const phraseA = (vel = 1, oct = 0) => {
    rh('E5/1.5 D5/0.5 C5/1', { vel, octave: oct }); lh('Am');
    rh('A4/2 C5/1', { vel, octave: oct }); lh('F');
    rh('G5/1.5 F5/0.5 E5/1', { vel, octave: oct }); lh('C');
    rh('D5/2 B4/1', { vel, octave: oct }); lh('G');
    rh('C5/1.5 B4/0.5 A4/1', { vel, octave: oct }); lh('Am');
    rh('F5/1.5 E5/0.5 C5/1', { vel, octave: oct }); lh('F');
    rh('D5/1 F5/1 A5/1', { vel, octave: oct }); lh('Dm');
    rh('G#5/2 E5/1', { vel, octave: oct }); lh('E');
  };
  const phraseA2 = (vel = 1, oct = 0) => {
    rh('A5/1.5 G5/0.5 E5/1', { vel, octave: oct }); lh('Am');
    rh('F5/1.5 E5/0.5 C5/1', { vel, octave: oct }); lh('F');
    rh('E5/1.5 D5/0.5 C5/1', { vel, octave: oct }); lh('C');
    rh('D5/2 G4/1', { vel, octave: oct }); lh('G/B');
    rh('C5/1 E5/1 A5/1', { vel, octave: oct }); lh('Am');
    rh('A5/1.5 G5/0.5 F5/1', { vel, octave: oct }); lh('Dm');
    rh('E5/1.5 D5/0.5 B4/1', { vel, octave: oct }); lh('E');
  };

  s.dyn(0, 0.34);
  phraseA();
  s.dyn(s.bar(9), 0.4);
  phraseA2();
  s.ramp(s.bar(bar), s.bar(bar + 1), 66).tempo(s.bar(bar + 1), 78);
  rh('A4/3'); lh('Am');

  // B: into the relative major, opening up
  s.dyn(s.bar(17), 0.5).dyn(s.bar(21), 0.62).dyn(s.bar(24), 0.56);
  const bOct = (t) => { rh(t); rh(t, { octave: -1, vel: 0.6 }); };
  bOct('C6/1.5 A5/0.5 F5/1'); lh('F', 0.6);
  bOct('D6/1.5 B5/0.5 G5/1'); lh('G', 0.6);
  bOct('E6/1.5 D6/0.5 B5/1'); lh('Em', 0.62);
  bOct('C6/2 A5/1'); lh('Am', 0.62);
  bOct('F5/1 A5/1 D6/1'); lh('Dm', 0.64);
  bOct('D6/1.5 C6/0.5 B5/1'); lh('G', 0.64);
  bOct('E6/1.5 D6/0.5 C6/1'); lh('C', 0.62);
  s.ramp(s.bar(bar), s.bar(bar + 1), 64).tempo(s.bar(bar + 1), 74);
  bOct('B5/2 G#5/1'); lh('E', 0.58);

  // Return, softer
  s.dyn(s.bar(25), 0.32);
  phraseA(0.9);
  s.dyn(s.bar(33), 0.3);
  phraseA2(0.9);
  s.ramp(s.bar(bar), s.bar(bar + 3), 52);
  rh('A4/3'); lh('Am', 0.5);
  rh('F5/1.5 E5/0.5 C5/1', { vel: 0.8 }); lh('F', 0.46);
  rh('B4/3', { vel: 0.8 }); lh('E', 0.44);
  const end = s.bar(bar);
  s.dyn(end, 0.24);
  s.note('L', end, ['A1', 'E2', 'A2'], 6, { len: 6, vel: 0.95 });
  s.note('R', end, ['C4', 'E4', 'A4', 'C5'], 6, { len: 6, vel: 0.85, roll: 0.05 });
  changes.push(end);
  s.pedalChanges(changes);
  s.pedal(end + 0.1, end + 7);
  return s.build();
}
