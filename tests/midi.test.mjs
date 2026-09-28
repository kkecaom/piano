import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, makeTimeMap } from '../js/midi/midi-parser.js';
import { midiToPerformance, autoPedals } from '../js/midi/performance.js';
import { writeMidi, on, off, cc, tempo, scaleStudy } from './midi-writer.mjs';

test('parses header, tracks, names, running status and note-on velocity 0', () => {
  const midi = parseMidi(scaleStudy());
  assert.equal(midi.format, 1);
  assert.equal(midi.ticksPerBeat, 480);
  assert.equal(midi.tracks.length, 3);
  assert.equal(midi.tracks[1].name, 'Right Hand');
  const offs = midi.tracks[2].events.filter((e) => e.type === 'off');
  assert.equal(offs.length, 12, 'note-on with velocity 0 counts as note-off');
});

test('tempo map converts ticks to seconds across tempo changes', () => {
  const { toSeconds } = makeTimeMap(parseMidi(scaleStudy()));
  assert.equal(toSeconds(480), 0.5);           // 120 bpm
  assert.equal(toSeconds(3840), 4);            // two bars of 4/4 at 120
  assert.equal(toSeconds(3840 + 480), 5);      // then 60 bpm
});

test('performance: notes, hands from tracks, pedal and damp times', () => {
  const perf = midiToPerformance(scaleStudy(), { title: 'Study' });
  assert.equal(perf.notes.length, 8 + 12);
  const rh = perf.notes.filter((n) => n.hand === 'R');
  assert.equal(rh.length, 8);
  assert.ok(rh.every((n) => n.midi >= 60));
  assert.equal(perf.pedals.length, 4);
  assert.equal(perf.meta.autoPedal, false);
  // A right-hand note released while the pedal is down keeps sounding until the pedal lifts.
  const first = perf.notes.find((n) => n.midi === 60 && n.hand === 'R');
  const pedal = perf.pedals[0];
  assert.ok(first.end > pedal.start && first.end < pedal.end);
  assert.equal(first.damp, pedal.end);
  // Sorted by start.
  for (let i = 1; i < perf.notes.length; i++) assert.ok(perf.notes[i].start >= perf.notes[i - 1].start);
});

test('files without pedal data get automatic pedalling', () => {
  const perf = midiToPerformance(scaleStudy({ pedal: false }));
  assert.equal(perf.meta.autoPedal, true);
  assert.ok(perf.pedals.length >= 3);
  for (let i = 1; i < perf.pedals.length; i++) assert.ok(perf.pedals[i].start >= perf.pedals[i - 1].end, 'pedal intervals are disjoint');
});

test('single-track files are split into hands around the gap between them', () => {
  const ev = [];
  for (let i = 0; i < 4; i++) {
    const t = i * 480;
    for (const n of [43, 50, 55]) ev.push(on(t, n), off(t + 400, n));
    ev.push(on(t, 67 + i), off(t + 400, 67 + i));
  }
  const perf = midiToPerformance(writeMidi([ev], { format: 0 }));
  assert.ok(perf.notes.filter((n) => n.midi <= 55).every((n) => n.hand === 'L'));
  assert.ok(perf.notes.filter((n) => n.midi >= 67).every((n) => n.hand === 'R'));
});

test('drums are ignored, out-of-range notes folded onto the keyboard, leading silence trimmed', () => {
  const perf = midiToPerformance(writeMidi([[
    tempo(0, 120),
    on(1920, 36, 100, 9), off(2000, 36, 9),
    on(1920, 12), off(2400, 12),
    on(1920, 115), off(2400, 115),
  ]], { format: 0 }));
  assert.equal(perf.notes.length, 2);
  assert.deepEqual(perf.notes.map((n) => n.midi).sort((a, b) => a - b), [24, 103]);
  assert.ok(Math.abs(perf.notes[0].start - 0.4) < 1e-9);
});

test('rejects files that are not MIDI or contain no notes', () => {
  assert.throws(() => parseMidi(new TextEncoder().encode('hello world, not midi')));
  assert.throws(() => midiToPerformance(writeMidi([[cc(0, 64, 127)]])));
});

test('auto pedals follow bass changes', () => {
  const notes = [0, 1, 2, 3, 4].map((i) => ({ midi: 40 + i, start: i, end: i + 0.9 }));
  const p = autoPedals(notes);
  assert.equal(p.length, 5);
  assert.ok(Math.abs(p[0].start - 0.06) < 1e-9);
});
