import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Score } from '../js/music/score.js';
import { noteToMidi, midiToName } from '../js/music/theory.js';
import { composeReverie } from '../js/music/composer.js';
import { bachPrelude } from '../js/music/pieces/bach-prelude.js';
import { furElise } from '../js/music/pieces/fur-elise.js';
import { canonInD } from '../js/music/pieces/canon.js';
import { paperLanterns, letterNeverSent } from '../js/music/pieces/originals.js';
import { matchSlot } from '../js/library/catalog.js';

test('note names', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A0'), 21);
  assert.equal(noteToMidi('C8'), 108);
  assert.equal(noteToMidi('Bb3'), 58);
  assert.equal(noteToMidi('F#5'), 78);
  assert.equal(noteToMidi('Cb6'), 83);
  assert.equal(midiToName(61), 'C#4');
});

test('score tempo map integrates ramps exactly', () => {
  const s = new Score({ title: 't', bpm: 60 });
  const toSec = s.timeMap();
  assert.equal(toSec(4), 4);
  s.ramp(4, 8, 120);
  const t = s.timeMap();
  assert.equal(t(4), 4);
  // ∫ 60/bpm(b) db over a linear 60→120 ramp of 4 beats = 4·ln 2
  assert.ok(Math.abs(t(8) - (4 + 4 * Math.LN2)) < 1e-9);
  assert.ok(Math.abs(t(10) - (4 + 4 * Math.LN2 + 1)) < 1e-9);
});

test('line notation: durations, chords, rests and modifiers', () => {
  const s = new Score({ title: 't', bpm: 60 });
  const end = s.line('R', 0, "C4/1 D4 r/0.5 E4+G4/1.5> | F4/0.5'");
  assert.equal(end, 4.5);
  const ev = s.events;
  assert.equal(ev.length, 5);
  assert.deepEqual(ev.map((e) => e.beat), [0, 1, 2.5, 2.5, 4]);
  assert.ok(ev[2].accent > 0);
  assert.ok(ev[4].len < 0.25);
});

const pieces = [bachPrelude, furElise, canonInD, paperLanterns, letterNeverSent, () => composeReverie(7), () => composeReverie(2024)];

test('every built-in piece renders to a valid performance', () => {
  for (const build of pieces) {
    const p = build();
    assert.ok(p.notes.length > 100, p.title);
    assert.ok(p.duration > 30 && p.duration < 400, `${p.title} duration ${p.duration}`);
    for (const n of p.notes) {
      assert.ok(n.midi >= 21 && n.midi <= 108, p.title);
      assert.ok(n.end > n.start && n.start >= 0);
      assert.ok(n.vel > 0 && n.vel <= 1);
      assert.ok(n.damp >= n.end - 1e-9);
    }
    for (let i = 1; i < p.pedals.length; i++) assert.ok(p.pedals[i].start >= p.pedals[i - 1].end, `${p.title} pedals overlap`);
  }
});

test('Reverie is deterministic per seed and varies across seeds', () => {
  const a = composeReverie(99), b = composeReverie(99), c = composeReverie(100);
  assert.deepEqual(a.notes.map((n) => n.midi), b.notes.map((n) => n.midi));
  assert.notDeepEqual(a.notes.map((n) => n.midi), c.notes.map((n) => n.midi));
});

test('Reverie melodies stay in key', () => {
  for (const seed of [1, 5, 13, 77, 300, 4242]) {
    const p = composeReverie(seed);
    const pcs = new Map();
    for (const n of p.notes) pcs.set(n.midi % 12, (pcs.get(n.midi % 12) || 0) + 1);
    // A diatonic piece (plus the minor-key leading tone and the coda's borrowed chord)
    // uses at most 9 pitch classes, and 7 of them carry almost everything.
    const counts = [...pcs.values()].sort((x, y) => y - x);
    const top7 = counts.slice(0, 7).reduce((s, v) => s + v, 0);
    assert.ok(top7 / p.notes.length > 0.96, `seed ${seed}`);
  }
});

test('file names are matched to collection slots', () => {
  assert.equal(matchSlot('Merry_Christmas_Mr_Lawrence_piano.mid').id, 'slot-lawrence');
  assert.equal(matchSlot('ballade-pour-adeline.midi').id, 'slot-adeline');
  assert.equal(matchSlot('水边的阿狄丽娜.mid').id, 'slot-adeline');
  assert.equal(matchSlot('梦中的婚礼 钢琴.mid').id, 'slot-mariage');
  assert.equal(matchSlot('Interstellar main theme.mid').id, 'slot-instellar');
  assert.equal(matchSlot('Call of Silence (piano).mid').id, 'slot-silence');
  assert.equal(matchSlot('secret place.mid').id, 'slot-secret');
  assert.equal(matchSlot('random tune.mid'), null);
});
