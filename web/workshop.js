// Workshop scenes. Every station has its own scene, always on screen above its controls, and every craft of the station
// plays in it in its own way: the cauldron where potions are brewed, the blueprint a furnace is built on, the furnace
// room where refining happens, the crucible that deals out what the melt became, the ritual table where the sigil draws
// itself and the item takes shape. Between crafts a scene idles and shows the state of its station: the selected furnace,
// a furnace cooling down, a sealed melt, the last result. A commit only ever shows what went in; the outcome of a
// refine, a melt or a rite appears at its reveal and not a moment before.
// Each scene is a fixed-step simulation with a seeded random; ?vfxdev=1 renders any moment of any event.
window.AlchWS = (() => {
  const R = window.AlchReveal && window.AlchReveal.fx;
  if (!R) return null;
  const { DT, TAU, clamp, lerp, smooth, outCubic, inCubic, outBack, rng, rgba, mix, glow, arcRing, dots, rays, text, upd, prune, sil, keyed, plainSprite, tierColor, reduce } = R;
  const WHITE = [255, 255, 255], GOLD = [242, 196, 85], INK = [233, 228, 214], SOFT = [176, 170, 154], ASH = [224, 122, 111], GLASS = [191, 233, 255], CHALK = [214, 226, 240];
  const TIERS = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
  const FURNACE = ["", "Clay", "Iron", "Brass", "Athanor"];
  const CATC = [[168, 172, 180], [96, 150, 222], [84, 190, 110], [168, 118, 70], [206, 84, 72]]; // metals, minerals, herbs, woods, beasts

  // ---------------------------------------------------------------- shared helpers
  const pix = (n) => `${n}px "Press Start 2P", monospace`, mono = (n) => `${n}px "IBM Plex Mono", monospace`;
  const fsz = (S, base) => Math.max(S.W < 520 ? 7 : 9, Math.round((base * S.W) / 860)); // a phone-sized scene gets small type
  const arc = (a, b, lift, p) => { const m = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift], q = 1 - p; return [q * q * a[0] + 2 * q * p * m[0] + p * p * b[0], q * q * a[1] + 2 * q * p * m[1] + p * p * b[1]]; };
  const px = (S, v) => Math.round(v / S.s) * S.s; // snap to the scene's pixel grid
  function base(W, H, seed) { return { t: 0, W, H, rand: rng(seed || 3), drand: rng(9), s: 2, cache: new Map(), sparks: [], smoke: [], trail: [], burst: [], shards: [], rings: [], motes: [], flames: [], embers: [], shake: 0, done: false }; }
  // the common particles: sparks bounce on the floor, smoke swells and drifts, rings of light expand
  function stepParts(S) {
    const s = S.s;
    upd(S.sparks, 0.3); upd(S.trail, 0.05); upd(S.burst, 0.35); upd(S.shards, 0.7, 300 * s); upd(S.motes, 0.9); upd(S.flames, 0.4); upd(S.embers, 0.9);
    for (const q of S.sparks) if (q.bounce && q.y > S.floor + 2 * s && q.vy > 0) { q.y = S.floor + 2 * s; q.vy *= -0.35; q.vx *= 0.6; }
    for (const q of S.smoke) { q.age += DT; q.x += q.vx * DT; q.y += q.vy * DT; q.vx *= Math.pow(0.4, DT); q.vy *= Math.pow(0.6, DT); q.r += q.gr * DT; }
    for (const e of S.embers) e.x += Math.sin(S.t * 3 + (e.sw || 0)) * 6 * s * DT;
    for (const r of S.rings) r.age += DT;
    for (const f of S.flames) if (f.top !== undefined && f.y < f.top) f.age = f.life;
    prune(S, ["sparks", "trail", "burst", "shards", "motes", "flames", "embers", "smoke", "rings"]);
    S.shake *= Math.pow(0.003, DT);
  }
  function drawParts(S, ctx, fireCol) {
    const s = S.s;
    ctx.globalCompositeOperation = "lighter";
    for (const r of S.rings) { if (r.age < 0) continue; const q = r.age / r.life, rad = lerp(r.r0, r.r1, outCubic(q)); arcRing(ctx, r.x, r.y, rad, 3 * s, r.c, (1 - q) * 0.25); dots(ctx, r.x, r.y, rad, s, mix(r.c, WHITE, 0.5), 1 - q); }
    for (const f of S.burst) { const q = f.age / f.life; ctx.globalAlpha = 1 - q; ctx.fillStyle = rgba(f.c || (fireCol ? fireCol(clamp(0.88 - q * 0.8)) : GOLD), 1); const z = (f.z || 2) * s; ctx.fillRect(px(S, f.x), px(S, f.y), z, z); }
    for (const q of S.sparks) { ctx.globalAlpha = 1 - q.age / q.life; ctx.fillStyle = rgba(q.c, 1); const z = (q.z || 1) * s; ctx.fillRect(px(S, q.x), px(S, q.y), z, z); }
    for (const q of S.trail) { const a = 1 - q.age / q.life; ctx.globalAlpha = a * a; ctx.fillStyle = rgba(q.c, 1); ctx.fillRect(px(S, q.x), px(S, q.y), s, s); }
    for (const m of S.motes) { ctx.globalAlpha = (1 - m.age / m.life) * (m.a || 1); ctx.fillStyle = rgba(m.c, 1); ctx.fillRect(px(S, m.x), px(S, m.y), s, s); }
    ctx.globalCompositeOperation = "source-over";
    for (const q of S.shards) { ctx.globalAlpha = 1 - q.age / q.life; ctx.fillStyle = rgba(q.c, 1); const z = (q.z || 1) * s; ctx.fillRect(px(S, q.x), px(S, q.y), z, z); }
    for (const q of S.smoke) { const a = (1 - q.age / q.life) * q.a; if (a <= 0 || q.age < 0) continue; const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r); g.addColorStop(0, rgba(q.c, a)); g.addColorStop(1, rgba(q.c, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(q.x - q.r, q.y - q.r, q.r * 2, q.r * 2); }
    ctx.globalAlpha = 1;
  }
  // a plate of words centred on x from y down: [[text, font, colour, customDraw?], ...]
  function plate(ctx, x, y, lines, a, border) {
    if (a <= 0) return;
    const small = ctx.canvas.width < 520, gap = small ? 4 : 8, pad = small ? 12 : 28;
    let w = 0, h = small ? 8 : 14; for (const [s, f] of lines) { ctx.font = f; w = Math.max(w, ctx.measureText(s).width + s.length); h += parseInt(f, 10) + gap; }
    const pw = Math.round(w + pad), x0 = Math.round(clamp(x - pw / 2, 8, ctx.canvas.width - pw - 14)), y0 = Math.round(y); x = x0 + pw / 2;
    ctx.globalAlpha = a; ctx.fillStyle = "#0b0d0f"; ctx.fillRect(x0 + 4, y0 + 4, pw, h); ctx.fillStyle = "rgba(11,13,15,.9)"; ctx.fillRect(x0, y0, pw, h);
    ctx.strokeStyle = rgba(border, 1); ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, pw - 2, h - 2);
    let yy = y0 + (small ? 5 : 10); for (const [s, f, c, custom] of lines) { if (custom) custom(ctx, x, yy, a); else text(ctx, s, x, yy, f, c, a, false, 1); yy += parseInt(f, 10) + gap; }
    ctx.globalAlpha = 1;
  }
  // the state of the station, top left of the scene
  function tag(S, ctx, msg, c) {
    if (!msg || S.W < 520) return; // on a phone the controls under the scene say the same
    const f = mono(fsz(S, 12)); ctx.font = f; const w = ctx.measureText(msg).width + 16, h = fsz(S, 12) + 12;
    ctx.globalAlpha = 1; ctx.fillStyle = "rgba(11,13,15,.82)"; ctx.fillRect(10, 10, w, h); ctx.strokeStyle = "#3a434c"; ctx.lineWidth = 1; ctx.strokeRect(10.5, 10.5, w - 1, h - 1);
    ctx.fillStyle = rgba(c || SOFT, 1); ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(msg, 18, 16);
  }
  function drawSpr(ctx, spr, x, y, z, a = 1, rot = 0) { if (!spr || z <= 0.5) return; ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.drawImage(spr, -z / 2, -z / 2, z, z); ctx.restore(); }
  function whiteIn(S, ctx, spr, x, y, z, p, c = WHITE) { const w = clamp(1 - p); if (w > 0 && spr) drawSpr(ctx, sil(S, spr, c, w), x, y, z); }
  // the bounds of each row of a sprite (for building a furnace row by row) and its opaque cells (to land things on)
  const shapes = new Map();
  function shape(spr) {
    if (!spr) return null; if (shapes.has(spr)) return shapes.get(spr);
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); g.drawImage(spr, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data;
    const rows = [], cells = [], edge = []; let top = 64, bot = -1;
    for (let y = 0; y < 64; y++) { let a = -1, b = -1; for (let x = 0; x < 64; x++) if (d[(y * 64 + x) * 4 + 3] > 0) { if (a < 0) a = x; b = x; cells.push([x, y]); } rows.push(a < 0 ? null : [a, b]); if (a >= 0) { top = Math.min(top, y); bot = y; } }
    const on = (x, y) => x >= 0 && y >= 0 && x < 64 && y < 64 && d[(y * 64 + x) * 4 + 3] > 0;
    for (const [x, y] of cells) if (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)) edge.push([x, y]);
    const r = { rows, cells, edge, top, bot }; shapes.set(spr, r); return r;
  }
  // backdrops, drawn once per size: a wall of blocks and a floor, in the palette of each room
  function backdrop(S, o) {
    const c = document.createElement("canvas"); c.width = S.W; c.height = S.H; const g = c.getContext("2d"), rand = rng(o.seed || 5), b = Math.max(2, S.s);
    g.fillStyle = o.bg; g.fillRect(0, 0, S.W, S.H);
    const bw = b * o.bw, bh = b * o.bh;
    for (let y = 0, row = 0; y < S.floor; y += bh, row++) for (let x = row % 2 ? -bw / 2 : 0; x < S.W; x += bw) {
      const v = rand(), X = Math.round(x), col = mix(o.brick[0], o.brick[1], v);
      g.fillStyle = rgba(col, 1); g.fillRect(X + b, y + b, bw - b, bh - b);
      g.fillStyle = "rgba(255,255,255,0.03)"; g.fillRect(X + b, y + b, bw - b, b);
    }
    if (o.wall) o.wall(g, S, rand, b);
    g.fillStyle = o.floor; g.fillRect(0, S.floor, S.W, S.H - S.floor);
    for (let x = 0; x < S.W; x += bw * 2) { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(Math.round(x), S.floor, b, S.H - S.floor); }
    g.fillStyle = o.lip; g.fillRect(0, S.floor, S.W, b);
    const v = g.createRadialGradient(S.W * 0.4, S.H * 0.55, S.H * 0.25, S.W * 0.4, S.H * 0.55, S.W * 0.75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.7)");
    g.fillStyle = v; g.fillRect(0, 0, S.W, S.H);
    return c;
  }
  function frame(S, ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, S.W, S.H); ctx.imageSmoothingEnabled = false; ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.drawImage(S.bg, 0, 0); if (S.shake > 0.4) ctx.translate(Math.round((S.drand() - 0.5) * 2 * S.shake), Math.round((S.drand() - 0.5) * 2 * S.shake)); }
  const fmtLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  // ================================================================ the furnace room (refining)
  // Where the fire and the flue are on each furnace, in cells of its 64px art: firebox [x, y, w, h] (centre and size),
  // the top of the flue, the lowest row of the art, and the colour its fire burns (the brass furnace burns green).
  const FURN = {
    1: { door: [24, 41, 12, 14], chim: [31, 6], maxY: 57, fire: "orange" },
    2: { door: [22.5, 41, 20, 15], chim: [31, 4], maxY: 60, fire: "orange" },
    3: { door: [20, 46, 14, 11], chim: [46, 3], maxY: 60, fire: "green" },
    4: { door: [29, 50, 8, 10], chim: [31, 3], maxY: 61, fire: "orange" },
  };
  const FIRE = { orange: [[70, 18, 8], [190, 60, 20], [255, 140, 40], [255, 214, 110], [255, 248, 225]], green: [[24, 50, 24], [80, 150, 60], [180, 225, 110], [232, 250, 185], [255, 255, 240]] };
  const fireOf = (kind) => (h) => { const p = FIRE[kind], x = clamp(h) * (p.length - 1), i = Math.min(p.length - 2, Math.floor(x)); return mix(p[i], p[i + 1], x - i); };
  // the fire painted into the furnace art: a mask of its hot pixels in the firebox, to darken it with the real fire
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
  const ROOM = { bg: "#0c0e11", brick: [[24, 23, 27], [32, 30, 35]], bw: 14, bh: 6, floor: "#121417", lip: "#1d2025" };
  function forgeRoom(W, H, o, spr) {
    const S = base(W, H, o.seed), F = FURN[clamp(o.furnace | 0, 1, 4)];
    const s = Math.max(2, Math.floor((H * 0.78) / 64)), floor = Math.round(H * 0.84), fx = Math.round(W * 0.33);
    Object.assign(S, { F, s, floor, sx0: fx - 32 * s, sy0: floor + 3 * s - (F.maxY + 1) * s, RX: Math.round(W * 0.73), furnace: spr.furnace, mask: fireMask(spr.furnace, F), heat: 0.25, fireAt: fireOf(F.fire) });
    S.door = [S.sx0 + F.door[0] * s, S.sy0 + F.door[1] * s, F.door[2] * s, F.door[3] * s]; S.chim = [S.sx0 + F.chim[0] * s, S.sy0 + F.chim[1] * s];
    S.IS = Math.round(Math.min(H * 0.34, W * 0.2));
    S.bg = backdrop(S, ROOM);
    return S;
  }
  function stepFire(S) {
    const { rand, s } = S, [dx, dy, dw, dh] = S.door, h = S.heat;
    if (!S.ghost) {
      const n = Math.round(1 + h * 4);
      for (let i = 0; i < n; i++) if (rand() < 0.25 + h * 0.65) S.flames.push({ x: dx + (rand() - 0.5) * dw * 0.9, y: dy + dh * 0.42, vx: (rand() - 0.5) * 6 * s, vy: -(8 + rand() * 18 + h * 30) * s, g: 0, life: 0.25 + rand() * 0.35, age: 0, top: dy - dh * 0.5 });
      if (h > 0.12 && rand() < 0.04 + h * 0.45) S.embers.push({ x: S.chim[0] + (rand() - 0.5) * 3 * s, y: S.chim[1], vx: (rand() - 0.5) * 8 * s, vy: -(12 + rand() * 20 + h * 22) * s, g: -2 * s, life: 1 + rand() * 1.2, age: 0, sw: rand() * TAU });
    }
    stepParts(S);
  }
  function drawRoom(S, ctx) {
    const { W, s, t } = S, [dx, dy, dw] = S.door, h = S.heat;
    frame(S, ctx);
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, dx, dy, W * 0.5 * (0.35 + 0.65 * h), S.fireAt(0.55), 0.08 + 0.26 * h);
    glow(ctx, dx + dw, S.floor + 4 * s, W * 0.36 * (0.4 + 0.6 * h), S.fireAt(0.6), 0.1 + 0.22 * h);
    ctx.globalCompositeOperation = "source-over";
    if (S.ghost && S.furnace) { // no furnace yet: its outline in chalk
      ctx.drawImage(sil(S, S.furnace, CHALK, 0.1 + 0.05 * Math.sin(t * 2)), S.sx0, S.sy0, 64 * s, 64 * s);
      const sh = shape(S.furnace); ctx.fillStyle = rgba(CHALK, 1); ctx.globalAlpha = 0.35 + 0.1 * Math.sin(t * 2); for (const [x, y] of sh.edge) if ((x + y) % 2 === 0) ctx.fillRect(S.sx0 + x * s, S.sy0 + y * s, s, s); ctx.globalAlpha = 1;
      return;
    }
    if (S.furnace) {
      const amp = h * h * 0.55 * s, top = S.F.door[1] - S.F.door[3] / 2;
      for (let r = 0; r < 64; r++) { const up = clamp((top - r) / top), off = amp > 0.4 && up > 0 ? Math.round(Math.sin(t * 8 + r * 0.5) * amp * up) : 0; ctx.drawImage(S.furnace, 0, r, 64, 1, S.sx0 + off, S.sy0 + r * s, 64 * s, s); }
      const out = clamp((0.5 - h) / 0.42); if (S.mask && out > 0) ctx.drawImage(sil(S, S.mask, [20, 14, 11], 0.92 * out), S.sx0, S.sy0, 64 * s, 64 * s);
    }
    ctx.globalCompositeOperation = "lighter";
    const dr = Math.min(dw, 13 * s);
    glow(ctx, dx, dy, dr * (0.9 + 1.5 * h), S.fireAt(0.35 + 0.6 * h), 0.35 + 0.55 * h);
    glow(ctx, dx, dy, dr * 0.55, S.fireAt(0.75 + 0.25 * h), 0.2 + 0.7 * h * h);
    for (const f of S.flames) { const q = f.age / f.life; ctx.globalAlpha = 1 - q * 0.6; ctx.fillStyle = rgba(S.fireAt(clamp(h + 0.35 - q * 0.9)), 1); ctx.fillRect(px(S, f.x), px(S, f.y), s, s); }
    for (const e of S.embers) { ctx.globalAlpha = (1 - e.age / e.life) * (0.6 + 0.4 * Math.sin(t * 12 + e.sw)); ctx.fillStyle = rgba(S.fireAt(0.7), 1); ctx.fillRect(px(S, e.x), px(S, e.y), s, s); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  function flare(S, n, spread, up) { const { rand, s } = S, [dx, dy] = S.door; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (rand() - 0.5) * spread, v = (40 + rand() * up) * s; S.burst.push({ x: dx + (rand() - 0.5) * S.door[2] * 0.6, y: dy, vx: Math.cos(a) * v + 12 * s, vy: Math.sin(a) * v, g: -30 * s, life: 0.35 + rand() * 0.5, age: 0, z: rand() < 0.25 ? 3 : rand() < 0.6 ? 2 : 1 }); } }
  function flueJet(S, n) { const { rand, s } = S; for (let i = 0; i < n; i++) S.burst.push({ x: S.chim[0] + (rand() - 0.5) * 3 * s, y: S.chim[1], vx: (rand() - 0.5) * 50 * s, vy: -(35 + rand() * 80) * s, g: 30 * s, life: 0.5 + rand() * 0.6, age: 0, z: 1, c: S.fireAt(0.5 + rand() * 0.35) }); }
  // what the last melt left on the right: the refined ingredient in its light, or the cooled slag
  function slagOf(rand) {
    const w = 18, h = 11, cells = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const nx = (x - w / 2 + 0.5) / (w / 2), ny = (y - h + 0.5) / h; if (nx * nx + ny * ny * 1.1 < 0.9 + (rand() - 0.5) * 0.35) cells.push([x, y]); }
    const set = new Set(cells.map(([x, y]) => x + "," + y)), edge = new Set(cells.filter(([x, y]) => !set.has(x - 1 + "," + y) || !set.has(x + 1 + "," + y) || !set.has(x + "," + (y - 1)) || !set.has(x + "," + (y + 1))).map(([x, y]) => x + "," + y));
    let cx = 3 + Math.floor(rand() * 3), cy = Math.floor(h * 0.55); const cracks = [];
    for (let i = 0; i < 16; i++) { cx += rand() < 0.75 ? 1 : 0; cy = clamp(cy + (rand() < 0.45 ? (rand() < 0.5 ? 1 : -1) : 0), 3, h - 3); if (set.has(cx + "," + cy)) cracks.push([cx, cy]); }
    for (let i = 0; i < 6; i++) { const [x, y] = cells[Math.floor(rand() * cells.length)]; if (y > 2 && y < h - 2) cracks.push([x, y]); }
    return { w, h, cells, edge, cracks };
  }
  function drawSlag(S, ctx, sl, x, y, cool) {
    const z = S.s, x0 = Math.round(x - (sl.w * z) / 2), y0 = Math.round(y - sl.h * z);
    for (const [cx, cy] of sl.cells) { ctx.fillStyle = sl.edge.has(cx + "," + cy) ? "#141210" : cy < 3 ? "#5a534b" : cy > sl.h - 4 ? "#24211d" : "#3a3530"; ctx.fillRect(x0 + cx * z, y0 + cy * z, z, z); }
    ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = rgba(mix([255, 150, 40], [60, 44, 34], cool), 1);
    for (const [cx, cy] of sl.cracks) ctx.fillRect(x0 + cx * z, y0 + cy * z, z, z);
    glow(ctx, x, y - (sl.h * z) / 2, sl.w * z * 1.2, [255, 120, 30], 0.45 * (1 - cool)); ctx.globalCompositeOperation = "source-over";
  }
  function tiersLine(S, tin, tout, cIn, cOut) {
    const f = pix(fsz(S, 13)), n = fsz(S, 13);
    return [`${tin} ${tout}   `, f, WHITE, (c, x, y, al) => { c.font = f; const w1 = c.measureText(tin).width, w2 = c.measureText(tout).width, gap = n * 2.4, x0 = x - (w1 + gap + w2) / 2; c.textAlign = "left"; c.textBaseline = "top"; c.globalAlpha = al; c.fillStyle = rgba(mix(cIn, WHITE, 0.35), 1); c.fillText(tin, x0, y); c.fillStyle = rgba(mix(cOut, WHITE, 0.35), 1); c.fillText(tout, x0 + w1 + gap, y); const ax = x0 + w1 + gap * 0.2, aw = gap * 0.6, ay = y + n / 2; c.fillStyle = rgba(INK, 1); c.fillRect(Math.round(ax), Math.round(ay - 1), Math.round(aw), 3); c.fillRect(Math.round(ax + aw - 5), Math.round(ay - 4), 3, 9); c.fillRect(Math.round(ax + aw - 2), Math.round(ay - 2), 3, 5); }];
  }
  function drawMeltResult(S, ctx, r, t, a = 1) {
    if (!r) return;
    if (r.ok) {
      const x = S.RX, y = S.H * 0.4 + Math.sin(t * 2.4) * 0.75 * S.s, z = S.IS;
      ctx.globalCompositeOperation = "lighter";
      if (r.tier + 1 >= 4) rays(ctx, x, y, 12, z * 1.1, 0.09, 0.3 * t, WHITE, mix(r.cOut, WHITE, 0.45), 0.24 * a);
      glow(ctx, x, y, z * 0.95, r.cOut, 0.4 * a); glow(ctx, x, y, z * 0.45, mix(r.cOut, WHITE, 0.5), 0.25 * a);
      if (r.tier + 1 >= 3) dots(ctx, x, y, z * 0.64, S.s, mix(r.cOut, WHITE, 0.5), (0.3 + 0.2 * Math.sin(t * 4)) * a, t * 0.6);
      ctx.globalCompositeOperation = "source-over"; drawSpr(ctx, r.out, x, y, z, a);
      plate(ctx, S.RX, S.H * 0.4 + S.IS / 2 + 14, [["REFINED", pix(fsz(S, 11)), GOLD], tiersLine(S, TIERS[r.tier].toUpperCase(), TIERS[r.tier + 1].toUpperCase(), r.cIn, r.cOut), [r.name, mono(fsz(S, 15)), INK]], a, r.cOut);
    } else {
      drawSlag(S, ctx, r.slag, r.slagX, S.floor + 2 * S.s, 1);
      plate(ctx, S.RX, S.H * 0.2, [["THE MELT DID NOT TAKE", pix(fsz(S, 12)), ASH], ["the ingredients burned away", mono(fsz(S, 14)), INK]], a, [120, 70, 60]);
    }
  }
  const Forge = {
    async load(p) { return { furnace: await keyed(`img/furnace-${p.furnace || 1}.png`) }; },
    init(W, H, p, spr, memo) { const S = forgeRoom(W, H, { furnace: p.furnace || 1, seed: 3 }, spr); S.ghost = !p.furnace; S.heat = memo.heat !== undefined ? memo.heat : 0.25; return S; },
    idle(S, p, memo) {
      const now = p.now ? p.now() : Date.now(), left = p.coolUntil ? p.coolUntil - now : 0, sealed = p.sealed || memo.sealed;
      const target = S.ghost ? 0 : sealed ? 0.62 : left > 0 ? 0.25 + 0.5 * clamp(left / (p.cooldown || 120000)) : 0.25;
      S.heat += (target - S.heat) * Math.min(1, DT * 0.8);
      if (!S.ghost && left > 0 && !sealed && S.rand() < 0.12) S.smoke.push({ x: S.chim[0] + (S.rand() - 0.5) * 3 * S.s, y: S.chim[1], vx: (S.rand() - 0.3) * 8 * S.s, vy: -(14 + S.rand() * 10) * S.s, r: 2 * S.s, gr: 5 * S.s, life: 1.6, age: 0, a: 0.3, c: [120, 120, 124] });
      S.t += DT; stepFire(S); memo.heat = S.heat;
    },
    draw(S, ctx, p, memo) {
      const now = p.now ? p.now() : Date.now(), left = p.coolUntil ? p.coolUntil - now : 0, sealed = p.sealed || (memo.sealed && { ready: false });
      drawRoom(S, ctx); drawParts(S, ctx, S.fireAt);
      if (!sealed) drawMeltResult(S, ctx, memo.result, S.t); // a new melt sealed: the result of the last one is gone from the room
      const name = p.furnace ? `${FURNACE[p.furnace].toUpperCase()} FURNACE${p.furnaceId ? " #" + p.furnaceId : ""}` : "NO FURNACE YET";
      tag(S, ctx, S.ghost ? "no furnace yet · build one at the Furnace station" : sealed ? `${name} · a melt is sealed · ${sealed.ready ? "ready to reveal" : "reveals after the next minute"}` : left > 0 ? `${name} · cooling ${fmtLeft(left)}` : `${name} · ready`, sealed && sealed.ready ? GOLD : left > 0 ? [150, 190, 230] : SOFT);
    },
    events: {
      // the commit: what goes in, the potion breaks in the fire, the melt is sealed
      feed: {
        async load(o) { const [ing, potion] = await Promise.all([keyed(o.ingSrc), keyed(o.potionSrc)]); return { ing, potion }; },
        build(S, o, spr) {
          const E = forgeRoom(S.W, S.H, { furnace: o.furnace, seed: o.seed || 5 }, spr); E.heat = S.heat;
          Object.assign(E, { ing: spr.ing, potion: spr.potion, n: clamp(o.n | 0, 1, 12), tier: clamp(o.tier | 0, 1, 5), name: o.name || "" }); E.c = tierColor(E.tier);
          const IS = Math.round(Math.min(E.W * 0.07, E.H * 0.13)), cols = Math.min(5, E.n), rows = Math.ceil(E.n / cols), sp = Math.round(IS * 1.12);
          const gx0 = E.RX - ((cols - 1) * sp) / 2, gy0 = Math.round(E.H * 0.4 - ((rows - 1) * sp) / 2);
          E.IS2 = IS; E.gy0 = gy0; E.h0 = S.heat;
          E.items = Array.from({ length: E.n }, (_, i) => ({ x0: gx0 + (i % cols) * sp, y0: gy0 + Math.floor(i / cols) * sp, dep: 1.0 + i * 0.12, pop: 0.35 + i * 0.03 }));
          E.pot = { x0: E.RX, y0: gy0 + rows * sp + Math.round(IS * 0.25), dep: 1.0 + (E.n - 1) * 0.12 + 0.35, pop: 0.35 + E.n * 0.03 };
          E.T = { flight: 0.55, pflight: 0.7 }; E.T.flare = E.pot.dep + E.T.pflight; E.T.text = E.T.flare + 0.6; E.T.end = E.T.flare + 2.8; E.arrived = 0;
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT), [dx, dy] = E.door, q = t - T.flare, b = lerp(E.h0, 0.25, clamp(t / 0.6)) + 0.035 * E.arrived;
          E.heat = q < 0 ? b : q < 0.2 ? lerp(b, 1, q / 0.2) : lerp(1, 0.62, smooth((q - 0.2) / 1.3));
          for (const it of E.items) {
            const p = (t - it.dep) / T.flight;
            if (p > 0 && p < 1 && rand() < 0.7) { const [x, y] = arc([it.x0, it.y0], [dx, dy], E.H * 0.18, smooth(p)); E.trail.push({ x, y, vx: 0, vy: -8 * s, g: 0, life: 0.3, age: 0, c: rand() < 0.5 ? WHITE : mix(E.c, WHITE, 0.4) }); }
            if (p >= 1 && !it.in) { it.in = true; E.arrived++; flare(E, 8, 1.4, 60); for (let i = 0; i < 6; i++) E.sparks.push({ x: dx, y: dy, vx: (rand() - 0.5) * 80 * s, vy: -rand() * 60 * s, g: 120 * s, life: 0.4 + rand() * 0.3, age: 0, c: E.fireAt(0.8) }); }
          }
          const pp = (t - E.pot.dep) / T.pflight;
          if (pp > 0 && pp < 1 && rand() < 0.8) { const [x, y] = arc([E.pot.x0, E.pot.y0], [dx, dy], E.H * 0.32, smooth(pp)); E.trail.push({ x, y, vx: 0, vy: -8 * s, g: 0, life: 0.35, age: 0, c: rand() < 0.5 ? WHITE : GLASS }); }
          if (t >= T.flare && !E.flared) {
            E.flared = true; E.shake = 1.4 * s; E.flash = t;
            for (let i = 0; i < 26; i++) { const a = rand() * TAU, v = (40 + rand() * 120) * s; E.shards.push({ x: dx, y: dy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * s, life: 0.6 + rand() * 0.5, age: 0, c: i % 3 ? GLASS : mix(E.c, WHITE, 0.3) }); }
            flare(E, 60, 1.6, 170); flueJet(E, 36);
            E.rings.push({ x: dx, y: dy, r0: 4 * s, r1: 34 * s, life: 0.5, age: 0, c: E.fireAt(0.9) }, { x: dx, y: dy, r0: 4 * s, r1: 22 * s, life: 0.4, age: -0.08, c: WHITE });
          }
          stepFire(E);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t, s } = E, IS = E.IS2, [dx, dy] = E.door;
          drawRoom(E, ctx);
          if (E.flash && t - E.flash < 0.4) { const q = (t - E.flash) / 0.4; ctx.globalCompositeOperation = "lighter"; glow(ctx, dx, dy, E.door[2] * 4 * (0.5 + q), WHITE, 0.8 * (1 - q) * (1 - q)); ctx.globalCompositeOperation = "source-over"; }
          drawParts(E, ctx, E.fireAt);
          const drawIt = (spr, it, flight, lift, spin) => {
            const pop = outBack(clamp((t - it.pop) / 0.3)); if (pop <= 0.01) return; const p = (t - it.dep) / flight; if (p >= 1) return;
            let x = it.x0, y = it.y0 + Math.sin(t * 2.4 + it.x0) * 1.5, sc = pop, rot = 0;
            if (p > 0) { const e = smooth(p); [x, y] = arc([it.x0, it.y0], [dx, dy], lift, e); sc = lerp(1, 0.3, e); rot = spin * p; }
            drawSpr(ctx, spr, x, y, IS * sc, 1, rot);
          };
          const lineupA = 1 - clamp((t - E.pot.dep) / 0.4);
          if (lineupA > 0) { ctx.globalCompositeOperation = "lighter"; glow(ctx, E.RX, E.gy0 + IS * 0.6, IS * 3.2, E.c, 0.12 * lineupA * clamp((t - 0.35) / 0.3)); ctx.globalCompositeOperation = "source-over"; }
          for (const it of E.items) drawIt(E.ing, it, T.flight, E.H * 0.18, 0.9 * TAU * 0.3);
          drawIt(E.potion, E.pot, T.pflight, E.H * 0.32, TAU * 1.5);
          const a1 = clamp((t - 0.3) / 0.3) * lineupA;
          text(ctx, "INTO THE FURNACE", E.RX, E.gy0 - IS / 2 - fsz(E, 14) - fsz(E, 12) - 18, pix(fsz(E, 11)), GOLD, a1, true, 2);
          text(ctx, `${E.n} × ${TIERS[E.tier]} ${E.name} and a potion`, E.RX, E.gy0 - IS / 2 - fsz(E, 14) - 8, mono(fsz(E, 14)), INK, a1, true);
          const a2 = clamp((t - T.text) / 0.5) * (1 - clamp((t - T.end + 0.5) / 0.5));
          if (a2 > 0) plate(ctx, E.RX, E.H * 0.3, [["THE MELT IS SEALED", pix(fsz(E, 12)), GOLD], ["reveal it after the next minute", mono(fsz(E, 14)), INK]], a2, E.fireAt(0.6));
          ctx.globalAlpha = 1;
        },
        end(S, E, memo) { S.heat = E.heat; memo.sealed = true; memo.result = null; for (const k of ["embers", "smoke", "flames"]) S[k] = E[k]; },
      },
      // the reveal: the heat builds the same way whatever comes next, then the door bursts or the fire chokes
      melt: {
        async load(o) { return { out: o.outSrc ? await keyed(o.outSrc) : null }; },
        build(S, o, spr) {
          const E = forgeRoom(S.W, S.H, { furnace: o.furnace, seed: o.seed || 7 }, spr);
          Object.assign(E, { out: spr.out, success: !!o.success, tier: clamp(o.tier | 0, 1, 4), name: o.name || "" }); E.cIn = tierColor(E.tier); E.cOut = tierColor(E.tier + 1);
          E.heat = Math.max(0.5, S.heat); E.h0 = E.heat;
          E.T = { beat: 2.35 }; E.T.item = E.T.beat + 0.08; E.T.label = E.T.beat + 0.8; E.T.end = E.T.beat + 3.2;
          E.pulses = [0.55, 1.05, 1.45, 1.78, 2.03, 2.2]; E.pulsed = 0;
          if (!E.success) E.slag = slagOf(E.rand);
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT), [dx, dy, dw] = E.door;
          if (t < T.beat) {
            let h = lerp(E.h0, 0.95, smooth((t - 0.3) / 2.05)); for (const p of E.pulses) if (t >= p && t < p + 0.18) h += 0.12 * (1 - (t - p) / 0.18);
            E.heat = clamp(h); E.heatAtBeat = E.heat;
            while (E.pulsed < E.pulses.length && t >= E.pulses[E.pulsed]) { E.pulsed++; E.shake = Math.max(E.shake, (0.4 + 0.18 * E.pulsed) * s); flueJet(E, 4 + E.pulsed * 2); }
          } else if (E.success) {
            E.heat = lerp(1, 0.85, smooth((t - T.beat) / 1.2));
            if (!E.hit) {
              E.hit = true; E.shake = 2 * s; flare(E, 70, 1.8, 200); flueJet(E, 30);
              E.rings.push({ x: dx, y: dy, r0: 6 * s, r1: 60 * s, life: 0.6, age: 0, c: WHITE }, { x: dx, y: dy, r0: 6 * s, r1: 44 * s, life: 0.55, age: -0.1, c: E.cOut });
              for (let i = 0; i < 80; i++) { const a = rand() * TAU, v = (50 + Math.pow(rand(), 0.7) * 220) * s * 0.5; E.sparks.push({ x: dx, y: dy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30 * s, g: 80 * s, life: 0.6 + rand() * 0.9, age: 0, c: rand() < 0.35 ? WHITE : rand() < 0.6 ? mix(E.cOut, WHITE, 0.4) : GOLD, bounce: true }); }
            }
          } else {
            E.heat = lerp(Math.min(1, E.heatAtBeat || 1), 0.06, smooth((t - T.beat) / 0.35));
            if (t > T.beat + 1.3 && rand() < 0.35) { const [x, y] = slagAt(E, t); E.smoke.push({ x: x + (rand() - 0.5) * 8 * s, y: y - 10 * s, vx: (rand() - 0.5) * 6 * s, vy: -(14 + rand() * 12) * s, r: 2 * s, gr: 5 * s, life: 1.2, age: 0, a: 0.35, c: [110, 110, 112] }); }
            if (!E.hit) {
              E.hit = true; E.shake = 2.2 * s;
              for (let i = 0; i < 40; i++) E.smoke.push({ x: dx + (rand() - 0.2) * dw, y: dy + (rand() - 0.5) * E.door[3], vx: (20 + rand() * 70) * s, vy: -(10 + rand() * 34) * s, r: (4 + rand() * 6) * s, gr: (9 + rand() * 12) * s, life: 1.8 + rand() * 1.6, age: -rand() * 0.3, a: 0.65 + rand() * 0.3, c: rand() < 0.5 ? [34, 36, 40] : [58, 60, 64] });
              for (let i = 0; i < 22; i++) E.smoke.push({ x: E.chim[0] + (rand() - 0.5) * 3 * s, y: E.chim[1], vx: (rand() - 0.3) * 20 * s, vy: -(20 + rand() * 30) * s, r: (3 + rand() * 4) * s, gr: (6 + rand() * 8) * s, life: 1.8 + rand() * 1.2, age: -rand() * 0.4, a: 0.5 + rand() * 0.3, c: [44, 46, 50] });
              for (let i = 0; i < 34; i++) { const a = -Math.PI / 2 + (rand() - 0.2) * 2.2, v = (30 + rand() * 90) * s; E.sparks.push({ x: dx, y: dy + E.door[3] * 0.3, vx: Math.cos(a) * v + 30 * s, vy: Math.sin(a) * v, g: 240 * s, life: 0.9 + rand() * 1.1, age: 0, c: E.fireAt(0.5 + rand() * 0.3), bounce: true }); }
            }
          }
          if (E.success && t > T.item + 0.9 && rand() < 0.3) { const [x, y] = itemAt(E, t); E.sparks.push({ x: x + (rand() - 0.5) * E.IS * 0.8, y: y + E.IS * 0.3, vx: 0, vy: -(10 + rand() * 20) * s, g: 0, life: 0.9 + rand() * 0.5, age: 0, c: rand() < 0.5 ? WHITE : mix(E.cOut, WHITE, 0.4) }); }
          stepFire(E);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t, s } = E, [dx, dy, dw] = E.door;
          drawRoom(E, ctx);
          ctx.globalCompositeOperation = "lighter";
          if (t < T.beat) { const q = clamp((t - 1.6) / (T.beat - 1.6)); glow(ctx, dx, dy, dw * 2.4, WHITE, 0.35 * q * q); }
          if (E.success && t >= T.beat) {
            const sb = t - T.beat;
            if (sb < 0.45) glow(ctx, dx, dy, dw * (3 + 5 * outCubic(sb / 0.45)), WHITE, 0.95 * (1 - sb / 0.45) ** 2);
            if (sb < 1.6) { const env = sb < 0.15 ? sb / 0.15 : 1 - smooth((sb - 0.15) / 1.45), w = dw * (0.7 + 0.5 * env), g = ctx.createLinearGradient(dx - w, 0, dx + w, 0); g.addColorStop(0, rgba(E.cOut, 0)); g.addColorStop(0.5, rgba(mix(E.cOut, WHITE, 0.6), 0.75 * env)); g.addColorStop(1, rgba(E.cOut, 0)); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(dx - w, 0, w * 2, dy); }
            if (sb < 1.4) rays(ctx, dx, dy, 14, E.W * 0.36 * (0.6 + 0.4 * outCubic(sb / 0.4)), 0.05, 0.4 * sb, WHITE, mix(E.cOut, WHITE, 0.45), 0.5 * Math.sin(Math.PI * clamp(sb / 1.4)));
            const [x, y, z, p] = itemAt(E, t);
            if (E.tier + 1 >= 4) rays(ctx, x, y, 12, z * 1.1, 0.09, 0.3 * sb, WHITE, mix(E.cOut, WHITE, 0.45), 0.3 * p);
            glow(ctx, x, y, z * 0.95, E.cOut, 0.45 * clamp(p * 2)); glow(ctx, x, y, z * 0.45, mix(E.cOut, WHITE, 0.5), 0.3 * clamp(p * 2));
            if (E.tier + 1 >= 3) dots(ctx, x, y, z * 0.64, s, mix(E.cOut, WHITE, 0.5), (0.3 + 0.2 * Math.sin(t * 4)) * p, t * 0.6);
          }
          ctx.globalCompositeOperation = "source-over";
          drawParts(E, ctx, E.fireAt);
          if (E.success && t >= T.item && E.out) { const [x, y, z, p] = itemAt(E, t); drawSpr(ctx, E.out, x, y, z); whiteIn(E, ctx, E.out, x, y, z, p / 0.45); }
          if (!E.success && E.slag && t >= T.beat + 0.25) { const [x, y] = slagAt(E, t); drawSlag(E, ctx, E.slag, x, y, clamp((t - T.beat - 0.8) / 2.4)); }
          const a = clamp((t - T.label) / 0.4);
          if (a > 0) {
            if (E.success) plate(ctx, E.RX, E.H * 0.4 + E.IS / 2 + 14, [["REFINED", pix(fsz(E, 11)), GOLD], tiersLine(E, TIERS[E.tier].toUpperCase(), TIERS[E.tier + 1].toUpperCase(), E.cIn, E.cOut), [E.name, mono(fsz(E, 15)), INK]], a, E.cOut);
            else plate(ctx, E.RX, E.H * 0.2, [["THE MELT DID NOT TAKE", pix(fsz(E, 12)), ASH], ["the ingredients burned away", mono(fsz(E, 14)), INK]], a, [120, 70, 60]);
          }
        },
        end(S, E, memo) {
          S.heat = E.heat; memo.sealed = false; for (const k of ["embers", "smoke", "flames", "sparks"]) S[k] = E[k];
          memo.result = E.success ? { ok: true, out: E.out, tier: E.tier, cIn: E.cIn, cOut: E.cOut, name: E.name } : { ok: false, slag: E.slag, slagX: slagAt(E, E.T.end)[0] };
        },
      },
    },
  };
  function itemAt(E, t) { const [dx, dy] = E.door, p = clamp((t - E.T.item) / 0.95), [x, y] = arc([dx, dy], [E.RX, E.H * 0.4], E.H * 0.22, outCubic(p)); return [x, y + (p >= 1 ? Math.sin((t - E.T.item - 0.95) * 2.4) * 0.75 * E.s : 0), E.IS * lerp(0.2, 1, outBack(p)), p]; }
  function slagAt(E, t) {
    const t0 = E.T.beat + 0.25, p = clamp((t - t0) / 1.2), [dx, dy, , dh] = E.door, x0 = dx + E.door[2] * 0.2, x1 = E.RX - E.W * 0.06, yF = E.floor + 2 * E.s;
    const x = lerp(x0, x1, outCubic(p)), fall = clamp(p / 0.22), bounce = p > 0.22 ? Math.abs(Math.sin(((p - 0.22) / 0.78) * Math.PI * 2)) * (1 - p) * 14 * E.s : 0;
    return [x, p < 0.22 ? lerp(dy + dh * 0.3, yF, inCubic(fall)) : yF - bounce, p];
  }

  // ================================================================ the blueprint (building a furnace)
  // The furnace of the chosen tier stands in chalk on a workshop floor; built, the materials fly into the outline and
  // the furnace is welded together row by row from the ground up, then its fire catches. The player's furnaces stand
  // to the right.
  const YARD = { bg: "#0d1014", brick: [[22, 27, 34], [28, 34, 42]], bw: 16, bh: 7, floor: "#15130f", lip: "#2a241b",
    wall: (g, S, rand, b) => { g.fillStyle = "rgba(170,200,235,0.05)"; for (let x = 0; x < S.W; x += b * 8) g.fillRect(x, 0, 1, S.floor); for (let y = 0; y < S.floor; y += b * 8) g.fillRect(0, y, S.W, 1); } };
  function yard(W, H, p, spr, seed) {
    const S = base(W, H, seed), tier = clamp(p.tier | 0, 1, 4), F = FURN[tier];
    const s = Math.max(2, Math.floor((H * 0.78) / 64)), floor = Math.round(H * 0.84), fx = Math.round(W * 0.3);
    Object.assign(S, { tier, F, s, floor, sx0: fx - 32 * s, sy0: floor + 3 * s - (F.maxY + 1) * s, furnace: spr.furnace, shape: shape(spr.furnace), fireAt: fireOf(F.fire), owned: p.owned || [], ownedSpr: spr.owned || {} });
    S.door = [S.sx0 + F.door[0] * s, S.sy0 + F.door[1] * s, F.door[2] * s, F.door[3] * s]; S.chim = [S.sx0 + F.chim[0] * s, S.sy0 + F.chim[1] * s];
    S.bg = backdrop(S, YARD);
    return S;
  }
  function drawYard(S, ctx, built, rowCut) {
    const { s, t } = S;
    frame(S, ctx);
    // a shaft of light from a high window, dust turning in it
    ctx.globalCompositeOperation = "lighter"; const g = ctx.createLinearGradient(0, 0, S.W * 0.4, S.floor); g.addColorStop(0, "rgba(170,200,235,0.10)"); g.addColorStop(1, "rgba(170,200,235,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(S.W * 0.02, 0); ctx.lineTo(S.W * 0.2, 0); ctx.lineTo(S.W * 0.52, S.floor); ctx.lineTo(S.W * 0.28, S.floor); ctx.closePath(); ctx.fill(); ctx.globalCompositeOperation = "source-over";
    if (S.furnace) {
      const sh = S.shape, cut = rowCut === undefined ? (built ? -1 : 64) : rowCut; // rows >= cut are solid
      if (cut > 0) { ctx.drawImage(sil(S, S.furnace, CHALK, 0.12 + 0.04 * Math.sin(t * 2)), S.sx0, S.sy0, 64 * s, 64 * s); ctx.fillStyle = rgba(CHALK, 1); ctx.globalAlpha = 0.5 + 0.12 * Math.sin(t * 2); for (const [x, y] of sh.edge) if (y < cut && (x + y) % 2 === 0) ctx.fillRect(S.sx0 + x * s, S.sy0 + y * s, s, s); ctx.globalAlpha = 1; }
      for (let r = Math.max(0, cut); r < 64; r++) ctx.drawImage(S.furnace, 0, r, 64, 1, S.sx0, S.sy0 + r * s, 64 * s, s);
      const dark = 1 - (S.lit || 0), m = dark > 0 ? fireMask(S.furnace, S.F) : null; // a new furnace is cold until its fire catches
      if (m) { const k = sil(S, m, [20, 14, 11], 0.9 * dark), r0 = Math.max(0, cut); ctx.drawImage(k, 0, r0, 64, 64 - r0, S.sx0, S.sy0 + r0 * s, 64 * s, (64 - r0) * s); }
    }
    // the player's furnaces, small, standing in a row
    const list = S.owned.slice(-5), s2 = Math.max(1, Math.floor(s / 2)), w2 = Math.floor(Math.min(64 * s2, (S.W * 0.37) / Math.max(1, list.length) - 6)), x0 = Math.round(S.W * 0.6);
    list.forEach((f, i) => { const spr = S.ownedSpr[f.tier]; if (!spr) return; const x = x0 + i * (w2 + 6); ctx.drawImage(spr, x, S.floor + (3 - FURN[f.tier].maxY - 1) * (w2 / 64), w2, w2); text(ctx, `#${f.id}`, x + w2 / 2, S.floor + 6 * s2, mono(fsz(S, 11)), SOFT, 0.8, false); });
    if (list.length) text(ctx, S.owned.length > list.length ? `YOUR FURNACES · ${S.owned.length}` : "YOUR FURNACES", x0 + (list.length * (w2 + 6)) / 2, S.floor - w2 - fsz(S, 11) - 4, pix(fsz(S, 9)), SOFT, 0.7, false, 1);
  }
  const Build = {
    async load(p) { const spr = { furnace: await keyed(`img/furnace-${clamp(p.tier | 0, 1, 4)}.png`), owned: {} }; for (const f of p.owned || []) if (!spr.owned[f.tier]) spr.owned[f.tier] = await keyed(`img/furnace-${f.tier}.png`); return spr; },
    init(W, H, p, spr, memo) { const S = yard(W, H, p, spr, 11); S.built = memo.built === S.tier; S.lit = S.built ? 1 : 0; return S; },
    idle(S) { S.t += DT; if (S.rand() < 0.3) S.motes.push({ x: S.W * (0.05 + S.rand() * 0.4), y: S.rand() * S.floor, vx: (S.rand() - 0.5) * 3 * S.s, vy: (S.rand() - 0.5) * 3 * S.s, g: 0, life: 3, age: 0, a: 0.35, c: [200, 215, 235] }); if (S.built) { S.heat = 0.3; stepFireLite(S); } stepParts(S); },
    draw(S, ctx, p) {
      drawYard(S, ctx, S.built); if (S.built) drawFireLite(S, ctx);
      drawParts(S, ctx, S.fireAt);
      tag(S, ctx, S.built ? `${FURNACE[S.tier].toUpperCase()} FURNACE · built` : `${FURNACE[S.tier].toUpperCase()} FURNACE · the blueprint`, S.built ? GOLD : [170, 200, 235]);
    },
    events: {
      build: {
        async load(o) { const list = await Promise.all((o.srcs || []).map((s) => keyed(s))); return { mats: list }; },
        build(S, o, spr) {
          const E = yard(S.W, S.H, { tier: S.tier, owned: S.owned }, { furnace: S.furnace, owned: S.ownedSpr }, o.seed || 13);
          const cells = E.shape.cells, rand = E.rand;
          E.mats = (spr.mats || []).map((m, i) => { const [cx, cy] = cells[Math.floor(rand() * cells.length)]; return { spr: m, x0: -40 - rand() * 60, y0: E.H * (0.3 + rand() * 0.4), x1: E.sx0 + cx * E.s, y1: E.sy0 + cy * E.s, dep: 0.15 + i * 0.09 }; });
          E.T = { weld0: 1.35, weld1: 2.55 }; E.T.light = E.T.weld1 + 0.15; E.T.label = E.T.light + 0.2; E.T.end = E.T.label + 2.2; E.MS = Math.round(Math.min(E.H * 0.1, 44));
          E.heat = 0; E.lit = 0; E.clank = 0;
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT);
          for (const m of E.mats) { const p = (t - m.dep) / 0.5; if (p >= 1 && !m.in) { m.in = true; for (let i = 0; i < 6; i++) E.sparks.push({ x: m.x1, y: m.y1, vx: (rand() - 0.5) * 60 * s, vy: -rand() * 50 * s, g: 160 * s, life: 0.35 + rand() * 0.3, age: 0, c: rand() < 0.5 ? WHITE : [170, 200, 235] }); } }
          if (t > T.weld0 && t < T.weld1) {
            const sh = E.shape, r = Math.round(lerp(sh.bot, sh.top, (t - T.weld0) / (T.weld1 - T.weld0))), row = sh.rows[r];
            if (row) { for (const x of [row[0], row[1]]) for (let i = 0; i < 2; i++) E.sparks.push({ x: E.sx0 + x * s, y: E.sy0 + r * s, vx: (x === row[0] ? -1 : 1) * (40 + rand() * 90) * s, vy: -(rand() * 60) * s, g: 220 * s, life: 0.4 + rand() * 0.4, age: 0, c: rand() < 0.5 ? WHITE : GOLD, bounce: true }); }
            if (Math.floor((t - T.weld0) / 0.18) > E.clank) { E.clank++; E.shake = 0.8 * s; }
          }
          if (t >= T.light && !E.lighted) { E.lighted = true; const [dx, dy] = E.door; E.rings.push({ x: dx, y: dy, r0: 3 * s, r1: 26 * s, life: 0.5, age: 0, c: E.fireAt(0.9) }); for (let i = 0; i < 10; i++) E.smoke.push({ x: E.chim[0], y: E.chim[1], vx: (rand() - 0.5) * 12 * s, vy: -(18 + rand() * 20) * s, r: 2 * s, gr: 6 * s, life: 1.4 + rand(), age: -rand() * 0.3, a: 0.45, c: [90, 92, 96] }); }
          E.lit = clamp((t - T.light) / 0.6); E.heat = E.lit * (0.9 - 0.5 * clamp((t - T.light - 0.6) / 1.2));
          if (E.lit > 0) stepFireLite(E);
          stepParts(E);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t, s } = E, sh = E.shape;
          const cut = t < T.weld0 ? 64 : t > T.weld1 ? -1 : Math.round(lerp(sh.bot, sh.top, (t - T.weld0) / (T.weld1 - T.weld0)));
          drawYard(E, ctx, t > T.weld1, cut);
          if (t > T.weld0 && t < T.weld1 && sh.rows[cut]) { const [a, b] = sh.rows[cut]; ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgb(255,246,220)"; ctx.fillRect(E.sx0 + a * s, E.sy0 + cut * s, (b - a + 1) * s, s); glow(ctx, E.sx0 + ((a + b) / 2) * s, E.sy0 + cut * s, (b - a) * s * 0.7, GOLD, 0.35); ctx.globalCompositeOperation = "source-over"; }
          if (E.lit > 0) drawFireLite(E, ctx);
          drawParts(E, ctx, E.fireAt);
          for (const m of E.mats) { const p = (t - m.dep) / 0.5; if (p <= 0 || p >= 1) continue; const [x, y] = arc([m.x0, m.y0], [m.x1, m.y1], E.H * 0.2, smooth(p)); drawSpr(ctx, m.spr, x, y, E.MS * lerp(1, 0.4, p), 1, p * 4); }
          const a = clamp((t - T.label) / 0.4) * (1 - clamp((t - T.end + 0.5) / 0.5));
          if (a > 0) plate(ctx, E.W * 0.78, E.H * 0.16, [["BUILT", pix(fsz(E, 12)), GOLD], [`${FURNACE[E.tier]} furnace`, mono(fsz(E, 15)), INK], [`refines up to ${TIERS[E.tier]}`, mono(fsz(E, 12)), mix(tierColor(E.tier), WHITE, 0.35)]], a, tierColor(E.tier));
        },
        end(S, E, memo) { memo.built = E.tier; S.built = true; for (const k of ["smoke", "sparks", "flames", "embers"]) S[k] = E[k]; },
      },
    },
  };
  // a small fire for a furnace that is not being worked: flames in the box, a glow, embers now and then
  function stepFireLite(S) { const { rand, s } = S, [dx, dy, dw, dh] = S.door, h = S.heat || 0.3; if (rand() < 0.4 + h * 0.4) S.flames.push({ x: dx + (rand() - 0.5) * dw * 0.9, y: dy + dh * 0.42, vx: (rand() - 0.5) * 6 * s, vy: -(8 + rand() * 18 + h * 25) * s, g: 0, life: 0.25 + rand() * 0.3, age: 0, top: dy - dh * 0.5 }); }
  function drawFireLite(S, ctx) {
    const [dx, dy, dw] = S.door, h = S.heat || 0.3, s = S.s; ctx.globalCompositeOperation = "lighter";
    glow(ctx, dx, dy, Math.min(dw, 13 * s) * (0.9 + 1.4 * h), S.fireAt(0.4 + 0.5 * h), 0.3 + 0.5 * h);
    for (const f of S.flames) { const q = f.age / f.life; ctx.globalAlpha = 1 - q * 0.6; ctx.fillStyle = rgba(S.fireAt(clamp(h + 0.35 - q * 0.9)), 1); ctx.fillRect(px(S, f.x), px(S, f.y), s, s); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }

  // ================================================================ fire (shared): a bed of coals, flames, embers
  // The coals breathe, flame tongues rise off the bed and, where a pot stands over it, spread out and lick up its sides;
  // the tongues behind the pot are drawn before it, the short ones in front after it; embers drift up. The pot is lit
  // from below in the colour of the fire.
  const FLAME = [[255, 250, 225], [255, 218, 120], [255, 156, 50], [226, 78, 26], [120, 34, 16]];
  const flameAt = (q) => { const x = clamp(q) * (FLAME.length - 1), i = Math.min(FLAME.length - 2, Math.floor(x)); return mix(FLAME[i], FLAME[i + 1], x - i); };
  // cx, y: the middle of the bed on the floor; w: its width; pot: [left, right, bottom y] of what stands in the fire
  function hearth(S, cx, y, w, pot, o = {}) {
    const rand = S.rand, s = S.s, H = { cx, y, w, pot, rate: o.rate || 4, coals: [], stones: [], flames: [], embers: [] };
    const n = o.coals || Math.round((w / s) * 1.2);
    for (let i = 0; i < n; i++) { const u = rand() * 2 - 1; H.coals.push({ x: cx + u * w * 0.5, y: y - Math.round(rand() * 3 * (1 - u * u)) * s, z: (1 + Math.floor(rand() * 2.6)) * s, ph: rand() * TAU, k: 0.35 + rand() * 0.65 }); }
    H.coals.sort((a, b) => a.y - b.y);
    if (o.stones) for (let i = 0; i < o.stones; i++) { const a = (i / o.stones) * TAU + 0.2; H.stones.push({ x: cx + Math.cos(a) * w * 0.6, y: y + Math.sin(a) * 3.5 * s, w: (5 + Math.floor(rand() * 3)) * s, h: (3 + Math.floor(rand() * 2)) * s, back: Math.sin(a) < 0, v: rand() }); }
    H.stones.sort((a, b) => a.y - b.y);
    return H;
  }
  function stepHearth(S, H, heat) {
    const { rand, s } = S, [pl, pr, pb] = H.pot, mid = (pl + pr) / 2, n = heat * H.rate;
    for (let i = 0, k = Math.floor(n) + (rand() < n % 1 ? 1 : 0); i < k; i++) {
      const x = H.cx + (rand() * 2 - 1) * H.w * 0.46, back = rand() < 0.6, under = x > pl && x < pr;
      H.flames.push({ x, y: H.y - (back ? 2 : 0) * s - rand() * 2 * s, vx: under ? Math.sign(x - mid || 1) * (8 + rand() * 16) * s : (rand() - 0.5) * 5 * s, vy: -(13 + rand() * 18 + heat * 16) * s, life: (0.6 + rand() * 0.7) * (0.7 + 0.5 * heat), age: 0, z: rand() < 0.35 ? 2 : 1, sw: rand() * TAU, back });
    }
    if (rand() < 0.04 + heat * 0.16) H.embers.push({ x: H.cx + (rand() - 0.5) * H.w * 0.8, y: H.y - 2 * s, vx: (rand() - 0.5) * 10 * s, vy: -(16 + rand() * 30) * s, life: 1.8 + rand() * 1.8, age: 0, sw: rand() * TAU });
    for (const f of H.flames) { f.age += DT; if (f.y < pb + 2 * s && f.x > pl - s && f.x < pr + s) f.vx += Math.sign(f.x - mid || 1) * 45 * s * DT; f.x += (f.vx + Math.sin(S.t * 3.2 + f.sw) * 6 * s) * DT; f.y += f.vy * DT; f.vx *= Math.pow(0.5, DT); }
    for (const e of H.embers) { e.age += DT; e.x += (e.vx + Math.sin(S.t * 1.6 + e.sw) * 6 * s) * DT; e.y += e.vy * DT; e.vy *= Math.pow(0.8, DT); }
    H.flames = H.flames.filter((f) => f.age < f.life); H.embers = H.embers.filter((e) => e.age < e.life);
  }
  function drawStone(ctx, st, heat, s) {
    const x = Math.round(st.x - st.w / 2), y = Math.round(st.y - st.h);
    ctx.fillStyle = rgba(mix([44, 40, 36], [64, 58, 52], st.v), 1); ctx.fillRect(x, y, st.w, st.h);
    ctx.fillStyle = rgba(mix([84, 77, 69], [255, 170, 90], 0.15 + 0.3 * heat), 1); ctx.fillRect(x + s, y, st.w - 2 * s, s);
    ctx.fillStyle = "#1d1a17"; ctx.fillRect(x, y + st.h - s, st.w, s); ctx.fillRect(x, y + s, s, st.h - 2 * s);
  }
  function drawFlames(S, ctx, H, heat, back) {
    const s = S.s, pb = H.pot[2]; ctx.globalCompositeOperation = "lighter";
    for (const f of H.flames) {
      if (f.back !== back) continue;
      const q = f.age / f.life; let a = Math.pow(1 - q, 0.6);
      if (!back && f.y < pb + s) a *= clamp((f.y - (pb - 4 * s)) / (5 * s)); // front tongues fade where the pot begins
      if (a <= 0) continue;
      const z = (q < 0.5 ? f.z + 1 : f.z) * s, h = q < 0.6 ? z * 2 : z, x = px(S, f.x), y = px(S, f.y) - h + z, c = flameAt(q * 1.05 + (1 - heat) * 0.25);
      ctx.globalAlpha = a * 0.22; ctx.fillStyle = rgba(flameAt(q + 0.25), 1); ctx.fillRect(x - s, y - s, z + 2 * s, h + 2 * s);
      ctx.globalAlpha = a; ctx.fillStyle = rgba(c, 1); ctx.fillRect(x, y, z, h);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  // behind the pot: the light on the wall and the floor, the back stones, the tongues rising behind it
  function drawHearthBack(S, ctx, H, heat) {
    const { s, t } = S, fl = 0.88 + 0.12 * Math.sin(t * 2.4) * Math.sin(t * 1.1);
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, H.cx, H.y - 10 * s, S.W * 0.42, [255, 120, 40], (0.08 + 0.2 * heat) * fl);
    glow(ctx, H.cx, H.y, H.w * 1.1, [255, 140, 50], (0.12 + 0.25 * heat) * fl);
    ctx.globalCompositeOperation = "source-over";
    for (const st of H.stones) if (st.back) drawStone(ctx, st, heat, s);
    drawFlames(S, ctx, H, heat, true);
  }
  // in front: the coals, the front stones, the short front tongues, the embers
  function drawHearthFront(S, ctx, H, heat) {
    const { s, t } = S;
    for (const c of H.coals) {
      const b = (0.5 + 0.5 * Math.sin(t * 0.8 + c.ph)) * c.k * (0.3 + 0.7 * heat), x = Math.round(c.x), y = Math.round(c.y - c.z);
      ctx.fillStyle = "#1e0e0a"; ctx.fillRect(x, y, c.z, c.z);
      ctx.fillStyle = rgba(mix([120, 28, 12], [255, 170, 70], b), 1); ctx.fillRect(x + Math.floor(c.z / (2 * s)) * s, y + (c.z > s ? s : 0), s, s);
    }
    ctx.globalCompositeOperation = "lighter"; glow(ctx, H.cx, H.y - s, H.w * 0.55, [255, 110, 30], 0.22 + 0.35 * heat); ctx.globalCompositeOperation = "source-over";
    for (const st of H.stones) if (!st.back) drawStone(ctx, st, heat, s);
    drawFlames(S, ctx, H, heat, false);
    ctx.globalCompositeOperation = "lighter";
    for (const e of H.embers) { ctx.globalAlpha = (1 - e.age / e.life) * (0.6 + 0.4 * Math.sin(t * 4 + e.sw)); ctx.fillStyle = rgba(flameAt(0.35 + 0.3 * (e.age / e.life)), 1); ctx.fillRect(px(S, e.x), px(S, e.y), s, s); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  // the pot lit from below by its fire: its silhouette in the fire's colour, fading upwards from row `to` to row `from`
  const rims = new Map();
  function rimLit(spr, from, to) {
    const key = spr; if (!spr) return null; if (rims.has(key)) return rims.get(key);
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    g.drawImage(spr, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = "rgb(255,130,40)"; g.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = "destination-in"; const gr = g.createLinearGradient(0, from, 0, to); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    rims.set(key, c); return c;
  }
  function drawRim(S, ctx, spr, x, y, size, heat, from, to) { const r = rimLit(spr, from, to); if (!r) return; ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = (0.25 + 0.4 * heat) * (0.88 + 0.12 * Math.sin(S.t * 2.4) * Math.sin(S.t * 1.1)); ctx.drawImage(r, x, y, size, size); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; }

  // ================================================================ the cauldron (brewing a potion)
  // A little brewing cauldron over a low flame, and a shelf with the potions of the chosen tier. Two herbs go in, the
  // brew turns from green to the blue of a potion, and the potion comes up out of the steam onto the shelf.
  const APOTH = { bg: "#0f0e0c", brick: [[30, 24, 18], [38, 30, 22]], bw: 20, bh: 5, floor: "#16120e", lip: "#2b2117",
    wall: (g, S, rand, b) => { // a high shelf of jars along the back wall
      const y = Math.round(S.H * 0.22), x0 = Math.round(S.W * 0.55), x1 = Math.round(S.W * 0.97);
      g.fillStyle = "#3b2a1a"; g.fillRect(x0, y, x1 - x0, b * 2); g.fillStyle = "#24190f"; g.fillRect(x0, y + b * 2, x1 - x0, b);
      for (let x = x0 + b * 2; x < x1 - b * 6; x += b * (6 + Math.floor(rand() * 4))) { const h = b * (5 + Math.floor(rand() * 5)), w = b * (3 + Math.floor(rand() * 3)), c = [[90, 140, 110], [150, 110, 70], [120, 100, 150], [170, 160, 120]][Math.floor(rand() * 4)]; g.fillStyle = "rgba(190,220,230,0.25)"; g.fillRect(x, y - h, w, h); g.fillStyle = rgba(c, 0.55); g.fillRect(x, y - Math.round(h * 0.6), w, Math.round(h * 0.6)); g.fillStyle = "#5a4027"; g.fillRect(x, y - h - b, w, b); }
    } };
  function apothecary(W, H, p, spr, seed) {
    const S = base(W, H, seed), s = Math.max(2, Math.floor((H * 0.7) / 64)), floor = Math.round(H * 0.86), cx = Math.round(W * 0.33);
    Object.assign(S, { s, floor, sx0: cx - 32 * s, sy0: floor + 2 * s - 61 * s, cauldron: spr.cauldron, potion: spr.potion, tier: clamp(p.tier | 0, 1, 5), count: p.potions || 0 });
    S.liq = [S.sx0 + 29 * s, S.sy0 + 20.5 * s, 13 * s, 3.5 * s]; S.fire = [S.sx0 + 31 * s, S.sy0 + 56 * s, 12 * s];
    S.shelf = [Math.round(W * 0.56), Math.round(W * 0.96), Math.round(H * 0.6)]; S.PS = Math.round(Math.min(H * 0.2, (S.shelf[1] - S.shelf[0]) / 6));
    S.hth = hearth(S, S.sx0 + 31 * s, floor, 20 * s, [S.sx0 + 14 * s, S.sx0 + 46 * s, S.sy0 + 49 * s], { rate: 2.4, coals: 18 }); S.fireHeat = 0.4;
    S.brew = [46, 170, 120]; S.bg = backdrop(S, APOTH);
    return S;
  }
  const POTION_BLUE = [70, 176, 238];
  function stepBrew(S, heat) {
    const { rand, s } = S, [lx, ly, rx, ry] = S.liq;
    S.fireHeat = 0.3 + 0.7 * heat; stepHearth(S, S.hth, S.fireHeat);
    if (rand() < 0.15 + heat * 0.6) { const a = rand() * TAU, r = Math.sqrt(rand()) * 0.85; S.motes.push({ x: lx + Math.cos(a) * r * rx, y: ly + Math.sin(a) * r * ry, vx: 0, vy: 0, g: 0, life: 0.3 + rand() * 0.3, age: 0, c: mix(S.brew, WHITE, 0.55), bubble: true }); }
    if (rand() < 0.06 + heat * 0.2) S.smoke.push({ x: lx + (rand() - 0.5) * rx, y: ly - 2 * s, vx: (rand() - 0.5) * 5 * s, vy: -(10 + rand() * 12) * s, r: 2 * s, gr: 6 * s, life: 1.6 + rand(), age: 0, a: 0.18, c: mix(S.brew, [200, 210, 205], 0.6) });
    stepParts(S);
  }
  function drawBrew(S, ctx, extra) {
    const { s } = S, [lx, ly, rx, ry] = S.liq;
    frame(S, ctx);
    ctx.globalCompositeOperation = "lighter"; glow(ctx, lx, ly, rx * 2.2, S.brew, 0.14); ctx.globalCompositeOperation = "source-over";
    drawHearthBack(S, ctx, S.hth, S.fireHeat);
    if (S.cauldron) { ctx.drawImage(S.cauldron, S.sx0, S.sy0, 64 * s, 64 * s); drawRim(S, ctx, S.cauldron, S.sx0, S.sy0, 64 * s, S.fireHeat, 32, 52); }
    drawHearthFront(S, ctx, S.hth, S.fireHeat);
    // the brew itself over the painted one, so its colour can change
    ctx.fillStyle = rgba(S.brew, 1); for (let dy = -ry; dy <= ry; dy += s) { const w = rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))); if (w > 0) ctx.fillRect(px(S, lx - w), px(S, ly + dy), px(S, 2 * w) || s, s); }
    ctx.fillStyle = rgba(mix(S.brew, WHITE, 0.3), 1); ctx.fillRect(px(S, lx - rx * 0.6), px(S, ly - ry), px(S, rx * 1.2), s);
    if (extra) extra(ctx);
    for (const m of S.motes) if (m.bubble) { const q = m.age / m.life; ctx.globalAlpha = 1 - q; ctx.fillStyle = rgba(m.c, 1); const z = q > 0.7 ? 2 * s : s; ctx.fillRect(px(S, m.x), px(S, m.y - q * 2 * s), z, s); }
    ctx.globalAlpha = 1;
    // the shelf and the potions on it
    const [x0, x1, y] = S.shelf; ctx.fillStyle = "#4a3421"; ctx.fillRect(x0, y, x1 - x0, 2 * s); ctx.fillStyle = "#2b1d12"; ctx.fillRect(x0, y + 2 * s, x1 - x0, s); ctx.fillRect(x0 + s * 2, y + 3 * s, s * 2, s * 4); ctx.fillRect(x1 - s * 4, y + 3 * s, s * 2, s * 4);
    const n = Math.min(S.count, 8), sp = (x1 - x0) / 8;
    for (let i = 0; i < n; i++) drawSpr(ctx, S.potion, x0 + sp * (i + 0.5), y - S.PS * 0.42, S.PS);
    text(ctx, S.W < 520 ? `× ${S.count}` : `${TIERS[S.tier].toUpperCase()} POTIONS · ${S.count}`, (x0 + x1) / 2, y + 5 * s, pix(fsz(S, 9)), SOFT, 0.75, false, 1);
    drawParts({ ...S, motes: S.motes.filter((m) => !m.bubble) }, ctx);
  }
  const Brew = {
    async load(p) { const [cauldron, potion] = await Promise.all([keyed("img/cauldron.png"), keyed(`metadata/${1000 + clamp(p.tier | 0, 1, 5)}.png`)]); return { cauldron, potion }; },
    init(W, H, p, spr, memo) { const S = apothecary(W, H, p, spr, 17); S.count = Math.max(S.count, memo.count || 0); return S; },
    idle(S) { S.t += DT; S.brew = S.brew.map((v, i) => v + ([46, 170, 120][i] - v) * Math.min(1, DT * 0.6)); stepBrew(S, 0.25); },
    draw(S, ctx) { drawBrew(S, ctx); tag(S, ctx, "THE CAULDRON · brewing is instant, nothing to reveal", SOFT); },
    events: {
      brew: {
        async load(o) { const [a, b] = await Promise.all([keyed(o.herbA), keyed(o.herbB)]); return { a, b }; },
        build(S, o, spr) {
          const E = apothecary(S.W, S.H, { tier: S.tier, potions: S.count }, { cauldron: S.cauldron, potion: S.potion }, o.seed || 19); E.brew = S.brew.slice();
          E.herbs = [{ spr: spr.a, dep: 0.2 }, { spr: spr.b, dep: 0.55 }].map((h, i) => ({ ...h, x0: E.W * (0.12 + i * 0.12), y0: -E.H * 0.1 }));
          E.HS = Math.round(Math.min(E.H * 0.16, 64)); E.T = { fall: 0.55, churn0: 1.15, churn1: 2.0 }; E.T.rise = E.T.churn1; E.T.land = E.T.rise + 1.0; E.T.end = E.T.land + 1.5; E.slot = Math.min(E.count, 7);
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT), [lx, ly, rx] = E.liq;
          for (const h of E.herbs) { const p = (t - h.dep) / T.fall; if (p >= 1 && !h.in) { h.in = true; E.rings.push({ x: lx, y: ly, r0: 2 * s, r1: rx * 1.1, life: 0.4, age: 0, c: mix(E.brew, WHITE, 0.5) }); for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + (rand() - 0.5) * 2, v = (40 + rand() * 70) * s; E.sparks.push({ x: lx + (rand() - 0.5) * rx, y: ly, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260 * s, life: 0.5 + rand() * 0.3, age: 0, c: mix(E.brew, WHITE, 0.3), z: rand() < 0.3 ? 2 : 1 }); } } }
          const churn = clamp((t - T.churn0) / (T.churn1 - T.churn0));
          E.brew = mix([46, 170, 120], POTION_BLUE, smooth(churn)).map((v, i) => v);
          if (t > T.churn0 && t < T.churn1) E.shake = Math.max(E.shake, 0.3 * s);
          if (t >= T.rise && !E.popped) { E.popped = true; E.rings.push({ x: lx, y: ly, r0: 3 * s, r1: rx * 1.6, life: 0.5, age: 0, c: WHITE }); for (let i = 0; i < 18; i++) E.smoke.push({ x: lx + (rand() - 0.5) * rx, y: ly - 3 * s, vx: (rand() - 0.5) * 30 * s, vy: -(20 + rand() * 30) * s, r: 3 * s, gr: 9 * s, life: 1.2 + rand() * 0.8, age: 0, a: 0.4, c: [210, 225, 230] }); }
          if (t > T.land && !E.landed) { E.landed = true; const [x, y] = potionAt(E, t); for (let i = 0; i < 10; i++) E.sparks.push({ x, y: y - E.PS * 0.2, vx: (rand() - 0.5) * 50 * s, vy: -rand() * 40 * s, g: 100 * s, life: 0.4 + rand() * 0.3, age: 0, c: rand() < 0.5 ? WHITE : GLASS }); }
          stepBrew(E, t > T.churn0 && t < T.rise + 0.3 ? 1 : 0.4);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t } = E, [lx, ly, rx, ry] = E.liq;
          drawBrew(E, ctx, (c) => { // the swirl while it churns
            const q = clamp((t - T.churn0) / (T.churn1 - T.churn0)); if (q <= 0 || q >= 1) return; c.globalCompositeOperation = "lighter"; c.strokeStyle = rgba(mix(POTION_BLUE, WHITE, 0.5), 1); c.lineWidth = E.s;
            for (let k = 0; k < 3; k++) { c.globalAlpha = 0.5 * Math.sin(Math.PI * q); c.beginPath(); for (let i = 0; i <= 20; i++) { const f = i / 20, a = f * 5 + t * 9 + k * 2.1, r = f * 0.9; c.lineTo(lx + Math.cos(a) * r * rx, ly + Math.sin(a) * r * ry); } c.stroke(); }
            c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
          });
          for (const h of E.herbs) { const p = (t - h.dep) / T.fall; if (p <= 0 || p >= 1) continue; const [x, y] = arc([h.x0, h.y0], [lx, ly], E.H * 0.08, inCubic(p) * 0.4 + p * 0.6); drawSpr(ctx, h.spr, x, y, E.HS * lerp(1, 0.5, p), 1, p * 5); }
          if (t > T.rise && t < T.land + 0.01) { const [x, y, z, p] = potionAt(E, t); ctx.globalCompositeOperation = "lighter"; glow(ctx, x, y, z, POTION_BLUE, 0.4 * (1 - clamp((t - T.land) / 0.5))); ctx.globalCompositeOperation = "source-over"; drawSpr(ctx, E.potion, x, y, z); whiteIn(E, ctx, E.potion, x, y, z, p / 0.35); }
          if (t >= T.land) { const [x0, x1, y] = E.shelf, sp = (x1 - x0) / 8; if (E.slot >= E.count) drawSpr(ctx, E.potion, x0 + sp * (E.slot + 0.5), y - E.PS * 0.42, E.PS); }
          const a = clamp((t - T.rise - 0.2) / 0.4) * (1 - clamp((t - T.end + 0.4) / 0.4));
          if (a > 0) plate(ctx, E.W * 0.76, E.H * 0.04 + 30, [["BREWED", pix(fsz(E, 12)), [140, 205, 245]], [`one ${TIERS[E.tier]} potion`, mono(fsz(E, 14)), INK]], a, POTION_BLUE);
        },
        end(S, E, memo) { S.brew = E.brew; S.count = Math.max(S.count, E.slot + 1); memo.count = S.count; for (const k of ["smoke", "sparks", "flames", "motes"]) S[k] = E[k]; },
      },
    },
  };
  function potionAt(E, t) { const [lx, ly] = E.liq, [x0, x1, y] = E.shelf, sp = (x1 - x0) / 8, p = clamp((t - E.T.rise) / (E.T.land - E.T.rise)), up = [lx, ly - E.H * 0.2]; const [x, yy] = p < 0.35 ? [lx, lerp(ly, up[1], outCubic(p / 0.35))] : arc(up, [x0 + sp * (E.slot + 0.5), y - E.PS * 0.42], E.H * 0.12, smooth((p - 0.35) / 0.65)); return [x, yy, E.PS * lerp(0.6, 1, clamp(p * 2)), p]; }

  // ================================================================ the crucible (the melt of ten)
  // A crucible standing in a ring of stones over live coals, flames licking up its sides, its melt slowly turning. Ten
  // ingredients drop in, the melt whirls in the colours of what went in and a crust of slag closes over it from the rim
  // inward: plates with molten seams between them and a seal pressed into the middle, breathing heat. At the reveal the
  // seams burn white, the crust bursts, and the melt throws out what it became, one piece at a time, each cooling in the
  // air and landing on the ledge: a tier up lands in gold, two tiers is a jackpot, a tier down lands in grey smoke.
  const PIT = { bg: "#0d0b0a", brick: [[26, 22, 20], [34, 28, 25]], bw: 12, bh: 8, floor: "#110f0d", lip: "#221c17",
    wall: (g, S) => { const v = g.createLinearGradient(0, 0, 0, S.floor); v.addColorStop(0, "rgba(0,0,0,0.55)"); v.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = v; g.fillRect(0, 0, S.W, S.floor); } };
  function pit(W, H, p, spr, seed) {
    const S = base(W, H, seed), s = Math.max(2, Math.floor((H * 0.76) / 64)), floor = Math.round(H * 0.88), cx = Math.round(W * 0.3), rand = S.rand;
    Object.assign(S, { s, floor, sx0: cx - 32 * s, sy0: floor - 7 * s - 57 * s, crucible: spr.crucible, tier: clamp(p.tier | 0, 1, 5) });
    S.mol = [S.sx0 + 31.5 * s, S.sy0 + 24 * s, 16 * s, 7 * s];
    S.ledge = [Math.round(W * 0.54), Math.round(W * 0.97), Math.round(H * 0.7)]; S.IS = Math.round(Math.min(H * 0.2, (S.ledge[1] - S.ledge[0]) / 5.6));
    S.blobs = Array.from({ length: 7 }, () => ({ a: rand() * TAU, r: 0.2 + rand() * 0.6, w: (rand() - 0.5) * 0.6, z: 0.3 + rand() * 0.4 }));
    S.flakes = Array.from({ length: 6 }, () => ({ a: rand() * TAU, r: 0.3 + rand() * 0.55, w: (rand() - 0.5) * 0.35, n: 1 + Math.floor(rand() * 3) }));
    S.bubbles = [];
    S.hth = hearth(S, S.sx0 + 32 * s, floor, 46 * s, [S.sx0 + 19 * s, S.sx0 + 45 * s, S.sy0 + 56 * s], { stones: 12, rate: 4 });
    S.crustMap = crustOf(S);
    S.bg = backdrop(S, PIT);
    return S;
  }
  // the crust, built once per size: slag plates in a Voronoi pattern, the molten seams between them, and the seal
  function crustOf(S) {
    const { s, rand } = S, [, , rx, ry] = S.mol, cw = Math.round((2 * rx) / s), ch = Math.round((2 * ry) / s);
    const seeds = Array.from({ length: 7 }, () => { const a = rand() * TAU, r = Math.sqrt(rand()) * 0.9; return [Math.cos(a) * r, Math.sin(a) * r, rand()]; });
    const PAL = [[40, 32, 28], [50, 40, 35], [34, 28, 25], [58, 47, 40]];
    const mk = () => { const c = document.createElement("canvas"); c.width = cw; c.height = ch; return c; };
    const plates = mk(), seams = mk(), sigil = mk(), P = new ImageData(cw, ch), Q = new ImageData(cw, ch), G = new ImageData(cw, ch), owner = new Int16Array(cw * ch).fill(-1), cells = [];
    // each cell belongs to its nearest seed; a cell whose right or lower neighbour belongs to another plate is a seam,
    // so the seams are crisp lines one cell wide, and the rim of the crust is a seam too
    const near = new Int16Array(cw * ch).fill(-1), inEl = (i, j) => { const u = ((i + 0.5) / cw) * 2 - 1, v = ((j + 0.5) / ch) * 2 - 1; return u * u + v * v <= 1 ? u * u + v * v : -1; };
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      if (inEl(i, j) < 0) continue; const u = ((i + 0.5) / cw) * 2 - 1, v = ((j + 0.5) / ch) * 2 - 1;
      let d1 = 9, k1 = 0; seeds.forEach(([x, y], k) => { const d = Math.hypot((u - x) * 1.0, (v - y) * 0.45); if (d < d1) { d1 = d; k1 = k; } }); near[j * cw + i] = k1;
    }
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const q = j * cw + i, k = near[q]; if (k < 0) continue;
      const r = i + 1 < cw ? near[q + 1] : -1, d = j + 1 < ch ? near[q + cw] : -1, seam = (r >= 0 && r !== k) || (d >= 0 && d !== k) || inEl(i, j) > 0.9;
      if (seam) { owner[q] = -2; Q.data.set([255, 255, 255, 255], q * 4); P.data.set([22, 16, 13, 255], q * 4); }
      else { owner[q] = k; const b = PAL[k % PAL.length], n = (rand() - 0.5) * 12 + (seeds[k][2] - 0.5) * 10; P.data.set([b[0] + n, b[1] + n, b[2] + n, 255].map((x) => clamp(x, 0, 255) | 0), q * 4); cells.push([i, j]); }
    }
    for (let j = 1; j < ch; j++) for (let i = 0; i < cw; i++) { const q = j * cw + i; if (owner[q] >= 0 && owner[q - cw] === -2) for (let c = 0; c < 3; c++) P.data[q * 4 + c] = Math.min(255, P.data[q * 4 + c] + 20); } // raised plates catch the light on top
    const put = (u, v) => { const i = Math.round(((u + 1) / 2) * cw - 0.5), j = Math.round(((v + 1) / 2) * ch - 0.5); if (i < 0 || j < 0 || i >= cw || j >= ch) return; const q = (j * cw + i) * 4; G.data.set([255, 255, 255, 255], q); P.data.set([30, 22, 18, 255], q); };
    for (let a = 0; a < TAU; a += 0.04) put(Math.cos(a) * 0.38, Math.sin(a) * 0.54); // the seal: a ring, a triangle, a bar
    const tri = [[0, -0.42], [0.32, 0.28], [-0.32, 0.28], [0, -0.42]]; for (let k = 0; k < 3; k++) for (let f = 0; f <= 1; f += 0.03) put(lerp(tri[k][0], tri[k + 1][0], f), lerp(tri[k][1], tri[k + 1][1], f));
    for (let f = -0.2; f <= 0.2; f += 0.03) put(f, 0.02);
    plates.getContext("2d").putImageData(P, 0, 0); seams.getContext("2d").putImageData(Q, 0, 0); sigil.getContext("2d").putImageData(G, 0, 0);
    return { cw, ch, plates, seams, sigil, P: P.data, cells };
  }
  function stepPit(S, heat) {
    const { rand, s } = S, [mx, my, rx, ry] = S.mol;
    for (const b of S.blobs) b.a += b.w * DT * (1 + heat * 3);
    for (const f of S.flakes) f.a += f.w * DT * (1 + heat);
    if (!S.crust) {
      if (rand() < 0.04 + heat * 0.08) { const a = rand() * TAU, r = Math.sqrt(rand()) * 0.8; S.bubbles.push({ x: mx + Math.cos(a) * r * rx, y: my + Math.sin(a) * r * ry, age: 0, life: 0.45 + rand() * 0.3 }); }
      if (rand() < 0.05 + heat * 0.2) S.sparks.push({ x: mx + (rand() - 0.5) * rx * 1.4, y: my, vx: (rand() - 0.5) * 20 * s, vy: -(30 + rand() * 50) * s, g: 150 * s, life: 0.5 + rand() * 0.4, age: 0, c: [255, 200, 90] });
    } else if (rand() < 0.035) { // a seam breathes out: a spit of sparks and a thread of smoke
      const a = rand() * TAU, r = 0.3 + rand() * 0.6, x = mx + Math.cos(a) * r * rx, y = my + Math.sin(a) * r * ry;
      for (let i = 0; i < 6; i++) S.sparks.push({ x, y, vx: (rand() - 0.5) * 30 * s, vy: -(30 + rand() * 60) * s, g: 170 * s, life: 0.4 + rand() * 0.4, age: 0, c: rand() < 0.5 ? [255, 210, 120] : [255, 140, 50] });
      S.smoke.push({ x, y: y - s, vx: (rand() - 0.5) * 5 * s, vy: -(10 + rand() * 10) * s, r: 2 * s, gr: 5 * s, life: 1.8, age: 0, a: 0.3, c: [90, 84, 80] });
    }
    for (const b of S.bubbles) b.age += DT; S.bubbles = S.bubbles.filter((b) => b.age < b.life);
    stepHearth(S, S.hth, 0.35 + 0.65 * heat);
    stepParts(S);
  }
  function drawMolten(S, ctx, heat, whirl) {
    const { s, t } = S, [mx, my, rx, ry] = S.mol;
    ctx.save(); ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, 0, 0, TAU); ctx.clip();
    const g = ctx.createRadialGradient(mx, my - ry * 0.25, 0, mx, my, rx); g.addColorStop(0, rgba(mix([255, 214, 120], [255, 246, 205], heat), 1)); g.addColorStop(0.55, "rgb(255,142,42)"); g.addColorStop(1, "rgb(186,52,16)");
    ctx.fillStyle = g; ctx.fillRect(mx - rx, my - ry, rx * 2, ry * 2);
    ctx.globalCompositeOperation = "lighter";
    for (const b of S.blobs) glow(ctx, mx + Math.cos(b.a) * b.r * rx, my + Math.sin(b.a) * b.r * ry, rx * b.z, [255, 230, 150], 0.22 + 0.2 * heat);
    ctx.strokeStyle = "rgb(255,238,185)"; ctx.lineWidth = s; // bright veins flowing across the surface
    for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.16 + 0.12 * heat; ctx.beginPath(); for (let i = 0; i <= 24; i++) { const f = i / 24, x = mx - rx + f * rx * 2, y = my + Math.sin(f * 6 + t * (0.8 + k * 0.3) + k * 2) * ry * 0.3 + (k - 1) * ry * 0.42; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (whirl) whirl(ctx);
    for (const b of S.bubbles) { const q = b.age / b.life; ctx.globalAlpha = 1 - q; ctx.strokeStyle = "rgb(255,236,180)"; ctx.lineWidth = s; ctx.beginPath(); ctx.ellipse(b.x, b.y, (1 + q * 3) * s, (0.5 + q * 1.2) * s, 0, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    for (const f of S.flakes) { const x = px(S, mx + Math.cos(f.a) * f.r * rx), y = px(S, my + Math.sin(f.a) * f.r * ry); ctx.fillStyle = "#4a2213"; ctx.fillRect(x, y, f.n * s, s); ctx.fillStyle = "#7a3a1a"; ctx.fillRect(x, y - s, Math.max(1, f.n - 1) * s, s); }
    ctx.restore();
    ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "rgb(255,196,110)"; ctx.lineWidth = s; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(mx, my, rx - s / 2, ry - s / 2, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  // the crust: formed 0..1 closes it from the rim inward; hot 1 is its sealed breathing, higher burns the seams white
  function drawCrust(S, ctx, formed, hot) {
    if (formed <= 0) return;
    const { s, t } = S, [mx, my, rx, ry] = S.mol, C = S.crustMap, x0 = mx - rx, y0 = my - ry, w = rx * 2, h = ry * 2, blur = `blur(${Math.max(2, Math.round(s * 0.9))}px)`;
    ctx.save(); ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, 0, 0, TAU); if (formed < 1) { ctx.moveTo(mx + rx * (1 - formed), my); ctx.ellipse(mx, my, rx * (1 - formed), ry * (1 - formed), 0, 0, TAU, true); } ctx.clip("evenodd");
    ctx.imageSmoothingEnabled = false; ctx.drawImage(C.plates, x0, y0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const pulse = 0.76 + 0.17 * Math.sin(t * 2.1) + 0.07 * Math.sin(t * 5.3);
    ctx.globalAlpha = clamp(0.35 * pulse * hot); ctx.filter = blur; ctx.drawImage(sil(S, C.seams, [255, 110, 30], 1), x0, y0, w, h); ctx.filter = "none";
    ctx.globalAlpha = clamp(1.05 * pulse * hot); ctx.drawImage(sil(S, C.seams, [255, 164, 58], 1), x0, y0, w, h);
    if (hot > 1) { ctx.globalAlpha = clamp((hot - 1) / 2); ctx.drawImage(sil(S, C.seams, [255, 242, 196], 1), x0, y0, w, h); }
    const sp = 0.5 + 0.5 * Math.sin(t * 1.3), sh = Math.min(hot, 2.2);
    ctx.globalAlpha = clamp((0.4 + 0.45 * sp) * sh); ctx.filter = blur; ctx.drawImage(sil(S, C.sigil, GOLD, 1), x0, y0, w, h); ctx.filter = "none";
    ctx.globalAlpha = clamp((0.55 + 0.4 * sp) * sh); ctx.drawImage(sil(S, C.sigil, [255, 236, 170], 1), x0, y0, w, h);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.restore();
    ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = s;
    if (formed < 1) { const k = 1 - formed; ctx.strokeStyle = "rgb(255,226,150)"; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(mx, my, rx * k, ry * k, 0, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = "rgb(255,150,50)"; ctx.globalAlpha = 0.45 * pulse; ctx.beginPath(); ctx.ellipse(mx, my, rx - s / 2, ry - s / 2, 0, 0, TAU); ctx.stroke();
    glow(ctx, mx, my, rx * 1.2, [255, 110, 30], 0.05 * pulse * hot);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  function drawPit(S, ctx, heat, crustA, whirl) {
    const s = S.s, fire = 0.35 + 0.65 * heat;
    frame(S, ctx);
    drawHearthBack(S, ctx, S.hth, fire);
    if (S.crucible) { ctx.drawImage(S.crucible, S.sx0, S.sy0, 64 * s, 64 * s); drawRim(S, ctx, S.crucible, S.sx0, S.sy0, 64 * s, fire, 34, 57); }
    if (crustA < 1) drawMolten(S, ctx, heat, whirl);
    drawCrust(S, ctx, crustA, S.crackHot || 1);
    drawHearthFront(S, ctx, S.hth, fire);
    const [x0, x1, y] = S.ledge; ctx.fillStyle = "#2c2622"; ctx.fillRect(x0, y, x1 - x0, 3 * s); ctx.fillStyle = "#3d352f"; ctx.fillRect(x0, y, x1 - x0, s); ctx.fillStyle = "#181412"; ctx.fillRect(x0, y + 3 * s, x1 - x0, s);
  }
  function slotAt(S, i, n) { const [x0, x1, y] = S.ledge, sp = (x1 - x0) / Math.max(n, 3); return [x0 + sp * (i + 0.5) + (Math.max(n, 3) - n) * sp * 0.5, y - S.IS * 0.45]; }
  function drawRow(S, ctx, row, a = 1) {
    if (!row) return;
    row.forEach((r, i) => {
      const [x, y] = slotAt(S, i, row.length);
      ctx.globalCompositeOperation = "lighter"; glow(ctx, x, y + S.IS * 0.35, S.IS * 0.6, r.c, 0.25 * a); ctx.globalCompositeOperation = "source-over";
      drawSpr(ctx, r.spr, x, y, S.IS, a);
      if (r.d) text(ctx, r.d > 0 ? `+${r.d}` : `${r.d}`, x, y - S.IS * 0.62 - fsz(S, 12), pix(fsz(S, 12)), r.d > 0 ? GOLD : ASH, a, true);
    });
  }
  const Crucible = {
    async load() { return { crucible: await plainSprite("img/crucible-cut.png") }; },
    init(W, H, p, spr, memo) { const S = pit(W, H, p, spr, 23); S.crust = !!(p.sealed || memo.sealed); return S; },
    idle(S) { S.t += DT; stepPit(S, 0.35); },
    draw(S, ctx, p, memo) {
      const sealed = p.sealed || (memo.sealed && { ready: false });
      drawPit(S, ctx, 0.35, S.crust ? 1 : 0); drawParts(S, ctx); if (!sealed) drawRow(S, ctx, memo.row);
      tag(S, ctx, sealed ? `THE CRUCIBLE · a melt is sealed · ${sealed.ready ? "ready to reveal" : "reveals after the next minute"}` : "THE CRUCIBLE · ten go in, fewer come out", sealed && sealed.ready ? GOLD : SOFT);
    },
    events: {
      pour: {
        async load(o) { return { items: await Promise.all((o.srcs || []).map((x) => keyed(x))) }; },
        build(S, o, spr) {
          const E = pit(S.W, S.H, { tier: o.tier }, { crucible: S.crucible }, o.seed || 29), [mx, , rx] = E.mol, rand = E.rand;
          E.items = (spr.items || []).map((m, i) => ({ spr: m, x: mx + (rand() - 0.5) * rx * 1.2, dep: 0.1 + i * 0.12, cat: o.cats ? o.cats[i] : 0 }));
          E.cats = [...new Set(E.items.map((x) => x.cat))]; E.HS = Math.round(Math.min(E.H * 0.13, 52));
          E.T = { fall: 0.45 }; E.T.whirl0 = 0.1 + (E.items.length - 1) * 0.12 + E.T.fall + 0.1; E.T.crust = E.T.whirl0 + 1.0; E.T.label = E.T.crust + 0.6; E.T.end = E.T.label + 2.2; E.tier = clamp(o.tier | 0, 1, 5);
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT), [mx, my, rx] = E.mol;
          for (const it of E.items) { const p = (t - it.dep) / T.fall; if (p >= 1 && !it.in) { it.in = true; E.rings.push({ x: it.x, y: my, r0: 2 * s, r1: rx * 0.7, life: 0.35, age: 0, c: [255, 210, 120] }); for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + (rand() - 0.5) * 1.8, v = (40 + rand() * 90) * s; E.sparks.push({ x: it.x, y: my, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260 * s, life: 0.45 + rand() * 0.3, age: 0, c: [255, 170 + Math.floor(rand() * 60), 60], z: rand() < 0.3 ? 2 : 1 }); } E.flashC = { t, c: tierColor(E.tier) }; } }
          if (t >= T.crust && !E.crusted) { E.crusted = true; for (let i = 0; i < 16; i++) E.smoke.push({ x: mx + (rand() - 0.5) * rx * 1.4, y: my - 2 * s, vx: (rand() - 0.5) * 20 * s, vy: -(14 + rand() * 18) * s, r: 3 * s, gr: 8 * s, life: 1.5 + rand(), age: 0, a: 0.4, c: [70, 66, 62] }); }
          E.crust = t >= T.crust + 0.8;
          stepPit(E, t > T.whirl0 && t < T.crust ? 1 : 0.5);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t, s } = E, [mx, my, rx, ry] = E.mol, wq = clamp((t - T.whirl0) / (T.crust - T.whirl0));
          drawPit(E, ctx, t > T.whirl0 && t < T.crust + 0.4 ? 0.9 : 0.5, smooth(clamp((t - T.crust) / 0.8)), (c) => {
            if (wq <= 0) return; c.lineWidth = 1.5 * s;
            E.cats.forEach((cat, k) => { c.strokeStyle = rgba(mix(CATC[cat], WHITE, 0.3), 1); c.globalAlpha = 0.7 * Math.sin(Math.PI * wq); c.beginPath(); for (let i = 0; i <= 24; i++) { const f = i / 24, a = f * 6 + t * (4 + 10 * wq) + (k / E.cats.length) * TAU, r = (1 - f) * 0.95; c.lineTo(mx + Math.cos(a) * r * rx, my + Math.sin(a) * r * ry); } c.stroke(); });
            c.globalAlpha = 1;
          });
          if (E.flashC && t - E.flashC.t < 0.3) { ctx.globalCompositeOperation = "lighter"; glow(ctx, mx, my, rx * 1.5, E.flashC.c, 0.5 * (1 - (t - E.flashC.t) / 0.3)); ctx.globalCompositeOperation = "source-over"; }
          drawParts(E, ctx);
          for (const it of E.items) { const p = (t - it.dep) / T.fall; if (p <= 0 || p >= 1) continue; drawSpr(ctx, it.spr, it.x, lerp(-E.HS, my, inCubic(p)), E.HS * lerp(1, 0.6, p), 1, p * 3); }
          const a1 = clamp((t - 0.1) / 0.3) * (1 - clamp((t - T.whirl0) / 0.4));
          text(ctx, `TEN ${TIERS[E.tier].toUpperCase()} INTO THE MELT`, E.W * 0.75, E.H * 0.2, pix(fsz(E, 11)), GOLD, a1, true, 2);
          const a2 = clamp((t - T.label) / 0.4) * (1 - clamp((t - T.end + 0.5) / 0.5));
          if (a2 > 0) plate(ctx, E.W * 0.75, E.H * 0.16, [["THE MELT IS SEALED", pix(fsz(E, 12)), GOLD], ["reveal it after the next minute", mono(fsz(E, 14)), INK]], a2, [255, 140, 40]);
        },
        end(S, E, memo) { S.crust = true; memo.sealed = true; memo.row = null; for (const k of ["smoke", "sparks"]) S[k] = E[k]; },
      },
      deal: {
        async load(o) { return { outs: await Promise.all((o.outs || []).map((x) => keyed(x.src))) }; },
        build(S, o, spr) {
          const E = pit(S.W, S.H, { tier: o.tier }, { crucible: S.crucible }, o.seed || 31); E.crust = true; E.tier = clamp(o.tier | 0, 1, 5);
          let at = 1.15; E.outs = (o.outs || []).map((x, i) => { const d = x.tier - E.tier, r = { spr: spr.outs[i], tier: x.tier, d, c: tierColor(x.tier), launch: at, hold: d >= 2 ? 0.8 : 0 }; at += 0.55 + r.hold; return r; });
          E.T = { crack: 0.8 }; E.T.label = at + 0.3; E.T.end = E.T.label + 2.6; E.FL = 0.7;
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT), [mx, my, rx, ry] = E.mol, C = E.crustMap;
          E.crackHot = 1 + 2.4 * smooth(clamp(t / T.crack)); if (t < T.crack) E.shake = Math.max(E.shake, 0.7 * s * clamp(t / T.crack));
          if (t < T.crack && rand() < 0.5) { const a = rand() * TAU, r = rand() * 0.9; E.sparks.push({ x: mx + Math.cos(a) * r * rx, y: my + Math.sin(a) * r * ry, vx: (rand() - 0.5) * 30 * s, vy: -(30 + rand() * 70) * s, g: 170 * s, life: 0.4 + rand() * 0.3, age: 0, c: [255, 220, 140] }); }
          if (t >= T.crack && !E.broke) {
            E.broke = true; E.crust = false; E.crackHot = 1; E.shake = 2.4 * s; E.rings.push({ x: mx, y: my, r0: 4 * s, r1: rx * 2.2, life: 0.55, age: 0, c: [255, 210, 120] });
            for (let i = 0; i < 70; i++) { // the plates of the crust fly apart
              const [ci, cj] = C.cells[Math.floor(rand() * C.cells.length)], q = (cj * C.cw + ci) * 4, x = mx - rx + (ci + 0.5) * ((2 * rx) / C.cw), y = my - ry + (cj + 0.5) * ((2 * ry) / C.ch), a = Math.atan2(y - my, x - mx), v = (50 + rand() * 130) * s;
              E.shards.push({ x, y, vx: Math.cos(a) * v * 0.7, vy: -Math.abs(Math.sin(a)) * v * 0.4 - (60 + rand() * 90) * s, life: 0.9 + rand() * 0.6, age: 0, c: rand() < 0.2 ? [255, 170, 60] : [C.P[q], C.P[q + 1], C.P[q + 2]], z: rand() < 0.4 ? 2 : 1 });
            }
          }
          E.outs.forEach((o, i) => {
            const p = blobP(E, o, t);
            if (p > 0 && p < 1 && rand() < 0.8) { const [x, y] = blobAt(E, o, i, p); E.trail.push({ x, y, vx: 0, vy: 0, g: 0, life: 0.3, age: 0, c: p < 0.55 ? [255, 190, 90] : mix(o.c, WHITE, 0.4) }); }
            if (o.hold && t > o.launch + E.FL * 0.45 && t < o.launch + E.FL * 0.45 + o.hold && rand() < 0.9) { const [x, y] = blobAt(E, o, i, 0.45), a = rand() * TAU, r = (20 + rand() * 30) * s; E.motes.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 2.2, g: 0, life: 0.4, age: 0, c: GOLD }); }
            if (p >= 1 && !o.landed) {
              o.landed = true; const [x, y] = slotAt(E, i, E.outs.length);
              if (o.d >= 2) { E.shake = 3 * s; E.rings.push({ x, y, r0: 4 * s, r1: E.W * 0.3, life: 0.8, age: 0, c: WHITE }, { x, y, r0: 4 * s, r1: E.W * 0.22, life: 0.7, age: -0.1, c: GOLD }); E.jackpot = { t, x, y }; for (let k = 0; k < 90; k++) { const a = rand() * TAU, v = (60 + rand() * 260) * s * 0.5; E.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * s, g: 160 * s, life: 0.8 + rand() * 1.0, age: 0, c: rand() < 0.4 ? WHITE : GOLD, z: rand() < 0.3 ? 2 : 1, bounce: true }); } }
              else if (o.d === 1) { E.rings.push({ x, y, r0: 3 * s, r1: E.IS * 1.2, life: 0.5, age: 0, c: GOLD }); for (let k = 0; k < 24; k++) { const a = rand() * TAU, v = (40 + rand() * 90) * s; E.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 90 * s, life: 0.5 + rand() * 0.4, age: 0, c: rand() < 0.5 ? WHITE : GOLD }); } }
              else if (o.d < 0) { for (let k = 0; k < 10; k++) E.smoke.push({ x: x + (rand() - 0.5) * E.IS * 0.6, y, vx: (rand() - 0.5) * 16 * s, vy: -(10 + rand() * 16) * s, r: 3 * s, gr: 8 * s, life: 1.2 + rand() * 0.6, age: 0, a: 0.5, c: [70, 70, 74] }); }
              else for (let k = 0; k < 8; k++) E.sparks.push({ x, y: y + E.IS * 0.3, vx: (rand() - 0.5) * 60 * s, vy: -rand() * 40 * s, g: 120 * s, life: 0.35 + rand() * 0.3, age: 0, c: WHITE });
            }
          });
          stepPit(E, t < T.crack ? 0.8 : 0.7);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t, s } = E;
          drawPit(E, ctx, 0.7, E.crust ? 1 : 0);
          if (E.broke && t - T.crack < 0.45) { const [mx, my, rx] = E.mol, q = (t - T.crack) / 0.45; ctx.globalCompositeOperation = "lighter"; glow(ctx, mx, my, rx * 3, [255, 220, 150], 0.85 * (1 - q) * (1 - q)); ctx.globalCompositeOperation = "source-over"; }
          if (E.jackpot && t - E.jackpot.t < 1.3) { const q = (t - E.jackpot.t) / 1.3; ctx.globalCompositeOperation = "lighter"; rays(ctx, E.jackpot.x, E.jackpot.y, 16, E.W * 0.4, 0.05, 0.5 * q, WHITE, GOLD, 0.55 * Math.sin(Math.PI * q)); glow(ctx, E.jackpot.x, E.jackpot.y, E.W * 0.25, GOLD, 0.6 * (1 - q)); ctx.globalCompositeOperation = "source-over"; }
          drawParts(E, ctx);
          E.outs.forEach((o, i) => {
            const p = blobP(E, o, t); if (p <= 0) return;
            if (p >= 1) { const [x, y] = slotAt(E, i, E.outs.length), since = t - (o.launch + E.FL + o.hold), dim = o.d < 0 ? 0.35 * (1 - clamp(since / 0.8)) : 0; ctx.globalCompositeOperation = "lighter"; glow(ctx, x, y + E.IS * 0.35, E.IS * 0.6, o.c, 0.25); ctx.globalCompositeOperation = "source-over"; drawSpr(ctx, o.spr, x, y - Math.max(0, Math.sin(clamp(since / 0.25) * Math.PI)) * 4 * s, E.IS); if (dim) drawSpr(ctx, sil(E, o.spr, [30, 30, 32], dim), x, y, E.IS); if (o.d) text(ctx, o.d > 0 ? `+${o.d}` : `${o.d}`, x, y - E.IS * 0.62 - fsz(E, 12) - clamp(since / 0.5) * 6 * s, pix(fsz(E, o.d >= 2 ? 16 : 12)), o.d > 0 ? GOLD : ASH, clamp(since / 0.2), true); return; }
            const [x, y] = blobAt(E, o, i, p), cool = clamp((p - 0.5) / 0.4), z = E.IS * lerp(0.55, 1, cool);
            ctx.globalCompositeOperation = "lighter"; glow(ctx, x, y, z * (o.hold && p > 0.4 && p < 0.5 ? 1.6 : 0.9), cool < 1 ? mix([255, 190, 90], o.c, cool) : o.c, 0.6 * (1 - cool * 0.5)); ctx.globalCompositeOperation = "source-over";
            if (cool <= 0) { ctx.fillStyle = "rgb(255,230,170)"; const r = z * 0.3; ctx.fillRect(px(E, x - r), px(E, y - r), px(E, 2 * r), px(E, 2 * r)); }
            else { drawSpr(ctx, o.spr, x, y, z, cool); whiteIn(E, ctx, o.spr, x, y, z, cool * 1.4, [255, 220, 160]); }
          });
          const a = clamp((t - T.label) / 0.4);
          if (a > 0) { const up = E.outs.filter((o) => o.d > 0).length, down = E.outs.filter((o) => o.d < 0).length; plate(ctx, E.W * 0.75, E.H * 0.1, [[`${E.outs.length} FROM TEN`, pix(fsz(E, 12)), GOLD], [up || down ? [up ? `${up} up` : "", down ? `${down} down` : ""].filter(Boolean).join(" · ") : `all ${TIERS[E.tier]}`, mono(fsz(E, 14)), INK]], a, [255, 140, 40]); }
        },
        end(S, E, memo) { S.crust = false; memo.sealed = false; memo.row = E.outs.map((o) => ({ spr: o.spr, c: o.c, d: o.d })); for (const k of ["smoke", "sparks"]) S[k] = E[k]; },
      },
    },
  };
  // a blob leaves the melt at its launch, hangs at the top of its arc if it is a jackpot, and lands on its slot
  function blobP(E, o, t) { const u = t - o.launch; if (u <= 0) return 0; const a = E.FL * 0.45; if (u < a) return (u / a) * 0.45; if (u < a + o.hold) return 0.45; return Math.min(1, 0.45 + ((u - a - o.hold) / (E.FL - a)) * 0.55); }
  function blobAt(E, o, i, p) { const [mx, my] = E.mol, [x, y] = slotAt(E, i, E.outs.length); return arc([mx, my], [x, y], E.H * 0.34, p); }

  // ================================================================ the ritual table (a ritual item)
  // A stone table between two candles, a sigil in chalk on the wall above it. The five ingredients take the five points
  // of the star, dissolve into light and draw its lines, and the rite is sealed. At the reveal the sigil draws in to its
  // centre and the item takes shape there; a higher tier than asked comes as a second surge of light.
  const CHAMBER = { bg: "#0c0b12", brick: [[22, 20, 32], [30, 27, 42]], bw: 18, bh: 9, floor: "#100e16", lip: "#1e1a2a",
    wall: (g, S, rand, b) => { g.fillStyle = "rgba(214,226,240,0.05)"; for (let i = 0; i < 14; i++) { const x = rand() * S.W, y = rand() * S.floor * 0.8; g.fillRect(Math.round(x), Math.round(y), b * (2 + Math.floor(rand() * 4)), b); } } };
  function chamber(W, H, p, spr, seed) {
    const S = base(W, H, seed), s = Math.max(2, Math.floor(H / 110)), floor = Math.round(H * 0.9);
    Object.assign(S, { s, floor, tier: clamp(p.tier | 0, 1, 5), kind: p.kindName || "", item: spr.item, table: [Math.round(W * 0.24), Math.round(W * 0.76), Math.round(H * 0.7)] });
    S.C = [Math.round(W * 0.5), Math.round(H * 0.36)]; S.R = Math.round(Math.min(H * 0.27, W * 0.17));
    S.pts = Array.from({ length: 5 }, (_, k) => { const a = -Math.PI / 2 + (k * TAU) / 5; return [S.C[0] + Math.cos(a) * S.R, S.C[1] + Math.sin(a) * S.R]; });
    S.candles = [[Math.round(W * 0.28), S.table[2]], [Math.round(W * 0.72), S.table[2]]];
    const rand = S.rand; S.runes = Array.from({ length: 30 }, () => [0, 1, 1, 2, 3][Math.floor(rand() * 5)]);
    S.bg = backdrop(S, CHAMBER);
    return S;
  }
  const STAR = [0, 2, 4, 1, 3, 0];
  function drawChamber(S, ctx, lit, litC, draw, lean) {
    const { s, t } = S, [x0, x1, ty] = S.table;
    frame(S, ctx);
    ctx.globalCompositeOperation = "lighter"; for (const [cx, cy] of S.candles) glow(ctx, cx, cy - 16 * s, S.W * 0.2, [255, 190, 110], 0.16 + 0.03 * Math.sin(t * 7 + cx)); ctx.globalCompositeOperation = "source-over";
    // the sigil: chalk, faint; drawn lines light up in the colour of the tier
    const sc = draw ? draw.scale : 1, rot = draw ? draw.rot : 0, P = S.pts.map(([x, y]) => { const dx = (x - S.C[0]) * sc, dy = (y - S.C[1]) * sc, c = Math.cos(rot), sn = Math.sin(rot); return [S.C[0] + dx * c - dy * sn, S.C[1] + dx * sn + dy * c]; });
    const R = S.R * sc;
    ctx.strokeStyle = rgba(CHALK, 1); ctx.lineWidth = s; ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.arc(S.C[0], S.C[1], R, 0, TAU); ctx.stroke(); ctx.beginPath(); STAR.forEach((k, i) => (i ? ctx.lineTo(...P[k]) : ctx.moveTo(...P[k]))); ctx.stroke(); ctx.globalAlpha = 1;
    if (lit > 0) {
      ctx.globalCompositeOperation = "lighter";
      const segs = draw && draw.segs !== undefined ? draw.segs : 5, ring = draw && draw.ring !== undefined ? draw.ring : 1;
      for (const [w, a] of [[6 * s, 0.18], [2 * s, 0.6], [s, 1]]) {
        ctx.strokeStyle = rgba(a === 1 ? mix(litC, WHITE, 0.6) : litC, 1); ctx.lineWidth = w; ctx.globalAlpha = a * lit;
        ctx.beginPath(); for (let i = 0; i < 5; i++) { const f = clamp(segs - i); if (f <= 0) break; const [ax, ay] = P[STAR[i]], [bx, by] = P[STAR[i + 1]]; ctx.moveTo(ax, ay); ctx.lineTo(lerp(ax, bx, f), lerp(ay, by, f)); } ctx.stroke();
        if (ring > 0) { ctx.beginPath(); ctx.arc(S.C[0], S.C[1], R, -Math.PI / 2 + rot, -Math.PI / 2 + rot + TAU * ring); ctx.stroke(); }
      }
      if (ring >= 1) for (let i = 0; i < S.runes.length; i++) { const m = S.runes[i]; if (!m) continue; const a = -Math.PI / 2 + rot * 0.5 + (i / S.runes.length) * TAU, r = R + 7 * s, x = S.C[0] + Math.cos(a) * r, y = S.C[1] + Math.sin(a) * r; ctx.globalAlpha = lit * (0.4 + 0.3 * Math.sin(t * 3 + i)); ctx.fillStyle = rgba(litC, 1); ctx.fillRect(px(S, x), px(S, y), m === 2 ? 2 * s : s, m === 3 ? 2 * s : s); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }
    // the table and the candles
    ctx.fillStyle = "#2a2733"; ctx.fillRect(x0, ty, x1 - x0, 5 * s); ctx.fillStyle = "#3a3646"; ctx.fillRect(x0, ty, x1 - x0, s); ctx.fillStyle = "#17151d"; ctx.fillRect(x0 + 2 * s, ty + 5 * s, x1 - x0 - 4 * s, 2 * s);
    ctx.fillStyle = "#1f1c27"; ctx.fillRect(x0 + 8 * s, ty + 7 * s, 5 * s, S.floor - ty - 7 * s); ctx.fillRect(x1 - 13 * s, ty + 7 * s, 5 * s, S.floor - ty - 7 * s);
    for (const [cx, cy] of S.candles) {
      ctx.fillStyle = "#d9cfb8"; ctx.fillRect(cx - 2 * s, cy - 12 * s, 4 * s, 12 * s); ctx.fillStyle = "#b9ad93"; ctx.fillRect(cx + s, cy - 12 * s, s, 12 * s); ctx.fillStyle = "#2a2520"; ctx.fillRect(cx, cy - 13 * s, s, s);
      const L = lean ? lean(cx) : 0, f = (Math.floor(t * 12 + cx) % 3) * 0.5; ctx.globalCompositeOperation = "lighter"; glow(ctx, cx + L * 3 * s, cy - 16 * s, 6 * s, [255, 200, 120], 0.5);
      ctx.fillStyle = "rgb(255,214,120)"; ctx.fillRect(px(S, cx - s + L * 2 * s), cy - (16 + f) * s, 2 * s, 3 * s); ctx.fillStyle = "rgb(255,248,220)"; ctx.fillRect(px(S, cx + L * 3 * s), cy - (18 + f) * s, s, 2 * s); ctx.globalCompositeOperation = "source-over";
    }
  }
  const Ritual = {
    async load(p) { return { item: p.itemSrc ? await keyed(p.itemSrc) : null }; },
    init(W, H, p, spr, memo) { const S = chamber(W, H, p, spr, 37); S.sealed = !!(p.sealed || memo.sealed); return S; },
    idle(S) { S.t += DT; if (S.rand() < 0.2) S.motes.push({ x: S.C[0] + (S.rand() - 0.5) * S.W * 0.5, y: S.table[2] - S.rand() * S.H * 0.4, vx: 0, vy: -(3 + S.rand() * 5) * S.s, g: 0, life: 2.5, age: 0, a: 0.4, c: [255, 210, 150] }); if (S.sealed && S.rand() < 0.08) S.smoke.push({ x: S.C[0] + (S.rand() - 0.5) * S.W * 0.3, y: S.table[2], vx: (S.rand() - 0.5) * 6 * S.s, vy: -(8 + S.rand() * 8) * S.s, r: 3 * S.s, gr: 7 * S.s, life: 2, age: 0, a: 0.22, c: [80, 50, 110] }); stepParts(S); },
    draw(S, ctx, p, memo) {
      drawChamber(S, ctx, S.sealed ? 0.45 + 0.15 * Math.sin(S.t * 2) : 0, tierColor(S.tier));
      drawParts(S, ctx);
      const r = p.sealed || memo.sealed ? null : memo.result; if (r) { const y = S.C[1] + Math.sin(S.t * 2) * S.s; ctx.globalCompositeOperation = "lighter"; glow(ctx, S.C[0], y, S.R * 0.9, r.c, 0.35); if (r.tier >= 4) rays(ctx, S.C[0], y, 12, S.R * 0.95, 0.09, 0.3 * S.t, WHITE, mix(r.c, WHITE, 0.4), 0.22); ctx.globalCompositeOperation = "source-over"; drawSpr(ctx, r.spr, S.C[0], y, S.R * 0.95); }
      const sealed = p.sealed || (memo.sealed && { ready: false });
      tag(S, ctx, sealed ? `THE RITUAL TABLE · a rite is sealed · ${sealed.ready ? "ready to reveal" : "reveals after the next minute"}` : `THE RITUAL TABLE · ${p.kindName || ""}`, sealed && sealed.ready ? GOLD : SOFT);
    },
    events: {
      inscribe: {
        async load(o) { return { ings: await Promise.all((o.srcs || []).map((x) => keyed(x))) }; },
        build(S, o, spr) {
          const E = chamber(S.W, S.H, { tier: o.tier, kindName: o.kindName }, { item: null }, o.seed || 41); E.c = tierColor(E.tier);
          E.ings = (spr.ings || []).slice(0, 5).map((m, i) => ({ spr: m, pop: 0.15 + i * 0.12, go: 0.95 + i * 0.32 })); E.IS = Math.round(Math.min(E.R * 0.46, 56));
          E.T = { ring0: 0.95 + 4 * 0.32 + 0.45 }; E.T.ring1 = E.T.ring0 + 0.55; E.T.seal = E.T.ring1 + 0.05; E.T.label = E.T.seal + 0.3; E.T.end = E.T.label + 2.2;
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT);
          E.ings.forEach((g, i) => { const [x, y] = E.pts[i]; if (t >= g.go && !g.gone) { g.gone = true; for (let k = 0; k < 16; k++) { const a = rand() * TAU, v = (20 + rand() * 50) * s; E.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0, life: 0.5 + rand() * 0.4, age: 0, c: rand() < 0.5 ? WHITE : mix(E.c, WHITE, 0.4) }); } } const f = (t - g.go) / 0.5; if (f > 0 && f < 1) { const a = E.pts[STAR[i]], b = E.pts[STAR[i + 1]]; E.trail.push({ x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), vx: (rand() - 0.5) * 20 * s, vy: (rand() - 0.5) * 20 * s, g: 0, life: 0.4, age: 0, c: WHITE }); } });
          if (t >= T.seal && !E.sealedFx) { E.sealedFx = true; E.rings.push({ x: E.C[0], y: E.C[1], r0: E.R * 0.2, r1: E.R * 1.6, life: 0.7, age: 0, c: E.c }); for (let k = 0; k < 14; k++) E.smoke.push({ x: E.C[0] + (rand() - 0.5) * E.W * 0.3, y: E.table[2], vx: (rand() - 0.5) * 16 * s, vy: -(14 + rand() * 16) * s, r: 3 * s, gr: 9 * s, life: 2 + rand(), age: 0, a: 0.35, c: [90, 56, 124] }); }
          stepParts(E);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t } = E, segs = E.ings.reduce((acc, g) => acc + clamp((t - g.go) / 0.5), 0), ring = clamp((t - T.ring0) / (T.ring1 - T.ring0)), lit = t >= T.seal ? 0.9 - 0.3 * clamp((t - T.seal) / 1.5) : 0.85;
          drawChamber(E, ctx, lit, E.c, { segs, ring, scale: 1, rot: 0 }, (cx) => (t > T.seal && t < T.seal + 0.6 ? Math.sign(E.C[0] - cx) * Math.sin(Math.PI * (t - T.seal) / 0.6) : 0));
          if (t >= T.seal && t - T.seal < 0.4) { ctx.globalCompositeOperation = "lighter"; glow(ctx, E.C[0], E.C[1], E.R * 1.4, E.c, 0.5 * (1 - (t - T.seal) / 0.4)); ctx.globalCompositeOperation = "source-over"; }
          drawParts(E, ctx);
          E.ings.forEach((g, i) => { const pop = outBack(clamp((t - g.pop) / 0.3)), gone = clamp((t - g.go) / 0.25); if (pop <= 0.01 || gone >= 1) return; const [x, y] = E.pts[i]; ctx.globalCompositeOperation = "lighter"; glow(ctx, x, y, E.IS * 0.8, E.c, 0.2 * pop); ctx.globalCompositeOperation = "source-over"; drawSpr(ctx, g.spr, x, y, E.IS * pop * (1 - 0.6 * gone), 1 - gone * 0.3); whiteIn(E, ctx, g.spr, x, y, E.IS * pop * (1 - 0.6 * gone), 1 - gone); });
          const a1 = clamp((t - 0.1) / 0.3) * (1 - clamp((t - T.ring0) / 0.4));
          text(ctx, `A ${TIERS[E.tier].toUpperCase()} ${E.kind.toUpperCase()}`, E.W * 0.87, E.H * 0.1, pix(fsz(E, 10)), GOLD, a1, true, 1);
          const a2 = clamp((t - T.label) / 0.4) * (1 - clamp((t - T.end + 0.5) / 0.5));
          if (a2 > 0) plate(ctx, E.W * 0.87, E.W < 520 ? E.H * 0.7 : E.H * 0.08, [["THE RITE IS SEALED", pix(fsz(E, 11)), mix(E.c, WHITE, 0.4)], ["reveal it after", mono(fsz(E, 13)), INK], ["the next minute", mono(fsz(E, 13)), INK]], a2, E.c);
        },
        end(S, E, memo) { S.sealed = true; memo.sealed = true; memo.result = null; for (const k of ["smoke", "sparks"]) S[k] = E[k]; },
      },
      manifest: {
        async load(o) { return { item: await keyed(o.itemSrc) }; },
        build(S, o, spr) {
          const E = chamber(S.W, S.H, { tier: o.tier, kindName: o.kindName }, { item: spr.item }, o.seed || 43);
          Object.assign(E, { outTier: o.outTier || o.tier, key: !!o.key, name: o.name || "" }); E.c = tierColor(E.tier); E.cOut = E.key ? mix(tierColor(6), GOLD, 0.3) : tierColor(E.outTier);
          E.T = { form: 1.1 }; E.T.up = E.outTier > E.tier || E.key ? E.T.form + 0.7 : 0; E.T.label = (E.T.up || E.T.form) + 0.5; E.T.end = E.T.label + 2.6;
          return E;
        },
        step(E) {
          const { T, rand, s } = E, t = (E.t += DT);
          if (t < T.form && rand() < 0.9) { const a = rand() * TAU, r = E.R * (1 + rand() * 0.6); E.motes.push({ x: E.C[0] + Math.cos(a) * r, y: E.C[1] + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.6, vy: -Math.sin(a) * r * 1.6, g: 0, life: 0.55, age: 0, c: rand() < 0.5 ? WHITE : E.c }); }
          if (t >= T.form && !E.formed) { E.formed = true; E.shake = 1.5 * s; E.rings.push({ x: E.C[0], y: E.C[1], r0: 4 * s, r1: E.R * 1.8, life: 0.6, age: 0, c: WHITE }); for (let k = 0; k < 50; k++) { const a = rand() * TAU, v = (40 + rand() * 140) * s * 0.6; E.sparks.push({ x: E.C[0], y: E.C[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 60 * s, life: 0.6 + rand() * 0.6, age: 0, c: rand() < 0.4 ? WHITE : mix(E.c, WHITE, 0.3) }); } }
          if (T.up && t >= T.up && !E.upped) { E.upped = true; E.shake = 2 * s; E.rings.push({ x: E.C[0], y: E.C[1], r0: E.R * 0.3, r1: E.R * 2.2, life: 0.7, age: 0, c: E.cOut }); for (let k = 0; k < 60; k++) { const a = rand() * TAU, v = (60 + rand() * 180) * s * 0.6; E.sparks.push({ x: E.C[0], y: E.C[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 60 * s, life: 0.7 + rand() * 0.7, age: 0, c: rand() < 0.4 ? WHITE : E.cOut }); } }
          stepParts(E);
          if (t >= T.end) E.done = true;
        },
        draw(E, ctx) {
          const { T, t, s } = E, q = clamp(t / T.form), cNow = T.up && t >= T.up ? E.cOut : E.c;
          drawChamber(E, ctx, t < T.form ? 0.9 : 0.9 * (1 - clamp((t - T.form) / 0.5)), E.c, { scale: 1 - 0.85 * inCubic(q), rot: 2.5 * q * q }, (cx) => (t < T.form + 0.3 ? Math.sign(E.C[0] - cx) * clamp(t / 0.6) : 0));
          ctx.globalCompositeOperation = "lighter";
          if (t >= T.form && t - T.form < 0.45) glow(ctx, E.C[0], E.C[1], E.R * (1 + 2 * outCubic((t - T.form) / 0.45)), WHITE, 0.9 * (1 - (t - T.form) / 0.45) ** 2);
          if (T.up && t >= T.up && t - T.up < 1.2) rays(ctx, E.C[0], E.C[1], 14, E.W * 0.3, 0.06, 0.4 * (t - T.up), WHITE, mix(E.cOut, WHITE, 0.4), 0.5 * Math.sin(Math.PI * clamp((t - T.up) / 1.2)));
          if (t >= T.form) { const y = E.C[1] + Math.sin(t * 2) * s; glow(ctx, E.C[0], y, E.R * 0.9, cNow, 0.4); if ((E.key ? 6 : E.outTier) >= 4) rays(ctx, E.C[0], y, 12, E.R * 0.95, 0.09, 0.3 * t, WHITE, mix(cNow, WHITE, 0.4), 0.25); }
          ctx.globalCompositeOperation = "source-over";
          drawParts(E, ctx);
          if (t >= T.form && E.item) { const p = clamp((t - T.form) / 0.6), y = E.C[1] + Math.sin(t * 2) * s, z = E.R * 0.95 * lerp(0.4, 1, outBack(p)); drawSpr(ctx, E.item, E.C[0], y, z); whiteIn(E, ctx, E.item, E.C[0], y, z, p / 0.5); }
          const a = clamp((t - T.label) / 0.4);
          if (a > 0) plate(ctx, E.W * 0.86, E.W < 520 ? E.H * 0.72 : E.H * 0.08, E.key ? [["A MYTHIC KEY", pix(fsz(E, 11)), GOLD], [E.name, mono(fsz(E, 13)), INK]] : [[E.outTier > E.tier ? "A TIER HIGHER" : "SEALED INTO", pix(fsz(E, 11)), E.outTier > E.tier ? GOLD : mix(E.c, WHITE, 0.4)], [`${TIERS[E.outTier]} ${E.kind}`, mono(fsz(E, 14)), INK]], a, cNow);
        },
        end(S, E, memo) { S.sealed = false; memo.sealed = false; memo.result = { spr: E.item, c: E.key ? E.cOut : tierColor(E.outTier), tier: E.key ? 6 : E.outTier }; for (const k of ["smoke", "sparks", "motes"]) S[k] = E[k]; },
      },
    },
  };

  // ================================================================ the stage: a scene living in the page
  const SCENES = { refine: Forge, furnace: Build, potion: Brew, reroll: Crucible, item: Ritual };
  const ratio = (W) => (W < 520 ? 0.62 : 0.46);
  class Stage {
    constructor(host, kind) {
      this.host = host; this.kind = kind; this.scene = SCENES[kind]; this.props = {}; this.memo = {}; this.spr = {}; this.S = null; this.E = null; this.q = Promise.resolve(); this.running = false; this.W = 0; this.seen = false; this.gen = 0;
      this.cv = document.createElement("canvas"); host.appendChild(this.cv); this.ctx = this.cv.getContext("2d");
      this.cv.addEventListener("click", () => { if (this.E) this.E.skip = true; }); // a click skips what is playing
      if (window.ResizeObserver) new ResizeObserver(() => this.fit()).observe(host);
      if (window.IntersectionObserver) new IntersectionObserver((es) => { this.seen = es[es.length - 1].isIntersecting; this.wake(); }).observe(host); else this.seen = true;
      document.addEventListener("visibilitychange", () => this.wake());
      this.fit();
    }
    visible() { return this.seen && !document.hidden && this.host.offsetParent !== null && this.W > 0; }
    fit() { const W = Math.round(this.host.clientWidth); if (!W || W === this.W) return; this.W = W; this.H = Math.round(W * ratio(W)); this.cv.width = W; this.cv.height = this.H; this.rebuild(); }
    async set(props) {
      Object.assign(this.props, props); const gen = ++this.gen;
      const spr = await this.scene.load(this.props).catch(() => ({})); if (gen !== this.gen) return;
      this.spr = spr; this.rebuild();
    }
    rebuild() { if (!this.W || !this.spr || !Object.keys(this.spr).length) return; this.S = this.scene.init(this.W, this.H, this.props, this.spr, this.memo); if (this.E) return; this.draw(); this.wake(); }
    wake() {
      if (this.running || !this.visible() || !this.S) return; this.running = true; let last = performance.now(), acc = 0;
      const loop = (now) => { if (!this.visible()) { this.running = false; return; } acc += Math.min(0.1, (now - last) / 1000); last = now; let n = 0; while (acc >= DT && n++ < 8) { this.tick(); acc -= DT; } this.draw(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    tick() {
      if (this.E) { const E = this.E; let n = E.skip ? 4000 : E.speed || 1; while (n-- > 0 && !E.done) E.ev.step(E); this.cv.style.cursor = E.done ? "" : "pointer"; if (E.done) { if (E.ev.end && this.S) E.ev.end(this.S, E, this.memo); this.E = null; E.resolve(); } }
      else if (this.S) this.scene.idle(this.S, this.props, this.memo);
    }
    draw() { if (this.E) this.E.ev.draw(this.E, this.ctx); else if (this.S) this.scene.draw(this.S, this.ctx, this.props, this.memo); }
    // play an event of this scene; resolves when it has run (a hidden scene waits until it is shown)
    play(name, o, opts = {}) {
      const ev = this.scene.events[name]; if (!ev) return Promise.resolve();
      const job = this.q.then(async () => {
        const extra = await ev.load(o).catch(() => ({}));
        await new Promise((ok) => { const go = () => (this.S ? ok() : setTimeout(go, 100)); go(); });
        const E = ev.build(this.S, o, { ...this.spr, ...extra }); E.ev = ev; E.speed = Math.max(1, Math.round(opts.speed || 1));
        if (reduce) { while (!E.done) ev.step(E); if (ev.end) ev.end(this.S, E, this.memo); this.draw(); return; }
        await new Promise((resolve) => { E.resolve = resolve; this.E = E; this.wake(); });
      }).catch(() => {});
      this.q = job; return job;
    }
  }
  const stages = {};
  const api = {
    mount(kind, host) { if (!SCENES[kind] || !host) return null; if (!stages[kind]) stages[kind] = new Stage(host, kind); return stages[kind]; },
    stage: (kind) => stages[kind] || null,
    // a station that was hidden has no size yet: measure it the moment it is shown
    show(kind) { const st = stages[kind]; if (st) { st.fit(); st.wake(); } },
    set(kind, props) {
      const st = stages[kind]; if (!st) return Promise.resolve();
      const key = JSON.stringify({ ...st.props, ...props }, (k, v) => (typeof v === "function" ? undefined : v));
      if (key === st.key) { Object.assign(st.props, props); return Promise.resolve(); }
      st.key = key; if ("sealed" in props) st.memo.sealed = false; return st.set(props);
    },
    play(kind, name, o, opts) { const st = stages[kind]; return st ? st.play(name, o, opts) : Promise.resolve(); },
  };
  // ?vfxdev=1: render any moment of an event of a scene, from a fresh idle scene, for captures
  if (new URLSearchParams(location.search).get("vfxdev")) {
    api.dev = {
      async render(kind, name, props, o, times, memo = {}) {
        const st = stages[kind]; if (!st) throw new Error("no stage " + kind); st.fit(); if (!st.W) throw new Error("stage " + kind + " is not on screen");
        const spr = await st.scene.load({ ...st.props, ...props }), extra = name ? await st.scene.events[name].load(o) : {}, out = [];
        for (const t of times) {
          const m = JSON.parse(JSON.stringify(memo, (k, v) => (v instanceof HTMLCanvasElement || v instanceof HTMLImageElement ? undefined : v)));
          const S = st.scene.init(st.W, st.H, { ...st.props, ...props }, spr, m);
          if (!name) { while (S.t < t - DT / 2) st.scene.idle(S, { ...st.props, ...props }, m); st.scene.draw(S, st.ctx, { ...st.props, ...props }, m); }
          else { const ev = st.scene.events[name], E = ev.build(S, o, { ...spr, ...extra }); while (E.t < t - DT / 2 && !E.done) ev.step(E); if (E.done && ev.end) { ev.end(S, E, m); st.scene.draw(S, st.ctx, { ...st.props, ...props }, m); } else ev.draw(E, st.ctx); }
          out.push(st.cv.toDataURL("image/jpeg", 0.9));
        }
        return out;
      },
    };
  }
  return api;
})();
