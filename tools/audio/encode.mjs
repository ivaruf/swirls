// Turns the theme master into the file swirls actually ships.
//
//   node tools/audio/encode.mjs [MASTER] [OUT_DIR]
//   node tools/audio/encode.mjs                      # the defaults below
//
// This is the MUSIC half of the encode step, and it is per-game by design (hub
// CLAUDE.md §9): music wants stereo and its own level, one-shots want mono and
// one gain shared across the whole set. The cues go through the hub's
// tools/audio/encode-oneshots.mjs instead, which explains its own reasoning.
//
// WHAT THE MASTER IS, AND WHY IT COULD NOT SHIP AS IT ARRIVED
//   tools/audio/theme-master.mp4 is the owner's own composition — it landed in
//   the repo root as "swirls_theme_music.m4a". The extension was a lie: the
//   stream inside is OPUS in an MP4 container, and Safari supports Opus in
//   WebM/CAF but not in MP4, so that file decodes to nothing on every iPhone
//   and iPad — which is most of the hub's audience. It is kept here as the
//   master because it is the source of truth and audio/theme.m4a is an output
//   of it (§9), and it is named .mp4 rather than .m4a so the name and the
//   contents agree. It is never fetched by the game.
//
// WHY 96k AND A 12 kHz CUTOFF
//   Measured, not guessed: the piece has 60 dB less energy above 10 kHz than it
//   has overall (-77 dBFS against -17). It is a warm, dark, slow piece with
//   essentially nothing up top, so bits spent above 12 kHz are bits spent on
//   silence. 96k stereo with the encoder told where the music stops puts the
//   whole budget in the band that carries the piece, and it is what keeps a
//   3½-minute theme near 2.5 MB instead of 3.5.
//
// WHY WE LEAVE HEADROOM
//   AAC decodes hotter than its source. The master already peaks at -0.9 dBFS,
//   so encoding it untouched risks a decoded waveform that clips on somebody's
//   phone. We trim to TARGET_DB first, then measure the decoded peak and say so
//   — the same discipline as the one-shot encoder, for the same reason.
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

const TARGET_DB = -2.0; // the master's peak is trimmed to here before encoding
const CEILING_DB = -1.0; // and the decoded result must stay under this
const BITRATE = "96k";
const CUTOFF = 12000; // Hz: above this the piece is 60 dB down. See above.

const [master = "tools/audio/theme-master.mp4", outDir = "audio"] =
  process.argv.slice(2);

function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], {
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
  return run.stderr;
}

// astats, not volumedetect: volumedetect measures through a 16-bit histogram,
// so anything at or above full scale reports as exactly 0.0 dB and a file that
// is genuinely clipping looks identical to one sitting perfectly at the
// ceiling. astats works in float and reports positive dBFS when it happens.
function peakDb(file) {
  const log = ffmpeg([
    "-i",
    file,
    "-af",
    "astats=measure_overall=Peak_level:measure_perchannel=none",
    "-f",
    "null",
    "-",
  ]);
  return +(log.match(/Peak level dB:\s*(-?[\d.]+)/)?.[1] ?? 0);
}

function duration(file) {
  const log = ffmpeg(["-i", file, "-f", "null", "-"]);
  const m = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "theme.m4a");
const peak = peakDb(master);
const gain = (TARGET_DB - peak).toFixed(2);

ffmpeg([
  "-i",
  master,
  "-af",
  `volume=${gain}dB`,
  "-ac",
  "2",
  "-ar",
  "48000",
  "-c:a",
  "aac",
  "-b:a",
  BITRATE,
  "-cutoff",
  String(CUTOFF),
  "-movflags",
  "+faststart",
  out,
]);

const decoded = peakDb(out);
const kb = (statSync(out).size / 1024).toFixed(0);
console.log(
  `theme  ${duration(out).toFixed(1)}s  ${kb} KB  ` +
    `peak ${peak.toFixed(2)} -> ${decoded.toFixed(2)} dBFS (trimmed ${gain} dB)`,
);
if (decoded > CEILING_DB)
  console.error(
    `WARNING: decodes at ${decoded.toFixed(2)} dBFS, above the ${CEILING_DB} ceiling. Lower TARGET_DB.`,
  );
