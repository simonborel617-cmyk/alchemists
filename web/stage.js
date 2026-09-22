// Mining stage: a pixel scene of the brew that follows the browser miner. The scene is a sprite sheet cut from a
// generated clip (img/stage-sprite.png: cell 0 the cold cauldron for idle, cells 1..N the boiling loop, played
// ping-pong) with the brew tint, embers, vials, smoke and the reveal drawn by code on top; the still (img/stage-1.png)
// stands in while the sheet loads, and `?stage=hybrid` keeps the older still-plus-code renderer for comparison.
//
// What the scene may show before a reveal: whether the brew is cold, warming (best hash below the bar) or over the bar.
// It never hints at a tier: the type, the supply extras of that type, the unlocked tiers and the upgrade roll are only
// known at the reveal, so a sealed vial looks the same whatever the bits. The tier appears on the reveal card only.
//
// Input: `alch:stage` events from app.js ({type: minute|best|rate|skip|submit|submitted|submitfail|pending, ...}),
// `alch:mining` ({running}) and `alch:loot` ({id, tier, label, via}). The Preview button plays a scripted round.
(() => {
  const el = document.getElementById("stage");
  if (!el) return;
  const W = 255, H = 171, FPS = 12;
  const COL = { potion: "#35c9e8", gold: "#d9a21b", gold2: "#f2c455", white: "#fff9e6", smoke: "#6b7176", cold: "#3a3f44", warm0: "#17303a", glass: "#bfe9ff", cork: "#8a5a2b", wax: "#b8372b" };
  const TIER_COL = ["", "#9aa0a4", "#3fae5a", "#3b7ddd", "#8e44d1", "#d9a21b", "#f2f2f2"]; // reveal card only
  // anchors in grid cells: the liquid surface, the fire (particles die above `top`), the glow centre, the vial rack
  const BG = {
    1: { src: "img/stage-1.png", liquid: { cx: 126, cy: 77, rx: 19, ry: 5 }, fire: { cx: 126, cy: 130, rx: 22, top: 96 }, glow: { cx: 126, cy: 60 }, rack: [[54, 154], [38, 158], [22, 162], [8, 166]] }, // the floor left of the tripod, clear of its foot
  };
  const q = new URLSearchParams(location.search);
  const mode = ["hybrid", "sprite"].includes(q.get("stage")) ? q.get("stage") : (el.dataset.stage || "sprite");
  const cfg = BG[1];
  el.dataset.mode = mode;
  const cv = el.querySelector("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  const hud = { cap: el.querySelector(".cap"), bits: el.querySelector(".bits"), labels: el.querySelector(".labels") };
  const bg = new Image(); bg.src = cfg.src;
  const SPRITE_VER = "5"; // bump when the sheet is rebuilt: /img/* is cached for a day
  const sprite = new Image(); if (mode === "sprite") sprite.src = `img/stage-sprite.png?v=${SPRITE_VER}`;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // drawn sprites for the rack vials and the gauge tube (scripts/stage-ui.py); the code shapes below are the fallback
  const UI_VER = "1";
  const ui = { vial: {}, gauge: new Image(), meta: null };
  for (const k of ["empty", "sealed", "ready"]) { ui.vial[k] = new Image(); ui.vial[k].src = `img/stage-vial-${k}.png?v=${UI_VER}`; }
  ui.gauge.src = `img/stage-gauge.png?v=${UI_VER}`;
  fetch(`img/stage-ui.json?v=${UI_VER}`).then((r) => (r.ok ? r.json() : null)).then((m) => { ui.meta = m; }).catch(() => {});
  const ready = (img) => img.complete && img.naturalWidth > 0;

  const S = {
    running: false, rate: 0, I: 0, thr: 0, best: 0, sec: 0, sessionSec: 60, chainNow: 0, m: 0,
    fizzleUntil: 0, smokeFrames: 0, cap: "", capUntil: 0, frame: 0, demo: false,
    vials: [], fire: [], bubbles: [], smoke: [], burst: [], shards: [],
  };
  const now = () => performance.now();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const intensity = (rate) => (rate > 0 ? clamp((Math.log10(rate) - 5) / 4.5, 0.15, 1) : 0);
  const fmtHs = (h) => (h >= 1e9 ? `${(h / 1e9).toFixed(2)} GH/s` : h >= 1e6 ? `${(h / 1e6).toFixed(1)} MH/s` : `${(h / 1e3).toFixed(0)} kH/s`);
  const say = (msg, ms) => { S.cap = msg; S.capUntil = now() + (ms || 4000); };
  const hex = (c, a) => { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const lerp = (a, b, t) => { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * t); return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`; };
  const over = () => S.thr > 0 && S.best >= S.thr;
  const cold = () => now() < S.fizzleUntil;

  // ---------------------------------------------------------------- crisp primitives (integer rows, no anti-aliasing)
  const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const pxEllipse = (cx, cy, rx, ry, c) => { g.fillStyle = c; for (let dy = -ry; dy <= ry; dy++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)))); if (w > 0) g.fillRect(cx - w, cy + dy, 2 * w + 1, 1); } };
  const pxLine = (x0, y0, x1, y1, w, c) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) px(x0 + (x1 - x0) * i / n - (w >> 1), y0 + (y1 - y0) * i / n, w, 1, c); };

  // ---------------------------------------------------------------- colours of the brew (no tier information)
  const liquidColor = () => {
    if (cold()) return COL.cold;
    if (S.thr <= 0) return COL.warm0;
    if (over()) return COL.gold;
    return lerp(COL.warm0, COL.potion, Math.pow(clamp(S.best / S.thr, 0, 1), 3));
  };

  // ---------------------------------------------------------------- particles
  const spawnFire = () => {
    const n = Math.floor(S.I * 5 + (Math.random() < (S.I * 3) % 1 ? 1 : 0));
    for (let i = 0; i < n; i++) S.fire.push({ x: cfg.fire.cx + rnd(-cfg.fire.rx, cfg.fire.rx), y: cfg.fire.cy + rnd(-2, 2), vx: rnd(-0.3, 0.3), vy: -rnd(0.5, 1.1 + S.I), life: rnd(5, 8 + 9 * S.I), age: 0, s: Math.random() < 0.35 ? 2 : 1 });
  };
  const fireColor = (k) => (k < 0.28 ? "#ffe680" : k < 0.55 ? "#ff9a2e" : k < 0.8 ? "#c8422a" : "#5a1e14");
  const burstAt = (x, y, colors, n = 22, speed = 2.2) => {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2), v = rnd(speed * 0.4, speed); S.burst.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: rnd(6, 10), age: 0, c: colors[i % colors.length] }); }
  };
  const smokeAt = (x, y, n) => { for (let i = 0; i < n; i++) S.smoke.push({ x: x + rnd(-6, 6), y, vx: rnd(-0.25, 0.25), vy: -rnd(0.35, 0.7), life: rnd(14, 22), age: 0, s: Math.random() < 0.5 ? 2 : 3 }); };
  const shatterAt = (x, y, c) => { for (let i = 0; i < 9; i++) S.shards.push({ x: x + rnd(-1, 1), y: y - rnd(0, 6), vx: rnd(-1.4, 1.4), vy: -rnd(0.4, 1.6), life: rnd(8, 12), age: 0, c: i % 3 === 0 ? c : COL.glass }); };
  const step = (arr, f) => { for (let i = arr.length - 1; i >= 0; i--) { const p = arr[i]; p.age++; f(p); if (p.age >= p.life) arr.splice(i, 1); } };

  // ---------------------------------------------------------------- vials on the rack
  // status: submitting (tx in flight) -> sealed (waits for the challenge of its reveal minute) -> ready (reveal it)
  // every sealed vial looks the same: the tier is unknown until the reveal
  const vialPos = (i) => cfg.rack[Math.min(i, cfg.rack.length - 1)];
  const addVial = (m, bits) => { S.vials.push({ m, bits, status: "submitting", revealMinute: m + 2, rise: 0 }); };
  const dropVial = (pred, shatter) => {
    const i = S.vials.findIndex(pred);
    if (i < 0) return null;
    const v = S.vials.splice(i, 1)[0];
    if (shatter) { const [x, y] = vialPos(i); shatterAt(x, y, COL.gold2); }
    return v;
  };
  const drawVial = (x, y, v) => {
    if (v.rise < 1) { const [lx, ly] = [cfg.liquid.cx, cfg.liquid.cy - 4]; x = Math.round(lx + (x - lx) * v.rise); y = Math.round(ly + (y - ly) * v.rise - Math.sin(v.rise * Math.PI) * 20); }
    const blink = (S.frame >> 2) & 1;
    const img = ui.vial[v.status === "submitting" ? "empty" : v.status === "ready" ? "ready" : "sealed"];
    if (ready(img)) { // bottom-centre anchored sprite; a soft pulse behind a vial that is ready to reveal
      const w = img.naturalWidth, h = img.naturalHeight, x0 = Math.round(x - w / 2), y0 = y - h;
      if (v.status === "ready" && !blink) pxEllipse(x, y - (h >> 1), (w >> 1) + 3, (h >> 1) + 3, hex(COL.potion, 0.22));
      if (v.status === "submitting" && blink) g.globalAlpha = 0.6;
      g.drawImage(img, x0, y0); g.globalAlpha = 1;
      return;
    }
    if (v.status === "ready" && !blink) px(x - 5, y - 13, 11, 15, hex(COL.potion, 0.3));
    px(x - 1, y - 11, 3, 2, v.status === "sealed" || v.status === "ready" ? COL.wax : COL.cork);
    px(x - 2, y - 9, 5, 2, "#1c2126");
    px(x - 1, y - 9, 3, 2, COL.glass); px(x - 3, y - 7, 7, 7, COL.glass);
    px(x - 2, y - 6, 5, 5, "#1c2126");
    const lvl = v.status === "submitting" ? 2 : 3;
    px(x - 2, y - 1 - lvl, 5, lvl, v.status === "submitting" ? (blink ? "#c9c4b6" : "#5b6166") : v.status === "ready" ? (blink ? COL.white : COL.potion) : "#8f978f");
    px(x - 2, y - 6, 1, 3, hex(COL.white, 0.5));
  };

  // ---------------------------------------------------------------- frame
  const update = () => {
    S.frame++;
    const target = S.running ? intensity(S.rate) : 0;
    S.I += (target - S.I) * 0.2;
    if (S.I < 0.02) S.I = 0;
    if (S.I > 0 && mode !== "sprite") spawnFire();
    step(S.fire, (p) => { p.x += p.vx + rnd(-0.2, 0.2); p.y += p.vy; if (p.y < cfg.fire.top) p.age = p.life; });
    if (S.running && S.I > 0 && mode !== "sprite" && Math.random() < 0.12 + S.I * 0.55) {
      const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.85;
      S.bubbles.push({ x: Math.round(cfg.liquid.cx + Math.cos(a) * r * cfg.liquid.rx), y: Math.round(cfg.liquid.cy + Math.sin(a) * r * cfg.liquid.ry), life: rnd(3, 6), age: 0, big: Math.random() < 0.3 });
    }
    step(S.bubbles, () => {});
    if (S.smokeFrames > 0) { S.smokeFrames--; smokeAt(cfg.liquid.cx, cfg.liquid.cy - 2, 3); }
    step(S.smoke, (p) => { p.x += p.vx + rnd(-0.15, 0.15); p.y += p.vy; if (p.age > p.life * 0.5 && p.s < 4) p.s++; });
    step(S.burst, (p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.15; });
    step(S.shards, (p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.3; });
    for (const v of S.vials) if (v.rise < 1) v.rise = Math.min(1, v.rise + 0.09);
  };

  const spriteFrames = () => (sprite.complete && sprite.naturalHeight >= H ? Math.floor(sprite.naturalHeight / H) : 0);
  const drawBase = () => {
    const n = mode === "sprite" ? spriteFrames() : 0;
    if (n > 1) { // sheet: frame 0 = the cold cauldron for idle, frames 1..n-1 = the boiling loop, played ping-pong
      let f = 0;
      if (S.I > 0) { const L = n - 1, k = S.frame % (2 * L - 2 || 1); f = 1 + (k < L ? k : 2 * L - 2 - k); }
      g.drawImage(sprite, 0, f * H, W, H, 0, 0, W, H); return;
    }
    if (bg.complete && bg.naturalWidth) g.drawImage(bg, 0, 0, W, H);
  };

  const draw = () => {
    g.clearRect(0, 0, W, H);
    drawBase();
    const lc = liquidColor();
    const brewing = S.running || cold();
    if (brewing) { // the tint of the brew is the state feedback in every mode; the sprite keeps its own bubbles underneath
      pxEllipse(cfg.liquid.cx, cfg.liquid.cy, cfg.liquid.rx, cfg.liquid.ry, hex(lc, mode === "sprite" ? 0.42 : 0.55));
      for (const b of S.bubbles) { px(b.x, b.y, 1, 1, hex(COL.white, 0.7)); if (b.big && b.age < b.life - 1) { px(b.x - 1, b.y, 1, 1, hex(COL.white, 0.7)); px(b.x + 1, b.y, 1, 1, hex(COL.white, 0.7)); px(b.x, b.y - 1, 1, 1, hex(COL.white, 0.7)); } }
    }
    if (S.I > 0 && mode !== "sprite") {
      for (let i = 0; i < 7; i++) { const x = cfg.fire.cx - cfg.fire.rx + Math.round((i + 0.5) * (cfg.fire.rx * 2) / 7); px(x, cfg.fire.cy - 1 + ((i * 7 + S.frame) % 3), 2, 1, hex((S.frame + i) % 3 ? "#ff9a2e" : "#ffe680", 0.25 + 0.45 * S.I * Math.random())); }
      for (const p of S.fire) px(p.x, p.y, p.s, p.s, fireColor(p.age / p.life));
    }
    if (S.I > 0 && mode === "sprite") { // the clip's own fire is dim: warm the coals and throw a few embers over it
      pxEllipse(cfg.fire.cx, cfg.fire.cy, cfg.fire.rx + 4, 6, hex("#ff9a2e", 0.10 + 0.12 * S.I));
      for (let i = 0; i < 5; i++) if (((S.frame * 7 + i * 13) % 11) < 4) px(cfg.fire.cx + ((i * 37 + S.frame * 3) % (cfg.fire.rx * 2)) - cfg.fire.rx, cfg.fire.cy - 6 - ((S.frame + i * 5) % 14), 1, 1, i % 2 ? "#ffe680" : "#ff9a2e");
    }
    if (cfg.candles && S.running) for (const [x, y] of cfg.candles) { const f = (S.frame >> 1) & 1; px(x, y - 1 - f, 1, 2 + f, "#ffe680"); px(x - 1, y + 1, 3, 2, "#ff9a2e"); }
    // glow above the cauldron: grows as the brew warms, gold once over the bar
    if (S.running && S.best > 0 && !cold()) {
      const p = clamp(S.best / Math.max(S.thr, 1), 0, 1), r = 8 + 14 * p;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(cfg.glow.cx, cfg.glow.cy, r * (1 - k * 0.28), r * 0.75 * (1 - k * 0.28), 0, 0, Math.PI * 2); g.fillStyle = hex(over() ? COL.gold : COL.potion, 0.07 + 0.03 * k); g.fill(); }
    }
    for (const p of S.smoke) px(p.x, p.y, p.s, p.s, hex(COL.smoke, 0.75 * (1 - p.age / p.life)));
    for (const p of S.burst) px(p.x, p.y, p.age < 3 ? 2 : 1, p.age < 3 ? 2 : 1, p.c);
    for (const p of S.shards) px(p.x, p.y, 1, 1, p.c);
    S.vials.forEach((v, i) => { if (i < cfg.rack.length) { const [x, y] = vialPos(i); drawVial(x, y, v); } });
    if (S.vials.length > cfg.rack.length) { const [x, y] = vialPos(cfg.rack.length - 1); px(x + 6, y - 4, 1, 1, COL.white); px(x + 8, y - 4, 1, 1, COL.white); px(x + 10, y - 4, 1, 1, COL.white); }
    // gauge: the climb of the best hash to the bar; full and gold once over it, no scale above the bar
    if (S.thr > 0 && (S.running || S.best > 0) && ready(ui.gauge) && ui.meta && ui.meta.gauge) {
      const G = ui.meta.gauge, gx = W - G.w - 3, gy = Math.max(4, Math.round((H - G.h) / 2)), F = G.fill, lo = S.thr - 6;
      const fx0 = gx + F.x0, fw = F.x1 - F.x0, top = gy + F.y0 + 3, bottom = gy + F.y1 - 1;
      const ypos = (v) => Math.round(bottom - (clamp(v, lo, S.thr) - lo) / (S.thr - lo) * (bottom - top - 8));
      g.drawImage(ui.gauge, gx, gy);
      if (S.best > lo) { const yb = ypos(S.best); px(fx0, yb, fw, bottom - yb, cold() ? COL.cold : over() ? COL.gold : COL.potion); px(fx0, yb, 1, bottom - yb, hex(COL.white, 0.35)); }
      const ybar = ypos(S.thr); px(gx + F.x0 - 3, ybar, fw + 6, 1, COL.white); px(gx + F.x0 - 5, ybar - 1, 2, 3, COL.white);
      if (over() && !cold() && (S.frame >> 1) & 1) { px(fx0 + (fw >> 1) - 1, ybar - 7, 3, 3, COL.gold2); px(fx0 + (fw >> 1), ybar - 9, 1, 1, COL.white); }
    } else if (S.thr > 0 && (S.running || S.best > 0)) {
      const x0 = W - 11, w = 5, y0 = 12, y1 = H - 12, lo = S.thr - 6;
      const ypos = (v) => Math.round(y1 - (clamp(v, lo, S.thr) - lo) / (S.thr - lo) * (y1 - y0 - 10));
      px(x0 - 1, y0 - 1, w + 2, y1 - y0 + 2, "#0b0d0f"); px(x0 - 1, y0 - 1, w + 2, 1, "#3a434c"); px(x0 - 1, y1, w + 2, 1, "#3a434c"); px(x0 - 1, y0, 1, y1 - y0, "#3a434c"); px(x0 + w, y0, 1, y1 - y0, "#3a434c");
      if (S.best > lo) { const yb = ypos(S.best); px(x0, yb, w, y1 - yb, cold() ? COL.cold : over() ? COL.gold : COL.potion); }
      const ybar = ypos(S.thr); px(x0 - 3, ybar, w + 6, 1, COL.white);
      if (over() && !cold() && (S.frame >> 1) & 1) { px(x0 + 1, ybar - 6, 3, 3, COL.gold2); px(x0 + 2, ybar - 8, 1, 1, COL.white); }
    }
    if (S.running && S.sessionSec) { px(0, 0, W, 3, "#0b0d0f"); px(0, 1, Math.round((S.sec / S.sessionSec) * W), 1, COL.gold); }
    const cap = now() < S.capUntil ? S.cap : !S.running ? (S.vials.length ? `${S.vials.length} sealed find${S.vials.length > 1 ? "s" : ""} on the rack · the fire is out` : "the fire is out") : S.thr <= 0 ? "waiting for the challenge…" : over() ? "over the bar · the brew is ready" : `brewing · ${fmtHs(S.rate)}`;
    if (hud.cap.textContent !== cap) hud.cap.textContent = cap;
    const bits = S.thr > 0 && (S.running || S.best > 0) ? `best ${S.best.toFixed(2)} / bar ${S.thr.toFixed(2)} bits` : "";
    if (hud.bits.textContent !== bits) hud.bits.textContent = bits;
    if (hud.bits.style.display !== (bits ? "block" : "none")) hud.bits.style.display = bits ? "block" : "none";
    if (hud.labels.innerHTML) hud.labels.innerHTML = "";
  };

  let last = 0;
  const loop = (t) => {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    if (t - last < 1000 / FPS) return;
    last = t;
    if (!reduce) update();
    draw();
  };
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- reveal card: the only place a tier is shown
  const showReveal = (d) => {
    const tier = d.tier || 1, col = TIER_COL[Math.min(tier, 6)] || TIER_COL[1];
    const card = document.createElement("div");
    card.className = `reveal t${tier}`;
    card.innerHTML = `<img class="px" src="metadata/${d.id}.png" alt=""><b>${d.label || ""}</b>`;
    el.appendChild(card);
    burstAt(cfg.glow.cx, cfg.glow.cy + 6, [COL.white, col, COL.gold2], tier >= 6 ? 40 : 26, tier >= 4 ? 2.8 : 2.2);
    setTimeout(() => { card.classList.add("out"); setTimeout(() => card.remove(), 500); }, 4200);
  };

  // ---------------------------------------------------------------- events
  document.addEventListener("alch:mining", (e) => {
    S.running = !!(e.detail && e.detail.running);
    if (S.running) { S.best = 0; say("lighting the fire…", 2500); } else { S.rate = 0; say("the fire is out", 3000); }
  });
  document.addEventListener("alch:stage", (e) => {
    const d = e.detail || {};
    switch (d.type) {
      case "minute": S.m = d.m; S.thr = d.thrQ8 / 256; S.best = 0; S.fizzleUntil = 0; break;
      case "best": { const b = d.wq8 / 256; const was = S.best; S.best = b; if (S.thr > 0 && b >= S.thr && was < S.thr) { burstAt(cfg.liquid.cx, cfg.liquid.cy - 2, [COL.white, COL.gold2], 10, 1.2); say("over the bar! the brew is ready", 2500); } break; }
      case "rate": if (S.demo && !d.demo) break; S.rate = d.rate || 0; S.running = !!d.running; S.sec = d.sec || 0; S.sessionSec = d.sessionSec || 60; S.chainNow = d.chainNow || 0;
        for (const v of S.vials) if (v.status === "sealed" && S.chainNow >= v.revealMinute * S.sessionSec + 3) v.status = "ready";
        break;
      case "skip":
        if (d.reason === "threshold") { S.fizzleUntil = now() + 5000; S.smokeFrames = 14; smokeAt(cfg.liquid.cx, cfg.liquid.cy - 2, 10); say(d.bits ? `the brew went cold: ${d.bits.toFixed(2)} of ${d.thr.toFixed(2)} bits` : "the brew went cold: nothing found", 5000); }
        else say(d.reason === "funds" ? "found, but no ETH for the submit" : d.reason === "price" ? "found, but the price is above your limit" : "found, but the previous submit is still pending", 6000);
        break;
      case "submit": burstAt(cfg.liquid.cx, cfg.liquid.cy - 2, [COL.white, COL.gold2, COL.potion], 24, 2.4); addVial(d.m, d.bits); say("found · sealing the vial…", 8000); break;
      case "submitted": { const v = S.vials.find((x) => x.m === d.m && x.status === "submitting"); if (v) { v.status = "sealed"; v.revealMinute = d.revealMinute || d.m + 2; v.sealedAt = now(); } say(`sealed · your next submit reveals it, or reveal by hand after minute ${d.revealMinute || d.m + 2}`, 7000); break; }
      case "submitfail": dropVial((x) => x.m === d.m, true); say("the submit did not go through", 6000); break;
      case "pending": { // the chain's list of sealed finds for this address: add what the scene missed (a reload, the standalone miner), drop what is gone
        if (S.demo) break;
        const finds = d.finds || [], t = now();
        for (const f of finds) { const v = S.vials.find((x) => x.m === f.m); if (v) { if (v.status !== "submitting") v.status = f.ready ? "ready" : "sealed"; v.revealMinute = f.revealMinute; } else S.vials.push({ m: f.m, bits: f.bits, status: f.ready ? "ready" : "sealed", revealMinute: f.revealMinute, rise: 1, sealedAt: t }); }
        S.vials = S.vials.filter((v) => v.status === "submitting" || finds.some((f) => f.m === v.m) || (v.sealedAt && t - v.sealedAt < 120000));
        S.vials.sort((a, b) => a.m - b.m);
        break;
      }
    }
  });
  // a revealed find: the vial that held it leaves the rack and reveal.js opens it in the middle of the room; the card in
  // the finds strip under the stage stays hidden until the find has gone to the shelf, so nothing spoils the reveal
  document.addEventListener("alch:loot", (e) => {
    const d = e.detail || {};
    let idx = S.vials.findIndex((x) => x.status === "ready"); if (idx < 0) idx = S.vials.findIndex((x) => x.status === "sealed");
    const pos = idx >= 0 ? vialPos(idx) : cfg.rack[0], was = idx >= 0 ? S.vials[idx].status : "ready";
    const tier = d.tier || 1, fancy = !!window.AlchReveal && !reduce && tier <= 5 && el.clientWidth >= 120;
    if (idx >= 0) dropVial((x, j) => j === idx, !fancy);
    say(`${d.via === "submit" ? "this submit revealed an earlier find" : "revealed"}: ${d.label || ""}`, 7000);
    const unhold = () => { if (d.el && d.el.classList.contains("held")) { d.el.classList.remove("held"); document.dispatchEvent(new CustomEvent("alch:shelf", { detail: d })); } };
    if (tier >= 6) { unhold(); return; } // a mythic key: its ceremony takes the whole page (reveal.js, on alch:key)
    if (!fancy) { showReveal(d); unhold(); return; }
    const words = String(d.label || "").split(" ");
    window.AlchReveal.find({ stage: el, grid: [W, H], from: pos, to: [cfg.glow.cx, cfg.glow.cy - 4], vialSrc: `img/stage-vial-${was === "sealed" ? "sealed" : "ready"}.png?v=${UI_VER}`, itemSrc: `metadata/${d.id}.png`, tier, tierName: d.tierName || words[0] || "", name: d.name || words.slice(1).join(" "), upgraded: !!d.upgraded, seed: (d.id || 1) * 7 + S.frame, onDone: unhold });
  });

  // ---------------------------------------------------------------- scripted round for review (?stagedemo=1)
  const ev = (type, d) => document.dispatchEvent(new CustomEvent("alch:stage", { detail: { type, ...d } }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.alchStage = { mode, demo: async () => {
    if (S.demo || S.running) return; // never over a real mining session
    S.demo = true; el.classList.add("demo"); // the real miner's rate ticks are ignored while the scripted round plays
    const stash = S.vials; S.vials = []; // the real rack is set aside and comes back after the round
    document.dispatchEvent(new CustomEvent("alch:mining", { detail: { running: true } }));
    // three compressed minutes, the real order of events: a find is sealed in minute m, minute m+1 misses the bar, and the
    // submit of minute m+2 reveals the find of minute m while sealing a new one
    let sec = 5; const rate = 1.8e9; const m = 1000;
    const tick = () => ev("rate", { rate, running: true, sec: (sec += 4) % 60, sessionSec: 60, chainNow: 0, demo: true });
    const timer = setInterval(tick, 1000); tick();
    await sleep(1500); ev("minute", { m, thrQ8: 30 * 256 });
    for (const b of [22.4, 25.1, 26.8, 28.3, 29.2, 29.7, 30.4, 31.6]) { await sleep(800); ev("best", { wq8: Math.round(b * 256) }); }
    await sleep(2000); ev("submit", { m, bits: 31.6 }); await sleep(2500); ev("submitted", { m, revealMinute: m + 2 });
    await sleep(3000); sec = 5; ev("minute", { m: m + 1, thrQ8: 30 * 256 });
    for (const b of [21.0, 24.4, 27.9, 29.4]) { await sleep(800); ev("best", { wq8: Math.round(b * 256) }); }
    await sleep(2000); ev("skip", { reason: "threshold", bits: 29.4, thr: 30 });
    await sleep(4000); sec = 5; ev("minute", { m: m + 2, thrQ8: 30 * 256 }); S.vials.forEach((v) => { v.status = "ready"; });
    for (const b of [23.9, 27.2, 29.1, 30.7]) { await sleep(800); ev("best", { wq8: Math.round(b * 256) }); }
    await sleep(2000); ev("submit", { m: m + 2, bits: 30.7 });
    await sleep(2500); document.dispatchEvent(new CustomEvent("alch:loot", { detail: { id: 205, tier: 4, label: "Epic Yew", via: "submit" } })); ev("submitted", { m: m + 2, revealMinute: m + 4 });
    await sleep(6500); clearInterval(timer); document.dispatchEvent(new CustomEvent("alch:mining", { detail: { running: false } })); S.vials = stash; S.thr = 0; S.best = 0; S.demo = false; el.classList.remove("demo");
  } };
  // the scripted round only ever starts from the button under the scene, never on page load
  const demoBtn = document.getElementById("stageDemo");
  if (demoBtn) demoBtn.onclick = () => window.alchStage.demo();
  // ?stagedev=1: a hand-driven frame for screenshots of any state (the render loop pauses in a hidden tab, so the
  // marketing shots set the state through `set` and pull a frame through `frame`; nothing is mined or signed)
  if (q.get("stagedev")) window.alchStage.dev = { S, cfg, set: (o) => Object.assign(S, o), step: (n = 1) => { for (let i = 0; i < n; i++) update(); }, frame: () => { draw(); return cv.toDataURL("image/png").split(",")[1]; }, smokeAt, burstAt, addVial };
})();
