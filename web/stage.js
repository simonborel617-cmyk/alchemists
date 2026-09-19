// Mining stage: a pixel scene of the brew that follows the browser miner. The fire burns with the hashrate, the liquid
// brightens as the best hash of the minute climbs towards the bar (and takes the tier colour above it), a find rises
// out of the cauldron as a sealed vial that waits on the rack until its reveal, a miss lets the brew go cold with a puff
// of smoke, and a reveal cracks the vial open and shows the ingredient. Everything is drawn on the background's own
// pixel grid (255 x 171 cells) at 12 frames per second, so it stays crisp pixel art.
//
// Input: `alch:stage` events from app.js ({type: minute|best|rate|skip|submit|submitted|submitfail, ...}),
// `alch:mining` ({running}) and `alch:loot` ({id, tier, label}). `?stagedemo=1` plays a scripted round, `?bg=N` picks
// a background for review.
(() => {
  const el = document.getElementById("stage");
  if (!el) return;
  const W = 255, H = 171, FPS = 12;
  const COL = { potion: "#35c9e8", gold: "#d9a21b", gold2: "#f2c455", white: "#fff9e6", smoke: "#6b7176", cold: "#3a3f44", glass: "#bfe9ff", cork: "#8a5a2b" };
  const TIER_STEP = [0, 2, 4, 7, 10]; // bits over the bar for Common .. Legendary
  const TIER_COL = ["#9aa0a4", "#3fae5a", "#3b7ddd", "#8e44d1", "#d9a21b", "#f2f2f2"];
  const TIER_NAME = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
  // anchors in grid cells: the liquid surface, the fire (particles die above `top`), the glow centre, the vial rack
  const BG = {
    1: { src: "img/stage-1.png", liquid: { cx: 126, cy: 77, rx: 19, ry: 5 }, fire: { cx: 126, cy: 130, rx: 22, top: 96 }, glow: { cx: 126, cy: 60 }, rack: [[196, 130], [207, 135], [218, 140], [229, 145]] },
    2: { src: "img/stage-2.png", liquid: { cx: 104, cy: 46, rx: 20, ry: 5 }, fire: { cx: 90, cy: 136, rx: 12, top: 112 }, glow: { cx: 104, cy: 30 }, rack: [[183, 90], [203, 90], [221, 92], [240, 100]] },
    3: { src: "img/stage-3.png", liquid: { cx: 126, cy: 58, rx: 25, ry: 6 }, fire: { cx: 126, cy: 120, rx: 30, top: 92 }, glow: { cx: 126, cy: 40 }, rack: [[200, 86], [211, 90], [222, 94], [233, 98], [244, 102]], candles: [[25, 62], [43, 80]] },
  };
  const q = new URLSearchParams(location.search);
  const cfg = BG[q.get("bg")] || BG[el.dataset.bg] || BG[1];
  const cv = el.querySelector("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  const hud = { cap: el.querySelector(".cap"), bits: el.querySelector(".bits"), labels: el.querySelector(".labels") };
  const bg = new Image();
  bg.src = cfg.src;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const S = {
    running: false, rate: 0, I: 0, thr: 0, best: 0, sec: 0, sessionSec: 60, chainNow: 0, m: 0,
    fizzleUntil: 0, smokeFrames: 0, cap: "", capUntil: 0, frame: 0, labelsFor: -1,
    vials: [], fire: [], bubbles: [], smoke: [], burst: [], shards: [], reveals: [],
  };
  const now = () => performance.now();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const band = (over) => { let t = 0; for (let i = 0; i < 5; i++) if (over >= TIER_STEP[i]) t = i; return t; };
  const intensity = (rate) => (rate > 0 ? clamp((Math.log10(rate) - 5) / 4.5, 0.15, 1) : 0);
  const fmtHs = (h) => (h >= 1e9 ? `${(h / 1e9).toFixed(2)} GH/s` : h >= 1e6 ? `${(h / 1e6).toFixed(1)} MH/s` : `${(h / 1e3).toFixed(0)} kH/s`);
  const say = (msg, ms) => { S.cap = msg; S.capUntil = now() + (ms || 4000); };
  const hex = (c, a) => { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const lerp = (a, b, t) => { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * t); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };

  // ---------------------------------------------------------------- colours of the brew
  const overBar = () => S.best - S.thr;
  const liquidColor = () => {
    if (now() < S.fizzleUntil) return COL.cold;
    if (S.thr <= 0) return null;
    if (S.best >= S.thr) return TIER_COL[band(overBar())];
    const p = clamp(S.best / S.thr, 0, 1);
    return lerp("#17303a", COL.potion, Math.pow(p, 3));
  };

  // ---------------------------------------------------------------- particles
  const spawnFire = () => {
    const n = Math.floor(S.I * 5 + (Math.random() < S.I * 3 % 1 ? 1 : 0));
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
  const vialPos = (i) => cfg.rack[Math.min(i, cfg.rack.length - 1)];
  const addVial = (m, bits) => { S.vials.push({ m, bits, status: "submitting", tier: band(bits - S.thr), revealMinute: m + 2, rise: 0 }); };
  const dropVial = (pred, shatter) => {
    const i = S.vials.findIndex(pred);
    if (i < 0) return null;
    const v = S.vials.splice(i, 1)[0];
    if (shatter) { const [x, y] = vialPos(i); shatterAt(x, y, TIER_COL[v.tier]); }
    return v;
  };
  const drawVial = (x, y, v, i) => {
    // a 7x11 sprite standing on (x, y); while it rises from the cauldron its position is interpolated along an arc
    if (v.rise < 1) { const [lx, ly] = [cfg.liquid.cx, cfg.liquid.cy - 4]; x = Math.round(lx + (x - lx) * v.rise); y = Math.round(ly + (y - ly) * v.rise - Math.sin(v.rise * Math.PI) * 20); }
    const blink = (S.frame >> 2) & 1;
    const fill = v.status === "submitting" ? (blink ? "#c9c4b6" : "#5b6166") : v.status === "ready" ? (blink ? COL.white : COL.potion) : TIER_COL[v.tier];
    if (v.status === "ready" && !blink) { g.fillStyle = hex(COL.potion, 0.3); g.fillRect(x - 5, y - 13, 11, 15); }
    g.fillStyle = COL.cork; g.fillRect(x - 1, y - 11, 3, 2);
    g.fillStyle = "#1c2126"; g.fillRect(x - 2, y - 9, 5, 2);
    g.fillStyle = COL.glass; g.fillRect(x - 1, y - 9, 3, 2); g.fillRect(x - 3, y - 7, 7, 7);
    g.fillStyle = "#1c2126"; g.fillRect(x - 2, y - 6, 5, 5);
    const lvl = v.status === "submitting" ? 2 : 3;
    g.fillStyle = fill; g.fillRect(x - 2, y - 1 - lvl, 5, lvl);
    g.fillStyle = hex(COL.white, 0.5); g.fillRect(x - 2, y - 6, 1, 3);
  };

  // ---------------------------------------------------------------- frame
  const update = () => {
    S.frame++;
    const target = S.running ? intensity(S.rate) : 0;
    S.I += (target - S.I) * 0.2;
    if (S.I < 0.02) S.I = 0;
    if (S.I > 0) spawnFire();
    step(S.fire, (p) => { p.x += p.vx + rnd(-0.2, 0.2); p.y += p.vy; if (p.y < cfg.fire.top) p.age = p.life; });
    if (S.running && S.I > 0 && Math.random() < 0.12 + S.I * 0.55) {
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

  const ellipse = (cx, cy, rx, ry) => { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.closePath(); };
  const draw = () => {
    g.clearRect(0, 0, W, H);
    if (bg.complete && bg.naturalWidth) g.drawImage(bg, 0, 0, W, H);
    // the brew
    const lc = liquidColor();
    const brewing = S.running || now() < S.fizzleUntil;
    if (lc && brewing) {
      ellipse(cfg.liquid.cx, cfg.liquid.cy, cfg.liquid.rx, cfg.liquid.ry); g.fillStyle = hex(lc.startsWith("#") ? lc : "#35c9e8", 0.55); if (!lc.startsWith("#")) g.fillStyle = lc.replace("rgb(", "rgba(").replace(")", ",0.55)"); g.fill();
      for (const b of S.bubbles) { g.fillStyle = hex(COL.white, 0.7); g.fillRect(b.x, b.y, 1, 1); if (b.big && b.age < b.life - 1) { g.fillRect(b.x - 1, b.y, 1, 1); g.fillRect(b.x + 1, b.y, 1, 1); g.fillRect(b.x, b.y - 1, 1, 1); } }
    }
    // coals and fire
    if (S.I > 0) {
      for (let i = 0; i < 7; i++) { const x = cfg.fire.cx - cfg.fire.rx + Math.round((i + 0.5) * (cfg.fire.rx * 2) / 7); g.fillStyle = hex((S.frame + i) % 3 ? "#ff9a2e" : "#ffe680", 0.25 + 0.45 * S.I * Math.random()); g.fillRect(x, cfg.fire.cy - 1 + ((i * 7 + S.frame) % 3), 2, 1); }
      for (const p of S.fire) { g.fillStyle = fireColor(p.age / p.life); g.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); }
    }
    if (cfg.candles && S.running) for (const [x, y] of cfg.candles) { const f = (S.frame >> 1) & 1; g.fillStyle = "#ffe680"; g.fillRect(x, y - 1 - f, 1, 2 + f); g.fillStyle = "#ff9a2e"; g.fillRect(x - 1, y + 1, 3, 2); }
    // glow above the cauldron
    if (lc && S.running && S.best > 0 && now() >= S.fizzleUntil) {
      const p = clamp(S.best / Math.max(S.thr, 1), 0, 1.3), r = 8 + 16 * p;
      const c = lc.startsWith("#") ? lc : "#35c9e8";
      for (let k = 0; k < 3; k++) { ellipse(cfg.glow.cx, cfg.glow.cy, r * (1 - k * 0.28), r * 0.75 * (1 - k * 0.28)); g.fillStyle = hex(c, 0.07 + 0.03 * k); g.fill(); }
    }
    for (const p of S.smoke) { g.fillStyle = hex(COL.smoke, 0.75 * (1 - p.age / p.life)); g.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); }
    for (const p of S.burst) { g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), p.age < 3 ? 2 : 1, p.age < 3 ? 2 : 1); }
    for (const p of S.shards) { g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    // vials on the rack
    S.vials.forEach((v, i) => { if (i < cfg.rack.length) { const [x, y] = vialPos(i); drawVial(x, y, v, i); } });
    if (S.vials.length > cfg.rack.length) { const [x, y] = vialPos(cfg.rack.length - 1); g.fillStyle = COL.white; g.fillRect(x + 6, y - 4, 1, 1); g.fillRect(x + 8, y - 4, 1, 1); g.fillRect(x + 10, y - 4, 1, 1); }
    // gauge: 18 bits around the bar, tier steps marked
    if (S.thr > 0 && (S.running || S.best > 0)) {
      const x0 = W - 11, w = 5, y0 = 12, y1 = H - 12, lo = S.thr - 6, hi = S.thr + 12;
      const ypos = (v) => Math.round(y1 - ((clamp(v, lo, hi) - lo) / (hi - lo)) * (y1 - y0));
      g.fillStyle = "#0b0d0f"; g.fillRect(x0 - 1, y0 - 1, w + 2, y1 - y0 + 2);
      g.fillStyle = "#3a434c"; g.fillRect(x0 - 1, y0 - 1, w + 2, 1); g.fillRect(x0 - 1, y1, w + 2, 1); g.fillRect(x0 - 1, y0, 1, y1 - y0); g.fillRect(x0 + w, y0, 1, y1 - y0);
      if (S.best > lo) { const yb = ypos(S.best); g.fillStyle = S.best >= S.thr ? TIER_COL[band(overBar())] : "#5b6166"; g.fillRect(x0, yb, w, y1 - yb); }
      for (let t = 0; t < 5; t++) { const y = ypos(S.thr + TIER_STEP[t]); g.fillStyle = t === 0 ? COL.white : TIER_COL[t]; g.fillRect(x0 - 3, y, w + 6, 1); }
    }
    // minute bar
    if (S.running && S.sessionSec) { g.fillStyle = "#0b0d0f"; g.fillRect(0, 0, W, 3); g.fillStyle = COL.gold; g.fillRect(0, 1, Math.round((S.sec / S.sessionSec) * W), 1); }
    // text
    const cap = now() < S.capUntil ? S.cap : !S.running ? (S.vials.length ? `${S.vials.length} sealed find${S.vials.length > 1 ? "s" : ""} on the rack · the fire is out` : "the fire is out") : S.thr <= 0 ? "waiting for the challenge…" : S.best >= S.thr ? `over the bar by ${overBar().toFixed(2)} bits · ${TIER_NAME[band(overBar())]}` : `brewing · ${fmtHs(S.rate)}`;
    if (hud.cap.textContent !== cap) hud.cap.textContent = cap;
    const bits = S.thr > 0 && (S.running || S.best > 0) ? `best ${S.best.toFixed(2)} / bar ${S.thr.toFixed(2)} bits` : "";
    if (hud.bits.textContent !== bits) hud.bits.textContent = bits;
    if (hud.bits.style.display !== (bits ? "block" : "none")) hud.bits.style.display = bits ? "block" : "none";
    if (S.labelsFor !== S.thr) {
      S.labelsFor = S.thr;
      const lo = S.thr - 6, hi = S.thr + 12, y0 = 12, y1 = H - 12;
      hud.labels.innerHTML = S.thr > 0 ? ["bar", "U", "R", "E", "L"].map((l, t) => { const y = y1 - ((S.thr + TIER_STEP[t] - lo) / (hi - lo)) * (y1 - y0); return `<span class="gl" style="bottom:${((H - y) / H * 100).toFixed(1)}%;color:${t ? TIER_COL[t] : "#fff9e6"}">${l}</span>`; }).join("") : "";
      hud.labels.style.display = S.thr > 0 && (S.running || S.best > 0) ? "block" : "none";
    }
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

  // ---------------------------------------------------------------- reveal card
  const showReveal = (d) => {
    const tier = d.tier || 0, col = TIER_COL[Math.min(tier - 1, 5)] || TIER_COL[0];
    const card = document.createElement("div");
    card.className = `reveal t${tier}`;
    card.innerHTML = `<img class="px" src="metadata/${d.id}.png" alt=""><b>${d.label || TIER_NAME[tier - 1] || ""}</b>`;
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
      case "best": { const b = d.wq8 / 256; const was = S.best; S.best = b; if (S.thr > 0 && b >= S.thr && was < S.thr) { burstAt(cfg.liquid.cx, cfg.liquid.cy - 2, [COL.white, COL.gold2], 10, 1.2); say(`over the bar! ${b.toFixed(2)} bits`, 2500); } break; }
      case "rate": if (S.demo && !d.demo) break; S.rate = d.rate || 0; S.running = !!d.running; S.sec = d.sec || 0; S.sessionSec = d.sessionSec || 60; S.chainNow = d.chainNow || 0;
        for (const v of S.vials) if (v.status === "sealed" && S.chainNow >= v.revealMinute * S.sessionSec + 3) v.status = "ready";
        break;
      case "skip":
        if (d.reason === "threshold") { S.fizzleUntil = now() + 5000; S.smokeFrames = 14; smokeAt(cfg.liquid.cx, cfg.liquid.cy - 2, 10); say(d.bits ? `the brew went cold: ${d.bits.toFixed(2)} of ${d.thr.toFixed(2)} bits` : "the brew went cold: nothing found", 5000); }
        else say(d.reason === "funds" ? "found, but no ETH for the submit" : d.reason === "price" ? "found, but the price is above your limit" : "found, but the previous submit is still pending", 6000);
        break;
      case "submit": burstAt(cfg.liquid.cx, cfg.liquid.cy - 2, [COL.white, COL.gold2, COL.potion], 24, 2.4); addVial(d.m, d.bits); say(`found ${d.bits.toFixed(2)} bits · sealing the vial…`, 8000); break;
      case "submitted": { const v = S.vials.find((x) => x.m === d.m && x.status === "submitting"); if (v) { v.status = "sealed"; v.revealMinute = d.revealMinute || d.m + 2; } say(`sealed · reveal after minute ${d.revealMinute || d.m + 2}`, 6000); break; }
      case "submitfail": dropVial((x) => x.m === d.m, true); say("the submit did not go through", 6000); break;
    }
  });
  document.addEventListener("alch:loot", (e) => {
    const d = e.detail || {};
    dropVial((x) => x.status === "ready", true) || dropVial((x) => x.status === "sealed", true);
    showReveal(d);
    say(`revealed: ${d.label || ""}`, 6000);
  });

  // ---------------------------------------------------------------- scripted round for review (?stagedemo=1)
  const ev = (type, d) => document.dispatchEvent(new CustomEvent("alch:stage", { detail: { type, ...d } }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.alchStage = { demo: async () => {
    S.demo = true; // the real miner's rate ticks are ignored while the scripted round plays
    document.dispatchEvent(new CustomEvent("alch:mining", { detail: { running: true } }));
    let sec = 5; const rate = 1.8e9; const m = 1000;
    const tick = () => ev("rate", { rate, running: true, sec: sec++ % 60, sessionSec: 60, chainNow: 0, demo: true });
    const timer = setInterval(tick, 1000); tick();
    await sleep(1500); ev("minute", { m, thrQ8: 30 * 256 });
    for (const b of [22.4, 25.1, 26.8, 28.3, 29.2, 29.7, 30.4, 31.6]) { await sleep(900); ev("best", { wq8: Math.round(b * 256) }); }
    await sleep(2500); ev("submit", { m, bits: 31.6 }); await sleep(2500); ev("submitted", { m, revealMinute: m + 2 });
    await sleep(2500); ev("minute", { m: m + 1, thrQ8: 30 * 256 });
    for (const b of [21.0, 24.4, 27.9, 29.4]) { await sleep(900); ev("best", { wq8: Math.round(b * 256) }); }
    await sleep(2000); ev("skip", { reason: "threshold", bits: 29.4, thr: 30 });
    await sleep(3500); S.vials.forEach((v) => { v.status = "ready"; });
    await sleep(2500); document.dispatchEvent(new CustomEvent("alch:loot", { detail: { id: 205, tier: 4, label: "Epic Yew" } }));
    await sleep(6000); clearInterval(timer); document.dispatchEvent(new CustomEvent("alch:mining", { detail: { running: false } })); S.demo = false;
  } };
  if (q.get("stagedemo")) setTimeout(() => window.alchStage.demo(), 1500);
})();
