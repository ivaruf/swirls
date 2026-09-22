/* swirls audio — a voice per family, and it stays quiet until asked.
 *
 * A classic script on one global, like every other file here (hub CLAUDE.md
 * §2 leaves swirls' script style alone), and deliberately nothing's
 * dependency: main.js reads window.SwirlsAudio through a null guard, so if
 * this file never arrives the game runs exactly as it did before — silently —
 * instead of taking the visuals down with it.
 *
 * WHAT IT PLAYS
 *   audio/theme.m4a     the owner's own composition, 3:39, encoded from the
 *                       master in tools/audio/ (see tools/audio/encode.mjs).
 *   audio/<family>.m4a  ONE CUE PER EFFECT. Twelve of them, named for the
 *                       effect ids in effects.js, so casting into Night Pond
 *                       and casting into Ember Breath do not sound alike.
 *   audio/mode.m4a      a rising fifth, when the > changes the picture.
 *   Every cue is a Sonic Pi piece; the .rb files in tools/audio/ are the
 *   source of truth and the .m4a files are their output (§9). All thirteen
 *   are in Ab major pentatonic, which is the key the theme is actually in —
 *   tools/audio/mode.rb records how that was measured and why it matters.
 *
 * OFF BY DEFAULT, AND NOT BY A SWITCH
 *   Both levels default to ZERO. A player who never opens the sound panel
 *   never hears swirls and — because nothing is fetched until a level is
 *   raised — never downloads a byte of it either. Raising either slider is
 *   what turns that side on.
 *
 *   Mute is a SEPARATE thing and defaults to UNMUTED, which is not a
 *   contradiction: silence on a fresh visit comes from the levels being 0, so
 *   a player has one obvious thing to do to turn sound on. Shipping muted as
 *   well would mean two actions, the second of them invisible.
 *
 * NOTHING HERE MAY STALL THE PICTURE
 *   The draw loop never calls into this file. Cues are built in the pointer
 *   handlers, everything is fetched and decoded asynchronously, and every
 *   failure path ends in console.warn and silence.
 */
(function () {
  'use strict';

  // The two level keys the sound panel has been writing since before there
  // was anything to hear, so a level chosen back then is honoured now.
  // main.js reads them too, with the same default — the two files each have
  // to stand on their own, because either one can be the one that fails to
  // load. The mute key is new and in the hub's current shape (§6).
  var KEY_MUSIC = 'swirls.vol.music.v1';
  var KEY_SFX = 'swirls.vol.sfx.v1';
  var KEY_MUTED = 'swirls.muted.v1';
  var DEFAULT_MUSIC = 0;
  var DEFAULT_SFX = 0;

  var BASE = 'audio/';

  // One per effect, named for the ids in effects.js. If those ever drift
  // apart, the family simply has no voice and says so once in the console —
  // it can never break a cast.
  var CUES = [
    'drift-tide',
    'ember-breath',
    'aurora-veil',
    'still-orbits',
    'night-pond',
    'verdant-surge',
    'petal-fall',
    'opal-rise',
    'firefly-meadow',
    'dusk-fountain',
    'ink-eddy',
    'stone-rill'
  ];

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
  // sound. Measured at this spacing, a sustained drag sits 2-3 dB BELOW a
  // single deliberate tap rather than piling up above it, which is the
  // relationship the cues were composed for.
  var CAST_MIN_GAP = 120; // ms

  var ctx = null;
  var master = null; // mute lives here, above both levels
  var musicBus = null;
  var sfxBus = null;
  var musicVol = DEFAULT_MUSIC;
  var sfxVol = DEFAULT_SFX;
  var muted = false;

  var buffers = {}; // name -> AudioBuffer, or null once a load has failed
  var waiting = {}; // name -> callbacks queued while its fetch is in flight
  var warmed = false; // the whole cue set has been asked for

  var themePass = null; // the AudioBufferSourceNode currently sounding
  var themeTimer = 0; // the breath between passes
  var themeOffset = 0; // where the music actually starts in the buffer
  var themeLoading = false; // its 2.6 MB are on the wire right now

  var family = null; // the effect whose cue a cast will play
  var missing = {}; // families we have already complained about
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
  muted = storeGet(KEY_MUTED) === '1';

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

  /* Ask for the whole cue set at once, the first time effects are turned up.
   *
   * THIS IS WHY NONE OF IT IS PRECACHED. Twelve cues are 159 KB, which would
   * be a 40% rise in what every install downloads — for a feature that is off
   * by default, which is exactly the argument that keeps the theme out of
   * sw.js's ASSETS. Warming here instead means nobody pays until they ask,
   * and the service worker's own fetch handler puts each one in the cache as
   * it arrives, so ONE online session with sound on leaves the full set
   * available offline forever after. Better than precaching in both
   * directions.
   */
  function warm() {
    if (warmed || !ctx || sfxVol <= 0) return;
    warmed = true;
    if (family) load(family); // the one being cast into right now goes first
    for (var i = 0; i < CUES.length; i++) load(CUES[i]);
    load('mode');
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
   * tapping away while it arrives would otherwise queue a callback per tap.
   *
   * Mute is deliberately NOT a guard here. A muted theme keeps playing under
   * a silent master, so unmuting gives the piece back where it actually got
   * to rather than starting it again from the top. */
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
    // Muted skips the work rather than doing it into a silent master: a cue
    // is momentary, so there is nothing for an unmute to come back to.
    if (!ctx || sfxVol <= 0 || muted || !name) return;
    load(name, function (buffer) {
      if (sfxVol <= 0 || muted) return;
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
        warm();
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
      // Master above both levels, so mute can silence everything without
      // touching either one and give the exact mix back on the way out.
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicVol;
      musicBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxVol;
      sfxBus.connect(master);
      if (musicVol > 0) startTheme();
      warm();
    },

    /* Which effect is on screen, so a cast knows which voice to use. Called
     * from setEffect, including at boot before there is a context — it simply
     * remembers, and the cue is fetched when effects are turned up. */
    setFamily: function (id) {
      family = id;
      if (!id) return;
      if (CUES.indexOf(id) < 0) {
        // An effect with no cue: worth one line in the console, never a
        // thrown error and never a doomed request every time it is cast into.
        if (!missing[id]) {
          missing[id] = true;
          if (window.console && console.warn) {
            console.warn('swirls: no cue composed for effect "' + id + '"');
          }
        }
        family = null;
        return;
      }
      if (ctx && sfxVol > 0) load(id);
    },

    get musicVolume() { return musicVol; },
    get sfxVolume() { return sfxVol; },
    get muted() { return muted; },

    /* Mute is a master gain, NOT two zeroed levels — which is the whole
     * point: it never touches what the player chose, so unmuting hands back
     * the exact mix. It also fetches nothing and starts nothing, so muting a
     * swirls that has never made a sound is simply a stored flag. */
    setMuted: function (value) {
      muted = !!value;
      storeSet(KEY_MUTED, muted ? '1' : '0');
      if (!master) return; // nothing has been built yet; unlock() will honour it
      master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    },

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
      sfxVol = clamp01(value);
      storeSet(KEY_SFX, String(sfxVol));
      if (!ctx) return;
      sfxBus.gain.setTargetAtTime(sfxVol, ctx.currentTime, 0.08);
      warm();
    },

    /* A seed is cast, in whichever family is on screen. `power` is the
     * gesture's own weight — 0.35 for the seeds a drag paints along its path,
     * 0.6 for a tap, more for a flick — and `charge` is how long it was held.
     *
     * The playbackRate varies WITHIN a family and never between them. That is
     * §9's rule used the way it is meant to be: six pitches of one yip are a
     * file and a playbackRate, so a charged cast is the family's own voice
     * played slower and fuller — but Night Pond and Ember Breath are two
     * compositions, because a rate on a shared file could never make one
     * water and the other breath. The jitter is there so twenty taps in a row
     * are twenty casts rather than one cast twenty times. */
    cast: function (power, charge) {
      if (!ctx || sfxVol <= 0 || muted || !family) return;
      var now = ctx.currentTime * 1000;
      if (now - lastCast < CAST_MIN_GAP) return;
      lastCast = now;
      var p = clamp01(power);
      var c = clamp01(charge);
      var gain = Math.min(1, p * p * 1.6 + c * 0.35);
      var rate = (1.06 - 0.24 * c - 0.12 * p) * (0.98 + Math.random() * 0.04);
      fire(family, gain, rate);
    },

    /* The picture changes. Full level and no throttle: it answers a decision,
     * not a gesture, and it can only happen as fast as a thumb can press. */
    mode: function () {
      fire('mode', 0.85, 1);
    }
  };
})();
