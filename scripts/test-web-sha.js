// Verifies web/sha256.js against Node's crypto and the miner's selftest vector, then benchmarks scan().
const vm = require("vm");
const fs = require("fs");
const crypto = require("crypto");
const ctxG = { self: {} };
vm.createContext(ctxG);
vm.runInContext(fs.readFileSync(__dirname + "/../web/sha256.js", "utf8"), ctxG);
const MH = ctxG.self.MineHash;
const addr = "0x1111111111111111111111111111111111111111", ch = "0x4242424242424242424242424242424242424242424242424242424242424242";
const ctx = MH.setup(addr, ch);
const d = MH.digest(ctx, 1, 2);
const got = MH.hex(d);
console.log("selftest", got === "51a1202b9b37848969f81d5c3bc3f1b874ad0591ef4e54b2c72c15a9fbf813ce" ? "PASS" : "FAIL " + got);
// random nonces vs node crypto
const { workQ8 } = require("./lib/work");
let ok = 0;
for (let i = 0; i < 200; i++) {
  const hi = Math.floor(Math.random() * 2 ** 32), lo = Math.floor(Math.random() * 2 ** 32);
  const buf = Buffer.alloc(84);
  Buffer.from(addr.slice(2), "hex").copy(buf, 0); Buffer.from(ch.slice(2), "hex").copy(buf, 52);
  buf.writeBigUInt64BE(MH.nonceBig(hi, lo), 44);
  const ref = crypto.createHash("sha256").update(buf).digest();
  const w = MH.digest(ctx, hi, lo);
  if (MH.hex(w) === ref.toString("hex") && MH.workQ8(w) === workQ8(ref)) ok++;
}
console.log("random nonces vs node crypto + workQ8:", ok, "/ 200");
// scan best equals brute force best
const r = MH.scan(ctx, 7, 100, 5000);
let bestH = null, bestN = 0n;
for (let n = 0; n < 5000; n++) {
  const w = MH.digest(ctx, 7, 100 + n);
  const h = MH.hex(w);
  if (bestH === null || h < bestH) { bestH = h; bestN = 100 + n; }
}
console.log("scan best matches brute force:", r.lo === bestN && MH.hex(MH.digest(ctx, r.hi, r.lo)) === bestH, "lz", MH.lz64(r.s0, r.s1));
// benchmark
const t0 = Date.now(); const N = 400000; MH.scan(ctx, 1, 1, N);
console.log(`bench: ${(N / ((Date.now() - t0) / 1000) / 1e6).toFixed(2)} MH/s per thread (node)`);
