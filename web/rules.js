// Rules page: static explanations plus the live tunables read from the contracts (batched small, chunked, cached like the dapp).
(async () => {
  const $ = (id) => document.getElementById(id);
  const TIERS = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
  const CLS = ["", "tier-c", "tier-u", "tier-r", "tier-e", "tier-l", "tier-m"];
  const FURNACE = ["", "Clay", "Iron", "Brass", "Athanor"];
  const T = (t) => `<span class="${CLS[t]}">${TIERS[t]}</span>`;
  const fmtHs = (h) => h >= 1e12 ? `${(h / 1e12).toFixed(1)} TH/s` : h >= 1e9 ? `${(h / 1e9).toFixed(1)} GH/s` : h >= 1e6 ? `${(h / 1e6).toFixed(0)} MH/s` : `${h} H/s`;
  let names = null;
  try {
    names = await (await fetch("./names.json", { cache: "no-cache" })).json();
    const dep = await (await fetch("./deployment.json", { cache: "no-cache" })).json();
    const abi = {};
    for (const n of ["Mine", "Workshop"]) abi[n] = await (await fetch(`./abi/${n}.json`, { cache: "no-cache" })).json();
    const provider = AlchRpc.create(dep.rpcs || [dep.rpc], dep.chainId);
    const mine = new ethers.Contract(dep.contracts.Mine, abi.Mine, provider);
    const ws = new ethers.Contract(dep.contracts.Workshop, abi.Workshop, provider);
    $("src").textContent = `Values read live from ${dep.chainName}: Mine ${dep.contracts.Mine}, Workshop ${dep.contracts.Workshop}.`;

    // sequential chunks of 8 reads: the public RPC dislikes bursts
    const N = (x) => Number(x);
    const tasks = [];
    tasks.push(["cfg", () => mine.config()], ["inputs", () => ws.refineInputs().then(N)], ["cooldown", () => ws.furnaceCooldown().then(N)], ["bonus", () => ws.furnaceBonus().then(N)],
      ["upPct", () => ws.rerollUpPct().then(N)], ["up2", () => ws.rerollUp2PerMille().then(N)], ["craftUp", () => ws.craftUpgradePct().then(N)], ["outAny", () => ws.rerollOutAny().then(N).catch(() => 5)]);
    for (let i = 0; i < 4; i++) tasks.push([`refineSuccess.${i}`, () => ws.refineSuccess(i).then(N)]);
    for (let i = 0; i < 5; i++) { tasks.push([`rerollOut.${i}`, () => ws.rerollOutCategory(i).then(N)], [`rerollDown.${i}`, () => ws.rerollDown(i).then(N)], [`keyChance.${i}`, () => ws.keyChance(i).then(N)], [`F.${i}`, () => ws.furnaceRecipe(i).then(N)]); }
    for (let k = 0; k < 8; k++) for (let c = 0; c < 5; c++) tasks.push([`R.${k}.${c}`, () => ws.itemRecipe(k, c).then(N)]);
    const v = {};
    for (let i = 0; i < tasks.length; i += 8) {
      const chunk = tasks.slice(i, i + 8);
      let vals = null;
      for (let a = 0; a < 4 && !vals; a++) { try { vals = await Promise.all(chunk.map((t) => t[1]())); } catch { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); } }
      if (!vals) throw new Error("RPC keeps failing");
      chunk.forEach(([k], j) => { v[k] = vals[j]; });
    }
    const cfg = v.cfg;
    const floorB = N(cfg.floorBitsQ8) / 256, ceilB = N(cfg.ceilBitsQ8) / 256;
    $("r-corridor").textContent = `${floorB} … ${ceilB} bits`;
    $("r-retarget").textContent = `every ${N(cfg.windowSec)} s (${N(cfg.windowSecEarly)} s in the first hour), at most ${N(cfg.maxStepQ8) / 256} bits per step (${N(cfg.maxStepEarlyQ8) / 256} early), aiming at ${N(cfg.kPerHour).toLocaleString("en")} mints per hour from the estimated network hashrate`;
    $("r-extras").innerHTML = `every N minted pieces of a type at a tier raise that tier's bar for that type by one bit: N = ${[2, 3, 4, 5].map((t) => `${N(cfg.extraK[t - 2])} for ${T(t)}`).join(", ")}`;
    $("r-unlocks").innerHTML = [2, 3, 4, 5].map((t) => `${T(t)} at ${fmtHs(N(cfg.unlockHashrate[t - 2]))}`).join(", ") + " of estimated network hashrate, permanently";
    $("r-upgrade").textContent = `1 in ${N(cfg.upgradeChance)} reveals come out one tier higher`;
    $("r-key").textContent = `1 in ${N(cfg.keyChance).toLocaleString("en")} reveals drops an unclaimed mythic key`;
    $("r-price").textContent = `${ethers.formatEther(cfg.price0)} ETH × (1 + √(E / ${N(cfg.priceD).toLocaleString("en")})) × network pressure, where E is mined minus burned; no ceiling`;
    $("r-ore").textContent = `${N(cfg.oreR0).toLocaleString("en")} ore in the vein; every submit consumes one; K halves at 50 %, 25 % and 12.5 % left (never below one mint per window); the vein is exhausted at 0`;
    $("r-farm").textContent = `K × (1 + log2(hashrate / ${fmtHs(N(cfg.refHashrate))})) above the reference, capped at ×${N(cfg.mCapQ8) / 256}`;
    $("r-inputs").textContent = String(v.inputs);
    $("r-inputs2").textContent = `right now ${v.inputs}; 10 at the corridor floor, down to 6 at the ceiling`;
    const F = [0, 1, 2, 3, 4].map((c) => v[`F.${c}`]);
    const cats = names.categories;
    const rec = (arr) => arr.map((n, c) => n ? `${n} ${cats[c].toLowerCase()}` : "").filter(Boolean).join(" + ");
    for (let t = 1; t <= 4; t++) $("t-furnace").insertAdjacentHTML("beforeend", `<tr><td><img class="px" src="img/furnace-${t}.png" alt="" style="width:32px;height:32px;vertical-align:middle;margin-right:8px">${FURNACE[t]}</td><td>${rec(F)} of ${T(t)}</td><td>up to ${T(t)}</td><td class="mono">${v.cooldown} s</td></tr>`);
    for (let t = 1; t <= 4; t++) $("t-refine").insertAdjacentHTML("beforeend", `<tr><td>${T(t)} → ${T(t + 1)}</td><td class="mono">${v[`refineSuccess.${t - 1}`]} %</td><td class="mono">+${v.bonus} % with a furnace above ${TIERS[t]}</td></tr>`);
    for (let t = 1; t <= 5; t++) $("t-reroll").insertAdjacentHTML("beforeend", `<tr><td>${T(t)}</td><td class="mono">${v.outAny}</td><td class="mono">${v[`rerollOut.${t - 1}`]}</td><td class="mono">${t === 5 ? "—" : v.upPct + " %"}</td><td class="mono">${t === 5 ? "—" : (v.up2 / 10) + " %" + (t === 4 ? " (capped at Legendary)" : "")}</td><td class="mono">${v[`rerollDown.${t - 1}`]} %</td></tr>`);
    for (let k = 0; k < 8; k++) $("t-items").insertAdjacentHTML("beforeend", `<tr><td><img class="px" src="metadata/${2000 + k * 8 + 1}.png" alt="" style="width:32px;height:32px;vertical-align:middle;margin-right:8px">${names.kinds[k]}</td>${[0, 1, 2, 3, 4].map((c) => `<td class="mono">${v[`R.${k}.${c}`] || ""}</td>`).join("")}<td>${k < 5 ? "required" : "enhancer"}</td></tr>`);
    for (let t = 1; t <= 5; t++) $("t-craft").insertAdjacentHTML("beforeend", `<tr><td>${T(t)}</td><td class="mono">${v.craftUp} %</td><td class="mono">1 in ${v[`keyChance.${t - 1}`].toLocaleString("en")}</td></tr>`);
    $("live").textContent = "live values"; $("live").className = "tag on";
  } catch (e) {
    $("live").textContent = "showing design values"; $("live").className = "tag warn";
    if (!names) { try { names = await (await fetch("./names.json", { cache: "no-cache" })).json(); } catch {} }
  }
  if (names) for (let i = 0; i < 21; i++) { const k = names.keys[i]; $("t-keys").insertAdjacentHTML("beforeend", `<tr class="keyrow"><td><img class="px" src="metadata/keys/${i}.png" alt="">${k.key}</td><td>${k.alchemist}</td><td>${names.kinds[k.kind]}</td></tr>`); }
})();
