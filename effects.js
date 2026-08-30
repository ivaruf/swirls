/* swirls/effects.js — seven meditative canvas modes, contract v2.
   The user CASTS living entities into the scene: cast(env, seed) births an
   autonomous creature at the touch point that flies along the seed velocity,
   decelerates, meanders, animates on its own and fades away.
   Plain script (no modules). Defines window.SwirlsEffects, an array of
   { id, name, init(env), frame(env), cast(env, seed) } objects. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var CAP = 40; // living entities per effect

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function countFor(w, h, per, min, max) {
    return clamp(Math.round((w * h) / per), min, max);
  }

  // cheap smooth pseudo-noise
  function field(x, y, t) {
    return Math.sin(x * 0.0016 + t * 0.11) * 1.7 +
           Math.cos(y * 0.0021 - t * 0.07) * 1.5 +
           Math.sin((x + y) * 0.0008 + t * 0.05) * 0.9;
  }

  // quick fade-in (~0.3s), gentle fade-out over the last ~28% of life
  function lifeAlpha(age, life) {
    if (age <= 0 || age >= life) return 0;
    return Math.min(1, age / 0.3, (life - age) / (life * 0.28));
  }

  function seedPower(seed) { return clamp(num(seed.power, 0.5), 0, 1); }
  function seedCharge(seed) { return clamp(num(seed.charge, 0), 0, 1); }

  // normalized charge info, or null (older shells send no charge)
  function chargeInfo(env) {
    var c = env.charge;
    if (!c || !c.active) return null;
    return {
      x: num(c.x, env.width / 2),
      y: num(c.y, env.height / 2),
      lv: clamp(num(c.level, 0), 0, 1)
    };
  }

  /* minimal charge: while the user holds, a provisional entity — the same
     object cast() builds — sits pinned under the finger, growing from ~20%
     of its charged size to about twice a full-power cast, brightening, and
     pulsing softly at full charge. On release it is handed off EXACTLY as
     it is: same size, same form, same animation phase — only a velocity
     and a lifetime are added. */

  // drawn scale: growth factor plus the soft pulse charged entities keep
  function entScale(e, t) {
    return e.gs * (1 + 0.05 * e.cz * Math.sin(t * 2));
  }
  // held entities brighten as they grow; released ones keep a mild glow
  function entGlow(e) {
    return e.held ? 0.35 + 0.65 * e.cz : 1 + 0.3 * e.cz;
  }
  // pin the held entity to the finger and grow it with the charge level
  function holdEnt(e, chg) {
    e.kin.x = chg.x;
    e.kin.y = chg.y;
    e.cz = chg.lv;
    e.gs = 0.4 + 1.6 * chg.lv;
    e.life = e.age + 9; // never dies in the hand
  }
  // release as-is: only direction, speed and a fresh lifetime are added
  function releaseHeld(e, seed, mul, minSp, maxSp, life) {
    e.held = false;
    var vx = num(seed.vx, 0), vy = num(seed.vy, 0);
    var sp = Math.hypot(vx, vy);
    if (sp > 1) e.kin.h = Math.atan2(vy, vx);
    e.kin.sp = clamp(sp * mul, minSp, maxSp);
    e.life = e.age + life + e.cz * 2.5;
  }
  // hold abandoned without a cast: let the ghost fade quickly
  function dropHeld(e) {
    e.held = false;
    e.life = Math.min(e.life, e.age + 0.6);
  }

  /* scenery: each species paints its backdrop ONCE at init into an
     offscreen canvas (re-painted on resize, since init re-runs). Fully
     clearing effects just draw it; trail-fading effects draw it at low
     globalAlpha so motion fades toward the scenery instead of flat color.
     Backgrounds are scenery, never subject: silhouettes a shade or two
     from the base, soft gradients, large simple forms. */
  function makeBackdrop(env, paint) {
    if (typeof document === 'undefined') return null;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(env.width));
    c.height = Math.max(1, Math.round(env.height));
    var g = c.getContext('2d');
    if (!g) return null;
    paint(g, c.width, c.height);
    return c;
  }
  // draw the backdrop as this frame's base: opaque on the first frame,
  // then at the effect's trail-fade rate (fade >= 1 clears fully)
  function drawBackdrop(ctx, bg, w, h, fade, base) {
    if (bg) {
      ctx.globalAlpha = fade >= 1 ? 1 : fade;
      ctx.drawImage(bg, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = fade >= 1 ? base : 'rgba(' + base.slice(4, -1) + ',' + fade + ')';
      ctx.fillRect(0, 0, w, h);
    }
  }
  // a soft horizon silhouette: a low-order sine ridge filled to the bottom
  function ridge(g, W, H, base, a1, k1, a2, k2, ph, col) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H + 2);
    for (var x = 0; x <= W + 1; x += Math.max(2, W / 32)) {
      g.lineTo(x, H * base + Math.sin(x / W * k1 + ph) * H * a1 +
                   Math.sin(x / W * k2 + ph * 2.7) * H * a2);
    }
    g.lineTo(W, H + 2);
    g.closePath();
    g.fill();
  }

  // shared kinematics: born at the seed point, launched along the seed
  // velocity (mapped down to graceful in-world speed), decelerates toward a
  // slow cruise, wanders more as it calms, and turns back near the edges
  function makeKin(seed, env, mul, minSp, maxSp) {
    var vx = num(seed.vx, 0), vy = num(seed.vy, 0);
    var sp = Math.hypot(vx, vy);
    return {
      x: num(seed.x, env.width / 2),
      y: num(seed.y, env.height / 2),
      h: sp > 1 ? Math.atan2(vy, vx) : rand(0, TAU),
      sp: clamp(sp * mul, minSp, maxSp),
      cruise: rand(minSp, minSp * 1.8),
      ph: rand(0, 40)
    };
  }
  function stepKin(k, dt, t, drag, wander, w, h) {
    k.sp += (k.cruise - k.sp) * Math.min(1, drag * dt);
    var calm = clamp(1 - (k.sp - k.cruise) / 260, 0.25, 1);
    k.h += (field(k.x, k.y, t + k.ph) * 0.5 + Math.sin(t * 0.6 + k.ph)) * wander * calm * dt;
    k.x += Math.cos(k.h) * k.sp * dt;
    k.y += Math.sin(k.h) * k.sp * dt;
    var m = 30;
    if (k.x < m || k.x > w - m || k.y < m || k.y > h - m) {
      var toC = Math.atan2(h * 0.5 - k.y, w * 0.5 - k.x);
      k.h += Math.sin(toC - k.h) * Math.min(1, 4 * dt);
    }
  }

  // a petal: a short rotating glint whose length breathes as it tumbles
  function drawPetal(ctx, x, y, ang, len, style) {
    var ap = len * (0.4 + 0.6 * Math.abs(Math.cos(ang * 1.7)));
    var ca = Math.cos(ang) * ap, sa = Math.sin(ang) * ap;
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.moveTo(x - ca, y - sa);
    ctx.lineTo(x + ca, y + sa);
    ctx.stroke();
  }

  // population cap: overflowing oldest are fast-faded, far-overflow dropped
  function capPush(list, e) {
    list.push(e);
    var over = list.length - CAP;
    for (var i = 0; i < over; i++) {
      var o = list[i];
      if (o.life - o.age > 0.5) o.life = o.age + 0.5;
    }
    while (list.length > CAP + 10) list.shift();
  }

  /* ------------------------------------------------------------------
     1. Drift Tide — cast a shoal: a small school of teal streaks that
        swims where it was sent, then slows and wanders as one body
  ------------------------------------------------------------------ */
  function driftTide() {
    var ents = [];
    var motes = [];
    var first = true;
    var held = null;
    var bg = null;
    var shades = ['rgba(64,190,180,', 'rgba(40,150,165,', 'rgba(130,225,205,'];

    /* sunlight in water: each shaft is one soft sprite, baked once, drawn
       sheared so it leans and swings. Both fades below are shared by the
       bake and the mote lighting, so the light a mote feels is exactly the
       light that is painted. */
    var TOP_F = 0.36; // the shaft is this fraction of its width at the surface
    function depthFade(u) { var v = 1 - u; return v * (0.25 + 0.75 * v); }
    function edgeFade(q) { var v = 1 - q * q; return v * v; }

    var shaftImg = null;   // the baked sprite, size-independent: made once
    var shafts = [];       // per-shaft character, rolled at init
    var lit = [];          // per-frame geometry, reused (never reallocated)

    function makeShaftSprite() {
      if (typeof document === 'undefined') return null;
      var SW = 96, SH = 256;
      var c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      var g = c.getContext('2d');
      if (!g) return null;
      // feathered across, tapering wider with depth: banded rows of gradient
      var rows = 48, i, j, p;
      for (i = 0; i < rows; i++) {
        var u = i / (rows - 1);
        var hw = SW * 0.5 * (TOP_F + (1 - TOP_F) * u);
        var gr = g.createLinearGradient(SW * 0.5 - hw, 0, SW * 0.5 + hw, 0);
        for (j = 0; j <= 8; j++) {
          p = j / 8;
          gr.addColorStop(p, 'rgba(168,232,222,' + edgeFade(Math.abs(p * 2 - 1)).toFixed(3) + ')');
        }
        g.fillStyle = gr;
        var y0 = Math.round(i * SH / rows), y1 = Math.round((i + 1) * SH / rows);
        g.fillRect(0, y0, SW, y1 - y0); // exact bands: overlap would seam
      }
      // and dying away with depth, so there is no bottom edge at all
      g.globalCompositeOperation = 'destination-in';
      var vg = g.createLinearGradient(0, 0, 0, SH);
      for (j = 0; j <= 10; j++) {
        p = j / 10;
        vg.addColorStop(p, 'rgba(255,255,255,' + depthFade(p).toFixed(3) + ')');
      }
      g.fillStyle = vg;
      g.fillRect(0, 0, SW, SH);
      return c;
    }

    // how much shaft light reaches a point — the same shape that is painted
    function shaftLight(px, py) {
      var sum = 0;
      for (var i = 0; i < lit.length; i++) {
        var L = lit[i];
        var u = py / L.D;
        if (u < 0 || u > 1) continue;
        var q = (px - (L.cx + L.k * py)) / (L.hw0 + (L.hw1 - L.hw0) * u);
        if (q < -1 || q > 1) continue;
        sum += edgeFade(q) * depthFade(u) * L.br;
      }
      return sum;
    }

    function makeEnt(env, seed, pw) {
      var kin = makeKin(seed, env, 0.3, 40, 480);
      var nf = 4 + Math.round(pw * 7);
      var fish = [];
      for (var i = 0; i < nf; i++) {
        fish.push({
          r: rand(6, 14 + pw * 18),
          a: rand(0, TAU),
          wf: rand(1.5, 3.5),
          ph: rand(0, TAU),
          px: kin.x, py: kin.y,
          c: (Math.random() * shades.length) | 0
        });
      }
      return { kin: kin, fish: fish, age: 0, life: rand(4, 6) + pw * 3, gs: 1, cz: 0, held: false };
    }

    return {
      id: 'drift-tide',
      name: 'Drift Tide',
      init: function (env) {
        ents.length = 0;
        first = true;
        held = null;
        motes.length = 0;
        var n = countFor(env.width, env.height, 30000, 8, 26);
        for (var i = 0; i < n; i++) {
          motes.push({ x: rand(0, env.width), y: rand(0, env.height), sp: rand(5, 12), ph: rand(0, TAU) });
        }
        if (!shaftImg) shaftImg = makeShaftSprite();
        shafts.length = 0;
        lit.length = 0;
        // all three lean away from one point on the surface, so they open
        // like a fan instead of crossing
        var sunX = rand(0.38, 0.62), spread = rand(0.35, 0.5);
        for (i = 0; i < 3; i++) {
          var sx = 0.24 + 0.26 * i + rand(-0.03, 0.03);
          shafts.push({
            x: sx,                                  // where it meets the surface
            wd: rand(0.22, 0.32),                   // width at its widest
            dp: rand(1.05, 1.3),                    // reaches past the frame
            lean: (sx - sunX) * spread + rand(-0.02, 0.02), // x drift per y
            swf: rand(0.035, 0.075), swp: rand(0, TAU), // the long swing
            brf: rand(0.06, 0.13), brp: rand(0, TAU),   // the slow breath
            shf: rand(0.17, 0.28), shp: rand(0, TAU)    // a fainter shimmer
          });
          lit.push({ cx: 0, k: 0, hw0: 1, hw1: 1, D: 1, br: 0 });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          // the abyss: faintly teal above, dark below, a dune on the seafloor
          var sea = g.createLinearGradient(0, 0, 0, H);
          sea.addColorStop(0, 'rgb(22,52,60)');
          sea.addColorStop(0.55, 'rgb(12,30,36)');
          sea.addColorStop(1, 'rgb(8,20,25)');
          g.fillStyle = sea;
          g.fillRect(0, 0, W, H);
          ridge(g, W, H, 0.93, 0.02, 4.2, 0.012, 9.1, 1, 'rgb(5,12,15)');
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown shoal, as-is
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.3, 40, 480, rand(4, 6) + seedPower(seed) * 3);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) { // charged seed with nothing held: scale a fresh one
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.22, 'rgb(12,30,36)');
        first = false;

        ctx.globalCompositeOperation = 'lighter';

        // scenery in motion: shafts of surface light leaning into the water,
        // swinging over ~1.5-3 minutes and breathing as they go
        for (var sh = 0; sh < shafts.length; sh++) {
          var sp = shafts[sh], L = lit[sh];
          var sway = Math.sin(t * sp.swf + sp.swp) * 0.035 +
                     Math.sin(t * sp.swf * 1.7 + sp.swp * 2.3) * 0.014;
          var wid = w * sp.wd;
          L.D = h * sp.dp;
          L.cx = w * sp.x + sway * w;
          L.k = sp.lean + sway * 0.5;
          L.hw0 = wid * 0.5 * TOP_F;
          L.hw1 = wid * 0.5;
          L.br = (0.72 + 0.28 * Math.sin(t * sp.brf + sp.brp)) *
                 (0.88 + 0.12 * Math.sin(t * sp.shf + sp.shp));
          if (!shaftImg) continue;
          ctx.save();
          ctx.globalAlpha = 0.085 * L.br;
          ctx.transform(1, 0, L.k, 1, 0, 0); // the lean, as a shear
          ctx.drawImage(shaftImg, L.cx - wid * 0.5, 0, wid, L.D);
          ctx.restore();
        }

        // ambient whisper: dim motes riding the current, catching the light
        // as they drift through a shaft
        ctx.fillStyle = 'rgba(70,180,170,0.09)';
        for (var i = 0; i < motes.length; i++) {
          var m = motes[i];
          var a = field(m.x, m.y, t);
          m.x += Math.cos(a) * m.sp * dt;
          m.y += Math.sin(a) * m.sp * dt;
          if (m.x < -8) m.x = w + 8; else if (m.x > w + 8) m.x = -8;
          if (m.y < -8) m.y = h + 8; else if (m.y > h + 8) m.y = -8;
          var lum = shaftLight(m.x, m.y);
          if (lum > 0.03) {
            var glint = lum * (0.7 + 0.3 * Math.sin(t * 1.1 + m.ph));
            ctx.fillStyle = 'rgba(175,235,225,' + (0.09 + 0.5 * glint) + ')';
            ctx.fillRect(m.x - 0.4, m.y - 0.4, 2.3, 2.3);
            ctx.fillStyle = 'rgba(70,180,170,0.09)';
          } else {
            ctx.fillRect(m.x, m.y, 1.5, 1.5);
          }
        }

        // charge: a provisional shoal grows in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // shoals: each fish swims a wobbling station around the moving core.
        // trails fade fast now, so each fish draws its own short body along
        // its motion instead of relying on accumulation
        ctx.lineWidth = 1.8;
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          if (!e.held) stepKin(e.kin, dt, t, 0.5, 1.1, w, h);
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          for (var f = 0; f < e.fish.length; f++) {
            var q = e.fish[f];
            var wob = Math.sin(t * q.wf + q.ph) * 0.9;
            var fx = e.kin.x + Math.cos(q.a + wob) * q.r * gs;
            var fy = e.kin.y + Math.sin(q.a + wob) * q.r * gs * 0.7;
            ctx.strokeStyle = shades[q.c] + 0.75 * al + ')';
            ctx.beginPath();
            ctx.moveTo(fx - (fx - q.px) * 3.5, fy - (fy - q.py) * 3.5);
            ctx.lineTo(fx, fy);
            ctx.stroke();
            q.px = fx; q.py = fy;
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     2. Ember Breath — cast an ember wisp: a warm spark that flies where
        flicked, flutters, sheds embers along its arc, and gutters out
  ------------------------------------------------------------------ */
  function emberBreath() {
    var ents = [];
    var sparks = [];
    var motes = [];
    var first = true;
    var held = null;
    var bg = null;

    function makeEnt(env, seed, pw) {
      return {
        kin: makeKin(seed, env, 0.28, 30, 420),
        age: 0,
        life: rand(3.5, 5) + pw * 3.5,
        r: 2.2 + pw * 3,
        shed: 0,
        pf: rand(4, 7),
        ph: rand(0, TAU),
        gs: 1, cz: 0, held: false
      };
    }

    return {
      id: 'ember-breath',
      name: 'Ember Breath',
      init: function (env) {
        ents.length = 0;
        sparks.length = 0;
        first = true;
        held = null;
        motes.length = 0;
        var n = countFor(env.width, env.height, 90000, 4, 12);
        for (var i = 0; i < n; i++) {
          motes.push({ x: rand(0, env.width), y: rand(0, env.height), vy: rand(4, 10), ph: rand(0, TAU) });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          var base = g.createLinearGradient(0, 0, 0, H);
          base.addColorStop(0, 'rgb(24,13,10)');
          base.addColorStop(1, 'rgb(34,19,13)');
          g.fillStyle = base;
          g.fillRect(0, 0, W, H);
          // a warm firelit floor under everything
          var fl = g.createLinearGradient(0, H * 0.65, 0, H);
          fl.addColorStop(0, 'rgba(94,44,22,0)');
          fl.addColorStop(1, 'rgba(94,44,22,0.75)');
          g.fillStyle = fl;
          g.fillRect(0, H * 0.65, W, H * 0.35);
          // a hearth-stone arch, low and dark
          g.fillStyle = 'rgb(14,8,6)';
          g.beginPath();
          g.moveTo(W * 0.24, H + 2);
          g.lineTo(W * 0.24, H * 0.8);
          g.quadraticCurveTo(W * 0.5, H * 0.68, W * 0.76, H * 0.8);
          g.lineTo(W * 0.76, H + 2);
          g.closePath();
          g.fill();
          // its opening, lit from within
          g.fillStyle = 'rgb(62,29,16)';
          g.beginPath();
          g.moveTo(W * 0.36, H + 2);
          g.lineTo(W * 0.36, H * 0.87);
          g.quadraticCurveTo(W * 0.5, H * 0.79, W * 0.64, H * 0.87);
          g.lineTo(W * 0.64, H + 2);
          g.closePath();
          g.fill();
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown wisp, as-is
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.28, 30, 420, rand(3.5, 5) + seedPower(seed) * 3.5);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        var p = env.pointer || {};
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.10, 'rgb(30,17,12)');
        first = false;

        // scenery in motion: the hearth's inner light on a slow warm rhythm
        var hg = 0.5 + 0.35 * Math.sin(t * 0.5) + 0.15 * Math.sin(t * 1.3 + 1);
        var hgr = ctx.createRadialGradient(w * 0.5, h * 0.97, 0, w * 0.5, h * 0.97, w * 0.16);
        hgr.addColorStop(0, 'rgba(255,130,50,' + 0.10 * hg + ')');
        hgr.addColorStop(1, 'rgba(255,120,45,0)');
        ctx.fillStyle = hgr;
        ctx.fillRect(w * 0.34, h * 0.76, w * 0.32, h * 0.24);

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: a faint breathing warmth low in the frame
        var breath = 0.5 - 0.5 * Math.cos(t * TAU / 9);
        var ga = (0.018 + 0.024 * breath) * (p.down ? 1.4 : 1);
        var gr = Math.min(w, h) * 0.22 * (0.8 + 0.3 * breath);
        var g = ctx.createRadialGradient(w / 2, h * 0.72, 0, w / 2, h * 0.72, gr);
        g.addColorStop(0, 'rgba(255,140,60,' + ga + ')');
        g.addColorStop(1, 'rgba(255,140,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.72, gr, 0, TAU);
        ctx.fill();
        for (var i = 0; i < motes.length; i++) {
          var m = motes[i];
          m.y -= m.vy * dt;
          if (m.y < -6) { m.y = h + 6; m.x = rand(0, w); }
          ctx.fillStyle = 'rgba(255,180,100,' + (0.035 + 0.03 * Math.sin(t * 1.3 + m.ph)) + ')';
          ctx.fillRect(m.x, m.y, 1.5, 1.5);
        }

        // charge: a provisional wisp grows in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // wisps: pulsing fluttering heads that gutter near the end
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          if (!e.held) stepKin(e.kin, dt, t, 0.55, 1.3, w, h);
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          var frac = e.age / e.life;
          var gut = frac > 0.7 ? 0.55 + 0.45 * Math.sin(t * 18 + e.ph) : 1;
          var pulse = 1 + 0.25 * Math.sin(t * e.pf + e.ph);
          var bob = Math.sin(t * 6 + e.ph) * 2.5;
          var hx = e.kin.x + Math.cos(e.kin.h + Math.PI / 2) * bob;
          var hy = e.kin.y + Math.sin(e.kin.h + Math.PI / 2) * bob;

          ctx.fillStyle = 'rgba(255,120,50,' + 0.10 * al * gut + ')';
          ctx.beginPath();
          ctx.arc(hx, hy, e.r * gs * 3.4 * pulse, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,205,130,' + 0.7 * al * gut + ')';
          ctx.beginPath();
          ctx.arc(hx, hy, e.r * gs * pulse, 0, TAU);
          ctx.fill();

          e.shed -= dt;
          if (e.shed <= 0 && frac < 0.85 && sparks.length < 240) {
            sparks.push({
              x: hx, y: hy,
              vx: rand(-16, 16) - Math.cos(e.kin.h) * e.kin.sp * 0.18,
              vy: rand(-26, -6) - Math.sin(e.kin.h) * e.kin.sp * 0.18,
              age: 0, life: rand(0.7, 1.5),
              r: rand(0.7, 1.8), ph: rand(0, TAU)
            });
            e.shed = rand(0.06, 0.12);
          }
        }

        // shed sparks: rise, flicker, die
        for (i = sparks.length - 1; i >= 0; i--) {
          var s = sparks[i];
          s.age += dt;
          if (s.age >= s.life) { sparks.splice(i, 1); continue; }
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.vy -= 8 * dt;
          var sa = (1 - s.age / s.life) * (0.3 + 0.3 * Math.sin(t * 12 + s.ph));
          ctx.fillStyle = 'rgba(255,180,100,' + Math.max(0, sa) + ')';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     3. Aurora Veil — cast a ribbon serpent: an undulating band of
        auroral light that snakes along the direction it was thrown
  ------------------------------------------------------------------ */
  function auroraVeil() {
    var ents = [];
    var stars = [];
    var hintGrad = null;
    var hintY = 0;
    var held = null;
    var bg = null;
    var cols = ['rgba(80,220,160,', 'rgba(110,170,235,', 'rgba(170,120,235,'];

    function makeEnt(env, seed, pw) {
      var kin = makeKin(seed, env, 0.32, 50, 500);
      var pts = [];
      for (var i = 0; i < 22; i++) pts.push({ x: kin.x, y: kin.y });
      return {
        kin: kin, pts: pts,
        lx: kin.x, ly: kin.y,
        age: 0, life: rand(4, 6) + pw * 3,
        c: cols[(Math.random() * cols.length) | 0],
        wf: rand(2.5, 4.5), wa: rand(0.9, 1.8), ph: rand(0, TAU),
        wd: 7 + pw * 9,
        gs: 1, cz: 0, held: false
      };
    }

    return {
      id: 'aurora-veil',
      name: 'Aurora Veil',
      init: function (env) {
        var w = env.width, h = env.height;
        ents.length = 0;
        held = null;
        stars.length = 0;
        var n = countFor(w, h, 55000, 10, 32);
        for (var i = 0; i < n; i++) {
          stars.push({ x: rand(0, w), y: rand(0, h * 0.72), r: rand(0.5, 1.3), ph: rand(0, TAU), sp: rand(0.2, 0.8) });
        }
        hintY = h * 0.55;
        hintGrad = env.ctx.createLinearGradient(0, hintY, 0, h);
        hintGrad.addColorStop(0, 'rgba(80,200,150,0)');
        hintGrad.addColorStop(0.5, 'rgba(80,200,150,0.07)');
        hintGrad.addColorStop(1, 'rgba(60,150,130,0)');
        bg = makeBackdrop(env, function (g, W, H) {
          // the sky brightens toward the horizon behind the mountains
          var sky = g.createLinearGradient(0, 0, 0, H);
          sky.addColorStop(0, 'rgb(16,20,38)');
          sky.addColorStop(0.72, 'rgb(30,38,66)');
          sky.addColorStop(1, 'rgb(20,26,48)');
          g.fillStyle = sky;
          g.fillRect(0, 0, W, H);
          // a far mountain ridge, and a nearer, darker one
          ridge(g, W, H, 0.78, 0.035, 7, 0.015, 17, 0, 'rgb(11,13,26)');
          ridge(g, W, H, 0.86, 0.03, 5, 0.012, 12, 3, 'rgb(7,9,18)');
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the coiled serpent, as-is
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.32, 50, 500, rand(4, 6) + seedPower(seed) * 3);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, 1, 'rgb(16,20,38)');

        // scenery in motion: an aurora glow breathes along the ridgeline (~9s)
        var rg = 0.5 + 0.5 * Math.sin(t * 0.7);
        var rgr = ctx.createLinearGradient(0, h * 0.68, 0, h * 0.84);
        rgr.addColorStop(0, 'rgba(90,220,170,0)');
        rgr.addColorStop(1, 'rgba(90,220,170,' + (0.045 + 0.06 * rg) + ')');
        ctx.fillStyle = rgr;
        ctx.fillRect(0, h * 0.68, w, h * 0.16);

        // ambient whisper: dim stars and a breath of aurora on the horizon
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          var a = 0.09 + 0.2 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
          ctx.fillStyle = 'rgba(200,215,255,' + a + ')';
          ctx.fillRect(s.x, s.y, s.r, s.r);
        }
        ctx.fillStyle = hintGrad;
        ctx.fillRect(0, hintY, w, h - hintY);

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // charge: a provisional serpent coils around the finger, its body
        // laid down by its own spine-recording as it circles
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
          var rr = 8 + 9 * held.gs;
          held.kin.x = chg.x + Math.cos(t * 1.6) * rr;
          held.kin.y = chg.y + Math.sin(t * 1.6) * rr * 0.7;
          held.kin.h = t * 1.6 + Math.PI / 2;
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // serpents: new spine points are laid down as the head swims, so
        // the undulation ripples backward along the whole body
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          var k = e.kin;
          if (!e.held) {
            k.h += Math.sin(e.age * e.wf + e.ph) * e.wa * dt; // serpentine sway
            stepKin(k, dt, t, 0.5, 1.0, w, h);
          }
          var dx = k.x - e.lx, dy = k.y - e.ly;
          if (dx * dx + dy * dy > 36) { // record spine every ~6px travelled
            e.pts.push({ x: k.x, y: k.y });
            e.pts.shift();
            e.lx = k.x; e.ly = k.y;
          }
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          for (var pass = 0; pass < 3; pass++) {
            ctx.lineWidth = pass === 0 ? e.wd * gs : pass === 1 ? e.wd * gs * 0.45 : 1.5;
            ctx.strokeStyle = e.c + (pass === 0 ? 0.06 : pass === 1 ? 0.14 : 0.4) * al + ')';
            ctx.beginPath();
            ctx.moveTo(k.x, k.y);
            for (var j = e.pts.length - 1; j >= 0; j--) ctx.lineTo(e.pts[j].x, e.pts[j].y);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(230,255,240,' + 0.5 * al + ')';
          ctx.beginPath();
          ctx.arc(k.x, k.y, 1.8, 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     4. Still Orbits — cast a traveling constellation: motes wheel
        around a slowly moving, precessing center, leaving orbit trails
  ------------------------------------------------------------------ */
  function stillOrbits() {
    var ents = [];
    var stars = [];
    var first = true;
    var held = null;
    var bg = null;
    var mx = new Array(12), my = new Array(12);
    var cols = ['rgba(190,160,255,', 'rgba(230,190,255,', 'rgba(255,200,220,', 'rgba(160,170,255,'];

    function makeEnt(env, seed, pw) {
      var nm = 4 + Math.round(pw * 4);
      var motes = [];
      for (var i = 0; i < nm; i++) {
        motes.push({
          rad: rand(9, 22 + pw * 26),
          sp: rand(0.6, 1.6) * (Math.random() < 0.5 ? 1 : -1),
          ph: rand(0, TAU),
          r: rand(0.9, 2),
          c: cols[(Math.random() * cols.length) | 0]
        });
      }
      return {
        kin: makeKin(seed, env, 0.3, 25, 380),
        motes: motes,
        rot: rand(0, TAU),
        prec: rand(-0.5, 0.5),
        age: 0, life: rand(4.5, 6.5) + pw * 2.5,
        gs: 1, cz: 0, held: false
      };
    }

    return {
      id: 'still-orbits',
      name: 'Still Orbits',
      init: function (env) {
        ents.length = 0;
        first = true;
        held = null;
        stars.length = 0;
        var n = countFor(env.width, env.height, 80000, 5, 14);
        for (var i = 0; i < n; i++) {
          stars.push({ x: rand(0, env.width), y: rand(0, env.height), ph: rand(0, TAU), sp: rand(0.15, 0.5) });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          // deep space: a soft violet vignette
          var vg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
          vg.addColorStop(0, 'rgb(34,28,54)');
          vg.addColorStop(1, 'rgb(16,12,28)');
          g.fillStyle = vg;
          g.fillRect(0, 0, W, H);
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown constellation
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.3, 25, 380, rand(4.5, 6.5) + seedPower(seed) * 2.5);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.22, 'rgb(24,19,40)');
        first = false;

        // scenery in motion: the galactic band drifts and pulses (~15s)
        var bp = 0.5 + 0.5 * Math.sin(t * 0.42);
        var bs = Math.sin(t * 0.13) * h * 0.04;
        var band = ctx.createLinearGradient(0, h * 0.15 + bs, w, h * 0.85 + bs);
        band.addColorStop(0.3, 'rgba(180,160,220,0)');
        band.addColorStop(0.5, 'rgba(180,160,220,' + (0.02 + 0.025 * bp) + ')');
        band.addColorStop(0.7, 'rgba(180,160,220,0)');
        ctx.fillStyle = band;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: a handful of dim slow-twinkling stars
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          ctx.fillStyle = 'rgba(200,185,240,' + (0.03 + 0.035 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph))) + ')';
          ctx.fillRect(s.x, s.y, 1.4, 1.4);
        }

        // charge: a provisional constellation grows in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // constellations: orbiting motes trace trails behind the drift
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          if (!e.held) stepKin(e.kin, dt, t, 0.45, 0.9, w, h);
          e.rot += e.prec * dt;
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          var cr = Math.cos(e.rot), sr = Math.sin(e.rot);
          var n = e.motes.length;
          for (var j = 0; j < n; j++) {
            var q = e.motes[j];
            var ang = e.age * q.sp + q.ph;
            var ox = Math.cos(ang) * q.rad * gs, oy = Math.sin(ang) * q.rad * gs * 0.7;
            mx[j] = e.kin.x + ox * cr - oy * sr;
            my[j] = e.kin.y + ox * sr + oy * cr;
          }
          // faint constellation lines
          ctx.strokeStyle = 'rgba(180,160,230,' + 0.13 * al + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(mx[0], my[0]);
          for (j = 1; j < n; j++) ctx.lineTo(mx[j], my[j]);
          ctx.stroke();
          // motes: soft halo plus core
          for (j = 0; j < n; j++) {
            var q2 = e.motes[j];
            ctx.fillStyle = q2.c + 0.10 * al + ')';
            ctx.beginPath();
            ctx.arc(mx[j], my[j], q2.r * 3, 0, TAU);
            ctx.fill();
            ctx.fillStyle = q2.c + 0.6 * al + ')';
            ctx.beginPath();
            ctx.arc(mx[j], my[j], q2.r, 0, TAU);
            ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     5. Night Pond — cast a water spirit: a pale glow that glides where
        sent, sheds ripple rings along its wake, then sinks with one
        last widening ring
  ------------------------------------------------------------------ */
  function nightPond() {
    var ents = [];
    var rings = [];
    var motes = [];
    var first = true;
    var held = null;
    var bg = null;
    var reeds = [];
    var moonX = 0, moonY = 0;

    /* the water's edge: the near lip of the far shore, exactly as the
       backdrop paints it. Only what is at or below this line can disturb
       the surface — a spirit up in the night sky leaves the water still. */
    function waterY(x, w, h) {
      return h * 0.385 + Math.sin(x / w * 5 + 1) * h * 0.006;
    }
    // the stretch of a ripple that lies in the water: the arc below `edge`,
    // or null when the whole ring would sit above it
    function ringArc(cy, ry, edge) {
      var s = (edge - cy) / ry;
      if (s >= 1) return null;
      return s <= -1 ? -Math.PI / 2 : Math.asin(s);
    }

    function makeEnt(env, seed, pw) {
      var kin = makeKin(seed, env, 0.3, 35, 460);
      return {
        kin: kin,
        age: 0, life: rand(4, 6) + pw * 2.5,
        r: 2.8 + pw * 3.2,
        shed: 0, ph: rand(0, TAU),
        sunk: false,
        wet: kin.y >= waterY(kin.x, env.width, env.height), // born in the water?
        px: kin.x, py: kin.y, // last drawn point, for the crossing ripple
        xc: 0,                // cooldown, so a spirit skimming the line
                              // cannot stutter out a string of ripples
        gs: 1, cz: 0, held: false
      };
    }

    return {
      id: 'night-pond',
      name: 'Night Pond',
      init: function (env) {
        var w = env.width, h = env.height;
        ents.length = 0;
        rings.length = 0;
        first = true;
        held = null;
        moonX = w * 0.72;
        moonY = h * 0.2;
        motes.length = 0;
        var n = countFor(w, h, 80000, 5, 14);
        for (var i = 0; i < n; i++) {
          motes.push({ x: rand(0, w), y: rand(0, h), vx: rand(-4, 4), vy: rand(-2, 2), ph: rand(0, TAU) });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          // the water, catching a little sky near the far shore
          var wat = g.createLinearGradient(0, H * 0.37, 0, H);
          wat.addColorStop(0, 'rgb(18,34,54)');
          wat.addColorStop(1, 'rgb(10,20,34)');
          g.fillStyle = wat;
          g.fillRect(0, 0, W, H);
          g.fillStyle = 'rgb(20,32,52)'; // the night sky above
          g.fillRect(0, 0, W, H * 0.37);
          // the far shore where they meet
          g.fillStyle = 'rgb(6,12,20)';
          g.beginPath();
          var x, step = Math.max(2, W / 26);
          for (x = 0; x <= W + 1; x += step) {
            var yy = H * 0.365 + Math.sin(x / W * 5 + 1) * H * 0.006;
            if (x === 0) g.moveTo(0, yy); else g.lineTo(x, yy);
          }
          for (x = W; x >= 0; x -= step) {
            g.lineTo(x, H * 0.385 + Math.sin(x / W * 5 + 1) * H * 0.006);
          }
          g.closePath();
          g.fill();
        });
        // reeds at the near left edge, rolled once, swaying per frame
        reeds.length = 0;
        var nr = 4 + Math.round(w / 320);
        for (i = 0; i < nr; i++) {
          reeds.push({
            x: w * 0.03 + i * w * 0.022 + rand(-4, 4),
            rh: h * rand(0.08, 0.16),
            lean: rand(-8, 14),
            lw: rand(1.5, 2.5)
          });
        }
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown water spirit
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.3, 35, 460, rand(4, 6) + seedPower(seed) * 2.5);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.12, 'rgb(12,24,40)');
        first = false;

        // scenery in motion: reeds lean in a slow breeze; the shore shimmers
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(4,9,15,0.6)';
        for (var ri = 0; ri < reeds.length; ri++) {
          var rd = reeds[ri];
          var lean = rd.lean + Math.sin(t * 0.45 + rd.x * 0.05) * 6;
          ctx.lineWidth = rd.lw;
          ctx.beginPath();
          ctx.moveTo(rd.x, h + 2);
          ctx.quadraticCurveTo(rd.x + lean * 0.3, h - rd.rh * 0.6, rd.x + lean, h - rd.rh);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(170,215,255,' + (0.02 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.5))) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.386);
        ctx.lineTo(w, h * 0.386);
        ctx.stroke();

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: dim moon, a sliver of shimmer, drifting motes
        var mg = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, 55);
        mg.addColorStop(0, 'rgba(220,235,255,0.04)');
        mg.addColorStop(1, 'rgba(220,235,255,0)');
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(moonX, moonY, 55, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(230,240,255,0.09)';
        ctx.beginPath();
        ctx.arc(moonX, moonY, 7, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1.2;
        for (var i = 0; i < 3; i++) {
          var sy = h * (0.5 + 0.14 * i);
          var wob = Math.sin(t * 0.6 + i * 1.7) * 8;
          ctx.strokeStyle = 'rgba(190,215,255,' + (0.006 + 0.008 * Math.sin(t * 0.9 + i * 2.1)) + ')';
          ctx.beginPath();
          ctx.moveTo(moonX + wob - 18, sy);
          ctx.lineTo(moonX + wob + 18, sy);
          ctx.stroke();
        }
        for (i = 0; i < motes.length; i++) {
          var m = motes[i];
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          if (m.x < 0) m.x = w; else if (m.x > w) m.x = 0;
          if (m.y < 0) m.y = h; else if (m.y > h) m.y = 0;
          ctx.fillStyle = 'rgba(130,190,200,' + (0.03 + 0.02 * Math.sin(t * 0.5 + m.ph)) + ')';
          ctx.fillRect(m.x, m.y, 1.5, 1.5);
        }

        // charge: a provisional water spirit grows in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // water spirits
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          var k = e.kin;
          if (!e.held) stepKin(k, dt, t, 0.5, 1.0, w, h);
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          var hy = k.y + Math.sin(t * 2 + e.ph) * 1.6;
          var wy = waterY(k.x, w, h);
          // a 2px dead band, so the bob alone never counts as a crossing
          var wet = e.wet ? hy > wy - 2 : hy >= wy + 2;
          e.xc -= dt;

          if (wet !== e.wet) {
            // the moment of entry (or of leaving): one ring right where the
            // spirit broke the surface, interpolated to the exact crossing
            if (e.xc <= 0 && rings.length < 70) {
              var f = (hy === e.py) ? 0 : clamp((wy - e.py) / (hy - e.py), 0, 1);
              rings.push({
                x: e.px + (k.x - e.px) * f, y: wy, age: 0,
                life: wet ? rand(2.6, 3.4) : rand(2, 2.6),
                sp: wet ? rand(26, 36) : rand(20, 28),
                r0: wet ? 3 : 2, a: wet ? 1.3 : 0.8
              });
              e.xc = 0.35;
            }
            e.wet = wet;
          }
          e.px = k.x; e.py = hy;

          if (!e.sunk && e.age > e.life * 0.72) {
            e.sunk = true; // the sinking breath: one last wide slow ring
            if (wet) rings.push({ x: k.x, y: hy, age: 0, life: 3.6, sp: 20, r0: 8, a: 1 });
          }

          ctx.fillStyle = 'rgba(150,210,255,' + 0.08 * al + ')';
          ctx.beginPath();
          ctx.arc(k.x, hy, e.r * gs * 3.2, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(200,235,255,' + 0.4 * al + ')';
          ctx.beginPath();
          ctx.arc(k.x, hy, e.r * gs * (1 + 0.15 * Math.sin(t * 3 + e.ph)), 0, TAU);
          ctx.fill();

          e.shed -= dt;
          // only a spirit in the water leaves a wake in it
          if (e.shed <= 0 && wet && !e.sunk && rings.length < 70) {
            rings.push({ x: k.x, y: hy, age: 0, life: rand(2.2, 3.2), sp: rand(22, 34), r0: 2, a: 1 });
            e.shed = clamp(90 / k.sp, 0.18, 0.8); // faster glide, denser wake
          }
        }

        // expanding wake rings, flattened for perspective and cut off at the
        // water's edge, the way a ripple slips in behind the far bank
        ctx.lineWidth = 1.3;
        for (i = rings.length - 1; i >= 0; i--) {
          var rp = rings[i];
          rp.age += dt;
          if (rp.age >= rp.life) { rings.splice(i, 1); continue; }
          var fade = 1 - rp.age / rp.life;
          var r0 = rp.r0 + rp.age * rp.sp;
          var edge = waterY(rp.x, w, h);
          var s0 = ringArc(rp.y, r0 * 0.5, edge);
          if (s0 !== null) {
            ctx.strokeStyle = 'rgba(150,205,255,' + 0.20 * fade * rp.a + ')';
            ctx.beginPath();
            ctx.ellipse(rp.x, rp.y, r0, r0 * 0.5, 0, s0, Math.PI - s0);
            ctx.stroke();
          }
          var s1 = ringArc(rp.y, r0 * 0.31, edge);
          if (s1 !== null) {
            ctx.strokeStyle = 'rgba(150,205,255,' + 0.10 * fade * rp.a + ')';
            ctx.beginPath();
            ctx.ellipse(rp.x, rp.y, r0 * 0.62, r0 * 0.31, 0, s1, Math.PI - s1);
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     6. Verdant Surge — cast a force node: a green will that surges
        where thrown, dragging a dense swarm of tiny particles around
        and behind it like iron filings in a moving field; on death the
        swarm is released and settles back to a faint drift
  ------------------------------------------------------------------ */
  function verdantSurge() {
    var ents = [];
    var pool = [];
    var tier = new Uint8Array(0);
    var first = true;
    var R2 = 200 * 200; // force reach, squared
    var held = null;
    var bg = null;
    var tierCols = [
      'rgba(95,175,95,0.08)',    // resting moss
      'rgba(70,200,120,0.15)',   // stirred emerald
      'rgba(110,225,140,0.27)',  // rushing emerald
      'rgba(195,245,150,0.42)'   // pale lime highlights
    ];

    // one great tree trunk silhouette, gently swaying in its outline
    function trunk(g, W, H, cx, wd, ph) {
      g.fillStyle = 'rgb(6,14,8)';
      g.beginPath();
      var half = W * wd * 0.5;
      var y, wf, sway;
      g.moveTo(W * cx - half, H + 2);
      for (y = H; y >= 0; y -= Math.max(1, H / 12)) {
        wf = 0.6 + 0.4 * (y / H);
        sway = Math.sin(y / H * 2.3 + ph) * W * 0.012;
        g.lineTo(W * cx - half * wf + sway, y);
      }
      for (y = 0; y <= H; y += Math.max(1, H / 12)) {
        wf = 0.6 + 0.4 * (y / H);
        sway = Math.sin(y / H * 2.3 + ph) * W * 0.012;
        g.lineTo(W * cx + half * wf + sway, y);
      }
      g.closePath();
      g.fill();
    }

    function makeEnt(env, seed, pw) {
      return {
        kin: makeKin(seed, env, 0.35, 60, 520),
        age: 0, al: 0,
        life: rand(3.5, 5) + pw * 2.5,
        pull: 24000 * (0.6 + pw * 0.8),
        swirl: 15000 * (Math.random() < 0.5 ? 1 : -1),
        r2: R2,
        ph: rand(0, TAU),
        gs: 1, cz: 0, held: false
      };
    }

    return {
      id: 'verdant-surge',
      name: 'Verdant Surge',
      init: function (env) {
        ents.length = 0;
        first = true;
        held = null;
        var n = countFor(env.width, env.height, 3000, 140, 700);
        pool.length = 0;
        for (var i = 0; i < n; i++) {
          pool.push({ x: rand(0, env.width), y: rand(0, env.height), vx: 0, vy: 0 });
        }
        tier = new Uint8Array(n);
        bg = makeBackdrop(env, function (g, W, H) {
          // the clearing: darker above, mossy light below
          var base = g.createLinearGradient(0, 0, 0, H);
          base.addColorStop(0, 'rgb(12,26,15)');
          base.addColorStop(1, 'rgb(19,40,22)');
          g.fillStyle = base;
          g.fillRect(0, 0, W, H);
          var fl = g.createLinearGradient(0, H * 0.68, 0, H);
          fl.addColorStop(0, 'rgba(40,74,42,0)');
          fl.addColorStop(1, 'rgba(40,74,42,0.6)');
          g.fillStyle = fl;
          g.fillRect(0, H * 0.68, W, H * 0.32);
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown force node
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.35, 60, 520, rand(3.5, 5) + seedPower(seed) * 2.5);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
          var rr = 200 * (1 + 0.5 * cz);
          e.r2 = rr * rr;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.12, 'rgb(15,32,18)');
        first = false;

        // scenery in motion: the great trunks sway a breath (~18-24s);
        // spores of light drift between them
        trunk(ctx, w, h, 0.07, 0.055, 0.4 + Math.sin(t * 0.3) * 0.12);
        trunk(ctx, w, h, 0.94, 0.045, 2.1 + Math.sin(t * 0.26 + 1.3) * 0.12);
        for (var sp2 = 0; sp2 < 3; sp2++) {
          var spx = w * (0.25 + 0.25 * sp2) + Math.sin(t * 0.11 + sp2 * 2.1) * w * 0.06;
          var spy = h * (0.35 + 0.15 * Math.sin(sp2 * 1.7)) + Math.sin(t * 0.17 + sp2 * 2.8) * h * 0.08;
          var spa = 0.04 + 0.035 * Math.sin(t * 0.5 + sp2 * 2.2);
          ctx.fillStyle = 'rgba(180,240,170,' + Math.max(0, spa) + ')';
          ctx.beginPath();
          ctx.arc(spx, spy, 2.2, 0, TAU);
          ctx.fill();
        }

        ctx.globalCompositeOperation = 'lighter';

        // charge: a provisional force node gathers the swarm in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
          var hr = 200 * (1 + 0.5 * chg.lv); // reach grows moderately
          held.r2 = hr * hr;
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // advance force nodes
        for (var i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          if (!e.held) stepKin(e.kin, dt, t, 0.5, 1.0, w, h);
          e.al = lifeAlpha(e.age, e.life) * entGlow(e);
        }

        // the swarm: faint ambient drift plus pull-and-swirl from every
        // living node (direction folded into dx/dy — no sqrt needed)
        var damp = Math.max(0, 1 - 1.7 * dt);
        var ne = ents.length;
        for (i = 0; i < pool.length; i++) {
          var q = pool[i];
          var fa = field(q.x, q.y, t);
          q.vx = q.vx * damp + Math.cos(fa) * 7 * dt;
          q.vy = q.vy * damp + Math.sin(fa) * 7 * dt;
          for (var j = 0; j < ne; j++) {
            var n2 = ents[j];
            var dx = n2.kin.x - q.x, dy = n2.kin.y - q.y;
            var d2 = dx * dx + dy * dy;
            if (d2 > n2.r2) continue;
            var s = n2.al * dt / (d2 + 1800);
            q.vx += (dx * n2.pull - dy * n2.swirl) * s;
            q.vy += (dy * n2.pull + dx * n2.swirl) * s;
          }
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          if (q.x < 0) q.x += w; else if (q.x > w) q.x -= w;
          if (q.y < 0) q.y += h; else if (q.y > h) q.y -= h;
          var sp2 = q.vx * q.vx + q.vy * q.vy;
          tier[i] = sp2 > 14400 ? 3 : sp2 > 3600 ? 2 : sp2 > 400 ? 1 : 0;
        }

        // draw as speed-tinted streaks, one batched stroke per tier
        for (var tr = 0; tr < 4; tr++) {
          ctx.strokeStyle = tierCols[tr];
          ctx.lineWidth = tr === 3 ? 1.4 : 1.1;
          ctx.beginPath();
          for (i = 0; i < pool.length; i++) {
            if (tier[i] !== tr) continue;
            var q2 = pool[i];
            ctx.moveTo(q2.x - q2.vx * 0.05 - 0.6, q2.y - q2.vy * 0.05);
            ctx.lineTo(q2.x + 0.6, q2.y);
          }
          ctx.stroke();
        }

        // node cores: a quiet green pulse marking each force center
        for (i = 0; i < ents.length; i++) {
          var e3 = ents[i];
          var pr = (1 + 0.2 * Math.sin(t * 5 + e3.ph)) * entScale(e3, t);
          ctx.fillStyle = 'rgba(140,230,150,' + 0.10 * e3.al + ')';
          ctx.beginPath();
          ctx.arc(e3.kin.x, e3.kin.y, 9 * pr, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(210,250,180,' + 0.30 * e3.al + ')';
          ctx.beginPath();
          ctx.arc(e3.kin.x, e3.kin.y, 2.4 * pr, 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     7. Petal Fall — cast a gust of pale-rose petals: they ride the
        throw while the gust lives, then sway, tumble and sift downward,
        glinting as they turn, until they settle into the dusk
  ------------------------------------------------------------------ */
  function petalFall() {
    var ents = [];
    var amb = [];
    var first = true;
    var held = null;
    var bg = null;
    var cols = ['rgba(235,160,180,', 'rgba(250,205,215,', 'rgba(205,125,155,'];
    // the branch, drawn per frame so it can bob in the wind
    var SEGS = [
      [1.04, -0.03, 0.85, 0.02, 0.70, 0.10, 7],
      [0.70, 0.10, 0.60, 0.155, 0.50, 0.17, 4.5],
      [0.50, 0.17, 0.44, 0.175, 0.40, 0.23, 2.5]
    ];
    var TWIGS = [
      [0.80, 0.055, 0.76, 0.14, 2.2],
      [0.61, 0.15, 0.56, 0.06, 1.8],
      [0.44, 0.20, 0.41, 0.29, 1.6]
    ];

    function makeEnt(env, seed, pw) {
      var kin = makeKin(seed, env, 0.3, 25, 450);
      kin.cruise = rand(8, 18); // gusts die down almost to stillness
      var np = 6 + Math.round(pw * 9);
      var petals = [];
      for (var i = 0; i < np; i++) {
        petals.push({
          ox: rand(-14, 14), oy: rand(-14, 14),
          fall: rand(10, 26),
          sw: rand(0.5, 1.2), swA: rand(6, 14),
          ph: rand(0, TAU),
          ang: rand(0, TAU), spin: rand(-2.5, 2.5),
          len: rand(2.5, 4.5),
          c: (Math.random() * cols.length) | 0
        });
      }
      return {
        kin: kin, petals: petals, age: 0, fAge: 0,
        life: rand(4.5, 6.5) + pw * 2.5,
        gs: 1, cz: 0, held: false
      };
    }

    return {
      id: 'petal-fall',
      name: 'Petal Fall',
      init: function (env) {
        ents.length = 0;
        first = true;
        held = null;
        amb.length = 0;
        var n = countFor(env.width, env.height, 90000, 4, 12);
        for (var i = 0; i < n; i++) {
          amb.push({
            x: rand(0, env.width), y: rand(0, env.height),
            fall: rand(8, 18), sw: rand(0.4, 0.9), ph: rand(0, TAU),
            ang: rand(0, TAU), spin: rand(-1.5, 1.5),
            c: (Math.random() * cols.length) | 0
          });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          // a rose dusk, glowing faintly at the top
          var dusk = g.createLinearGradient(0, 0, 0, H);
          dusk.addColorStop(0, 'rgb(54,31,44)');
          dusk.addColorStop(0.5, 'rgb(36,21,29)');
          dusk.addColorStop(1, 'rgb(24,14,19)');
          g.fillStyle = dusk;
          g.fillRect(0, 0, W, H);
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown gust, as-is
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.3, 25, 450, rand(4.5, 6.5) + seedPower(seed) * 2.5);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.09, 'rgb(36,21,29)');
        first = false;

        // scenery in motion: the branch bobs in the wind; its buds pulse rose
        var bob = Math.sin(t * 0.45) * 2;
        ctx.strokeStyle = 'rgb(14,8,11)';
        ctx.lineCap = 'round';
        for (var bi = 0; bi < SEGS.length; bi++) {
          var sg = SEGS[bi];
          var dyb = bob * (1 + bi * 1.4);
          ctx.lineWidth = sg[6];
          ctx.beginPath();
          ctx.moveTo(w * sg[0], h * sg[1] + dyb * 0.4);
          ctx.quadraticCurveTo(w * sg[2], h * sg[3] + dyb * 0.8, w * sg[4], h * sg[5] + dyb);
          ctx.stroke();
        }
        for (bi = 0; bi < TWIGS.length; bi++) {
          var twg = TWIGS[bi];
          var dyt = bob * (2 + bi);
          ctx.lineWidth = twg[4];
          ctx.beginPath();
          ctx.moveTo(w * twg[0], h * twg[1] + dyt * 0.7);
          ctx.quadraticCurveTo(w * (twg[0] + twg[2]) / 2, h * (twg[1] + twg[3]) / 2 + 6 + dyt * 0.85,
            w * twg[2], h * twg[3] + dyt);
          ctx.stroke();
          ctx.fillStyle = 'rgba(190,110,135,' + (0.3 + 0.18 * Math.sin(t * 0.6 + bi * 2.1)) + ')';
          ctx.beginPath();
          ctx.arc(w * twg[2], h * twg[3] + dyt, 2.4, 0, TAU);
          ctx.fill();
        }

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';

        // ambient whisper: a few petals sift down forever
        for (var i = 0; i < amb.length; i++) {
          var m = amb[i];
          m.y += m.fall * dt;
          m.x += Math.sin(t * m.sw + m.ph) * 14 * dt;
          m.ang += m.spin * dt;
          if (m.y > h + 8) { m.y = -8; m.x = rand(0, w); }
          drawPetal(ctx, m.x, m.y, m.ang, 3, cols[m.c] + '0.10)');
        }

        // charge: a provisional gust hovers swirling in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // cast gusts: petals ride the throw, then sink apart as it calms
        // (the fall clock only runs once the gust is free of the hand)
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          if (!e.held) {
            stepKin(e.kin, dt, t, 0.55, 0.6, w, h);
            e.fAge += dt;
          }
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          var sink = 0.25 + 0.75 * Math.min(1, e.fAge / 2);
          for (var j = 0; j < e.petals.length; j++) {
            var q = e.petals[j];
            var px = e.kin.x + q.ox * gs + Math.sin(t * q.sw + q.ph) * q.swA;
            var py = e.kin.y + q.oy * gs + q.fall * e.fAge * sink;
            drawPetal(ctx, px, py, q.ang + q.spin * e.age, q.len * gs, cols[q.c] + 0.45 * al + ')');
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     8. Opal Rise — cast a cluster of soap bubbles: iridescent rims that
        ride the throw, then let buoyancy take over — rising, swaying,
        wobbling, until each pops into a soft ring or slips off the top
  ------------------------------------------------------------------ */
  function opalRise() {
    var ents = [];
    var pops = [];
    var amb = [];
    var first = true;
    var held = null;
    var bg = null;

    function makeEnt(env, seed, pw, one) {
      var kin = makeKin(seed, env, 0.3, 30, 440);
      kin.cruise = rand(10, 20); // the cluster drifts to a hover; buoyancy leads
      var nb = one ? 1 : 5 + Math.round(pw * 5);
      var bubbles = [];
      for (var i = 0; i < nb; i++) {
        bubbles.push({
          ox: one ? 0 : rand(-24, 24), oy: one ? 0 : rand(-20, 20),
          r: one ? 13 : rand(4, 9 + pw * 6),
          rise: rand(14, 30),
          sw: rand(0.6, 1.3), swA: rand(4, 10),
          ph: rand(0, TAU),
          hue: rand(0, 360),
          popIn: rand(2.2, 6.5), // seconds of free flight until it pops
          alive: true,
          big: !!one
        });
      }
      return {
        kin: kin, bubbles: bubbles, age: 0, fAge: 0,
        life: rand(5, 7) + pw * 2,
        gs: 1, cz: 0, held: false
      };
    }

    function pop(px, py, r, hue) {
      if (pops.length >= 40) return;
      var drops = [];
      for (var i = 0; i < 3; i++) drops.push({ a: rand(0, TAU), sp: rand(40, 90) });
      pops.push({ x: px, y: py, r0: r, hue: hue, age: 0, life: 0.5, drops: drops });
    }

    return {
      id: 'opal-rise',
      name: 'Opal Rise',
      init: function (env) {
        ents.length = 0;
        pops.length = 0;
        first = true;
        held = null;
        amb.length = 0;
        var n = countFor(env.width, env.height, 250000, 2, 4);
        for (var i = 0; i < n; i++) {
          amb.push({
            x: rand(0, env.width), y: rand(0, env.height),
            r: rand(1.5, 3), rise: rand(8, 14),
            sw: rand(0.5, 1), ph: rand(0, TAU), hue: rand(0, 360)
          });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          // underwater depth: clearly brighter toward the surface far above
          var dg = g.createLinearGradient(0, 0, 0, H);
          dg.addColorStop(0, 'rgb(40,50,78)');
          dg.addColorStop(0.5, 'rgb(22,26,44)');
          dg.addColorStop(1, 'rgb(12,14,26)');
          g.fillStyle = dg;
          g.fillRect(0, 0, W, H);
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown bubble, as-is
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.3, 30, 440, rand(5, 7) + seedPower(seed) * 2);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.10, 'rgb(22,26,44)');
        first = false;

        // scenery in motion: caustic light bands waver and slide (~13s)
        ctx.fillStyle = 'rgba(150,190,230,0.045)';
        var cstep = Math.max(8, w / 22);
        for (var ci = 0; ci < 3; ci++) {
          var yc = h * (0.07 + 0.08 * ci);
          var phc = t * (0.6 + 0.15 * ci);
          var camp = h * (0.010 + 0.004 * Math.sin(t * 0.35 + ci * 2));
          ctx.beginPath();
          for (var cx2 = 0; cx2 <= w + 1; cx2 += cstep) {
            var cyy = yc + Math.sin(cx2 / w * (5 + ci * 2) + ci * 1.7 + phc) * camp;
            if (cx2 === 0) ctx.moveTo(0, cyy); else ctx.lineTo(cx2, cyy);
          }
          for (cx2 = w; cx2 >= 0; cx2 -= cstep) {
            ctx.lineTo(cx2, yc + h * 0.02 + Math.sin(cx2 / w * (5 + ci * 2) + ci * 1.7 + 0.7 + phc) * camp);
          }
          ctx.closePath();
          ctx.fill();
        }

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: two or three tiny bubbles rising faintly
        ctx.lineWidth = 1;
        for (var i = 0; i < amb.length; i++) {
          var m = amb[i];
          m.y -= m.rise * dt;
          if (m.y < -6) { m.y = h + 6; m.x = rand(0, w); }
          ctx.strokeStyle = 'hsla(' + ((t * 8 + m.hue) % 360) + ',70%,75%,0.13)';
          ctx.beginPath();
          ctx.arc(m.x + Math.sin(t * m.sw + m.ph) * 8, m.y, m.r, 0, TAU);
          ctx.stroke();
        }

        // charge: one big provisional bubble grows in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1, true);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // bubble clusters (the rise clock only runs once free of the hand)
        ctx.lineWidth = 1.4;
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          if (!e.held) {
            stepKin(e.kin, dt, t, 0.5, 0.8, w, h);
            e.fAge += dt;
          }
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          for (var j = 0; j < e.bubbles.length; j++) {
            var q = e.bubbles[j];
            if (!q.alive) continue;
            var r = q.r * gs;
            var px = e.kin.x + q.ox * gs + Math.sin(t * q.sw + q.ph) * q.swA;
            var py = e.kin.y + q.oy * gs - q.rise * e.fAge;
            if (py < -r * 2) { q.alive = false; continue; } // off the top
            if (!e.held && e.fAge >= q.popIn) {
              q.alive = false;
              pop(px, py, r, q.hue);
              if (q.big && e.cz > 0.4) { // a charged bubble bursts into a
                capPush(ents, makeEnt(env, { x: px, y: py }, 0.5)); // small cascade
              }
              continue;
            }
            var hue = (t * 8 + q.hue) % 360;
            var wob = 1 + 0.06 * Math.sin(t * 3 + q.ph);
            ctx.fillStyle = 'hsla(' + hue + ',70%,70%,' + 0.04 * al + ')';
            ctx.strokeStyle = 'hsla(' + hue + ',75%,75%,' + 0.5 * al + ')';
            ctx.beginPath();
            ctx.ellipse(px, py, r * wob, r * (2 - wob), 0, 0, TAU);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,' + 0.35 * al + ')';
            ctx.beginPath();
            ctx.arc(px - r * 0.35, py - r * 0.4, Math.max(0.8, r * 0.16), 0, TAU);
            ctx.fill();
          }
        }

        // pops: a soft expanding ring and a few falling droplets
        ctx.lineWidth = 1.2;
        for (i = pops.length - 1; i >= 0; i--) {
          var pp = pops[i];
          pp.age += dt;
          if (pp.age >= pp.life) { pops.splice(i, 1); continue; }
          var f = pp.age / pp.life;
          var hue2 = (t * 8 + pp.hue) % 360;
          ctx.strokeStyle = 'hsla(' + hue2 + ',75%,78%,' + 0.4 * (1 - f) + ')';
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, pp.r0 * (1 + f * 1.8), 0, TAU);
          ctx.stroke();
          ctx.fillStyle = 'hsla(' + hue2 + ',70%,80%,' + 0.5 * (1 - f) + ')';
          ctx.beginPath();
          for (var d = 0; d < pp.drops.length; d++) {
            var dr = pp.drops[d];
            var dd = pp.r0 * 0.6 + dr.sp * pp.age;
            var dx = pp.x + Math.cos(dr.a) * dd;
            var dy = pp.y + Math.sin(dr.a) * dd + 60 * pp.age * pp.age;
            ctx.moveTo(dx + 1, dy);
            ctx.arc(dx, dy, 1, 0, TAU);
          }
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     9. Firefly Meadow — cast a swarm of warm gold lights: flung with
        the throw, they scatter and wander aimlessly, blinking on a
        shared rhythm in loose half-synchrony — bright quick attack,
        soft decay, near-dark in between
  ------------------------------------------------------------------ */
  function fireflyMeadow() {
    var ents = [];
    var amb = [];
    var first = true;
    var held = null;
    var bg = null;
    var blades = [];

    function makeEnt(env, seed, pw) {
      var kin = makeKin(seed, env, 0.3, 20, 420);
      kin.cruise = rand(12, 24); // the swarm settles into aimless wandering
      var nf = Math.min(6 + Math.round(pw * 6), countFor(env.width, env.height, 55000, 6, 12));
      var flies = [];
      for (var i = 0; i < nf; i++) {
        flies.push({
          ox: rand(-34, 34), oy: rand(-28, 28),
          w1: rand(0.4, 0.9), p1: rand(0, TAU),
          w2: rand(0.3, 0.8), p2: rand(0, TAU),
          bph: rand(0.55, 0.9) // small offsets: loose half-synchrony
        });
      }
      return {
        kin: kin, flies: flies, age: 0, fAge: 0, bt: 0,
        life: rand(6, 8) + pw * 2,
        gs: 1, cz: 0, held: false
      };
    }

    // one blink: quick luminance attack, soft decay, dark rest
    function blink(p) {
      if (p < 0.08) return p / 0.08;
      if (p < 0.55) return 1 - (p - 0.08) / 0.47;
      return 0;
    }

    return {
      id: 'firefly-meadow',
      name: 'Firefly Meadow',
      init: function (env) {
        ents.length = 0;
        first = true;
        held = null;
        amb.length = 0;
        var n = countFor(env.width, env.height, 300000, 2, 4);
        for (var i = 0; i < n; i++) {
          amb.push({
            x: rand(0, env.width), y: rand(0, env.height),
            w1: rand(0.2, 0.5), p1: rand(0, TAU),
            w2: rand(0.15, 0.4), p2: rand(0, TAU),
            bph: rand(0, 1)
          });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          // a deep warm indigo summer sky over the meadow
          var sky = g.createLinearGradient(0, 0, 0, H);
          sky.addColorStop(0, 'rgb(35,31,58)');
          sky.addColorStop(0.55, 'rgb(21,23,29)');
          sky.addColorStop(1, 'rgb(15,19,13)');
          g.fillStyle = sky;
          g.fillRect(0, 0, W, H);
          // a distant tree line across the meadow
          ridge(g, W, H, 0.58, 0.05, 5, 0.02, 13, 1.3, 'rgb(9,13,8)');
        });
        // tall grass, rolled once, leaning per frame in traveling breezes
        blades.length = 0;
        var nb = clamp(Math.round(env.width / 22), 12, 70);
        for (i = 0; i < nb; i++) {
          blades.push({
            x: (i + rand(0.1, 0.9)) * env.width / nb,
            gh: env.height * rand(0.05, 0.11),
            lean: rand(-8, 8),
            lw: rand(1, 2)
          });
        }
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown swarm, as-is
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.3, 20, 420, rand(6, 8) + seedPower(seed) * 2);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.10, 'rgb(18,22,16)');
        first = false;

        // scenery in motion: breeze waves travel the grass; the treeline breathes
        ctx.strokeStyle = 'rgba(6,10,5,0.6)';
        ctx.lineCap = 'round';
        for (var b2 = 0; b2 < blades.length; b2++) {
          var bl = blades[b2];
          var lean = bl.lean + Math.sin(t * 0.8 - bl.x * 0.02) * 5;
          ctx.lineWidth = bl.lw;
          ctx.beginPath();
          ctx.moveTo(bl.x, h + 2);
          ctx.quadraticCurveTo(bl.x + lean * 0.3, h - bl.gh * 0.6, bl.x + lean, h - bl.gh);
          ctx.stroke();
        }
        var tb = 0.5 + 0.5 * Math.sin(t * 0.45);
        var tg = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.62);
        tg.addColorStop(0, 'rgba(150,190,120,0)');
        tg.addColorStop(1, 'rgba(150,190,120,' + 0.03 * tb + ')');
        ctx.fillStyle = tg;
        ctx.fillRect(0, h * 0.5, w, h * 0.12);

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: a few faint wanderers with rare blinks
        for (var i = 0; i < amb.length; i++) {
          var m = amb[i];
          var mpx = m.x + Math.sin(t * m.w1 + m.p1) * 40;
          var mpy = m.y + Math.sin(t * m.w2 + m.p2) * 30;
          var mb = blink((t / 6 + m.bph) % 1);
          if (mb > 0.02) {
            ctx.fillStyle = 'rgba(255,170,60,' + 0.05 * mb + ')';
            ctx.beginPath();
            ctx.arc(mpx, mpy, 2 + 4 * mb, 0, TAU);
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(255,215,120,' + (0.05 + 0.3 * mb) + ')';
          ctx.beginPath();
          ctx.arc(mpx, mpy, 1.1, 0, TAU);
          ctx.fill();
        }

        // charge: a lantern-dense provisional swarm gathers in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // swarms: wander and blink; charged rhythm relaxes after release
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          if (!e.held) {
            stepKin(e.kin, dt, t, 0.5, 0.8, w, h);
            e.fAge += dt;
            if (e.cz > 0) e.cz = Math.max(0, e.cz - dt * 0.12);
          }
          e.bt += dt * (1 + 0.8 * e.cz); // blink clock, quicker when charged
          var gs = entScale(e, t);
          var al = lifeAlpha(e.age, e.life) * entGlow(e);
          var spread = Math.min(1, 0.35 + e.fAge / 1.5);
          for (var j = 0; j < e.flies.length; j++) {
            var q = e.flies[j];
            var b = blink((e.bt / 2.2 + q.bph) % 1);
            var px = e.kin.x + q.ox * gs * spread + Math.sin(t * q.w1 + q.p1) * 16;
            var py = e.kin.y + q.oy * gs * spread + Math.sin(t * q.w2 + q.p2) * 13;
            if (b > 0.02) { // swelling halo rides each blink
              ctx.fillStyle = 'rgba(255,170,60,' + 0.10 * b * al + ')';
              ctx.beginPath();
              ctx.arc(px, py, (2.5 + 7 * b) * (0.8 + 0.2 * gs), 0, TAU);
              ctx.fill();
            }
            ctx.fillStyle = 'rgba(255,215,120,' + (0.06 + 0.65 * b) * al + ')';
            ctx.beginPath();
            ctx.arc(px, py, 1.3 * Math.min(gs, 1.6), 0, TAU);
            ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  /* ------------------------------------------------------------------
     10. Dusk Fountain — cast a plume of water: solid ropes of it rise,
         crest and fall into the lawn, fraying into spray only where the
         water really breaks — at the crest, and where it lands. Every
         blade it wets glints, leans aside, and slowly settles again
  ------------------------------------------------------------------ */
  function duskFountain() {
    var ents = [];
    var drops = [];              // preallocated spray pool: never grows
    var dGrp = new Uint8Array(0); // per-droplet draw group, reused each frame
    var dCur = 0, dLive = 0;
    var spl = [];                // preallocated splash ring buffer
    var sCur = 0;
    var blades = [];
    var amb = [];
    var first = true;
    var held = null;
    var bg = null;
    var G = 900; // gravity, scaled to the frame so every arc keeps its shape
    var U = 1;   // water unit, so the fountain still reads at portrait size
    var gA = 0, gB = 0, gK = 0; // the lawn's surface line

    /* A plume is not a cloud of particles but a handful of ropes. Every
       parcel one nozzle throws travels the same arc, so the stream IS that
       arc: sampled here from the youngest water, still at the nozzle, to
       the oldest that is still in the air. Closing the jet simply lifts
       the near end away and the rope left hanging falls on its own. One
       scratch buffer serves whichever plume is being drawn, so a frame of
       water costs a few multiplications and four strokes, and nothing at
       all is allocated. */
    var SS = 8;   // ropes per plume, at most
    var SK = 15;  // samples along one rope
    var ropeX = new Float32Array(SS * (SK + 1));
    var ropeY = new Float32Array(SS * (SK + 1));
    var ropeN = new Uint8Array(SS);

    // three brightness tiers x two droplet sizes, batched into six strokes
    var TIER = [0.30, 0.30, 0.62, 0.62, 1, 1];

    /* How a rope is painted: width, alpha, colour, and the stretch of the
       rope each pass covers. Two nested blooms give the water a soft edge
       instead of a slab one; the far half is drawn narrower and dimmer, so
       the stream thins as it falls and hands over to the spray; the bright
       core and the solid throat stay near the nozzle. */
    var RW = [3.0, 1.8, 1.30, 0.75, 0.50, 2.0];
    var RA = [0.045, 0.035, 0.22, 0.15, 0.26, 0.18];
    var RF = [0, 0.60, 0, 0.58, 0, 0];
    var RT = [0.66, 1, 0.64, 1, 0.74, 0.30];
    var RC = ['rgba(26,74,180,', 'rgba(26,74,180,',
              'rgba(48,120,228,', 'rgba(48,120,228,',
              'rgba(150,205,255,', 'rgba(95,170,245,'];

    function groundY(x) { return gA + Math.sin(x * gK + 0.7) * gB; }

    function spawnDrop(x, y, vx, vy, big, bounced) {
      if (dLive >= drops.length) return;
      for (var i = 0; i < drops.length; i++) {
        var d = drops[dCur];
        dCur = dCur + 1 < drops.length ? dCur + 1 : 0;
        if (d.alive) continue;
        d.x = x; d.y = y; d.vx = vx; d.vy = vy;
        d.age = 0;
        d.life = bounced ? rand(0.5, 0.9) : rand(1.8, 3);
        d.big = big;
        d.bounced = bounced;
        d.alive = true;
        dLive++;
        return;
      }
    }

    function addSplash(x, y, p) {
      var s = spl[sCur];
      sCur = sCur + 1 < spl.length ? sCur + 1 : 0;
      s.x = x; s.y = y; s.p = p; s.age = 0; s.life = rand(0.5, 0.8); s.alive = true;
    }

    // water landing here: the blades nearby take the light and the nudge.
    // `amt` is one drop's worth for a drop, and dt's worth for a rope that
    // is standing on the lawn pouring
    function wetGrass(x, p, amt) {
      var rad = (26 + 16 * p) * U;
      var kick = amt * 2;
      for (var i = 0; i < blades.length; i++) {
        var b = blades[i];
        var d = b.x - x;
        if (d < -rad) continue;
        if (d > rad) break; // blades are laid down left to right
        var f = 1 - (d < 0 ? -d : d) / rad;
        b.gl = Math.min(1, b.gl + amt * f * p);
        b.kick += (d < 0 ? -kick : kick) * f * p;
      }
    }

    function makeEnt(env, seed, pw) {
      var kin = makeKin(seed, env, 0.08, 0, 110);
      var vx = num(seed.vx, 0), vy = num(seed.vy, 0);
      var sp = Math.hypot(vx, vy);
      var ax, ay;
      if (sp > 60) { ax = vx / sp; ay = vy / sp - 1.15; } // thrown, yet always arcing up
      else { ax = rand(-0.12, 0.12); ay = -1; }           // tap or hold: a straight plume
      var dur = 0.5 + 0.9 * pw;
      var spread = 0.07 + 0.075 * pw;
      // the nozzle is really a few nozzles, fanned evenly and set close
      // enough that their ropes overlap into one body of water low down,
      // parting only up near the crest. The middle throws highest.
      var ns = 5 + Math.round(pw * 3);
      var str = [];
      for (var i = 0; i < ns; i++) {
        var q = ns > 1 ? (i / (ns - 1) - 0.5) * 2 : 0;
        str.push({
          da: q * spread + rand(-0.012, 0.012),
          dv: 1 - 0.10 * q * q + rand(-0.03, 0.03),
          wf: rand(0.35, 0.9), wp: rand(0, TAU), // its own slow waver
          spl: rand(0, 0.1), brk: rand(0, 0.15), frq: rand(0, 0.2)
        });
      }
      return {
        kin: kin, str: str,
        // never dead upright: a fan tilted a hair reads as water, not a bar
        aim: Math.atan2(ay, ax) + rand(-0.06, 0.06),
        spread: spread,
        v0: env.height * (0.40 + 0.44 * pw), // speed follows the frame, so the
        dur: dur, inten: 0,                  // arc has one shape at any size
        eStart: -1, eEnd: -1, // when the jet opened, and when it closed
        age: 0, fAge: 0, hAge: 0,
        life: dur + 2.1, // it outlives the jet: water stays up a while
        gs: 1, cz: 0, held: false
      };
    }

    // a released plume subsides over whatever life it was granted, keeping
    // the last stretch free for the water still falling
    function syncDur(e) {
      e.dur = Math.max(0.35, e.life - e.age - 2.1);
      e.fAge = 0;
    }

    return {
      id: 'dusk-fountain',
      name: 'Dusk Fountain',
      init: function (env) {
        var w = env.width, h = env.height;
        var i;
        ents.length = 0;
        first = true;
        held = null;
        dCur = 0; dLive = 0; sCur = 0;
        G = h * 1.1;
        U = clamp(h / 780, 0.55, 1.35);
        gA = h * 0.905; gB = h * 0.007; gK = 4.3 / w;

        var nd = countFor(w, h, 2600, 150, 420);
        drops.length = 0;
        for (i = 0; i < nd; i++) {
          drops.push({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, big: false, bounced: false, alive: false });
        }
        dGrp = new Uint8Array(nd);
        spl.length = 0;
        for (i = 0; i < 44; i++) spl.push({ x: 0, y: 0, p: 0, age: 0, life: 1, alive: false });

        amb.length = 0;
        var n = countFor(w, h, 220000, 2, 5);
        for (i = 0; i < n; i++) {
          amb.push({
            x: rand(0, w), y: h * rand(0.55, 0.88),
            w1: rand(0.25, 0.6), p1: rand(0, TAU),
            w2: rand(0.2, 0.5), p2: rand(0, TAU)
          });
        }

        bg = makeBackdrop(env, function (g, W, H) {
          // a garden after sundown: the last light still low in the sky
          var sky = g.createLinearGradient(0, 0, 0, H);
          sky.addColorStop(0, 'rgb(22,28,46)');
          sky.addColorStop(0.55, 'rgb(36,42,58)');
          sky.addColorStop(0.84, 'rgb(52,54,60)');
          g.fillStyle = sky;
          g.fillRect(0, 0, W, H);
          ridge(g, W, H, 0.80, 0.022, 3.4, 0.011, 8.3, 0.9, 'rgb(11,19,19)');  // the far hedge
          ridge(g, W, H, 0.865, 0.010, 2.6, 0.006, 6.4, 2.2, 'rgb(18,32,22)'); // the lawn's far edge
          var lawn = g.createLinearGradient(0, H * 0.88, 0, H);
          lawn.addColorStop(0, 'rgba(8,17,12,0)');
          lawn.addColorStop(1, 'rgba(8,17,12,0.62)'); // it darkens toward the near edge
          g.fillStyle = lawn;
          g.fillRect(0, H * 0.88, W, H * 0.12);
        });

        // the lawn, rolled once, leaning per frame in a slow breeze
        blades.length = 0;
        var nb = clamp(Math.round(w / 9), 24, 150);
        for (i = 0; i < nb; i++) {
          blades.push({
            x: (i + rand(0.15, 0.85)) * w / nb,
            gh: h * rand(0.028, 0.085),
            lean: rand(-7, 7) * U,
            lw: rand(0.9, 2.1),
            ph: rand(0, TAU),
            gl: 0, kick: 0, cl: 0
          });
        }
      },
      cast: function (env, seed) {
        seed = seed || {};
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the grown plume, as-is
          if (ents.indexOf(held) === -1) capPush(ents, held);
          releaseHeld(held, seed, 0.08, 0, 110, 1.2 + seedPower(seed) * 0.6);
          syncDur(held);
          held = null;
          return;
        }
        var e = makeEnt(env, seed, seedPower(seed));
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.life += cz * 2.5;
          syncDur(e);
        }
        capPush(ents, e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        var i, b;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.7, 'rgb(30,38,52)');
        first = false;

        // scenery in motion: the dusk afterglow breathes over the hedge (~11s)
        var dg = 0.5 + 0.5 * Math.sin(t * 0.58);
        var dgr = ctx.createLinearGradient(0, h * 0.66, 0, h * 0.83);
        dgr.addColorStop(0, 'rgba(220,180,140,0)');
        dgr.addColorStop(1, 'rgba(220,180,140,' + (0.020 + 0.022 * dg) + ')');
        ctx.fillStyle = dgr;
        ctx.fillRect(0, h * 0.66, w, h * 0.17);

        // the grass: swaying, still carrying whatever the last drops did to
        // it. Silhouettes batch into two strokes, one per weight class.
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(7,17,11,0.78)';
        for (var pass = 0; pass < 2; pass++) {
          ctx.lineWidth = (pass ? 2.1 : 1.3) * U;
          ctx.beginPath();
          for (i = 0; i < blades.length; i++) {
            b = blades[i];
            if (pass === 0) { // settle and sway once, on the first pass
              if (b.gl > 0) b.gl = Math.max(0, b.gl - dt * 0.5);
              if (b.kick !== 0) b.kick *= Math.max(0, 1 - dt * 1.9);
              b.cl = b.lean + Math.sin(t * 0.5 - b.x * 0.017) * 4.5 * U +
                     b.kick * Math.sin(t * 7 + b.ph) * 2.4 * U;
            }
            if ((b.lw > 1.5 ? 1 : 0) !== pass) continue;
            ctx.moveTo(b.x, h + 2);
            ctx.quadraticCurveTo(b.x + b.cl * 0.35, h - b.gh * 0.55, b.x + b.cl, h - b.gh);
          }
          ctx.stroke();
        }

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: a faint sheen along the lawn, midges over it
        ctx.strokeStyle = 'rgba(96,158,116,0.15)';
        for (pass = 0; pass < 2; pass++) {
          ctx.lineWidth = (pass ? 1.7 : 1) * U;
          ctx.beginPath();
          for (i = 0; i < blades.length; i++) {
            b = blades[i];
            if ((b.lw > 1.5 ? 1 : 0) !== pass) continue;
            ctx.moveTo(b.x, h + 2);
            ctx.quadraticCurveTo(b.x + b.cl * 0.35, h - b.gh * 0.55, b.x + b.cl, h - b.gh);
          }
          ctx.stroke();
        }
        for (i = 0; i < amb.length; i++) {
          var m = amb[i];
          ctx.fillStyle = 'rgba(190,205,175,0.10)';
          ctx.beginPath();
          ctx.arc(m.x + Math.sin(t * m.w1 + m.p1) * 26,
                  m.y + Math.sin(t * m.w2 + m.p2) * 16, 1.2 * U, 0, TAU);
          ctx.fill();
        }

        // wet blades: only the ones the water reached carry a glint
        for (i = 0; i < blades.length; i++) {
          b = blades[i];
          if (b.gl <= 0.02) continue;
          ctx.strokeStyle = 'rgba(130,210,225,' + 0.34 * b.gl + ')';
          ctx.lineWidth = (b.lw * 0.8 + 0.35) * U;
          ctx.beginPath();
          ctx.moveTo(b.x, h + 2);
          ctx.quadraticCurveTo(b.x + b.cl * 0.35, h - b.gh * 0.55, b.x + b.cl, h - b.gh);
          ctx.stroke();
        }

        // charge: a provisional plume rises taller and fuller in the hand
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            capPush(ents, held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // plumes: each is a jet, drawn as the ropes of water it is throwing
        ctx.lineJoin = 'round';
        for (i = ents.length - 1; i >= 0; i--) {
          var e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); continue; }
          var target;
          if (e.held) {
            e.hAge += dt;
            target = 1;
          } else {
            stepKin(e.kin, dt, t, 0.6, 0.5, w, h);
            e.fAge += dt;
            var u = e.fAge / e.dur;
            target = u >= 1 ? 0 : (1 - u) * (1 - u); // crests, then subsides
          }
          e.inten += (target - e.inten) * Math.min(1, 6 * dt);
          var la = lifeAlpha(e.age, e.life);
          var gs = entScale(e, t);
          var al = la * entGlow(e);
          var flow = e.inten * Math.min(1, la * 1.5);

          // the moment the jet opened, and the moment it closed: the water
          // thrown between the two is exactly what is still in the air
          if (e.eStart < 0) {
            if (flow <= 0.04) continue;
            e.eStart = e.age;
          } else if (e.eEnd < 0 && flow <= 0.04) {
            e.eEnd = e.age;
          }

          // the water leaves from the lawn's surface at the lowest
          var sx = e.kin.x;
          var sy = Math.min(e.kin.y, groundY(sx) - 3 * U);
          var gy0 = groundY(sx);
          var kvx = Math.cos(e.kin.h) * e.kin.sp;
          var kvy = Math.sin(e.kin.h) * e.kin.sp;
          // charge raises the plume; a dying jet loses its pressure and sags
          var vsc = Math.sqrt(gs) * (0.55 + 0.45 * flow);
          var sBeg = e.eEnd >= 0 ? e.age - e.eEnd : 0; // the near end, once shut
          var sTop = e.age - e.eStart;                 // the oldest water aloft
          var nsr = e.str.length;
          var alive2 = false;

          for (var si = 0; si < nsr; si++) {
            var st = e.str[si];
            ropeN[si] = 0;
            var ang = e.aim + st.da + Math.sin(t * st.wf + st.wp) * 0.03;
            var vv = e.v0 * vsc * st.dv;
            var vx0 = Math.cos(ang) * vv + kvx * 0.6;
            var vy0 = Math.sin(ang) * vv + kvy * 0.6;
            // how long this water needs to come back down to the lawn
            var sg = (Math.sqrt(vy0 * vy0 + 2 * G * Math.max(1, gy0 - sy)) - vy0) / G;
            var sEnd = Math.min(sTop, sg);
            if (sEnd <= sBeg) continue;
            alive2 = true;
            var base = si * (SK + 1), ds = (sEnd - sBeg) / SK, k2, s2;
            for (k2 = 0; k2 <= SK; k2++) {
              s2 = sBeg + ds * k2;
              ropeX[base + k2] = sx + vx0 * s2;
              ropeY[base + k2] = sy + vy0 * s2 + 0.5 * G * s2 * s2;
            }
            ropeN[si] = SK + 1;

            // the crest frays: a little water leaves the rope as spray
            st.frq -= dt;
            if (st.frq <= 0 && sEnd > 0.3) {
              st.frq = rand(0.07, 0.19);
              var sfr = sBeg + (sEnd - sBeg) * rand(0.45, 1);
              spawnDrop(sx + vx0 * sfr + rand(-2, 2) * U,
                        sy + vy0 * sfr + 0.5 * G * sfr * sfr,
                        vx0 * rand(0.85, 1.1) + rand(-14, 14) * U,
                        (vy0 + G * sfr) * rand(0.85, 1.05) + rand(-14, 14) * U,
                        Math.random() < 0.3, false);
            }

            // a rope standing on the lawn keeps that patch of grass wet,
            // rings it, and throws a little of itself back up
            if (sEnd >= sg) {
              var fx = sx + vx0 * sg;
              var vyf = vy0 + G * sg;
              var imp2 = clamp(Math.hypot(vx0, vyf) / (h * 0.9), 0.2, 1);
              wetGrass(fx, imp2, dt * 1.7);
              st.spl -= dt;
              if (st.spl <= 0) {
                st.spl = rand(0.12, 0.26);
                addSplash(fx, groundY(fx), imp2);
              }
              st.brk -= dt;
              if (st.brk <= 0) {
                st.brk = rand(0.06, 0.16);
                spawnDrop(fx, groundY(fx) - 3 * U, vx0 * 0.3 + rand(-26, 26) * U,
                          -Math.abs(vyf) * 0.22, Math.random() < 0.35, true);
              }
            }
          }
          if (!alive2) { // the last of it has landed
            if (e.eEnd >= 0) e.life = Math.min(e.life, e.age + 0.2);
            continue;
          }

          // every rope of this plume, painted in six batched passes
          var bw = (4.2 + 2.2 * flow) * U * (0.5 + 0.5 * gs);
          for (var p2 = 0; p2 < 6; p2++) {
            ctx.lineWidth = bw * RW[p2];
            ctx.strokeStyle = RC[p2] + RA[p2] * al * (p2 === 5 ? flow : 1) + ')';
            ctx.beginPath();
            for (si = 0; si < nsr; si++) {
              var n2 = ropeN[si];
              if (n2 < 2) continue;
              var i0 = (n2 * RF[p2]) | 0;
              var i1 = Math.ceil(n2 * RT[p2]);
              if (i1 > n2) i1 = n2;
              if (i1 - i0 < 2) continue;
              var b3 = si * (SK + 1);
              ctx.moveTo(ropeX[b3 + i0], ropeY[b3 + i0]);
              for (var k3 = i0 + 1; k3 < i1; k3++) ctx.lineTo(ropeX[b3 + k3], ropeY[b3 + k3]);
            }
            ctx.stroke();
          }

          // the nozzle itself: a small pool of deep blue light
          if (flow > 0.02) {
            var hr = (4.5 + 3.5 * flow) * U * gs;
            ctx.fillStyle = 'rgba(40,110,215,' + 0.09 * al * flow + ')';
            ctx.beginPath();
            ctx.arc(sx, sy, hr * 1.7, 0, TAU);
            ctx.fill();
            ctx.fillStyle = 'rgba(160,210,255,' + 0.22 * al * flow + ')';
            ctx.beginPath();
            ctx.arc(sx, sy, hr * 0.5, 0, TAU);
            ctx.fill();
          }
        }

        // droplets: plain ballistics, a little air drag, and the lawn below
        var air = Math.max(0, 1 - 0.55 * dt);
        for (i = 0; i < drops.length; i++) {
          var d = drops[i];
          if (!d.alive) { dGrp[i] = 255; continue; }
          d.age += dt;
          d.vy += G * dt;
          d.vx *= air; d.vy *= air;
          d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.age >= d.life || d.x < -20 || d.x > w + 20) {
            d.alive = false; dLive--; dGrp[i] = 255; continue;
          }
          var gy = groundY(d.x);
          if (d.y >= gy) {
            d.alive = false; dLive--; dGrp[i] = 255;
            var imp = clamp(Math.hypot(d.vx, d.vy) / (h * 0.85), 0.15, 1);
            if (Math.random() < 0.4) addSplash(d.x, gy, imp); // not every drop rings
            wetGrass(d.x, imp, 0.6);
            if (!d.bounced && imp > 0.35 && Math.random() < 0.45) { // a scatter
              spawnDrop(d.x, gy - 2 * U, d.vx * 0.28 + rand(-20, 20) * U,
                        -Math.abs(d.vy) * 0.26, false, true);
            }
            continue;
          }
          var f = Math.min(1, d.age / 0.06) * Math.min(1, (d.life - d.age) / 0.45);
          dGrp[i] = (f > 0.66 ? 4 : f > 0.33 ? 2 : 0) + (d.big ? 1 : 0);
        }

        // spray, drawn as short round-capped streaks: halo and core per group
        for (var g2 = 0; g2 < 6; g2++) {
          var big = (g2 & 1) === 1;
          var ga = TIER[g2];
          for (var lay = 0; lay < 2; lay++) {
            ctx.strokeStyle = lay === 0
              ? 'rgba(34,96,205,' + 0.17 * ga + ')'
              : 'rgba(150,205,255,' + 0.50 * ga + ')';
            ctx.lineWidth = (lay === 0 ? (big ? 6.5 : 4.2) : (big ? 2.3 : 1.5)) * U;
            ctx.beginPath();
            for (i = 0; i < drops.length; i++) {
              if (dGrp[i] !== g2) continue;
              var d2 = drops[i];
              ctx.moveTo(d2.x - d2.vx * 0.030, d2.y - d2.vy * 0.030);
              ctx.lineTo(d2.x, d2.y);
            }
            ctx.stroke();
          }
        }

        // where they land: a flat ring opening out through the blades
        for (i = 0; i < spl.length; i++) {
          var s = spl[i];
          if (!s.alive) continue;
          s.age += dt;
          if (s.age >= s.life) { s.alive = false; continue; }
          var sf = s.age / s.life;
          var sr = (2.5 + 9 * sf) * U * (0.5 + 0.7 * s.p);
          ctx.strokeStyle = 'rgba(96,178,242,' + 0.16 * (1 - sf) * (1 - sf) * s.p + ')';
          ctx.lineWidth = 1.1 * U;
          ctx.beginPath();
          ctx.ellipse(s.x, s.y, sr, sr * 0.26, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

/* ------------------------------------------------------------------
     10. Ink Eddy — the screen is a still, dark pond of invisible water.
        A gesture injects glowing ink AND momentum into a real PIC/FLIP
        fluid: the dam_builder water core with gravity, terrain and the
        free surface taken out, only the banks left as solids, and a
        gentle global damping added so the pond always forgets. Nothing
        below draws a spiral — the curls, the ribbons rolling up along
        their own shear and the mushrooming jets are simply what
        incompressible flow does with the impulse it was handed. Only
        the ink is drawn; the carrier lattice that does the physics is
        invisible, and when the last ink dies and the water goes still
        the whole simulation sleeps.
  ------------------------------------------------------------------ */
  function inkEddy() {
    var AIR = 0, FLUID = 1, SOLID = 2;

    /* transplanted unchanged from dam_builder's water — these numbers
       encode a lot of real debugging and are not worth re-deriving */
    var FLIP = 0.9;       // PIC/FLIP blend (1 = pure FLIP: lively but noisy)
    var SOR = 1.6;        // over-relaxation on the Gauss-Seidel pressure solve
    var SEP = 0.95;       // push-apart rest distance, in lattice pitches
    var SEP_IT = 2;
    var DRIFT = 0.02;     // density-drift compensation: stops slow compression
    var MOVE_FRAC = 0.5;  // max advection per substep, in particle radii (CFL)
    var MAX_SUB = 6;
    /* and the adaptations: no gravity, no hydrostatic ramp to converge, so
       the warm start carries a much shorter solve */
    var P_ITERS = 18;
    var WALL_KEEP = 0.86; // tangential velocity kept at the banks
    var R_FRAC = 0.46;    // particle radius / lattice pitch
    var DAMP = 0.45;      // 1/s: the pond settles back to glass in a few seconds
    var VMAX = 1200;      // px/s explosion guard
    var SLEEP_V = 3;      // px/s: below this, with no ink left, the sim stops
    var LO_PEAK = 1.6487; // e^0.5 — a Lamb-Oseen swirl has w(0) = spin*e^0.5/sigma

    var f = null, bg = null, first = true, asleep = true;
    var motes = [];
    var holding = false, holdSig = 30, holdX = 0, holdY = 0, holdHue = 1;
    var spinDir = 1, inkAcc = 0, lastCast = -99;

    /* Ink: passive tracers, the only thing that is ever drawn. A tracer is
       not a dot — it carries its own STREAKLINE, the last stretch of the path
       it has actually travelled, resampled by arc length, and it is drawn as
       one smooth curve through those points. Neighbouring tracers inside an
       arm therefore lay down near-parallel filaments and the arm reads as
       silk pulled through water rather than as a chain of beads. */
    var TRAIL = 13;       // stored points behind the head
    var kcap = 0, kn = 0, kcur = 0;
    var kx = null, ky = null;                 // head
    var ttx = null, tty = null;               // streakline rings, kcap * TRAIL
    var khead = null, klen = null;            // ring head index, points held
    var kmax = null;      // and how long THIS filament is allowed to grow
    var kage = null, klife = null;
    var khue = null, ktier = null, klum = null;
    var kstep = 4;        // px of travelled path between stored points

    // drawing order: the ink is bucketed by (colour, luminance) once a frame
    var sortIdx = null, bStart = null, bCur = null;
    // and a coarse census of ink per cell, so a dense core can burn while the
    // fringe that has spread out of it stays deep and faint
    var dgx = 0, dgy = 0, dgrid = null;
    var DG = 20, D_REF = 7;

    /* Five nocturnal inks, ordered cool -> warm. A gesture picks one by a slow
       random walk biased hard to the cool end, so the pond's colour drifts
       over a session — teal most of the time, an ember bloom now and then —
       instead of flickering from cast to cast. Each ink is a six-step ramp
       from a near-black saturated base to a bright tinted core, and under
       'lighter' that ramp IS the contrast: dye that has aged and dispersed
       barely lifts off the water, dye that is fresh and packed blazes. */
    var NL = 6, NH = 5, NB = NH * NL;
    var INK = [
      ['10,52,58', '14,82,94', '24,122,136', '54,168,178', '118,204,210', '200,240,244'],
      ['22,36,94', '36,62,144', '58,98,190', '98,144,224', '152,190,240', '218,236,252'],
      ['44,24,88', '68,40,128', '102,64,172', '140,104,202', '184,158,228', '228,220,248'],
      ['68,16,52', '104,28,72', '150,50,98', '196,92,132', '230,152,178', '250,216,228'],
      ['64,34,12', '104,60,20', '150,98,36', '198,144,68', '230,188,124', '250,230,200']
    ];
    /* the ramp is steep on purpose — a 20x alpha range and a width that
       narrows as it brightens, so every arm is a broad deep body with a
       hair-thin lit core running down the middle of it */
    var INK_A = [0.016, 0.028, 0.048, 0.080, 0.132, 0.235];
    var INK_W = [5.2, 4.1, 3.2, 2.4, 1.7, 1.1];
    /* how much of a filament each band is allowed to cover, measured back from
       the head. The deep wide tones run the whole streak, the bright core only
       the newest third of it, so every filament tapers out of a lit head into
       a tail that sinks into the water — dye trailing off, not a lit dash. */
    var INK_T = [1, 1, 0.9, 0.78, 0.64, 0.5];
    var BODY_A = 0.012, BODY_W = 7.5; // the diffuse wash the filaments sit in
    var INK_S = [], BODY_S = [], hueIdx = 1;
    (function () {
      for (var q = 0; q < NH; q++) {
        BODY_S.push('rgba(' + INK[q][2] + ',' + BODY_A + ')');
        for (var l = 0; l < NL; l++) INK_S.push('rgba(' + INK[q][l] + ',' + INK_A[l] + ')');
      }
    })();

    /* ---- the fluid: a MAC grid plus an invisible carrier lattice ------
       Index conventions, column-major, exactly as in the original:
         cell  c = ix*ny + iy
         u face  = ix*ny + iy         (vertical faces,  ix in [0,nx])
         v face  = ix*(ny+1) + iy     (horizontal faces, iy in [0,ny])   */

    function makeFluid(W, H) {
      var s = clamp(Math.sqrt((W * H) / 2400), 9, 18); // lattice pitch, px
      var gh = s * 1.5;                                // cell size, px
      var nx = Math.ceil(W / gh) + 2;                  // +2: one solid border
      var ny = Math.ceil(H / gh) + 2;                  //     cell all the way round
      var nc = nx * ny;
      var iw = (nx - 2) * gh, ih = (ny - 2) * gh;      // the wet interior, from 0
      var cols = Math.max(2, Math.round(iw / s));
      var rows = Math.max(2, Math.round(ih / s));
      var n = cols * rows;
      var o = {
        h: gh, invH: 1 / gh, x0: -gh, y0: -gh, nx: nx, ny: ny, nc: nc,
        iw: iw, ih: ih, s: s, radius: s * R_FRAC,
        restDens: (gh * gh) / (s * s),
        n: n,
        px: new Float32Array(n), py: new Float32Array(n),
        vx: new Float32Array(n), vy: new Float32Array(n),
        u: new Float32Array((nx + 1) * ny), uPre: new Float32Array((nx + 1) * ny),
        uw: new Float32Array((nx + 1) * ny), uOk: new Uint8Array((nx + 1) * ny),
        v: new Float32Array(nx * (ny + 1)), vPre: new Float32Array(nx * (ny + 1)),
        vw: new Float32Array(nx * (ny + 1)), vOk: new Uint8Array(nx * (ny + 1)),
        p: new Float32Array(nc),          // PERSISTS between frames (warm start)
        div: new Float32Array(nc), dens: new Float32Array(nc),
        type: new Uint8Array(nc), solid: new Uint8Array(nc), kcnt: new Uint8Array(nc),
        list: new Int32Array(nc), fcount: 0, air: 0,
        binStart: new Int32Array(nc + 1), binIdx: new Int32Array(n),
        binCur: new Int32Array(nc),
        maxSpeed: 0
      };
      var i, j;
      for (i = 0; i < nx; i++) {
        for (j = 0; j < ny; j++) {
          o.solid[i * ny + j] = (i === 0 || i === nx - 1 || j === 0 || j === ny - 1) ? 1 : 0;
        }
      }
      // the carrier lattice fills the interior exactly: pitch is also the
      // push-apart rest distance, so the pond starts already relaxed
      var sx = iw / cols, sy = ih / rows, k = 0;
      for (i = 0; i < cols; i++) {
        for (j = 0; j < rows; j++) {
          o.px[k] = (i + 0.5) * sx + rand(-0.04, 0.04) * s;
          o.py[k] = (j + 0.5) * sy + rand(-0.04, 0.04) * s;
          k++;
        }
      }
      return o;
    }

    function stillness(o) {
      o.vx.fill(0); o.vy.fill(0);
      o.u.fill(0); o.v.fill(0); o.uPre.fill(0); o.vPre.fill(0);
      o.p.fill(0);
      o.maxSpeed = 0;
    }

    /* A gesture is a paddle. Inside a Gaussian patch the water is blended
       toward a target motion — a Lamb-Oseen swirl of peak tangential speed
       `spin`, plus a uniform push (ax, ay) — with `k` how hard it bites.
       Blending toward a target rather than adding impulses is what keeps a
       long hold from winding itself into a runaway. */
    function stir(o, cx, cy, sig, spin, ax, ay, k) {
      var n = o.n, invS2 = 1 / (sig * sig), reach = sig * 2.6;
      var r2 = reach * reach;
      for (var i = 0; i < n; i++) {
        var dx = o.px[i] - cx, dy = o.py[i] - cy;
        var d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        var q2 = d2 * invS2;                       // (d/sig)^2
        // the push is a plain Gaussian blob: incompressibility turns it into a
        // vortex ring by itself, which is where the mushroom comes from
        var gp = Math.exp(-0.5 * q2) * k;
        var vx = ax * gp, vy = ay * gp;
        if (spin !== 0 && d2 > 1e-6) {
          /* the swirl gets a FLAT-TOPPED weight instead of that Gaussian.
             Multiplying a Lamb-Oseen profile by a Gaussian falloff squeezes
             the eddy into a thin ring and roughly halves how fast it turns —
             the vortex then never visibly winds the dye at all, which is the
             one thing this effect exists to show. */
          var q6 = q2 * q2 * q2;
          var gs = Math.exp(-q6 / 16.44) * k;      // ~1 out to q=1.2, gone by 2.2
          var d = Math.sqrt(d2), q = d / sig;
          var tg = spin * q * Math.exp(0.5 - 0.5 * q2) * gs;
          vx -= dy / d * tg;
          vy += dx / d * tg;
          o.vx[i] += vx - o.vx[i] * Math.max(gp, gs);
          o.vy[i] += vy - o.vy[i] * Math.max(gp, gs);
          continue;
        }
        o.vx[i] += vx - o.vx[i] * gp;
        o.vy[i] += vy - o.vy[i] * gp;
      }
    }

    function step(o, dt) {
      var n = o.n, i;
      // CFL: never advect more than a fraction of a particle radius per substep
      var vmax = 0;
      for (i = 0; i < n; i++) {
        var sp = Math.abs(o.vx[i]) + Math.abs(o.vy[i]);
        if (sp > vmax) vmax = sp;
      }
      o.maxSpeed = vmax;
      var sub = Math.ceil((vmax * dt) / Math.max(1e-3, MOVE_FRAC * o.radius));
      if (sub < 1) sub = 1; else if (sub > MAX_SUB) sub = MAX_SUB;
      var hs = dt / sub, dmp = Math.exp(-DAMP * hs);
      for (i = 0; i < sub; i++) { integrate(o, hs, dmp); collide(o); }
      bins(o);
      for (i = 0; i < SEP_IT; i++) pushApart(o);
      collide(o);
      p2g(o);
      classify(o);
      solve(o, dt);
      g2p(o);
    }

    function integrate(o, dt, dmp) {
      var n = o.n, px = o.px, py = o.py, vx = o.vx, vy = o.vy;
      for (var i = 0; i < n; i++) {
        var ux = vx[i] * dmp, uy = vy[i] * dmp;
        var sp = Math.abs(ux) + Math.abs(uy);
        if (sp > VMAX) { var k = VMAX / sp; ux *= k; uy *= k; }
        vx[i] = ux; vy[i] = uy;
        px[i] += ux * dt;
        py[i] += uy * dt;
      }
    }

    // the banks: the only solids left in the port
    function collide(o) {
      var n = o.n, r = o.radius, keep = WALL_KEEP;
      var hiX = o.iw - r, hiY = o.ih - r;
      var px = o.px, py = o.py, vx = o.vx, vy = o.vy;
      for (var i = 0; i < n; i++) {
        var x = px[i], y = py[i];
        if (x < r) { x = r; if (vx[i] < 0) { vx[i] = 0; vy[i] *= keep; } }
        else if (x > hiX) { x = hiX; if (vx[i] > 0) { vx[i] = 0; vy[i] *= keep; } }
        if (y < r) { y = r; if (vy[i] < 0) { vy[i] = 0; vx[i] *= keep; } }
        else if (y > hiY) { y = hiY; if (vy[i] > 0) { vy[i] = 0; vx[i] *= keep; } }
        px[i] = x; py[i] = y;
      }
    }

    // counting sort into cells: no allocation, no hashing
    function bins(o) {
      var n = o.n, nc = o.nc, ny = o.ny, nx = o.nx;
      var start = o.binStart, idx = o.binIdx, cur = o.binCur, c, i, ix, iy;
      start.fill(0);
      for (i = 0; i < n; i++) {
        ix = Math.floor((o.px[i] - o.x0) * o.invH);
        iy = Math.floor((o.py[i] - o.y0) * o.invH);
        if (ix < 0) ix = 0; else if (ix > nx - 1) ix = nx - 1;
        if (iy < 0) iy = 0; else if (iy > ny - 1) iy = ny - 1;
        start[ix * ny + iy + 1]++;
      }
      for (c = 0; c < nc; c++) start[c + 1] += start[c];
      for (c = 0; c < nc; c++) cur[c] = start[c];
      for (i = 0; i < n; i++) {
        ix = Math.floor((o.px[i] - o.x0) * o.invH);
        iy = Math.floor((o.py[i] - o.y0) * o.invH);
        if (ix < 0) ix = 0; else if (ix > nx - 1) ix = nx - 1;
        if (iy < 0) iy = 0; else if (iy > ny - 1) iy = ny - 1;
        idx[cur[ix * ny + iy]++] = i;
      }
    }

    // keeps the lattice from clumping, which is what the pressure solve
    // would otherwise fight with big, boiling corrections
    function pushApart(o) {
      var n = o.n, minD = o.s * SEP, minD2 = minD * minD;
      var px = o.px, py = o.py, start = o.binStart, idx = o.binIdx;
      var nx = o.nx, ny = o.ny;
      for (var i = 0; i < n; i++) {
        var ix = Math.floor((px[i] - o.x0) * o.invH);
        var iy = Math.floor((py[i] - o.y0) * o.invH);
        if (ix < 0) ix = 0; else if (ix > nx - 1) ix = nx - 1;
        if (iy < 0) iy = 0; else if (iy > ny - 1) iy = ny - 1;
        var xa = ix > 0 ? ix - 1 : 0, xb = ix < nx - 1 ? ix + 1 : nx - 1;
        var ya = iy > 0 ? iy - 1 : 0, yb = iy < ny - 1 ? iy + 1 : ny - 1;
        for (var cx = xa; cx <= xb; cx++) {
          for (var cy = ya; cy <= yb; cy++) {
            var c = cx * ny + cy;
            for (var k = start[c], e = start[c + 1]; k < e; k++) {
              var j = idx[k];
              if (j === i) continue;
              var dx = px[j] - px[i], dy = py[j] - py[i];
              var d2 = dx * dx + dy * dy;
              if (d2 > minD2 || d2 < 1e-12) continue;
              var d = Math.sqrt(d2), sc = (0.5 * (minD - d)) / d;
              dx *= sc; dy *= sc;
              px[i] -= dx; py[i] -= dy;
              px[j] += dx; py[j] += dy;
            }
          }
        }
      }
    }

    function p2g(o) {
      var n = o.n, nx = o.nx, ny = o.ny, invH = o.invH, i;
      o.u.fill(0); o.uw.fill(0); o.v.fill(0); o.vw.fill(0); o.dens.fill(0);
      for (i = 0; i < n; i++) {
        var gx = (o.px[i] - o.x0) * invH, gy = (o.py[i] - o.y0) * invH;
        var fx, fy, i0, j0, tx, ty, a, b, w00, w10, w01, w11, val;
        // u faces, sampled at (gx, gy-0.5)
        fx = gx; fy = gy - 0.5;
        i0 = Math.floor(fx); j0 = Math.floor(fy);
        if (i0 < 0) i0 = 0; else if (i0 > nx - 1) i0 = nx - 1;
        if (j0 < 0) j0 = 0; else if (j0 > ny - 2) j0 = ny - 2;
        tx = fx - i0; ty = fy - j0;
        w00 = (1 - tx) * (1 - ty); w10 = tx * (1 - ty);
        w01 = (1 - tx) * ty; w11 = tx * ty;
        a = i0 * ny + j0; b = a + ny;
        val = o.vx[i];
        o.u[a] += val * w00; o.uw[a] += w00;
        o.u[b] += val * w10; o.uw[b] += w10;
        o.u[a + 1] += val * w01; o.uw[a + 1] += w01;
        o.u[b + 1] += val * w11; o.uw[b + 1] += w11;
        // v faces, sampled at (gx-0.5, gy)
        fx = gx - 0.5; fy = gy;
        i0 = Math.floor(fx); j0 = Math.floor(fy);
        if (i0 < 0) i0 = 0; else if (i0 > nx - 2) i0 = nx - 2;
        if (j0 < 0) j0 = 0; else if (j0 > ny - 1) j0 = ny - 1;
        tx = fx - i0; ty = fy - j0;
        w00 = (1 - tx) * (1 - ty); w10 = tx * (1 - ty);
        w01 = (1 - tx) * ty; w11 = tx * ty;
        a = i0 * (ny + 1) + j0; b = a + (ny + 1);
        val = o.vy[i];
        o.v[a] += val * w00; o.vw[a] += w00;
        o.v[b] += val * w10; o.vw[b] += w10;
        o.v[a + 1] += val * w01; o.vw[a + 1] += w01;
        o.v[b + 1] += val * w11; o.vw[b + 1] += w11;
        // cell density: weights sum to 1 per particle
        fx = gx - 0.5; fy = gy - 0.5;
        i0 = Math.floor(fx); j0 = Math.floor(fy);
        if (i0 < 0) i0 = 0; else if (i0 > nx - 2) i0 = nx - 2;
        if (j0 < 0) j0 = 0; else if (j0 > ny - 2) j0 = ny - 2;
        tx = fx - i0; ty = fy - j0;
        a = i0 * ny + j0; b = a + ny;
        o.dens[a] += (1 - tx) * (1 - ty);
        o.dens[b] += tx * (1 - ty);
        o.dens[a + 1] += (1 - tx) * ty;
        o.dens[b + 1] += tx * ty;
      }
      var un = o.u.length, vn = o.v.length;
      for (i = 0; i < un; i++) if (o.uw[i] > 0) o.u[i] /= o.uw[i];
      for (i = 0; i < vn; i++) if (o.vw[i] > 0) o.v[i] /= o.vw[i];
      o.uPre.set(o.u);
      o.vPre.set(o.v);
    }

    function classify(o) {
      var nx = o.nx, ny = o.ny, t = o.type, n = o.n, c, i, j;
      for (c = 0; c < o.nc; c++) t[c] = o.solid[c] ? SOLID : AIR;
      for (i = 0; i < n; i++) {
        var ix = Math.floor((o.px[i] - o.x0) * o.invH);
        var iy = Math.floor((o.py[i] - o.y0) * o.invH);
        if (ix < 0) ix = 0; else if (ix > nx - 1) ix = nx - 1;
        if (iy < 0) iy = 0; else if (iy > ny - 1) iy = ny - 1;
        c = ix * ny + iy;
        if (t[c] === AIR) t[c] = FLUID;
      }
      var fc = 0, air = 0;
      for (i = 1; i < nx - 1; i++) {
        var base = i * ny;
        for (j = 1; j < ny - 1; j++) {
          c = base + j;
          if (t[c] !== FLUID) { o.p[c] = 0; air++; continue; }
          var k = 0;
          if (t[c - ny] !== SOLID) k++;
          if (t[c + ny] !== SOLID) k++;
          if (t[c - 1] !== SOLID) k++;
          if (t[c + 1] !== SOLID) k++;
          o.kcnt[c] = k;
          if (k === 0) { o.p[c] = 0; continue; }
          o.list[fc++] = c;
        }
      }
      o.fcount = fc;
      o.air = air;
    }

    // warm-started Gauss-Seidel (SOR) pressure Poisson, then projection
    function solve(o, dt) {
      var nx = o.nx, ny = o.ny, gh = o.h;
      var t = o.type, u = o.u, v = o.v, p = o.p, div = o.div;
      var list = o.list, fc = o.fcount;
      var i, c, ix, iy, base, iu, iv;
      // no-flux: solid faces carry no flow
      for (ix = 0; ix < nx; ix++) {
        base = ix * ny;
        for (iy = 0; iy < ny; iy++) {
          c = base + iy;
          if (t[c] !== SOLID) continue;
          u[base + iy] = 0;
          u[base + ny + iy] = 0;
          v[ix * (ny + 1) + iy] = 0;
          v[ix * (ny + 1) + iy + 1] = 0;
        }
      }
      var hdt = gh / dt;
      for (i = 0; i < fc; i++) {
        c = list[i];
        ix = (c / ny) | 0; iy = c - ix * ny;
        iu = c; iv = ix * (ny + 1) + iy;
        var D = u[iu + ny] - u[iu] + v[iv + 1] - v[iv];
        var comp = o.dens[c] / o.restDens - 1;
        if (comp > 0) D -= DRIFT * comp * hdt;
        div[c] = D * hdt;
      }
      for (var it = 0; it < P_ITERS; it++) {
        for (i = 0; i < fc; i++) {
          c = list[i];
          var sum = 0;
          if (t[c - ny] !== SOLID) sum += p[c - ny];
          if (t[c + ny] !== SOLID) sum += p[c + ny];
          if (t[c - 1] !== SOLID) sum += p[c - 1];
          if (t[c + 1] !== SOLID) sum += p[c + 1];
          p[c] += SOR * ((sum - div[c]) / o.kcnt[c] - p[c]);
        }
      }
      /* A closed pond has no free surface, so unlike the dam the Poisson
         problem here is all-Neumann: pressure is only fixed up to a constant,
         and warm-started sweeps would let that constant walk off to infinity
         and eat the float32 precision the gradients live in. The gradient is
         what we project with and it is untouched by a constant, so simply
         re-center the field. Skipped whenever a cell has gone empty: such a
         cell is a p=0 anchor that must not be shifted. */
      if (o.air === 0 && fc > 0) {
        var mean = 0;
        for (i = 0; i < fc; i++) mean += p[list[i]];
        mean /= fc;
        for (i = 0; i < fc; i++) p[list[i]] -= mean;
      }
      // project: every face with a fluid side, exactly once
      var scale = dt / gh;
      for (i = 0; i < fc; i++) {
        c = list[i];
        ix = (c / ny) | 0; iy = c - ix * ny;
        iu = c; iv = ix * (ny + 1) + iy;
        var pc = p[c];
        var tl = t[c - ny], tr = t[c + ny], tb = t[c - 1], tt = t[c + 1];
        if (tl !== SOLID) u[iu] -= scale * (pc - (tl === FLUID ? p[c - ny] : 0));
        if (tb !== SOLID) v[iv] -= scale * (pc - (tb === FLUID ? p[c - 1] : 0));
        if (tr === AIR) u[iu + ny] -= scale * (0 - pc);
        if (tt === AIR) v[iv + 1] -= scale * (0 - pc);
      }
    }

    function g2p(o) {
      var n = o.n, nx = o.nx, ny = o.ny, invH = o.invH, t = o.type;
      var ix, iy, idx, i;
      // a face is usable if one of its two cells holds fluid
      for (ix = 0; ix <= nx; ix++) {
        for (iy = 0; iy < ny; iy++) {
          idx = ix * ny + iy;
          var l = ix > 0 ? t[(ix - 1) * ny + iy] : SOLID;
          var r = ix < nx ? t[ix * ny + iy] : SOLID;
          o.uOk[idx] = (l === FLUID || r === FLUID) ? 1 : 0;
        }
      }
      for (ix = 0; ix < nx; ix++) {
        for (iy = 0; iy <= ny; iy++) {
          idx = ix * (ny + 1) + iy;
          var bb = iy > 0 ? t[ix * ny + iy - 1] : SOLID;
          var aa = iy < ny ? t[ix * ny + iy] : SOLID;
          o.vOk[idx] = (aa === FLUID || bb === FLUID) ? 1 : 0;
        }
      }
      var pic = 1 - FLIP;
      for (i = 0; i < n; i++) {
        var gx = (o.px[i] - o.x0) * invH, gy = (o.py[i] - o.y0) * invH;
        var fx, fy, i0, j0, tx, ty, a, b, w0, w1, w2, w3, v0, v1, v2, v3, ws, cur, old;
        fx = gx; fy = gy - 0.5;
        i0 = Math.floor(fx); j0 = Math.floor(fy);
        if (i0 < 0) i0 = 0; else if (i0 > nx - 1) i0 = nx - 1;
        if (j0 < 0) j0 = 0; else if (j0 > ny - 2) j0 = ny - 2;
        tx = fx - i0; ty = fy - j0;
        a = i0 * ny + j0; b = a + ny;
        w0 = (1 - tx) * (1 - ty); w1 = tx * (1 - ty); w2 = (1 - tx) * ty; w3 = tx * ty;
        v0 = o.uOk[a]; v1 = o.uOk[b]; v2 = o.uOk[a + 1]; v3 = o.uOk[b + 1];
        ws = v0 * w0 + v1 * w1 + v2 * w2 + v3 * w3;
        if (ws > 0) {
          cur = (v0 * w0 * o.u[a] + v1 * w1 * o.u[b] + v2 * w2 * o.u[a + 1] + v3 * w3 * o.u[b + 1]) / ws;
          old = (v0 * w0 * o.uPre[a] + v1 * w1 * o.uPre[b] + v2 * w2 * o.uPre[a + 1] + v3 * w3 * o.uPre[b + 1]) / ws;
          o.vx[i] = pic * cur + FLIP * (o.vx[i] + cur - old);
        }
        fx = gx - 0.5; fy = gy;
        i0 = Math.floor(fx); j0 = Math.floor(fy);
        if (i0 < 0) i0 = 0; else if (i0 > nx - 2) i0 = nx - 2;
        if (j0 < 0) j0 = 0; else if (j0 > ny - 1) j0 = ny - 1;
        tx = fx - i0; ty = fy - j0;
        a = i0 * (ny + 1) + j0; b = a + (ny + 1);
        w0 = (1 - tx) * (1 - ty); w1 = tx * (1 - ty); w2 = (1 - tx) * ty; w3 = tx * ty;
        v0 = o.vOk[a]; v1 = o.vOk[b]; v2 = o.vOk[a + 1]; v3 = o.vOk[b + 1];
        ws = v0 * w0 + v1 * w1 + v2 * w2 + v3 * w3;
        if (ws > 0) {
          cur = (v0 * w0 * o.v[a] + v1 * w1 * o.v[b] + v2 * w2 * o.v[a + 1] + v3 * w3 * o.v[b + 1]) / ws;
          old = (v0 * w0 * o.vPre[a] + v1 * w1 * o.vPre[b] + v2 * w2 * o.vPre[a + 1] + v3 * w3 * o.vPre[b + 1]) / ws;
          o.vy[i] = pic * cur + FLIP * (o.vy[i] + cur - old);
        }
      }
    }

    function sampleU(o, x, y) {
      var nx = o.nx, ny = o.ny;
      var fx = (x - o.x0) * o.invH, fy = (y - o.y0) * o.invH - 0.5;
      var i0 = Math.floor(fx), j0 = Math.floor(fy);
      if (i0 < 0) i0 = 0; else if (i0 > nx - 1) i0 = nx - 1;
      if (j0 < 0) j0 = 0; else if (j0 > ny - 2) j0 = ny - 2;
      var tx = fx - i0, ty = fy - j0, a = i0 * ny + j0, b = a + ny;
      return (1 - tx) * (1 - ty) * o.u[a] + tx * (1 - ty) * o.u[b] +
             (1 - tx) * ty * o.u[a + 1] + tx * ty * o.u[b + 1];
    }

    function sampleV(o, x, y) {
      var nx = o.nx, ny = o.ny;
      var fx = (x - o.x0) * o.invH - 0.5, fy = (y - o.y0) * o.invH;
      var i0 = Math.floor(fx), j0 = Math.floor(fy);
      if (i0 < 0) i0 = 0; else if (i0 > nx - 2) i0 = nx - 2;
      if (j0 < 0) j0 = 0; else if (j0 > ny - 1) j0 = ny - 1;
      var tx = fx - i0, ty = fy - j0, a = i0 * (ny + 1) + j0, b = a + (ny + 1);
      return (1 - tx) * (1 - ty) * o.v[a] + tx * (1 - ty) * o.v[b] +
             (1 - tx) * ty * o.v[a + 1] + tx * ty * o.v[b + 1];
    }

    // ---- ink ----------------------------------------------------------

    function addInk(x, y, life, hue) {
      var j;
      if (kn < kcap) j = kn++;
      else { j = kcur++; if (kcur >= kcap) kcur = 0; } // recycle round-robin
      kx[j] = x; ky[j] = y;
      kage[j] = 0; klife[j] = life;
      khue[j] = hue; ktier[j] = 0; klum[j] = 0;
      /* the streakline is seeded one step behind at a free angle, so a tracer
         is a short thread from its very first frame and never a bead */
      var a = rand(0, TAU), b = j * TRAIL;
      ttx[b] = x - Math.cos(a) * kstep * 0.9;
      tty[b] = y - Math.sin(a) * kstep * 0.9;
      khead[j] = 0; klen[j] = 1;
      /* filaments of one uniform length all end on the same contour and the
         arm reads as hatching; letting each run out at its own length is what
         makes the edge of a swirl dissolve instead of stop */
      kmax[j] = 2 + Math.round((TRAIL - 2) * rand(0.3, 1));
    }
    // a smear of ink along a segment, so a drag lays a continuous ribbon
    function inkSeg(ax, ay, bx, by, rad, count, life, hue) {
      for (var i = 0; i < count; i++) {
        var u = Math.random(), a = rand(0, TAU), rr = rad * Math.sqrt(Math.random());
        /* only a light jitter on the lifetime: neighbouring tracers that fade
           far apart land in different luminance bands and mottle what should
           read as one body of dye */
        addInk(ax + (bx - ax) * u + Math.cos(a) * rr,
               ay + (by - ay) * u + Math.sin(a) * rr,
               life * rand(0.87, 1.13), hue);
      }
    }

    /* One tracer's streakline as a single smooth curve. The stored points are
       a resampling of a curved path, so the curve is laid through their
       MIDPOINTS with each stored point as the control handle: that removes
       every corner the resampling introduced and is what turns a chain of
       samples into an unbroken filament. */
    function inkPath(ctx, i, frac) {
      var b = i * TRAIL, c = klen[i], j = khead[i];
      if (frac < 1) { c = (c * frac + 0.5) | 0; if (c < 1) c = 1; }
      var ax = ttx[b + j], ay = tty[b + j], k, nx2, ny2;
      ctx.moveTo(kx[i], ky[i]);
      if (c < 2) { ctx.lineTo(ax, ay); return; }
      for (k = 1; k < c; k++) {
        j--; if (j < 0) j = TRAIL - 1;
        nx2 = ttx[b + j]; ny2 = tty[b + j];
        ctx.quadraticCurveTo(ax, ay, (ax + nx2) * 0.5, (ay + ny2) * 0.5);
        ax = nx2; ay = ny2;
      }
      ctx.lineTo(ax, ay);
    }

    /* the ink colour walks the palette instead of jumping: one step per
       GESTURE (a drag keeps the colour it started with), biased downward so
       the pond lives in teal and blue and only rarely reaches the warm end */
    function nextHue() {
      var r = Math.random();
      if (r < 0.36) hueIdx--; else if (r < 0.56) hueIdx++;
      hueIdx = clamp(hueIdx, 0, NH - 1);
      return hueIdx;
    }

    return {
      id: 'ink-eddy',
      name: 'Ink Eddy',
      init: function (env) {
        var w = env.width, h = env.height, i;
        f = makeFluid(w, h);
        asleep = true;
        first = true;
        holding = false;
        inkAcc = 0;
        lastCast = -99;
        /* far fewer tracers than before, each drawing many times its own
           length: continuity comes from the streakline, not from crowding */
        kstep = clamp(f.s * 0.44, 3, 7);
        kcap = countFor(w, h, 195, 520, 1900);
        kx = new Float32Array(kcap); ky = new Float32Array(kcap);
        ttx = new Float32Array(kcap * TRAIL); tty = new Float32Array(kcap * TRAIL);
        khead = new Uint8Array(kcap); klen = new Uint8Array(kcap);
        kmax = new Uint8Array(kcap);
        kage = new Float32Array(kcap); klife = new Float32Array(kcap);
        khue = new Uint8Array(kcap); ktier = new Uint8Array(kcap);
        klum = new Float32Array(kcap);
        sortIdx = new Int32Array(kcap);
        bStart = new Int32Array(NB + 1); bCur = new Int32Array(NB);
        dgx = Math.ceil(w / DG) + 1; dgy = Math.ceil(h / DG) + 1;
        dgrid = new Uint16Array(dgx * dgy);
        kn = 0; kcur = 0;
        motes.length = 0;
        var n = countFor(w, h, 90000, 4, 12);
        for (i = 0; i < n; i++) {
          motes.push({ x: rand(0, w), y: rand(0, h), ph: rand(0, TAU) });
        }
        bg = makeBackdrop(env, function (g, W, H) {
          // deep still water, almost black, holding one pale pool of sky
          var base = g.createLinearGradient(0, 0, 0, H);
          base.addColorStop(0, 'rgb(11,15,24)');
          base.addColorStop(0.55, 'rgb(8,11,18)');
          base.addColorStop(1, 'rgb(5,7,12)');
          g.fillStyle = base;
          g.fillRect(0, 0, W, H);
          var pool = g.createRadialGradient(W * 0.38, H * 0.32, 0,
                                            W * 0.38, H * 0.32, Math.max(W, H) * 0.55);
          pool.addColorStop(0, 'rgba(34,50,74,0.6)');
          pool.addColorStop(1, 'rgba(34,50,74,0)');
          g.fillStyle = pool;
          g.fillRect(0, 0, W, H);
          // the near bank, a shade darker, closing the bottom of the frame
          ridge(g, W, H, 0.955, 0.014, 3.1, 0.007, 7.3, 0.6, 'rgb(4,6,10)');
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        if (!f) return;
        asleep = false;
        var x = num(seed.x, env.width / 2), y = num(seed.y, env.height / 2);
        var vx = num(seed.vx, 0), vy = num(seed.vy, 0);
        var sp = Math.hypot(vx, vy);
        var ux = sp > 1 ? vx / sp : 0, uy = sp > 1 ? vy / sp : 0;
        var pw = seedPower(seed), cz = seedCharge(seed);

        if (cz > 0 && holding) {
          /* release: the eddy is handed over exactly as it stands and simply
             pushed off along the throw — it meanders and unwinds by itself */
          var js = clamp(sp * 0.26, 25, 320);
          stir(f, holdX, holdY, holdSig * 1.5, 0, ux * js, uy * js, 0.7);
          inkSeg(holdX, holdY, holdX, holdY, holdSig * 0.9, 44, 7.5, holdHue);
          holding = false;
          lastCast = env.t;
          return;
        }

        /* one colour per gesture: a drag streams many seeds in quick
           succession and must stay one ribbon of one ink, so the palette only
           steps when a gesture has actually begun */
        var hue = (env.t - lastCast > 0.35) ? nextHue() : hueIdx;
        lastCast = env.t;

        if (pw <= 0.45) {
          // drag: a stroke of ink laid down with the current that painted it,
          // whose edge shear rolls into curls once the finger has gone
          var jd = clamp(sp * 0.24, 40, 260);
          var sd = f.s * 2.1;
          stir(f, x, y, sd, 0, ux * jd, uy * jd, 0.55);
          inkSeg(x - ux * 26, y - uy * 26, x, y, sd * 0.7, 34, 6.5, hue);
          return;
        }

        /* tap and flick are one gesture seen at two speeds: the throw becomes
           a jet, and whatever energy is not in the throw becomes spin. A still
           tap is therefore pure spiral, a hard flick pure mushroom.
           The eddy sits at the finger, but the ink is laid as a TONGUE off to
           one side of it, reaching from the eye out past the shear: a round
           blob of dye turning about its own middle stays a round blob however
           fast it spins, and only dye lying ACROSS the shear gets drawn out
           into an arm. */
        var sig = f.s * (2.8 + 1.8 * pw); // wide enough that the coarse grid
        var jet = clamp(sp * 0.30, 0, 420); // does not diffuse the eddy away
        var omega = (4.0 + 2.4 * pw) * clamp(1 - sp / 300, 0.2, 1); // rad/s at the eye
        if (Math.random() < 0.5) spinDir = -spinDir;
        stir(f, x, y, sig, omega * sig / LO_PEAK * spinDir, ux * jet, uy * jet, 0.85);
        var la = rand(0, TAU), lc = Math.cos(la), ls = Math.sin(la);
        inkSeg(x + lc * sig * 1.15, y + ls * sig * 1.15,
               x + lc * sig * 0.15, y + ls * sig * 0.15,
               sig * 0.6, 100 + Math.round(pw * 180), 7 + pw * 2, hue);
        if (cz > 0) { // a charged seed with nothing held: one big slow bloom
          stir(f, x, y, sig * 1.6, omega * sig * (1 + cz) / LO_PEAK * spinDir, 0, 0, 0.6);
          inkSeg(x - lc * sig * 0.9, y - ls * sig * 0.9, x, y,
                 sig * 0.7, Math.round(66 * cz), 9, hue);
        }
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        var i;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : 0.18, 'rgb(8,11,18)');
        first = false;

        // scenery in motion: the pool of sky on the water breathes and slides
        // across the pond over ~20s
        var sb = 0.5 + 0.5 * Math.sin(t * 0.31);
        var gxp = w * 0.38 + Math.sin(t * 0.13) * w * 0.05;
        var gyp = h * 0.32 + Math.sin(t * 0.09 + 1.4) * h * 0.03;
        var pg = ctx.createRadialGradient(gxp, gyp, 0, gxp, gyp, Math.max(w, h) * 0.45);
        pg.addColorStop(0, 'rgba(62,92,134,' + (0.012 + 0.013 * sb) + ')');
        pg.addColorStop(1, 'rgba(62,92,134,0)');
        ctx.fillStyle = pg;
        ctx.fillRect(0, 0, w, h);

        // charge: circulation builds and tightens under the finger, and the
        // eye pulses once it is full
        var chg = chargeInfo(env);
        if (chg && f) {
          asleep = false;
          if (!holding) {
            holding = true;
            holdHue = nextHue();
            if (Math.random() < 0.5) spinDir = -spinDir;
          }
          holdX = chg.x; holdY = chg.y;
          holdSig = f.s * (3.4 - 1.5 * chg.lv);
          var om = 1.8 + 3.4 * chg.lv;
          if (chg.lv > 0.9) om *= 1 + 0.14 * Math.sin(t * 5.5);
          stir(f, holdX, holdY, holdSig, om * holdSig / LO_PEAK * spinDir,
               0, 0, 1 - Math.exp(-5 * dt));
          inkAcc += dt * (46 + 110 * chg.lv);
          while (inkAcc >= 1) {
            var ia = rand(0, TAU), ir = holdSig * rand(0.5, 1.15);
            addInk(holdX + Math.cos(ia) * ir, holdY + Math.sin(ia) * ir,
                   rand(5, 8), holdHue);
            inkAcc -= 1;
          }
        } else if (holding) {
          holding = false; // hold abandoned: the eddy is left to unwind alone
        }

        // the pond, and the ink riding it (RK2, so a tight vortex does not
        // spiral its own ink outward)
        if (f && !asleep) {
          step(f, dt);
          /* a coarse census of where the ink actually is. Density is half of
             the contrast: the packed middle of an arm burns near-white while
             the same dye, once the shear has pulled it thin, sinks back into
             the water. */
          dgrid.fill(0);
          var gi, gj;
          for (i = 0; i < kn; i++) {
            gi = (kx[i] / DG) | 0; gj = (ky[i] / DG) | 0;
            if (gi < 0) gi = 0; else if (gi >= dgx) gi = dgx - 1;
            if (gj < 0) gj = 0; else if (gj >= dgy) gj = dgy - 1;
            dgrid[gi * dgy + gj]++;
          }
          var lim = 0.5, st2 = kstep * kstep, ease = Math.min(1, dt * 7);
          for (i = kn - 1; i >= 0; i--) {
            kage[i] += dt;
            if (kage[i] >= klife[i]) {
              kn--;
              if (i !== kn) {
                kx[i] = kx[kn]; ky[i] = ky[kn];
                kage[i] = kage[kn]; klife[i] = klife[kn];
                khue[i] = khue[kn]; ktier[i] = ktier[kn]; klum[i] = klum[kn];
                khead[i] = khead[kn]; klen[i] = klen[kn]; kmax[i] = kmax[kn];
                ttx.copyWithin(i * TRAIL, kn * TRAIL, kn * TRAIL + TRAIL);
                tty.copyWithin(i * TRAIL, kn * TRAIL, kn * TRAIL + TRAIL);
              }
              continue;
            }
            var x = kx[i], y = ky[i];
            var mx = x + sampleU(f, x, y) * dt * 0.5;
            var my = y + sampleV(f, x, y) * dt * 0.5;
            var ivx = sampleU(f, mx, my), ivy = sampleV(f, mx, my);
            x += ivx * dt; y += ivy * dt;
            if (x < lim) x = lim; else if (x > f.iw - lim) x = f.iw - lim;
            if (y < lim) y = lim; else if (y > f.ih - lim) y = f.ih - lim;
            kx[i] = x; ky[i] = y;
            /* resample the streakline by ARC LENGTH rather than by time: slow
               dye still draws a filament of the same length as fast dye, it
               just takes longer over it, so nothing anywhere collapses into a
               dot while the pond is settling */
            var b = i * TRAIL, hd = khead[i];
            var sx = x - ttx[b + hd], sy = y - tty[b + hd];
            if (sx * sx + sy * sy >= st2) {
              hd++; if (hd >= TRAIL) hd = 0;
              ttx[b + hd] = x; tty[b + hd] = y;
              khead[i] = hd;
              if (klen[i] < kmax[i]) klen[i]++;
            }
            gi = (x / DG) | 0; gj = (y / DG) | 0;
            if (gi < 0) gi = 0; else if (gi >= dgx) gi = dgx - 1;
            if (gj < 0) gj = 0; else if (gj >= dgy) gj = dgy - 1;
            var core = 0.62 * Math.min(1, dgrid[gi * dgy + gj] / D_REF) +
                       0.38 * Math.min(1, Math.hypot(ivx, ivy) / 250);
            var want = lifeAlpha(kage[i], klife[i]) * (0.10 + 0.90 * core);
            // eased, so a tracer crossing a census cell never flicks bands
            klum[i] += (want - klum[i]) * ease;
            ktier[i] = clamp(Math.floor(klum[i] * NL), 0, NL - 1);
          }
          if (kn === 0 && f.maxSpeed < SLEEP_V) {
            asleep = true; // nothing left to move: the sim costs nothing now
            stillness(f);
          }
        }

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // ambient whisper: dust on the water, drifting on its own until the
        // pond is stirred, and then carried by it
        for (i = 0; i < motes.length; i++) {
          var m = motes[i];
          var fa = field(m.x, m.y, t);
          var mvx = Math.cos(fa) * 3, mvy = Math.sin(fa) * 3;
          if (f && !asleep) { mvx += sampleU(f, m.x, m.y); mvy += sampleV(f, m.x, m.y); }
          m.x += mvx * dt; m.y += mvy * dt;
          if (m.x < 0) m.x = w; else if (m.x > w) m.x = 0;
          if (m.y < 0) m.y = h; else if (m.y > h) m.y = 0;
          ctx.fillStyle = 'rgba(150,180,225,' + (0.03 + 0.022 * Math.sin(t * 0.5 + m.ph)) + ')';
          ctx.fillRect(m.x, m.y, 1.4, 1.4);
        }

        /* The ink, as filaments. Every tracer is one smooth curve along the
           path it has ridden; the passes go from a broad near-invisible wash
           that fuses neighbouring filaments into one sheet of dye, down to a
           hair-thin blazing core drawn only where the dye is fresh and packed.
           A counting sort by (colour, luminance) first, so each stroke walks
           only its own members instead of filtering the whole cloud. */
        if (kn > 0) {
          bStart.fill(0);
          for (i = 0; i < kn; i++) bStart[khue[i] * NL + ktier[i] + 1]++;
          for (i = 0; i < NB; i++) { bStart[i + 1] += bStart[i]; bCur[i] = bStart[i]; }
          for (i = 0; i < kn; i++) sortIdx[bCur[khue[i] * NL + ktier[i]]++] = i;

          var q, l, a0, a1;
          // 1. the wash: whole filaments, wide and all but invisible, which is
          //    what fuses neighbours into one sheet of dye
          ctx.lineWidth = BODY_W;
          for (q = 0; q < NH; q++) {
            a0 = bStart[q * NL]; a1 = bStart[q * NL + NL];
            if (a1 === a0) continue;
            ctx.strokeStyle = BODY_S[q];
            ctx.beginPath();
            for (i = a0; i < a1; i++) inkPath(ctx, sortIdx[i], 1);
            ctx.stroke();
          }
          // 2. the tails: every lit filament runs its FULL length in the ink's
          //    deep tone, so the bright part below has something to fade into
          ctx.lineWidth = INK_W[1];
          for (q = 0; q < NH; q++) {
            a0 = bStart[q * NL + 2]; a1 = bStart[q * NL + NL];
            if (a1 === a0) continue;
            ctx.strokeStyle = INK_S[q * NL + 1];
            ctx.beginPath();
            for (i = a0; i < a1; i++) inkPath(ctx, sortIdx[i], 1);
            ctx.stroke();
          }
          // 3. the dye itself: each band over its own head-length of filament,
          //    brightening and narrowing as it goes up the ramp
          for (q = 0; q < NH; q++) {
            for (l = 0; l < NL; l++) {
              a0 = bStart[q * NL + l]; a1 = bStart[q * NL + l + 1];
              if (a1 === a0) continue;
              ctx.lineWidth = INK_W[l];
              ctx.strokeStyle = INK_S[q * NL + l];
              ctx.beginPath();
              for (i = a0; i < a1; i++) inkPath(ctx, sortIdx[i], INK_T[l]);
              ctx.stroke();
            }
          }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineJoin = 'miter';
      }
    };
  }

/* ------------------------------------------------------------------
     10. Stone Rill — cast falling water: it pours from the hand as one
         connected column, breaks over dark stones and runs down them in
         sheets, gathers in the hollows between them as standing water,
         and drains away again over half a minute
  ------------------------------------------------------------------ */
  function stoneRill() {
    var ents = [];
    var free = [];    // spent mouths, kept whole for the next cast
    var first = true;
    var held = null;
    var bg = null;
    var rocks = [];   // the stones, exactly as the backdrop paints them
    var seeps = [];   // ambient: the stones are never quite dry
    var groundY = 0;  // the streambed, at the middle of the frame
    var BOWL = 0;     // how far it rises again toward either bank
    var SW = 1;       // the frame's width, so the bed can be asked for
    var idle = 0;     // seconds since the last water was in the scene
    var SC = 1;       // scene scale, so a portrait is the same scene, smaller
    var LW = 1;       // line scale
    var GR = 900;     // gravity
    var QB = 1200;    // px^2 of water a plain pour delivers each second

    /* ---- the streambed, as one heightfield ---------------------------
       Water never talks to the stones. It talks to `fl`: the y of the
       silhouette — crown, flank or bed — at each column. That one
       surface serves the falling column, the sheet running down a flank
       and the standing pool alike, which is what lets water poured onto
       a crown run off it and gather in the hollow beside it without a
       special case anywhere. */
    var COLS = 0, colW = 1;
    var fl = null;    // the silhouette: y per column
    var slp = null;   // its slope, dy/dx
    var dn = null;    // which neighbour water here runs to, or -1: nowhere
    var dstep = null; // and how far it drops getting there
    var dep = null;   // standing water: depth, px
    var run = null;   // water in transit over stone: area, px^2
    var runB = null;  // scratch for one advection pass
    var wet = null;   // how lately this column carried water, 0..1
    var rp = null, rv = null;   // the pool's surface, as a 1-D wave
    var poolVol = 0, runVol = 0, wetAny = false;

    /* the stones: fixed slots, jittered per scene, so water poured
       anywhere above always finds a stair to fall down. A slot gives the
       middle of a mound, the height its CROWN breaks at, its half-width,
       and the side its shoulder leans to — every mound is then sunk deep
       enough that its underside is buried in the streambed. Only crowns
       are ever visible, which is what keeps them reading as stone
       instead of as ovals lying on the floor.
       Two masses hold the frame, left and right, and the wide bed left
       clear between them is the basin: that gap, and the small stone
       standing in it, are the whole reason poured water has somewhere to
       gather instead of a crack to disappear into. */
    var SLOTS = [
      [0.12, 0.675, 0.215, 1],
      [0.89, 0.700, 0.225, -1],
      [0.27, 0.800, 0.090, 1],
      [0.75, 0.822, 0.080, -1],
      [0.47, 0.855, 0.045, 1]
    ];

    // spray: a small pool now, since spray is only what an impact throws
    var DROPS = 240;
    var drops = [];
    var live = 0;
    var cur = 0;
    var DV = 0.8;     // px^2 of water one bead is worth

    // and the rings water makes landing in water
    var rings = [];
    var rCur = 0;

    // spray brightness in three fading bands, so the whole scatter draws
    // in six batched strokes instead of two hundred
    var GLOW_A = [0.085, 0.05, 0.021];
    var CORE_A = [0.36, 0.21, 0.09];

    /* ---- water as rope, not as beads ---------------------------------
       Every mouth keeps the last two seconds of what it poured: where it
       was, how fast it was moving, and how much water left it. A parcel
       emitted then is at  p + (v + r)·d + g·d²/2  now — exact whether
       the hand was still or thrown, since a released hand falls under
       the same gravity as the water it is spilling. So the stream IS
       that history carried forward: one polyline hanging from the mouth,
       ending where it meets stone or water. Close the tap and the near
       end simply lifts away and the rope left hanging falls on its own. */
    var HN = 20, HDT = 0.075;   // samples kept, and seconds between them
    /* Water spilled from a hand that is itself falling travels with that
       hand: parcel and mouth obey the same gravity, so on their own they
       would sit in exactly the same place for ever. What separates them
       is the little push each parcel got leaving, and the hand outrunning
       what it let go of first — and both of those die away instead of
       growing without end. `ef` is that drift time, saturating at DRIFT:
       a thrown handful stretches into a short ribbon and then stops,
       rather than drawing itself out into a wire whose far end sweeps a
       feather across the wake. A hand held still is unaffected — its
       column is made by gravity, not by drift. */
    var DRIFT = 0.45, IDRIFT = 1 / 0.45;
    var LAG = 0.17;             // of the hand's pace, what the water loses
    var RMAX = 56;              // ropes drawn per frame, at most
    var ropeX = new Float32Array(RMAX * HN);
    var ropeY = new Float32Array(RMAX * HN);
    var ropeN = new Int16Array(RMAX);
    var ropeT = new Uint8Array(RMAX);
    var rn = 0;

    /* one rope in six passes, each covering the stretch of it from RF
       to RT: a wide soft halo and a thick body near the hand, a narrower
       one most of the way down, and a bright thread down the middle —
       then the same two again, dimmer and thinner, over the tail alone.
       So the column leaves the hand thick and bright and arrives thin
       and faint, which is what a falling stream does as it speeds up,
       and its far end fades out rather than ending on a hard cap that
       would draw its own ghost across the wake. */
    var RW = [2.6, 1.35, 0.72, 0.50, 0.30, 0.22];
    var RA = [0.024, 0.050, 0.058, 0.024, 0.115, 0.045];
    var RF = [0, 0, 0, 0.68, 0, 0.55];
    var RT = [0.5, 0.42, 0.78, 1, 0.62, 0.88];
    var RC = ['rgba(40,94,158,', 'rgba(58,128,198,',
              'rgba(120,182,235,', 'rgba(110,172,226,',
              'rgba(220,244,255,', 'rgba(200,230,252,'];
    var DDMAX = 1.5;   // seconds of water a rope still in the air may show
    // three strengths of stream, so every rope in the scene is drawn in
    // twelve strokes however many mouths are pouring at once
    var TW = [6.6, 5.0, 3.6];
    var TA = [1, 0.86, 0.68];

    // the bed: lowest in the middle of the frame, curving up to either
    // bank, so loose water always finds its way back to the basin
    function bedY(x) {
      var u = 2 * x / SW - 1;
      return groundY - BOWL * u * u;
    }
    // a mound breaking at `crown`, sunk until its underside is below the bed
    function addRock(cx, crown, rx) {
      var ry = Math.max(rx * 0.7, bedY(cx) - crown + 6);
      rocks.push({ cx: cx, cy: crown + ry, rx: rx, ry: ry, top: crown });
    }
    // the whole pile as one shape: the crowns, and the bed they rise out of
    function rockPath(g, W, H) {
      var k;
      g.beginPath();
      for (k = 0; k < rocks.length; k++) {
        var r = rocks[k];
        g.moveTo(r.cx + r.rx, r.cy);
        g.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, TAU);
      }
      var step = Math.max(3, W / 48);
      g.moveTo(0, H + 2);
      for (k = 0; k <= W; k += step) g.lineTo(k, bedY(k));
      g.lineTo(W, bedY(W));
      g.lineTo(W, H + 2);
      g.closePath();
    }

    // ---- the heightfield ------------------------------------------------
    function colOf(x) {
      var i = (x / colW) | 0;
      return i < 0 ? 0 : i >= COLS ? COLS - 1 : i;
    }
    // the top of whatever the water would meet here: stone, or the water
    // already standing on it
    function surfAt(x) {
      var u = x / colW - 0.5;
      if (u <= 0) return fl[0] - dep[0];
      if (u >= COLS - 1) return fl[COLS - 1] - dep[COLS - 1];
      var i = u | 0, a = fl[i] - dep[i];
      return a + (fl[i + 1] - dep[i + 1] - a) * (u - i);
    }
    // the drawn surface: the level, plus whatever the wave is doing to it
    function surfY(i) {
      var a = dep[i] * 0.5;
      if (a > 3 * LW) a = 3 * LW;
      var r = rp[i];
      if (r > a) r = a; else if (r < -a) r = -a;
      return fl[i] - dep[i] + r;
    }
    /* water arriving somewhere. Onto standing water, or onto ground flat
       enough to hold it, it simply joins the pool; onto a flank it
       becomes film, which has to run down before it can settle. */
    function pour(x, vol) {
      if (!(vol > 0)) return;
      var i = colOf(x);
      if (dep[i] > 0.3 * LW || dn[i] < 0) dep[i] += vol / colW;
      else run[i] += vol;
    }

    function spawn(x, y, vx, vy, life, bead) {
      if (live >= DROPS) return;
      for (var i = 0; i < DROPS; i++) {
        var d = drops[cur];
        cur = cur + 1 === DROPS ? 0 : cur + 1;
        if (d.on) continue;
        d.on = true;
        live++;
        d.x = d.px = x;
        d.y = d.py = y;
        d.vx = vx;
        d.vy = vy;
        d.age = 0;
        d.life = life;
        d.bead = bead ? 3 : 0;
        d.tier = d.bead;
        return;
      }
    }
    function ring(x, y, p) {
      var s = rings[rCur];
      rCur = rCur + 1 < rings.length ? rCur + 1 : 0;
      s.x = x; s.y = y; s.p = p; s.age = 0; s.life = rand(0.8, 1.5); s.on = true;
    }

    /* ---- mouths --------------------------------------------------------
       Pooled whole, history buffers and all: a drag casts twenty-five of
       these a second and not one of them may allocate. */
    function blankEnt() {
      var str = [], i;
      for (i = 0; i < 5; i++) str.push({ q: 0, da: 0, dv: 1, wf: 1, wp: 0, brk: 0 });
      return {
        kin: null, str: str, ns: 2,
        vx: 0, vy: 0, px: 0, py: 0,
        hX: new Float32Array(HN), hY: new Float32Array(HN),
        hVX: new Float32Array(HN), hVY: new Float32Array(HN),
        hQ: new Float32Array(HN), hT: new Float32Array(HN),
        hHead: 0, hn: 0, hd: 0,
        q0: 0, rsp: 0, peak: 0, inten: 0,
        mx: 0, my: 0, ma: 0,
        tRing: 0, tSpray: 0,
        age: 0, life: 1, dur: 1, fAge: 0,
        gs: 1, cz: 0, held: false
      };
    }
    function makeEnt(env, seed, pw) {
      var e = free.length ? free.pop() : blankEnt();
      var kin = makeKin(seed, env, 0.32, 0, 520);
      // water has no opinion of its own: sent slowly, it simply falls
      if (Math.hypot(num(seed.vx, 0), num(seed.vy, 0)) <= 60) {
        kin.h = Math.PI / 2 + rand(-0.25, 0.25);
        kin.sp = rand(0, 25);
      }
      e.kin = kin;
      e.ns = 2 + Math.round(2.4 * pw);
      for (var i = 0; i < e.ns; i++) {
        var st = e.str[i];
        var q = e.ns > 1 ? (i / (e.ns - 1) - 0.5) * 2 : 0;
        st.q = q;
        st.da = q * (0.10 + 0.14 * pw) + rand(-0.05, 0.05);  // its share of the fan
        st.dv = 1 - 0.12 * q * q + rand(-0.12, 0.12);
        st.wf = rand(0.8, 2.1);                 // and its own slow waver
        st.wp = rand(0, TAU);
        st.brk = rand(0, 0.3);
      }
      /* how much water this is: a hold opens right up, a drizzled drag
         is barely a tenth of it. Squared, so the gesture that means "a
         lot" gives a lot and the one that means "a little" stays calm. */
      e.q0 = QB * (0.22 + 1.1 * pw * pw);
      e.rsp = (16 + 26 * pw) * SC;   // how briskly it leaves the hand
      e.vx = e.vy = 0;
      e.px = kin.x; e.py = kin.y;
      e.hHead = HN - 1; e.hn = 0; e.hd = HDT;
      e.peak = 0; e.inten = 0; e.fAge = 0;
      e.tRing = 0; e.tSpray = 0;
      e.mx = kin.x; e.my = kin.y; e.ma = 0;
      e.dur = 0.16 + 0.3 * pw;
      e.age = 0;
      e.life = e.dur + 2.6;
      e.gs = 1; e.cz = 0; e.held = false;
      fromKin(e);
      return e;
    }
    // the shared helpers speak in heading and speed; a fall speaks in vx/vy
    function fromKin(e) {
      e.vx = Math.cos(e.kin.h) * e.kin.sp;
      e.vy = Math.sin(e.kin.h) * e.kin.sp;
    }
    // as capPush, but spent mouths come back to the pool
    function push(e) {
      ents.push(e);
      var over = ents.length - CAP;
      for (var i = 0; i < over; i++) {
        var o = ents[i];
        if (o.life - o.age > 0.5) o.life = o.age + 0.5;
      }
      while (ents.length > CAP + 10) {
        var g = ents.shift();
        if (g === held) held = null;
        free.push(g);
      }
    }

    /* ---- the water in the bed, one step ------------------------------ */
    function stepWater(dt) {
      var i, j, tr, a, b, la, lb, q, v, f;

      /* the film: water still running over stone, moved one column
         downhill and handed to the pool the moment it meets flat ground
         or standing water. A whole sheet costs one pass over the
         columns, and it arrives as a rising level, not as beads. */
      if (runVol > 0.01) {
        for (i = 0; i < COLS; i++) runB[i] = 0;
        var soak = Math.max(0, 1 - 0.2 * dt);
        for (i = 0; i < COLS; i++) {
          q = run[i] * soak;
          if (q <= 0.002) continue;
          j = dn[i];
          // the bottom of a hollow, or water already standing here: it
          // has arrived, and is a pool from now on
          if (j < 0 || dep[i] > 0.3 * LW) { dep[i] += q / colW; continue; }
          v = (70 + 330 * Math.min(1, dstep[i] / colW * 0.85)) * SC;
          f = v * dt / colW;
          if (f > 0.85) f = 0.85;
          runB[i] += q * (1 - f);
          runB[j] += q * f;
        }
        var sw = run; run = runB; runB = sw;
        if (runVol < 0.05) for (i = 0; i < COLS; i++) run[i] = 0;
      }

      /* standing water finds its level, and so finds the hollows.
         Each pass levels a neighbouring pair outright rather than
         nudging it: nudged, this is a diffusion, and diffusion across
         twenty columns takes half a minute — the water heaps up under
         the stream like sand instead of lying flat. Sweeping alternate
         directions carries the front the whole way across in one go,
         and only ever between touching columns, so water never steps
         over a crown into the next hollow. */
      if (poolVol > 0.01) {
        for (var p = 0; p < 6; p++) {
          for (i = 0; i < COLS - 1; i++) {
            a = p & 1 ? COLS - 2 - i : i;
            b = a + 1;
            la = fl[a] - dep[a];
            lb = fl[b] - dep[b];
            if (la < lb) { tr = Math.min(dep[a], (lb - la) * 0.5) * 0.9; dep[a] -= tr; dep[b] += tr; }
            else { tr = Math.min(dep[b], (la - lb) * 0.5) * 0.9; dep[b] -= tr; dep[a] += tr; }
          }
        }
      }

      /* and it drains: a slow steady seep into the bed plus a share of
         the depth. A wet film is gone in a breath; a pool a hand deep
         takes the better part of a minute to fall away, which is the
         whole point of it. */
      var seep = 0.72 * SC * dt, keep = Math.max(0, 1 - 0.038 * dt);
      var dry = (poolVol > 0.5 || runVol > 0.5) ? 0.1 : 0.5;
      poolVol = 0; runVol = 0; wetAny = false;
      for (i = 0; i < COLS; i++) {
        var d = dep[i];
        if (d > 0) {
          d = d * keep - seep;
          if (d < 0.005) d = 0;
          dep[i] = d;
          poolVol += d;
        }
        runVol += run[i];
        if (d > 0.25 * LW || run[i] > 0.8) wet[i] = 1;
        else if (wet[i] > 0) wet[i] = Math.max(0, wet[i] - dt * dry);
        if (wet[i] > 0.04) wetAny = true;
      }
      poolVol *= colW;

      // the pool's own surface: an impact rings out across it and dies.
      // Stepped per frame rather than per second, so it stays stable
      // whatever the frame rate does.
      if (poolVol > 0.5) {
        for (i = 1; i < COLS - 1; i++) {
          if (dep[i] <= 0.3) { rp[i] = 0; rv[i] = 0; continue; }
          rv[i] = (rv[i] + (rp[i - 1] + rp[i + 1] - 2 * rp[i]) * 0.3) * 0.965;
        }
        for (i = 0; i < COLS; i++) rp[i] = (rp[i] + rv[i]) * 0.994;
      } else if (poolVol <= 0) {
        for (i = 0; i < COLS; i++) { rp[i] = 0; rv[i] = 0; }
      }
    }

    /* ---- the two ribbons that lie on the stone ----------------------- */
    /* the pool: mode 0 its whole body, from the surface down onto the
       stone it is lying on; mode 1 the line where it meets the air;
       mode 2 a share `band` of the depth under that line, where the
       light gathers. Deep water is dark and only its skin is lit, which
       is what tells the eye it is looking at water and not at paint —
       and taking the band as a share of the depth rather than a fixed
       drop keeps its lower edge parallel to the stone it lies on,
       instead of ruling a straight line across the pool. */
    function poolPath(ctx, mode, band) {
      var i = 0, k, a, b, min = 0.3 * LW;
      ctx.beginPath();
      while (i < COLS) {
        if (dep[i] <= min) { i++; continue; }
        a = i;
        while (i < COLS && dep[i] > min) i++;
        b = i - 1;
        if (mode === 1) {
          ctx.moveTo((a + 0.5) * colW, surfY(a));
          for (k = a + 1; k <= b; k++) ctx.lineTo((k + 0.5) * colW, surfY(k));
          continue;
        }
        var a0 = a > 0 ? a - 1 : a, b0 = b < COLS - 1 ? b + 1 : b;
        ctx.moveTo((a0 + 0.5) * colW, fl[a0]);   // it thins away at the shore
        for (k = a; k <= b; k++) ctx.lineTo((k + 0.5) * colW, surfY(k));
        ctx.lineTo((b0 + 0.5) * colW, fl[b0]);
        for (k = b0; k >= a0; k--) {
          ctx.lineTo((k + 0.5) * colW,
                     mode === 2 ? Math.min(fl[k], surfY(k) + dep[k] * band + 1.5 * LW)
                                : fl[k] + 0.6);
        }
        ctx.closePath();
      }
    }
    // the film: mode 0 its body, mode 1 the lip that catches the light
    function filmPath(ctx, mode) {
      var i = 0, k, a, b, eps = 0.3;
      ctx.beginPath();
      while (i < COLS) {
        if (run[i] <= eps) { i++; continue; }
        a = i;
        while (i < COLS && run[i] > eps) i++;
        b = i - 1;
        if (mode === 2) {   // the line it is running along, for a soft halo
          ctx.moveTo((a + 0.5) * colW, fl[a] - filmT(a) * 0.5);
          for (k = a + 1; k <= b; k++) ctx.lineTo((k + 0.5) * colW, fl[k] - filmT(k) * 0.5);
          continue;
        }
        if (mode === 0) ctx.moveTo((a + 0.5) * colW, fl[a] + 1.5 * LW);
        else ctx.moveTo((a + 0.5) * colW, fl[a] - filmT(a));
        for (k = mode === 0 ? a : a + 1; k <= b; k++) {
          ctx.lineTo((k + 0.5) * colW, fl[k] - filmT(k));
        }
        if (mode === 0) {
          for (k = b; k >= a; k--) ctx.lineTo((k + 0.5) * colW, fl[k] + 1.5 * LW);
          ctx.closePath();
        }
      }
    }
    function filmT(i) {
      var t = run[i] / colW * 2.6;
      return t < 0.7 * LW ? 0.7 * LW : t > 7 * LW ? 7 * LW : t;
    }

    return {
      id: 'stone-rill',
      name: 'Stone Rill',
      init: function (env) {
        var w = env.width, h = env.height, i;
        ents.length = 0;
        free.length = 0;
        first = true;
        held = null;
        live = 0;
        cur = 0;
        rCur = 0;
        rn = 0;
        idle = 0;
        poolVol = 0;
        runVol = 0;
        wetAny = false;
        groundY = h * 0.888;  // the streambed the stones are sunk into
        BOWL = h * 0.05;
        SW = w;
        SC = h / 760;
        LW = clamp(SC, 0.62, 1.15);
        GR = h * 0.95;
        QB = w * h * 0.0018;  // one plain pour, in px^2 of water a second

        drops.length = 0;
        for (i = 0; i < DROPS; i++) {
          drops.push({ on: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, age: 0, life: 1, bead: 0, tier: 0 });
        }
        rings.length = 0;
        for (i = 0; i < 26; i++) rings.push({ x: 0, y: 0, p: 0, age: 0, life: 1, on: false });
        for (i = 0; i < 16; i++) free.push(blankEnt());

        rocks.length = 0;
        for (i = 0; i < SLOTS.length; i++) {
          var s = SLOTS[i];
          var cx = w * (s[0] + rand(-0.025, 0.025));
          var crown = h * (s[1] + rand(-0.018, 0.018));
          var rx = w * s[2] * rand(0.86, 1.14);
          addRock(cx, crown, rx);
          addRock(cx + s[3] * rx * rand(0.55, 0.8), crown + rx * rand(0.12, 0.26),
                  rx * rand(0.42, 0.6));
        }

        // the bed, read off the stones once: the only surface water sees
        COLS = clamp(Math.round(w / 6), 30, 190);
        colW = w / COLS;
        fl = new Float32Array(COLS);
        slp = new Float32Array(COLS);
        dn = new Int16Array(COLS);
        dstep = new Float32Array(COLS);
        dep = new Float32Array(COLS);
        run = new Float32Array(COLS);
        runB = new Float32Array(COLS);
        wet = new Float32Array(COLS);
        rp = new Float32Array(COLS);
        rv = new Float32Array(COLS);
        for (i = 0; i < COLS; i++) {
          var x = (i + 0.5) * colW, y = bedY(x);
          for (var k = 0; k < rocks.length; k++) {
            var r = rocks[k];
            var u = (x - r.cx) / r.rx;
            if (u <= -1 || u >= 1) continue;
            var yy = r.cy - r.ry * Math.sqrt(1 - u * u);
            if (yy < y) y = yy;
          }
          fl[i] = y;
        }
        for (i = 0; i < COLS; i++) {
          var lo = i > 0 ? i - 1 : 0, hi = i < COLS - 1 ? i + 1 : COLS - 1;
          slp[i] = (fl[hi] - fl[lo]) / ((hi - lo) * colW);
          /* and where water standing here would run to. Taken from the
             two neighbours outright rather than from the slope: at the
             bottom of a narrow notch the slope points up the steeper
             side, and water sent that way climbs the wall it just came
             down and never settles anywhere. */
          var hL = i > 0 ? fl[i - 1] : -1e9, hR = i < COLS - 1 ? fl[i + 1] : -1e9;
          var down = hR > hL ? hR : hL;
          dstep[i] = down - fl[i];
          dn[i] = dstep[i] > 0.12 * colW ? (hR > hL ? i + 1 : i - 1) : -1;
        }

        seeps.length = 0;
        var ns = countFor(w, h, 62000, 5, 14);
        for (i = 0; i < ns; i++) {
          seeps.push({
            rk: (Math.random() * rocks.length) | 0,
            a: -Math.PI / 2 + rand(-0.7, 0.7),
            dir: Math.random() < 0.5 ? -1 : 1,
            sp: rand(0.1, 0.24),
            age: rand(0, 6), life: rand(5, 11)
          });
        }

        bg = makeBackdrop(env, function (g, W, H) {
          // a cold ravine, lit only from somewhere high above
          var sky = g.createLinearGradient(0, 0, 0, H);
          sky.addColorStop(0, 'rgb(17,26,37)');
          sky.addColorStop(0.6, 'rgb(12,19,28)');
          sky.addColorStop(1, 'rgb(9,15,23)');
          g.fillStyle = sky;
          g.fillRect(0, 0, W, H);
          /* the stones and the bed, as one silhouette: a wet crown laid
             down first, then the body of the pile over it a hair lower, so
             only the true outline of the whole pile keeps its light.
             Stroking each mound instead would rule bright arcs straight
             across its neighbours and they would read as drawn circles. */
          rockPath(g, W, H);
          var rim = g.createLinearGradient(0, H * 0.58, 0, H * 0.99);
          rim.addColorStop(0, 'rgb(29,43,60)');   // the high crowns catch it
          rim.addColorStop(0.6, 'rgb(15,23,33)');
          rim.addColorStop(1, 'rgb(7,12,18)');    // the near stones keep none
          g.fillStyle = rim;
          g.fill();
          g.save();
          g.translate(0, 1.5);
          rockPath(g, W, H);
          g.fillStyle = 'rgb(5,9,14)';
          g.fill();
          g.restore();
          // and what little light falls this far down, gathering on the
          // higher stones
          rockPath(g, W, H);
          var lit = g.createLinearGradient(0, H * 0.6, 0, H * 0.98);
          lit.addColorStop(0, 'rgba(64,90,118,0.13)');
          lit.addColorStop(1, 'rgba(64,90,118,0)');
          g.fillStyle = lit;
          g.fill();
        });
      },
      cast: function (env, seed) {
        seed = seed || {};
        var pw = seedPower(seed);
        var cz = seedCharge(seed);
        if (cz > 0 && held) { // seamless handoff: the pour goes on falling
          if (ents.indexOf(held) === -1) push(held);
          releaseHeld(held, seed, 0.32, 0, 520, 0.9 + pw * 1.1);
          fromKin(held);
          held.dur = 0.5 + 0.7 * pw + cz * 1.5;   // and keeps pouring a while
          held.fAge = 0;
          held.life = held.age + held.dur + 2.6;
          held = null;
          return;
        }
        var e = makeEnt(env, seed, pw);
        if (cz > 0) {
          e.cz = cz;
          e.gs = Math.max(1, 0.4 + 1.6 * cz);
          e.dur += cz * 1.5;
          e.life = e.dur + 2.6;
        }
        push(e);
      },
      frame: function (env) {
        var ctx = env.ctx, w = env.width, h = env.height, t = env.t, dt = env.dt;
        var lw = LW, sc = SC, G = GR;
        var air = Math.max(0, 1 - 0.9 * dt);
        var i, j, k, m, d, e, st, a, b, any;

        /* water leaves long wakes, so the backdrop is laid down faintly —
           but a faint one can never quite finish the job: the last two or
           three levels of a wake round-trip forever and stain the scene
           where water once ran. So once the water is gone the fade opens
           right up over a breath, and the scene truly rests. A pool still
           draining counts as water in the scene.
           The fade is short enough that a moving rope does not print a
           ladder of its own ghosts behind it, and everything that stands
           still — the pool, a running sheet — is drawn bright enough to
           hold up under it. */
        var busy = ents.length > 0 || live > 0 || poolVol > 0.5 || runVol > 0.5;
        if (busy) idle = 0; else idle += dt;
        ctx.globalCompositeOperation = 'source-over';
        drawBackdrop(ctx, bg, w, h, first ? 1 : Math.min(1, 0.26 + idle * 1.2), 'rgb(12,19,28)');
        first = false;

        // scenery in motion: light sliding over the wet bed, breathing slowly
        ctx.lineWidth = 1.4 * lw;
        for (i = 0; i < 3; i++) {
          var gx = w * (0.5 + 0.3 * Math.sin(t * 0.09 + i * 1.4));
          ctx.strokeStyle = 'rgba(150,200,240,' +
            (0.017 + 0.028 * Math.abs(Math.sin(t * 0.33 + i * 1.1))) + ')';
          ctx.beginPath();
          ctx.moveTo(gx - w * 0.24, bedY(gx) + (i + 1) * 3.4 * lw);
          ctx.lineTo(gx + w * 0.24, bedY(gx) + (i + 1) * 3.4 * lw);
          ctx.stroke();
        }

        // charge: water gathers and pours from the finger while it is held,
        // the stream opening wider the longer the hold grows
        var chg = chargeInfo(env);
        if (chg) {
          if (!held) {
            held = makeEnt(env, { x: chg.x, y: chg.y }, 1);
            held.held = true;
            push(held);
          }
          holdEnt(held, chg);
        } else if (held) {
          dropHeld(held);
          held = null;
        }

        // ---- the mouths, and the water they have in the air ------------
        rn = 0;
        for (i = ents.length - 1; i >= 0; i--) {
          e = ents[i];
          e.age += dt;
          if (e.age >= e.life) { ents.splice(i, 1); if (e === held) held = null; free.push(e); continue; }
          var target;
          if (e.held) {
            // pinned to the finger: the water leaves with whatever pace
            // the hand is carrying, so a moving hand lays a curtain
            var idt = 1 / Math.max(dt, 1e-3);
            e.vx += ((e.kin.x - e.px) * idt * 0.6 - e.vx) * Math.min(1, 9 * dt);
            e.vy += ((e.kin.y - e.py) * idt * 0.6 - e.vy) * Math.min(1, 9 * dt);
            target = 1;
          } else {
            e.vy += G * dt;
            e.kin.x += e.vx * dt;
            e.kin.y += e.vy * dt;
            e.fAge += dt;
            var u = e.fAge / e.dur;
            target = u >= 1 ? 0 : (1 - u) * (1 - u);  // opens, then closes
          }
          e.px = e.kin.x;
          e.py = e.kin.y;
          e.inten += (target - e.inten) * Math.min(1, 11 * dt);

          var gs = entScale(e, t);
          var la = lifeAlpha(e.age, e.life);
          var q = e.q0 * gs * e.inten;            // px^2 of water a second
          if (q > e.peak) e.peak = q;
          else e.peak *= Math.max(0, 1 - 0.45 * dt);
          // how heavy this stream reads: from the water in it, not from
          // the tap, so a slug still falling stays as bright as it was
          var stq = clamp(e.peak / (QB * 0.8), 0.1, 1) * Math.min(1, la * 1.5);
          var tier = stq > 0.62 ? 0 : stq > 0.3 ? 1 : 2;

          // what left the hand this interval, remembered
          e.hd += dt;
          if (e.inten > 0.02 && e.hd >= HDT) {
            var hh = e.hHead + 1 === HN ? 0 : e.hHead + 1;
            e.hHead = hh;
            e.hX[hh] = e.kin.x; e.hY[hh] = e.kin.y;
            e.hVX[hh] = e.vx; e.hVY[hh] = e.vy;
            e.hQ[hh] = q * e.hd;
            e.hT[hh] = t;
            if (e.hn < HN) e.hn++;
            e.hd = 0;
          }
          e.mx = e.kin.x; e.my = e.kin.y;
          e.ma = e.inten * la * gs;
          if (e.hn === 0) continue;

          /* what has landed since the last frame: every parcel now at or
             below the surface hands over the water it was carrying, once.
             The newest of them is where the stream is striking. */
          var got = 0, hx = -1, hy = 0, hvx = 0, hvy = 0, aloft = false;
          for (m = 0; m < e.hn; m++) {
            j = e.hHead - m; if (j < 0) j += HN;
            var dg = t - e.hT[j];
            var eg = dg / (1 + dg * IDRIFT);
            var qx = e.hX[j] + e.hVX[j] * dg - e.hVX[j] * LAG * eg;
            var qy = e.hY[j] + e.hVY[j] * dg + 0.5 * G * dg * dg +
                     (e.rsp - e.hVY[j] * LAG) * eg;
            if (qx < 0 || qx > w) { e.hQ[j] = 0; continue; }
            if (qy < surfAt(qx) && dg < 2.4) {
              if (e.hQ[j] > 0) aloft = true;
              continue;
            }
            if (hx < 0) {
              hx = qx; hy = qy;
              hvx = e.hVX[j] * (1 - LAG); hvy = e.hVY[j] * (1 - LAG) + e.rsp + G * dg;
            }
            got += e.hQ[j];
            e.hQ[j] = 0;
          }
          if (hx >= 0) {
            pour(hx, got);
            var ci = colOf(hx);
            var imp = clamp(Math.hypot(hvx, hvy) / (h * 0.95), 0.12, 1);
            var inPool = dep[ci] > 0.4 * lw;
            if (got > 0) {
              wet[ci] = 1;
              if (inPool) rv[ci] += imp * 1.1 * lw;   // it rings the pool
              e.tRing -= dt;
              if (e.tRing <= 0) {
                e.tRing = rand(0.1, 0.24);
                if (dep[ci] > 2 * lw && slp[ci] > -0.4 && slp[ci] < 0.4) {
                  ring(hx, surfY(ci), imp);
                }
              }
              // and throws a little of itself back up. This, and only
              // this, is where the water is allowed to become beads.
              e.tSpray -= dt;
              if (e.tSpray <= 0 && imp > 0.2) {
                e.tSpray = rand(0.035, 0.1);
                var n2 = 1 + (Math.random() < 0.45 ? 1 : 0);
                for (k = 0; k < n2; k++) {
                  var sd = Math.random() < 0.5 ? -1 : 1;
                  spawn(hx, hy - 2 * lw,
                        hvx * 0.16 + sd * imp * rand(70, 240) * sc,
                        -Math.abs(hvy) * rand(0.05, 0.2) - rand(8, 55) * sc,
                        rand(0.35, 0.85), Math.random() < 0.3);
                }
              }
            }
          }
          // nothing left in the air and nothing coming: it is over
          if (!aloft && e.inten < 0.03 && e.life - e.age > 0.35) e.life = e.age + 0.35;

          /* and the same history, drawn: one rope per strand, hanging
             from the mouth, ending on the first surface it meets */
          var mw = (1.3 + 2.2 * gs) * lw;
          for (var si = 0; si < e.ns && rn < RMAX; si++) {
            st = e.str[si];
            var bs = rn * HN, n = 0, nAir = 0, landed = false;
            var ox = st.q * mw, wob = (0.8 + 1.5 * gs) * lw;
            if (e.inten > 0.02) {          // still attached to the hand
              ropeX[bs] = e.kin.x + ox;
              ropeY[bs] = e.kin.y;
              n = 1;
            }
            var rcx = Math.cos(1.5708 + st.da) * e.rsp * st.dv;
            var rcy = Math.sin(1.5708 + st.da) * e.rsp * st.dv;
            for (m = 0; m < e.hn; m++) {
              j = e.hHead - m; if (j < 0) j += HN;
              var dd = t - e.hT[j];
              if (dd > 2.4) break;
              var ef = dd / (1 + dd * IDRIFT);
              // the waver is read at the moment it left the hand, so the
              // ripple travels down the column instead of shaking all of
              // it at once — and it is a sideways nudge rather than a
              // change of aim, so it cannot open out as the water falls
              var bx = e.hX[j] + ox + e.hVX[j] * dd + (rcx - e.hVX[j] * LAG) * ef +
                       Math.sin((t - dd) * st.wf * 2.6 + st.wp) * wob;
              var by = e.hY[j] + e.hVY[j] * dd + 0.5 * G * dd * dd +
                       (rcy - e.hVY[j] * LAG) * ef;
              if (bx < -30 || bx > w + 30) break;
              var sf = surfAt(bx);
              if (by >= sf) {              // it has arrived: end on the surface
                if (n > 0) {
                  var lx = ropeX[bs + n - 1], ly = ropeY[bs + n - 1];
                  var fr = clamp((sf - ly) / (by - ly || 1), 0, 1);
                  ropeX[bs + n] = lx + (bx - lx) * fr;
                  ropeY[bs + n] = ly + (by - ly) * fr;
                  n++;
                }
                landed = true;
                break;
              }
              ropeX[bs + n] = bx;
              ropeY[bs + n] = by;
              n++;
              if (dd <= DDMAX) nAir = n;
              if (n >= HN) break;
              // where a long fall starts to break up, a little of it does.
              // Never at a fixed depth, or the beads line up in rows.
              if (dd > 0.55 && st.brk <= 0 && Math.random() < 0.3 && live < DROPS - 40) {
                st.brk = rand(0.16, 0.5) / (0.25 + stq);
                spawn(bx, by, e.hVX[j] + rcx + rand(-16, 16) * sc,
                      e.hVY[j] + rcy + G * dd + rand(-10, 10) * sc,
                      rand(0.5, 1.1), Math.random() < 0.25);
              }
            }
            st.brk -= dt;
            if (!landed && nAir < n) n = nAir;   // the rest of it has broken up
            if (n < 2) continue;
            ropeN[rn] = n;
            ropeT[rn] = tier;
            rn++;
          }
        }

        // ---- the spray: ballistic, and it clings where it lands --------
        for (i = 0; i < DROPS; i++) {
          d = drops[i];
          if (!d.on) continue;
          d.age += dt;
          if (d.age >= d.life) { d.on = false; live--; pour(d.x, DV); continue; }
          d.px = d.x;
          d.py = d.y;
          d.vy += G * dt;
          d.vx *= air;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (d.x < -20 || d.x > w + 20 || d.y > h + 10) { d.on = false; live--; continue; }
          var sy = surfAt(d.x);
          if (d.y >= sy) {
            var cj = colOf(d.x);
            if (dep[cj] > 0.3 * lw) {      // into the pool: it is water now
              rv[cj] += 0.22 * lw;
              d.on = false; live--; pour(d.x, DV);
              continue;
            }
            d.y = sy;                      // onto stone: it clings and runs
            var s2 = slp[cj];
            var nl = Math.sqrt(1 + s2 * s2);
            var nx = s2 / nl, ny = -1 / nl;
            var vn = d.vx * nx + d.vy * ny;
            if (vn < 0) {
              var tx = d.vx - vn * nx, ty = d.vy - vn * ny;
              d.vx = tx * 0.84 - nx * vn * 0.12;
              d.vy = ty * 0.84 - ny * vn * 0.12;
            }
            if (d.life - d.age > 0.5) d.life = d.age + rand(0.25, 0.6);
          }
          var f = 1 - d.age / d.life;
          d.tier = d.bead + (f > 0.62 ? 0 : f > 0.3 ? 1 : 2);
        }

        stepWater(dt);

        /* ---- stone the water has touched --------------------------
           A wetted flank goes dark and keeps a thin gloss along its
           edge, and dries from the rim inward once the water is gone.
           Only the stone above the waterline: what is under the pool is
           already darkened by the water lying on it. */
        if (wetAny) {
          var dry = 0.3 * lw;   // submerged stone is darkened by the pool itself
          ctx.beginPath();
          i = 0;
          while (i < COLS) {
            if (wet[i] <= 0.04 || dep[i] > dry) { i++; continue; }
            a = i;
            while (i < COLS && wet[i] > 0.04 && dep[i] <= dry) i++;
            b = i - 1;
            ctx.moveTo(a * colW, fl[a]);
            for (k = a; k <= b; k++) ctx.lineTo((k + 0.5) * colW, fl[k]);
            ctx.lineTo((b + 1) * colW, fl[b]);
            for (k = b; k >= a; k--) ctx.lineTo((k + 0.5) * colW, fl[k] + wet[k] * 7 * lw);
            ctx.closePath();
          }
          ctx.fillStyle = 'rgba(3,7,12,0.42)';
          ctx.fill();
        }

        // ---- standing water ------------------------------------------
        // one body per hollow: the surface, and the stone it lies on.
        // Where a crown breaks through there is simply no pool, which is
        // what makes the mounds read as islands rather than as a flood.
        if (poolVol > 0.5) {
          poolPath(ctx, 0, 0);
          ctx.fillStyle = 'rgba(6,13,22,0.22)';   // water darkens the stone
          ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(28,70,120,0.042)'; // and the depths keep no light
          ctx.fill();
        } else {
          ctx.globalCompositeOperation = 'lighter';
        }

        if (wetAny) {  // the gloss along a wet edge
          ctx.beginPath();
          i = 0;
          while (i < COLS) {
            if (wet[i] <= 0.04) { i++; continue; }
            a = i;
            while (i < COLS && wet[i] > 0.04) i++;
            b = i - 1;
            ctx.moveTo((a + 0.5) * colW, fl[a]);
            for (k = a + 1; k <= b; k++) ctx.lineTo((k + 0.5) * colW, fl[k]);
          }
          ctx.strokeStyle = 'rgba(125,175,220,0.075)';
          ctx.lineWidth = 1.6 * lw;
          ctx.stroke();
        }

        if (poolVol > 0.5) {
          // the skin: bright shallows, the line where it meets the air,
          // and a sheen drifting slowly along it
          poolPath(ctx, 2, 0.55);   // the light reaches a little way down
          ctx.fillStyle = 'rgba(40,96,156,0.062)';
          ctx.fill();
          poolPath(ctx, 2, 0.16);   // and gathers in the shallows
          ctx.fillStyle = 'rgba(52,112,172,0.075)';
          ctx.fill();
          poolPath(ctx, 1, 0);
          ctx.strokeStyle = 'rgba(150,205,245,0.17)';
          ctx.lineWidth = 1.6 * lw;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(226,244,255,0.10)';
          ctx.lineWidth = 0.7 * lw;
          ctx.stroke();
          any = false;
          ctx.beginPath();
          for (i = 0; i < COLS - 1; i++) {
            if (dep[i] <= 1.2 * lw) continue;
            var ph = Math.sin(t * 0.4 - i * 0.4) + Math.sin(t * 0.27 + i * 0.17);
            if (ph < 0.6) continue;
            ctx.moveTo((i + 0.5) * colW, surfY(i) + 2.6 * lw);
            ctx.lineTo((i + 1.5) * colW, surfY(i + 1) + 2.6 * lw);
            any = true;
          }
          if (any) {
            ctx.strokeStyle = 'rgba(140,195,240,0.06)';
            ctx.lineWidth = 2 * lw;
            ctx.stroke();
          }
        }

        // ambient whisper: the stones are never quite dry — slow beads
        // creeping down their flanks, each dragging a short wet trail,
        // then drying away and starting again somewhere else
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.5 * lw;
        for (i = 0; i < seeps.length; i++) {
          var sp = seeps[i];
          sp.age += dt;
          if (sp.age > sp.life) {
            sp.rk = (Math.random() * rocks.length) | 0;
            sp.a = -Math.PI / 2 + rand(-0.7, 0.7);
            sp.dir = Math.random() < 0.5 ? -1 : 1;
            sp.sp = rand(0.1, 0.24);
            sp.age = 0;
            sp.life = rand(5, 11);
          }
          var rk = rocks[sp.rk];
          sp.a += sp.dir * sp.sp * (0.25 + Math.abs(Math.cos(sp.a))) * dt;
          var sbx = rk.cx + Math.cos(sp.a) * rk.rx;
          var syy = rk.cy + Math.sin(sp.a) * rk.ry;
          // it has crept down into the bed: gone, and another starts elsewhere
          if (syy > bedY(sbx)) { sp.age = sp.life + 1; continue; }
          var sa = 0.23 * Math.min(1, sp.age / 1.2, (sp.life - sp.age) / 1.5);
          if (sa <= 0) continue;
          // the wet track it has left, taken from the very same curve the
          // bead is walking, so the streak lies exactly on the stone
          var back = sp.a - sp.dir * 0.16;
          ctx.strokeStyle = 'rgba(140,195,240,' + sa * 0.45 + ')';
          ctx.beginPath();
          ctx.ellipse(rk.cx, rk.cy, rk.rx, rk.ry, 0,
                      sp.dir > 0 ? back : sp.a, sp.dir > 0 ? sp.a : back);
          ctx.stroke();
          ctx.fillStyle = 'rgba(180,220,252,' + sa + ')';
          ctx.beginPath();
          ctx.arc(sbx, syy, 1.4 * lw, 0, TAU);
          ctx.fill();
        }

        /* ---- the sheet running down the stone -------------------------
           Thickness is the water actually in transit over each column, so
           a heavy pour lays a broad film and a trickle lays a thread —
           and either way it is one unbroken ribbon lying on the flank,
           never a file of beads. */
        if (runVol > 0.4) {
          filmPath(ctx, 2);
          ctx.strokeStyle = 'rgba(44,102,168,0.068)';
          ctx.lineWidth = 8 * lw;
          ctx.stroke();
          filmPath(ctx, 0);
          ctx.fillStyle = 'rgba(58,124,192,0.13)';
          ctx.fill();
          filmPath(ctx, 1);
          ctx.strokeStyle = 'rgba(178,220,252,0.105)';
          ctx.lineWidth = 1.1 * lw;
          ctx.stroke();
        }

        // ---- the falling water, twelve strokes for the whole scene -----
        ctx.lineJoin = 'round';
        for (var tr = 0; tr < 3; tr++) {
          var has = false;
          for (i = 0; i < rn; i++) if (ropeT[i] === tr) { has = true; break; }
          if (!has) continue;
          for (var p2 = 0; p2 < 6; p2++) {
            // never a hairline: a bright line one pixel wide prints its
            // own ghost every frame and the wake turns into a ladder
            var pw2 = TW[tr] * RW[p2];
            ctx.lineWidth = (pw2 < 2 ? 2 : pw2) * lw;
            ctx.strokeStyle = RC[p2] + RA[p2] * TA[tr] + ')';
            ctx.beginPath();
            for (i = 0; i < rn; i++) {
              if (ropeT[i] !== tr) continue;
              var nn = ropeN[i];
              var i0 = (nn * RF[p2]) | 0;
              var i1 = Math.ceil(nn * RT[p2]);
              if (i1 > nn) i1 = nn;
              if (i1 - i0 < 2) continue;
              var bb = i * HN;
              ctx.moveTo(ropeX[bb + i0], ropeY[bb + i0]);
              for (k = i0 + 1; k < i1; k++) ctx.lineTo(ropeX[bb + k], ropeY[bb + k]);
            }
            ctx.stroke();
          }
        }

        // the mouth itself: only the soft swell of gathering water
        any = false;
        ctx.beginPath();
        for (i = 0; i < ents.length; i++) {
          e = ents[i];
          if (e.ma <= 0.02) continue;
          ctx.moveTo(e.mx + (2 + 3.4 * e.ma) * lw, e.my);
          ctx.arc(e.mx, e.my, (2 + 3.4 * e.ma) * lw, 0, TAU);
          any = true;
        }
        if (any) {
          ctx.fillStyle = 'rgba(46,110,180,0.06)';
          ctx.fill();
          ctx.beginPath();
          for (i = 0; i < ents.length; i++) {
            e = ents[i];
            if (e.ma <= 0.02) continue;
            ctx.moveTo(e.mx + (0.8 + 1.3 * e.ma) * lw, e.my);
            ctx.arc(e.mx, e.my, (0.8 + 1.3 * e.ma) * lw, 0, TAU);
          }
          ctx.fillStyle = 'rgba(226,246,255,0.15)';
          ctx.fill();
        }

        // spray, drawn as the streak each bead made this frame: one path
        // per brightness band, a soft halo and then a bright core
        ctx.lineCap = 'round';
        for (tr = 0; tr < 6; tr++) {
          any = false;
          ctx.beginPath();
          for (i = 0; i < DROPS; i++) {
            d = drops[i];
            if (!d.on || d.tier !== tr) continue;
            any = true;
            ctx.moveTo(d.px, d.py);
            ctx.lineTo(d.x, d.y);
          }
          if (!any) continue;
          var big = tr > 2, fb = tr % 3;
          ctx.strokeStyle = 'rgba(105,180,240,' + GLOW_A[fb] * (big ? 1.45 : 1) + ')';
          ctx.lineWidth = (big ? 5.4 : 3) * lw;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(222,244,255,' + CORE_A[fb] * (big ? 1.1 : 1) + ')';
          ctx.lineWidth = (big ? 1.7 : 1) * lw;
          ctx.stroke();
        }

        // and where water fell into water: a flat ring opening out
        for (i = 0; i < rings.length; i++) {
          var s = rings[i];
          if (!s.on) continue;
          s.age += dt;
          if (s.age >= s.life) { s.on = false; continue; }
          var sf2 = s.age / s.life;
          var sr = (3 + 26 * sf2) * lw * (0.4 + 0.8 * s.p);
          ctx.strokeStyle = 'rgba(120,190,240,' + 0.19 * (1 - sf2) * (1 - sf2) * s.p + ')';
          ctx.lineWidth = 1.1 * lw;
          ctx.beginPath();
          ctx.ellipse(s.x, s.y, sr, sr * 0.18, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  }

  window.SwirlsEffects = [
    driftTide(),
    emberBreath(),
    auroraVeil(),
    stillOrbits(),
    nightPond(),
    verdantSurge(),
    petalFall(),
    opalRise(),
    fireflyMeadow(),
    duskFountain(),
    inkEddy(),
    stoneRill()
  ];
})();
