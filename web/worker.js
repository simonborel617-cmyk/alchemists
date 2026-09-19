// CPU mining worker: one per thread. Messages in: {type:"job", addr, ch, hi, lo} (start scanning nonces from hi:lo),
// {type:"stop"}. Messages out every ~250 ms: {type:"progress", hashes, best:{s0,s1,hi,lo}} where best is the best digest
// (first 64 bits) seen for the current job since the last report; the page keeps the overall best and the exact work.
importScripts("sha256.js");
let job = null, hi = 0, lo = 0, gen = 0;
const BATCH = 4096;

function step(myGen) {
  if (!job || myGen !== gen) return;
  const t0 = performance.now();
  let hashes = 0, best = null;
  while (performance.now() - t0 < 250) {
    const r = MineHash.scan(job, hi, lo, BATCH);
    hashes += BATCH;
    lo = (lo + BATCH) >>> 0;
    if (lo < BATCH) hi = (hi + 1) >>> 0;
    if (!best || r.s0 < best.s0 || (r.s0 === best.s0 && r.s1 < best.s1)) best = r;
  }
  postMessage({ type: "progress", hashes, best });
  setTimeout(() => step(myGen), 0);
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === "job") {
    job = MineHash.setup(m.addr, m.ch);
    hi = m.hi >>> 0; lo = m.lo >>> 0;
    gen++;
    setTimeout(() => step(gen), 0);
  } else if (m.type === "stop") {
    job = null; gen++;
  }
};
