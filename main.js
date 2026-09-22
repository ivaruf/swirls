(function () {
  'use strict';

  var canvas = document.getElementById('c');
  var labelEl = document.getElementById('label');
  var hintEl = document.getElementById('hint');
  var nextBtn = document.getElementById('next');
  var gearBtn = document.getElementById('gear');
  var menuEl = document.getElementById('menu');
  var menuPanel = document.getElementById('menu-panel');
  var errorEl = document.getElementById('error');
  var splashEl = document.getElementById('splash');
  var titleActionsEl = document.getElementById('title-actions');
  var titleExitEl = document.getElementById('title-exit');
  var beginBtn = document.getElementById('begin');
  var soundEl = document.getElementById('sound');
  var soundPanel = document.getElementById('sound-panel');
  var soundOpenBtn = document.getElementById('sound-open');
  var soundBackBtn = document.getElementById('sound-back');

  var effects = window.SwirlsEffects;
  if (!effects || !effects.length) {
    errorEl.classList.add('show');
    hideSplash();
    // Nothing below this line runs, so the panel behind the speaker is never
    // wired. Take the speaker away rather than leaving a button that answers
    // to nothing on a screen that is already admitting something went wrong.
    // The fullscreen icon beside it is unaffected: screen.js is its own file
    // and does not care whether this one got anywhere.
    soundOpenBtn.hidden = true;
    return;
  }

  var ctx = canvas.getContext('2d');

  // The voice, if it turned up. audio.js is its own classic script and is
  // allowed to be missing — blocked, 404, a browser with no Web Audio at all —
  // and every call below is guarded, so swirls without it is exactly the
  // swirls it was before it had a sound: silent, and working.
  var audio = window.SwirlsAudio || null;

  // ---- localStorage (guarded: file:// on some browsers throws) ----------

  var KEY_MODE = 'swirls:mode';
  var KEY_HINT = 'swirls:hint-dismissed';
  // The two above are the old colon style and stay exactly as they are —
  // renaming a live key silently throws away what every existing player has
  // already chosen. New keys take the hub's current shape instead
  // (CLAUDE.md §6), which is why these two do not match their neighbours.
  var KEY_VOL_MUSIC = 'swirls.vol.music.v1';
  var KEY_VOL_SFX = 'swirls.vol.sfx.v1';

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  // ---- state -------------------------------------------------------------

  var pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    vx: 0, // smoothed velocity, CSS px/s; decays to 0 shortly after movement stops
    vy: 0,
    active: false,
    down: false
  };

  var lastMoveX = pointer.x;
  var lastMoveY = pointer.y;
  var lastMoveTime = 0;
  var MAX_POINTER_SPEED = 4000; // px/s, clamp against event-timing spikes

  function trackVelocity(x, y) {
    var now = performance.now();
    if (lastMoveTime) {
      var dtm = (now - lastMoveTime) / 1000;
      if (dtm > 0.001) {
        var ivx = (x - lastMoveX) / dtm;
        var ivy = (y - lastMoveY) / dtm;
        pointer.vx = pointer.vx * 0.6 + ivx * 0.4;
        pointer.vy = pointer.vy * 0.6 + ivy * 0.4;
        var speed = Math.sqrt(pointer.vx * pointer.vx + pointer.vy * pointer.vy);
        if (speed > MAX_POINTER_SPEED) {
          var k = MAX_POINTER_SPEED / speed;
          pointer.vx *= k;
          pointer.vy *= k;
        }
      }
    }
    lastMoveX = x;
    lastMoveY = y;
    lastMoveTime = now;
  }

  // Charge state: while the user holds still, the current species' entity
  // grows at the fingertip. Effects read env.charge and render the build-up;
  // release casts the grown entity as-is.
  var charge = { active: false, x: 0, y: 0, level: 0 };

  var env = {
    ctx: ctx,
    width: 0,
    height: 0,
    t: 0,
    dt: 0,
    pointer: pointer,
    charge: charge
  };

  var current = null;
  var currentIndex = 0;
  var lastPointerActivity = -Infinity; // performance.now() of last pointer move
  var hintDismissed = storeGet(KEY_HINT) === '1';

  // ---- canvas sizing (dpr-aware, capped at 2) -----------------------------

  function sizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    env.width = w;
    env.height = h;
  }

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      sizeCanvas();
      // Re-init the current effect after a resize; t keeps running.
      if (current && typeof current.init === 'function') {
        current.init(env);
      }
    }, 150);
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // ---- effect name overlay -------------------------------------------------

  var labelTimer = 0;
  function showLabel(text) {
    labelEl.textContent = text;
    labelEl.classList.add('visible');
    clearTimeout(labelTimer);
    labelTimer = setTimeout(function () {
      labelEl.classList.remove('visible');
    }, 1600);
  }

  var hintTimer = 0;
  function showHintOnce() {
    if (hintDismissed) return;
    hintEl.classList.add('visible');
    hintTimer = setTimeout(function () {
      hintEl.classList.remove('visible');
    }, 4000);
  }

  function dismissHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    clearTimeout(hintTimer);
    hintEl.classList.remove('visible');
    storeSet(KEY_HINT, '1');
  }

  // ---- effect switching ----------------------------------------------------

  function setEffect(index) {
    var n = effects.length;
    currentIndex = ((index % n) + n) % n;
    current = effects[currentIndex];
    env.t = 0;
    if (typeof current.init === 'function') {
      current.init(env);
    }
    showLabel(current.name || current.id || 'effect ' + (currentIndex + 1));
    storeSet(KEY_MODE, current.id);
    updateMenuHighlight();
  }

  function switchEffect(dir) {
    dismissHint();
    setEffect(currentIndex + dir);
    if (audio) audio.mode();
  }

  // ---- animation loop (paused while document is hidden) --------------------

  var running = false;
  var rafId = 0;
  var lastTime = 0;
  var loggedFrameError = false;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;
    env.dt = dt;
    env.t += dt;
    pointer.active = (performance.now() - lastPointerActivity) < 2000;
    if (performance.now() - lastMoveTime > 80) {
      // No move events lately: bleed velocity off so effects see the release.
      var damp = Math.exp(-dt * 10);
      pointer.vx *= damp;
      pointer.vy *= damp;
    }
    // Charge build-up: holding still past the delay starts growing the entity;
    // once charging, the growth point follows the finger until release.
    if (gesture && pointer.down) {
      var held = performance.now() - gesture.downTime;
      if (!gesture.charging && held > CHARGE_DELAY && gesture.moved < CHARGE_MOVE_LIMIT) {
        gesture.charging = true;
      }
      if (gesture.charging) {
        charge.active = true;
        charge.x = pointer.x;
        charge.y = pointer.y;
        // gentle ease-out: quick early growth, calm approach to full
        var raw = clamp01((held - CHARGE_DELAY) / CHARGE_TIME);
        charge.level = 1 - (1 - raw) * (1 - raw);
      }
    } else if (charge.active) {
      charge.active = false;
      charge.level = 0;
    }
    try {
      current.frame(env);
    } catch (err) {
      if (!loggedFrameError) {
        loggedFrameError = true;
        if (window.console && console.error) console.error('swirls effect error:', err);
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now(); // fresh baseline so dt stays tiny on resume
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else start();
  });

  // ---- casting gestures -------------------------------------------------------
  // Tap = bloom in place. Drag = paint a stream of seeds along the path.
  // A fast release adds one final send-off seed carrying the flick velocity.

  var STREAM_SPACING = 40;   // px of travel between stream seeds
  var STREAM_MIN_GAP = 40;   // ms between stream seeds
  var TAP_MOVE_LIMIT = 12;   // px: gestures under this are taps
  var FLICK_SPEED = 500;     // px/s release speed that counts as a flick
  var CHARGE_DELAY = 250;    // ms of holding still before charging begins
  var CHARGE_TIME = 1400;    // ms from charge start to full charge
  var CHARGE_MOVE_LIMIT = 16; // px: movement allowed before the delay elapses
  var gesture = null;
  var loggedCastError = false;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function castSeed(x, y, power, chargeLevel) {
    if (!current || typeof current.cast !== 'function') return;
    // One chime per seed, at the seed's own weight, and pitched by how long
    // the gesture was held. The charge is read live rather than taken from
    // chargeLevel: a tap released mid-charge passes 0 to the effect (that is
    // the existing contract and not this file's to change), but the hold did
    // happen, and the sound is allowed to know it. Audio only — nothing here
    // reaches the effect. The throttle lives in audio.js, so a drag painting
    // a seed every 40 ms does not become a rattle.
    if (audio) audio.cast(power, charge.active ? charge.level : 0);
    try {
      current.cast(env, {
        x: x, y: y,
        vx: pointer.vx, vy: pointer.vy,
        power: power,
        charge: chargeLevel || 0
      });
    } catch (err) {
      if (!loggedCastError) {
        loggedCastError = true;
        if (window.console && console.error) console.error('swirls cast error:', err);
      }
    }
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!e.isPrimary) return;
    pointer.down = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    // New gesture: reset the velocity baseline so the jump from the previous
    // pointer position doesn't register as a huge flick.
    pointer.vx = 0;
    pointer.vy = 0;
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    lastMoveTime = performance.now();
    lastPointerActivity = performance.now();
    gesture = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: 0,
      castX: e.clientX,
      castY: e.clientY,
      castTime: performance.now(),
      downTime: performance.now(),
      charging: false
    };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!e.isPrimary) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    trackVelocity(e.clientX, e.clientY);
    lastPointerActivity = performance.now();
    if (gesture && e.pointerId === gesture.id && pointer.down) {
      var fromStart = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);
      if (fromStart > gesture.moved) gesture.moved = fromStart;
      var travelled = Math.hypot(e.clientX - gesture.castX, e.clientY - gesture.castY);
      var nowMs = performance.now();
      if (travelled >= STREAM_SPACING && nowMs - gesture.castTime >= STREAM_MIN_GAP) {
        castSeed(e.clientX, e.clientY, 0.35);
        gesture.castX = e.clientX;
        gesture.castY = e.clientY;
        gesture.castTime = nowMs;
      }
    }
  });

  function endGesture(e, allowCast) {
    if (!e.isPrimary) return;
    pointer.down = false;
    if (gesture && e.pointerId === gesture.id) {
      if (allowCast) {
        if (gesture.moved < TAP_MOVE_LIMIT) {
          // tap: bloom in place (velocity is ~0, reset at pointerdown)
          castSeed(e.clientX, e.clientY, 0.6);
        } else {
          var speed = Math.hypot(pointer.vx, pointer.vy);
          if (speed >= FLICK_SPEED) {
            // flick release: a final seed carrying the launch energy
            castSeed(e.clientX, e.clientY, clamp01(0.5 + (speed / 4000) * 0.5));
          }
        }
      }
      gesture = null;
    }
  }

  canvas.addEventListener('pointerup', function (e) { endGesture(e, true); });
  canvas.addEventListener('pointercancel', function (e) { endGesture(e, false); });

  // Belt-and-braces against touch scrolling / gestures on stubborn browsers.
  function preventTouch(e) { e.preventDefault(); }
  canvas.addEventListener('touchstart', preventTouch, { passive: false });
  canvas.addEventListener('touchmove', preventTouch, { passive: false });

  // ---- waking the audio ---------------------------------------------------
  // No browser will start audio before a gesture, so the very first one wakes
  // it — on the window and in the capture phase, so it counts whether the
  // gesture was a cast on the canvas, `begin` on the title screen, or a key.
  // The listeners stay put on purpose: after the first call this is a state
  // check, and it is also what brings the context back when the OS suspended
  // it while the tab was in the background.
  if (audio) {
    var wake = function () { audio.unlock(); };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
  }

  // ---- keyboard ---------------------------------------------------------------

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (soundOpen) {
        e.preventDefault();
        closeSound();
      } else if (menuOpen) {
        e.preventDefault();
        closeMenu();
      }
      return;
    }
    // Space and the arrows cast and switch, which is not what either open
    // panel is for — and Space would otherwise both press the focused button
    // and change the effect behind it. The title screen is deliberately NOT
    // in this test: its one button answers to Space by itself, and an effect
    // quietly changing behind the curtain harms nothing.
    if (soundOpen || menuOpen) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      switchEffect(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      switchEffect(-1);
    }
  });

  // ---- next button (mouse affordance) -----------------------------------------

  nextBtn.addEventListener('click', function () {
    switchEffect(1);
    nextBtn.blur();
  });

  // ---- effect menu (gear) -------------------------------------------------------
  // A grid of all effects, each with a real portrait rendered at boot by
  // running the effect briefly on a small offscreen canvas.

  var menuOpen = false;
  var menuCells = [];

  var THUMB_RENDER = 240; // effects scale element counts by area, so render
                          // generously and let CSS scale the image down

  function makeThumb(effect) {
    var tc = document.createElement('canvas');
    tc.width = THUMB_RENDER;
    tc.height = THUMB_RENDER;
    var tenv = {
      ctx: tc.getContext('2d'),
      width: THUMB_RENDER,
      height: THUMB_RENDER,
      t: 0,
      dt: 0,
      pointer: { x: THUMB_RENDER / 2, y: THUMB_RENDER / 2, vx: 0, vy: 0, active: false, down: false },
      charge: { active: false, x: 0, y: 0, level: 0 }
    };
    effect.init(tenv);
    if (typeof effect.cast === 'function') {
      effect.cast(tenv, {
        x: THUMB_RENDER / 2,
        y: THUMB_RENDER / 2,
        vx: 60,
        vy: -40,
        power: 0.8,
        charge: 0
      });
    }
    // settle into a characteristic pose: ~110 manually-stepped frames
    for (var i = 0; i < 110; i++) {
      tenv.t += 1 / 60;
      tenv.dt = 1 / 60;
      effect.frame(tenv);
    }
    return tc.toDataURL('image/png');
  }

  function makeCell(effect, index, thumb) {
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'menu-cell';
    var pic;
    if (thumb) {
      pic = document.createElement('img');
      pic.src = thumb;
      pic.alt = '';
      pic.draggable = false;
    } else {
      pic = document.createElement('div'); // portrait failed: plain dark square
    }
    pic.className = 'menu-thumb';
    cell.appendChild(pic);
    var name = document.createElement('span');
    name.textContent = effect.name || effect.id || 'effect ' + (index + 1);
    cell.appendChild(name);
    cell.addEventListener('click', function () {
      dismissHint();
      setEffect(index);
      // The same cue the > gives, because it is the same event: the picture
      // is about to change. setEffect itself stays silent — boot calls it too,
      // and swirls must not announce itself before anybody has asked it to.
      if (audio) audio.mode();
      closeMenu();
    });
    menuPanel.appendChild(cell);
    return cell;
  }

  function buildMenu() {
    var thumbs = [];
    var i;
    // Portraits FIRST, before the live effect's first init: effects are
    // stateful singletons, so init() during thumbnailing would otherwise
    // wipe the running scene. Boot re-inits the live effect at full size.
    for (i = 0; i < effects.length; i++) {
      try {
        thumbs[i] = makeThumb(effects[i]);
      } catch (err) {
        thumbs[i] = null; // one broken portrait must not kill boot
        if (window.console && console.error) {
          console.error('swirls thumbnail error (' + (effects[i] && effects[i].id) + '):', err);
        }
      }
    }
    for (i = 0; i < effects.length; i++) {
      menuCells.push(makeCell(effects[i], i, thumbs[i]));
    }
    addExitRow();
  }

  /**
   * A way out of swirls, under the effects and across the whole panel.
   *
   * Only built when the arcade's exit.js actually answered. It is another
   * repository's file and is allowed to be missing, and an exit that cannot
   * exit is worse than none — so a swirls served on its own with /arcade/
   * unreachable simply keeps the menu it has always had.
   *
   * Safe to read window.ArcadeExit here even though main.js is a classic
   * script at the end of the body and exit.js is deferred in the head: boot
   * waits two animation frames, and deferred scripts have all run well before
   * the first one.
   */
  function makeExitButton(className) {
    var exit = window.ArcadeExit;
    if (!exit) return null;

    var row = document.createElement('button');
    row.type = 'button';
    row.className = className;
    // Plain words, in swirls' lower case but not in its voice. A way out is
    // the one control someone reaches for having stopped wanting to watch,
    // and it should read as what it does rather than as another flourish.
    row.textContent = exit.verb({
      arcade: 'back to arcade',
      app: 'close',
      tab: 'close'
    });
    row.addEventListener('click', function () {
      exit.quit().then(function (how) {
        // Refused: the browser will not close a tab it did not open. Say so
        // here, quietly, rather than leaving a control that does nothing.
        if (how !== 'refused') return;
        row.textContent = 'close this tab yourself';
        row.disabled = true;
      });
    });
    return row;
  }

  function addExitRow() {
    var row = makeExitButton('menu-exit');
    if (row) menuPanel.appendChild(row);
  }

  /**
   * The same way out, on the title screen, where someone who opened swirls
   * from the arcade by mistake is most likely to want it. Built here rather
   * than written into index.html for the same reason the menu's is: it is
   * another repository's file that is allowed to be missing, and a door that
   * cannot open is worse than no door.
   */
  function addTitleExit() {
    var row = makeExitButton('title-exit');
    if (row) titleExitEl.appendChild(row);
  }

  function updateMenuHighlight() {
    for (var i = 0; i < menuCells.length; i++) {
      if (i === currentIndex) menuCells[i].classList.add('current');
      else menuCells[i].classList.remove('current');
    }
  }

  function openMenu() {
    menuOpen = true;
    updateMenuHighlight();
    menuEl.classList.add('open');
    menuEl.setAttribute('aria-hidden', 'false');
  }

  function closeMenu() {
    menuOpen = false;
    menuEl.classList.remove('open');
    menuEl.setAttribute('aria-hidden', 'true');
  }

  gearBtn.addEventListener('click', function () {
    if (menuOpen) closeMenu();
    else openMenu();
    gearBtn.blur();
  });

  // tap/click on the dimmed backdrop (outside the panel) closes the menu;
  // the overlay sits above the canvas, so none of this ever casts a seed
  menuEl.addEventListener('click', function (e) {
    if (e.target === menuEl) closeMenu();
  });

  // ---- sound panel --------------------------------------------------------------

  /**
   * Two levels, and now two things to apply them to.
   *
   * The day arrived: audio.js plays the theme against the music level and the
   * cast and mode cues against the effects one. Both still default to ZERO,
   * which is the whole of "off by default" — a player who never opens this
   * panel never hears swirls, and never downloads a byte of it either, because
   * nothing is fetched until a level comes up. Raising a slider is what turns
   * that side on, so there is no switch here to forget to look for.
   */
  var soundOpen = false;

  function volumeOf(key, fallback) {
    var raw = storeGet(key);
    if (raw === null) return fallback;
    var n = Number(raw);
    // localStorage is one namespace shared by every game on this origin and
    // anything at all may have written here. Trust the range, not the store.
    if (!isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  }

  function wireFader(inputId, outputId, key, apply) {
    var input = document.getElementById(inputId);
    var out = document.getElementById(outputId);
    // Zero is the default, here and in audio.js. The two files say it
    // separately on purpose: either one can be the one that fails to load, and
    // neither may assume the other arrived.
    input.value = String(Math.round(volumeOf(key, 0) * 100));
    out.textContent = input.value;
    // `input`, not `change`: the level follows the thumb, so you hear where
    // you are while you are still dragging.
    input.addEventListener('input', function () {
      out.textContent = input.value;
      var level = Number(input.value) / 100;
      // Written here as well as in audio.js — the same key and the same
      // value, so the panel still remembers a level on a device where the
      // audio never loaded.
      storeSet(key, String(level));
      if (audio) apply(level);
    });
  }

  wireFader('vol-music', 'vol-music-out', KEY_VOL_MUSIC, function (level) {
    audio.setMusicVolume(level);
  });
  wireFader('vol-sfx', 'vol-sfx-out', KEY_VOL_SFX, function (level) {
    audio.setSfxVolume(level);
  });

  function openSound() {
    soundOpen = true;
    soundEl.classList.add('open');
    soundEl.setAttribute('aria-hidden', 'false');
    // Focus lands inside the thing that just appeared rather than staying on
    // the body behind it; #sound-panel carries tabindex="-1" to receive it.
    soundPanel.focus();
  }

  function closeSound() {
    soundOpen = false;
    soundEl.classList.remove('open');
    soundEl.setAttribute('aria-hidden', 'true');
    soundOpenBtn.focus();
  }

  soundOpenBtn.addEventListener('click', function () {
    if (soundOpen) closeSound();
    else openSound();
  });

  soundBackBtn.addEventListener('click', closeSound);

  // Tap the dimmed backdrop to close, exactly as the effect menu does. The
  // overlay sits above the canvas, so none of this ever casts a seed.
  soundEl.addEventListener('click', function (e) {
    if (e.target === soundEl) closeSound();
  });

  // ---- title screen --------------------------------------------------------------

  /**
   * The moment the splash stops being a curtain and becomes a door.
   *
   * Called from boot(), once an effect is genuinely running on the canvas
   * underneath — so what you are deciding to enter is already moving behind
   * the wordmark. That is the whole argument for a title screen on a toy
   * that used to start instantly: it shows you what swirls is before it asks
   * whether you want in, and it gives the corner's two icons somewhere to be
   * reached from before anything has happened.
   */
  function armTitle() {
    if (!splashEl) return;
    addTitleExit();
    titleActionsEl.hidden = false;
    splashEl.classList.add('armed');
    // It was aria-hidden while it was pure decoration over an empty canvas.
    // It holds two real buttons now, and a screen reader has to be able to
    // find them.
    splashEl.setAttribute('aria-hidden', 'false');
  }

  beginBtn.addEventListener('click', function () {
    splashEl.classList.remove('armed');
    hideSplash();
    // The hint gets its one four-second showing HERE rather than at boot.
    // Shown at boot it would have burnt that showing behind the title screen
    // and marked itself seen, so the one line telling a first-time player how
    // to cast would never have been read by anybody.
    showHintOnce();
  });

  // ---- boot splash --------------------------------------------------------------
  // The splash is CSS-only and pointer-events:none for its whole life, so it
  // can never swallow a cast. This fades it out and drops it from the DOM.
  // Declared as a function so it hoists above the no-effects early return.

  function hideSplash() {
    var el = document.getElementById('splash');
    if (!el) return;
    el.classList.add('gone');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 600);
  }

  // ---- boot --------------------------------------------------------------------

  sizeCanvas();

  function boot() {
    buildMenu(); // must precede setEffect: portraits re-init every effect

    var initialIndex = 0;
    var savedId = storeGet(KEY_MODE);
    if (savedId) {
      for (var i = 0; i < effects.length; i++) {
        if (effects[i].id === savedId) {
          initialIndex = i;
          break;
        }
      }
    }

    setEffect(initialIndex);
    start();
    // Not hideSplash(): the splash arms into the title screen instead, and
    // the hint waits for `begin` so it is not spent behind it.
    armTitle();
  }

  // Two frames of headroom so the splash is actually on screen before
  // buildMenu's portrait pass blocks the main thread. The pointer handlers are
  // already bound and every one of them guards on `current`, so a tap landing
  // in this window is simply ignored rather than breaking anything.
  requestAnimationFrame(function () { requestAnimationFrame(boot); });

  // PWA: offline support + installability. Skipped on file:// where
  // service workers aren't available.
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' ||
       location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
  }
})();
