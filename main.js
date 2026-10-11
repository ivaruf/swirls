(function () {
  'use strict';

  var canvas = document.getElementById('c');
  var labelEl = document.getElementById('label');
  var hintEl = document.getElementById('hint');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var menuEl = document.getElementById('menu');
  var menuPanel = document.getElementById('menu-panel');
  var menuEffects = document.getElementById('menu-effects');
  var ringNameEl = document.getElementById('ring-name');
  var errorEl = document.getElementById('error');
  // The splash is looked up inside hideSplash() rather than held here: it is
  // the one element that gets removed from the document, and a stale
  // reference to a node nobody can see is a bug waiting to be written.
  var menuOpenBtn = document.getElementById('menu-open');
  var muteBtn = document.getElementById('mute-toggle');

  /* Every word this file says goes through i18n.js (window.I18N), a classic
   * script loaded in <head> before this one. Guarded like audio.js is: a
   * swirls that lost it shows the key rather than stopping, and the twelve
   * names fall back to the English written on each effect. */
  var I18N = window.I18N || null;
  function t(key) {
    return I18N ? I18N.t.apply(null, arguments) : key;
  }

  var effects = window.SwirlsEffects;
  if (!effects || !effects.length) {
    errorEl.classList.add('show');
    hideSplash();
    // Nothing below this line runs, so the one panel is never wired — no
    // thumbnails, no faders, no exit. Take its plate away rather than leave a
    // button that answers to nothing on a screen already admitting something
    // went wrong, and take the mute plate with it: the only way to raise a
    // level was inside that panel, so there is nothing here left to silence.
    // The fullscreen icon is unaffected: screen.js is its own file and does
    // not care whether this one got anywhere.
    menuOpenBtn.hidden = true;
    muteBtn.hidden = true;
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
    // Each family has its own cue, so the sound follows the picture. Told
    // here rather than at cast time because this is the only place the
    // current effect changes, and because it lets the cue be fetched before
    // the first cast rather than during it.
    if (audio) audio.setFamily(current.id);
    env.t = 0;
    if (typeof current.init === 'function') {
      current.init(env);
    }
    showLabel(effectName(currentIndex));
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
    // One cue per seed, in the voice of whatever family is on screen (see
    // setEffect), at the seed's own weight, and pitched by how long the
    // gesture was held. The charge is read live rather than taken from
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

  /**
   * A letter typed into a field is a letter, not a command.
   *
   * swirls has no text field today, which is exactly why this is written
   * down rather than assumed: the day one arrives — a name, a seed, a room
   * code — m would otherwise silence the game every time somebody typed a
   * word with an m in it. Ranges, checkboxes and buttons are controls you
   * press rather than fields you write in, so they still hear the shortcut,
   * which matters because the mute plate itself keeps focus after a click.
   */
  function isTyping(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === 'TEXTAREA') return true;
    if (target.tagName !== 'INPUT') return false;
    return ['range', 'checkbox', 'radio', 'button', 'submit'].indexOf(target.type) < 0;
  }

  /* ESCAPE, ONE STEP BACK (hub CLAUDE.md §2, "Escape goes one step back, and
   * from the start screen that step is the arcade"), in swirls' three moments:
   *
   *   the ring as TITLE SCREEN   -> the "Back to arcade" button, exactly as if
   *     (open, nothing picked)      it were pressed, and only when it is
   *                                 shown. The panel cannot be dismissed here
   *                                 (see closeMenu), so the one step back
   *                                 from it is out of the game.
   *   the ring as MENU           -> closed; the piece carries on
   *     (open, after a pick)
   *   CASTING (panel down)       -> opens the menu. That is swirls' "in
   *                                 play": a piece is running and the player
   *                                 is casting into it. Nothing pauses,
   *                                 because nothing here can be lost — the
   *                                 piece keeps moving behind the frosted
   *                                 panel, as it always has, and that is the
   *                                 panel's whole look.
   *
   * Before the title screen arms (the splash's first frames) Escape does
   * nothing: there is no panel and no door yet. There are no sub-panels —
   * the sound and language rows live in the one panel.
   *
   * ONE PRESS, ONE ACTION: answered here and only here, preventDefault()ed,
   * and returned from before the casting keys below can see it. Auto-repeat
   * is ignored, so a held key cannot open and close the panel at the repeat
   * rate — or close it and then leave. */
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      var act = null;
      if (menuOpen && begun) act = closeMenu;
      else if (menuOpen) act = quitExit;
      else if (begun) act = openMenu;
      if (!act) return;
      e.preventDefault();
      if (!e.repeat) act();
      return;
    }
    // Mute is answered FIRST and from anywhere — panel up, panel down, a cast
    // still in flight. It is the keyboard's half of the corner's mute plate
    // and it must mean the same thing the plate does: silence, and nothing
    // else moved.
    if (e.key === 'm' || e.key === 'M') {
      if (isTyping(e.target)) return;
      e.preventDefault();
      toggleMute();
      return;
    }
    // Space and the arrows cast and switch, which is not what the open panel
    // is for — and Space would otherwise both press the focused button and
    // change the effect behind it. The title screen is deliberately NOT in
    // this test: its one button answers to Space by itself, and an effect
    // quietly changing behind the curtain harms nothing.
    if (menuOpen) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      switchEffect(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      switchEffect(-1);
    }
  });

  // ---- the two arrows (pointer affordance) ------------------------------------
  // Both go through switchEffect, which is the same function ArrowLeft and
  // ArrowRight call — so a press dismisses the first-run hint and sounds the
  // mode cue exactly as a keystroke does, and there is no second path that
  // could quietly come to mean something else.

  prevBtn.addEventListener('click', function () {
    switchEffect(-1);
    prevBtn.blur();
  });

  nextBtn.addEventListener('click', function () {
    switchEffect(1);
    nextBtn.blur();
  });

  // ---- the menu -----------------------------------------------------------------
  // Opened by the three bars in the corner, and it holds three things now: a
  // grid of all effects, each with a real portrait rendered at boot by running
  // the effect briefly on a small offscreen canvas; the two levels, which used
  // to be an overlay of their own behind a speaker; and the way out of swirls.

  var menuOpen = false;
  var menuCells = [];
  /* Has anybody picked yet? False for exactly as long as the ring is the
   * title screen. It is what makes one panel serve two moments: while it is
   * false the panel cannot be dismissed and a press begins the game, and once
   * it is true the panel is an ordinary menu and a press changes the effect. */
  var begun = false;

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

  /* An effect's name in the current language. The table in i18n.js is keyed
   * by the effect's id, which never changes; the English `name` written on
   * the effect itself is only the fallback for a swirls without i18n.js. */
  function effectName(index) {
    var e = effects[index];
    if (e && e.id && I18N) {
      var key = 'fx.' + e.id;
      var said = t(key);
      if (said !== key) return said;
    }
    return (e && (e.name || e.id)) || t('effectN', index + 1);
  }

  /**
   * PRESSING ONE OF THE TWELVE. It is the only interaction the ring has, and
   * it does two different things depending on when it happens — which is the
   * whole of what replaced the `begin` button.
   *
   * THE FIRST ONE BEGINS. The ring is the title screen, so the opening press
   * is a player saying "this one, and start". Three things follow from that
   * being a beginning rather than a change:
   *
   *   - no mode cue. That cue answers "the picture is about to change", and
   *     this is the picture arriving. It would also be the very first sound
   *     swirls ever made, over a theme that has not started, which is not how
   *     this game introduces itself.
   *   - the hint gets its one four-second showing HERE. It used to fire from
   *     the `begin` handler and the reason is unchanged and still the trap:
   *     shown at boot it would spend that single showing behind a screen
   *     nobody can cast on and mark itself seen forever, so the one line
   *     telling a first-time player how to cast would never be read.
   *   - it must NOT dismiss the hint. Choosing where to start is not evidence
   *     that anybody knows how to cast yet.
   *
   * EVERY ONE AFTER IT SWITCHES, which is what this always did: dismiss the
   * hint, because using the ring is evidence enough, and sound the cue.
   *
   * Either way the effect is re-initialised. Beginning on the one already
   * running is a clean start rather than a no-op, and that is the right
   * reading of a press that says "start here".
   */
  function pick(index) {
    var first = !begun;
    begun = true;
    setEffect(index);
    if (first) {
      // The plate has stood lit over the title screen until now, answering
      // only by handing focus to the panel (see its click handler). It is a
      // real toggle from here on.
      closeMenu();
      showHintOnce();
      return;
    }
    dismissHint();
    // setEffect itself stays silent — boot calls it too, and swirls must not
    // announce itself before anybody has asked it to.
    if (audio) audio.mode();
    closeMenu();
  }

  /* The word in the middle of the ring.
   *
   * Twelve names will not fit around a rim and trying is how a radial menu
   * becomes unreadable, so the ring carries the pictures and the centre
   * carries the word. It follows the POINTER and the FOCUS, not only the
   * selection, which is what lets somebody walk round the ring and read where
   * they are before committing to it — the whole reason the arrow keys do not
   * select as they move. restoreRingName() puts the current effect back when
   * nothing is being pointed at or focused. */
  function showRingName(text) {
    if (ringNameEl) ringNameEl.textContent = text;
  }

  function restoreRingName() {
    showRingName(effectName(currentIndex));
  }

  function makeCell(effect, index, thumb) {
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'menu-cell';
    // The name is no longer drawn under each disc, so it has to be said here
    // or the button has no accessible name at all — an <img alt=""> is not
    // one. The centre of the ring is its visible half.
    cell.setAttribute('role', 'radio');
    cell.setAttribute('aria-checked', 'false');
    cell.setAttribute('aria-label', effectName(index));
    // Roving tabindex: exactly one cell is in the tab order and it is the
    // current one. updateMenuHighlight resyncs this every time the panel
    // opens, so a walk round the ring that ended somewhere else does not
    // leave the tab stop stranded.
    cell.tabIndex = -1;
    // Where on the rim. Thirty degrees for twelve, and derived rather than
    // written down so a thirteenth effect lands somewhere sensible instead of
    // on top of the first. The RADIUS is tuned for twelve, though — see the
    // ring's own comment in index.html before adding one.
    cell.style.setProperty('--a', (index * (360 / effects.length)) + 'deg');
    var pic;
    if (thumb) {
      pic = document.createElement('img');
      pic.src = thumb;
      pic.alt = '';
      pic.draggable = false;
    } else {
      pic = document.createElement('div'); // portrait failed: plain dark disc
    }
    pic.className = 'menu-thumb';
    cell.appendChild(pic);
    cell.addEventListener('click', function () { pick(index); });
    // Pointer events rather than mouseenter/mouseleave, which is the hub's
    // base input primitive and means a tablet gets the name too — briefly,
    // between the touch landing and the panel closing.
    // Asked for at the moment of pointing, not captured at build time, so a
    // language switch reaches the centre of the ring as well as the label.
    cell.addEventListener('pointerenter', function () { showRingName(effectName(index)); });
    cell.addEventListener('pointerleave', restoreRingName);
    cell.addEventListener('focus', function () { showRingName(effectName(index)); });
    cell.addEventListener('blur', restoreRingName);
    // Into the ring rather than straight into the panel, and AFTER the centre
    // piece that index.html already put there — so document order is
    // noon-then-clockwise and Tab walks the ring the way it is read.
    menuEffects.appendChild(cell);
    return cell;
  }

  /* Arrow keys walk the rim, and deliberately do NOT select as they go.
   *
   * A radiogroup is usually allowed to select on arrow, but selecting here
   * restarts the effect underneath — so moving across the ring with the keys
   * would tear down and rebuild eleven scenes on the way past. Focus moves,
   * the centre reads out where you are, and Space or Enter on the button is
   * what commits. Home and End are noon and eleven o'clock. */
  function focusCell(index) {
    var n = menuCells.length;
    if (!n) return;
    var i = ((index % n) + n) % n;
    for (var k = 0; k < n; k++) menuCells[k].tabIndex = (k === i) ? 0 : -1;
    menuCells[i].focus();
  }

  menuEffects.addEventListener('keydown', function (e) {
    var dir = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') dir = -1;
    else if (e.key === 'Home') { e.preventDefault(); focusCell(0); return; }
    else if (e.key === 'End') { e.preventDefault(); focusCell(menuCells.length - 1); return; }
    else return;
    e.preventDefault();
    var from = menuCells.indexOf(document.activeElement);
    if (from < 0) from = currentIndex; // arrived by some other route
    focusCell(from + dir);
  });

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
   * A way out of swirls, at the foot of the panel under the two levels.
   *
   * Only built when the arcade's exit.js actually answered AND has somewhere
   * to send us. It is another repository's file and is allowed to be missing,
   * and an exit that cannot exit is worse than none — so a swirls served on
   * its own with /arcade/ unreachable simply keeps the menu it has always
   * had.
   *
   * Safe to read window.ArcadeExit here even though main.js is a classic
   * script at the end of the body and exit.js is deferred in the head: boot
   * waits two animation frames, and deferred scripts have all run well before
   * the first one.
   */
  function makeExitButton(className) {
    var exit = window.ArcadeExit;
    // ONLY WHERE THERE IS SOMEWHERE TO GO: a launcher behind us, or an
    // installed window that can genuinely close. Not the same question as
    // whether quit() could do something — in a plain tab it could, because
    // the arcade is a URL and a navigation always works, but somebody who
    // typed this game's own address did not come from the arcade.
    //
    // ASKED THROUGH framed()/standalone() AND NOT THROUGH exit.js's own
    // offers(), which says exactly this but is newer than both of them. The
    // copy answering may be OLDER than this code — it is fetched from
    // ../arcade/, and a service worker on this shared origin can hand back a
    // version cached long before offers() was written — and a guard built on
    // the new name fails CLOSED there: the way out silently disappears,
    // inside the arcade, where it is the one control that matters. That cost
    // maxgear a release.
    //
    // In a try, because this runs inside boot() — between the portrait pass
    // and the first setEffect — and another repository's file throwing here
    // would cost the whole game rather than one button.
    if (!exit) return null;
    try {
      if (!(exit.framed() || exit.standalone())) return null;
    } catch (err) {
      return null;
    }

    var row = document.createElement('button');
    row.type = 'button';
    row.className = className;
    // THE HUB'S ONE BUTTON, and the one thing in swirls that is not in
    // swirls' voice: the shared back arrow before the words, and the words in
    // sentence case — "Back to arcade", not "back to arcade". Everything else
    // here whispers in lower case and still does; this control is the same
    // object in every cabinet (CLAUDE.md §2, "One button, and it looks and
    // behaves the same in every game"), so a player who learned it next door
    // finds it here without reading. The glyph is the hub's path, to the
    // letter; its stroke and colour are ours, in the stylesheet.
    row.innerHTML =
      '<svg class="menu-exit-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M19 12H5m6-6-6 6 6 6"/></svg><span class="menu-exit-label"></span>';
    var label = row.lastChild;
    // verb() takes its words from us, so it is asked again in the current
    // language every time the language changes — see paintExit.
    var refused = false;
    function paint() {
      if (refused) {
        label.textContent = t('exit.refused');
        return;
      }
      try {
        label.textContent = exit.verb({
          arcade: t('exit.arcade'),
          app: t('exit.close'),
          tab: t('exit.close')
        });
      } catch (err) { /* keep whatever it last said */ }
    }
    function quit() {
      if (row.disabled) return;
      exit.quit().then(function (how) {
        // Refused: the browser will not close a tab it did not open. Say so
        // here, quietly, rather than leaving a control that does nothing.
        if (how !== 'refused') return;
        refused = true;
        row.disabled = true;
        paint();
      });
    }
    paint();
    paintExit = paint;
    quitExit = quit;
    row.addEventListener('click', quit);
    return row;
  }

  // Repaints the exit in the current language; a no-op until one is built.
  var paintExit = function () {};
  // Presses the exit — the button's own handler, so Escape on the title
  // screen and a tap cannot do different things. Null until one is built,
  // which is also how the Escape handler knows whether there is a door.
  var quitExit = null;

  function addExitRow() {
    var row = makeExitButton('menu-exit');
    if (row) menuPanel.appendChild(row);
  }

  /* There was a second exit, built into the title screen, because the panel's
   * one was two taps away behind a gear and somebody who opened swirls from
   * the arcade by mistake should not have to go looking. The panel IS the
   * title screen now, so its own exit is already the first thing on screen
   * and a second copy would be the same door drawn twice. */

  /* Which disc is lit, which one a screen reader calls checked, which one the
   * tab stop is on, and what the middle of the ring says. All four are the
   * same fact, so they are written in one place — the pictures, the label and
   * the keyboard cannot drift apart. */
  function updateMenuHighlight() {
    for (var i = 0; i < menuCells.length; i++) {
      var on = (i === currentIndex);
      if (on) menuCells[i].classList.add('current');
      else menuCells[i].classList.remove('current');
      menuCells[i].setAttribute('aria-checked', String(on));
      menuCells[i].tabIndex = on ? 0 : -1;
    }
    restoreRingName();
  }

  function openMenu() {
    menuOpen = true;
    updateMenuHighlight();
    menuEl.classList.add('open');
    menuEl.setAttribute('aria-hidden', 'false');
    menuOpenBtn.setAttribute('aria-expanded', 'true');
    // Focus lands inside the thing that just appeared rather than staying on
    // the body behind it; #menu-panel carries tabindex="-1" to receive it.
    menuPanel.focus();
  }

  /* THE ONE STATE THIS PANEL REFUSES TO LEAVE. Before the first pick the ring
   * is the title screen, and every way out of a panel — Escape, the backdrop,
   * the plate — would land the player on a canvas they have not started, with
   * the door they just closed no longer drawn anywhere. So there is no way
   * out of it except forward, through any one of the twelve. pick() sets
   * `begun` before it calls this, which is why the opening press gets through
   * and nothing else does. */
  function closeMenu() {
    if (!begun) return;
    menuOpen = false;
    menuEl.classList.remove('open');
    menuEl.setAttribute('aria-hidden', 'true');
    menuOpenBtn.setAttribute('aria-expanded', 'false');
    menuOpenBtn.focus();
  }

  // The plate sits above the open panel on purpose (see #corner-tools'
  // z-index), so a second press is one of the three ways back out — the
  // dimmed backdrop and Escape are the others. Deliberately no blur(): the
  // plate is where focus belongs on the way out, and closeMenu puts it back
  // there itself.
  menuOpenBtn.addEventListener('click', function () {
    // Before the first pick the panel is the title screen and closeMenu
    // refuses to leave it, so the press brings the keyboard back into the
    // panel instead of looking like it failed.
    if (menuOpen && !begun) menuPanel.focus();
    else if (menuOpen) closeMenu();
    else openMenu();
  });

  // tap/click on the dimmed backdrop (outside the panel) closes the menu;
  // the overlay sits above the canvas, so none of this ever casts a seed
  menuEl.addEventListener('click', function (e) {
    if (e.target === menuEl) closeMenu();
  });

  // ---- sound: two levels in the panel, and a mute of its own --------------------

  /**
   * Two levels, and now two things to apply them to.
   *
   * The day arrived: audio.js plays the theme against the music level and the
   * cast and mode cues against the effects one. Both still default to ZERO,
   * which is the whole of "off by default" — a player who never opens the
   * menu never hears swirls, and never downloads a byte of it either, because
   * nothing is fetched until a level comes up. Raising a slider is what turns
   * that side on, so there is no switch in the panel to forget to look for.
   *
   * MUTE IS A DIFFERENT QUESTION AND HAS ITS OWN PLATE. The levels are a mix,
   * set once; mute is what you reach for when somebody walks into the room,
   * and it must be one press with no panel in the way. audio.js has had the
   * whole mechanism since the master gain went in — setMuted, muted, and
   * swirls.muted.v1 behind them — and this file simply never called it. This
   * is that wiring, and it is all of it: a plate, a keystroke, and the rule
   * that dragging a fader lifts the mute.
   */
  function paintMute(isMuted) {
    var label = isMuted ? t('mute.off') : t('mute.on');
    muteBtn.setAttribute('aria-pressed', String(isMuted));
    muteBtn.setAttribute('aria-label', label);
    muteBtn.title = t('mute.key', label);
  }

  function toggleMute() {
    if (!audio) return;
    audio.setMuted(!audio.muted);
    paintMute(audio.muted);
  }

  /**
   * Dragging either fader lifts the mute.
   *
   * A level silently cancelled by a control somewhere else is a level nobody
   * can use: you drag it, nothing happens, and a plate in the opposite corner
   * is the last place anyone thinks to look. Only a real drag comes through
   * here — the boot restore in wireFader sets input.value directly and fires
   * no `input` event, and putting a choice back is not itself a choice.
   */
  function liftMute() {
    if (!audio || !audio.muted) return;
    audio.setMuted(false);
    paintMute(false);
  }

  if (audio) {
    // A silent restore, before anything is drawn: whatever the plate was left
    // on last session is what it opens on.
    paintMute(audio.muted);
    // NO blur() and no panel. One press, and the only thing in the game that
    // changes is whether you can hear it — focus stays on the plate, which is
    // also what keeps `m` working straight after a click.
    muteBtn.addEventListener('click', toggleMute);
  } else {
    // audio.js is allowed to be missing (blocked, 404, no Web Audio at all).
    // There is then nothing to silence, and a plate that answers to nothing is
    // worse than one icon fewer in the corner.
    muteBtn.hidden = true;
  }

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
    liftMute();
  });
  wireFader('vol-sfx', 'vol-sfx-out', KEY_VOL_SFX, function (level) {
    audio.setSfxVolume(level);
    liftMute();
  });

  // ---- a language switch ----------------------------------------------------------
  /**
   * i18n.js has already repainted every [data-i18n] in the markup by the time
   * this hears `arcade:lang`; what is left is what this file wrote itself.
   * The twelve names (each disc's accessible name, the centre of the ring,
   * the label that flashes on a switch), the mute plate and the exit.
   *
   * NOTHING ELSE MOVES. The panel stays open if it was, the piece behind it
   * keeps running, focus stays on the button that was pressed — and the
   * title screen stays the title screen, because `begun` is not touched.
   */
  document.addEventListener('arcade:lang', function () {
    for (var i = 0; i < menuCells.length; i++) {
      menuCells[i].setAttribute('aria-label', effectName(i));
    }
    // The centre follows whatever has focus, so a switch made from the
    // language row (which has focus) puts the current effect back there.
    var focused = menuCells.indexOf(document.activeElement);
    showRingName(effectName(focused >= 0 ? focused : currentIndex));
    if (current) labelEl.textContent = effectName(currentIndex);
    if (audio) paintMute(audio.muted);
    paintExit();
  });

  // ---- the title screen, which is the ring ---------------------------------------

  /**
   * The curtain comes down and the ring comes up. This is the title screen.
   *
   * Called from boot() once an effect is genuinely running on the canvas
   * underneath, which is the same argument the old title screen made and the
   * reason the panel is frosted rather than opaque: what you are choosing
   * between is already moving behind it. swirls shows you what it is before
   * asking which one you want.
   *
   * There used to be a `begin` pill here and a second exit under it. Both are
   * gone. The press that begins is the press that chooses, which is the
   * decision anybody was going to make one tap later anyway — and a returning
   * player needs no extra affordance for "the one I had last time", because
   * setEffect has already lit it in the ring. That marking IS the resume
   * button, which is why .menu-cell.current is drawn as loudly as it is.
   */
  function openTitle() {
    hideSplash();
    // THE PLATE STAYS, lit. It used to be hidden here, on the reasoning that
    // a toggle for a panel that cannot be closed yet does nothing. The hub's
    // corner rule (2026-10-11) outranks that: menu, mute, fullscreen on every
    // screen, the same three in every cabinet, so the corner a player learns
    // here is the corner in all the others. And it is not a lie — the panel
    // behind it IS the menu and it IS open, which aria-expanded says and the
    // lit plate shows. Pressing it before the first pick hands focus to the
    // panel (see the click handler) rather than closing onto a canvas that
    // has nothing on it and no door drawn anywhere.
    openMenu();
    // Focus goes to the ring rather than to the panel, which is the one place
    // the two moments differ. Mid-watch the panel is a menu and you may have
    // come for the faders, so focus lands on the dialog and Tab decides.
    // Here the ring is the screen and the only way forward is through it, so
    // a keyboard arrives already on the remembered effect: arrows walk the
    // rim from there and Enter begins.
    if (menuCells[currentIndex]) menuCells[currentIndex].focus();
  }

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

    // The remembered effect, running before anybody has chosen — so the ring
    // opens over a live piece rather than over black, and the disc it lights
    // is the one already playing behind it.
    setEffect(initialIndex);
    start();
    openTitle();
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
