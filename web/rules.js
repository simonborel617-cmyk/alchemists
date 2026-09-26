// Rules page: static explanations plus the live tunables read from the contracts (one Multicall3 call, like the dapp).
(async () => {
  const $ = (id) => document.getElementById(id);
  const TIERS = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
  const CLS = ["", "tier-c", "tier-u", "tier-r", "tier-e", "tier-l", "tier-m"];
  const FURNACE = ["", "Clay", "Iron", "Brass", "Athanor"];
  const T = (t) => `<span class="${CLS[t]}">${TIERS[t]}</span>`;
  const fmtHs = (h) => h >= 1e12 ? `${(h / 1e12).toFixed(1)} TH/s` : h >= 1e9 ? `${(h / 1e9).toFixed(1)} GH/s` : h >= 1e6 ? `${(h / 1e6).toFixed(0)} MH/s` : `${h} H/s`;
  let names = null;
  try {
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => r.json());
    const [n0, dep, mineAbi, wsAbi] = await Promise.all([get("./names.json"), get("./deployment.json"), get("./abi/Mine.json"), get("./abi/Workshop.json")]);
    names = n0;
    const abi = { Mine: mineAbi, Workshop: wsAbi };
    const provider = AlchRpc.create(dep.rpcs || [dep.rpc], dep.chainId, { readUrls: dep.readRpcs || [], logUrls: dep.logRpcs || [] });
    const mine = new ethers.Contract(dep.contracts.Mine, abi.Mine, provider);
    const ws = new ethers.Contract(dep.contracts.Workshop, abi.Workshop, provider);
    $("src").textContent = `Values read live from ${dep.chainName}: Mine ${dep.contracts.Mine}, Workshop ${dep.contracts.Workshop}.`;

    // every read in one Multicall3 call (one request: the public RPC dislikes bursts), retried while a read without a
    // default fails; tasks are [key, [contract, fn, args], default for a read that may revert]
    const N = (x) => Number(x);
    const tasks = [];
    tasks.push(["cfg", [mine, "config", []]], ["inputs", [ws, "refineInputs", []]], ["cooldown", [ws, "furnaceCooldown", []]], ["bonus", [ws, "furnaceBonus", []]],
      ["upPct", [ws, "rerollUpPct", []]], ["up2", [ws, "rerollUp2PerMille", []]], ["craftUp", [ws, "craftUpgradePct", []]], ["outAny", [ws, "rerollOutAny", []], 5]);
    for (let i = 0; i < 4; i++) tasks.push([`refineSuccess.${i}`, [ws, "refineSuccess", [i]]]);
    for (let i = 0; i < 5; i++) { tasks.push([`rerollOut.${i}`, [ws, "rerollOutCategory", [i]]], [`rerollDown.${i}`, [ws, "rerollDown", [i]]], [`keyChance.${i}`, [ws, "keyChance", [i]]], [`F.${i}`, [ws, "furnaceRecipe", [i]]]); }
    for (let k = 0; k < 8; k++) for (let c = 0; c < 5; c++) tasks.push([`R.${k}.${c}`, [ws, "itemRecipe", [k, c]]]);
    let got = null;
    for (let a = 0; a < 4 && !got; a++) {
      const r = await AlchRpc.multicall(provider, tasks.map((t) => t[1]), { address: dep.multicall3 });
      if (r.every((x, j) => x !== null || tasks[j][2] !== undefined)) got = r;
      else await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
    }
    if (!got) throw new Error("RPC keeps failing");
    const v = {};
    tasks.forEach(([k, , d], j) => { const x = got[j]; v[k] = k === "cfg" ? x : Number(x ?? d); });
    const cfg = v.cfg;
    const floorB = N(cfg.floorBitsQ8) / 256, ceilB = N(cfg.ceilBitsQ8) / 256;
    $("r-corridor").textContent = `${floorB} … ${ceilB} bits`;
    $("r-retarget").textContent = `every ${N(cfg.windowSec)} s (${N(cfg.windowSecEarly)} s in the first hour), at most ${N(cfg.maxStepQ8) / 256} bits per step (${N(cfg.maxStepEarlyQ8) / 256} early), aiming at ${N(cfg.kPerHour).toLocaleString("en")} mints per hour from the estimated network hashrate`;
    $("r-extras").innerHTML = `every N minted pieces of a type at a tier add one bit to the roll that tier needs for that type: N = ${[2, 3, 4, 5].map((t) => `${N(cfg.extraK[t - 2])} for ${T(t)}`).join(", ")}`;
    $("r-unlocks").innerHTML = [2, 3, 4, 5].map((t) => `${T(t)} at the ${N(cfg.unlockFinds[t - 2]).toLocaleString("en")}th find`).join(", ") + " of the season, permanently; until then a find stops at the highest open tier (the 1 in 16 upgrade can still lift it one tier)";
    $("r-upgrade").textContent = `1 in ${N(cfg.upgradeChance)} reveals come out one tier higher`;
    $("r-key").textContent = `1 in ${N(cfg.keyChance).toLocaleString("en")} reveals drops an unclaimed mythic key`;
    $("r-price").textContent = `${ethers.formatEther(cfg.price0)} ETH × (1 + √(E / ${N(cfg.priceD).toLocaleString("en")})) × network pressure, where E is mined minus burned; no ceiling`;
    $("r-ore").textContent = `${N(cfg.oreR0).toLocaleString("en")} measures of prima materia; every submit consumes one; K halves at 50 %, 25 % and 12.5 % left (never below one mint per window); mining ends at 0`;
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
