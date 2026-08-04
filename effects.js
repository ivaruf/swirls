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
    var shades = ['rgba(64,190,180,', 'rgba(40,150,165,', 'rgba(130,225,205,'];

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
        var n = countFor(env.width, env.height, 70000, 5, 18);
        for (var i = 0; i < n; i++) {
          motes.push({ x: rand(0, env.width), y: rand(0, env.height), sp: rand(5, 12) });
        }
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
        ctx.fillStyle = first ? 'rgb(4,11,14)' : 'rgba(4,11,14,0.08)';
        ctx.fillRect(0, 0, w, h);
        first = false;

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: a few dim motes riding the current
        ctx.fillStyle = 'rgba(70,180,170,0.05)';
        for (var i = 0; i < motes.length; i++) {
          var m = motes[i];
          var a = field(m.x, m.y, t);
          m.x += Math.cos(a) * m.sp * dt;
          m.y += Math.sin(a) * m.sp * dt;
          if (m.x < -8) m.x = w + 8; else if (m.x > w + 8) m.x = -8;
          if (m.y < -8) m.y = h + 8; else if (m.y > h + 8) m.y = -8;
          ctx.fillRect(m.x, m.y, 1.5, 1.5);
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

        // shoals: each fish swims a wobbling station around the moving core
        ctx.lineWidth = 1.6;
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
            ctx.strokeStyle = shades[q.c] + 0.5 * al + ')';
            ctx.beginPath();
            ctx.moveTo(q.px, q.py);
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
        ctx.fillStyle = first ? 'rgb(13,7,5)' : 'rgba(13,7,5,0.10)';
        ctx.fillRect(0, 0, w, h);
        first = false;

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: a faint breathing warmth low in the frame
        var breath = 0.5 - 0.5 * Math.cos(t * TAU / 9);
        var ga = (0.01 + 0.016 * breath) * (p.down ? 1.4 : 1);
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
          ctx.fillStyle = 'rgba(255,180,100,' + (0.02 + 0.02 * Math.sin(t * 1.3 + m.ph)) + ')';
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
          stars.push({ x: rand(0, w), y: rand(0, h), r: rand(0.5, 1.3), ph: rand(0, TAU), sp: rand(0.2, 0.8) });
        }
        hintY = h * 0.55;
        hintGrad = env.ctx.createLinearGradient(0, hintY, 0, h);
        hintGrad.addColorStop(0, 'rgba(80,200,150,0)');
        hintGrad.addColorStop(0.5, 'rgba(80,200,150,0.045)');
        hintGrad.addColorStop(1, 'rgba(60,150,130,0)');
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
        ctx.fillStyle = 'rgb(7,9,18)';
        ctx.fillRect(0, 0, w, h);

        // ambient whisper: dim stars and a breath of aurora on the horizon
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          var a = 0.05 + 0.16 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
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
        ctx.fillStyle = first ? 'rgb(11,8,19)' : 'rgba(11,8,19,0.08)';
        ctx.fillRect(0, 0, w, h);
        first = false;

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: a handful of dim slow-twinkling stars
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          ctx.fillStyle = 'rgba(200,185,240,' + (0.012 + 0.02 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph))) + ')';
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
          ctx.strokeStyle = 'rgba(180,160,230,' + 0.09 * al + ')';
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
    var moonX = 0, moonY = 0;

    function makeEnt(env, seed, pw) {
      return {
        kin: makeKin(seed, env, 0.3, 35, 460),
        age: 0, life: rand(4, 6) + pw * 2.5,
        r: 2.8 + pw * 3.2,
        shed: 0, ph: rand(0, TAU),
        sunk: false,
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
        ctx.fillStyle = first ? 'rgb(5,11,20)' : 'rgba(5,11,20,0.12)';
        ctx.fillRect(0, 0, w, h);
        first = false;

        ctx.globalCompositeOperation = 'lighter';

        // ambient whisper: dim moon, a sliver of shimmer, drifting motes
        var mg = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, 55);
        mg.addColorStop(0, 'rgba(220,235,255,0.02)');
        mg.addColorStop(1, 'rgba(220,235,255,0)');
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(moonX, moonY, 55, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(230,240,255,0.05)';
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
          ctx.fillStyle = 'rgba(130,190,200,' + (0.015 + 0.015 * Math.sin(t * 0.5 + m.ph)) + ')';
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

          if (!e.sunk && e.age > e.life * 0.72) {
            e.sunk = true; // the sinking breath: one last wide slow ring
            rings.push({ x: k.x, y: hy, age: 0, life: 3.6, sp: 20, r0: 8 });
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
          if (e.shed <= 0 && !e.sunk && rings.length < 70) {
            rings.push({ x: k.x, y: hy, age: 0, life: rand(2.2, 3.2), sp: rand(22, 34), r0: 2 });
            e.shed = clamp(90 / k.sp, 0.18, 0.8); // faster glide, denser wake
          }
        }

        // expanding wake rings, flattened for perspective
        ctx.lineWidth = 1.3;
        for (i = rings.length - 1; i >= 0; i--) {
          var rp = rings[i];
          rp.age += dt;
          if (rp.age >= rp.life) { rings.splice(i, 1); continue; }
          var fade = 1 - rp.age / rp.life;
          var r0 = rp.r0 + rp.age * rp.sp;
          ctx.strokeStyle = 'rgba(150,205,255,' + 0.20 * fade + ')';
          ctx.beginPath();
          ctx.ellipse(rp.x, rp.y, r0, r0 * 0.5, 0, 0, TAU);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(150,205,255,' + 0.10 * fade + ')';
          ctx.beginPath();
          ctx.ellipse(rp.x, rp.y, r0 * 0.62, r0 * 0.31, 0, 0, TAU);
          ctx.stroke();
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
    var tierCols = [
      'rgba(85,160,85,0.05)',    // resting moss
      'rgba(70,200,120,0.13)',   // stirred emerald
      'rgba(110,225,140,0.25)',  // rushing emerald
      'rgba(195,245,150,0.4)'    // pale lime highlights
    ];

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
        ctx.fillStyle = first ? 'rgb(5,12,7)' : 'rgba(5,12,7,0.12)';
        ctx.fillRect(0, 0, w, h);
        first = false;
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
    var cols = ['rgba(235,160,180,', 'rgba(250,205,215,', 'rgba(205,125,155,'];

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
        ctx.fillStyle = first ? 'rgb(16,9,13)' : 'rgba(16,9,13,0.09)';
        ctx.fillRect(0, 0, w, h);
        first = false;
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
          drawPetal(ctx, m.x, m.y, m.ang, 3, cols[m.c] + '0.06)');
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

  window.SwirlsEffects = [
    driftTide(),
    emberBreath(),
    auroraVeil(),
    stillOrbits(),
    nightPond(),
    verdantSurge(),
    petalFall()
  ];
})();
