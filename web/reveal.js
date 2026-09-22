// Reveals: the moment a mined find comes out of its vial on the mining stage, and the ceremony of a mythic key over the
// whole page. Both are fixed-step simulations with a seeded random drawn on a canvas, so any moment of either can be
// rendered on demand (?vfxdev=1 exposes that for captures; the render loop pauses in a hidden tab). They only ever run
// after the chain has revealed what was found: nothing here plays, or hints at a tier, before the reveal.
window.AlchReveal = (() => {
  const DT = 1 / 60, TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, p) => a + (b - a) * p;
  const smooth = (p) => { p = clamp(p); return p * p * (3 - 2 * p); };
  const outCubic = (p) => 1 - Math.pow(1 - clamp(p), 3);
  const inCubic = (p) => { p = clamp(p); return p * p * p; };
  const outBack = (p) => { p = clamp(p); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hex = (h) => { const n = parseInt(String(h).trim().replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, p) => [Math.round(lerp(a[0], b[0], p)), Math.round(lerp(a[1], b[1], p)), Math.round(lerp(a[2], b[2], p))];
  const WHITE = [255, 255, 255], GOLD = [242, 196, 85], INK = [233, 228, 214], GLASS = [191, 233, 255], AMBER = [232, 128, 34], WAX = [184, 55, 43], VOID = [4, 6, 9];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tierColor = (t) => { const v = getComputedStyle(document.documentElement).getPropertyValue(`--c${t}`).trim(); return v ? hex(v) : GOLD; };
  const snap = (v, k) => Math.round(v / k) * k;

  // ---------------------------------------------------------------- sprites
  // Item and key art are 512px renders of 64px pixel art on the site background: rite.js cuts them free of it. The
  // stage vials already carry transparency and are used as they are.
  const plain = new Map();
  const plainSprite = (src) => { if (!plain.has(src)) plain.set(src, new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; })); return plain.get(src); };
  const keyed = (src) => (window.AlchRite && window.AlchRite.keyedSprite ? window.AlchRite.keyedSprite(src) : plainSprite(src));
  // a sprite filled with one colour (a figure of light, the dark back of a turning key), cached per colour and alpha
  function sil(S, sprite, c, a) {
    a = Math.round(clamp(a) * 20) / 20;
    let m = S.cache.get(sprite); if (!m) S.cache.set(sprite, (m = new Map()));
    const key = c.join(",") + "|" + a; let cv = m.get(key);
    if (!cv) { cv = document.createElement("canvas"); cv.width = sprite.width; cv.height = sprite.height; const g = cv.getContext("2d"); g.drawImage(sprite, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = rgba(c, a); g.fillRect(0, 0, cv.width, cv.height); m.set(key, cv); }
    return cv;
  }

  // ---------------------------------------------------------------- drawing helpers
  function glow(ctx, x, y, r, c, a) {
    if (a <= 0 || r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(c, a)); g.addColorStop(0.45, rgba(c, a * 0.45)); g.addColorStop(1, rgba(c, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function arcRing(ctx, x, y, r, w, c, a) { if (a <= 0 || r <= 0) return; ctx.globalAlpha = clamp(a); ctx.strokeStyle = rgba(c, 1); ctx.lineWidth = Math.max(1, w); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
  // a ring made of square pixels, so it sits on the pixel grid of the art around it
  function dots(ctx, x, y, r, k, c, a, rot = 0) {
    if (a <= 0 || r <= 0) return;
    const n = Math.max(16, Math.round((TAU * r) / (k * 2.5)));
    ctx.globalAlpha = clamp(a); ctx.fillStyle = rgba(c, 1);
    for (let i = 0; i < n; i++) { const an = rot + (i / n) * TAU; ctx.fillRect(snap(x + Math.cos(an) * r, k), snap(y + Math.sin(an) * r, k), k, k); }
  }
  // beams of light out of a point, fading along their length
  function rays(ctx, x, y, n, L, hw, rot, c0, c1, a, vary) {
    if (a <= 0 || L <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, L); g.addColorStop(0, rgba(c0, a)); g.addColorStop(0.35, rgba(c1, a * 0.55)); g.addColorStop(1, rgba(c1, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath();
    for (let i = 0; i < n; i++) { const an = rot + (i / n) * TAU, l = L * (vary ? vary(i) : 1), w = hw * (i % 2 ? 0.6 : 1); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an + w) * l, y + Math.sin(an + w) * l); ctx.lineTo(x + Math.cos(an - w) * l, y + Math.sin(an - w) * l); ctx.closePath(); }
    ctx.fill();
  }
  function text(ctx, s, x, y, font, c, a, shadow = true, spacing = 0) {
    if (a <= 0 || !s) return;
    ctx.globalAlpha = clamp(a); ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "top";
    try { ctx.letterSpacing = `${spacing}px`; } catch {}
    if (shadow) { ctx.fillStyle = "#0b0d0f"; ctx.fillText(s, x + 2, y + 2); }
    ctx.fillStyle = rgba(c, 1); ctx.fillText(s, x, y);
    try { ctx.letterSpacing = "0px"; } catch {}
  }
  const upd = (list, drag, grav = 0) => { const d = Math.pow(drag, DT); for (const q of list) { q.age += DT; q.vx *= d; q.vy = q.vy * d + (q.g !== undefined ? q.g : grav) * DT; q.x += q.vx * DT; q.y += q.vy * DT; } };
  const prune = (S, keys) => { for (const key of keys) S[key] = S[key].filter((q) => q.age < q.life); };

  // ================================================================ the find: out of its vial on the mining stage
  // o: { width, height, grid: [w, h] of the stage's pixel grid, from: [x, y] the vial's bottom centre on the rack and
  //      to: [x, y] where it opens (grid px), tier 1..5, color, tierName, name, upgraded, seed }
  // The show grows with the tier: a Common pops in a couple of seconds, a Legendary dims the room, trembles, breaks in a
  // column of light with rays and a rain of gold, and holds the stage for about six.
  function buildFind(o, spr) {
    const W = o.width, H = o.height, k = W / o.grid[0], t = clamp(o.tier | 0, 1, 5), rand = rng(o.seed || 1);
    const c = t === 1 ? mix(o.color || [154, 160, 164], WHITE, 0.25) : o.color || GOLD, bright = mix(c, WHITE, 0.45);
    const L = { fly: [0, 0.4, 0.44, 0.5, 0.58, 0.68][t], tremble: [0, 0.22, 0.32, 0.55, 0.85, 1.15][t], hold: [0, 1.0, 1.3, 1.8, 2.4, 3.1][t], exit: 0.45 };
    const T = { lift: 0.16 };
    T.fly1 = T.lift + L.fly; T.burst = T.fly1 + L.tremble; T.item = T.burst + 0.05; T.label = T.item + 0.3; T.up = T.item + 0.75;
    T.exit = T.item + 0.45 + L.hold + (o.upgraded ? 0.7 : 0); T.end = T.exit + L.exit;
    const vw = spr.vial ? spr.vial.width : 12, vh = spr.vial ? spr.vial.height : 18;
    const S = {
      t: 0, W, H, k, tier: t, c, bright, L, T, rand, drand: rng(77), vial: spr.vial, item: spr.item, vw, vh, VS: 2.4,
      from: [o.from[0] * k, (o.from[1] - vh / 2) * k], C: [o.to[0] * k, o.to[1] * k], IS: Math.round(Math.min(H * 0.42, 136)),
      tierName: o.tierName || "", name: o.name || "", upgraded: !!o.upgraded,
      sparks: [], shards: [], rings: [], trail: [], motes: [], dust: [], shake: 0, burst: false, done: false, cache: new Map(),
    };
    // cracks in the glass: seeded zigzags from the belly of the vial outward, more of them for a higher tier
    const n = [0, 2, 3, 4, 6, 8][t];
    S.cracks = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * TAU + rand() * 0.8, pts = [[0, 3]]; let x = 0, y = 3;
      for (let j = 0, m = 3 + Math.floor(rand() * 3); j < m; j++) { const b = a + (rand() - 0.5) * 1.3, l = 1.2 + rand() * 1.6; x += Math.cos(b) * l; y += Math.sin(b) * l; pts.push([clamp(x, -5, 5), clamp(y, -3, 8)]); }
      return { pts, at: T.fly1 + L.tremble * (0.08 + (0.8 * i) / n) };
    });
    return S;
  }
  // where the vial is: a hop off the rack, then an arc across the room to where it opens; [x, y, scale, rotation]
  function vialAt(S, t) {
    const { T, k } = S;
    if (t < T.lift) return [S.from[0], S.from[1] - 6 * k * outCubic(t / T.lift), 1, 0];
    const p = clamp((t - T.lift) / (T.fly1 - T.lift)), e = smooth(p);
    const a = [S.from[0], S.from[1] - 6 * k], b = S.C, m = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 34 * k];
    return [(1 - e) * (1 - e) * a[0] + 2 * (1 - e) * e * m[0] + e * e * b[0], (1 - e) * (1 - e) * a[1] + 2 * (1 - e) * e * m[1] + e * e * b[1], lerp(1, S.VS, e), Math.sin(p * Math.PI) * 0.5];
  }
  // where the find is: it grows out of the burst, bobs, and at the end drops out of the bottom of the stage to the shelf
  function itemAt(S, t) {
    const { T, C, IS, L, k } = S, p = clamp((t - T.item) / 0.45);
    let s = IS * Math.max(0.05, outBack(p)), y = C[1] + Math.sin(Math.max(0, t - T.item - 0.45) * 2.6) * 1.5 * k, a = 1;
    if (t > T.exit) { const e = clamp((t - T.exit) / L.exit); s *= 1 - 0.7 * e; y += inCubic(e) * (S.H - C[1] + IS * 0.5); a = 1 - e * e; }
    return [C[0], y, s, a, p];
  }

  function burstFind(S) {
    const { k, rand, tier: t, C } = S;
    S.burst = true; S.flash = { t: S.t, r: (34 + 16 * t) * k, a: 0.95 };
    // the glass and the brew: shards fly and fall
    for (let i = 0; i < 22 + 6 * t; i++) { const a = rand() * TAU, v = (40 + rand() * (90 + 20 * t)) * k; S.shards.push({ x: C[0] + (rand() - 0.5) * 10 * k, y: C[1] + (rand() - 0.5) * 14 * k, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * k, life: 0.8 + rand() * 0.7, age: 0, s: rand() < 0.3 ? 2 : 1, c: i % 4 === 0 ? AMBER : i % 4 === 1 ? S.bright : GLASS }); }
    S.cork = { x: C[0], y: C[1] - S.VS * 9 * k, vx: (rand() - 0.5) * 60 * k, vy: -(140 + 20 * t) * k, rot: 0, vr: (rand() < 0.5 ? -1 : 1) * (8 + rand() * 6), age: 0, life: 1.4 };
    const nR = [0, 1, 1, 2, 2, 3][t], R = [0, 46, 58, 76, 100, 140][t] * k;
    for (let i = 0; i < nR; i++) S.rings.push({ r0: 6 * k, r1: R * (1 - i * 0.22), life: 0.5 + 0.12 * t, age: -i * 0.09, c: i ? S.c : WHITE });
    for (let i = 0; i < [0, 26, 42, 64, 100, 160][t]; i++) { const a = rand() * TAU, v = (50 + Math.pow(rand(), 0.7) * (120 + 45 * t)) * k; S.sparks.push({ x: C[0], y: C[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 90 * k, life: 0.45 + rand() * (0.5 + 0.12 * t), age: 0, s: rand() < 0.3 ? 2 : 1, c: rand() < 0.35 ? WHITE : rand() < 0.6 ? S.bright : S.c, streak: t >= 3 && rand() < 0.4 }); }
    if (t >= 3) S.column = { w: [0, 0, 0, 9, 14, 22][t] * k, life: 1.1 + 0.25 * t };
    if (t >= 4) S.rays = { life: 1.3 + 0.3 * (t - 4) };
    S.shake = [0, 0, 0, 1, 2.5, 4][t] * k;
  }

  function stepFind(S) {
    const { T, k, rand, C } = S; const t = (S.t += DT);
    if (t > T.lift && t < T.fly1) { const [x, y] = vialAt(S, t); for (let i = 0; i < 2; i++) S.trail.push({ x: x + (rand() - 0.5) * 6 * k, y: y + (rand() - 0.5) * 10 * k, vx: (rand() - 0.5) * 24 * k, vy: (rand() - 0.5) * 24 * k, g: 0, life: 0.3 + rand() * 0.3, age: 0, c: rand() < 0.5 ? WHITE : GLASS }); }
    // from Rare up the light of the room is drawn into the trembling vial
    if (t > T.fly1 && !S.burst && S.tier >= 3 && rand() < 0.25 * S.tier) { const a = rand() * TAU, r = (40 + rand() * 50) * k; S.motes.push({ x: C[0] + Math.cos(a) * r, y: C[1] + Math.sin(a) * r, pull: true, life: 0.45, age: 0, c: rand() < 0.5 ? WHITE : S.bright }); }
    if (t >= T.burst && !S.burst) burstFind(S);
    if (S.burst && S.tier === 5 && t < T.burst + 2.4 && rand() < 0.8) S.dust.push({ x: rand() * S.W, y: -2 * k, vx: 0, vy: (22 + rand() * 30) * k, g: 0, sw: rand() * TAU, life: 3, age: 0 });
    if (t > T.item + 0.25 && t < T.exit && rand() < 0.12 + 0.06 * S.tier) S.motes.push({ x: C[0] + (rand() - 0.5) * S.IS * 0.8, y: C[1] + S.IS * 0.25, vx: (rand() - 0.5) * 6 * k, vy: -(10 + rand() * 18) * k, life: 0.8 + rand() * 0.6, age: 0, c: rand() < 0.5 ? WHITE : S.bright });
    if (S.upgraded && t >= T.up && !S.upDone) {
      S.upDone = true; S.rings.push({ r0: S.IS * 0.3, r1: S.IS * 0.95, life: 0.55, age: 0, c: GOLD });
      for (let i = 0; i < 36; i++) { const a = rand() * TAU, v = (60 + rand() * 90) * k; S.sparks.push({ x: C[0], y: C[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 60 * k, life: 0.5 + rand() * 0.4, age: 0, s: 1, c: rand() < 0.5 ? WHITE : GOLD }); }
    }
    if (t > T.exit && t < T.end) { const [x, y] = itemAt(S, t); S.trail.push({ x: x + (rand() - 0.5) * S.IS * 0.3, y: y + (rand() - 0.5) * S.IS * 0.3, vx: 0, vy: -10 * k, g: 0, life: 0.35, age: 0, c: rand() < 0.5 ? WHITE : S.bright }); }
    upd(S.sparks, 0.25); upd(S.shards, 0.6, 260 * k); upd(S.trail, 0.05); upd(S.dust, 1);
    for (const m of S.motes) { m.age += DT; if (m.pull) { const f = Math.min(1, DT * 9); m.x += (C[0] - m.x) * f; m.y += (C[1] - m.y) * f; } else { m.x += m.vx * DT; m.y += m.vy * DT; } }
    for (const d of S.dust) d.x += Math.sin(t * 2 + d.sw) * 8 * k * DT;
    if (S.cork) { const q = S.cork; q.age += DT; q.vy += 300 * k * DT; q.x += q.vx * DT; q.y += q.vy * DT; q.rot += q.vr * DT; }
    for (const r of S.rings) r.age += DT;
    prune(S, ["sparks", "shards", "trail", "motes", "dust", "rings"]);
    S.shake *= Math.pow(0.002, DT);
    if (t >= T.end) S.done = true;
  }

  function drawFind(S, ctx) {
    const { W, H, k, T, t, C, tier, IS } = S;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false; ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    if (S.shake > 0.3) ctx.translate(snap((S.drand() - 0.5) * 2 * S.shake, k), snap((S.drand() - 0.5) * 2 * S.shake, k));
    // the room dims around the find, deeper for a higher tier, and comes back as the find leaves
    let dim = [0, 0.2, 0.28, 0.4, 0.55, 0.7][tier] * smooth((t - T.lift) / (T.burst - T.lift));
    if (S.burst) dim *= lerp(1, 0.75, smooth((t - T.burst) / 0.8));
    if (t > T.exit) dim *= 1 - smooth((t - T.exit) / S.L.exit);
    if (dim > 0.004) { const g = ctx.createRadialGradient(C[0], C[1], H * 0.08, C[0], C[1], W * 0.7); g.addColorStop(0, rgba(VOID, dim * 0.35)); g.addColorStop(1, rgba(VOID, Math.min(0.9, dim * 1.25))); ctx.fillStyle = g; ctx.fillRect(-12, -12, W + 24, H + 24); }
    ctx.globalCompositeOperation = "lighter";
    const sinceB = S.burst ? t - T.burst : -1;
    // light breaks through the cracks while it trembles
    if (t > T.fly1 && !S.burst) { const q = (t - T.fly1) / (T.burst - T.fly1); glow(ctx, C[0], C[1], (18 + 9 * tier) * k * (0.5 + q), S.c, 0.12 + 0.5 * q * q); glow(ctx, C[0], C[1], 9 * k * (0.5 + q), S.bright, 0.15 + 0.5 * q * q); }
    // a column of light through the room (Rare and up)
    if (S.column && sinceB >= 0 && sinceB < S.column.life) {
      const env = sinceB < 0.12 ? sinceB / 0.12 : 1 - smooth((sinceB - 0.12) / (S.column.life - 0.12)), w = S.column.w * (0.55 + 0.45 * env);
      const g = ctx.createLinearGradient(C[0] - w * 2, 0, C[0] + w * 2, 0); g.addColorStop(0, rgba(S.c, 0)); g.addColorStop(0.3, rgba(S.c, 0.3 * env)); g.addColorStop(0.5, rgba(WHITE, 0.8 * env)); g.addColorStop(0.7, rgba(S.c, 0.3 * env)); g.addColorStop(1, rgba(S.c, 0));
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(C[0] - w * 2, 0, w * 4, H);
    }
    // rays out of the burst (Epic and up)
    if (S.rays && sinceB >= 0 && sinceB < S.rays.life) { const env = Math.sin(Math.PI * clamp(sinceB / S.rays.life)); rays(ctx, C[0], C[1], 16, W * 0.5 * (0.6 + 0.4 * outCubic(sinceB / 0.4)), 0.05, 0.4 * sinceB, WHITE, S.bright, 0.55 * env, (i) => 0.55 + 0.45 * Math.abs(Math.sin(i * 2.4 + 1))); }
    // the find's own light while it is shown
    if (t > T.item) {
      const [x, y, s, a, p] = itemAt(S, t);
      if (tier >= 4) rays(ctx, x, y, 12, s * 1.05, 0.09, 0.3 * (t - T.item), WHITE, S.bright, 0.32 * a * p, (i) => 0.75 + 0.25 * Math.sin(t * 2 + i * 1.7));
      glow(ctx, x, y, s * (0.75 + 0.1 * tier), S.c, (0.28 + 0.06 * tier) * a); glow(ctx, x, y, s * 0.38, S.bright, 0.25 * a);
      if (tier >= 3) dots(ctx, x, y, s * 0.62, k, S.bright, (0.25 + 0.2 * Math.sin(t * 4)) * a * p, t * 0.6);
    }
    for (const r of S.rings) { if (r.age < 0) continue; const q = r.age / r.life, rad = lerp(r.r0, r.r1, outCubic(q)); arcRing(ctx, C[0], C[1], rad, 4 * k, r.c, (1 - q) * 0.25); dots(ctx, C[0], C[1], rad, k, r.c === WHITE ? WHITE : mix(r.c, WHITE, 0.5), 1 - q); }
    if (S.flash) { const age = t - S.flash.t; if (age < 0.35) { const q = age / 0.35; glow(ctx, C[0], C[1], S.flash.r * (0.5 + 0.5 * outCubic(q)), WHITE, S.flash.a * (1 - q) * (1 - q)); glow(ctx, C[0], C[1], S.flash.r * 1.6, S.c, 0.5 * (1 - q)); } }
    for (const q of S.sparks) {
      ctx.globalAlpha = 1 - q.age / q.life; ctx.fillStyle = rgba(q.c, 1);
      if (q.streak) { ctx.strokeStyle = rgba(q.c, 1); ctx.lineWidth = k; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.05, q.y - q.vy * 0.05); ctx.stroke(); }
      else ctx.fillRect(snap(q.x, k), snap(q.y, k), q.s * k, q.s * k);
    }
    for (const q of S.trail) { const a = 1 - q.age / q.life; ctx.globalAlpha = a * a; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(snap(q.x, k), snap(q.y, k), k, k); }
    for (const m of S.motes) { ctx.globalAlpha = 1 - m.age / m.life; ctx.fillStyle = rgba(m.c, 1); ctx.fillRect(snap(m.x, k), snap(m.y, k), k, k); }
    for (const d of S.dust) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 9 + d.sw); ctx.fillStyle = rgba(d.sw > 3 ? WHITE : GOLD, 1); ctx.fillRect(snap(d.x, k), snap(d.y, k), k, k); }
    ctx.globalCompositeOperation = "source-over";
    // glass shards and the cork
    for (const q of S.shards) { ctx.globalAlpha = 1 - q.age / q.life; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(snap(q.x, k), snap(q.y, k), q.s * k, q.s * k); }
    if (S.cork && S.cork.age < S.cork.life) { const q = S.cork, u = 1.6 * k; ctx.globalAlpha = 1 - q.age / q.life; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.fillStyle = rgba(WAX, 1); ctx.fillRect(-1.5 * u, -u, 3 * u, 2 * u); ctx.restore(); }
    // the vial: up off the rack, across the room, trembling as the light breaks through
    if (!S.burst && S.vial) {
      let [x, y, sc, rot] = vialAt(S, t);
      const q = t > T.fly1 ? (t - T.fly1) / (T.burst - T.fly1) : 0;
      if (q > 0) { const amp = (0.4 + [0, 0.6, 0.8, 1.1, 1.5, 2][tier] * q) * k; x += (S.drand() - 0.5) * 2 * amp; y += (S.drand() - 0.5) * 2 * amp; rot = (S.drand() - 0.5) * 0.12 * q; }
      const w = S.vw * sc * k, h = S.vh * sc * k;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = 1; ctx.drawImage(S.vial, -w / 2, -h / 2, w, h);
      if (q > 0) {
        const hot = clamp((q - 0.55) / 0.45); if (hot > 0) ctx.drawImage(sil(S, S.vial, WHITE, hot * 0.7), -w / 2, -h / 2, w, h);
        ctx.globalCompositeOperation = "lighter"; const u = sc * k;
        for (const cr of S.cracks) {
          if (t < cr.at) continue; const g = clamp((t - cr.at) / 0.12);
          ctx.beginPath(); cr.pts.forEach(([px, py], j) => (j ? ctx.lineTo(px * u, py * u) : ctx.moveTo(px * u, py * u)));
          ctx.strokeStyle = rgba(S.c, 1); ctx.globalAlpha = 0.35 * g; ctx.lineWidth = k * 2.5; ctx.stroke();
          ctx.strokeStyle = rgba(S.bright, 1); ctx.globalAlpha = 0.95 * g; ctx.lineWidth = Math.max(1, k * 0.9); ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.restore();
    }
    // the find: it comes out of the burst as a figure of light and takes its colours
    if (t > T.item && S.item) {
      const [x, y, s, a, p] = itemAt(S, t), r = [Math.round(x - s / 2), Math.round(y - s / 2), Math.round(s), Math.round(s)];
      ctx.globalAlpha = a; ctx.drawImage(S.item, ...r);
      const wIn = clamp(1 - p / 0.5); if (wIn > 0) ctx.drawImage(sil(S, S.item, WHITE, wIn), ...r);
    }
    // the label: the tier, then the name, typed into a plate under the find
    if (t > T.label) {
      const q = clamp((t - T.label) / 0.18), fs1 = Math.max(10, Math.round(4.2 * k)), fs2 = Math.max(12, Math.round(5.4 * k));
      const f1 = `${fs1}px "Press Start 2P", monospace`, f2 = `${fs2}px "IBM Plex Mono", monospace`, t1 = S.tierName.toUpperCase(), t2 = S.name;
      const up = S.upgraded && t > T.up, t3 = "UPGRADED +1";
      ctx.font = f1; const w1 = ctx.measureText(t1).width, w3 = up ? ctx.measureText(t3).width : 0; ctx.font = f2; const w2 = ctx.measureText(t2).width;
      const pw = Math.round((Math.max(w1, w2, w3) + 26) * outCubic(q)), ph = fs1 + fs2 + 20 + (up ? fs1 + 8 : 0), x0 = Math.round(C[0] - pw / 2), y0 = Math.round(C[1] + IS / 2 + 6 * k);
      const la = t > T.exit ? 1 - clamp((t - T.exit) / (S.L.exit * 0.6)) : 1;
      if (pw > 4 && la > 0) {
        ctx.globalAlpha = la; ctx.fillStyle = "#0b0d0f"; ctx.fillRect(x0 + 4, y0 + 4, pw, ph); ctx.fillStyle = "rgba(11,13,15,.92)"; ctx.fillRect(x0, y0, pw, ph);
        ctx.strokeStyle = rgba(S.c, 1); ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, pw - 2, ph - 2);
        if (q >= 1) {
          const n = Math.floor((t - T.label - 0.18) / 0.03);
          text(ctx, t1.slice(0, n), C[0], y0 + 9, f1, S.bright, la, false, 1);
          text(ctx, t2.slice(0, Math.max(0, n - t1.length)), C[0], y0 + 13 + fs1, f2, INK, la, false);
          if (up && (t - T.up > 0.9 || Math.floor(t * 8) % 2)) text(ctx, t3, C[0], y0 + 20 + fs1 + fs2, f1, GOLD, la, false, 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================ the mythic key: a ceremony over the whole page
  // The page goes dark and still, a thread of light runs from where the key was found, the dark tears open in a rift
  // and breaks away in shards, the key comes out of the light turning like a coin, stops, and the seal lands: rings,
  // a storm of sparks, runes around it, its name. It stays until the player keeps it.
  const KT = { thread0: 0.1, thread1: 0.7, rift0: 0.8, rift1: 1.35, open0: 1.3, open1: 1.9, key0: 1.8, seal: 3.55, text: 3.85, hint: 5.9, auto: 20 };
  function layoutKey(S) { const m = Math.min(S.W, S.H); S.u = Math.max(0.5, m / 800); S.cx = S.W / 2; S.cy = Math.round(S.H * 0.43); S.KS = 64 * Math.max(2, Math.min(6, Math.floor((m * 0.34) / 64))); S.R1 = S.KS * 0.74; S.R2 = S.KS * 0.9; }
  function buildKey(o, spr) {
    const rand = rng(o.seed || 21);
    const S = { t: 0, W: o.width, H: o.height, rand, drand: rng(5), T: { ...KT }, sprite: spr.key, key: o.key || "", alchemist: o.alchemist || "", origin: o.origin || null, sparks: [], shards: [], rings: [], motes: [], trail: [], glints: [], hist: [], shake: 0, exitAt: 0, done: false, sealed: false, cache: new Map() };
    layoutKey(S);
    S.rift = Array.from({ length: 19 }, (_, i) => [i === 0 || i === 18 ? 0 : rand() - 0.5, (i / 18) * 2 - 1]);
    S.glyphs = [{ n: 40, spd: 0.2, marks: Array.from({ length: 40 }, () => [0, 1, 1, 2, 2, 3][Math.floor(rand() * 6)]) }, { n: 64, spd: -0.13, marks: Array.from({ length: 64 }, () => [0, 0, 1, 1, 2, 3][Math.floor(rand() * 6)]) }];
    S.stars = Array.from({ length: 80 }, () => ({ x: rand(), y: rand(), ph: rand() * TAU, s: rand() < 0.2 ? 2 : 1 }));
    if (!S.origin) S.T.thread1 = S.T.thread0;
    return S;
  }
  function threadAt(S, t) {
    const p = smooth((t - S.T.thread0) / (S.T.thread1 - S.T.thread0)), [ox, oy] = S.origin, dx = S.cx - ox, dy = S.cy - oy, m = [(ox + S.cx) / 2 - dy * 0.25, (oy + S.cy) / 2 + dx * 0.25];
    return [(1 - p) * (1 - p) * ox + 2 * (1 - p) * p * m[0] + p * p * S.cx, (1 - p) * (1 - p) * oy + 2 * (1 - p) * p * m[1] + p * p * S.cy];
  }
  const beamW = (S, t) => { if (t < S.T.key0) return 0; if (!S.sealed) return outCubic((t - S.T.key0) / 0.5) * S.KS * 0.6; return lerp(S.KS * 0.6, S.KS * 0.36, smooth((t - S.T.seal) / 1.2)); };
  // the key: it grows out of the rift turning like a coin (five turns, slowing), stops facing front at the seal, then floats
  function keyAt(S, t) {
    const T = S.T, p = clamp((t - T.key0) / (T.seal - T.key0)), ang = 5 * TAU * (1 - Math.pow(1 - p, 3));
    let s = S.KS * lerp(0.12, 1, outCubic(p)), y = S.cy + (1 - outCubic(p)) * 30 * S.u + (S.sealed ? Math.sin((t - T.seal) * 1.8) * 5 * S.u : 0), a = 1;
    if (S.exitAt) { const e = clamp((t - S.exitAt) / 0.8); s *= 1 - inCubic(e); y -= inCubic(e) * S.H * 0.25; a = 1 - e; }
    return { x: S.cx, y, s, sx: Math.cos(ang), a, p };
  }
  function shatterVeil(S) {
    const { u, cx, cy, rand } = S, HR = S.H * 0.3;
    for (let i = 0; i < 34; i++) {
      const y = cy + (rand() * 2 - 1) * HR * 0.9, side = rand() < 0.5 ? -1 : 1, x = cx + side * (6 + rand() * 30) * u, sz = (16 + rand() * 46) * u, n = 3 + (rand() < 0.4 ? 1 : 0);
      const pts = Array.from({ length: n }, (_, j) => { const a = (j / n) * TAU + rand() * 0.9, r = sz * (0.5 + rand() * 0.5); return [Math.cos(a) * r, Math.sin(a) * r]; });
      S.shards.push({ x, y, pts, vx: side * (140 + rand() * 520) * u, vy: (rand() - 0.5) * 220 * u, rot: rand() * TAU, vr: (rand() - 0.5) * 6, life: 1.1 + rand() * 0.9, age: 0 });
    }
  }
  function sealKey(S) {
    const { u, cx, cy, rand } = S, M = Math.max(S.W, S.H);
    S.sealed = true; S.shake = 10 * u; S.flash = { t: S.t, a: 1, r: M * 0.8, big: true };
    S.rings.push({ r0: S.KS * 0.3, r1: M * 0.6, w: 5 * u, life: 0.9, age: 0, c: WHITE, dots: true });
    S.rings.push({ r0: S.KS * 0.3, r1: M * 0.7, w: 22 * u, life: 1.1, age: -0.08, c: GOLD, soft: true });
    S.rings.push({ r0: S.KS * 0.3, r1: M * 0.45, w: 3 * u, life: 0.7, age: -0.16, c: GOLD });
    for (let i = 0; i < 240; i++) { const a = rand() * TAU, v = (140 + Math.pow(rand(), 0.7) * 620) * u; S.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 180 * u, life: 0.8 + rand() * 1.3, age: 0, s: rand() < 0.35 ? 3 : 2, c: rand() < 0.4 ? WHITE : GOLD, streak: rand() < 0.5 }); }
  }
  function stepKey(S) {
    const { T, u, cx, cy, rand } = S; const t = (S.t += DT);
    // a thread of light from where the key was found to the middle of the page
    if (S.origin && t > T.thread0 && t < T.thread1) {
      const [x, y] = threadAt(S, t); S.hist.push([x, y]); if (S.hist.length > 18) S.hist.shift();
      for (let i = 0; i < 3; i++) S.trail.push({ x: x + (rand() - 0.5) * 8 * u, y: y + (rand() - 0.5) * 8 * u, vx: (rand() - 0.5) * 40 * u, vy: (rand() - 0.5) * 40 * u, g: 0, life: 0.4 + rand() * 0.4, age: 0, s: 2, c: rand() < 0.5 ? WHITE : GOLD });
    } else if (S.hist.length) S.hist.shift();
    if (t >= T.rift0 && !S.cracked) { S.cracked = true; S.shake = 4 * u; S.flash = { t, a: 0.5, r: 120 * u }; }
    // sparks off the two tips of the crack as it runs
    if (t > T.rift0 && t < T.rift1) {
      const g = outCubic((t - T.rift0) / (T.rift1 - T.rift0)), HR = S.H * 0.3;
      for (const sg of [-1, 1]) for (let i = 0; i < 2; i++) S.sparks.push({ x: cx + (rand() - 0.5) * 10 * u, y: cy + sg * g * HR, vx: (rand() - 0.5) * 160 * u, vy: sg * rand() * 120 * u, g: 200 * u, life: 0.3 + rand() * 0.3, age: 0, s: 2, c: rand() < 0.5 ? WHITE : GOLD });
    }
    if (t >= T.open0 && !S.shattered) { S.shattered = true; shatterVeil(S); }
    if (t > T.key0 && !S.exitAt && rand() < 0.9) { const bw = beamW(S, t); S.motes.push({ x: cx + (rand() - 0.5) * bw * 1.6, y: S.H + 4, vx: 0, vy: -(90 + rand() * 180) * u, g: 0, sw: rand() * TAU, life: 3, age: 0, s: rand() < 0.3 ? 3 : 2, c: rand() < 0.5 ? WHITE : GOLD }); }
    if (t >= T.seal && !S.sealed) sealKey(S);
    if (S.sealed && !S.exitAt && rand() < 0.08) S.glints.push({ x: (rand() - 0.5) * 0.8, y: (rand() - 0.5) * 0.8, life: 0.5 + rand() * 0.4, age: 0, s: 3 + Math.floor(rand() * 3) });
    upd(S.sparks, 0.3); upd(S.trail, 0.05); upd(S.motes, 1);
    for (const m of S.motes) m.x += Math.sin(t * 3 + m.sw) * 20 * u * DT;
    const sd = Math.pow(0.6, DT); for (const q of S.shards) { q.age += DT; q.x += q.vx * DT; q.y += q.vy * DT; q.vx *= sd; q.vy *= sd; q.rot += q.vr * DT; }
    for (const r of S.rings) r.age += DT; for (const gl of S.glints) gl.age += DT;
    prune(S, ["sparks", "trail", "motes", "shards", "rings", "glints"]);
    S.shake *= Math.pow(0.002, DT);
    if (!S.exitAt && t >= T.auto) S.exitAt = t;
    if (S.exitAt && t - S.exitAt >= 0.8) S.done = true;
  }

  function drawKey(S, ctx) {
    const { W, H, u, cx, cy, T, t } = S;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false; ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    const fade = 1 - (S.exitAt ? clamp((t - S.exitAt) / 0.8) : 0);
    if (S.shake > 0.4) ctx.translate(Math.round((S.drand() - 0.5) * 2 * S.shake), Math.round((S.drand() - 0.5) * 2 * S.shake));
    // the page goes dark
    ctx.fillStyle = rgba(VOID, 0.9 * smooth(t / 0.8) * fade); ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalCompositeOperation = "lighter";
    if (S.sealed) glow(ctx, cx, cy, Math.max(W, H) * 0.55, [120, 80, 20], 0.25 * smooth((t - T.seal) / 1) * fade);
    // faint gold dust drifting up in the dark once the veil tears
    const dustA = smooth((t - T.rift0) / 1.2) * fade;
    if (dustA > 0) { ctx.fillStyle = rgba(GOLD, 1); for (const s of S.stars) { ctx.globalAlpha = dustA * (0.25 + 0.25 * Math.sin(t * 1.7 + s.ph)); ctx.fillRect(Math.round(s.x * W), Math.round((((s.y * H - t * 6 * u * (1 + s.s)) % H) + H) % H), s.s * 2, s.s * 2); } }
    // the thread from where the key was found
    if (S.hist.length > 1) {
      ctx.lineCap = "round";
      for (let j = 1; j < S.hist.length; j++) { const f = j / S.hist.length, [x0, y0] = S.hist[j - 1], [x1, y1] = S.hist[j]; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.globalAlpha = f * f * 0.8; ctx.strokeStyle = rgba(GOLD, 1); ctx.lineWidth = f * 14 * u + 1; ctx.stroke(); ctx.globalAlpha = f * f; ctx.strokeStyle = rgba(WHITE, 1); ctx.lineWidth = f * 4 * u + 1; ctx.stroke(); }
      const [hx, hy] = S.hist[S.hist.length - 1]; glow(ctx, hx, hy, 40 * u, GOLD, 0.6); glow(ctx, hx, hy, 14 * u, WHITE, 0.9);
    }
    // the rift: a crack of light runs up and down, opens into a lens, leaks light sideways, and closes at the seal
    if (t > T.rift0) {
      const HR = H * 0.3, grow = outCubic((t - T.rift0) / (T.rift1 - T.rift0)), close = S.sealed ? smooth((t - T.seal) / 0.35) : 0;
      const open = t > T.open0 ? outCubic((t - T.open0) / (T.open1 - T.open0)) : 0;
      const ww = (open * W * 0.03 + (t > T.key0 ? outCubic((t - T.key0) / 0.6) * S.KS * 0.22 : 0)) * (1 - close), ra = (1 - close) * fade;
      const P = (yn) => { const f = ((yn + 1) / 2) * (S.rift.length - 1), i = Math.min(S.rift.length - 2, Math.floor(f)); return cx + lerp(S.rift[i][0], S.rift[i + 1][0], f - i) * 30 * u; };
      const pts = []; for (let i = 0; i <= 48; i++) { const yn = (i / 48) * 2 - 1; if (Math.abs(yn) <= grow) pts.push([P(yn), cy + yn * HR, yn]); }
      if (ra > 0 && pts.length > 1) {
        if (ww > 0.5) {
          const prof = (yn) => ww * Math.pow(Math.max(0, 1 - yn * yn), 0.8);
          ctx.beginPath(); pts.forEach(([x, y, yn], i) => (i ? ctx.lineTo(x + prof(yn), y) : ctx.moveTo(x + prof(yn), y))); for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0] - prof(pts[i][2]), pts[i][1]); ctx.closePath();
          const g = ctx.createLinearGradient(cx - ww * 1.2, 0, cx + ww * 1.2, 0); g.addColorStop(0, rgba(GOLD, 0)); g.addColorStop(0.3, rgba(GOLD, 0.55 * ra)); g.addColorStop(0.5, rgba(WHITE, 0.95 * ra)); g.addColorStop(0.7, rgba(GOLD, 0.55 * ra)); g.addColorStop(1, rgba(GOLD, 0));
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fill();
        }
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        for (const [c, w, a] of [[GOLD, 16 * u, 0.22], [GOLD, 7 * u, 0.5], [WHITE, 3 * u, 0.9], [WHITE, 1.2 * u, 1]]) { ctx.globalAlpha = a * ra; ctx.strokeStyle = rgba(c, 1); ctx.lineWidth = Math.max(1, w); ctx.stroke(); }
        if (open > 0) {
          const la = open * ra * (0.6 + 0.4 * Math.sin(t * 7));
          for (let i = 0; i < 9; i++) {
            const yn = ((i + 0.5) / 9) * 2 - 1; if (Math.abs(yn) > grow) continue;
            const y = cy + yn * HR, x = P(yn), L = (W * 0.22 + (i % 3) * W * 0.06) * open, th = (2 + (i % 2) * 3) * u;
            for (const sg of [-1, 1]) { const g = ctx.createLinearGradient(x, y, x + sg * L, y); g.addColorStop(0, rgba(WHITE, 0.45 * la)); g.addColorStop(1, rgba(GOLD, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y - th); ctx.lineTo(x + sg * L, y); ctx.lineTo(x, y + th); ctx.closePath(); ctx.fill(); }
          }
        }
        glow(ctx, cx, cy, HR * grow * 0.9, GOLD, 0.18 * ra);
      }
    }
    // shards of the dark, breaking away from the rift with lit edges
    for (const q of S.shards) {
      const a = (1 - q.age / q.life) * fade; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.beginPath(); q.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = a; ctx.fillStyle = "#0d1015"; ctx.fill();
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * 0.08; ctx.fillStyle = rgba(GOLD, 1); ctx.fill(); ctx.globalAlpha = a * 0.75; ctx.strokeStyle = rgba(GOLD, 1); ctx.lineWidth = Math.max(1, 1.2 * u); ctx.stroke(); ctx.restore();
    }
    ctx.globalCompositeOperation = "lighter";
    // the beam the key stands in
    const bw = beamW(S, t);
    if (bw > 0) { const ba = fade * (S.sealed ? 0.55 + 0.1 * Math.sin(t * 2.2) : 0.85), g = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0); g.addColorStop(0, rgba(GOLD, 0)); g.addColorStop(0.28, rgba(GOLD, 0.22 * ba)); g.addColorStop(0.5, rgba(WHITE, 0.5 * ba)); g.addColorStop(0.72, rgba(GOLD, 0.22 * ba)); g.addColorStop(1, rgba(GOLD, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(cx - bw, 0, bw * 2, H); }
    const K = keyAt(S, t);
    if (t > T.key0) {
      if (S.sealed) {
        const q = smooth((t - T.seal) / 0.6) * K.a, st = t - T.seal;
        rays(ctx, K.x, K.y, 14, K.s * 1.35, 0.1, 0.18 * st, WHITE, GOLD, 0.34 * q, (i) => 0.8 + 0.2 * Math.sin(t * 2 + i * 1.7));
        rays(ctx, K.x, K.y, 10, K.s * 1.1, 0.045, -0.12 * st + 0.3, WHITE, [255, 230, 170], 0.22 * q, (i) => 0.7 + 0.25 * Math.sin(t * 1.6 + i * 2.3));
      }
      glow(ctx, K.x, K.y, K.s * 1.1, GOLD, (S.sealed ? 0.45 : 0.3) * K.a); glow(ctx, K.x, K.y, K.s * 0.5, WHITE, 0.35 * K.a);
      // the runes round the key, lit clockwise from the top after the seal
      if (S.sealed) {
        const q = smooth((t - T.seal) / 0.8), sc = K.s / S.KS;
        for (let gi = 0; gi < 2; gi++) {
          const g = S.glyphs[gi], r = (gi ? S.R2 : S.R1) * sc, spin = g.spd * (t - T.seal) + (gi ? -1 : 1) * 1.4 * (1 - Math.exp(-(t - T.seal) * 2));
          arcRing(ctx, K.x, K.y, r, 1.5 * u, GOLD, 0.25 * q * K.a);
          for (let i = 0; i < g.n; i++) {
            const m = g.marks[i]; if (!m) continue; const lit = clamp((q * 1.15 - i / g.n) * 6); if (lit <= 0) continue;
            const a = -Math.PI / 2 + (i / g.n) * TAU + spin, len = (m === 1 ? 6 : m === 2 ? 12 : 4) * u, x = K.x + Math.cos(a) * r, y = K.y + Math.sin(a) * r;
            ctx.globalAlpha = clamp((0.55 + 0.45 * Math.sin(t * 3 + i)) * lit * K.a); ctx.fillStyle = rgba(lit < 1 ? WHITE : GOLD, 1);
            if (m === 3) ctx.fillRect(Math.round(x - 2 * u), Math.round(y - 2 * u), Math.round(4 * u), Math.round(4 * u)); else { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillRect(-len / 2, -1.5 * u, len, 3 * u); ctx.restore(); }
          }
        }
      }
    }
    for (const r of S.rings) {
      if (r.age < 0) continue; const q = r.age / r.life, rad = lerp(r.r0, r.r1, outCubic(q)), w = Math.max(1, r.w * (1 - q * 0.6)), al = (1 - q) * (r.soft ? 0.4 : 1) * fade;
      arcRing(ctx, cx, cy, rad, w * 4, r.c, al * 0.12); arcRing(ctx, cx, cy, rad, w * 2, r.c, al * 0.3); arcRing(ctx, cx, cy, rad, w, r.soft ? r.c : WHITE, al * 0.95);
      if (r.dots) { ctx.fillStyle = rgba(WHITE, 1); ctx.globalAlpha = al; for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU + q * 0.6, j = 1 + 0.06 * Math.sin(i * 7.3 + q * 20); ctx.fillRect(Math.round(cx + Math.cos(a) * rad * j), Math.round(cy + Math.sin(a) * rad * j), Math.round(3 * u), Math.round(3 * u)); } }
    }
    for (const q of S.sparks) {
      ctx.globalAlpha = (1 - q.age / q.life) * fade; ctx.fillStyle = rgba(q.c, 1);
      if (q.streak) { ctx.strokeStyle = rgba(q.c, 1); ctx.lineCap = "butt"; ctx.lineWidth = q.s; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.045, q.y - q.vy * 0.045); ctx.stroke(); }
      else ctx.fillRect(Math.round(q.x / 2) * 2, Math.round(q.y / 2) * 2, q.s, q.s);
    }
    for (const q of S.trail) { const a = 1 - q.age / q.life; ctx.globalAlpha = a * a * fade; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(Math.round(q.x / 2) * 2, Math.round(q.y / 2) * 2, q.s, q.s); }
    for (const m of S.motes) { ctx.globalAlpha = (0.5 + 0.5 * Math.sin(t * 6 + m.sw)) * 0.8 * fade; ctx.fillStyle = rgba(m.c, 1); ctx.fillRect(Math.round(m.x), Math.round(m.y), m.s, m.s); }
    if (S.flash) {
      const f = S.flash, age = t - f.t, dur = f.big ? 0.5 : 0.3;
      if (age < dur) { const q = age / dur; if (f.big) { glow(ctx, cx, cy, S.KS * (0.8 + 1.4 * outCubic(q)), WHITE, 0.95 * (1 - q) * (1 - q)); glow(ctx, cx, cy, S.KS * 2.4, GOLD, 0.45 * (1 - q)); } else glow(ctx, cx, cy, f.r * (0.4 + 0.6 * outCubic(q)), WHITE, f.a * (1 - q)); }
    }
    // the key itself: from the front its art, from the back a dark gold silhouette, and at first a figure of light
    if (t > T.key0 && S.sprite && K.s > 1) {
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = K.a; ctx.save(); ctx.translate(K.x, K.y); ctx.scale(Math.max(0.02, Math.abs(K.sx)), 1);
      const s = K.s, r = [-s / 2, -s / 2, s, s];
      ctx.drawImage(S.sprite, ...r);
      if (K.sx < 0) ctx.drawImage(sil(S, S.sprite, [58, 40, 12], 0.92), ...r);
      const wIn = clamp(1 - K.p / 0.35); if (wIn > 0) ctx.drawImage(sil(S, S.sprite, WHITE, wIn), ...r);
      ctx.restore();
      ctx.globalCompositeOperation = "lighter";
      if (!S.sealed && Math.abs(K.sx) < 0.25) glow(ctx, K.x, K.y, s * 0.5, WHITE, (0.25 - Math.abs(K.sx)) * 2.4 * K.a);
      // glints: four-pointed stars that catch on the key once it rests
      for (const gl of S.glints) { const e = Math.sin(Math.PI * (gl.age / gl.life)), x = K.x + gl.x * s, y = K.y + gl.y * s, L = gl.s * u * e * 2; ctx.globalAlpha = e * K.a; ctx.fillStyle = rgba(WHITE, 1); ctx.fillRect(Math.round(x - L), Math.round(y - u), Math.round(2 * L), Math.max(1, Math.round(2 * u))); ctx.fillRect(Math.round(x - u), Math.round(y - L), Math.max(1, Math.round(2 * u)), Math.round(2 * L)); }
    }
    ctx.globalCompositeOperation = "source-over";
    // the words
    if (t > T.text) {
      const pix = (n) => `${n}px "Press Start 2P", monospace`, mono = (n) => `${n}px "IBM Plex Mono", monospace`;
      const shade = (y, h, a) => { ctx.save(); ctx.translate(cx, y); ctx.scale(1, h / (W * 0.3)); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.3); g.addColorStop(0, rgba(VOID, a)); g.addColorStop(1, rgba(VOID, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(-W * 0.3, -W * 0.3, W * 0.6, W * 0.6); ctx.restore(); };
      const ya = cy + S.R2 + 28 * u; shade(ya + 40 * u, 70 * u, 0.7 * fade * clamp((t - T.text) / 0.4)); if (t > T.hint) shade(H - 38 * u, 24 * u, 0.6 * fade);
      const f0 = Math.max(10, Math.round(13 * u)), y0 = Math.max(18 * u, cy - S.R2 - 26 * u - f0);
      text(ctx, "A MYTHIC KEY", cx, y0, pix(f0), GOLD, clamp((t - T.text) / 0.4) * fade, true, Math.round(4 * u));
      let f1 = Math.max(12, Math.round(22 * u)); ctx.font = pix(f1); while (f1 > 10 && ctx.measureText(S.key).width > W * 0.9) { f1--; ctx.font = pix(f1); }
      const n = Math.floor((t - T.text - 0.3) / 0.04), y1 = cy + S.R2 + 28 * u;
      text(ctx, S.key.slice(0, Math.max(0, n)), cx, y1, pix(f1), WHITE, fade);
      const t2 = T.text + 0.3 + S.key.length * 0.04 + 0.15, f2 = Math.max(12, Math.round(17 * u));
      text(ctx, `the key of ${S.alchemist}`, cx, y1 + f1 + 18 * u, mono(f2), [242, 210, 140], clamp((t - t2) / 0.5) * fade, true);
      text(ctx, "one of twenty-one", cx, y1 + f1 + f2 + 32 * u, mono(Math.max(11, Math.round(13 * u))), [176, 170, 154], clamp((t - t2 - 0.5) / 0.5) * fade, false, 2);
      if (t > T.hint && !S.exitAt) text(ctx, "click anywhere to keep it", cx, H - 44 * u, mono(Math.max(11, Math.round(13 * u))), INK, (0.65 + 0.3 * Math.sin((t - T.hint) * 3)) * clamp((t - T.hint) / 0.6), true, 1);
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================ playing
  // Reveals of each kind play one after another; one that arrives while the tab is hidden waits until it is seen.
  const queue = { find: Promise.resolve(), key: Promise.resolve() };
  const visible = () => (document.hidden ? new Promise((r) => { const f = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", f); r(); } }; document.addEventListener("visibilitychange", f); }) : Promise.resolve());
  function run(S, ctx, step, draw, onFrame) {
    return new Promise((done) => {
      let last = performance.now(), acc = 0;
      const loop = (now) => {
        acc += Math.min(0.1, (now - last) / 1000); last = now;
        while (acc >= DT && !S.done) { step(S); acc -= DT; }
        draw(S, ctx); if (onFrame) onFrame(S);
        if (S.done) done(); else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }
  async function prepFind(o) {
    const W = o.stage.clientWidth, H = o.stage.clientHeight;
    const [vial, item] = await Promise.all([plainSprite(o.vialSrc), keyed(o.itemSrc)]);
    const cv = document.createElement("canvas"); cv.className = "reveal-fx"; cv.width = W; cv.height = H;
    const o2 = { ...o, width: W, height: H, color: o.color || tierColor(clamp(o.tier | 0, 1, 5)) }, spr = { vial, item };
    return { cv, ctx: cv.getContext("2d"), S: buildFind(o2, spr), o2, spr };
  }
  // A find out of its vial on the stage. o: { stage, grid, from, to, vialSrc, itemSrc, tier, tierName, name, upgraded,
  // seed, onDone }; onDone runs when the find has gone to the shelf (or at once, when there is nothing to show).
  function find(o) {
    const job = queue.find.then(async () => {
      await visible();
      if (!o.stage || o.stage.clientWidth < 120) return;
      const { cv, ctx, S } = await prepFind(o);
      if (!S.item) return;
      drawFind(S, ctx); o.stage.insertBefore(cv, o.stage.querySelector(".hud"));
      await run(S, ctx, stepFind, drawFind);
      cv.remove();
    }).catch(() => {}).then(() => { if (o.onDone) o.onDone(); });
    queue.find = job;
    return job;
  }
  const originPoint = (o) => {
    if (!o) return null; if (Array.isArray(o)) return o;
    const r = o.getBoundingClientRect && o.getBoundingClientRect(); if (!r || !r.width) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight ? [x, y] : null; // only a place the player can see
  };
  // The ceremony of a mythic key. o: { src, key, alchemist, idx, origin (an element or [x, y] in the viewport) }
  function key(o) {
    const job = queue.key.then(async () => {
      await visible();
      const sprite = await keyed(o.src);
      const box = document.createElement("div"); box.className = "keyrite"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", `A mythic key: ${o.key}. Click to keep it.`); box.tabIndex = -1;
      const cv = document.createElement("canvas"); box.appendChild(cv); document.body.appendChild(box);
      const fit = () => { cv.width = innerWidth; cv.height = innerHeight; };
      fit();
      const S = buildKey({ ...o, width: cv.width, height: cv.height, origin: originPoint(o.origin), seed: (o.idx || 0) + 11 }, { key: sprite }), ctx = cv.getContext("2d");
      const onResize = () => { fit(); S.W = cv.width; S.H = cv.height; layoutKey(S); if (reduce) drawKey(S, ctx); };
      let closeStill = null;
      // a click before the seal skips to it; a click once the name is up keeps the key
      const skip = () => { if (reduce) { if (closeStill) closeStill(); return; } if (S.exitAt) return; if (S.t < S.T.seal - 0.1) { while (S.t < S.T.seal - 0.08) stepKey(S); } else if (S.t > S.T.text + 0.3) S.exitAt = S.t; };
      const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); skip(); } };
      addEventListener("resize", onResize); addEventListener("keydown", onKey); box.addEventListener("click", skip);
      requestAnimationFrame(() => box.classList.add("on")); try { box.focus({ preventScroll: true }); } catch {}
      if (reduce) { // no motion: the final picture, still, until the player keeps it
        while (S.t < S.T.hint + 0.5) stepKey(S);
        S.shake = 0; S.flash = null; S.sparks = []; S.rings = []; drawKey(S, ctx);
        await new Promise((r) => { closeStill = r; }); box.classList.add("out"); await new Promise((r) => setTimeout(r, 700));
      } else await run(S, ctx, stepKey, drawKey, () => { if (S.exitAt) box.classList.add("out"); });
      removeEventListener("resize", onResize); removeEventListener("keydown", onKey); box.remove();
    }).catch(() => {});
    queue.key = job;
    return job;
  }

  // the shared toolkit, for the other scenes built the same way (forge.js)
  const fx = { DT, TAU, clamp, lerp, smooth, outCubic, inCubic, outBack, rng, hex, rgba, mix, snap, glow, arcRing, dots, rays, text, upd, prune, sil, keyed, plainSprite, tierColor, run, visible, reduce };
  const api = { find, key, fx };
  // ?vfxdev=1: load a find or a key once, then render the frame at any moment (frames come out the same in any order)
  if (new URLSearchParams(location.search).get("vfxdev")) {
    api.dev = {
      async loadFind(o) { this.unload(); const r = await prepFind(o); Object.assign(this, { kind: "find", cv: r.cv, ctx: r.ctx, o: r.o2, spr: r.spr, host: o.stage }); o.stage.insertBefore(r.cv, o.stage.querySelector(".hud")); return r.S.T; },
      async loadKey(o) {
        this.unload(); const sprite = await keyed(o.src), box = document.createElement("div"); box.className = "keyrite on"; box.style.pointerEvents = "none";
        const cv = document.createElement("canvas"); cv.width = innerWidth; cv.height = innerHeight; box.appendChild(cv); document.body.appendChild(box);
        const o2 = { ...o, width: cv.width, height: cv.height, origin: originPoint(o.origin), seed: (o.idx || 0) + 11 };
        Object.assign(this, { kind: "key", cv, ctx: cv.getContext("2d"), o: o2, spr: { key: sprite }, host: box }); return buildKey(o2, this.spr).T;
      },
      // exit: for a key, the moment the player clicks to keep it
      frame(t, exit) {
        const find = this.kind === "find", S = find ? buildFind(this.o, this.spr) : buildKey(this.o, this.spr), step = find ? stepFind : stepKey;
        while (S.t < t - DT / 2 && !S.done) { if (exit && !S.exitAt && S.t >= exit) S.exitAt = S.t; step(S); }
        (find ? drawFind : drawKey)(S, this.ctx); this.S = S; return S.T;
      },
      unload() { if (this.kind === "find" && this.cv) this.cv.remove(); if (this.kind === "key" && this.host) this.host.remove(); this.kind = null; },
    };
  }
  return api;
})();
