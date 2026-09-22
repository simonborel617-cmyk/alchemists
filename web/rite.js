// The sealing rite: a canvas effect over the altar when a soul is sealed. The runes wake, every item lifts off its
// pedestal and spirals into the centre as a comet feeding a vortex of light, the vortex holds its breath and bursts,
// and the soul rises out of the burst under a halo. It is a fixed-step simulation with a seeded random, so any
// moment of it can be rendered on demand (?ritedev=1 exposes that for captures; the render loop pauses in a hidden tab).
window.AlchRite = (() => {
  const DT = 1 / 60, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, p) => a + (b - a) * p;
  const smooth = (p) => { p = clamp(p); return p * p * (3 - 2 * p); };
  const outCubic = (p) => 1 - Math.pow(1 - clamp(p), 3);
  const inCubic = (p) => { p = clamp(p); return p * p * p; };
  const outBack = (p) => { p = clamp(p); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, p) => [Math.round(lerp(a[0], b[0], p)), Math.round(lerp(a[1], b[1], p)), Math.round(lerp(a[2], b[2], p))];
  const WHITE = [255, 255, 255], GOLD = [242, 196, 85], EMBER = [255, 140, 40];

  // ---------------------------------------------------------------- sprites
  // Item art comes as 512px renders of 64px pixel art on the site's background colour. Sample the block centres back
  // to 64px and cut the background away from the edges inward, so an item can fly free of its square.
  const spriteCache = new Map();
  function keyedSprite(src) {
    if (spriteCache.has(src)) return spriteCache.get(src);
    const p = new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        const n = im.naturalWidth >= 512 ? 64 : im.naturalWidth, k = im.naturalWidth / n;
        const c = document.createElement("canvas"); c.width = c.height = n;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (k === 1) g.drawImage(im, 0, 0);
        else { const big = document.createElement("canvas"); big.width = big.height = im.naturalWidth; const bg = big.getContext("2d", { willReadFrequently: true }); bg.drawImage(im, 0, 0); const src = bg.getImageData(0, 0, big.width, big.height).data, out = g.createImageData(n, n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const si = ((y * k + (k >> 1)) * big.width + x * k + (k >> 1)) * 4, di = (y * n + x) * 4; out.data[di] = src[si]; out.data[di + 1] = src[si + 1]; out.data[di + 2] = src[si + 2]; out.data[di + 3] = 255; } g.putImageData(out, 0, 0); }
        const id = g.getImageData(0, 0, n, n), d = id.data, bgc = [d[0], d[1], d[2]];
        const near = (i) => Math.abs(d[i] - bgc[0]) + Math.abs(d[i + 1] - bgc[1]) + Math.abs(d[i + 2] - bgc[2]) < 24;
        const seen = new Uint8Array(n * n), stack = [];
        for (let i = 0; i < n; i++) stack.push(i, i * n, (n - 1) * n + i, i * n + n - 1);
        while (stack.length) { const q = stack.pop(); if (seen[q] || !near(q * 4)) continue; seen[q] = 1; d[q * 4 + 3] = 0; const x = q % n, y = (q - x) / n; if (x > 0) stack.push(q - 1); if (x < n - 1) stack.push(q + 1); if (y > 0) stack.push(q - n); if (y < n - 1) stack.push(q + n); }
        g.putImageData(id, 0, 0);
        res(c);
      };
      im.onerror = () => res(null);
      im.src = src;
    });
    spriteCache.set(src, p);
    return p;
  }

  // ---------------------------------------------------------------- the simulation
  // opts: { altar, items: [{src, x, y, size, tier}], rank, soulSrc, soul: {x, y, size}, colors: {1..6 hex}, id, rankName, seed }
  function build(opts, sprites, soulSprite) {
    const W = opts.width, H = opts.height, u = W / 640, cx = W / 2, cy = H / 2;
    const rand = rng(opts.seed || 7);
    const col = {}; for (let i = 1; i <= 6; i++) col[i] = hex(opts.colors[i] || "#f2c455");
    const rankC = opts.rank === 6 ? mix(col[6], GOLD, 0.3) : col[opts.rank] || GOLD, rankBright = mix(rankC, WHITE, 0.45); // a named soul burns white-gold
    // departures: pedestals clockwise from the top, the key last
    const order = opts.items.map((it, i) => i).filter((i) => opts.items[i] && sprites[i]);
    order.sort((a, b) => (opts.items[a].tier === 6) - (opts.items[b].tier === 6) || a - b);
    const T = { awake: 0.85, lift0: 0.75, gap: 0.14, flight: 1.05, hold: 0.55 };
    const items = order.map((i, n) => { const it = opts.items[i]; const dx = it.x - cx, dy = it.y - cy; return { ...it, sprite: sprites[i], dep: T.lift0 + n * T.gap, r0: Math.hypot(dx, dy), th0: Math.atan2(dy, dx), arrived: false, c: col[it.tier] || GOLD, bright: mix(col[it.tier] || GOLD, WHITE, 0.5), hist: [] }; });
    const lastArrive = items.length ? items[items.length - 1].dep + T.flight : T.lift0 + T.flight;
    T.burst = lastArrive + T.hold; T.rise = T.burst + 0.1; T.text = T.rise + 0.55; T.end = T.burst + 2.9;
    const S = { t: 0, W, H, u, cx, cy, items, T, rankC, rankBright, energy: 0, vortexC: rankC, vrot: 0, trail: [], sparks: [], orbit: [], embers: [], rings: [], motes: [], shake: 0, done: false, soulX: opts.soul.x, soulY: opts.soul.y, soulSize: opts.soul.size, soulSprite, rankName: opts.rankName, id: opts.id, rand, drand: rng(99) };
    // ambient motes drifting up across the altar the whole time
    for (let i = 0; i < 54; i++) S.embers.push({ x: rand() * W, y: rand() * H, v: (8 + rand() * 18) * u, sw: rand() * TAU, ph: rand() * TAU, s: Math.round((rand() < 0.3 ? 4 : 3) * u), c: rand() < 0.75 ? GOLD : EMBER, k: 0.25 + rand() * 0.45 });
    // ring glyphs: two rings of ticks, a seeded pattern of short, long and dot marks
    S.glyphs = [
      { r: 0.29 * W, n: 36, spd: 0.22, marks: Array.from({ length: 36 }, () => [0, 1, 1, 2, 2, 3][Math.floor(rand() * 6)]) },
      { r: 0.345 * W, n: 60, spd: -0.16, marks: Array.from({ length: 60 }, () => [0, 0, 1, 1, 2, 3][Math.floor(rand() * 6)]) },
    ];
    return S;
  }

  function step(S) {
    const { T, u, cx, cy, rand } = S; const t = (S.t += DT);
    // items: hover before departure, spiral in during flight, feed the core on arrival
    for (const it of S.items) {
      const p = (t - it.dep) / T.flight;
      if (p <= 0 || it.arrived) continue;
      if (p >= 1) { it.arrived = true; S.energy += 1; arrive(S, it); continue; }
      const e = smooth(p), r = it.r0 * (1 - inCubic(p) * 0.9 - e * 0.1), th = it.th0 + 1.7 * e;
      const lift = -22 * u * Math.sin(Math.min(1, p * 1.6) * Math.PI);
      it.px = cx + Math.cos(th) * r; it.py = cy + Math.sin(th) * r + lift; it.sc = 1 - 0.82 * e * e;
      it.hist.push([it.px, it.py]); if (it.hist.length > 16) it.hist.shift();
      // sparkle shed along the comet, denser as it speeds up
      const n = 1 + Math.round(3 * e);
      for (let i = 0; i < n; i++) S.trail.push({ x: it.px + (rand() - 0.5) * 12 * u * it.sc, y: it.py + (rand() - 0.5) * 12 * u * it.sc, vx: (rand() - 0.5) * 50 * u, vy: (rand() - 0.5) * 50 * u - 12 * u, life: 0.5 + rand() * 0.6, age: 0, s: Math.round((rand() < 0.3 ? 4 : 3) * u), c: rand() < 0.35 ? WHITE : it.bright });
    }
    // the vortex turns faster with every arrival and tightens hard while the core holds its breath
    const holdP = clamp((t - (T.burst - T.hold)) / T.hold);
    S.vrot += (2.2 + 0.5 * S.energy) * (1 + holdP * 4) * DT;
    for (const o of S.orbit) { o.a += o.w * DT * (1 + holdP * 3); o.r = Math.max(o.rmin * (1 - holdP * 0.7), o.r * (1 - DT * (0.9 + holdP * 4))); o.x = cx + Math.cos(o.a) * o.r; o.y = cy + Math.sin(o.a) * o.r * 0.82; }
    if (t >= T.burst && !S.burst) burst(S);
    // particles
    const drag = Math.pow(0.05, DT);
    for (const q of S.trail) { q.age += DT; q.x += q.vx * DT; q.y += q.vy * DT; q.vx *= drag; q.vy *= drag; }
    S.trail = S.trail.filter((q) => q.age < q.life);
    const sdrag = Math.pow(0.35, DT);
    for (const q of S.sparks) { q.age += DT; q.vy += q.g * DT; q.x += q.vx * DT; q.y += q.vy * DT; q.vx *= sdrag; q.vy *= sdrag; }
    S.sparks = S.sparks.filter((q) => q.age < q.life);
    for (const r of S.rings) r.age += DT;
    S.rings = S.rings.filter((r) => r.age < r.life);
    for (const m of S.embers) { const rain = t > T.burst; m.y += (rain ? m.v * 1.6 : -m.v) * DT; m.x += Math.sin(t * 1.3 + m.sw) * 6 * u * DT; if (m.y < -4) { m.y = S.H + 4; m.x = rand() * S.W; } if (m.y > S.H + 4) { m.y = -4; m.x = rand() * S.W; } }
    // the soul's motes: an orbit around it and sparkles rising past it
    if (S.burst && t >= T.rise) {
      for (const m of S.halo) m.a += m.w * DT;
      if (S.motes.length < 40 && rand() < 0.6) S.motes.push({ x: S.soulX + (rand() - 0.5) * S.soulSize * 1.3, y: S.soulY + S.soulSize * (0.2 + rand() * 0.4), v: (18 + rand() * 30) * u, sw: rand() * TAU, life: 1.1 + rand() * 0.8, age: 0, s: Math.round((rand() < 0.3 ? 4 : 3) * u), c: rand() < 0.5 ? WHITE : S.rankBright });
      for (const m of S.motes) { m.age += DT; m.y -= m.v * DT; m.x += Math.sin(t * 3 + m.sw) * 10 * u * DT; }
      S.motes = S.motes.filter((m) => m.age < m.life);
    }
    S.shake *= Math.pow(0.001, DT);
    if (t >= T.end) S.done = true;
  }

  function arrive(S, it) {
    const { cx, cy, u, rand } = S;
    S.vortexC = S.energy === 1 ? it.c : mix(S.vortexC, it.c, 0.4);
    S.rings.push({ x: cx, y: cy, r0: 6 * u, r1: 64 * u, w: 2.5 * u, life: 0.4, age: 0, c: it.bright });
    for (let i = 0; i < 22; i++) { const a = rand() * TAU, v = (60 + rand() * 160) * u; S.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 60 * u, life: 0.35 + rand() * 0.4, age: 0, s: Math.round(3 * u), c: rand() < 0.4 ? WHITE : it.bright }); }
    for (let i = 0; i < 10; i++) { const r = (22 + rand() * 34) * u; S.orbit.push({ a: rand() * TAU, w: (2.6 + rand() * 2.4) * (rand() < 0.5 ? 1 : -1), r, rmin: (6 + rand() * 10) * u, x: cx, y: cy, s: Math.round((rand() < 0.3 ? 4 : 3) * u), c: rand() < 0.35 ? WHITE : it.bright }); }
    S.flash = { t: S.t, a: 0.5, r: 90 * u, c: it.bright };
  }

  function burst(S) {
    const { cx, cy, u, rand, rankC } = S;
    S.burst = true; S.shake = 6 * u;
    S.rings.push({ x: cx, y: cy, r0: 8 * u, r1: 0.64 * S.W, w: 5 * u, life: 0.8, age: 0, c: WHITE, dots: true });
    S.rings.push({ x: cx, y: cy, r0: 8 * u, r1: 0.74 * S.W, w: 18 * u, life: 1.0, age: 0, c: rankC, soft: true, delay: 0.1 });
    S.rings.push({ x: cx, y: cy, r0: 8 * u, r1: 0.52 * S.W, w: 3 * u, life: 0.65, age: 0, c: GOLD, delay: 0.18 });
    for (let i = 0; i < 190; i++) { const a = rand() * TAU, v = (90 + Math.pow(rand(), 0.7) * 400) * u; const c = rand() < 0.3 ? WHITE : rand() < 0.5 ? S.rankBright : GOLD; S.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 150 * u, life: 0.7 + rand() * 1.2, age: 0, s: Math.round((rand() < 0.35 ? 4 : 3) * u), c, streak: rand() < 0.45 }); }
    S.orbit.length = 0;
    S.halo = Array.from({ length: 16 }, (_, i) => ({ a: (i / 16) * TAU, w: (rand() < 0.5 ? 1 : -1) * (0.9 + rand() * 0.6), r: (0.62 + rand() * 0.3), s: Math.round((rand() < 0.3 ? 4 : 3) * u), c: rand() < 0.5 ? GOLD : S.rankBright, ph: rand() * TAU }));
    S.flash = { t: S.t, a: 1, r: 0.95 * S.W, c: WHITE, big: true };
  }

  // ---------------------------------------------------------------- drawing
  function draw(S, ctx) {
    const { W, H, u, cx, cy, T, t } = S;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    if (S.shake > 0.3) ctx.translate(Math.round((S.drand() - 0.5) * 2 * S.shake), Math.round((S.drand() - 0.5) * 2 * S.shake));
    const wake = smooth(t / T.awake), sinceB = S.burst ? t - T.burst : -1;
    // the dark: the altar dims from the edges in as the runes wake, the burst lights it, the rest settles a little lighter
    let dark = 0.72 * wake; if (sinceB >= 0) dark = lerp(0.1, 0.55, smooth(sinceB / 0.9));
    if (dark > 0.005) { const vg = ctx.createRadialGradient(cx, cy, W * 0.12, cx, cy, W * 0.75); vg.addColorStop(0, `rgba(4,6,9,${(dark * 0.7).toFixed(3)})`); vg.addColorStop(1, `rgba(4,6,9,${Math.min(0.9, dark * 1.2).toFixed(3)})`); ctx.fillStyle = vg; ctx.fillRect(-8, -8, W + 16, H + 16); }
    ctx.globalCompositeOperation = "lighter";
    // ambient motes
    for (const m of S.embers) { ctx.globalAlpha = m.k * wake * (0.6 + 0.4 * Math.sin(t * 3 + m.ph)); ctx.fillStyle = rgba(m.c, 1); ctx.fillRect(Math.round(m.x / 2) * 2, Math.round(m.y / 2) * 2, m.s, m.s); }
    // rune rings
    for (const g of S.glyphs) {
      const spin = g.spd * t + (sinceB >= 0 ? Math.sign(g.spd) * 2.2 * (1 - Math.exp(-sinceB * 1.6)) : 0);
      const flare = sinceB >= 0 ? Math.exp(-sinceB * 2.2) : 0;
      ctx.globalAlpha = 0.22 * wake + flare * 0.4; ctx.strokeStyle = rgba(GOLD, 1); ctx.lineWidth = Math.max(1, 1.5 * u); ctx.beginPath(); ctx.arc(cx, cy, g.r, 0, TAU); ctx.stroke();
      for (let i = 0; i < g.n; i++) {
        const m = g.marks[i]; if (m === 0) continue;
        const lit = clamp((wake * 1.15 - i / g.n) * 6); if (lit <= 0) continue; // the marks light up clockwise from the top
        const a = -Math.PI / 2 + (i / g.n) * TAU + spin, len = (m === 1 ? 5 : m === 2 ? 10 : 4) * u;
        ctx.globalAlpha = clamp((0.6 + 0.4 * Math.sin(t * 4 + i)) * lit * (lit < 1 ? 1.8 : 1) + flare * 0.7);
        ctx.fillStyle = rgba(lit < 1 || flare > 0.3 ? WHITE : GOLD, 1);
        const x = cx + Math.cos(a) * g.r, y = cy + Math.sin(a) * g.r;
        if (m === 3) ctx.fillRect(Math.round(x - 1.5 * u), Math.round(y - 1.5 * u), Math.round(3 * u), Math.round(3 * u));
        else { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillRect(-len / 2, -1.2 * u, len, 2.4 * u); ctx.restore(); }
      }
    }
    // pedestal pulse before departure
    for (const it of S.items) {
      const pre = t - (it.dep - 0.3);
      if (pre > 0 && pre < 0.6) { const q = pre / 0.6; ring(ctx, it.x, it.y, lerp(it.size * 0.45, it.size * 1.2, outCubic(q)), 3 * u, it.bright, (1 - q) * 0.9); }
    }
    // the vortex: spiral arms of light turning around the core, tighter and whiter as it holds its breath
    if (S.energy > 0 && sinceB < 0.3) {
      const holdP = clamp((t - (T.burst - T.hold)) / T.hold);
      const pulse = 0.85 + 0.15 * Math.sin(t * 14);
      const R = lerp(34 + 18 * S.energy, 18, holdP) * u, arms = 4;
      const armC = mix(S.vortexC, WHITE, 0.1 + holdP * 0.7);
      ctx.lineCap = "round";
      for (let a = 0; a < arms; a++) {
        const base = S.vrot + (a / arms) * TAU;
        for (let j = 0; j < 16; j++) {
          const f0 = j / 16, f1 = (j + 1) / 16, r0 = f0 * R, r1 = f1 * R, th0 = base + f0 * 3.0, th1 = base + f1 * 3.0;
          const x0 = cx + Math.cos(th0) * r0, y0 = cy + Math.sin(th0) * r0 * 0.85, x1 = cx + Math.cos(th1) * r1, y1 = cy + Math.sin(th1) * r1 * 0.85;
          ctx.globalAlpha = (1 - f0) * 0.8; ctx.strokeStyle = rgba(armC, 1); ctx.lineWidth = Math.max(1, (1 - f0) * 7 * u + 1);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.globalAlpha = (1 - f0) * 0.5; ctx.strokeStyle = rgba(WHITE, 1); ctx.lineWidth = Math.max(1, (1 - f0) * 2 * u);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
      }
      const r = lerp(12 + 6 * S.energy, 10, holdP) * u * pulse, al = clamp(0.3 + 0.08 * S.energy + holdP * 0.5);
      glow(ctx, cx, cy, r * 3.4, S.vortexC, al * 0.55); glow(ctx, cx, cy, r * 1.5, mix(S.vortexC, WHITE, 0.35), al * 0.6); glow(ctx, cx, cy, r * 0.55, WHITE, al * 0.85);
    }
    // vortex motes
    for (const o of S.orbit) { ctx.globalAlpha = 0.95; ctx.fillStyle = rgba(o.c, 1); ctx.fillRect(Math.round(o.x), Math.round(o.y), o.s, o.s); }
    // comet tails of the items in flight
    for (const it of S.items) {
      if (it.arrived || it.hist.length < 2) continue;
      const n = it.hist.length;
      ctx.lineCap = "round";
      for (let j = 1; j < n; j++) {
        const f = j / n, [x0, y0] = it.hist[j - 1], [x1, y1] = it.hist[j];
        ctx.globalAlpha = f * f * 0.85; ctx.strokeStyle = rgba(it.c, 1); ctx.lineWidth = Math.max(1, f * it.size * 0.55 * it.sc + 2 * u);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.globalAlpha = f * f * 0.7; ctx.strokeStyle = rgba(WHITE, 1); ctx.lineWidth = Math.max(1, f * it.size * 0.18 * it.sc);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    // trails and sparks
    for (const q of S.trail) { const a = 1 - q.age / q.life; ctx.globalAlpha = a * a; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(Math.round(q.x / 2) * 2, Math.round(q.y / 2) * 2, q.s, q.s); }
    for (const q of S.sparks) {
      const a = 1 - q.age / q.life; ctx.globalAlpha = a; ctx.fillStyle = rgba(q.c, 1); ctx.strokeStyle = rgba(q.c, 1);
      if (q.streak) { ctx.lineCap = "butt"; ctx.lineWidth = q.s; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.045, q.y - q.vy * 0.045); ctx.stroke(); }
      else ctx.fillRect(Math.round(q.x / 2) * 2, Math.round(q.y / 2) * 2, q.s, q.s);
    }
    // rings (arrival ripples, the shockwaves), drawn with a glow around the line
    for (const r of S.rings) {
      const age = r.age - (r.delay || 0); if (age < 0) continue;
      const q = age / (r.life - (r.delay || 0)), rad = lerp(r.r0, r.r1, outCubic(q)), w = Math.max(1, r.w * (1 - q * 0.6)), al = (1 - q) * (r.soft ? 0.4 : 1);
      ring(ctx, cx, cy, rad, w * 4, r.c, al * 0.12); ring(ctx, cx, cy, rad, w * 2, r.c, al * 0.3); ring(ctx, cx, cy, rad, w, r.soft ? r.c : WHITE, al * 0.95);
      if (r.dots) { ctx.fillStyle = rgba(WHITE, 1); ctx.globalAlpha = al; for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU + q * 0.6, jitter = 1 + 0.06 * Math.sin(i * 7.3 + q * 20); ctx.fillRect(Math.round(cx + Math.cos(a) * rad * jitter), Math.round(cy + Math.sin(a) * rad * jitter), Math.round(3 * u), Math.round(3 * u)); } }
    }
    // the flash of an arrival or the burst
    if (S.flash) { const f = S.flash, age = t - f.t, dur = f.big ? 0.5 : 0.3; if (age < dur) { const q = age / dur; glow(ctx, cx, cy, f.r * (f.big ? 0.3 + 0.7 * outCubic(q) : 1), f.c, f.a * (1 - q) * (1 - q)); } }
    // the rays of the burst: beams of light fading outward
    if (sinceB >= 0 && sinceB < 1.1) {
      const env = Math.sin(Math.PI * clamp(sinceB / 1.1)), rot = 0.35 * sinceB, L0 = 0.62 * W * (0.5 + 0.5 * outCubic(sinceB / 0.5));
      const rg = ctx.createRadialGradient(cx, cy, 8 * u, cx, cy, L0); rg.addColorStop(0, rgba(WHITE, 0.55 * env)); rg.addColorStop(0.3, rgba(S.rankC, 0.4 * env)); rg.addColorStop(1, rgba(S.rankC, 0));
      ctx.fillStyle = rg; ctx.globalAlpha = 1;
      for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU + rot, L = L0 * (0.55 + 0.45 * Math.abs(Math.sin(i * 2.4 + 1))), hw = 0.025 + 0.03 * (i % 3); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a + hw) * 12 * u, cy + Math.sin(a + hw) * 12 * u); ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); ctx.lineTo(cx + Math.cos(a - hw) * 12 * u, cy + Math.sin(a - hw) * 12 * u); ctx.closePath(); ctx.fill(); }
    }
    ctx.globalCompositeOperation = "source-over";
    // the items: at their pedestals until they lift, then in flight with a glow around them
    for (const it of S.items) {
      if (it.arrived) continue;
      const p = (t - it.dep) / T.flight;
      let x = it.x, y = it.y, sc = 1;
      if (p > 0) { x = it.px; y = it.py; sc = it.sc; }
      else { const pre = clamp((t - (it.dep - 0.3)) / 0.3); y -= 8 * u * pre + 2 * u * Math.sin(t * 6); }
      const s = it.size * sc;
      ctx.globalCompositeOperation = "lighter"; glow(ctx, x, y, s * 1.1, it.bright, p > 0 ? 0.6 : 0.3 * clamp((t - (it.dep - 0.5)) / 0.4)); ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = p > 0.92 ? 1 - (p - 0.92) / 0.08 : 1;
      ctx.imageSmoothingEnabled = s < 30;
      ctx.drawImage(it.sprite, Math.round(x - s / 2), Math.round(y - s / 2), Math.round(s), Math.round(s));
      ctx.imageSmoothingEnabled = false;
    }
    // the soul rises out of the burst
    if (S.burst && t >= T.rise) {
      const q = clamp((t - T.rise) / 1.4), sc = 0.15 + 0.85 * outBack(q), a = clamp(q * 3);
      const x = S.soulX, y = lerp(cy + 26 * u, S.soulY, outCubic(q)), s = S.soulSize * sc;
      ctx.globalCompositeOperation = "lighter";
      // the halo: beams of light turning behind the soul, its glow, an aura ring, motes in orbit
      const rot = 0.22 * (t - T.rise), L0 = s * 1.9;
      const hg = ctx.createRadialGradient(x, y, s * 0.25, x, y, L0); hg.addColorStop(0, rgba(WHITE, 0.45 * a)); hg.addColorStop(0.3, rgba(S.rankBright, 0.3 * a)); hg.addColorStop(1, rgba(S.rankC, 0));
      ctx.fillStyle = hg; ctx.globalAlpha = 1;
      for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU + rot, L = L0 * (0.8 + 0.2 * Math.sin(t * 2 + i * 1.7)), hw = i % 2 ? 0.07 : 0.12; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an + hw) * L, y + Math.sin(an + hw) * L); ctx.lineTo(x + Math.cos(an - hw) * L, y + Math.sin(an - hw) * L); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 10; i++) { const an = (i / 10) * TAU - rot * 0.7 + 0.3, L = L0 * (0.7 + 0.25 * Math.sin(t * 1.6 + i * 2.3)), hw = 0.045; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an + hw) * L, y + Math.sin(an + hw) * L); ctx.lineTo(x + Math.cos(an - hw) * L, y + Math.sin(an - hw) * L); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = 1;
      glow(ctx, x, y, s * 1.5, S.rankC, 0.6 * a); glow(ctx, x, y, s * 0.7, mix(S.rankC, WHITE, 0.5), 0.5 * a); glow(ctx, x, y, s * 0.35, WHITE, 0.4 * a);
      ring(ctx, x, y, s * (0.66 + 0.03 * Math.sin(t * 5)), 2.5 * u, WHITE, a * (0.35 + 0.25 * Math.sin(t * 5)));
      ring(ctx, x, y, s * (0.82 + 0.04 * Math.sin(t * 3.5 + 1)), 2 * u, S.rankBright, a * 0.35);
      for (const m of S.halo) { const mx = x + Math.cos(m.a) * m.r * s, my = y + Math.sin(m.a) * m.r * s * 0.55; ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(t * 5 + m.ph)); ctx.fillStyle = rgba(m.c, 1); ctx.fillRect(Math.round(mx), Math.round(my), m.s, m.s); }
      for (const m of S.motes) { const f = 1 - m.age / m.life; ctx.globalAlpha = a * f * (0.6 + 0.4 * Math.sin(t * 8 + m.sw)); ctx.fillStyle = rgba(m.c, 1); ctx.fillRect(Math.round(m.x), Math.round(m.y), m.s, m.s); }
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = a;
      if (S.soulSprite) {
        ctx.drawImage(S.soulSprite, Math.round(x - s / 2), Math.round(y - s / 2), Math.round(s), Math.round(s));
        // it comes in as a figure of light and takes its colours as it settles
        const white = clamp(1 - q / 0.4); if (white > 0) { const m = mask(S, S.soulSprite, white); ctx.drawImage(m, Math.round(x - s / 2), Math.round(y - s / 2), Math.round(s), Math.round(s)); }
      }
      // the rank, letter by letter, then the soul's number
      if (t >= T.text) {
        const n = Math.min(S.rankName.length, Math.floor((t - T.text) / 0.045)), txt = S.rankName.slice(0, n).toUpperCase();
        ctx.font = `${Math.round(12 * u)}px "Press Start 2P", monospace`; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.globalAlpha = 1;
        const ty = Math.round(S.soulY + S.soulSize / 2 + 8 * u);
        ctx.fillStyle = "#0b0d0f"; ctx.fillText(txt, x + 2, ty + 2); ctx.fillStyle = rgba(S.rankBright, 1); ctx.fillText(txt, x, ty);
        const q2 = clamp((t - T.text - S.rankName.length * 0.045 - 0.1) / 0.3);
        if (q2 > 0) { ctx.globalAlpha = q2; ctx.font = `${Math.round(10 * u)}px "IBM Plex Mono", monospace`; ctx.fillStyle = "#c9c4b6"; ctx.fillText(`soul #${S.id} sealed`, x, ty + Math.round(20 * u)); }
      }
    }
    ctx.globalAlpha = 1;
  }
  function glow(ctx, x, y, r, c, a) {
    if (a <= 0 || r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(c, a)); g.addColorStop(0.45, rgba(c, a * 0.45)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function ring(ctx, x, y, r, w, c, a) {
    if (a <= 0 || r <= 0) return;
    ctx.globalAlpha = clamp(a); ctx.strokeStyle = rgba(c, 1); ctx.lineWidth = Math.max(1, w); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }
  function mask(S, sprite, a) {
    if (!S.maskC) { S.maskC = document.createElement("canvas"); S.maskC.width = sprite.width; S.maskC.height = sprite.height; }
    const g = S.maskC.getContext("2d"); g.clearRect(0, 0, sprite.width, sprite.height); g.globalCompositeOperation = "source-over"; g.drawImage(sprite, 0, 0);
    g.globalCompositeOperation = "source-in"; g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(0, 0, sprite.width, sprite.height);
    return S.maskC;
  }

  // ---------------------------------------------------------------- playing
  let live = null;
  async function prepare(opts) {
    const altar = opts.altar, W = altar.clientWidth, H = altar.clientHeight;
    const sprites = await Promise.all(opts.items.map((it) => (it ? keyedSprite(it.src) : null)));
    const soulSprite = await keyedSprite(opts.soulSrc);
    const cv = document.createElement("canvas"); cv.className = "rite"; cv.width = W; cv.height = H;
    const S = build({ ...opts, width: W, height: H }, sprites, soulSprite);
    return { cv, ctx: cv.getContext("2d"), S, sprites, soulSprite };
  }
  // Plays the rite over the altar and resolves when it ends; the canvas fades out on its own afterwards. `onBurst`
  // fires at the burst, the moment to change what the altar shows underneath.
  async function play(opts) {
    if (live) { live.stop = true; live.cv.remove(); live = null; }
    if (opts.altar.clientWidth < 60) return; // the station is not on screen: nothing to show
    const r = await prepare(opts); const { cv, ctx, S } = r;
    draw(S, ctx); // the first frame shows the items where they stand, so hiding the pedestal art never blinks
    opts.altar.appendChild(cv); opts.altar.classList.add("rite");
    live = r;
    return new Promise((done) => {
      let last = performance.now(), acc = 0, burstTold = false;
      const finish = () => { opts.altar.classList.remove("rite"); cv.style.opacity = "0"; setTimeout(() => { cv.remove(); if (live === r) live = null; }, 800); done(); };
      const loop = (now) => {
        if (r.stop) return;
        acc += Math.min(0.1, (now - last) / 1000); last = now;
        while (acc >= DT && !S.done) { step(S); acc -= DT; }
        if (S.burst && !burstTold) { burstTold = true; if (opts.onBurst) opts.onBurst(); }
        draw(S, ctx);
        if (S.done) finish(); else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }
  const api = { play, keyedSprite };
  // ?ritedev=1: build the rite from any set of items and render the frame at any moment, for captures
  if (new URLSearchParams(location.search).get("ritedev")) {
    api.dev = {
      // load once with the items and the soul; every frame(t) then rebuilds the simulation fresh and steps to t, so
      // frames come out the same in any order
      async load(opts) { const r = await prepare(opts); if (this.cv) this.cv.remove(); Object.assign(this, { cv: r.cv, ctx: r.ctx, sprites: r.sprites, soulSprite: r.soulSprite, opts }); opts.altar.appendChild(r.cv); opts.altar.classList.add("rite"); return r.S.T; },
      frame(t) { const S = build({ ...this.opts, width: this.cv.width, height: this.cv.height }, this.sprites, this.soulSprite); while (S.t < t - DT / 2 && !S.done) step(S); draw(S, this.ctx); this.S = S; return this.cv.toDataURL("image/png").split(",")[1]; },
      unload() { if (this.cv) this.cv.remove(); this.opts.altar.classList.remove("rite"); },
    };
  }
  return api;
})();
