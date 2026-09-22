// The forge: refining an ingredient in a furnace, drawn as a small scene over the page with the player's own furnace.
// Feeding plays when the refine is committed: the ingredients and the potion go into the firebox, the fire flares and the
// melt is sealed. Nothing about the outcome exists yet at that point, so nothing in it can hint at one. The melt plays
// when the craft is revealed: the heat builds the same way whatever comes next, then the door bursts and the ingredient of
// the next tier rises out of the light, or the fire chokes, smoke rolls out and a lump of slag cools on the floor.
// Fixed-step simulations with a seeded random, built on the toolkit of reveal.js (?vfxdev=1 renders any moment).
window.AlchForge = (() => {
  const R = window.AlchReveal && window.AlchReveal.fx;
  if (!R) return null;
  const { DT, TAU, clamp, lerp, smooth, outCubic, inCubic, outBack, rng, rgba, mix, glow, arcRing, dots, rays, text, upd, prune, sil, keyed, tierColor, run, visible, reduce } = R;
  const WHITE = [255, 255, 255], GOLD = [242, 196, 85], INK = [233, 228, 214], SOFT = [176, 170, 154], ASH = [224, 122, 111], GLASS = [191, 233, 255];
  const TIERS = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary"];

  // Where the fire and the flue are on each furnace, in cells of its 64px art: firebox [x, y, w, h] (centre and size),
  // the top of the flue, the lowest row of the art, and the colour its fire burns (the brass furnace burns green).
  const FURN = {
    1: { door: [24, 41, 12, 14], chim: [31, 6], maxY: 57, fire: "orange" },
    2: { door: [22.5, 41, 20, 15], chim: [31, 4], maxY: 60, fire: "orange" },
    3: { door: [20, 46, 14, 11], chim: [46, 3], maxY: 60, fire: "green" },
    4: { door: [29, 50, 8, 10], chim: [31, 3], maxY: 61, fire: "orange" },
  };
  const FIRE = {
    orange: [[70, 18, 8], [190, 60, 20], [255, 140, 40], [255, 214, 110], [255, 248, 225]],
    green: [[24, 50, 24], [80, 150, 60], [180, 225, 110], [232, 250, 185], [255, 255, 240]],
  };
  const fireAt = (S, h) => { const p = FIRE[S.F.fire], x = clamp(h) * (p.length - 1), i = Math.min(p.length - 2, Math.floor(x)); return mix(p[i], p[i + 1], x - i); };
  const arc = (a, b, lift, p) => { const m = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift], q = 1 - p; return [q * q * a[0] + 2 * q * p * m[0] + p * p * b[0], q * q * a[1] + 2 * q * p * m[1] + p * p * b[1]]; };

  // The furnace art has its fire painted in. A mask of those pixels (warm and bright, or green and bright for the brass
  // furnace, inside the firebox) lets the painted fire go dark with the real one.
  const masks = new Map();
  function fireMask(sprite, F) {
    if (!sprite) return null; if (masks.has(sprite)) return masks.get(sprite);
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); g.drawImage(sprite, 0, 0);
    const id = g.getImageData(0, 0, 64, 64), d = id.data, [cx, cy, w, h] = F.door;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2], inside = Math.abs(x - cx) <= w / 2 + 1 && Math.abs(y - cy) <= h / 2 + 1;
      const hot = F.fire === "green" ? gg > 150 && gg >= b && r > 120 : r > 150 && r - b > 70 && gg > 60;
      if (!(inside && hot && d[i + 3] > 0)) d[i + 3] = 0;
    }
    g.putImageData(id, 0, 0); masks.set(sprite, c); return c;
  }

  // ---------------------------------------------------------------- the room and the furnace
  function scene(o, spr) {
    const W = o.width, H = o.height, rand = rng(o.seed || 3), F = FURN[clamp(o.furnace | 0, 1, 4)];
    const s = Math.max(2, Math.floor((H * 0.78) / 64)), floor = Math.round(H * 0.84), fx = Math.round(W * 0.33);
    const sx0 = fx - 32 * s, sy0 = floor + 3 * s - (F.maxY + 1) * s;
    const S = {
      t: 0, W, H, rand, drand: rng(9), F, s, floor, sx0, sy0, RX: Math.round(W * 0.73), furnace: spr.furnace, mask: fireMask(spr.furnace, F),
      door: [sx0 + F.door[0] * s, sy0 + F.door[1] * s, F.door[2] * s, F.door[3] * s], chim: [sx0 + F.chim[0] * s, sy0 + F.chim[1] * s],
      heat: 0.25, shake: 0, flames: [], burst: [], embers: [], smoke: [], sparks: [], shards: [], rings: [], trail: [], cache: new Map(), done: false,
    };
    S.bg = backdrop(S, rand);
    return S;
  }
  // a brick wall and a flagstone floor, drawn once on the pixel scale of the furnace
  function backdrop(S, rand) {
    const c = document.createElement("canvas"); c.width = S.W; c.height = S.H; const g = c.getContext("2d");
    g.fillStyle = "#0c0e11"; g.fillRect(0, 0, S.W, S.H);
    const b = S.s, bw = b * 14, bh = b * 6;
    for (let y = 0, row = 0; y < S.floor; y += bh, row++) for (let x = row % 2 ? -bw / 2 : 0; x < S.W; x += bw) {
      const v = 21 + Math.floor(rand() * 8), X = Math.round(x);
      g.fillStyle = `rgb(${v + 3},${v + 2},${v + 5})`; g.fillRect(X + b, y + b, bw - b, bh - b);
      g.fillStyle = "rgba(255,255,255,0.035)"; g.fillRect(X + b, y + b, bw - b, b);
    }
    g.fillStyle = "#121417"; g.fillRect(0, S.floor, S.W, S.H - S.floor);
    for (let x = (S.W % (bw * 2)) / 2; x < S.W; x += bw * 2) { g.fillStyle = "#0a0b0d"; g.fillRect(Math.round(x), S.floor, b, S.H - S.floor); }
    g.fillStyle = "#1d2025"; g.fillRect(0, S.floor, S.W, b);
    const v = g.createRadialGradient(S.W * 0.4, S.H * 0.55, S.H * 0.2, S.W * 0.4, S.H * 0.55, S.W * 0.78); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.72)");
    g.fillStyle = v; g.fillRect(0, 0, S.W, S.H);
    return c;
  }

  // the fire in the box and the flue, driven by S.heat (0 dead coals .. 1 white-hot)
  function stepFire(S) {
    const { rand, s } = S, [dx, dy, dw, dh] = S.door, h = S.heat;
    const n = Math.round(1 + h * 4);
    for (let i = 0; i < n; i++) if (rand() < 0.25 + h * 0.65) S.flames.push({ x: dx + (rand() - 0.5) * dw * 0.9, y: dy + dh * 0.42, vx: (rand() - 0.5) * 6 * s, vy: -(8 + rand() * 18 + h * 30) * s, g: 0, life: 0.25 + rand() * 0.35, age: 0, top: dy - dh * 0.5 });
    if (h > 0.12 && rand() < 0.04 + h * 0.45) S.embers.push({ x: S.chim[0] + (rand() - 0.5) * 3 * s, y: S.chim[1], vx: (rand() - 0.5) * 8 * s, vy: -(12 + rand() * 20 + h * 22) * s, g: -2 * s, life: 1 + rand() * 1.2, age: 0, sw: rand() * TAU });
    for (const f of S.flames) if (f.y < f.top) f.age = f.life;
    upd(S.flames, 0.4); upd(S.embers, 0.9); upd(S.burst, 0.35); upd(S.sparks, 0.3); upd(S.shards, 0.7, 300 * s); upd(S.trail, 0.05);
    for (const e of S.embers) e.x += Math.sin(S.t * 3 + e.sw) * 6 * s * DT;
    for (const q of S.smoke) { q.age += DT; q.x += q.vx * DT; q.y += q.vy * DT; q.vx *= Math.pow(0.4, DT); q.vy *= Math.pow(0.6, DT); q.r += q.gr * DT; }
    for (const q of S.sparks) if (q.bounce && q.y > S.floor + 2 * s && q.vy > 0) { q.y = S.floor + 2 * s; q.vy *= -0.35; q.vx *= 0.6; }
    for (const r of S.rings) r.age += DT;
    prune(S, ["flames", "embers", "burst", "sparks", "shards", "trail", "smoke", "rings"]);
    S.shake *= Math.pow(0.003, DT);
  }

  function drawRoom(S, ctx) {
    const { W, H, s, t } = S, [dx, dy, dw, dh] = S.door, h = S.heat;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false; ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.drawImage(S.bg, 0, 0);
    if (S.shake > 0.4) ctx.translate(Math.round((S.drand() - 0.5) * 2 * S.shake), Math.round((S.drand() - 0.5) * 2 * S.shake));
    // the fire lights the wall and the floor
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, dx, dy, W * 0.55 * (0.35 + 0.65 * h), fireAt(S, 0.55), 0.08 + 0.26 * h);
    glow(ctx, dx + dw, S.floor + 4 * s, W * 0.4 * (0.4 + 0.6 * h), fireAt(S, 0.6), 0.1 + 0.22 * h);
    // the furnace, shimmering in its own heat (rows sway more towards the top)
    ctx.globalCompositeOperation = "source-over";
    if (S.furnace) {
      // heat haze: only above the firebox, where the hot air rises, stronger towards the flue
      const amp = h * h * 0.55 * s, top = S.F.door[1] - S.F.door[3] / 2;
      for (let r = 0; r < 64; r++) { const up = clamp((top - r) / top), off = amp > 0.4 && up > 0 ? Math.round(Math.sin(t * 8 + r * 0.5) * amp * up) : 0; ctx.drawImage(S.furnace, 0, r, 64, 1, S.sx0 + off, S.sy0 + r * s, 64 * s, s); }
      const out = clamp((0.5 - h) / 0.42); if (S.mask && out > 0) ctx.drawImage(sil(S, S.mask, [20, 14, 11], 0.92 * out), S.sx0, S.sy0, 64 * s, 64 * s);
    }
    // the firebox: a glow, a hot core, pixel flames
    ctx.globalCompositeOperation = "lighter";
    const dr = Math.min(dw, 13 * s); // a wide grate should not wash the whole furnace white
    glow(ctx, dx, dy, dr * (0.9 + 1.5 * h), fireAt(S, 0.35 + 0.6 * h), 0.35 + 0.55 * h);
    glow(ctx, dx, dy, dr * 0.55, fireAt(S, 0.75 + 0.25 * h), 0.2 + 0.7 * h * h);
    for (const f of S.flames) { const q = f.age / f.life; ctx.globalAlpha = 1 - q * 0.6; ctx.fillStyle = rgba(fireAt(S, clamp(h + 0.35 - q * 0.9)), 1); ctx.fillRect(Math.round(f.x / s) * s, Math.round(f.y / s) * s, s, s); }
    for (const e of S.embers) { ctx.globalAlpha = (1 - e.age / e.life) * (0.6 + 0.4 * Math.sin(t * 12 + e.sw)); ctx.fillStyle = rgba(fireAt(S, 0.7), 1); ctx.fillRect(Math.round(e.x / s) * s, Math.round(e.y / s) * s, s, s); }
    ctx.globalAlpha = 1;
  }
  // everything thrown out of the fire: bursts of flame, sparks, glass, rings of heat, smoke
  function drawThrown(S, ctx) {
    const { s } = S;
    ctx.globalCompositeOperation = "lighter";
    for (const r of S.rings) { if (r.age < 0) continue; const q = r.age / r.life, rad = lerp(r.r0, r.r1, outCubic(q)); arcRing(ctx, r.x, r.y, rad, 3 * s, r.c, (1 - q) * 0.25); dots(ctx, r.x, r.y, rad, s, mix(r.c, WHITE, 0.5), 1 - q); }
    for (const f of S.burst) { const q = f.age / f.life; ctx.globalAlpha = 1 - q; ctx.fillStyle = rgba(f.c || fireAt(S, clamp(0.88 - q * 0.8)), 1); const z = (f.z || 2) * s; ctx.fillRect(Math.round(f.x / s) * s, Math.round(f.y / s) * s, z, z); }
    for (const q of S.sparks) { ctx.globalAlpha = 1 - q.age / q.life; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(Math.round(q.x / s) * s, Math.round(q.y / s) * s, (q.z || 1) * s, (q.z || 1) * s); }
    for (const q of S.trail) { const a = 1 - q.age / q.life; ctx.globalAlpha = a * a; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(Math.round(q.x / s) * s, Math.round(q.y / s) * s, s, s); }
    ctx.globalCompositeOperation = "source-over";
    for (const q of S.shards) { ctx.globalAlpha = 1 - q.age / q.life; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(Math.round(q.x / s) * s, Math.round(q.y / s) * s, s, s); }
    for (const q of S.smoke) { const a = (1 - q.age / q.life) * q.a; if (a <= 0) continue; const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r); g.addColorStop(0, rgba(q.c, a)); g.addColorStop(1, rgba(q.c, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(q.x - q.r, q.y - q.r, q.r * 2, q.r * 2); }
    ctx.globalAlpha = 1;
  }
  function flare(S, n, spread, up, c) {
    const { rand, s } = S, [dx, dy] = S.door;
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (rand() - 0.5) * spread, v = (40 + rand() * up) * s; S.burst.push({ x: dx + (rand() - 0.5) * S.door[2] * 0.6, y: dy, vx: Math.cos(a) * v + 12 * s, vy: Math.sin(a) * v, g: -30 * s, life: 0.35 + rand() * 0.5, age: 0, z: rand() < 0.25 ? 3 : rand() < 0.6 ? 2 : 1, c }); }
  }
  function chimneyJet(S, n, c) { const { rand, s } = S; for (let i = 0; i < n; i++) S.burst.push({ x: S.chim[0] + (rand() - 0.5) * 3 * s, y: S.chim[1], vx: (rand() - 0.5) * 50 * s, vy: -(35 + rand() * 80) * s, g: 30 * s, life: 0.5 + rand() * 0.6, age: 0, z: 1, c: c || fireAt(S, 0.5 + rand() * 0.35) }); }
  // a plate of words at x (centred) from y down: [[text, font, colour], ...]
  function plate(S, ctx, x, y, lines, a, border) {
    if (a <= 0) return;
    let w = 0, h = 14; for (const [s, f] of lines) { ctx.font = f; w = Math.max(w, ctx.measureText(s).width + s.length); h += parseInt(f, 10) + 8; }
    const pw = Math.round(w + 28), x0 = Math.round(x - pw / 2), y0 = Math.round(y);
    ctx.globalAlpha = a; ctx.fillStyle = "#0b0d0f"; ctx.fillRect(x0 + 4, y0 + 4, pw, h); ctx.fillStyle = "rgba(11,13,15,.9)"; ctx.fillRect(x0, y0, pw, h);
    ctx.strokeStyle = rgba(border, 1); ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, pw - 2, h - 2);
    let yy = y0 + 10; for (const [s, f, c, custom] of lines) { if (custom) custom(ctx, x, yy, a); else text(ctx, s, x, yy, f, c, a, false, 1); yy += parseInt(f, 10) + 8; }
  }
  const pix = (n) => `${n}px "Press Start 2P", monospace`, mono = (n) => `${n}px "IBM Plex Mono", monospace`;
  const fs = (S, base) => Math.max(9, Math.round((base * S.W) / 720));

  // ================================================================ feeding the furnace (the commit)
  // o: { furnace 1..4, ingSrc, potionSrc, n, tier, name, seed }
  function buildFeed(o, spr) {
    const S = scene(o, spr);
    S.mode = "feed"; S.ing = spr.ing; S.potion = spr.potion; S.n = clamp(o.n | 0, 1, 12); S.tier = clamp(o.tier | 0, 1, 5); S.c = tierColor(S.tier); S.name = o.name || "";
    const IS = Math.round(Math.min(S.W * 0.075, S.H * 0.13)), cols = Math.min(5, S.n), rows = Math.ceil(S.n / cols), sp = Math.round(IS * 1.12);
    const gx0 = S.RX - ((cols - 1) * sp) / 2, gy0 = Math.round(S.H * 0.4 - ((rows - 1) * sp) / 2);
    S.IS = IS; S.gy0 = gy0;
    S.items = Array.from({ length: S.n }, (_, i) => ({ x0: gx0 + (i % cols) * sp, y0: gy0 + Math.floor(i / cols) * sp, dep: 1.0 + i * 0.12, pop: 0.35 + i * 0.03 }));
    S.pot = { x0: S.RX, y0: gy0 + rows * sp + Math.round(IS * 0.25), dep: 1.0 + (S.n - 1) * 0.12 + 0.35, pop: 0.35 + S.n * 0.03 };
    const T = { flight: 0.55, pflight: 0.7 }; T.flare = S.pot.dep + T.pflight; T.text = T.flare + 0.6; T.end = T.flare + 3.2;
    S.T = T; S.arrived = 0;
    return S;
  }
  function stepFeed(S) {
    const { T, rand, s } = S, t = (S.t += DT), [dx, dy] = S.door;
    const base = 0.25 + 0.035 * S.arrived, q = t - T.flare;
    S.heat = q < 0 ? base : q < 0.2 ? lerp(base, 1, q / 0.2) : lerp(1, 0.62, smooth((q - 0.2) / 1.3));
    for (const it of S.items) {
      const p = (t - it.dep) / T.flight;
      if (p > 0 && p < 1 && rand() < 0.7) { const [x, y] = arc([it.x0, it.y0], [dx, dy], S.H * 0.18, smooth(p)); S.trail.push({ x, y, vx: 0, vy: -8 * s, g: 0, life: 0.3, age: 0, c: rand() < 0.5 ? WHITE : mix(S.c, WHITE, 0.4) }); }
      if (p >= 1 && !it.in) { it.in = true; S.arrived++; flare(S, 8, 1.4, 60, null); for (let i = 0; i < 6; i++) S.sparks.push({ x: dx, y: dy, vx: (rand() - 0.5) * 80 * s, vy: -rand() * 60 * s, g: 120 * s, life: 0.4 + rand() * 0.3, age: 0, c: fireAt(S, 0.8) }); }
    }
    const pp = (t - S.pot.dep) / T.pflight;
    if (pp > 0 && pp < 1 && rand() < 0.8) { const [x, y] = arc([S.pot.x0, S.pot.y0], [dx, dy], S.H * 0.32, smooth(pp)); S.trail.push({ x, y, vx: 0, vy: -8 * s, g: 0, life: 0.35, age: 0, c: rand() < 0.5 ? WHITE : GLASS }); }
    if (t >= T.flare && !S.flared) {
      // the potion breaks in the firebox: glass, a splash of its colour, and the fire roars
      S.flared = true; S.shake = 1.4 * s;
      for (let i = 0; i < 26; i++) { const a = rand() * TAU, v = (40 + rand() * 120) * s; S.shards.push({ x: dx, y: dy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * s, life: 0.6 + rand() * 0.5, age: 0, c: i % 3 ? GLASS : mix(S.c, WHITE, 0.3) }); }
      flare(S, 60, 1.6, 170, null); chimneyJet(S, 36, null);
      S.rings.push({ x: dx, y: dy, r0: 4 * s, r1: 34 * s, life: 0.5, age: 0, c: fireAt(S, 0.9) }, { x: dx, y: dy, r0: 4 * s, r1: 22 * s, life: 0.4, age: -0.08, c: WHITE });
      S.flash = t;
    }
    stepFire(S);
    if (t >= T.end) S.done = true;
  }
  function drawFeed(S, ctx) {
    const { T, t, IS, s } = S, [dx, dy] = S.door;
    drawRoom(S, ctx);
    if (S.flash && t - S.flash < 0.4) { const q = (t - S.flash) / 0.4; glow(ctx, dx, dy, S.door[2] * 4 * (0.5 + q), WHITE, 0.8 * (1 - q) * (1 - q)); }
    drawThrown(S, ctx);
    // the ingredients laid out, then one by one into the fire; the potion last, spinning
    ctx.globalCompositeOperation = "source-over";
    const drawIt = (spr, it, flight, lift, spin) => {
      if (!spr) return; const pop = outBack(clamp((t - it.pop) / 0.3)); if (pop <= 0.01) return;
      const p = (t - it.dep) / flight; if (p >= 1) return;
      let x = it.x0, y = it.y0 + Math.sin(t * 2.4 + it.x0) * 1.5, sc = pop, rot = 0;
      if (p > 0) { const e = smooth(p); [x, y] = arc([it.x0, it.y0], [dx, dy], lift, e); sc = lerp(1, 0.3, e); rot = spin * p; }
      const z = IS * sc; ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = 1; ctx.drawImage(spr, -z / 2, -z / 2, z, z); ctx.restore();
    };
    ctx.globalCompositeOperation = "lighter";
    const lineupA = 1 - clamp((t - S.pot.dep) / 0.4);
    if (lineupA > 0) glow(ctx, S.RX, S.gy0 + IS * 0.6, IS * 3.2, S.c, 0.12 * lineupA * clamp((t - 0.35) / 0.3));
    ctx.globalCompositeOperation = "source-over";
    for (const it of S.items) drawIt(S.ing, it, T.flight, S.H * 0.18, 0.9 * TAU * 0.3);
    drawIt(S.potion, S.pot, T.pflight, S.H * 0.32, TAU * 1.5);
    // words: what goes in, then that the melt is sealed
    const a1 = clamp((t - 0.3) / 0.3) * lineupA;
    text(ctx, "INTO THE FURNACE", S.RX, S.gy0 - IS / 2 - fs(S, 14) - fs(S, 12) - 18, pix(fs(S, 11)), GOLD, a1, true, 2);
    text(ctx, `${S.n} × ${TIERS[S.tier]} ${S.name} and a potion`, S.RX, S.gy0 - IS / 2 - fs(S, 14) - 8, mono(fs(S, 14)), INK, a1, true);
    const a2 = clamp((t - T.text) / 0.5);
    if (a2 > 0) plate(S, ctx, S.RX, S.H * 0.3, [["THE MELT IS SEALED", pix(fs(S, 12)), GOLD], ["reveal it after the next minute", mono(fs(S, 14)), INK], ["under My finds · Reveal crafts", mono(fs(S, 12)), SOFT]], a2, fireAt(S, 0.6));
    if (t > T.text + 0.6) text(ctx, "click to close", S.W - 70, S.H - 22, mono(11), SOFT, 0.55 * clamp((t - T.text - 0.6) / 0.4), false);
    ctx.globalAlpha = 1;
  }

  // ================================================================ the melt (the reveal)
  // o: { furnace 1..4, outSrc (the ingredient of the next tier), tier (going in), success, name, seed }
  function buildMelt(o, spr) {
    const S = scene(o, spr);
    S.mode = "melt"; S.out = spr.out; S.success = !!o.success; S.tier = clamp(o.tier | 0, 1, 4); S.cIn = tierColor(S.tier); S.cOut = tierColor(S.tier + 1); S.name = o.name || "";
    S.heat = 0.62; S.IS = Math.round(Math.min(S.H * 0.34, S.W * 0.22));
    const T = { beat: 2.35 }; T.item = T.beat + 0.08; T.label = T.beat + 0.8; T.end = T.beat + 3.6; S.T = T;
    S.pulses = [0.55, 1.05, 1.45, 1.78, 2.03, 2.2]; S.pulsed = 0;
    if (!S.success) { // a lump of slag: a seeded blob, cracks that glow and cool
      const rand = S.rand, w = 18, h = 11, cells = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const nx = (x - w / 2 + 0.5) / (w / 2), ny = (y - h + 0.5) / h; if (nx * nx + ny * ny * 1.1 < 0.9 + (rand() - 0.5) * 0.35) cells.push([x, y]); }
      const set = new Set(cells.map(([x, y]) => x + "," + y)), edge = cells.filter(([x, y]) => !set.has(x - 1 + "," + y) || !set.has(x + 1 + "," + y) || !set.has(x + "," + (y - 1)) || !set.has(x + "," + (y + 1)));
      let cx = 3 + Math.floor(rand() * 3), cy = Math.floor(h * 0.55); const cracks = [];
      for (let i = 0; i < 16; i++) { cx += rand() < 0.75 ? 1 : 0; cy = clamp(cy + (rand() < 0.45 ? (rand() < 0.5 ? 1 : -1) : 0), 3, h - 3); if (set.has(cx + "," + cy)) cracks.push([cx, cy]); }
      for (let i = 0; i < 6; i++) { const [x, y] = cells[Math.floor(rand() * cells.length)]; if (y > 2 && y < h - 2) cracks.push([x, y]); }
      S.slag = { w, h, cells, edge: new Set(edge.map(([x, y]) => x + "," + y)), cracks };
    }
    return S;
  }
  const slagAt = (S, t) => { // out of the firebox, a drop to the floor and a roll to the right with two bounces
    const t0 = S.T.beat + 0.25, p = clamp((t - t0) / 1.2), [dx, dy, , dh] = S.door, x0 = dx + S.door[2] * 0.2, x1 = S.RX - S.W * 0.06, yF = S.floor + 2 * S.s;
    const x = lerp(x0, x1, outCubic(p)), fall = clamp(p / 0.22), bounce = p > 0.22 ? Math.abs(Math.sin(((p - 0.22) / 0.78) * Math.PI * 2)) * (1 - p) * 14 * S.s : 0;
    return [x, p < 0.22 ? lerp(dy + dh * 0.3, yF, inCubic(fall)) : yF - bounce, p];
  };
  function stepMelt(S) {
    const { T, rand, s } = S, t = (S.t += DT), [dx, dy, dw] = S.door;
    if (t < T.beat) {
      // the heat builds to a beat that quickens, the same whatever comes next
      let h = lerp(0.62, 0.95, smooth((t - 0.3) / 2.05));
      for (const p of S.pulses) if (t >= p && t < p + 0.18) h += 0.12 * (1 - (t - p) / 0.18);
      S.heat = clamp(h);
      while (S.pulsed < S.pulses.length && t >= S.pulses[S.pulsed]) { S.pulsed++; S.shake = Math.max(S.shake, (0.4 + 0.18 * S.pulsed) * s); chimneyJet(S, 4 + S.pulsed * 2, null); }
    } else if (S.success) {
      S.heat = lerp(1, 0.85, smooth((t - T.beat) / 1.2));
      if (!S.hit) {
        S.hit = true; S.shake = 2 * s;
        flare(S, 70, 1.8, 200, null); chimneyJet(S, 30, null);
        S.rings.push({ x: dx, y: dy, r0: 6 * s, r1: 60 * s, life: 0.6, age: 0, c: WHITE }, { x: dx, y: dy, r0: 6 * s, r1: 44 * s, life: 0.55, age: -0.1, c: S.cOut });
        for (let i = 0; i < 80; i++) { const a = rand() * TAU, v = (50 + Math.pow(rand(), 0.7) * 220) * s * 0.5; S.sparks.push({ x: dx, y: dy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30 * s, g: 80 * s, life: 0.6 + rand() * 0.9, age: 0, c: rand() < 0.35 ? WHITE : rand() < 0.6 ? mix(S.cOut, WHITE, 0.4) : GOLD, bounce: true }); }
      }
      if (t > T.item + 0.9 && t < T.end - 0.3 && rand() < 0.3) { const [x, y] = itemAt(S, t); S.sparks.push({ x: x + (rand() - 0.5) * S.IS * 0.8, y: y + S.IS * 0.3, vx: 0, vy: -(10 + rand() * 20) * s, g: 0, life: 0.9 + rand() * 0.5, age: 0, c: rand() < 0.5 ? WHITE : mix(S.cOut, WHITE, 0.4) }); }
    } else {
      // the fire chokes: the light falls in, smoke rolls out of the box and the flue, embers spill, the slag drops out
      S.heat = lerp(Math.min(1, S.heatAtBeat || 1), 0.06, smooth((t - T.beat) / 0.35));
      if (t > T.beat + 1.3 && t < T.end && rand() < 0.35) { const [x, y] = slagAt(S, t); S.smoke.push({ x: x + (rand() - 0.5) * 8 * s, y: y - 10 * s, vx: (rand() - 0.5) * 6 * s, vy: -(14 + rand() * 12) * s, r: 2 * s, gr: 5 * s, life: 1.2, age: 0, a: 0.35, c: [110, 110, 112] }); }
      if (!S.hit) {
        S.hit = true; S.shake = 2.2 * s;
        for (let i = 0; i < 40; i++) S.smoke.push({ x: dx + (rand() - 0.2) * dw, y: dy + (rand() - 0.5) * S.door[3], vx: (20 + rand() * 70) * s, vy: -(10 + rand() * 34) * s, r: (4 + rand() * 6) * s, gr: (9 + rand() * 12) * s, life: 1.8 + rand() * 1.6, age: -rand() * 0.3, a: 0.65 + rand() * 0.3, c: rand() < 0.5 ? [34, 36, 40] : [58, 60, 64] });
        for (let i = 0; i < 22; i++) S.smoke.push({ x: S.chim[0] + (rand() - 0.5) * 3 * s, y: S.chim[1], vx: (rand() - 0.3) * 20 * s, vy: -(20 + rand() * 30) * s, r: (3 + rand() * 4) * s, gr: (6 + rand() * 8) * s, life: 1.8 + rand() * 1.2, age: -rand() * 0.4, a: 0.5 + rand() * 0.3, c: [44, 46, 50] });
        for (let i = 0; i < 34; i++) { const a = -Math.PI / 2 + (rand() - 0.2) * 2.2, v = (30 + rand() * 90) * s; S.sparks.push({ x: dx, y: dy + S.door[3] * 0.3, vx: Math.cos(a) * v + 30 * s, vy: Math.sin(a) * v, g: 240 * s, life: 0.9 + rand() * 1.1, age: 0, c: fireAt(S, 0.5 + rand() * 0.3), bounce: true }); }
      }
    }
    if (t < T.beat) S.heatAtBeat = S.heat;
    stepFire(S);
    if (t >= T.end) S.done = true;
  }
  function itemAt(S, t) { // out of the door, up and across to the right, growing
    const [dx, dy] = S.door, p = clamp((t - S.T.item) / 0.95), e = outCubic(p);
    const [x, y] = arc([dx, dy], [S.RX, S.H * 0.4], S.H * 0.22, e);
    return [x, y + (p >= 1 ? Math.sin((t - S.T.item - 0.95) * 2.4) * 1.5 * S.s * 0.5 : 0), S.IS * lerp(0.2, 1, outBack(p)), p];
  }
  function drawMelt(S, ctx) {
    const { T, t, s, IS } = S, [dx, dy, dw] = S.door;
    drawRoom(S, ctx);
    ctx.globalCompositeOperation = "lighter";
    // white heat at the door in the last moments before the beat
    if (t < T.beat) { const q = clamp((t - 1.6) / (T.beat - 1.6)); glow(ctx, dx, dy, dw * 2.4, WHITE, 0.35 * q * q); }
    if (S.success && t >= T.beat) {
      const sb = t - T.beat;
      if (sb < 0.45) glow(ctx, dx, dy, dw * (3 + 5 * outCubic(sb / 0.45)), WHITE, 0.95 * (1 - sb / 0.45) ** 2);
      // a beam of the new tier's light rises out of the box
      if (sb < 1.6) { const env = sb < 0.15 ? sb / 0.15 : 1 - smooth((sb - 0.15) / 1.45), w = dw * (0.7 + 0.5 * env), g = ctx.createLinearGradient(dx - w, 0, dx + w, 0); g.addColorStop(0, rgba(S.cOut, 0)); g.addColorStop(0.5, rgba(mix(S.cOut, WHITE, 0.6), 0.75 * env)); g.addColorStop(1, rgba(S.cOut, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(dx - w, 0, w * 2, dy); }
      if (sb < 1.4) rays(ctx, dx, dy, 14, S.W * 0.42 * (0.6 + 0.4 * outCubic(sb / 0.4)), 0.05, 0.4 * sb, WHITE, mix(S.cOut, WHITE, 0.45), 0.5 * Math.sin(Math.PI * clamp(sb / 1.4)));
      const [x, y, z, p] = itemAt(S, t);
      if (S.tier + 1 >= 4) rays(ctx, x, y, 12, z * 1.1, 0.09, 0.3 * sb, WHITE, mix(S.cOut, WHITE, 0.45), 0.3 * p);
      glow(ctx, x, y, z * 0.95, S.cOut, 0.45 * clamp(p * 2)); glow(ctx, x, y, z * 0.45, mix(S.cOut, WHITE, 0.5), 0.3 * clamp(p * 2));
      if (S.tier + 1 >= 3) dots(ctx, x, y, z * 0.64, s, mix(S.cOut, WHITE, 0.5), (0.3 + 0.2 * Math.sin(t * 4)) * p, t * 0.6);
    }
    drawThrown(S, ctx);
    ctx.globalCompositeOperation = "source-over";
    if (S.success && t >= T.item && S.out) {
      const [x, y, z, p] = itemAt(S, t), r = [Math.round(x - z / 2), Math.round(y - z / 2), Math.round(z), Math.round(z)];
      ctx.globalAlpha = 1; ctx.drawImage(S.out, ...r);
      const wIn = clamp(1 - p / 0.45); if (wIn > 0) ctx.drawImage(sil(S, S.out, WHITE, wIn), ...r);
    }
    if (!S.success && S.slag && t >= T.beat + 0.25) {
      const [x, y] = slagAt(S, t), sl = S.slag, z = s, x0 = Math.round(x - (sl.w * z) / 2), y0 = Math.round(y - sl.h * z), cool = clamp((t - T.beat - 0.8) / 2.4);
      for (const [cx, cy] of sl.cells) { ctx.fillStyle = sl.edge.has(cx + "," + cy) ? "#141210" : cy < 3 ? "#5a534b" : cy > sl.h - 4 ? "#24211d" : "#3a3530"; ctx.fillRect(x0 + cx * z, y0 + cy * z, z, z); }
      ctx.globalCompositeOperation = "lighter";
      const hot = mix([255, 150, 40], [60, 44, 34], cool);
      for (const [cx, cy] of sl.cracks) { ctx.globalAlpha = 1; ctx.fillStyle = rgba(hot, 1); ctx.fillRect(x0 + cx * z, y0 + cy * z, z, z); }
      glow(ctx, x, y - (sl.h * z) / 2, sl.w * z * 1.2, [255, 120, 30], 0.45 * (1 - cool));
      ctx.globalCompositeOperation = "source-over";
    }
    // the words
    const a = clamp((t - T.label) / 0.4);
    if (a > 0) {
      if (S.success) {
        const f2 = pix(fs(S, 13)), tin = TIERS[S.tier].toUpperCase(), tout = TIERS[S.tier + 1].toUpperCase();
        const tiers = (c, x, y, al) => { c.font = f2; const w1 = c.measureText(tin).width, w2 = c.measureText(tout).width, gap = fs(S, 13) * 2.4, x0 = x - (w1 + gap + w2) / 2; c.textAlign = "left"; c.textBaseline = "top"; c.globalAlpha = al; c.fillStyle = rgba(mix(S.cIn, WHITE, 0.35), 1); c.fillText(tin, x0, y); c.fillStyle = rgba(mix(S.cOut, WHITE, 0.35), 1); c.fillText(tout, x0 + w1 + gap, y); const ax = x0 + w1 + gap * 0.2, aw = gap * 0.6, ay = y + fs(S, 13) / 2; c.fillStyle = rgba(INK, 1); c.fillRect(Math.round(ax), Math.round(ay - 1), Math.round(aw), 3); c.fillRect(Math.round(ax + aw - 5), Math.round(ay - 4), 3, 9); c.fillRect(Math.round(ax + aw - 2), Math.round(ay - 2), 3, 5); };
        plate(S, ctx, S.RX, S.H * 0.4 + IS / 2 + 14, [["REFINED", pix(fs(S, 11)), GOLD], [`${tin} ${tout}   `, f2, WHITE, tiers], [S.name, mono(fs(S, 15)), INK]], a, S.cOut);
      } else plate(S, ctx, S.RX, S.H * 0.22, [["THE MELT DID NOT TAKE", pix(fs(S, 12)), ASH], ["the ingredients burned away", mono(fs(S, 14)), INK], ["the furnace cools", mono(fs(S, 12)), SOFT]], a, [120, 70, 60]);
      if (t > T.label + 0.8) text(ctx, "click to close", S.W - 70, S.H - 22, mono(11), SOFT, 0.55 * clamp((t - T.label - 0.8) / 0.4), false);
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================ playing
  // One scene at a time in a framed window over the page; a scene that arrives while the tab is hidden waits for it.
  // A click before the moment skips to it (the potion breaking, the door bursting); after it, a click closes.
  let queue = Promise.resolve();
  function open() {
    const box = document.createElement("div"); box.className = "forge"; box.setAttribute("role", "dialog"); box.tabIndex = -1;
    const frame = document.createElement("div"); frame.className = "forge-frame"; const cv = document.createElement("canvas"); frame.appendChild(cv); box.appendChild(frame); document.body.appendChild(box);
    const W = Math.min(720, Math.floor(innerWidth * 0.94)), H = Math.round(W * 0.62); cv.width = W; cv.height = H; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    return { box, cv, ctx: cv.getContext("2d"), W, H };
  }
  async function sprites(kind, o) {
    const furnace = await keyed(`img/furnace-${clamp(o.furnace | 0, 1, 4)}.png`);
    if (kind === "feed") { const [ing, potion] = await Promise.all([keyed(o.ingSrc), keyed(o.potionSrc)]); return { furnace, ing, potion }; }
    return { furnace, out: o.outSrc ? await keyed(o.outSrc) : null };
  }
  function play(kind, o) {
    const job = queue.then(async () => {
      await visible();
      const spr = await sprites(kind, o), { box, cv, ctx, W, H } = open();
      box.setAttribute("aria-label", kind === "feed" ? "The melt is sealed" : o.success ? "Refined" : "The melt did not take");
      const build = kind === "feed" ? buildFeed : buildMelt, step = kind === "feed" ? stepFeed : stepMelt, draw = kind === "feed" ? drawFeed : drawMelt;
      const S = build({ ...o, width: W, height: H }, spr), moment = kind === "feed" ? S.T.flare : S.T.beat;
      let closeStill = null;
      const skip = () => { if (reduce) { if (closeStill) closeStill(); return; } if (S.t < moment - 0.1) { while (S.t < moment - 0.05) step(S); } else if (S.t > moment + 0.8) S.done = true; };
      const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); skip(); } };
      box.addEventListener("click", skip); addEventListener("keydown", onKey);
      requestAnimationFrame(() => box.classList.add("on")); try { box.focus({ preventScroll: true }); } catch {}
      if (reduce) { while (S.t < S.T.end - 0.5) step(S); S.shake = 0; draw(S, ctx); await new Promise((r) => { closeStill = r; }); }
      else await run(S, ctx, step, draw);
      box.classList.add("out"); await new Promise((r) => setTimeout(r, 380));
      removeEventListener("keydown", onKey); box.remove();
    }).catch(() => {});
    queue = job;
    return job;
  }
  const api = { feed: (o) => play("feed", o), melt: (o) => play("melt", o) };
  // ?vfxdev=1: load a scene once, then render the frame at any moment
  if (new URLSearchParams(location.search).get("vfxdev")) {
    api.dev = {
      async load(kind, o) { this.unload(); const spr = await sprites(kind, o), w = open(); w.box.classList.add("on"); w.box.style.pointerEvents = "none"; Object.assign(this, { kind, spr, o: { ...o, width: w.W, height: w.H }, ...w }); return (kind === "feed" ? buildFeed : buildMelt)(this.o, spr).T; },
      frame(t) { const feed = this.kind === "feed", S = (feed ? buildFeed : buildMelt)(this.o, this.spr), step = feed ? stepFeed : stepMelt; while (S.t < t - DT / 2 && !S.done) step(S); (feed ? drawFeed : drawMelt)(S, this.ctx); this.S = S; return S.T; },
      unload() { if (this.box) this.box.remove(); this.box = null; },
    };
  }
  return api;
})();
