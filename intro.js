/*
 * intro.js — the opening, given a little more breath.
 *
 * swirls already had an opening: the CSS splash at the foot of index.html,
 * the mark spinning on the night-blue ground with "swirls" under it, painted
 * before a line of script runs and taken away by main.js the moment the ring
 * can be shown. This does not stack a second opening on top of it. It plays
 * ON the splash's own ground, at the splash's own spot, and ends where the
 * splash ends — so there is still one opening, now with a little motion in
 * it, and the splash stays exactly what it was for everyone this does not
 * run for (reduced motion, no script, a failure here).
 *
 * What it does: seven motes of light, one per arm of the mark and in the
 * mark's own hues, drift in from all round the screen on slow curling paths,
 * trailing soft light behind them. As they arrive they wind into the ring,
 * which blooms into being where the splash draws it and starts to turn; the
 * core breathes in, "swirls" comes up underneath in its usual whisper, and
 * then the ring floats down onto the small copy of itself at the centre of
 * the menu's ring of effects (#ring-mark) while the night thins away and the
 * live piece shows through. Quiet, slow, and lower case, like the rest of it.
 *
 * The one word is the game's own name, which hub §2 leaves untranslated, so
 * there is nothing for i18n.js.
 *
 * WHAT IT MAY NOT DO
 *   - Cost anyone a piece (hub §1). It only ever plays at page load, and any
 *     tap or key skips straight to the hand-off.
 *   - Let the skipping press through. Keys are swallowed by a CAPTURE-phase
 *     listener on window. main.js's Escape-and-casting handler listens on
 *     window in the BUBBLE phase and the ring's arrows on #menu-effects, so a
 *     window capture listener runs before both whoever registered first — the
 *     press that skips can neither leave for the arcade nor begin an effect.
 *     main.js's audio `wake` is also a window capture listener; this script
 *     is async at the very top of <body>, long before main.js at the foot of
 *     it, so it is first in line, and if it ever were not, all `wake` does is
 *     unlock a silent AudioContext.
 *     A tap lands on the curtain itself, which covers everything, the corner
 *     plates (z-index 80) included.
 *   - Delay the game. It is a curtain, not a gate: effects.js, audio.js and
 *     main.js load, boot and start the remembered piece underneath while it
 *     plays, and main.js removes the CSS splash on its own schedule, unaware
 *     that anything is over it.
 *   - Play for someone who has asked for less motion. prefers-reduced-motion
 *     means the script does nothing at all, and the still splash is theirs.
 *   - Make a sound. audio.js waits for the first real gesture.
 *
 * A classic script, self-contained, importing nothing, for the reason
 * screen.js and touch-guard.js stand apart: if anything else fails, the
 * curtain must still lift. Every frame runs inside a try, a hard timeout
 * removes the curtain whatever happens, and a failure of this file leaves
 * swirls exactly as it was without it.
 *
 * Canvas 2D, devicePixelRatio capped at 2, the gradients built once per
 * resize at the origin and placed by the transform, and no allocation in the
 * frame loop (hub §10).
 */
(function () {
  'use strict';

  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (e) {
    /* No matchMedia: play it. */
  }

  // The mark's seven hues, in index.html's .mark::before order. Copied rather
  // than read; if the mark's colours change, this line should follow.
  var HUES = ['#3FE0CC', '#5CB6FF', '#A87CFF', '#FF6FAE', '#FF8534', '#FFCC4D', '#5CDF7C'];
  var WORD = 'swirls';
  var FONT = '400 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // The timeline, in milliseconds. The motes drift in until ARRIVE; the ring
  // blooms from RING_IN over RING_MS; the word follows from WORD_IN. LAND
  // starts the hand-off, which takes LAND_MS (or SKIP_MS on a skip).
  var ARRIVE = 1700;
  var RING_IN = 1150;
  var RING_MS = 750;
  var WORD_IN = 1650;
  var LAND = 2600;
  var LAND_MS = 750;
  var SKIP_MS = 380;
  var SPIN_MS = 3800; // one turn, as the CSS splash-spin keyframes take

  var TRAIL = 26;  // points in each mote's trail
  var TURNS = 0.9; // how far each one curls on the way in

  var canvas = document.createElement('canvas');
  canvas.id = 'intro';
  canvas.setAttribute('aria-hidden', 'true');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var W = 0, H = 0, dpr = 1;
  var ground = null;   // the splash's radial night, rebuilt on resize
  var ringFill = null; // the arms, at the origin, unit radius
  var coreFill = null; // the breathing core, at the origin, unit radius
  var hasConic = typeof ctx.createConicGradient === 'function';

  // Where the splash puts the mark and the word: a centred column of the
  // mark (92px, or 60px on a sideways phone), its margin, and a 12px line.
  var stage = { x: 0, y: 0, r: 0, wordY: 0 };
  var reach = 0;   // how far out the motes start

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    var short = W > H && H <= 500;
    var m = short ? 60 : 92;
    var gap = short ? 16 : 30;
    var line = 15;
    var top = (H - (m + gap + line)) / 2;
    stage.x = W / 2;
    stage.y = top + m / 2;
    stage.r = m / 2;
    stage.wordY = top + m + gap + line / 2;
    reach = Math.hypot(W, H) * 0.55;

    // `circle at 50% 47%`, farthest-corner, as #splash's background.
    var gx = W / 2;
    var gy = H * 0.47;
    var gr = Math.hypot(Math.max(gx, W - gx), Math.max(gy, H - gy));
    ground = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    ground.addColorStop(0, '#151233');
    ground.addColorStop(0.38, '#0C0A22');
    ground.addColorStop(0.72, '#070615');
    ground.addColorStop(1, '#03030A');

    // CSS `conic-gradient(from 200deg, …)` counts from twelve o'clock and a
    // canvas conic from three, so the canvas starts 90 degrees earlier.
    if (hasConic) {
      ringFill = ctx.createConicGradient((110 * Math.PI) / 180, 0, 0);
      for (var i = 0; i <= HUES.length; i++) ringFill.addColorStop(i / HUES.length, HUES[i % HUES.length]);
    }
    coreFill = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    coreFill.addColorStop(0, '#ffffff');
    coreFill.addColorStop(0.42, '#FFEFCF');
    coreFill.addColorStop(0.72, 'rgba(255, 214, 140, 0)');
    coreFill.addColorStop(1, 'rgba(255, 214, 140, 0)');
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

  // Where mote m is at progress u (0 far out, 1 on the ring): its radius
  // eases in from `reach` to the ring's middle, its angle curls TURNS of a
  // turn onto the place its hue has on the ring. Written into pt, no
  // allocation.
  var pt = { x: 0, y: 0 };
  function moteAt(m, u, cx, cy, ringR, spin) {
    var home = (110 * Math.PI) / 180 + ((m + 0.5) / HUES.length) * Math.PI * 2 + spin;
    var e = easeOut(u);
    var rad = reach + (ringR - reach) * e;
    var ang = home - (1 - e) * TURNS * Math.PI * 2;
    pt.x = cx + Math.cos(ang) * rad;
    pt.y = cy + Math.sin(ang) * rad;
  }

  // The ring itself at (cx, cy), outer radius r: the arms as a thick band
  // from half the radius out, which is what the CSS mask leaves, turned by
  // `spin`, then the core breathing in the middle.
  function drawMark(cx, cy, r, spin, ringA, coreA, breath) {
    if (ringA > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, cx * dpr, cy * dpr);
      ctx.rotate(spin);
      ctx.globalAlpha = 0.9 * ringA;
      ctx.lineWidth = r * 0.44;
      if (ringFill) {
        ctx.strokeStyle = ringFill;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // No conic gradients on this browser: seven arcs, one per hue.
        var a0 = (110 * Math.PI) / 180;
        var step = (Math.PI * 2) / HUES.length;
        for (var i = 0; i < HUES.length; i++) {
          ctx.strokeStyle = HUES[i];
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.78, a0 + i * step, a0 + (i + 1) * step + 0.02);
          ctx.stroke();
        }
      }
    }
    if (coreA > 0) {
      var cr = r * 0.24 * breath;
      ctx.setTransform(dpr * cr, 0, 0, dpr * cr, cx * dpr, cy * dpr);
      ctx.globalAlpha = coreA;
      ctx.fillStyle = coreFill;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawMotes(t, cx, cy, ringR, spin, fade) {
    var p = clamp01(t / ARRIVE);
    if (p <= 0 || fade <= 0) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (var m = 0; m < HUES.length; m++) {
      // Each one sets off a little after the last, so they arrive as a
      // gathering rather than in formation.
      var u = clamp01((p - m * 0.035) / (1 - 6 * 0.035));
      if (u <= 0) continue;
      ctx.strokeStyle = HUES[m];
      ctx.fillStyle = HUES[m];
      // The trail: the path behind the mote, wide and faint, then narrow.
      for (var pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = (pass === 0 ? 0.12 : 0.5) * fade;
        ctx.lineWidth = pass === 0 ? 12 : 2.5;
        ctx.beginPath();
        for (var k = 0; k < TRAIL; k++) {
          var uk = u - 0.35 * (1 - k / (TRAIL - 1));
          if (uk < 0) uk = 0;
          moteAt(m, uk, cx, cy, ringR, spin);
          if (k === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }
      // The mote: a soft halo and a bright point, breathing as it drifts.
      moteAt(m, u, cx, cy, ringR, spin);
      var b = 0.8 + 0.2 * Math.sin(t * 0.006 + m * 1.7);
      ctx.globalAlpha = 0.25 * fade;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 11 * b, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9 * fade;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3 * b, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // "swirls", lower case, 0.3em apart, at the splash's 55% white.
  var glyphW = new Float32Array(WORD.length);
  var wordW = 0;
  function measure() {
    ctx.font = FONT;
    wordW = 0;
    for (var i = 0; i < WORD.length; i++) {
      glyphW[i] = ctx.measureText(WORD.charAt(i)).width;
      wordW += glyphW[i];
    }
    wordW += 3.6 * (WORD.length - 1);
  }
  function drawWord(y, alpha) {
    if (alpha <= 0) return;
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.55 * alpha;
    var x = W / 2 - wordW / 2;
    for (var i = 0; i < WORD.length; i++) {
      ctx.fillText(WORD.charAt(i), x, y);
      x += glyphW[i] + 3.6;
    }
    ctx.globalAlpha = 1;
  }

  /* Where the mark lives in the menu: #ring-mark, the small copy at the
   * centre of the ring of effects. Asked at hand-off, never earlier — the
   * menu is opened by main.js's boot, which may not have happened yet. If it
   * has not (or the panel is shut), the mark settles where the splash has it
   * and fades, which over a splash still up is no change at all. */
  var target = null;
  var realMark = null;
  function findTarget() {
    var menu = document.getElementById('menu');
    var el = document.getElementById('ring-mark');
    if (!menu || !el || !menu.classList.contains('open')) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    realMark = el;
    // The real one steps aside so the flying one lands on an empty spot; it
    // is given back the moment the curtain goes.
    el.style.visibility = 'hidden';
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }

  var t0 = 0;
  var landAt = LAND;
  var landMs = LAND_MS;
  var done = false;
  var raf = 0;

  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', size);
    if (realMark) realMark.style.visibility = '';
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  function skip() {
    var now = performance.now() - t0;
    if (now >= landAt) return;
    landAt = now;
    landMs = SKIP_MS;
  }

  function onKey(e) {
    // Skip, and let the press go no further: see the header.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) skip();
  }

  function frame(now) {
    if (done) return;
    try {
      if (!t0) t0 = now;
      var t = now - t0;
      var land = clamp01((t - landAt) / landMs);
      if (land >= 1) { finish(); return; }
      var k = easeInOut(land);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // The night itself, which thins away during the hand-off.
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      var spin = ((t % SPIN_MS) / SPIN_MS) * Math.PI * 2;
      var cx = stage.x;
      var cy = stage.y;
      var r = stage.r;

      // The motes give way to the ring as they reach it, and are gone
      // before it moves.
      var moteFade = 1 - clamp01((t - ARRIVE + 250) / 450);
      if (land > 0) moteFade *= 1 - clamp01(land * 3);
      drawMotes(t, cx, cy, r * 0.78, spin, moteFade);

      var ri = clamp01((t - RING_IN) / RING_MS);
      if (land > 0) ri = 1; // a skip before the bloom lands it whole
      if (ri > 0) {
        var ringA = easeOut(ri);
        var grow = 0.7 + 0.3 * easeOut(ri);
        // The core breathes as the CSS one does, 2.6s a breath, starting
        // from a deep in-breath as the ring closes.
        var breath = 0.85 + 0.27 * (0.5 + 0.5 * Math.sin(((t - RING_IN) / 2600) * Math.PI * 2 + Math.PI / 2));
        var mr = r * grow;
        var mx = cx;
        var my = cy;
        var alpha = 1;
        if (land > 0) {
          if (target === null) target = findTarget() || false;
          if (target) {
            mx += (target.x - mx) * k;
            my += (target.y - my) * k;
            mr += (target.r - mr) * k;
          } else {
            alpha = 1 - k; // nothing to land on: settle and fade
          }
        }
        drawMark(mx, my, mr, spin, ringA * alpha, ringA * alpha, breath);
      }

      var wi = clamp01((t - WORD_IN) / 600);
      if (land > 0) wi *= 1 - clamp01(land * 2);
      drawWord(stage.wordY, wi);
    } catch (err) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    size();
    measure();
    window.addEventListener('resize', size);
    window.addEventListener('keydown', onKey, true);
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      skip();
    });
    document.body.appendChild(canvas);
    raf = requestAnimationFrame(frame);
    // Whatever happens to the frame loop, the curtain does not outstay this.
    setTimeout(finish, 6000);
  }

  // Loaded from the top of <body>, so the body exists even though the rest
  // of the page has not been parsed yet.
  try {
    start();
  } catch (e) {
    finish();
  }
})();
