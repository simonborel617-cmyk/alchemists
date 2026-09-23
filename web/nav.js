// The section bar: a row under the header on wide screens, a tab bar at the bottom on phones. It marks the section in
// view, scrolls smoothly to the one clicked, and carries three live marks read from the page itself (no ties to
// app.js): the miner running, finds waiting for their reveal, a craft ready to reveal in the workshop.
(function () {
  const nav = document.getElementById("secnav");
  if (!nav) return;
  const header = document.querySelector("header"), row = nav.querySelector(".wrap");
  const links = [...nav.querySelectorAll("a[data-s]")], targets = links.map((a) => document.getElementById(a.dataset.s));
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // how much of the top the sticky header covers (none on a phone, where the header scrolls away)
  const cover = () => (getComputedStyle(header).position === "sticky" ? header.offsetHeight : 0);
  const setOffset = () => document.documentElement.style.setProperty("--navoff", cover() + 12 + "px");

  let active = -1, pinned = -1;
  function mark(k) {
    if (k === active) return;
    active = k;
    links.forEach((a, i) => { a.classList.toggle("on", i === k); if (i === k) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    // keep the marked tab in sight when the row scrolls sideways
    const a = links[k];
    if (a && row.scrollWidth > row.clientWidth) { const l = a.offsetLeft, r = l + a.offsetWidth; if (l < row.scrollLeft + 8 || r > row.scrollLeft + row.clientWidth - 8) row.scrollTo({ left: Math.max(0, l - 24), behavior: reduce ? "auto" : "smooth" }); }
  }
  function spy() {
    const line = cover() + Math.min(180, innerHeight * 0.3), shown = links.map((a) => a.offsetParent !== null);
    let k = -1, top = -Infinity;
    targets.forEach((t, i) => {
      if (!t || !shown[i]) return;
      const y = t.getBoundingClientRect().top;
      // two panels side by side share a row: the first of them speaks for it
      if (y <= line && y > top + 4) { k = i; top = y; }
    });
    // at the very bottom the last section is the one in view, however short it is
    // (the first panel of the last row, as above)
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) {
      const at = (i) => targets[i].getBoundingClientRect().top;
      let j = links.length - 1; while (j >= 0 && !(shown[j] && targets[j])) j--;
      while (j > 0 && shown[j - 1] && targets[j - 1] && Math.abs(at(j - 1) - at(j)) <= 4) j--;
      if (j >= 0 && at(j) > top + 4) k = j;
    }
    // a click on the second panel of a row keeps that tab lit while the row is the one in view
    if (pinned >= 0) { const p = targets[pinned]; if (k >= 0 && p && Math.abs(p.getBoundingClientRect().top - targets[k].getBoundingClientRect().top) <= 4) k = pinned; else if (k !== pinned) pinned = -1; }
    mark(k);
  }
  let queued = false;
  const onScroll = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; spy(); }, 60); };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => { setOffset(); spy(); });
  if (window.ResizeObserver) new ResizeObserver(() => { setOffset(); spy(); }).observe(header);

  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-s]"); if (!a) return;
    const i = links.indexOf(a), t = targets[i]; if (!t) return;
    e.preventDefault();
    setOffset(); pinned = i; mark(i);
    t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", "#" + a.dataset.s);
    settle(t);
  });
  // panels above can still grow while the page loads (data, images), so a smooth scroll may stop short or overshoot;
  // once it is over, a target that is not where it should be is put there at once (twice at most)
  let settling = 0;
  function settle(t, tries = 2) {
    const id = ++settling;
    const check = () => {
      if (id !== settling) return;
      const want = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navoff")) || 0, top = t.getBoundingClientRect().top;
      const room = document.documentElement.scrollHeight - innerHeight - scrollY; // at the bottom a short section cannot reach the top
      if (Math.abs(top - want) > 8 && !(top > want && room < 4)) { t.scrollIntoView({ block: "start" }); if (tries > 1) setTimeout(() => settle(t, tries - 1), 400); }
    };
    let done = false;
    const once = () => { if (done) return; done = true; removeEventListener("scrollend", once); setTimeout(check, 60); };
    if ("onscrollend" in window) addEventListener("scrollend", once);
    setTimeout(once, reduce ? 50 : 1400);
  }
  // a scroll of the reader's own cancels any pending correction
  addEventListener("wheel", () => { settling++; }, { passive: true });
  addEventListener("touchstart", () => { settling++; }, { passive: true });
  addEventListener("keydown", (e) => { if (/^(Arrow|Page|Home|End| )/.test(e.key)) settling++; });

  // ---- live marks, read from the page
  const $ = (id) => document.getElementById(id);
  const watch = (el, fn) => { if (!el) return; fn(); new MutationObserver(fn).observe(el, { attributes: true, childList: true, characterData: true, subtree: true }); };
  const mine = $("snMine"), finds = $("snFinds"), ws = $("snWs");
  watch($("mineState"), () => { const s = $("mineState"), on = s.classList.contains("on"); mine.classList.toggle("show", on); mine.parentElement.title = on ? s.textContent : ""; });
  watch($("pending"), () => { const m = /(\d+)/.exec($("pending").textContent || ""), n = m ? +m[1] : 0; finds.textContent = n > 99 ? "99+" : n ? String(n) : ""; finds.classList.toggle("show", n > 0); finds.parentElement.title = n ? `${n} find${n > 1 ? "s" : ""} waiting for the next minute's reveal` : ""; });
  const rows = ["pd-refine", "pd-reroll", "pd-item"].map($).filter(Boolean);
  const wsMark = () => { const n = rows.filter((r) => r.style.display !== "none" && r.textContent.trim()).length; ws.classList.toggle("show", n > 0); ws.parentElement.title = n ? "a craft is ready to reveal" : ""; };
  rows.forEach((r) => watch(r, wsMark));

  setOffset(); spy();
  // a link that opened the page on a section (#ws) lands under the header, not behind it
  if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(() => { setOffset(); t.scrollIntoView({ block: "start" }); spy(); }, 300); }
})();
