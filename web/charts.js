// Small canvas charts for the network panel: a time axis, lines (optionally stepped, on a log scale), a filled area
// under the main line, horizontal bands (the difficulty corridor), bars along the bottom (finds per window), and a
// crosshair with the values under the pointer. Drawn at the device pixel ratio so the text stays sharp.
window.AlchChart = (() => {
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";
  const rgba = (hex, a) => { const n = parseInt(hex.replace("#", ""), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const clock = (t) => { const d = new Date(t * 1000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const charts = new WeakMap();

  // o: { x0, x1 (unix s), y0, y1, log, yfmt(v), xfmt(t), series: [{ pts: [[t, v]], color, width, step, area, name, fmt }],
  //      bands: [{ y, color, label }], bars: { pts: [[t, v]], max, color, name, fmt }, empty: "text when there is nothing" }
  function draw(cv, o, hover) {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1)), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const L = 58, R = 10, T = 10, B = 22, iw = W - L - R, ih = H - T - B, mono = `11px "IBM Plex Mono", monospace`;
    const muted = css("--muted"), line = css("--bevel-lo"), ink = css("--ink2");
    const ty = (v) => { if (o.log) { const a = Math.log10(Math.max(o.y0, 1e-9)), b = Math.log10(o.y1); return T + ih - ((Math.log10(Math.max(v, o.y0)) - a) / (b - a)) * ih; } return T + ih - ((v - o.y0) / (o.y1 - o.y0 || 1)) * ih; };
    const tx = (t) => L + ((t - o.x0) / (o.x1 - o.x0 || 1)) * iw;
    // grid: four rows with their values, time ticks every few hours
    // an empty chart keeps its grid but no values: numbers on an axis with nothing on it only confuse
    const any = (o.series || []).some((s) => s.pts.length > 1 && s.pts.some((p) => p[1] > (o.log ? o.y0 : -Infinity)));
    g.font = mono; g.textBaseline = "middle"; g.lineWidth = 1;
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const f = i / rows, v = o.log ? Math.pow(10, Math.log10(Math.max(o.y0, 1e-9)) + f * (Math.log10(o.y1) - Math.log10(Math.max(o.y0, 1e-9)))) : o.y0 + f * (o.y1 - o.y0), y = Math.round(ty(v)) + 0.5;
      g.strokeStyle = line; g.beginPath(); g.moveTo(L, y); g.lineTo(L + iw, y); g.stroke();
      if (any) { g.fillStyle = muted; g.textAlign = "right"; g.fillText(o.yfmt ? o.yfmt(v) : v.toFixed(1), L - 6, y); }
    }
    // time ticks: the shortest step in hours that leaves a label at least 52 px of room
    const span = o.x1 - o.x0, stepH = [1, 2, 3, 4, 6, 8, 12, 24].find((h) => iw / Math.max(1, span / (h * 3600)) >= 52) || 24;
    g.textAlign = "center"; g.textBaseline = "top";
    for (let t = Math.ceil(o.x0 / (stepH * 3600)) * stepH * 3600; t <= o.x1; t += stepH * 3600) { const x = Math.round(tx(t)) + 0.5; g.strokeStyle = line; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ih); g.stroke(); g.fillStyle = muted; g.fillText((o.xfmt || clock)(t), x, T + ih + 5); }
    // bars along the bottom: a quarter of the height, their own scale
    if (o.bars && o.bars.pts.length) {
      const bh = ih * 0.25, bw = Math.max(1, (iw / Math.max(1, (o.x1 - o.x0) / (o.bars.every || 120))) * 0.7), mx = o.bars.max || Math.max(1, ...o.bars.pts.map((p) => p[1]));
      g.fillStyle = rgba(o.bars.color, 0.38);
      for (const [t, v] of o.bars.pts) { if (!v) continue; const h = Math.min(1, v / mx) * bh; g.fillRect(tx(t) - bw / 2, T + ih - h, bw, h); }
      // bars past the scale are cut at the top and marked with a bright cap
      g.fillStyle = o.bars.color; for (const [t, v] of o.bars.pts) if (v > mx) g.fillRect(tx(t) - bw / 2, T + ih - bh - 1, bw, 2);
    }
    // bands (the corridor of the difficulty), over the bars, only those inside the frame; the label sits on a dark plate at the right
    const lo = Math.min(o.y0, o.y1), hi = Math.max(o.y0, o.y1);
    for (const b of o.bands || []) {
      if (b.y < lo || b.y > hi) continue;
      const y = Math.round(ty(b.y)) + 0.5; g.strokeStyle = rgba(b.color, 0.7); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(L, y); g.lineTo(L + iw, y); g.stroke(); g.setLineDash([]);
      if (b.label) { g.font = mono; const w = g.measureText(b.label).width + 8, above = y - T > 18, ly = above ? y - 16 : y + 2; g.fillStyle = "rgba(11,13,15,.85)"; g.fillRect(L + iw - w - 2, ly, w, 14); g.fillStyle = rgba(b.color, 0.95); g.textAlign = "right"; g.textBaseline = "top"; g.fillText(b.label, L + iw - 6, ly + 2); }
    }
    if (!any) { const msg = o.empty || "no data yet"; g.font = `12px "IBM Plex Mono", monospace`; const mw = g.measureText(msg).width + 20; g.fillStyle = "rgba(11,13,15,.92)"; g.fillRect(L + iw / 2 - mw / 2, T + ih / 2 - 12, mw, 24); g.fillStyle = muted; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(msg, L + iw / 2, T + ih / 2); charts.set(cv, { o, tx, ty, L, iw, T, ih }); return; }
    // lines: a soft glow under a crisp line, an area under the main one
    for (const s of o.series || []) {
      if (s.pts.length < 2) continue;
      const path = () => { g.beginPath(); s.pts.forEach(([t, v], i) => { const x = tx(t), y = ty(v); if (!i) g.moveTo(x, y); else if (s.step) { g.lineTo(x, ty(s.pts[i - 1][1])); g.lineTo(x, y); } else g.lineTo(x, y); }); };
      if (s.area) { path(); g.lineTo(tx(s.pts[s.pts.length - 1][0]), T + ih); g.lineTo(tx(s.pts[0][0]), T + ih); g.closePath(); const gr = g.createLinearGradient(0, T, 0, T + ih); gr.addColorStop(0, rgba(s.color, 0.28)); gr.addColorStop(1, rgba(s.color, 0)); g.fillStyle = gr; g.fill(); }
      path(); g.lineJoin = "round"; g.strokeStyle = rgba(s.color, s.faint ? 0.25 : 0.22); g.lineWidth = (s.width || 2) + (s.faint ? 0 : 4); g.stroke();
      path(); g.strokeStyle = rgba(s.color, s.faint ? 0.45 : 1); g.lineWidth = s.width || 2; g.stroke();
    }
    // the last value, a dot at the end of the main line
    const main = (o.series || []).find((s) => !s.faint && s.pts.length);
    if (main) { const [t, v] = main.pts[main.pts.length - 1], x = tx(t), y = ty(v); g.fillStyle = main.color; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); g.strokeStyle = rgba(main.color, 0.35); g.lineWidth = 6; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke(); }
    // the crosshair and the values at the pointer
    if (hover) {
      const t = o.x0 + ((hover.x - L) / iw) * (o.x1 - o.x0);
      if (t >= o.x0 && t <= o.x1) {
        const x = Math.round(tx(t)) + 0.5; g.strokeStyle = rgba(ink.startsWith("#") ? ink : "#c9c4b6", 0.5); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ih); g.stroke();
        const lines = [(o.xfmt || clock)(t)];
        const near = (pts) => { let best = null, bd = Infinity; for (const p of pts) { const d = Math.abs(p[0] - t); if (d < bd) { bd = d; best = p; } } return best; };
        for (const s of o.series || []) { const p = near(s.pts); if (p && s.name) { lines.push(`${s.name} ${s.fmt ? s.fmt(p[1]) : p[1]}`); if (!s.faint) { g.fillStyle = s.color; g.beginPath(); g.arc(tx(p[0]), ty(p[1]), 3, 0, Math.PI * 2); g.fill(); } } }
        if (o.bars) { const p = near(o.bars.pts); if (p && o.bars.name) lines.push(`${o.bars.name} ${o.bars.fmt ? o.bars.fmt(p[1]) : p[1]}`); }
        g.font = mono; const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 14, h = lines.length * 15 + 8;
        let bx = x + 10; if (bx + w > L + iw) bx = x - 10 - w; const by = T + 4;
        g.fillStyle = "rgba(11,13,15,.92)"; g.fillRect(bx, by, w, h); g.strokeStyle = css("--bevel-hi"); g.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
        g.textAlign = "left"; g.textBaseline = "top"; lines.forEach((l, i) => { g.fillStyle = i ? ink : muted; g.fillText(l, bx + 7, by + 5 + i * 15); });
      }
    }
    charts.set(cv, { o, tx, ty, L, iw, T, ih });
  }
  function set(cv, o) {
    const known = charts.get(cv); charts.set(cv, { ...(known || {}), o }); draw(cv, o);
    if (!cv.dataset.wired) {
      cv.dataset.wired = "1";
      const move = (e) => { const c = charts.get(cv); if (!c) return; const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; draw(cv, c.o, { x }); };
      cv.addEventListener("mousemove", move); cv.addEventListener("touchmove", move, { passive: true });
      cv.addEventListener("mouseleave", () => { const c = charts.get(cv); if (c) draw(cv, c.o); });
      if (window.ResizeObserver) new ResizeObserver(() => { const c = charts.get(cv); if (c) draw(cv, c.o); }).observe(cv);
    }
  }
  return { set };
})();
