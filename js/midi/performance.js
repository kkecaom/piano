// A "performance" is the app's internal, time-in-seconds representation of a piece:
//
//   {
//     title, subtitle,
//     notes:  [{ midi, vel (0..1), start, end, hand: 'L'|'R' }]   sorted by start
//     pedals: [{ start, end }]                                    sustain-pedal down intervals
//     duration
//   }
//
// Converting a MIDI file into one involves: tempo mapping, sustain pedal extraction,
// dropping drum channels, hand assignment (for colours), and optional auto-pedalling
// for files recorded without pedal data.

import { parseMidi, makeTimeMap } from './midi-parser.js';

export function midiToPerformance(data, { title = 'Untitled', subtitle = '' } = {}) {
  const midi = parseMidi(data);
  const { toSeconds } = makeTimeMap(midi);
  const notes = [];
  const pedalEvents = [];
  const trackNames = [];
  let hasPedalData = false;

  midi.tracks.forEach((track, ti) => {
    if (track.name) trackNames.push(track.name);
    const open = new Map(); // key: channel*128+note -> stack of starts
    for (const e of track.events) {
      if (e.type === 'on' || e.type === 'off') {
        if (e.channel === 9) continue; // General MIDI percussion
        const key = e.channel * 128 + e.note;
        if (e.type === 'on') {
          if (!open.has(key)) open.set(key, []);
          open.get(key).push({ tick: e.tick, vel: e.vel });
        } else {
          const stack = open.get(key);
          if (stack && stack.length) {
            const s = stack.shift();
            pushNote(notes, e.note, s.vel, toSeconds(s.tick), toSeconds(e.tick), ti, e.channel);
          }
        }
      } else if (e.type === 'cc' && e.cc === 64) {
        hasPedalData = true;
        pedalEvents.push({ time: toSeconds(e.tick), down: e.value >= 64 });
      }
    }
    // Notes never released: give them a sensible length.
    for (const [key, stack] of open) {
      for (const s of stack) {
        const st = toSeconds(s.tick);
        pushNote(notes, key % 128, s.vel, st, st + 1.5, ti, Math.floor(key / 128));
      }
    }
  });

  if (!notes.length) throw new Error('This MIDI file contains no playable notes.');
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);

  // Trim leading silence so playback starts promptly.
  const offset = Math.max(0, notes[0].start - 0.4);
  if (offset > 0) {
    for (const n of notes) { n.start -= offset; n.end -= offset; }
    for (const p of pedalEvents) p.time = Math.max(0, p.time - offset);
  }

  assignHands(notes);
  let pedals = pedalIntervals(pedalEvents);
  const autoPedal = !hasPedalData || !pedals.length;
  if (autoPedal) pedals = autoPedals(notes);

  const perf = finalize({ title, subtitle, notes, pedals });
  perf.meta = { autoPedal, trackNames };
  return perf;
}

function pushNote(notes, midi, vel, start, end, track, channel) {
  // Fold notes outside the 88 keys into range by octaves.
  while (midi < 21) midi += 12;
  while (midi > 108) midi -= 12;
  notes.push({ midi, vel: vel / 127, start, end: Math.max(end, start + 0.03), track, channel, hand: 'R' });
}

function pedalIntervals(events) {
  events.sort((a, b) => a.time - b.time);
  const out = [];
  let downAt = null;
  for (const e of events) {
    if (e.down && downAt === null) downAt = e.time;
    else if (!e.down && downAt !== null) {
      if (e.time > downAt) out.push({ start: downAt, end: e.time });
      downAt = null;
    }
  }
  if (downAt !== null) out.push({ start: downAt, end: Infinity });
  return out;
}

/**
 * Colour-code hands. Multi-track piano files usually put each hand on its own track or
 * channel; otherwise we split around middle C, following the melody line.
 */
export function assignHands(notes) {
  const groups = new Map();
  for (const n of notes) {
    const k = `${n.track}:${n.channel}`;
    if (!groups.has(k)) groups.set(k, { sum: 0, count: 0, notes: [] });
    const g = groups.get(k);
    g.sum += n.midi; g.count++; g.notes.push(n);
  }
  const list = [...groups.values()].filter((g) => g.count > 0);
  if (list.length >= 2) {
    list.sort((a, b) => b.sum / b.count - a.sum / a.count);
    // Highest-average group is the right hand; the next is the left; others by register.
    list.forEach((g, i) => {
      const avg = g.sum / g.count;
      const hand = i === 0 ? 'R' : i === 1 ? 'L' : avg >= 60 ? 'R' : 'L';
      for (const n of g.notes) n.hand = hand;
    });
    return;
  }
  // Single stream: split point follows the music. For each chord onset, the gap between
  // hands is the widest interval in the chord when that is near middle C.
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j < notes.length && notes[j].start - notes[i].start < 0.03) j++;
    const chord = notes.slice(i, j).sort((a, b) => a.midi - b.midi);
    let split = 60;
    if (chord.length > 1) {
      let best = -1;
      for (let k = 1; k < chord.length; k++) {
        const gap = chord[k].midi - chord[k - 1].midi;
        const mid = (chord[k].midi + chord[k - 1].midi) / 2;
        if (gap >= 5 && Math.abs(mid - 60) < 14 && gap > best) { best = gap; split = mid; }
      }
    }
    for (const n of chord) n.hand = n.midi >= split ? 'R' : 'L';
    i = j;
  }
}

/**
 * Pedalling for files without CC64: change the pedal on every new bass note (legato
 * "syncopated" pedalling as a pianist would), never holding longer than ~2.5 s.
 */
export function autoPedals(notes) {
  const bassOnsets = [];
  let i = 0;
  while (i < notes.length) {
    let j = i;
    let low = 128;
    while (j < notes.length && notes[j].start - notes[i].start < 0.05) { low = Math.min(low, notes[j].midi); j++; }
    if (low < 57) bassOnsets.push(notes[i].start);
    i = j;
  }
  if (bassOnsets.length < 4) return []; // not enough harmonic rhythm to pedal safely
  const out = [];
  for (let k = 0; k < bassOnsets.length; k++) {
    const start = bassOnsets[k] + 0.06;
    const next = k + 1 < bassOnsets.length ? bassOnsets[k + 1] : start + 2;
    const end = Math.min(next + 0.01, start + 2.5);
    if (end - start > 0.15) out.push({ start, end });
  }
  return out;
}

/**
 * Compute the audio "damp" time for every note (key release, or later if the pedal is
 * holding the damper up) plus derived facts used by the player and the visuals.
 */
export function finalize(perf) {
  const { notes } = perf;
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const pedals = (perf.pedals || []).slice().sort((a, b) => a.start - b.start);
  let maxEnd = 0;
  let maxLen = 0;
  let pi = 0;
  const byEnd = notes.map((n, idx) => idx).sort((a, b) => notes[a].end - notes[b].end);
  for (const idx of byEnd) {
    const n = notes[idx];
    while (pi < pedals.length && pedals[pi].end <= n.end) pi++;
    // Pedal intervals are disjoint and sorted, so only pedals[pi] can contain n.end.
    const p = pedals[pi];
    n.damp = p && p.start <= n.end && n.end < p.end ? p.end : n.end;
  }
  for (const n of notes) {
    maxEnd = Math.max(maxEnd, n.end);
    maxLen = Math.max(maxLen, n.end - n.start);
  }
  for (const p of pedals) if (!isFinite(p.end)) p.end = maxEnd + 1.5;
  for (const n of notes) if (!isFinite(n.damp)) n.damp = maxEnd + 1.5;
  perf.pedals = pedals;
  perf.duration = maxEnd;
  perf.maxNoteLength = maxLen;
  let lo = 108, hi = 21;
  for (const n of notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
  perf.range = [lo, hi];
  return perf;
}
