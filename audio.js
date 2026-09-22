/* swirls audio — the voice the sound panel has been promising.
 *
 * A classic script on one global, like every other file here (hub CLAUDE.md
 * §2 leaves swirls' script style alone), and deliberately nothing's dependency:
 * main.js reads window.SwirlsAudio through a null guard, so if this file never
 * arrives the game runs exactly as it did before — silently — instead of
 * taking the visuals down with it.
 *
 * WHAT IT PLAYS
 *   audio/theme.m4a  the owner's own composition, 3:39, encoded from the
 *                    master in tools/audio/ (see tools/audio/encode.mjs).
 *   audio/cast.m4a   one soft chime, cast every time a seed is.
 *   audio/mode.m4a   a rising fifth, when the > changes the picture.
 *   Both cues are Sonic Pi pieces; tools/audio/cast.rb and mode.rb are the
 *   source of truth and the .m4a files are their output (§9).
 *
 * OFF BY DEFAULT, AND NOT BY A SWITCH
 *   Both levels default to ZERO. A player who never opens the sound panel
 *   never hears swirls and — because nothing is fetched until a level is
 *   raised — never downloads a byte of it either. Raising either slider is
 *   what turns that side on. There is no separate mute here on purpose: a mute
 *   plate is coming in the pass that rebuilds the corner, and a second control
 *   fighting these two over the same silence would be one too many.
 *
 * NOTHING HERE MAY STALL THE PICTURE
 *   The draw loop never calls into this file. Cues are built in the pointer
 *   handlers, the theme is fetched and decoded asynchronously, and every
 *   failure path ends in console.warn and silence.
 */
(function () {
  'use strict';

  // Same keys the sound panel has been writing since before there was
  // anything to hear, so a level chosen back then is honoured now. main.js
  // reads them too, with the same default — the two files each have to stand
  // on their own, because either one can be the one that fails to load.
  var KEY_MUSIC = 'swirls.vol.music.v1';
  var KEY_SFX = 'swirls.vol.sfx.v1';
  var DEFAULT_MUSIC = 0;
  var DEFAULT_SFX = 0;

  var BASE = 'audio/';
  var CUES = ['cast', 'mode'];

  // The theme is a composed piece with a written beginning and a written end —
  // it swells up out of silence over about two seconds and fades back into it
  // over the last six. That is why it is NOT a loop: joining the end to the
  // start would bury eight seconds of the player's listening under a join
  // nobody composed, and §9's loopStart trick is for pieces rendered to loop,
  // which this one was not. So it is played whole, and then, after a breath,
  // played again. The breath is real silence and the fade is already most of
  // it; five seconds reads as the piece taking a pause rather than as the
  // music having stopped.
  var REPRISE_GAP = 5; // seconds of silence between passes

  // A drag casts a seed every forty milliseconds or so, which would be a
  // rattle rather than a chime. This is the closest two casts are allowed to
  // sound.
  var CAST_MIN_GAP = 120; // ms

  var ctx = null;
  var musicBus = null;
  var sfxBus = null;
  var musicVol = DEFAULT_MUSIC;
  var sfxVol = DEFAULT_SFX;

  var buffers = {}; // name -> AudioBuffer, or null once a load has failed
  var waiting = {}; // name -> callbacks queued while its fetch is in flight

  var themePass = null; // the AudioBufferSourceNode currently sounding
  var themeTimer = 0; // the breath between passes
  var themeOffset = 0; // where the music actually starts in the buffer
  var themeLoading = false; // its 2.6 MB are on the wire right now

  var lastCast = 0;

  function clamp01(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function stored(key, fallback) {
    var raw = storeGet(key);
    if (raw === null) return fallback;
    // localStorage is one namespace shared by every game on this origin
    // (§6) and anything at all may have written here. Trust the range.
    return clamp01(raw);
  }

  musicVol = stored(KEY_MUSIC, DEFAULT_MUSIC);
  sfxVol = stored(KEY_SFX, DEFAULT_SFX);

  /* ---- loading ---------------------------------------------------------
   * Nothing is fetched speculatively. A file is asked for the first time the
   * side that needs it is turned up, so silence costs nothing on the wire.
   * A failure is remembered as null, warned about once, and never retried —
   * a missing sound is a quieter swirls, never a broken one.
   *
   * Callers that arrive while a fetch is in flight join a queue rather than
   * being dropped, so the first tap after the effects slider comes up is not
   * the one that goes unheard.
   */
  function load(name, then) {
    if (Object.prototype.hasOwnProperty.call(buffers, name)) {
      if (buffers[name] && then) then(buffers[name]);
      return;
    }
    if (waiting[name]) {
      if (then) waiting[name].push(then);
      return;
    }
    waiting[name] = then ? [then] : [];
    fetch(BASE + name + '.m4a')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (data) {
        // The callback form as well as the promise: Safari's older
        // decodeAudioData resolves nothing.
        return new Promise(function (resolve, reject) {
          ctx.decodeAudioData(data, resolve, reject);
        });
      })
      .then(function (buffer) {
        buffers[name] = buffer;
        var queue = waiting[name] || [];
        waiting[name] = null;
        for (var i = 0; i < queue.length; i++) queue[i](buffer);
      })
      .catch(function (err) {
        buffers[name] = null;
        waiting[name] = null;
        if (window.console && console.warn) {
          console.warn('swirls: no sound for "' + name + '"', err);
        }
      });
  }

  /* Some decoders hand back the AAC encoder's priming silence at the head of
   * the buffer. Starting at sample zero would then open the theme with a few
   * milliseconds of nothing that the composer did not write — harmless once,
   * but it also means the offset is not where the music is. Scan for the
   * first sample that is actually above the noise floor. (fishtank's
   * client/js/audio.js does the same, there to keep a loop seam honest.) */
  function firstSound(buffer) {
    var data = buffer.getChannelData(0);
    var limit = Math.min(data.length, Math.round(buffer.sampleRate * 0.2));
    for (var i = 0; i < limit; i++) {
      if (Math.abs(data[i]) > 1e-4) return i / buffer.sampleRate;
    }
    return 0;
  }

  /* ---- the theme -------------------------------------------------------- */

  function playThemePass(buffer) {
    if (!ctx || musicVol <= 0) return;
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(musicBus);
    src.onended = function () {
      if (themePass !== src) return; // an older pass we already stopped
      themePass = null;
      if (musicVol <= 0) return;
      themeTimer = setTimeout(function () {
        themeTimer = 0;
        playThemePass(buffer);
      }, REPRISE_GAP * 1000);
    };
    themePass = src;
    src.start(0, themeOffset);
  }

  /* Safe to call as often as you like — unlock() does, on every gesture. The
   * four guards cover already sounding, mid-breath, already downloading, and
   * turned off; the flag matters because the theme is 2.6 MB and a player
   * tapping away while it arrives would otherwise queue a callback per tap. */
  function startTheme() {
    if (!ctx || musicVol <= 0 || themePass || themeTimer || themeLoading) return;
    themeLoading = true;
    load('theme', function (buffer) {
      themeLoading = false;
      // The slider may have gone back to zero while this was downloading.
      if (musicVol <= 0 || themePass || themeTimer) return;
      themeOffset = firstSound(buffer);
      playThemePass(buffer);
    });
  }

  function stopTheme() {
    clearTimeout(themeTimer);
    themeTimer = 0;
    if (!themePass) return;
    var src = themePass;
    themePass = null;
    src.onended = null; // this stop is ours; it must not schedule a reprise
    // The bus is already ramping to zero, so by the time this lands there is
    // nothing left to cut off.
    try { src.stop(ctx.currentTime + 0.3); } catch (e) { /* already stopped */ }
  }

  /* ---- cues ------------------------------------------------------------- */

  function fire(name, gain, rate) {
    if (!ctx || sfxVol <= 0) return;
    load(name, function (buffer) {
      if (sfxVol <= 0) return;
      var src = ctx.createBufferSource();
      var g = ctx.createGain();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      g.gain.value = gain;
      src.connect(g);
      g.connect(sfxBus);
      src.start();
    });
  }

  window.SwirlsAudio = {
    /* Browsers will not start audio until a gesture has happened, so main.js
     * calls this from the first pointerdown or keypress and from every one
     * after — later calls are a cheap state check, and they also bring the
     * context back if the OS suspended it while the tab was away. */
    unlock: function () {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        // A level raised before the first gesture had nowhere to go; now it
        // does. This is the usual path, in fact — the sound panel is reachable
        // from the title screen.
        if (musicVol > 0) startTheme();
        return;
      }
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return; // no Web Audio at all: swirls stays silent
      try {
        ctx = new Ctor();
      } catch (e) {
        if (window.console && console.warn) console.warn('swirls: no audio context', e);
        return;
      }
      if (ctx.state === 'suspended') ctx.resume();
      musicBus = ctx.createGain();
      musicBus.gain.value = musicVol;
      musicBus.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxVol;
      sfxBus.connect(ctx.destination);
      if (musicVol > 0) startTheme();
      if (sfxVol > 0) for (var i = 0; i < CUES.length; i++) load(CUES[i]);
    },

    get musicVolume() { return musicVol; },
    get sfxVolume() { return sfxVol; },

    /* The slider IS the bus gain — not a scale over some hidden master — so
     * the number in the panel is the level, and zero is silence. Both setters
     * have to work before there is a context at all: the panel can be opened
     * from the title screen, before anything has been tapped. */
    setMusicVolume: function (value) {
      var was = musicVol;
      musicVol = clamp01(value);
      storeSet(KEY_MUSIC, String(musicVol));
      if (!ctx) return;
      musicBus.gain.setTargetAtTime(musicVol, ctx.currentTime, 0.08);
      if (musicVol > 0 && was <= 0) startTheme();
      // Down to nothing: let the source go rather than leave it rendering
      // into a silent bus. Raising it again starts the theme from the top,
      // which is the right place for a piece with a written opening.
      else if (musicVol <= 0) stopTheme();
    },

    setSfxVolume: function (value) {
      var was = sfxVol;
      sfxVol = clamp01(value);
      storeSet(KEY_SFX, String(sfxVol));
      if (!ctx) return;
      sfxBus.gain.setTargetAtTime(sfxVol, ctx.currentTime, 0.08);
      if (sfxVol > 0 && was <= 0) for (var i = 0; i < CUES.length; i++) load(CUES[i]);
    },

    /* A seed is cast. `power` is the gesture's own weight — 0.35 for the
     * seeds a drag paints along its path, 0.6 for a tap, more for a flick —
     * and `charge` is how long it was held.
     *
     * One file covers all of it. A charged cast is the same chime played
     * slower and fuller, which is §9's rule exactly: six pitches of one yip
     * are a file and a playbackRate, not six oscillators. The jitter is there
     * so twenty taps in a row are twenty chimes rather than one chime twenty
     * times. */
    cast: function (power, charge) {
      if (!ctx || sfxVol <= 0) return;
      var now = ctx.currentTime * 1000;
      if (now - lastCast < CAST_MIN_GAP) return;
      lastCast = now;
      var p = clamp01(power);
      var c = clamp01(charge);
      var gain = Math.min(1, p * p * 1.6 + c * 0.35);
      var rate = (1.06 - 0.24 * c - 0.12 * p) * (0.98 + Math.random() * 0.04);
      fire('cast', gain, rate);
    },

    /* The picture changes. Full level and no throttle: it answers a decision,
     * not a gesture, and it can only happen as fast as a thumb can press. */
    mode: function () {
      fire('mode', 0.85, 1);
    }
  };
})();
