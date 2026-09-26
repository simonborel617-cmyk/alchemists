// Visual effects for the mine: pixel embers rising from the hero cauldron, sparkles on new loot, a flash on a mythic key.
// Everything is decorative and stays off when the user prefers reduced motion or the tab is hidden.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- in sight or not, for the loops that pause off screen (here, stage.js, workshop.js, nav.js):
  //   AlchInView(el, fn) -> fn(inSight) once and on every change
  // The sticky header covers the top of the window, so the watched area starts under it (a phone scrolls the header
  // away and the whole window counts); the observer is rebuilt when the header changes height (a wrapped row, the web
  // font arriving, the phone layout).
  window.AlchInView = (() => {
    if (!window.IntersectionObserver) return (el, fn) => setTimeout(() => fn(true));
    const header = document.querySelector("header"), subs = new Map();
    let io = null, cover = -1;
    const build = () => {
      const c = header && getComputedStyle(header).position === "sticky" ? header.offsetHeight : 0;
      if (c === cover) return;
      cover = c;
      if (io) io.disconnect();
      io = new IntersectionObserver((es) => { for (const e of es) for (const fn of subs.get(e.target) || []) fn(e.isIntersecting); }, { rootMargin: `${-c}px 0px 0px 0px` });
      for (const el of subs.keys()) io.observe(el);
    };
    build();
    if (header && window.ResizeObserver) new ResizeObserver(build).observe(header);
    addEventListener("resize", build);
    return (el, fn) => { subs.set(el, [...(subs.get(el) || []), fn]); io.unobserve(el); io.observe(el); };
  })();

  // --- embers over the hero art
  const art = document.querySelector(".hero .art");
  if (art && !reduce) {
    const c = document.createElement("canvas");
    c.className = "fx";
    art.appendChild(c);
    const ctx = c.getContext("2d");
    // The fire sits at a fixed point of the banner image (hero-sigil.webp, 1344x752): x 0.636, y 0.905. The CSS background is
    // `cover` positioned `center 88%`, so we replay that geometry to find where the fire lands in the box at any size.
    const IMG_W = 1344, IMG_H = 752, FIRE_X = 0.687, FIRE_Y = 0.90, POS_X = 0.5, POS_Y = 0.88; // measured on the flame pixels
    let W = 0, H = 0, fx = 0, fy = 0, unit = 1;
    const resize = () => {
      W = c.width = Math.max(1, art.clientWidth); H = c.height = Math.max(1, art.clientHeight);
      const scale = Math.max(W / IMG_W, H / IMG_H);
      const dw = IMG_W * scale, dh = IMG_H * scale;
      const ox = (W - dw) * POS_X, oy = (H - dh) * POS_Y;
      fx = ox + FIRE_X * dw; fy = oy + FIRE_Y * dh; unit = dw / IMG_W; // unit = box px per image px
    };
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(art); else addEventListener("resize", resize);
    const COLORS = ["#f2c455", "#c8742e", "#e9e4d6", "#f2c455", "#f2c455", "#3fae5a"];
    const spawn = (p) => Object.assign(p, {
      x: fx + (Math.random() - 0.5) * 34 * unit, y: fy - Math.random() * 18 * unit,
      vy: -(0.25 + Math.random() * 0.55) * unit, vx: (Math.random() - 0.5) * 0.3 * unit, life: 0.5 + Math.random() * 0.6,
      size: Math.max(2, Math.round((2 + Math.random() * 2) * unit)), col: COLORS[Math.floor(Math.random() * COLORS.length)], seed: Math.random() * 10,
    });
    const P = [];
    for (let i = 0; i < 26; i++) { const p = spawn({}); p.life = Math.random(); P.push(p); }
    // the loop runs only while the hero is on screen and the tab is shown; the observer and a returning tab restart it
    let last = 0, seen = true, raf = 0;
    const frame = (t) => {
      raf = 0;
      if (document.hidden || !seen) return;
      raf = requestAnimationFrame(frame);
      if (t - last < 45) return;
      last = t;
      ctx.clearRect(0, 0, W, H);
      // flickering fire glow, drawn here so it always sits on the fire whatever the box size
      const r = (150 + Math.sin(t / 90) * 8 + Math.sin(t / 37) * 6) * unit;
      const g = ctx.createRadialGradient(fx, fy - 6 * unit, 0, fx, fy - 6 * unit, r);
      g.addColorStop(0, "rgba(242,196,85,0.30)"); g.addColorStop(0.45, "rgba(200,116,46,0.10)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(fx - r, fy - r, 2 * r, 2 * r);
      for (const p of P) {
        p.x += p.vx + Math.sin(t / 700 + p.seed) * 0.2 * unit;
        p.y += p.vy;
        p.life -= 0.006;
        if (p.life <= 0 || p.y < fy - 150 * unit) spawn(p);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * 0.85;
        ctx.fillStyle = p.col;
        const s = p.size;
        ctx.fillRect(Math.round(p.x / s) * s, Math.round(p.y / s) * s, s, s);
      }
      ctx.globalAlpha = 1;
    };
    const wake = () => { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(frame); };
    AlchInView(art, (v) => { seen = v; wake(); });
    document.addEventListener("visibilitychange", wake);
    wake();
  }

  // --- sparkles on new loot cards
  // (a card held back while its reveal plays on the stage sparkles when it lands, on alch:shelf)
  const sparkle = (card) => {
    if (!card || reduce) return;
    card.classList.add("new");
    for (let i = 0; i < 10; i++) {
      const s = document.createElement("i");
      s.className = "spark";
      const a = (i / 10) * Math.PI * 2, r = 26 + Math.random() * 22;
      s.style.setProperty("--dx", `${Math.round(Math.cos(a) * r)}px`);
      s.style.setProperty("--dy", `${Math.round(Math.sin(a) * r)}px`);
      s.style.background = ["#f2c455", "#35c9e8", "#e9e4d6"][i % 3];
      card.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  };
  document.addEventListener("alch:loot", (e) => { const card = e.detail && e.detail.el; if (card && !card.classList.contains("held")) sparkle(card); });
  document.addEventListener("alch:shelf", (e) => sparkle(e.detail && e.detail.el));

  // --- a mythic key: its ceremony over the whole page (reveal.js); the tab title calls the player back to a hidden tab
  let baseTitle = null;
  document.addEventListener("alch:key", (e) => {
    const d = e.detail || {};
    if (baseTitle === null) baseTitle = document.title;
    document.title = "✦ MYTHIC KEY ✦";
    const restore = () => setTimeout(() => { if (baseTitle !== null) { document.title = baseTitle; baseTitle = null; } }, 6000);
    if (document.hidden) { const f = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", f); restore(); } }; document.addEventListener("visibilitychange", f); } else restore();
    if (window.AlchReveal && d.src) { window.AlchReveal.key(d); return; }
    if (!reduce) { const f = document.createElement("div"); f.className = "flash"; document.body.appendChild(f); setTimeout(() => f.remove(), 1400); }
  });

  // --- mining state on the panel
  document.addEventListener("alch:mining", (e) => { const bm = document.getElementById("bm"); if (bm) bm.classList.toggle("mining", !!(e.detail && e.detail.running)); });
})();
