# swirls

A meditative canvas toy. Twelve ambient effect modes, no dependencies, no build step.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

Push this repository to GitHub, then in the repo settings enable
**Pages → Deploy from a branch → `main` / root**. The app is static files
with relative paths only, so it works from any Pages URL.

## Install on your phone

Once hosted (GitHub Pages or any HTTPS host), open the URL on your phone and
choose **Add to Home Screen** (Chrome menu on Android, Share sheet on iOS).
It installs with its own icon, launches fullscreen without browser chrome,
and works offline.

## Use

You direct the scene: each gesture casts a living animation that travels where
you send it, dances for a while, and fades away. Cast several in a row and
conduct them.

- **Tap** — a life blooms in place and drifts.
- **Flick** — sends one flying in that direction with your throw's energy.
- **Drag** — paints a stream of small lives along your path.
- **Hold** — the life grows and brightens under your finger, pulsing once
  fully charged. Release sends it off exactly as it grew.
- **`‹` and `›`** (bottom-right) or **←/→/space** — step back and forth
  through the twelve species of castable life, each with its own palette and
  character. Both buttons go through the same switch the keys do.
- **`m`** or the mute plate (top right) — silence, and nothing else. It never
  opens a panel, stops nothing, and gives the mix back exactly as it was set.

Your last mode is remembered between visits.

## Starting, and the ring

**There is no start button.** swirls opens on its mark with the twelve species
laid around it, thirty degrees apart, each one a live portrait of what it
draws; the volume levels sit under the ring and the way back to the arcade
under those. **Picking one is how swirls begins**, on that species. A returning
visitor's last choice is already lit in the ring, so carrying on is a matter of
pressing the one that is glowing.

The ring is a real radiogroup of real buttons in clock order: Tab reaches it,
the arrow keys walk the rim either way without committing, Home and End are
noon and eleven o'clock, and Enter or Space picks. Twelve names will not fit
around a rim, so the ring carries the pictures and the **centre carries the
word** — it follows the pointer and the keyboard focus, not just the selection,
so you can read where you are before choosing.

Once you have begun, the same panel is the menu: the **menu plate** in the
corner reopens it and picking a species switches to it. Before you have begun
there is no way to dismiss it, because there would be nothing behind it to
dismiss it onto.

## The corner

Three plates, top right: **menu, mute, fullscreen**, in that order, so
fullscreen is the one in the actual corner. The menu plate is three bars, not
a gear, and it appears once you have begun. Tap the dimmed backdrop, press the
plate again, or press Escape to close the panel.

Sideways on a phone the panel becomes two columns rather than one: the ring in
its own column, the levels and the exit beside it. A menu that scrolls on a
landscape phone loses whatever is last in the column, which is always the way
out.

## Sound

**Off by default.** Both levels in the menu start at zero, and nothing is
fetched until one of them comes up — a player who never opens the menu never
hears swirls and never downloads a byte of it. Raising a slider is what turns
that side on, and the level is remembered. Dragging either one lifts the mute.

- **music** — the theme, a composed 3:39 piece. It plays through, takes a
  five-second breath, and begins again. It is not looped: it has a written
  fade-in and a written fade-out, so it is played whole rather than spliced.
- **effects** — **one cue per effect**, twelve of them, plus a rising fifth
  when the mode changes. Within a family, a cast is pitched lower and fuller
  the longer the gesture was charged.

Nothing is precached; `audio.js` warms the whole cue set the first time the
effects level comes up, and the service worker caches each file as it arrives.
One online session with sound on leaves the full set available offline.

`SwirlsAudio.setMuted(bool)` ramps a master gain above both levels, so muting
never touches the stored mix. It persists at `swirls.muted.v1` and defaults to
unmuted — a fresh visit is silent because the levels are 0, not because it is
muted.

### How the cues are put together

All thirteen are in **Ab major pentatonic**. That is not a preference: a
chromagram over the middle two minutes of the theme puts it in Ab major /
F minor at 92% confidence, so switching family is a change of colour over the
music rather than a change of key against it.

They are distinguished by **timbre and motion, never by attack or loudness** —
nothing in the set is plucked, struck hard or clicked, and every cue is
low-passed. Four timbral families (breath, water, glass, wood) carry twelve
different gestures: a glide, a guttering fall, an undulation, a stillness, a
widening ring, a surge, a descent, a rise, a pulse, an arch, a deep turn, a
pour.

Every piece is **level-calibrated before it ships**. The hub's one-shot encoder
applies one gain to the whole set on purpose, so the balance has to be authored
in the `.rb` files: measured as max-momentary LUFS over the trimmed take, the
twelve sit within 1.1 dB of each other and the mode cue about 2 dB above. If
you change an `amp:`, re-measure the set rather than just that file.

### Rebuilding the audio

The sources live in `tools/audio/` and the shipped `.m4a` files in `audio/` are
their output.

```sh
# the cues: Sonic Pi pieces -> WAV -> mono AAC, ONE gain across the whole set
SP="/Applications/Sonic Pi.app/Contents/Resources/app/server/native/ruby/bin/ruby"
SONIC_PI_PIECES=tools/audio "$SP" ../tools/audio/render.rb /tmp/swirls \
  drift-tide=4 ember-breath=4 aurora-veil=5 still-orbits=4 night-pond=4 \
  verdant-surge=4 petal-fall=4 opal-rise=4 firefly-meadow=4 dusk-fountain=5 \
  ink-eddy=5 stone-rill=4 mode=5
node ../tools/audio/encode-oneshots.mjs /tmp/swirls audio

# the theme: the master in tools/audio/ -> stereo AAC
node tools/audio/encode.mjs
```

A cue file is named for its effect's `id` in `effects.js`. Add an effect
without adding its cue and that family is simply silent, with one line in the
console saying so.

Sonic Pi needs the real audio device and will not run inside a sandbox.
