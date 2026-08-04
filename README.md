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
- **`›` button** (bottom-right) or **←/→/space** — change mode (seven species
  of castable life, each with its own palette and character).

Your last mode is remembered between visits.
