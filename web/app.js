// Alchemists dapp: mine status, in-browser mining (CPU workers or WebGPU) with a local session wallet, inventory, workshop.
(async () => {
  // the page and this script are deployed together; a stale cached page would lack elements this script expects
  const APP_VER = "8";
  if (document.body.dataset.app !== APP_VER) { const u = new URL(location.href); u.searchParams.set("r", String(Date.now())); location.replace(u.toString()); return; }
  // a missing element must never break the whole app: writes to it go to a harmless dummy
  const NULL_EL = new Proxy({}, {
    get: (t, k) => (k === "style" || k === "dataset") ? {} : k === "classList" ? { toggle() {}, add() {}, remove() {} } : k === "querySelector" ? () => NULL_EL : (k === "querySelectorAll" || k === "children" || k === "options") ? [] : (typeof k === "string" && ["add", "remove", "insertAdjacentHTML", "addEventListener", "click", "dispatchEvent"].includes(k)) ? () => {} : undefined,
    set: () => true,
  });
  const $ = (id) => document.getElementById(id) || NULL_EL;
  const log = (m, cls) => { const el = $("log"); const t = new Date().toLocaleTimeString(); el.textContent = `[${t}] ${m}\n` + el.textContent; if (cls === "warn") console.warn(m); };
  const mlog = (m) => { const el = $("mlog"); const t = new Date().toLocaleTimeString(); el.textContent = `[${t}] ${m}\n` + el.textContent.split("\n").slice(0, 200).join("\n"); };
  const dep = await (await fetch("./deployment.json", { cache: "no-cache" })).json();
  const names = await (await fetch("./names.json", { cache: "no-cache" })).json();
  const abi = {};
  for (const n of ["Materials", "Keys", "Mine", "Furnaces", "Workshop", "Souls", "Stream"]) { try { const r = await fetch(`./abi/${n}.json`, { cache: "no-cache" }); if (r.ok) abi[n] = await r.json(); } catch {} }
  // the public RPC stalls on big JSON-RPC batches (ethers would pack up to 100 calls into one request); 8 per request is fast
  // rpc.js rotates through the public endpoints in deployment.json on errors, rate limits and timeouts
  const provider = AlchRpc.create(dep.rpcs || [dep.rpc], dep.chainId);
  provider.onSwitch((url, why) => log(`rpc: switched to ${url.replace(/^https?:\/\//, "")} (${why})`, "warn"));
  const C = (n, p) => new ethers.Contract(dep.contracts[n], abi[n], p || provider);
  const mine = C("Mine"), materials = C("Materials"), furnaces = C("Furnaces"), workshop = C("Workshop");
  // the soul and the stream came with testnet v11; an older deployment record simply hides the station
  const soulsC = dep.contracts.Souls && abi.Souls ? C("Souls") : null, streamC = dep.contracts.Stream && abi.Stream ? C("Stream") : null;
  if (!soulsC) { const b = document.querySelector('#wsNav button[data-st="soul"]'); if (b) b.style.display = "none"; }
  const RANKS = ["", "Apprentice", "Adept", "Master", "Magister", "Archmage", "Named"];
  // a deployment without the Keys contract (before v10) still runs: keys are simply never found
  const keysC = dep.contracts.Keys && abi.Keys ? C("Keys") : { ownerOf: async () => { throw new Error("no Keys contract"); } };
  // mythic keys are an ERC-721 (token id = key index); the dapp carries a key as the virtual id 3000 + index
  const KEY_ID = 3000, isKeyId = (id) => id >= KEY_ID && id < KEY_ID + 21, keyImg = (id) => `metadata/keys/${id - KEY_ID}.png`;
  const img = (id) => (isKeyId(id) ? keyImg(id) : `metadata/${id}.png`);
  $("net").textContent = `${dep.chainName} · ${dep.chainId}`;
  $("netFoot").textContent = `${dep.chainName}, chainId ${dep.chainId}, RPC ${(dep.rpcs || [dep.rpc]).length} public endpoints`;
  $("mineAddr").textContent = dep.contracts.Mine.slice(0, 10) + "…";
  $("wsAddr").textContent = dep.contracts.Workshop.slice(0, 10) + "…";
  $("contracts").innerHTML = Object.entries(dep.contracts).filter(([, v]) => v).map(([k, v]) => `<div><code><a href="${dep.explorer}/address/${v}" target="_blank" rel="noopener">${k}</a> ${v.slice(0, 8)}…${v.slice(-4)}</code></div>`).join("");
  // every link that leaves this origin opens a new tab: a plain navigation would kill a running miner
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest("a[href]"); if (!a) return; let u; try { u = new URL(a.href, location.href); } catch { return; } if (u.origin !== location.origin) { a.target = "_blank"; a.rel = "noopener"; } });
  const TIERS = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
  const TC = ["", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
  const FURNACE = ["", "clay", "iron", "brass", "athanor"];
  const ing = (t, tier) => 1 + t * 8 + tier;
  const item = (k, tier) => 2000 + k * 8 + tier;
  const GAS = { reveal: 1_000_000n, ws: 1_500_000n, revealMany: 3_000_000n, submit: 1_500_000n, transfer: 600_000n };
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const fmtEth = (wei, d = 5) => Number(ethers.formatEther(wei)).toLocaleString("en", { maximumFractionDigits: d });

  // ------------------------------------------------------------ identities: session (miner) wallet + main wallet
  let burner = null;
  function loadBurner() {
    let key = null;
    try { key = localStorage.getItem("alch.minerKey"); } catch {}
    if (!key) { key = ethers.Wallet.createRandom().privateKey; try { localStorage.setItem("alch.minerKey", key); } catch {} }
    burner = new ethers.Wallet(key, provider);
  }
  loadBurner();
  let main = null; // { signer, address }
  let mode = "miner"; // whose inventory/workshop: "miner" (session wallet) or "main"
  let me = burner.address, signer = burner;
  function setMode(m) {
    mode = m;
    lastPending = -1;
    if (mode === "main" && main) { me = main.address; signer = main.signer; } else { mode = "miner"; me = burner.address; signer = burner; }
    $("invWho").value = mode; $("wsWho").value = mode;
    $("invWhoAddr").textContent = short(me);
    $("wsWhoNote").textContent = mode === "main" ? `Working as your wallet ${short(me)}: every craft asks for a confirmation in MetaMask, and the items shown are its.` : `Working as the session wallet ${short(me)}: it signs every craft itself, no pop-ups. Switch to your wallet above to craft with the items it holds.`;
    refreshAll();
  }
  $("invWho").onchange = () => setMode($("invWho").value);
  $("wsWho").onchange = () => setMode($("wsWho").value);
  $("burnerAddr").textContent = burner.address;
  $("burnerAddr").href = `${dep.explorer}/address/${burner.address}`;
  $("burnerAddr").target = "_blank"; $("burnerAddr").rel = "noopener";
  // the address to top the session wallet up from anywhere; the button confirms itself for a moment
  $("copyAddrBtn").onclick = async () => {
    const btn = $("copyAddrBtn"), label = btn.textContent;
    const show = (t, cls) => { btn.textContent = t; btn.classList.add(cls); setTimeout(() => { btn.textContent = label; btn.classList.remove(cls); }, 1800); };
    try { await navigator.clipboard.writeText(burner.address); show("Copied", "done"); }
    catch { window.prompt("Copy the session wallet address:", burner.address); }
  };

  async function refreshBurner() {
    try {
      const bal = await provider.getBalance(burner.address);
      $("burnerBal").textContent = `${fmtEth(bal)} ETH`;
      $("burnerBal").className = "tag" + (bal > 0n ? " on" : " warn");
      return bal;
    } catch { return 0n; }
  }

  // ------------------------------------------------------------ clock
  let sessionSec = 60, chainOffset = 0, curMinute = 0;
  function chainNow() { return Date.now() / 1000 + chainOffset; }
  function tickClock() {
    const now = chainNow();
    const m = Math.floor(now / sessionSec);
    const left = Math.max(0, Math.ceil((m + 1) * sessionSec - now));
    $("clock").textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    const ck = document.querySelector(".clock"); if (ck) ck.classList.toggle("soon", left <= 5);
    $("session").textContent = `minute ${m} · until the next challenge`;
    if (m !== curMinute) { curMinute = m; refreshMine(); miner.onMinute(m); }
    miner.tickUi();
  }

  // ------------------------------------------------------------ mine status
  let cfgCache = null;
  async function refreshMine() {
    try {
      const [tQ8, unlocked, ore, sub, ema, np, mQ8, price, paused, cfg, blk] = await Promise.all([
        mine.tQ8(), mine.unlockedTier(), mine.oreRemaining(), mine.submittedTotal(), mine.emaHashrate(), mine.netPressure(), mine.mQ8(), mine.currentPrice(), mine.paused(), mine.config(), provider.getBlock("latest"),
      ]);
      cfgCache = cfg;
      try { sessionSec = Number(await mine.sessionSec()); } catch {}
      chainOffset = Number(blk.timestamp) - Date.now() / 1000;
      const m = Math.floor(Number(blk.timestamp) / sessionSec);
      let mt = Number(tQ8); try { const x = Number(await mine.minuteThreshold(m)); if (x) mt = x; } catch {}
      const floorB = Number(cfg.floorBitsQ8) / 256, ceilB = Number(cfg.ceilBitsQ8) / 256, thr = mt / 256;
      $("thr").innerHTML = `${thr.toFixed(2)} <small>bits</small>`;
      $("corr").textContent = `${floorB} … ${ceilB} bits`;
      const pct = Math.max(0, Math.min(100, (thr - floorB) / (ceilB - floorB) * 100));
      $("thrBar").querySelector("i").style.width = pct + "%";
      $("thrBar").querySelector(".pin").style.left = pct + "%";
      const r0 = Number(cfg.oreR0), oreN = Number(ore);
      $("oreBar").querySelector("i").style.width = (100 * oreN / r0).toFixed(2) + "%";
      $("oreLbl").textContent = `${oreN.toLocaleString("en")} / ${r0.toLocaleString("en")}`;
      const halv = oreN > 0 ? Math.floor(Math.log2(r0 / Math.max(1, oreN))) : 3;
      $("halv").textContent = oreN === 0 ? "the vein is exhausted" : `halvings so far: ${Math.min(3, halv)}`;
      $("price").innerHTML = `${Number(ethers.formatEther(price)).toLocaleString("en", { maximumSignificantDigits: 3 })} <small>ETH</small>`;
      $("ema").innerHTML = fmtHs(Number(ema));
      $("subs").textContent = Number(sub).toLocaleString("en");
      $("mult").textContent = "×" + (Number(mQ8) / 256).toFixed(2);
      $("press").textContent = "×" + (Number(np) / 1e6).toFixed(3);
      const u = Number(unlocked);
      $("gems").innerHTML = [1, 2, 3, 4, 5].map((t) => `<span class="gem ${t <= u ? "on" : ""}" style="--g:${TC[t]}">${TIERS[t]}</span>`).join("");
      $("pauseFlag").innerHTML = paused ? `<span class="tag warn">MINE PAUSED</span>` : "";
      mineFlags.paused = !!paused; mineFlags.exhausted = oreN === 0;
      await refreshPending(m);
      try { const bal = await provider.getBalance(dep.treasury); $("treasury").textContent = `${fmtEth(bal, 4)} ETH`; } catch {}
      refreshBurner();
    } catch (e) { log("mine: " + (e.shortMessage || e.message), "warn"); }
  }
  // pending finds of `me`: a find submitted in minute s is settled by the challenge of minute s+1, which exists once
  // that minute has been ticked; until then a reveal transaction would succeed but do nothing
  let lastPending = -1;
  async function refreshPending(nowMinute) {
    const n = Number(await mine.pendingCount(me));
    if (lastPending >= 0 && n < lastPending) refreshInventory(); // somebody (the keeper, our next submit) revealed a find
    lastPending = n;
    $("pending").textContent = `to reveal: ${n}`;
    $("pending").className = "tag" + (n > 0 ? " on" : "");
    let ready = 0;
    const rows = [], finds = [];
    for (let i = 0; i < Math.min(n, 8); i++) {
      try {
        const pd = await mine.pendingAt(me, i);
        const rm = Number(pd.revealMinute);
        const e = await mine.entropy(rm);
        const ok = BigInt(e) !== 0n;
        if (ok) ready++;
        finds.push({ m: rm - 2, revealMinute: rm, ready: ok, bits: Number(pd.workQ8) / 256 });
        const wait = Math.max(0, rm * sessionSec - Math.floor(chainNow()));
        rows.push(`find mined in minute ${rm - 2} · ${(Number(pd.workQ8) / 256).toFixed(2)} bits · ${ok ? "<span style=\"color:var(--verd)\">ready to reveal</span>" : wait > 0 ? `reveals in ${wait} s (minute ${rm} must start and be ticked)` : "waiting for the keeper to tick minute " + rm}`);
      } catch {}
    }
    if (n > 8) rows.push(`… and ${n - 8} more`);
    stage("pending", { who: me, finds }); // the rack in the scene mirrors the chain, also after a reload
    $("pendList").innerHTML = rows.join("<br>");
    $("revealMine").disabled = ready === 0;
    $("revealMine").textContent = n > 0 ? `Reveal finds (${ready} ready)` : "Reveal finds";
  }
  const revealStatus = (msg, cls) => { const el = $("revealStatus"); el.textContent = msg; el.className = "tag " + (cls || ""); el.style.display = msg ? "block" : "none"; };
  function fmtHs(h) {
    if (h >= 1e12) return `${(h / 1e12).toFixed(2)} <small>TH/s</small>`;
    if (h >= 1e9) return `${(h / 1e9).toFixed(2)} <small>GH/s</small>`;
    if (h >= 1e6) return `${(h / 1e6).toFixed(1)} <small>MH/s</small>`;
    return `${(h / 1e3).toFixed(0)} <small>kH/s</small>`;
  }

  // ------------------------------------------------------------ browser miner
  // settings persist in the browser; 0 or empty = no limit
  const SETTINGS = ["maxPrice", "budget", "rounds", "maxSubmits", "reserve", "margin", "signerMode", "engine", "cpuThreads", "gpuInt"];
  function loadSettings() { try { const s = JSON.parse(localStorage.getItem("alch.minerSettings") || "{}"); for (const k of SETTINGS) if (s[k] !== undefined && $(k)) $(k).value = s[k]; } catch {} }
  function saveSettings() { try { const s = {}; for (const k of SETTINGS) if ($(k)) s[k] = $(k).value; localStorage.setItem("alch.minerSettings", JSON.stringify(s)); } catch {} }
  const num = (id, d = 0) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v >= 0 ? v : d; };

  const stage = (type, d = {}) => document.dispatchEvent(new CustomEvent("alch:stage", { detail: { type, ...d } })); // the pixel scene in stage.js
  const warn = (msg) => { const el = $("mineWarn"); el.textContent = msg; el.style.display = msg ? "block" : "none"; };
  const miner = {
    running: false, engine: "cpu", signerMode: "session", workers: [], gpu: null, m: null, ch: null, thrQ8: 0, floor: 0,
    best: null, // { wq8, hi, lo }
    hashes: 0, hist: [], stats: { rounds: 0, submits: 0, skips: 0, minted: 0, keys: 0, spent: 0n, why: { threshold: 0, funds: 0, price: 0, pending: 0 } }, busy: false, lastFloor: 0,
    skip(reason) { this.stats.skips++; this.stats.why[reason] = (this.stats.why[reason] || 0) + 1; },
    // how much a submit needs right now: price with margin + reserve + gas headroom
    async need() {
      const L = this.limits();
      const price = await mine.currentPrice();
      const value = price * (100n + L.margin) / 100n;
      let gasWei = 10n ** 14n;
      try { const fd = await provider.getFeeData(); const gp = fd.maxFeePerGas || fd.gasPrice; if (gp) gasWei = GAS.submit * gp * 2n; } catch {}
      return { price, value, gasWei, total: value + L.reserve + gasWei, reserve: L.reserve };
    },
    fundsMsg(who, bal, n) {
      return `Not enough ETH in ${short(who)}: it has ${fmtEth(bal, 6)} ETH, a submit needs about ${fmtEth(n.total, 6)} (price with margin ${fmtEth(n.value, 7)} + your reserve ${fmtEth(n.reserve, 6)} + gas). ${this.signerMode === "own" ? "Top up this wallet" : "Fund the session wallet"} or lower the reserve; finds are skipped until then.`;
    },
    threads() { return +$("cpuThreads").value; },
    intensity() { return +$("gpuInt").value; },
    address() { return this.signerMode === "own" && main ? main.address : burner.address; },
    signer() { return this.signerMode === "own" && main ? main.signer : burner; },
    limits() {
      return { maxPrice: num("maxPrice") ? ethers.parseEther(String(num("maxPrice"))) : 0n, budget: num("budget") ? ethers.parseEther(String(num("budget"))) : 0n,
        rounds: Math.floor(num("rounds")), maxSubmits: Math.floor(num("maxSubmits")), reserve: ethers.parseEther(String(num("reserve"))), margin: BigInt(Math.floor(num("margin", 25))) };
    },
    async start() {
      if (this.running) return;
      saveSettings();
      this.engine = $("engine").value;
      this.signerMode = $("signerMode").value;
      if (this.signerMode === "own") {
        if (!main) await connect();
        if (!main) { mlog("connect your wallet first, or switch the signer to the session wallet"); return; }
        mlog(`mining with your own wallet ${short(main.address)}: every submit will ask for a confirmation, answer within the minute`);
      }
      this.stats = { rounds: 0, submits: 0, skips: 0, minted: 0, keys: 0, spent: 0n, why: { threshold: 0, funds: 0, price: 0, pending: 0 } };
      warn("");
      if (this.engine === "gpu") {
        try {
          if (!this.gpu) { this.gpu = await GpuMiner.create(); const st = await this.gpu.selftest(); if (!st.ok) throw new Error("GPU selftest failed: " + st.hex); mlog(`GPU ready: ${this.gpu.info}, selftest PASS`); }
        } catch (e) { mlog("GPU unavailable: " + (e.message || e) + " — falling back to CPU"); this.engine = "cpu"; $("engine").value = "cpu"; }
      }
      this.running = true; this.hashes = 0; this.hist = [];
      $("mineStart").disabled = true; $("mineStop").disabled = false; $("mineState").textContent = "starting"; $("mineState").className = "tag on";
      document.dispatchEvent(new CustomEvent("alch:mining", { detail: { running: true } }));
      try {
        const who = this.address();
        const bal = this.signerMode === "session" ? await refreshBurner() : await provider.getBalance(who);
        const n = await this.need();
        if (bal < n.total) { const msg = this.fundsMsg(who, bal, n); warn(msg); mlog(msg); }
      } catch {}
      const L = this.limits();
      mlog(`engine ${this.engine === "gpu" ? "GPU" : `CPU × ${this.threads()} threads`}, address ${short(this.address())}${L.maxPrice ? `, max price ${fmtEth(L.maxPrice, 7)} ETH` : ""}${L.budget ? `, budget ${fmtEth(L.budget)} ETH` : ""}${L.rounds ? `, ${L.rounds} rounds` : ""}${L.maxSubmits ? `, ${L.maxSubmits} submits` : ""}`);
      await this.onMinute(Math.floor(chainNow() / sessionSec), true);
      if (this.engine === "gpu") this.gpuLoop();
    },
    stop(reason) {
      this.running = false;
      for (const w of this.workers) { w.postMessage({ type: "stop" }); w.terminate(); }
      this.workers = [];
      $("mineStart").disabled = false; $("mineStop").disabled = true; $("mineState").textContent = "stopped"; $("mineState").className = "tag";
      document.dispatchEvent(new CustomEvent("alch:mining", { detail: { running: false } }));
      mlog(reason ? `stopped: ${reason}` : "stopped");
    },
    rnd32() { return Math.floor(Math.random() * 4294967296) >>> 0; },
    async onMinute(m, first) {
      if (!this.running) return;
      const prev = this.m;
      if (!first && prev !== null && prev !== m) this.settle(prev, this.best);
      const L = this.limits();
      if (!first) {
        this.stats.rounds++;
        if (L.rounds && this.stats.rounds >= L.rounds) { this.settleThen(() => this.stop(`${L.rounds} rounds done`)); return; }
      }
      if (mineFlags.paused) { this.stop("the mine is paused"); return; }
      if (mineFlags.exhausted) { this.stop("the vein is exhausted"); return; }
      this.m = m; this.best = null;
      // challenge + threshold of the new minute (the keeper ticks at the start of each minute)
      let ch = null, tq = 0;
      for (let tries = 0; tries < 12 && this.running; tries++) {
        try { ch = await mine.challenge(m); tq = Number(await mine.minuteThreshold(m)); } catch {}
        if (ch && BigInt(ch) !== 0n) break;
        // the keeper normally ticks within a few seconds of the minute; only after ~9 s do we spend gas on it ourselves
        if (tries === 5) { mlog("no challenge yet, ticking the mine myself"); try { await (await C("Mine", burner).tick({ gasLimit: 9_000_000n })).wait(); } catch (e) { mlog("tick: " + (e.shortMessage || e.message)); } }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!ch || BigInt(ch) === 0n || this.m !== m) return;
      this.ch = ch; this.thrQ8 = tq || Number(await mine.tQ8()); this.floor = Math.floor(this.thrQ8 / 256);
      mlog(`minute ${m}: challenge ${ch.slice(0, 10)}… threshold ${(this.thrQ8 / 256).toFixed(2)} bits`);
      stage("minute", { m, thrQ8: this.thrQ8 });
      if (this.engine === "cpu") this.cpuJob(); else if (this.gpu) { this.gpu.setJob(this.address(), ch, this.floor, this.rnd32(), this.rnd32()); this.lastFloor = this.floor; }
    },
    // run fn once the pending submit (if any) has finished
    settleThen(fn) { const wait = () => { if (this.busy) setTimeout(wait, 500); else fn(); }; wait(); },
    cpuJob() {
      const n = this.threads();
      while (this.workers.length < n) {
        const w = new Worker("worker.js");
        w.onmessage = (e) => this.onProgress(e.data);
        this.workers.push(w);
      }
      while (this.workers.length > n) { const w = this.workers.pop(); w.postMessage({ type: "stop" }); w.terminate(); }
      for (const w of this.workers) w.postMessage({ type: "job", addr: this.address(), ch: this.ch, hi: this.rnd32(), lo: this.rnd32() });
    },
    onProgress(p) {
      if (!this.running) return;
      this.hashes += p.hashes; this.hist.push([performance.now(), p.hashes]);
      if (p.best) this.consider(p.best.hi, p.best.lo);
    },
    consider(hi, lo) {
      // exact contract work of a candidate; keep the best of the minute
      const addr = this.address();
      const ctx = this._ctx && this._ctx.ch === this.ch && this._ctx.addr === addr ? this._ctx.ctx : (this._ctx = { ch: this.ch, addr, ctx: MineHash.setup(addr, this.ch) }).ctx;
      const d = MineHash.digest(ctx, hi, lo);
      const wq8 = MineHash.workQ8(d);
      if (!this.best || wq8 > this.best.wq8) { this.best = { wq8, hi, lo }; stage("best", { wq8 }); return true; }
      return false;
    },
    async gpuLoop() {
      while (this.running && this.engine === "gpu") {
        if (!this.ch) { await new Promise((r) => setTimeout(r, 200)); continue; }
        const t0 = performance.now();
        let r = null;
        try { r = await this.gpu.dispatch(); } catch (e) { mlog("GPU error: " + (e.message || e)); this.stop(); return; }
        const dt = performance.now() - t0;
        this.hashes += this.gpu.perDispatch; this.hist.push([performance.now(), this.gpu.perDispatch]);
        if (r && this.consider(r.hi, r.lo)) { const f = Math.max(this.floor, r.lz + 1); if (f !== this.lastFloor) { this.lastFloor = f; this.gpu.setFloor(f); } }
        const inten = this.intensity();
        if (inten < 100) await new Promise((res) => setTimeout(res, dt * (100 / inten - 1)));
      }
    },
    async settle(m, best) {
      const thr = this.thrQ8;
      if (!best) { this.skip("threshold"); stage("skip", { reason: "threshold", bits: 0, thr: thr / 256 }); mlog(`minute ${m}: nothing found`); return; }
      if (best.wq8 < thr) { this.skip("threshold"); stage("skip", { reason: "threshold", bits: best.wq8 / 256, thr: thr / 256 }); mlog(`minute ${m}: best ${(best.wq8 / 256).toFixed(2)} bits < threshold ${(thr / 256).toFixed(2)}, no submit`); return; }
      if (this.busy) { const msg = `minute ${m}: the previous submit is still pending${this.signerMode === "own" ? " (waiting for your confirmation in the wallet)" : ""}, this find is skipped`; mlog(msg); warn(msg); this.skip("pending"); stage("skip", { reason: "pending" }); return; }
      this.busy = true;
      try {
        const L = this.limits();
        const n = await this.need();
        const price = n.price, value = n.value;
        if (L.maxPrice && price > L.maxPrice) { const msg = `Skipped: the submit price ${fmtEth(price, 7)} ETH is above your limit ${fmtEth(L.maxPrice, 7)} ETH.`; mlog(`minute ${m}: ${msg}`); warn(msg); this.skip("price"); stage("skip", { reason: "price" }); return; }
        if (L.budget && this.stats.spent + price > L.budget) { this.skip("price"); stage("skip", { reason: "price" }); this.stop(`budget ${fmtEth(L.budget)} ETH would be exceeded`); return; }
        const who = this.address();
        const bal = await provider.getBalance(who);
        if (bal < n.total) { const msg = this.fundsMsg(who, bal, n); mlog(`minute ${m}: found ${(best.wq8 / 256).toFixed(2)} bits, skipped. ${msg}`); warn(msg); this.skip("funds"); stage("skip", { reason: "funds" }); return; }
        const nonce = MineHash.nonceBig(best.hi, best.lo);
        mlog(`minute ${m}: submitting ${(best.wq8 / 256).toFixed(2)} bits for ${fmtEth(price, 7)} ETH${this.signerMode === "own" ? " — confirm in your wallet" : ""}…`);
        stage("submit", { m, bits: best.wq8 / 256 });
        if (this.signerMode === "own") { document.title = "⚠ Confirm the submit · Alchemists"; }
        let tx;
        try { tx = await C("Mine", this.signer()).submit(m, nonce, { value, gasLimit: GAS.submit }); }
        finally { document.title = "Alchemists · Mine, Workshop and the Cauldron"; }
        const rc = await tx.wait();
        if (rc.status !== 1) { stage("submitfail", { m, msg: "reverted" }); mlog(`minute ${m}: submit reverted ${tx.hash}`); warn(`The submit for minute ${m} reverted, see the log.`); return; }
        this.stats.submits++; this.stats.spent += price; warn(""); stage("submitted", { m, revealMinute: m + 2 });
        const found = [];
        for (const l of rc.logs) { let ev = null; try { ev = mine.interface.parseLog(l); } catch {} if (!ev) continue; if (ev.name === "Mined") { this.stats.minted++; found.push(`${TIERS[Number(ev.args.tier)]} ${names.types[Number(ev.args.typeId)]}${ev.args.upgraded ? " (upgraded!)" : ""}`); this.addResult(Number(ev.args.id), "submit"); } if (ev.name === "KeyMined") { this.stats.keys++; found.push("MYTHIC KEY " + names.keys[Number(ev.args.keyIndex)].key); this.addResult(3000 + Number(ev.args.keyIndex), "submit"); } }
        mlog(`minute ${m}: submitted (gas ${rc.gasUsed})${found.length ? " · revealed " + found.join(", ") : " · reveal comes with the next submit"}`);
        refreshInventory(); refreshBurner();
        if (L.maxSubmits && this.stats.submits >= L.maxSubmits) this.stop(`${L.maxSubmits} submits done`);
      } catch (e) { const msg = e.reason || e.shortMessage || e.message; stage("submitfail", { m, msg }); mlog(`minute ${m}: ${msg}`); warn(/reject|denied/i.test(msg) ? "You rejected the submit in the wallet; the find was dropped." : `Submit failed: ${msg}`); }
      finally { this.busy = false; }
    },
    addResult(id, via) {
      if (!id) return; // a seal has no loot card; the souls list refreshes on its own
      const el = $("results");
      const tier = id >= 3000 ? 6 : id >= 2000 ? (id - 2000) % 8 : id >= 1000 ? id - 1000 : (id - 1) % 8;
      el.insertAdjacentHTML("afterbegin", `<div class="card t${tier}" style="width:84px"><img class="px" src="${img(id)}" alt=""><div class="s">${TIERS[tier]}</div></div>`);
      while (el.children.length > 12) el.lastElementChild.remove();
      const label = id >= 3000 ? names.keys[id - 3000].key : id >= 2000 ? `${TIERS[tier]} ${names.kinds[Math.floor((id - 2000) / 8)]}` : id >= 1000 ? `${TIERS[tier]} Potion` : `${TIERS[tier]} ${names.types[Math.floor((id - 1) / 8)]}`;
      document.dispatchEvent(new CustomEvent("alch:loot", { detail: { id, tier, label, via, el: el.firstElementChild } }));
      if (tier === 6) document.dispatchEvent(new CustomEvent("alch:key", { detail: { id } }));
    },
    tickUi() {
      const now = performance.now();
      this.hist = this.hist.filter((h) => now - h[0] < 10000);
      const span = this.hist.length ? Math.max(1000, now - this.hist[0][0]) : 1000;
      const rate = this.hist.reduce((a, h) => a + h[1], 0) / (span / 1000);
      $("hashrate").innerHTML = this.running ? fmtHs(rate) : "–";
      stage("rate", { rate, running: this.running, sec: Math.floor(chainNow() % sessionSec), sessionSec, chainNow: chainNow(), m: this.m });
      $("bestBits").innerHTML = this.best ? `${(this.best.wq8 / 256).toFixed(2)} <small>bits</small>` : "–";
      $("bestBits").style.color = this.best && this.best.wq8 >= this.thrQ8 ? "var(--verd)" : "";
      const w = this.stats.why || {};
      const why = [w.funds ? `${w.funds} no ETH` : "", w.price ? `${w.price} price limit` : "", w.pending ? `${w.pending} pending` : "", w.threshold ? `${w.threshold} below threshold` : ""].filter(Boolean).join(", ");
      $("mstats").textContent = `rounds ${this.stats.rounds} · submits ${this.stats.submits} · skips ${this.stats.skips}${why ? ` (${why})` : ""} · minted ${this.stats.minted}${this.stats.keys ? " · keys " + this.stats.keys : ""} · spent ${fmtEth(this.stats.spent, 6)} ETH`;
      if (this.running) $("mineState").textContent = (this.engine === "gpu" ? "mining on GPU" : `mining on CPU × ${this.workers.length}`) + (this.signerMode === "own" ? " · own wallet" : "");
    },
  };
  const mineFlags = { paused: false, exhausted: false };
  $("mineStart").onclick = () => miner.start();
  $("mineStop").onclick = () => miner.stop();
  function syncEngineUi() { $("cpuOpts").style.display = $("engine").value === "cpu" ? "" : "none"; $("gpuOpts").style.display = $("engine").value === "gpu" ? "" : "none"; }
  function syncSignerUi() { const own = $("signerMode").value === "own"; $("sessionBox").style.display = own ? "none" : ""; $("ownBox").style.display = own ? "" : "none"; $("ownAddr").textContent = main ? main.address : "not connected"; $("ownAddr").className = "tag" + (main ? " on" : ""); }
  $("engine").onchange = () => { syncEngineUi(); saveSettings(); if (miner.running) { miner.stop("engine changed"); miner.start(); } };
  $("signerMode").onchange = () => { syncSignerUi(); saveSettings(); if (miner.running) { miner.stop("signer changed"); miner.start(); } };
  $("connect3").onclick = async () => { await connect(); syncSignerUi(); };
  // the slider track is painted by CSS from --p (the standard track only fills up to the thumb centre)
  const paintRange = (el) => { const min = +el.min || 0, max = +el.max || 100; el.style.setProperty("--p", `${((+el.value - min) / (max - min)) * 100}%`); };
  $("cpuThreads").oninput = () => { $("cpuThreadsLbl").textContent = $("cpuThreads").value; paintRange($("cpuThreads")); saveSettings(); if (miner.running && miner.engine === "cpu" && miner.ch) miner.cpuJob(); };
  $("gpuInt").oninput = () => { $("gpuIntLbl").textContent = $("gpuInt").value + " %"; paintRange($("gpuInt")); saveSettings(); };
  for (const k of ["maxPrice", "budget", "rounds", "maxSubmits", "reserve", "margin"]) $(k).onchange = saveSettings;
  const cores = navigator.hardwareConcurrency || 4;
  $("cpuThreads").max = cores; $("cpuThreads").value = Math.max(1, Math.ceil(cores / 2));
  if (!GpuMiner.available()) { $("engine").querySelector('option[value="gpu"]').disabled = true; $("gpuNote").textContent = "WebGPU is not available in this browser: use Chrome or Edge on desktop for the GPU engine."; }
  else { $("engine").value = "gpu"; }
  loadSettings();
  if (!GpuMiner.available() && $("engine").value === "gpu") $("engine").value = "cpu";
  $("cpuThreads").value = Math.min(cores, Math.max(1, +$("cpuThreads").value || 1)); $("cpuThreadsLbl").textContent = $("cpuThreads").value; $("gpuIntLbl").textContent = $("gpuInt").value + " %";
  paintRange($("cpuThreads")); paintRange($("gpuInt"));
  syncEngineUi(); syncSignerUi();

  // session wallet controls
  $("fundBtn").onclick = async () => {
    if (!main) { await connect(); if (!main) return; }
    const amt = $("fundAmt").value || "0.005";
    try { mlog(`funding the miner wallet with ${amt} ETH…`); const tx = await main.signer.sendTransaction({ to: burner.address, value: ethers.parseEther(amt) }); await tx.wait(); mlog("funded"); refreshBurner(); } catch (e) { mlog("fund: " + (e.shortMessage || e.message)); }
  };
  $("exportBtn").onclick = () => { const k = burner.privateKey; navigator.clipboard && navigator.clipboard.writeText(k).catch(() => {}); prompt("Miner wallet private key (copied to clipboard). Keep it safe:", k); };
  $("importBtn").onclick = () => { const k = prompt("Paste a private key to use as the miner wallet:"); if (!k) return; try { const w = new ethers.Wallet(k.trim()); localStorage.setItem("alch.minerKey", w.privateKey); if (miner.running) miner.stop(); loadBurner(); $("burnerAddr").textContent = burner.address; $("burnerAddr").href = `${dep.explorer}/address/${burner.address}`; setMode("miner"); mlog(`miner wallet is now ${burner.address}`); } catch { mlog("import: not a valid private key"); } };
  const withdraw = async () => {
    if (!main) { await connect(); if (!main) return; }
    try {
      const ids = [], amts = [];
      const all = allIds();
      const bal = await materials.balanceOfBatch(all.map(() => burner.address), all);
      all.forEach((id, i) => { if (bal[i] > 0n) { ids.push(id); amts.push(bal[i]); } });
      if (ids.length) { mlog(`moving ${ids.length} kinds of loot to ${short(main.address)}…`); const tx = await C("Materials", burner).safeBatchTransferFrom(burner.address, main.address, ids, amts, "0x", { gasLimit: 200_000n + 60_000n * BigInt(ids.length) }); await tx.wait(); mlog("loot moved"); }
      const mf = await myFurnaceIds(burner.address);
      for (const id of mf) { const tx = await C("Furnaces", burner).transferFrom(burner.address, main.address, id, { gasLimit: GAS.transfer }); await tx.wait(); mlog(`furnace #${id} moved`); }
      const mk = [];
      for (let i = 0; i < 21; i++) { try { if ((await keysC.ownerOf(i)).toLowerCase() === burner.address.toLowerCase()) mk.push(i); } catch {} }
      for (const i of mk) { const tx = await C("Keys", burner).transferFrom(burner.address, main.address, i, { gasLimit: GAS.transfer }); await tx.wait(); mlog(`mythic key ${names.keys[i].key} moved`); }
      if (!ids.length && !mf.length && !mk.length) mlog("nothing to move");
      refreshAll();
    } catch (e) { mlog("withdraw: " + (e.reason || e.shortMessage || e.message)); }
  };
  $("withdrawBtn").onclick = withdraw;
  $("withdrawBtn2").onclick = withdraw;

  // ------------------------------------------------------------ inventory
  const TABS = [["all", "All"], ["0", "Metals"], ["1", "Minerals"], ["2", "Herbs"], ["3", "Woods"], ["4", "Beasts"], ["potion", "Potions"], ["item", "Items"], ["key", "Keys"], ["furnace", "Furnaces"]];
  let tab = "all";
  $("tabs").innerHTML = TABS.map(([k, v]) => `<button data-k="${k}" class="${k === tab ? "on" : ""}">${v}</button>`).join("");
  $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; tab = b.dataset.k; [...$("tabs").children].forEach((x) => x.classList.toggle("on", x === b)); renderInventory(); };
  let cards = [], inv = null, myFurnaces = [];
  function allIds() {
    const ids = [];
    for (let t = 0; t < 40; t++) for (let tier = 1; tier <= 5; tier++) ids.push(ing(t, tier));
    for (let tier = 1; tier <= 5; tier++) ids.push(1000 + tier);
    for (let k = 0; k < 8; k++) for (let tier = 1; tier <= 5; tier++) ids.push(item(k, tier));
    return ids;
  }
  async function myFurnaceIds(addr) {
    const out = [];
    try { const next = Number(await furnaces.nextId()); for (let id = 1; id < next; id++) { try { if ((await furnaces.ownerOf(id)).toLowerCase() === addr.toLowerCase()) out.push(id); } catch {} } } catch {}
    return out;
  }
  function renderInventory() {
    const list = cards.filter((c) => tab === "all" || c.cat === tab);
    $("invGrid").innerHTML = list.map((c) => `<div class="card t${c.tier}" title="${c.title}"><img class="px" src="${c.img}" alt=""><span class="n">×${c.n}</span><div class="t">${c.name}</div><div class="s">${c.sub}</div></div>`).join("");
    $("invEmpty").style.display = list.length ? "none" : "";
    $("invEmpty").textContent = "Nothing here yet. Mined ingredients land in the miner wallet a minute after the submit that reveals them.";
  }
  async function refreshInventory() {
    const ids = allIds();
    const bal = await materials.balanceOfBatch(ids.map(() => me), ids);
    inv = new Map(); ids.forEach((id, i) => { if (bal[i] > 0n) inv.set(id, Number(bal[i])); });
    // the keys: 21 ownerOf reads in chunks of 8 (an unclaimed key reverts, which means "not mine")
    for (let i = 0; i < 21; i += 8) { const rs = await Promise.all(Array.from({ length: Math.min(8, 21 - i) }, (_, j) => keysC.ownerOf(i + j).catch(() => null))); rs.forEach((o, j) => { if (o && o.toLowerCase() === me.toLowerCase()) inv.set(KEY_ID + i + j, 1); }); }
    cards = [];
    let ingCount = 0;
    for (let t = 0; t < 40; t++) for (let tier = 5; tier >= 1; tier--) { const n = inv.get(ing(t, tier)); if (n) { ingCount += n; cards.push({ cat: String(Math.floor(t / 8)), tier, n, img: `metadata/${ing(t, tier)}.png`, name: names.types[t], sub: TIERS[tier], title: `${names.categories[Math.floor(t / 8)]} · ${names.types[t]} · ${TIERS[tier]}` }); } }
    for (let tier = 5; tier >= 1; tier--) { const n = inv.get(1000 + tier); if (n) cards.push({ cat: "potion", tier, n, img: `metadata/${1000 + tier}.png`, name: "Potion", sub: TIERS[tier], title: `Potion of Purification · ${TIERS[tier]}` }); }
    for (let k = 0; k < 8; k++) for (let tier = 5; tier >= 1; tier--) { const n = inv.get(item(k, tier)); if (n) cards.push({ cat: "item", tier, n, img: `metadata/${item(k, tier)}.png`, name: names.kinds[k], sub: TIERS[tier], title: `${names.kinds[k]} · ${TIERS[tier]}` }); }
    for (let i = 0; i < 21; i++) if (inv.get(KEY_ID + i)) cards.push({ cat: "key", tier: 6, n: 1, img: keyImg(KEY_ID + i), name: names.keys[i].key, sub: names.keys[i].alchemist, title: `${names.keys[i].key} — ${names.keys[i].alchemist}` });
    myFurnaces = [];
    for (const id of await myFurnaceIds(me)) { try { myFurnaces.push({ id, tier: Number(await furnaces.tier(id)) }); } catch {} }
    for (const f of myFurnaces) cards.push({ cat: "furnace", tier: f.tier, n: 1, img: `img/furnace-${f.tier}.png`, name: `Furnace #${f.id}`, sub: FURNACE[f.tier], title: `Furnace #${f.id}, tier ${f.tier}` });
    $("invHint").textContent = cards.length ? `${cards.length} entries` : "empty";
    // loot in the session wallet can be moved to the main wallet in one click
    $("withdrawBtn2").style.display = mode === "miner" && cards.length ? "" : "none";
    $("myCount").textContent = ingCount.toLocaleString("en");
    $("myFurn").textContent = String(myFurnaces.length);
    renderInventory();
    fillSelects();
  }

  function fillSelects() {
    const tiers = (sel, max = 5) => { const v = sel.value; sel.innerHTML = ""; for (let t = 1; t <= max; t++) sel.add(new Option(`${t} · ${TIERS[t]}`, t)); if (v) sel.value = v; };
    tiers($("potTier")); tiers($("refTier"), 4); tiers($("rrTier")); tiers($("itTier"));
    if (!$("potA").options.length) { for (const s of [$("potA"), $("potB")]) { for (let t = 16; t < 24; t++) s.add(new Option(names.types[t], t)); } $("potB").selectedIndex = 1; }
    if (!$("refType").options.length) for (let t = 0; t < 40; t++) $("refType").add(new Option(`${names.categories[Math.floor(t / 8)]} · ${names.types[t]}`, t));
    if (!$("itKind").options.length) for (let k = 0; k < 8; k++) $("itKind").add(new Option(`${names.kinds[k]}${k < 5 ? "" : " (enhancer)"}`, k));
    $("refFurnace").innerHTML = ""; for (const f of myFurnaces) $("refFurnace").add(new Option(`#${f.id} · ${FURNACE[f.tier]} (${TIERS[f.tier]}, tier ${f.tier})`, f.id));
    if (!myFurnaces.length) $("refFurnace").add(new Option("no furnace yet", ""));
    renderStations();
    refreshSouls();
  }

  function pick(recipe, tier) {
    const ids = [], amts = [];
    for (let cat = 0; cat < 5; cat++) {
      let need = recipe[cat];
      for (let t = cat * 8; t < cat * 8 + 8 && need > 0; t++) {
        const have = inv.get(ing(t, tier)) || 0;
        if (!have) continue;
        const take = Math.min(have, need); ids.push(ing(t, tier)); amts.push(take); need -= take;
      }
      if (need > 0) return null;
    }
    return { ids, amts };
  }
  // recipes and odds are tunables that change only through the timelock: fetched in parallel once, then cached per deployment
  async function recipes() {
    const key = "alch.recipes." + dep.contracts.Workshop;
    try { const c = JSON.parse(localStorage.getItem(key) || "null"); if (c && c.v === 2 && Date.now() - c.at < 6 * 3600e3) return c.rc; } catch {}
    // the public RPC rate-limits bursts (and its 429 page carries a broken CORS header the browser rejects), so the
    // ~65 reads go out in sequential batches of 8, one HTTP request each, with a retry
    const N = (x) => Number(x);
    const tasks = [];
    for (let k = 0; k < 8; k++) for (let c = 0; c < 5; c++) tasks.push(["R", k, c, () => workshop.itemRecipe(k, c)]);
    for (let c = 0; c < 5; c++) tasks.push(["F", c, 0, () => workshop.furnaceRecipe(c)]);
    for (let i = 0; i < 4; i++) tasks.push(["refineSuccess", i, 0, () => workshop.refineSuccess(i)]);
    for (let i = 0; i < 5; i++) { tasks.push(["rerollOut", i, 0, () => workshop.rerollOutCategory(i)]); tasks.push(["rerollDown", i, 0, () => workshop.rerollDown(i)]); tasks.push(["keyChance", i, 0, () => workshop.keyChance(i)]); }
    tasks.push(["rerollUpPct", 0, 0, () => workshop.rerollUpPct()], ["rerollUp2", 0, 0, () => workshop.rerollUp2PerMille()], ["craftUp", 0, 0, () => workshop.craftUpgradePct()], ["furnaceBonus", 0, 0, () => workshop.furnaceBonus()], ["rerollOutAny", 0, 0, () => workshop.rerollOutAny().catch(() => 5n)]);
    const rc = { R: Array.from({ length: 8 }, () => [0, 0, 0, 0, 0]), F: [0, 0, 0, 0, 0], refineSuccess: [0, 0, 0, 0], rerollOut: [0, 0, 0, 0, 0], rerollDown: [0, 0, 0, 0, 0], keyChance: [0, 0, 0, 0, 0] };
    for (let i = 0; i < tasks.length; i += 8) {
      const chunk = tasks.slice(i, i + 8);
      let vals = null;
      for (let attempt = 0; attempt < 4 && !vals; attempt++) {
        try { vals = await Promise.all(chunk.map((t) => t[3]().then(N))); } catch (e) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
      }
      if (!vals) throw new Error("recipes: the RPC keeps failing");
      chunk.forEach(([key, a, b], j) => { if (key === "R") rc.R[a][b] = vals[j]; else if (Array.isArray(rc[key])) rc[key][a] = vals[j]; else rc[key] = vals[j]; });
    }
    try { localStorage.setItem(key, JSON.stringify({ v: 2, at: Date.now(), rc })); } catch {}
    return rc;
  }
  let RC = null, WS = { inputs: 10, cooldown: 600, paused: false };
  const CAT = ["metals", "minerals", "herbs", "woods", "beasts"];
  const CAT_TYPE = [0, 8, 16, 24, 32]; // a representative type per category (lead, sulphur, mandrake, oak, bone)
  const CAT_SHORT = ["met", "min", "herb", "wood", "beast"];
  const chip = (id, label, sub, cls = "", tier = 0) => `<div class="chip ${cls} t${tier}"><img class="px" src="metadata/${id}.png" alt=""><b>${label}</b><small>${sub || ""}</small></div>`;
  const chipImg = (src, label, sub, cls = "", tier = 0) => `<div class="chip ${cls} t${tier}"><img class="px" src="${src}" alt=""><b>${label}</b><small>${sub || ""}</small></div>`;
  const PLUS = `<span class="plus">+</span>`, ARROW = `<span class="arrow">→</span>`;
  const have = (id) => (inv && inv.get(id)) || 0;
  const haveCat = (cat, tier) => { let s = 0; for (let t = cat * 8; t < cat * 8 + 8; t++) s += have(ing(t, tier)); return s; };
  const okcls = (h, n) => (h >= n ? "ok" : "bad");
  const req = (label, h, n) => `<span class="${okcls(h, n)}">${label}: ${h} / ${n}</span>`;
  const badge = (label, ok) => `<span class="${ok ? "ok" : "bad"}">${label}</span>`;
  let station = "potion";
  function showStation(st) {
    station = st;
    for (const b of $("wsNav").querySelectorAll("button")) b.classList.toggle("on", b.dataset.st === st);
    for (const el of document.querySelectorAll(".ws-body .st")) el.classList.toggle("on", el.id === "st-" + st);
  }
  $("wsNav").onclick = (e) => { const b = e.target.closest("button"); if (b) showStation(b.dataset.st); };
  // recipe strips and requirement badges for the selected options of every station
  function renderStations() {
    if (!RC) return;
    const T = TIERS;
    // potion
    { const tier = +$("potTier").value || 1, a = +$("potA").value, b = +$("potB").value;
      const need = a === b ? 2 : 1;
      $("rc-potion").innerHTML = chip(ing(a, tier), names.types[a], T[tier], okcls(have(ing(a, tier)), need), tier) + PLUS + chip(ing(b, tier), names.types[b], T[tier], okcls(have(ing(b, tier)), a === b ? 2 : 1), tier) + ARROW + chip(1000 + tier, "Potion", T[tier], "", tier) + `<div class="odds">instant, no reveal<br>burns both herbs</div>`;
      $("rq-potion").innerHTML = req(names.types[a], have(ing(a, tier)), need) + (a !== b ? req(names.types[b], have(ing(b, tier)), 1) : "") + `<span>you have ${have(1000 + tier)} ${T[tier]} potion${have(1000 + tier) === 1 ? "" : "s"}</span>`;
      $("doPotion").disabled = !inv || have(ing(a, tier)) < need || (a !== b && have(ing(b, tier)) < 1); }
    // furnace
    { const tier = +$("furTier").value || 1;
      $("furImg").src = `img/furnace-${tier}.png`; $("navFurImg").src = `img/furnace-${tier}.png`;
      let html = "", ok = true;
      RC.F.forEach((n, c) => { if (!n) return; const h = haveCat(c, tier); ok = ok && h >= n; html += chip(ing(CAT_TYPE[c], tier), `${n} × ${CAT[c]}`, T[tier], okcls(h, n), tier) + PLUS; });
      html = html.replace(/<span class="plus">\+<\/span>$/, "") + ARROW + chipImg(`img/furnace-${tier}.png`, `${FURNACE[tier]} furnace`, `tier ${tier} · ${T[tier]}`, "", tier) + `<div class="odds">refines up to <b style="color:${TC[tier]}">${T[tier]}</b> ingredients<br>any types within a category<br>cooldown ${WS.cooldown} s per firing</div>`;
      $("rc-furnace").innerHTML = html;
      const fh = $("st-furnace").querySelector("h3"); fh.textContent = `Furnace · ${FURNACE[tier]} (${T[tier]})`; fh.style.color = TC[tier];
      $("rq-furnace").innerHTML = RC.F.map((n, c) => n ? req(`${CAT[c]} ${T[tier]}`, haveCat(c, tier), n) : "").join("") + `<span>you own ${myFurnaces.length} furnace${myFurnaces.length === 1 ? "" : "s"}${myFurnaces.length ? ": " + myFurnaces.map((f) => `${FURNACE[f.tier]} (${T[f.tier]})`).join(", ") : ""}</span>`;
      $("doFurnace").disabled = !inv || !ok; }
    // refining
    { const tier = +$("refTier").value || 1, t = +$("refType").value || 0, fid = +$("refFurnace").value;
      const f = myFurnaces.find((x) => x.id === fid);
      const n = WS.inputs, hIn = have(ing(t, tier)), hPot = have(1000 + tier);
      const fOk = !!f && f.tier >= tier, bonus = f && f.tier > tier ? RC.furnaceBonus : 0;
      const p = Math.min(100, RC.refineSuccess[tier - 1] + bonus);
      $("rc-refine").innerHTML = chip(ing(t, tier), `${n} × ${names.types[t]}`, T[tier], okcls(hIn, n), tier) + PLUS + chip(1000 + tier, "Potion", T[tier], okcls(hPot, 1), tier) + PLUS + chipImg(`img/furnace-${f ? f.tier : tier}.png`, f ? `${FURNACE[f.tier]} #${f.id}` : `${FURNACE[tier]} furnace`, f ? `${T[f.tier]} furnace` : `${T[tier]} or better needed`, f ? (fOk ? "ok" : "bad") : "bad", f ? f.tier : tier) + ARROW + chip(ing(t, tier + 1), names.types[t], T[tier + 1], "", tier + 1) + `<div class="odds">success <b>${p} %</b>${bonus ? ` (incl. +${bonus} % hot furnace)` : ""}<br>on failure the inputs are lost</div>`;
      $("rq-refine").innerHTML = req(`${names.types[t]} ${T[tier]}`, hIn, n) + req(`${T[tier]} potion`, hPot, 1) + badge(f ? `${FURNACE[f.tier]} furnace (${T[f.tier]}) ${fOk ? "can" : "cannot"} refine ${T[tier]}` : `no furnace: a ${FURNACE[tier]} (${T[tier]}) or better is needed`, fOk);
      $("refDesc").textContent = `${n} ingredients of one type and tier plus a potion of that tier go into a furnace; on success one ingredient of the next tier comes out. The count follows the heat of the network (10 at the corridor floor, fewer when it is hot). The result is sealed until the next minute's challenge.`;
      $("doRefine").disabled = !inv || hIn < n || hPot < 1 || !fOk; }
    // crucible
    { const tier = +$("rrTier").value || 1, cat = +$("rrCat").value;
      let total = 0; for (let x = 0; x < 40; x++) total += have(ing(x, tier));
      const out = cat === 255 ? RC.rerollOutAny : RC.rerollOut[tier - 1];
      const outId = cat === 255 ? 1000 + tier : ing(CAT_TYPE[cat], tier);
      $("rc-reroll").innerHTML = chip(ing(CAT_TYPE[0], tier), `10 × any`, T[tier], okcls(total, 10), tier) + ARROW + (cat === 255 ? chipImg("img/crucible.png", `${out} × random`, T[tier]) : chip(outId, `${out} × ${CAT[cat]}`, T[tier], "", tier)) + `<div class="odds">each piece: tier up <b>${RC.rerollUpPct} %</b>, two up <b>${RC.rerollUp2 / 10} %</b><br>tier down <b>${RC.rerollDown[tier - 1]} %</b>${tier === 5 ? " · Legendary cannot rise" : ""}</div>`;
      $("rq-reroll").innerHTML = req(`${T[tier]} ingredients of any type`, total, 10);
      $("doReroll").disabled = !inv || total < 10; }
    // ritual table
    { const k = +$("itKind").value || 0, tier = +$("itTier").value || 1;
      const rec = RC.R[k];
      $("itImg").src = `metadata/${item(k, tier)}.png`; $("navItImg").src = `metadata/${item(k, tier)}.png`;
      let html = "", ok = true;
      rec.forEach((n, c) => { if (!n) return; const h = haveCat(c, tier); ok = ok && h >= n; html += chip(ing(CAT_TYPE[c], tier), `${n} × ${CAT[c]}`, T[tier], okcls(h, n), tier) + PLUS; });
      html = html.replace(/<span class="plus">\+<\/span>$/, "") + ARROW + chip(item(k, tier), names.kinds[k], T[tier], "", tier) + `<div class="odds">tier up <b>${RC.craftUp} %</b><br>mythic key <b>1 in ${RC.keyChance[tier - 1].toLocaleString("en")}</b> (${T[tier]})</div>`;
      $("rc-item").innerHTML = html;
      $("rq-item").innerHTML = rec.map((n, c) => n ? req(`${CAT[c]} ${T[tier]}`, haveCat(c, tier), n) : "").join("") + `<span>${k < 5 ? "required for the summoning" : "optional enhancer"}</span>`;
      $("doItem").disabled = !inv || !ok; }
    renderSoul();
  }
  // ---- the soul altar: eight pedestals in a ring; a pedestal opens a picker of the items the wallet holds for that kind
  let mySoulIds = [], myKeys = [], soulsBusy = false;
  const soulPick = { tiers: [0, 0, 0, 0, 0, 0, 0, 0], keyIdx: 255, open: -1 }; // -1 none, 0..7 a pedestal, 8 the key
  const PED_POS = [[50, 11], [77, 22], [89, 49], [77, 76], [50, 86], [23, 76], [11, 49], [23, 22]]; // percent of the altar box, clockwise from the top
  function soulPlan() {
    return { ids: soulPick.tiers.map((t, k) => (t ? item(k, t) : 0)), tiers: soulPick.tiers.slice(), keyIdx: soulPick.keyIdx };
  }
  function altarInit() {
    if ($("altarRing").children.length) return;
    $("altarRing").innerHTML = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<div class="ped ${k < 5 ? "req" : ""} empty" data-k="${k}" style="left:${PED_POS[k][0]}%;top:${PED_POS[k][1]}%"><div class="slot"></div><b>${names.kinds[k]}</b><small>${k < 5 ? "required" : "enhancer"}</small></div>`).join("");
    $("altarRing").onclick = (e) => { const p = e.target.closest(".ped"); if (!p) return; soulPick.open = soulPick.open === +p.dataset.k ? -1 : +p.dataset.k; renderSoul(); };
    $("altarPick").onclick = (e) => { const o = e.target.closest("button.opt"); if (!o) return; const k = soulPick.open; if (k === 8) soulPick.keyIdx = +o.dataset.v; else { soulPick.tiers[k] = +o.dataset.v; const kk = soulPick.keyIdx !== 255 ? names.keys[soulPick.keyIdx].kind : -1; if (kk === k && soulPick.tiers[k]) soulPick.keyIdx = 255; } soulPick.open = -1; renderSoul(); };
  }
  function renderSoul() {
    if (!soulsC || !inv) return;
    altarInit();
    // drop picks the wallet no longer holds
    soulPick.tiers = soulPick.tiers.map((t, k) => (t && have(item(k, t)) ? t : 0));
    if (soulPick.keyIdx !== 255 && !myKeys.includes(soulPick.keyIdx)) soulPick.keyIdx = 255;
    const keySlot = soulPick.keyIdx !== 255 ? names.keys[soulPick.keyIdx].kind : -1;
    let sum = 0, ok = true;
    for (let k = 0; k < 8; k++) {
      const ped = $("altarRing").children[k], t = soulPick.tiers[k], isKey = k === keySlot;
      const tier = isKey ? 6 : t;
      ped.className = `ped ${k < 5 ? "req" : ""} ${isKey ? "key on" : t ? "on" : "empty"} t${tier}`;
      ped.querySelector(".slot").innerHTML = isKey ? `<img class="px" src="${keyImg(KEY_ID + soulPick.keyIdx)}" alt="">` : t ? `<img class="px" src="metadata/${item(k, t)}.png" alt="">` : "";
      ped.querySelector("small").textContent = isKey ? names.keys[soulPick.keyIdx].key : t ? TIERS[t] : k < 5 ? "required" : "empty · Common";
      if (isKey) sum += 5; else if (t) sum += t; else { sum += 1; if (k < 5) ok = false; }
    }
    const avg = sum / 8, rank = keySlot >= 0 ? 6 : Math.floor(avg);
    const rarity = keySlot >= 0 ? 16 : Math.pow(2, avg - 1);
    const n = Number($("soulCount").dataset.n || 0), nextId = n + 1, early = nextId >= 100 ? 1 : 2 - (nextId - 1) / 99;
    const core = $("altarCore"); core.className = `altar-core t${rank}`;
    $("altarSoul").src = `metadata/souls/${rank}.png`; $("soulImg").src = `metadata/souls/${rank}.png`;
    $("altarRank").textContent = `${RANKS[rank]}${keySlot >= 0 ? " · " + names.keys[soulPick.keyIdx].alchemist : ""}`;
    $("altarNum").textContent = `soul #${nextId} if sealed now`;
    $("altarStats").innerHTML = `<div><b>average tier</b><span>${avg.toFixed(2)}</span></div><div><b>rarity</b><span>×${rarity.toFixed(2)}</span></div><div><b>early, #${nextId}</b><span>×${early.toFixed(2)}</span></div><div><b>stream weight</b><span class="g">${(rarity * early).toFixed(2)}</span></div>`;
    // the picker for the open pedestal (or the key)
    const pk = $("altarPick");
    if (soulPick.open < 0) pk.style.display = "none";
    else {
      const k = soulPick.open;
      let html;
      if (k === 8) html = `<h4>mythic key</h4><div class="opts"><button class="opt clear" data-v="255">none</button>${myKeys.map((i) => `<button class="opt t6" data-v="${i}"><img class="px" src="${keyImg(KEY_ID + i)}" alt="">${names.keys[i].key} · ${names.kinds[names.keys[i].kind]}</button>`).join("")}</div>`;
      else {
        const opts = []; for (let t = 1; t <= 5; t++) if (have(item(k, t))) opts.push(`<button class="opt t${t}" data-v="${t}"><img class="px" src="metadata/${item(k, t)}.png" alt="">${TIERS[t]} ${names.kinds[k]} <small>×${have(item(k, t))}</small></button>`);
        const keyOpt = myKeys.filter((i) => names.keys[i].kind === k).map((i) => `<button class="opt t6" data-v="key${i}"><img class="px" src="${keyImg(KEY_ID + i)}" alt="">${names.keys[i].key} (key)</button>`).join("");
        html = `<h4>${names.kinds[k]} · ${k < 5 ? "required" : "enhancer, empty counts as Common"}</h4><div class="opts"><button class="opt clear" data-v="0">${k < 5 ? "leave empty" : "empty (Common)"}</button>${opts.join("")}${keyOpt}</div>${opts.length || keyOpt ? "" : `<p class="small">no ${names.kinds[k].toLowerCase()} in this wallet: craft one at the ritual table</p>`}`;
      }
      pk.innerHTML = html; pk.style.display = "";
      // a key offered from a pedestal picker
      pk.querySelectorAll('button.opt[data-v^="key"]').forEach((bt) => { bt.onclick = (e) => { e.stopPropagation(); soulPick.keyIdx = +bt.dataset.v.slice(3); soulPick.tiers[k] = 0; soulPick.open = -1; renderSoul(); }; });
    }
    $("soulHint").textContent = ok ? "the eight items and the key burn · sealing is free" : "fill the five required pedestals: grimoire, candle, chalice, seal, scepter";
    $("doSoul").disabled = !ok;
  }
  async function refreshSouls() {
    if (!soulsC || soulsBusy) return;
    soulsBusy = true;
    try {
      const total = Number(await soulsC.total());
      $("soulCount").textContent = `${total} sealed`; $("soulCount").dataset.n = total;
      mySoulIds = [];
      for (let i = 1; i <= total; i += 8) { const rs = await Promise.all(Array.from({ length: Math.min(8, total - i + 1) }, (_, j) => soulsC.ownerOf(i + j).catch(() => null))); rs.forEach((o, j) => { if (o && o.toLowerCase() === me.toLowerCase()) mySoulIds.push(i + j); }); }
      myKeys = []; for (let i = 0; i < 21; i++) if (inv && inv.get(KEY_ID + i)) myKeys.push(i);
      let open = false, openAt = 100, claimable = 0n;
      if (streamC) { try { [open, openAt] = await Promise.all([streamC.isOpen(), streamC.openAt().then(Number)]); } catch {} }
      const cards = [];
      for (const id of mySoulIds) {
        let d = null, w = 0n, c = 0n;
        try { [d, w] = await Promise.all([soulsC.data(id), soulsC.weight(id)]); if (streamC) c = await streamC.claimable(0, id); } catch {}
        claimable += c;
        const rank = d ? Number(d.rank) : 0;
        cards.push(`<div class="card t${rank}"><img class="px" src="metadata/souls/${rank}.png" alt=""><div class="t">${RANKS[rank]} #${id}</div><div class="s">weight ${(Number(w) / 1e6).toFixed(2)}${c > 0n ? ` · ${fmtEth(c, 6)} ETH` : ""}</div></div>`);
      }
      $("mySouls").innerHTML = cards.join("") || `<span class="small">no souls in this wallet yet</span>`;
      $("streamCount").innerHTML = `${total}<small>/ ${openAt}</small>`;
      $("streamBar").querySelector("i").style.width = Math.min(100, (100 * total) / openAt).toFixed(1) + "%";
      $("streamState").textContent = open ? "the stream is open" : `opens at the ${openAt === 100 ? "hundredth" : openAt + "th"} soul`;
      $("streamState").className = "tag" + (open ? " on" : "");
      $("doClaim").disabled = !open || claimable === 0n;
      $("claimHint").textContent = claimable > 0n ? `${fmtEth(claimable, 6)} ETH claimable` : mySoulIds.length ? "nothing to claim yet" : "";
      renderSoul();
    } catch (e) { log("souls: " + (e.shortMessage || e.message), "warn"); }
    finally { soulsBusy = false; }
  }
  $("doSoul").onclick = async () => {
    if (!soulsC || !inv) return;
    const p = soulPlan();
    const rc = await tx("seal a soul", () => C("Souls", signer).seal(p.ids, p.keyIdx, { gasLimit: GAS.ws }));
    if (rc) { let ev = null; for (const l of rc.logs) { try { ev = soulsC.interface.parseLog(l); } catch {} if (ev && ev.name === "Sealed") break; } if (ev) { const id = Number(ev.args.id); const rank = Number(ev.args.rank); log(`soul #${id} sealed: ${RANKS[rank]}`); await sealingRite(rank); soulPick.tiers = [0, 0, 0, 0, 0, 0, 0, 0]; soulPick.keyIdx = 255; } }
    await refreshInventory(); // refreshes the souls too
  };
  // the rite: every pedestal's item flies into the centre, the ring flares, the soul of the new rank rises with sparks
  function sealingRite(rank) {
    return new Promise((done) => {
      const altar = $("altar"), core = $("altarCore");
      if (!altar.getBoundingClientRect) return done();
      const c = core.getBoundingClientRect();
      for (const ped of $("altarRing").children) { const img = ped.querySelector(".slot img"); if (!img) continue; const r = img.getBoundingClientRect(); img.style.setProperty("--dx", `${Math.round(c.left + c.width / 2 - r.left - r.width / 2)}px`); img.style.setProperty("--dy", `${Math.round(c.top + c.height / 2 - r.top - r.height / 2)}px`); }
      core.className = `altar-core t${rank}`; $("altarSoul").src = `metadata/souls/${rank}.png`; $("altarRank").textContent = RANKS[rank];
      altar.classList.add("rite");
      const a = altar.getBoundingClientRect();
      setTimeout(() => { for (let i = 0; i < 26; i++) { const s = document.createElement("i"); s.className = "rite-spark"; s.style.left = `${a.width / 2}px`; s.style.top = `${a.height / 2}px`; const ang = (i / 26) * Math.PI * 2, d = 90 + Math.random() * 120; s.style.setProperty("--sx", `${Math.round(Math.cos(ang) * d)}px`); s.style.setProperty("--sy", `${Math.round(Math.sin(ang) * d)}px`); s.style.setProperty("--tc", `var(--c${rank})`); altar.appendChild(s); setTimeout(() => s.remove(), 1300); } }, 1000);
      setTimeout(() => { altar.classList.remove("rite"); for (const img of altar.querySelectorAll(".slot img")) { img.style.animation = "none"; } done(); }, 2600);
    });
  }
  $("doClaim").onclick = async () => {
    if (!streamC || !mySoulIds.length) return;
    await tx(`claim for ${mySoulIds.length} soul${mySoulIds.length > 1 ? "s" : ""}`, () => C("Stream", signer).claimMany(0, mySoulIds, { gasLimit: 200_000n + 120_000n * BigInt(mySoulIds.length) }));
    await refreshSouls(); refreshBurner();
  };
  for (const id of ["potTier", "potA", "potB", "furTier", "refFurnace", "refType", "refTier", "rrTier", "rrCat", "itKind", "itTier"]) $(id).addEventListener("change", renderStations);
  async function refreshWorkshop() {
    try {
      const [inputs, cooldown, paused] = await Promise.all([workshop.refineInputs(), workshop.furnaceCooldown(), workshop.paused()]);
      RC = RC || (await recipes());
      WS = { inputs: Number(inputs), cooldown: Number(cooldown), paused: !!paused };
      $("wsStatus").textContent = paused ? "PAUSED" : `running · ${inputs} inputs per refine`;
      $("wsStatus").className = "tag" + (paused ? " warn" : " on");
      renderStations();
      const n = Number(await workshop.commitCount());
      let open = [];
      for (let i = Math.max(0, n - 200); i < n; i++) { const c = await workshop.commits(i); if (!c.settled && c.user.toLowerCase() === me.toLowerCase()) open.push(i); }
      $("commits").textContent = `crafts to reveal: ${open.length}`;
      $("commits").className = "pill" + (open.length ? " on" : "");
      $("revealWs").disabled = !open.length;
      $("revealWs").dataset.ids = JSON.stringify(open);
    } catch (e) { log("workshop: " + (e.shortMessage || e.message), "warn"); }
  }

  // ------------------------------------------------------------ main wallet
  async function connect() {
    if (!window.ethereum) { log("no wallet found: MetaMask or a compatible wallet is required", "warn"); return; }
    const bp = new ethers.BrowserProvider(window.ethereum);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ethers.toBeHex(dep.chainId) }] });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: ethers.toBeHex(dep.chainId), chainName: dep.chainName, rpcUrls: [dep.rpc], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [dep.explorer] }] });
      }
    }
    try {
      const s = await bp.getSigner();
      main = { signer: s, address: await s.getAddress() };
      $("who").textContent = main.address;
      for (const id of ["connect", "connect2", "connect3"]) { const b = $(id); b.textContent = id === "connect" ? `Connected · ${short(main.address)}` : "Connected"; b.className = "btn done"; b.disabled = true; }
      $("invWho").querySelector('option[value="main"]').disabled = false;
      $("wsWho").querySelector('option[value="main"]').disabled = false;
      log(`wallet ${main.address}`);
      document.body.classList.add("connected");
      try { localStorage.setItem("alch.wallet", "1"); } catch {}
      syncSignerUi();
      setMode("main");
    } catch (e) { log("connect: " + (e.shortMessage || e.message), "warn"); }
  }

  async function tx(label, fn) {
    try {
      log(`${label}: sending…`);
      const t = await fn();
      log(`${label}: tx ${t.hash}`);
      const rc = await t.wait();
      log(`${label}: ${rc.status === 1 ? "done" : "REVERTED"} (gas ${rc.gasUsed})`);
      await refreshAll();
      return rc;
    } catch (e) { log(`${label}: ${e.reason || e.shortMessage || e.message}`, "warn"); return null; }
  }
  function minedIds(rc) {
    const out = [];
    for (const l of rc.logs) { let ev = null; try { ev = mine.interface.parseLog(l); } catch {} if (!ev) continue; if (ev.name === "Mined") out.push(Number(ev.args.id)); if (ev.name === "KeyMined") out.push(3000 + Number(ev.args.keyIndex)); }
    return out;
  }
  function minedFrom(rc) {
    const out = [];
    for (const l of rc.logs) { let ev = null; try { ev = mine.interface.parseLog(l); } catch {} if (!ev) continue; if (ev.name === "Mined") out.push(`${TIERS[Number(ev.args.tier)]} ${names.types[Number(ev.args.typeId)]}${ev.args.upgraded ? " (upgraded)" : ""}`); if (ev.name === "KeyMined") out.push("MYTHIC KEY " + names.keys[Number(ev.args.keyIndex)].key); }
    return out;
  }

  // ------------------------------------------------------------ actions
  $("connect").onclick = connect;
  $("connect2").onclick = connect;
  $("connect4").onclick = connect;
  $("connect5").onclick = connect;
  // a wallet that was connected before comes back silently: eth_accounts never pops anything up
  if (window.ethereum) { try { if (localStorage.getItem("alch.wallet") === "1") { const accs = await window.ethereum.request({ method: "eth_accounts" }); if (accs && accs.length) await connect(); } } catch {} }
  if (window.ethereum) window.ethereum.on && window.ethereum.on("accountsChanged", (accs) => { if (!accs || !accs.length) { try { localStorage.removeItem("alch.wallet"); } catch {} location.reload(); } else connect(); });
  $("revealMine").onclick = async () => {
    revealStatus("Revealing… confirm in your wallet if it asks.");
    const rc = await tx("reveal finds", () => C("Mine", signer).reveal(me, { gasLimit: GAS.reveal }));
    if (!rc) { revealStatus("The reveal did not go through, see the log.", "warn"); return; }
    if (rc.status !== 1) { revealStatus("The reveal transaction reverted.", "warn"); return; }
    const got = minedFrom(rc);
    for (const id of minedIds(rc)) miner.addResult(id, "reveal");
    revealStatus(got.length ? `Revealed: ${got.join(", ")}. It is in the inventory below.` : "Nothing was ready yet: the find needs the next minute's challenge before it can be revealed. Wait for the timer and try again.", got.length ? "on" : "warn");
  };
  $("revealWs").onclick = () => { const ids = JSON.parse($("revealWs").dataset.ids || "[]"); tx(`reveal crafts ${ids.join(",")}`, () => C("Workshop", signer).revealMany(ids, { gasLimit: GAS.revealMany })); };
  $("doPotion").onclick = () => { const tier = +$("potTier").value; tx(`potion ${TIERS[tier]}`, () => C("Workshop", signer).craftPotion(tier, ing(+$("potA").value, tier), ing(+$("potB").value, tier), { gasLimit: GAS.ws })); };
  $("doFurnace").onclick = () => { const tier = +$("furTier").value; if (!inv) return; const p = pick(RC.F, tier); if (!p) { $("furHint").textContent = "not enough ingredients of this tier for the recipe"; return; } $("furHint").textContent = ""; tx(`furnace tier ${tier}`, () => C("Workshop", signer).craftFurnace(tier, p.ids, p.amts, { gasLimit: GAS.ws })); };
  $("doRefine").onclick = () => { const f = +$("refFurnace").value, t = +$("refType").value, tier = +$("refTier").value; if (!f) { $("refHint").textContent = "a furnace is required"; return; } $("refHint").textContent = ""; tx(`refine ${names.types[t]} ${TIERS[tier]} → ${TIERS[tier + 1]}`, () => C("Workshop", signer).refine(f, t, tier, { gasLimit: GAS.ws })); };
  $("doReroll").onclick = () => { const tier = +$("rrTier").value, cat = +$("rrCat").value; if (!inv) return; const ids = [], amts = []; let need = 10; for (let t = 0; t < 40 && need > 0; t++) { const h = inv.get(ing(t, tier)) || 0; if (!h) continue; const take = Math.min(h, need); ids.push(ing(t, tier)); amts.push(take); need -= take; } if (need > 0) { log("10 ingredients of this tier are required", "warn"); return; } tx(`reroll ${TIERS[tier]}`, () => C("Workshop", signer).reroll(tier, cat, ids, amts, { gasLimit: GAS.ws })); };
  $("doItem").onclick = () => { const k = +$("itKind").value, tier = +$("itTier").value; if (!inv) return; const p = pick(RC.R[k], tier); if (!p) { $("itHint").textContent = `recipe: met/min/herb/wood/beast = ${RC.R[k].join("/")} of tier ${TIERS[tier]}`; return; } $("itHint").textContent = ""; tx(`craft ${names.kinds[k]} ${TIERS[tier]}`, () => C("Workshop", signer).craftItem(k, tier, p.ids, p.amts, { gasLimit: GAS.ws })); };

  async function refreshAll() { await refreshMine(); await refreshWorkshop(); await refreshInventory(); }
  fillSelects(); renderInventory();
  $("invWhoAddr").textContent = short(me);
  await refreshMine();
  setInterval(tickClock, 1000); tickClock();
  setInterval(refreshMine, 30000); // the minute boundary triggers its own refresh; this only catches price and pressure drift
  setInterval(refreshInventory, 90000);
  await refreshInventory();
  await refreshWorkshop();
  log(`loaded: Mine ${dep.contracts.Mine}; miner wallet ${burner.address}`);
})();
