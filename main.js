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

  var effects = window.SwirlsEffects;
  if (!effects || !effects.length) {
    errorEl.classList.add('show');
    return;
  }

  var ctx = canvas.getContext('2d');

  // ---- localStorage (guarded: file:// on some browsers throws) ----------

  var KEY_MODE = 'swirls:mode';
  var KEY_HINT = 'swirls:hint-dismissed';

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

  // ---- keyboard ---------------------------------------------------------------

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (menuOpen) {
        e.preventDefault();
        closeMenu();
      }
      return;
    }
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

  // ---- boot --------------------------------------------------------------------

  sizeCanvas();

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
  showHintOnce();
  start();

  // PWA: offline support + installability. Skipped on file:// where
  // service workers aren't available.
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' ||
       location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
  }
})();
