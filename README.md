# swirls

A meditative canvas toy. Five ambient effect modes, no dependencies, no build step.

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
- **`›` button** (bottom-right) or **←/→/space** — change mode (nine species
  of castable life, each with its own palette and character). The gear button
  opens a menu with a live portrait of every species.

Your last mode is remembered between visits.

## Sound

**Off by default.** Both levels in the sound panel (the speaker, top right)
start at zero, and nothing is fetched until one of them comes up — a player who
never opens the panel never hears swirls and never downloads a byte of it.
Raising a slider is what turns that side on, and the level is remembered.

- **music** — the theme, a composed 3:39 piece. It plays through, takes a
  five-second breath, and begins again. It is not looped: it has a written
  fade-in and a written fade-out, so it is played whole rather than spliced.
- **effects** — a soft chime on every cast, pitched lower and fuller the longer
  the gesture was charged, and a rising fifth when the mode changes.

### Rebuilding the audio

The sources live in `tools/audio/` and the shipped `.m4a` files in `audio/` are
their output.

```sh
# the two cues: Sonic Pi pieces -> WAV -> mono AAC, one gain across the set
SP="/Applications/Sonic Pi.app/Contents/Resources/app/server/native/ruby/bin/ruby"
SONIC_PI_PIECES=tools/audio "$SP" ../tools/audio/render.rb /tmp/swirls cast=4 mode=5
node ../tools/audio/encode-oneshots.mjs /tmp/swirls audio

# the theme: the master in tools/audio/ -> stereo AAC
node tools/audio/encode.mjs
```

Sonic Pi needs the real audio device and will not run inside a sandbox.
