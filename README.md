# Nocturne: a self-playing grand piano

A concert grand that plays by itself in your browser. It uses real multi-velocity recordings of a grand piano, sustain pedal, hall reverb, and falling-note visuals that land on an 88-key keyboard as each note sounds.

## Run it

It's a static site with no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 8000     # or: npx http-server -p 8000
# then open http://localhost:8000
```

It can also be published as-is with GitHub Pages (Settings → Pages → deploy from branch).

> Opening `index.html` straight from disk (`file://`) still works, but browsers block loading the recordings that way, so Nocturne falls back to its built-in synthesized piano.

## Your songs

The library has a slot for each song in your collection:

| # | Song |
|---|------|
| 1 | Truth That You Leave Me |
| 2 | 诀别书 |
| 3 | Interstellar |
| 4 | Merry Christmas, Mr. Lawrence |
| 5 | Sacred Play Secret Place |
| 6 | Call of Silence |
| 7 | 梦中的婚礼 (Mariage d'Amour) |
| 8 | 水边的阿丽丽娜 (Ballade pour Adeline) |

These are copyrighted works, so Nocturne doesn't ship their notes. Attach a MIDI arrangement you own or have licensed to a slot: one you bought from a sheet-music store, transcribed yourself, or exported from MuseScore, Sibelius, Logic or similar. The piano will then perform it.

* Click **Add MIDI** next to a song, or
* drop `.mid` files anywhere on the page. Files whose names mention the song (e.g. `merry-christmas-mr-lawrence.mid`, `ballade pour adeline.mid`, `梦中的婚礼.mid`) go to the right slot automatically. Any other file is added as a new song.

Files are stored in your browser (IndexedDB) and never leave your device.

**Tips for the best performance from a MIDI file**

* Files with the sustain pedal (CC 64) recorded sound best. Files without it are pedaled automatically (the *Auto-pedal* badge shows when that happens).
* Two-track piano files (one track per hand) get the hands colored correctly (gold for the right hand, blue for the left). Single-track files are split automatically.
* Velocity (how hard each note is played) is used in full across four recorded dynamic layers, so expressive files sound expressive.

## Built-in pieces

* **Classics (public domain):** Bach, Prelude in C major BWV 846 · Beethoven, *Für Elise* · Pachelbel, *Canon in D* (piano arrangement)
* **Originals:** *Paper Lanterns* and *Letter Never Sent*, written for Nocturne
* **Reverie:** an algorithmic composer that writes a complete new piece each time. It picks a key, meter and chord progressions, invents and develops a motif, and builds it into intro · A · B · A′ · climax · A″ · coda. The dice button composes another.

The built-in pieces are performed with rubato, dynamic arcs, melody voicing, rolled chords and legato pedaling.

## Features

**Sound**
* Salamander Grand Piano V3 (Yamaha C5): 4 velocity layers per note with equal-power crossfading, plus a velocity- and key-tracked tone filter for smooth dynamics
* Real dampers: pitch-dependent damping time, undamped top octaves, re-struck strings, voice stealing
* Sustain pedal with sympathetic string resonance
* Key-release and damper noise from the 88 release recordings
* Procedurally generated stereo hall impulse responses (Studio, Salon, Concert Hall, Cathedral), with high frequencies decaying faster, as in a real room
* Tone EQ, glue compression and a safety limiter; player's-perspective stereo image
* Sample-accurate scheduling on the audio clock from a Worker timer, so timing stays steady even in a background tab

**Visuals**
* 88-key keyboard with key travel, depth and hand-colored glow; optional note names
* Falling notes that land on the key exactly when they sound, with impact glow, sparks and ambient light that follows loudness
* A note-density map in the progress bar
* On phones the keyboard zooms to the piece's range (or choose *88 keys* / *Fit piece*)
* Full-screen cinema mode: controls fade away while it plays

**Control**
* Play/pause, seek, previous/next, speed 25–200 %, transpose ±12, repeat, continue to the next piece
* Mute either hand to practise along
* Play the piano yourself with mouse or multi-touch, a MIDI keyboard (Web MIDI, including its sustain pedal), or your computer keyboard (rows `Z … /` and `Q … P`)
* Shortcuts: `Space` play/pause · `←` `→` skip 5 s · `F` full screen · `Esc` close panels
* Media keys and lock-screen controls (Media Session); the screen stays awake while playing
* **Export as WAV:** renders the current performance offline through the same audio chain to a 24-bit stereo file

## Development

```sh
npm test         # node --test: MIDI parser, performance model, score engine, composer
```

```
index.html, css/style.css
js/app.js                  UI controller
js/player.js               look-ahead scheduler
js/audio/                  sample bank, sampler, engine (mix/master), reverb IRs, WAV export, fallback synth
js/midi/                   SMF parser, MIDI → performance (hands, pedal, damping)
js/music/                  score toolkit, built-in pieces, Reverie composer
js/ui/                     keyboard and waterfall renderers
js/library/catalog.js      song slots and file-name matching
tests/                     unit tests (with a tiny MIDI writer for fixtures)
```

See [CREDITS.md](CREDITS.md) for sample licensing.
