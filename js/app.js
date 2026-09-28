// Nocturne: application controller. Wires the audio engine, player, visuals, library and UI.

import { SampleBank } from './audio/sample-bank.js';
import { AudioEngine, DEFAULT_SOUND } from './audio/engine.js';
import { ROOMS } from './audio/reverb.js';
import { renderPerformance, encodeWav } from './audio/export.js';
import { Player } from './player.js';
import { Keyboard } from './ui/keyboard.js';
import { Waterfall } from './ui/waterfall.js';
import { midiToPerformance } from './midi/performance.js';
import { composeReverie } from './music/composer.js';
import { COLLECTION, CLASSICS, ORIGINALS, matchSlot, titleFromFileName } from './library/catalog.js';
import { listMidi, saveMidi, deleteMidi, loadPrefs, savePrefs } from './storage.js';
import { bindComputerKeyboard, bindMidiInput, isTypingTarget } from './input.js';
import { formatTime, clamp } from './music/theory.js';

const $ = (id) => document.getElementById(id);
const app = $('app');

// ---------------------------------------------------------------- preferences
const prefs = loadPrefs('prefs', {
  sound: { ...DEFAULT_SOUND },
  usePedal: true,
  pxPerSec: 150,
  particles: true,
  labels: false,
  fit: 'auto',
  muteL: false,
  muteR: false,
  tempo: 100,
  loop: false,
  autonext: true,
  reverieSeed: 1 + Math.floor(Math.random() * 9999),
  lastItem: null,
});
prefs.sound = { ...DEFAULT_SOUND, ...prefs.sound };
const persist = () => savePrefs('prefs', prefs);

// ---------------------------------------------------------------- audio
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx({ latencyHint: 'interactive' });
const bank = new SampleBank();
const engine = new AudioEngine(ctx, bank, prefs.sound);
const player = new Player(engine);
player.usePedal = prefs.usePedal;
player.muted = { L: prefs.muteL, R: prefs.muteR };
player.setRate(prefs.tempo / 100);

// ---------------------------------------------------------------- visuals
const kbCanvas = $('keyboard');
const wfCanvas = $('waterfall');
const live = new Map();       // midi -> { voice, sustained }
const liveTrails = [];        // rising notes played by the user
let livePedal = false;

const keyboard = new Keyboard(kbCanvas, {
  onPress: (m, v) => liveOn(m, v),
  onRelease: (m) => liveOff(m),
});
keyboard.showLabels = prefs.labels;
const waterfall = new Waterfall(wfCanvas, keyboard);
waterfall.pxPerSec = prefs.pxPerSec;
waterfall.particlesOn = prefs.particles;

function layout() {
  const stage = $('stage');
  const W = stage.clientWidth;
  applyRange();
  const whites = countWhites(keyboard.lo, keyboard.hi);
  const ww = W / whites;
  const kbH = Math.round(clamp(ww * 5.6, 96, Math.min(240, stage.clientHeight * 0.34)));
  keyboard.resize(W, kbH);
  document.documentElement.style.setProperty('--kb-h', `${kbH + 26}px`);
  const wfH = Math.max(40, stage.clientHeight - kbH - 26);
  wfCanvas.style.height = `${wfH}px`;
  waterfall.resize(W, wfH);
  drawDensity();
}

function countWhites(lo, hi) {
  let n = 0;
  for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) n++;
  return n;
}

function applyRange() {
  const narrow = window.innerWidth < 720;
  const fit = prefs.fit === 'song' || (prefs.fit === 'auto' && narrow);
  if (fit && player.perf) {
    let [lo, hi] = player.perf.range;
    lo += player.transpose; hi += player.transpose;
    const minSpan = narrow ? 24 : 36;
    const pad = 2;
    lo -= pad; hi += pad;
    if (hi - lo < minSpan) { const c = (lo + hi) / 2; lo = Math.round(c - minSpan / 2); hi = Math.round(c + minSpan / 2); }
    keyboard.setRange(clamp(lo, 21, 108), clamp(hi, 21, 108));
  } else if (fit && narrow) {
    keyboard.setRange(48, 84);
  } else {
    keyboard.setRange(21, 108);
  }
}

new ResizeObserver(() => layout()).observe($('stage'));

// ---------------------------------------------------------------- live playing
function liveOn(midi, vel) {
  if (midi < 21 || midi > 108) return;
  if (ctx.state !== 'running') ctx.resume();
  const prev = live.get(midi);
  if (prev) prev.voice?.release(ctx.currentTime, 0.08, false);
  const voice = engine.sampler.noteOn(midi, vel, ctx.currentTime + 0.005);
  live.set(midi, { voice, vel, sustained: false });
  liveTrails.push({ midi, vel, age: 0, released: false, heldFor: 0, sparked: false });
  hideHint();
}

function liveOff(midi) {
  const n = live.get(midi);
  if (!n) return;
  const trail = [...liveTrails].reverse().find((t) => t.midi === midi && !t.released);
  if (trail) { trail.released = true; trail.heldFor = trail.age; }
  if (livePedal) { n.sustained = true; return; }
  n.voice?.release(ctx.currentTime);
  live.delete(midi);
}

function setLivePedal(down) {
  livePedal = down;
  engine.pedal(down, ctx.currentTime);
  if (!down) {
    for (const [m, n] of live) if (n.sustained) { n.voice?.release(ctx.currentTime); live.delete(m); }
  }
}

bindComputerKeyboard({ noteOn: liveOn, noteOff: liveOff });
bindMidiInput({
  noteOn: liveOn,
  noteOff: liveOff,
  pedal: setLivePedal,
  onDevices: (names) => { if (names.length) toast(`MIDI keyboard connected: ${names.join(', ')}`); },
});

// ---------------------------------------------------------------- library
let records = [];        // stored MIDI files
let items = [];          // flattened playable list, in library order
let current = null;      // current item
const perfCache = new Map();

async function refreshLibrary() {
  records = await listMidi();
  buildItems();
  renderLibrary();
}

function buildItems() {
  const bySlot = new Map(records.filter((r) => r.slotId).map((r) => [r.slotId, r]));
  items = [];
  for (const slot of COLLECTION) {
    items.push({ id: slot.id, kind: 'slot', slot, title: slot.title, subtitle: slot.subtitle, record: bySlot.get(slot.id) || null });
  }
  for (const r of records.filter((x) => !x.slotId).sort((a, b) => a.added - b.added)) {
    items.push({ id: r.id, kind: 'custom', title: r.title, subtitle: r.fileName, record: r });
  }
  for (const c of CLASSICS) items.push({ id: c.id, kind: 'builtin', group: 'classics', title: c.title, subtitle: c.subtitle, build: c.build });
  for (const c of ORIGINALS) items.push({ id: c.id, kind: 'builtin', group: 'originals', title: c.title, subtitle: c.subtitle, build: c.build });
  items.push({ id: 'reverie', kind: 'reverie', group: 'originals', title: 'Reverie', subtitle: 'A new piece composed every time' });
}

const playable = (it) => it.kind !== 'slot' || it.record;

function renderLibrary() {
  const body = $('library-body');
  body.innerHTML = '';

  const section = (title, note, desc) => {
    const el = document.createElement('div');
    el.className = 'lib-section';
    el.innerHTML = `<div class="lib-section-head"><span class="lib-section-title"></span><span class="lib-section-note"></span></div>`;
    el.querySelector('.lib-section-title').textContent = title;
    el.querySelector('.lib-section-note').textContent = note || '';
    if (desc) {
      const d = document.createElement('div');
      d.className = 'lib-desc';
      d.textContent = desc;
      el.appendChild(d);
    }
    body.appendChild(el);
    return el;
  };

  const loaded = items.filter((i) => i.kind === 'slot' && i.record).length;
  const mine = section('Your collection', `${loaded} / ${COLLECTION.length} ready`,
    'Attach a MIDI arrangement to each song and the piano will perform it. Files stay on this device.');
  let n = 0;
  for (const it of items.filter((i) => i.kind === 'slot' || i.kind === 'custom')) mine.appendChild(songRow(it, ++n));

  const cl = section('Classics', 'public domain');
  n = 0;
  for (const it of items.filter((i) => i.group === 'classics')) cl.appendChild(songRow(it, ++n));

  const og = section('Originals', 'written for Nocturne');
  n = 0;
  for (const it of items.filter((i) => i.group === 'originals')) og.appendChild(songRow(it, ++n));
}

function songRow(it, num) {
  const row = document.createElement('div');
  row.className = 'song';
  row.dataset.id = it.id;
  if (!playable(it)) row.classList.add('empty');
  if (current && current.id === it.id) row.classList.add('active');
  if (current && current.id === it.id && player.playing) row.classList.add('is-playing');
  row.innerHTML = `
    <div class="song-num"><span class="n"></span><span class="eq"><i></i><i></i><i></i></span></div>
    <div class="song-main"><div class="song-title"></div><div class="song-sub"></div></div>
    <div class="song-side"></div>`;
  row.querySelector('.n').textContent = String(num);
  row.querySelector('.song-title').textContent = it.title;
  const sub = it.kind === 'slot' && it.record
    ? [it.subtitle, it.record.fileName].filter(Boolean).join(' · ')
    : it.kind === 'reverie' ? `${it.subtitle} · No. ${prefs.reverieSeed}` : it.subtitle;
  row.querySelector('.song-sub').textContent = sub || (it.kind === 'slot' ? 'No MIDI attached yet' : '');
  const side = row.querySelector('.song-side');

  if (it.kind === 'slot' && !it.record) {
    const b = document.createElement('button');
    b.className = 'chip-btn';
    b.textContent = 'Add MIDI';
    b.addEventListener('click', (e) => { e.stopPropagation(); pickFiles(it.slot.id); });
    side.appendChild(b);
    row.addEventListener('click', () => pickFiles(it.slot.id));
    return row;
  }
  const cached = perfCache.get(cacheKey(it));
  if (cached) {
    const d = document.createElement('span');
    d.className = 'song-dur';
    d.textContent = formatTime(cached.duration);
    side.appendChild(d);
  }
  if (it.kind === 'reverie') {
    const b = iconButton('<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" class="fill"/><circle cx="15" cy="15" r="1.2" class="fill"/><circle cx="15" cy="9" r="1.2" class="fill"/><circle cx="9" cy="15" r="1.2" class="fill"/></svg>', 'Compose a new one');
    b.addEventListener('click', (e) => { e.stopPropagation(); newReverie(); });
    side.appendChild(b);
  }
  if (it.record) {
    const b = iconButton('<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.3" class="fill"/><circle cx="12" cy="12" r="1.3" class="fill"/><circle cx="18" cy="12" r="1.3" class="fill"/></svg>', 'More');
    b.addEventListener('click', (e) => { e.stopPropagation(); openMenu(e.currentTarget, it); });
    side.appendChild(b);
  }
  row.addEventListener('click', () => selectItem(it, true));
  return row;
}

function iconButton(svg, label) {
  const b = document.createElement('button');
  b.className = 'icon-btn more-btn';
  b.innerHTML = svg;
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}

function openMenu(anchor, it) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'ctx-menu';
  const add = (label, fn, cls) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', () => { closeMenu(); fn(); });
    menu.appendChild(b);
  };
  if (it.kind === 'slot') add('Replace MIDI file…', () => pickFiles(it.slot.id));
  add('Remove from library', async () => {
    await deleteMidi(it.record.id);
    perfCache.delete(cacheKey(it));
    if (current && current.id === it.id) { player.pause(); current = null; player.perf = null; updateNowPlaying(); }
    await refreshLibrary();
    toast('Removed');
  }, 'danger');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
  setTimeout(() => document.addEventListener('pointerdown', onDocDown), 0);
}
function onDocDown(e) { if (!e.target.closest('#ctx-menu')) closeMenu(); }
function closeMenu() { $('ctx-menu')?.remove(); document.removeEventListener('pointerdown', onDocDown); }

const cacheKey = (it) => (it.kind === 'reverie' ? `reverie:${prefs.reverieSeed}` : `${it.id}:${it.record?.added || ''}`);

function performanceFor(it) {
  const key = cacheKey(it);
  if (perfCache.has(key)) return perfCache.get(key);
  let perf;
  if (it.kind === 'builtin') perf = it.build();
  else if (it.kind === 'reverie') perf = composeReverie(prefs.reverieSeed);
  else perf = midiToPerformance(it.record.data, { title: it.title, subtitle: it.subtitle || it.record.fileName });
  perfCache.set(key, perf);
  return perf;
}

function selectItem(it, autoplay) {
  if (!playable(it)) return;
  let perf;
  try {
    perf = performanceFor(it);
  } catch (err) {
    console.error(err);
    toast(`Could not read this file: ${err.message}`);
    return;
  }
  const wasCurrent = current && current.id === it.id && player.perf === perf;
  if (wasCurrent && autoplay) { player.play(); closeDrawers(); return; }
  current = it;
  prefs.lastItem = it.id;
  persist();
  player.pause();
  player.load(perf);
  waterfall.clearEffects();
  layout();
  updateNowPlaying();
  renderLibrary();
  if (autoplay) {
    closeDrawers();
    hideHint();
    player.play();
  }
}

function newReverie() {
  prefs.reverieSeed = 1 + Math.floor(Math.random() * 9999);
  persist();
  const it = items.find((i) => i.kind === 'reverie');
  selectItem(it, true);
}

function step(dir) {
  const list = items.filter(playable);
  if (!list.length) return;
  let idx = current ? list.findIndex((i) => i.id === current.id) : -1;
  idx = (idx + dir + list.length) % list.length;
  const next = list[idx];
  if (next.kind === 'reverie' && current?.kind === 'reverie') newReverie();
  else selectItem(next, true);
}

// ---------------------------------------------------------------- importing
let importTarget = null;
function pickFiles(slotId = null) {
  importTarget = slotId;
  $('file-input').value = '';
  $('file-input').click();
}
$('file-input').addEventListener('change', (e) => importFiles([...e.target.files], importTarget));
$('btn-import').addEventListener('click', () => pickFiles(null));

async function importFiles(files, slotId = null) {
  const midis = files.filter((f) => /\.(mid|midi|kar|rmi)$/i.test(f.name) || /midi/.test(f.type));
  if (!midis.length) { toast('Please choose .mid or .midi files'); return; }
  let lastItemId = null;
  const messages = [];
  for (const f of midis) {
    const data = await f.arrayBuffer();
    try {
      midiToPerformance(data.slice(0), { title: f.name }); // validate before storing
    } catch (err) {
      messages.push(`${f.name}: ${err.message}`);
      continue;
    }
    const slot = slotId ? COLLECTION.find((s) => s.id === slotId) : matchSlot(f.name);
    const rec = slot
      ? { id: slot.id, slotId: slot.id, title: slot.title, fileName: f.name, data, added: Date.now() }
      : { id: `custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, slotId: null, title: titleFromFileName(f.name), fileName: f.name, data, added: Date.now() };
    await saveMidi(rec);
    messages.push(slot ? `“${slot.title}” is ready` : `Added “${rec.title}”`);
    lastItemId = rec.id;
    slotId = null; // only the first file goes to an explicitly chosen slot
  }
  importTarget = null;
  await refreshLibrary();
  toast(messages.join(' · '));
  const it = items.find((i) => i.id === lastItemId);
  if (it) selectItem(it, true);
}

// Drag & drop anywhere.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('drop-overlay').classList.add('show'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').classList.remove('show'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').classList.remove('show');
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) importFiles(files, null);
});

// ---------------------------------------------------------------- transport UI
function updateNowPlaying() {
  const perf = player.perf;
  $('np-title').textContent = perf ? perf.title : 'Nothing loaded';
  $('np-sub').textContent = perf ? (perf.subtitle || '') : 'Choose a piece from the library';
  $('time-total').textContent = formatTime(player.duration / player.rate);
  const pill = $('status-pill');
  if (perf?.meta?.autoPedal && perf.pedals.length) { pill.hidden = false; pill.textContent = 'Auto-pedal'; pill.title = 'This file has no pedal data, so Nocturne pedals it for you.'; }
  else pill.hidden = true;
  document.title = perf ? `${perf.title} · Nocturne` : 'Nocturne · Self-Playing Grand Piano';
  if ('mediaSession' in navigator && perf) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: perf.title, artist: perf.subtitle || 'Nocturne', album: 'Nocturne' });
    } catch { /* unsupported */ }
  }
}

player.addEventListener('state', () => {
  app.classList.toggle('playing', player.playing);
  $('btn-play').setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  document.querySelectorAll('.song.active').forEach((el) => el.classList.toggle('is-playing', player.playing));
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused';
  wakeLock(player.playing);
  resetIdle();
});

player.addEventListener('end', () => {
  if (prefs.loop) { player.seek(0); player.play(); return; }
  if (prefs.autonext) setTimeout(() => step(1), 900);
});

$('btn-play').addEventListener('click', togglePlay);
function togglePlay() {
  if (ctx.state !== 'running') ctx.resume();
  if (!player.perf) {
    const it = items.find((i) => i.id === prefs.lastItem && playable(i)) || items.find((i) => i.id === 'bach-846');
    if (it) selectItem(it, true);
    return;
  }
  hideHint();
  player.toggle();
}
$('btn-prev').addEventListener('click', () => {
  if (player.perf && player.time > 3) player.seek(0);
  else step(-1);
});
$('btn-next').addEventListener('click', () => step(1));
$('btn-back').addEventListener('click', () => player.seek(player.time - 5 * player.rate));
$('btn-fwd').addEventListener('click', () => player.seek(player.time + 5 * player.rate));

const toggleBtn = (id, key) => {
  const b = $(id);
  const sync = () => { b.classList.toggle('on', !!prefs[key]); b.setAttribute('aria-pressed', String(!!prefs[key])); };
  sync();
  b.addEventListener('click', () => { prefs[key] = !prefs[key]; persist(); sync(); });
};
toggleBtn('btn-loop', 'loop');
toggleBtn('btn-autonext', 'autonext');

function styleRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

const tempo = $('tempo');
tempo.value = prefs.tempo;
const syncTempo = () => {
  $('tempo-value').textContent = `${tempo.value}%`;
  styleRange(tempo);
};
syncTempo();
tempo.addEventListener('input', () => {
  prefs.tempo = +tempo.value;
  player.setRate(prefs.tempo / 100);
  syncTempo();
  $('time-total').textContent = formatTime(player.duration / player.rate);
  persist();
});
tempo.addEventListener('dblclick', () => { tempo.value = 100; tempo.dispatchEvent(new Event('input')); });

const volume = $('volume');
volume.value = Math.round(prefs.sound.volume * 100);
styleRange(volume);
volume.addEventListener('input', () => {
  prefs.sound.volume = volume.value / 100;
  engine.applySettings({ volume: prefs.sound.volume });
  styleRange(volume);
  persist();
});

let transpose = 0;
const setTranspose = (v) => {
  transpose = clamp(v, -12, 12);
  player.setTranspose(transpose);
  $('transpose-value').textContent = transpose > 0 ? `+${transpose}` : String(transpose);
  layout();
};
$('transpose-down').addEventListener('click', () => setTranspose(transpose - 1));
$('transpose-up').addEventListener('click', () => setTranspose(transpose + 1));

// Scrubber.
const scrubber = $('scrubber');
let scrubbing = false;
function scrubTo(e) {
  const r = scrubber.getBoundingClientRect();
  const f = clamp((e.clientX - r.left) / r.width, 0, 1);
  player.seek(f * player.duration);
  waterfall.clearEffects();
}
scrubber.addEventListener('pointerdown', (e) => {
  if (!player.perf) return;
  scrubbing = true;
  scrubber.classList.add('dragging');
  scrubber.setPointerCapture(e.pointerId);
  scrubTo(e);
});
scrubber.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e); });
const endScrub = () => { scrubbing = false; scrubber.classList.remove('dragging'); };
scrubber.addEventListener('pointerup', endScrub);
scrubber.addEventListener('pointercancel', endScrub);
scrubber.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { player.seek(player.time - 5); e.preventDefault(); e.stopPropagation(); }
  if (e.key === 'ArrowRight') { player.seek(player.time + 5); e.preventDefault(); e.stopPropagation(); }
});

function drawDensity() {
  const c = $('density');
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, r.width, r.height);
  const mid = r.height / 2;
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(0, mid - 1, r.width, 2);
  const perf = player.perf;
  if (!perf || !perf.duration) return;
  const bins = Math.max(10, Math.floor(r.width / 3));
  const counts = new Float32Array(bins);
  for (const n of perf.notes) counts[Math.min(bins - 1, Math.floor((n.start / perf.duration) * bins))] += 0.5 + n.vel;
  let max = 0;
  for (const v of counts) max = Math.max(max, v);
  const bw = r.width / bins;
  for (let i = 0; i < bins; i++) {
    const h = Math.max(1.5, (Math.sqrt(counts[i] / (max || 1))) * (r.height * 0.8));
    g.fillStyle = 'rgba(231,194,125,0.32)';
    g.fillRect(i * bw + 0.5, mid - h / 2, Math.max(1, bw - 1.2), h);
  }
}

// ---------------------------------------------------------------- drawers
function openDrawer(id) {
  closeDrawers();
  $(id).classList.add('open');
  $('scrim').classList.add('show');
}
function closeDrawers() {
  document.querySelectorAll('.drawer.open').forEach((d) => d.classList.remove('open'));
  $('scrim').classList.remove('show');
  closeMenu();
}
$('btn-library').addEventListener('click', () => ($('library').classList.contains('open') ? closeDrawers() : openDrawer('library')));
$('btn-settings').addEventListener('click', () => ($('settings').classList.contains('open') ? closeDrawers() : openDrawer('settings')));
$('hint-open-library').addEventListener('click', () => openDrawer('library'));
$('scrim').addEventListener('click', closeDrawers);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDrawers));

// ---------------------------------------------------------------- settings
function buildSettings() {
  const body = $('settings-body');
  body.innerHTML = '';
  const group = (title) => {
    const g = document.createElement('div');
    g.className = 'set-group';
    const h = document.createElement('h3');
    h.textContent = title;
    g.appendChild(h);
    body.appendChild(g);
    return g;
  };
  const row = (g, label, help, ctl) => {
    const r = document.createElement('div');
    r.className = 'set-row';
    const l = document.createElement('div');
    l.innerHTML = '<div class="set-label"></div>' + (help ? '<div class="set-help"></div>' : '');
    l.querySelector('.set-label').textContent = label;
    if (help) l.querySelector('.set-help').textContent = help;
    r.append(l, ctl);
    g.appendChild(r);
  };
  const slider = (value, min, max, stepV, fmt, onInput) => {
    const wrap = document.createElement('div');
    wrap.className = 'set-ctl';
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = stepV; inp.value = value;
    const out = document.createElement('span');
    out.className = 'set-value';
    const sync = () => { out.textContent = fmt(+inp.value); styleRange(inp); };
    sync();
    inp.addEventListener('input', () => { onInput(+inp.value); sync(); persist(); });
    wrap.append(inp, out);
    return wrap;
  };
  const toggle = (checked, onChange) => {
    const lab = document.createElement('label');
    lab.className = 'switch';
    lab.innerHTML = '<input type="checkbox"><span></span>';
    const inp = lab.querySelector('input');
    inp.checked = checked;
    inp.addEventListener('change', () => { onChange(inp.checked); persist(); });
    return lab;
  };
  const segmented = (options, value, onPick) => {
    const seg = document.createElement('div');
    seg.className = 'segmented';
    for (const [val, label] of options) {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('on', val === value);
      b.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        onPick(val);
        persist();
      });
      seg.appendChild(b);
    }
    return seg;
  };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const snd = (k) => (v) => { prefs.sound[k] = v; engine.applySettings({ [k]: v }); };

  const g1 = group('Sound');
  row(g1, 'Room', 'The space the piano is playing in', segmented(Object.entries(ROOMS).map(([k, r]) => [k, r.label]), prefs.sound.room, snd('room')));
  row(g1, 'Reverb', null, slider(prefs.sound.reverb, 0, 1, 0.01, pct, snd('reverb')));
  row(g1, 'Brightness', 'Tone colour, from warm to brilliant', slider(prefs.sound.brightness, 0, 1, 0.01, pct, snd('brightness')));
  row(g1, 'Stereo width', 'Bass left, treble right, as the pianist hears it', slider(prefs.sound.stereoWidth, 0, 1, 0.01, pct, snd('stereoWidth')));
  row(g1, 'Pedal resonance', 'Strings ringing in sympathy when the dampers lift', slider(prefs.sound.resonance, 0, 1, 0.01, pct, snd('resonance')));
  row(g1, 'Key & damper noise', 'The mechanical sounds of a real instrument', slider(prefs.sound.releaseNoise, 0, 1, 0.01, pct, snd('releaseNoise')));

  const g2 = group('Performance');
  row(g2, 'Sustain pedal', 'Follow the pedalling in the score', toggle(prefs.usePedal, (v) => { prefs.usePedal = v; player.usePedal = v; }));
  row(g2, 'Left hand', 'Mute it to practise along', toggle(!prefs.muteL, (v) => { prefs.muteL = !v; player.muted.L = !v; }));
  row(g2, 'Right hand', 'Mute it to practise along', toggle(!prefs.muteR, (v) => { prefs.muteR = !v; player.muted.R = !v; }));

  const g3 = group('Display');
  row(g3, 'Falling speed', null, slider(prefs.pxPerSec, 60, 400, 10, (v) => `${Math.round(v / 1.5)}%`, (v) => { prefs.pxPerSec = v; waterfall.pxPerSec = v; }));
  row(g3, 'Sparks', null, toggle(prefs.particles, (v) => { prefs.particles = v; waterfall.particlesOn = v; }));
  row(g3, 'Note names', 'Label every C on the keyboard', toggle(prefs.labels, (v) => { prefs.labels = v; keyboard.showLabels = v; }));
  row(g3, 'Keyboard range', 'Zoom the keyboard to the notes the piece uses', segmented([['auto', 'Auto'], ['full', '88 keys'], ['song', 'Fit piece']], prefs.fit, (v) => { prefs.fit = v; layout(); }));

  const g4 = group('Export');
  const actions = document.createElement('div');
  actions.className = 'set-actions';
  const exp = document.createElement('button');
  exp.className = 'secondary-btn';
  exp.id = 'btn-export';
  exp.textContent = 'Export this performance as WAV';
  exp.addEventListener('click', exportWav);
  actions.appendChild(exp);
  g4.appendChild(actions);

  const about = document.createElement('div');
  about.className = 'about';
  about.innerHTML = `Piano: <a href="https://archive.org/details/SalamanderGrandPianoV3" target="_blank" rel="noopener">Salamander Grand Piano V3</a> by Alexander Holm (Yamaha C5), CC BY 3.0. Four velocity layers, 88 release samples.<br>
    Play along: mouse or touch, a MIDI keyboard, or your computer keys (Z–/ and Q–P rows). Space plays or pauses, ←/→ skip 5 s, F goes full screen.`;
  body.appendChild(about);
}

async function exportWav() {
  if (!player.perf) { toast('Choose a piece first'); return; }
  const btn = $('btn-export');
  if (btn.disabled) return;
  btn.disabled = true;
  const label = btn.textContent;
  try {
    await bank.fullyLoaded;
    const buffer = await renderPerformance(player.perf, bank, prefs.sound, {
      rate: player.rate, transpose, usePedal: player.usePedal, muted: player.muted, sampleRate: ctx.sampleRate,
    }, (p) => { btn.textContent = `Rendering… ${Math.round(p * 100)}%`; });
    btn.textContent = 'Encoding…';
    await new Promise((r) => setTimeout(r, 30));
    const blob = encodeWav(buffer);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${player.perf.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'performance'}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast('Your recording is ready');
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------- keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (isTypingTarget(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') {
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowLeft' && document.activeElement?.type !== 'range') {
    e.preventDefault(); player.seek(player.time - 5);
  } else if (e.key === 'ArrowRight' && document.activeElement?.type !== 'range') {
    e.preventDefault(); player.seek(player.time + 5);
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  } else if (e.key === 'Escape') {
    closeDrawers();
  }
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => { app.classList.toggle('cinema', !!document.fullscreenElement); resetIdle(); });

let idleTimer = null;
function resetIdle() {
  app.classList.remove('idle');
  clearTimeout(idleTimer);
  if (app.classList.contains('cinema') && player.playing) idleTimer = setTimeout(() => app.classList.add('idle'), 2800);
}
window.addEventListener('pointermove', resetIdle);

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported action */ } };
  set('play', () => player.play());
  set('pause', () => player.pause());
  set('previoustrack', () => step(-1));
  set('nexttrack', () => step(1));
  set('seekto', (d) => player.seek(d.seekTime * player.rate));
}

let wakeSentinel = null;
async function wakeLock(on) {
  try {
    if (on && !wakeSentinel && navigator.wakeLock) wakeSentinel = await navigator.wakeLock.request('screen');
    else if (!on && wakeSentinel) { await wakeSentinel.release(); wakeSentinel = null; }
  } catch { wakeSentinel = null; }
}

// ---------------------------------------------------------------- toast & hint
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
function hideHint() { $('stage-hint').classList.add('gone'); }

// ---------------------------------------------------------------- render loop
const pressed = new Map();
const active = [];
const timeData = new Float32Array(engine.analyser.fftSize);
let lastFrame = performance.now();
let lastUi = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = player.time;

  pressed.clear();
  for (const n of player.activeNotes(t, active)) {
    const m = n.midi + player.transpose;
    if (m >= 21 && m <= 108 && !player.muted[n.hand]) pressed.set(m, { hand: n.hand, vel: n.vel });
  }
  for (const [m, n] of live) if (!n.sustained || livePedal) pressed.set(m, { hand: 'live', vel: n.vel });

  for (const tr of liveTrails) tr.age += dt;
  while (liveTrails.length && liveTrails[0].released && (liveTrails[0].age - liveTrails[0].heldFor) * waterfall.pxPerSec > waterfall.height + 20) liveTrails.shift();

  engine.analyser.getFloatTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i += 4) sum += timeData[i] * timeData[i];
  const rms = Math.sqrt(sum / (timeData.length / 4));

  keyboard.draw(pressed, dt);
  waterfall.draw({
    perf: player.perf, time: t, transpose: player.transpose, muted: player.muted,
    live: liveTrails, level: clamp(rms * 5, 0, 1), playing: player.playing,
  }, dt);

  if (now - lastUi > 100) {
    lastUi = now;
    const d = player.duration || 1;
    const f = clamp(t / d, 0, 1);
    $('scrub-fill').style.width = `${f * 100}%`;
    $('scrub-thumb').style.left = `${f * 100}%`;
    scrubber.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    $('time-current').textContent = formatTime(Math.min(t, d) / player.rate);
    $('pedal-indicator').classList.toggle('down', player.pedalDownAt(t) && player.playing || livePedal);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function boot() {
  buildSettings();
  layout();
  requestAnimationFrame(frame);
  refreshLibrary();

  const fill = $('load-fill');
  const text = $('load-text');
  const enter = $('btn-enter');
  let ready = false;
  const onProgress = (p) => {
    fill.style.width = `${Math.round(p * 100)}%`;
    if (!ready) text.textContent = bank.synthetic ? `Voicing the piano… ${Math.round(p * 100)}%` : `Tuning the piano… ${Math.round(p * 100)}%`;
  };
  try {
    await bank.load(ctx, onProgress);
  } catch (err) {
    console.error(err);
    text.textContent = 'The piano samples could not be loaded.';
    return;
  }
  ready = true;
  text.textContent = bank.synthetic
    ? 'Recorded samples unavailable here: using the synthesized piano. (Serve the folder over http for the full grand.)'
    : 'The concert grand is ready';
  enter.disabled = false;
  enter.focus();
  bank.fullyLoaded?.then(() => { if (!bank.synthetic) fill.style.width = '100%'; });

  enter.addEventListener('click', async () => {
    await ctx.resume();
    $('splash').classList.add('hide');
    const last = items.find((i) => i.id === prefs.lastItem && playable(i));
    if (last) {
      selectItem(last, false);
      $('stage-hint').querySelector('.hint-title').textContent = last.title;
      $('stage-hint').querySelector('.hint-sub').textContent = 'Press play to continue where you left off, or open the library for something else.';
    } else {
      openDrawer('library');
    }
  });
}

boot();
