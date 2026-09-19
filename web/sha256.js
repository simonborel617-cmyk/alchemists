// SHA-256 of the mine preimage, tuned for the browser: msg(84) = miner(20) || nonce(32, big-endian) || challenge(32).
// Block 0 = miner + nonce + challenge[0..11]; block 1 = challenge[12..31] + padding. The schedule of block 1 depends only
// on the challenge, so it is computed once per minute; per nonce we do two compressions. Shared by the page and the worker.
(function (root) {
  "use strict";
  const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const IV = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Int32Array(64);
  const S = new Int32Array(8);

  function hexBytes(h) {
    h = h.replace(/^0x/i, "");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 * i, 2), 16);
    return out;
  }
  const be = (p, i) => ((p[i] << 24) | (p[i + 1] << 16) | (p[i + 2] << 8) | p[i + 3]) | 0;

  // ctx: block0 template (nonce words 11,12 filled per hash) and the full schedule of block 1
  function setup(addrHex, challengeHex) {
    const a = hexBytes(addrHex), c = hexBytes(challengeHex);
    if (a.length !== 20 || c.length !== 32) throw new Error("bad address or challenge");
    const b0 = new Int32Array(16);
    for (let i = 0; i < 5; i++) b0[i] = be(a, i * 4);
    b0[13] = be(c, 0); b0[14] = be(c, 4); b0[15] = be(c, 8);
    const w1 = new Int32Array(64);
    for (let i = 0; i < 5; i++) w1[i] = be(c, 12 + i * 4);
    w1[5] = 0x80000000 | 0;
    w1[15] = 672;
    for (let i = 16; i < 64; i++) {
      const x = w1[i - 15], y = w1[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w1[i] = (w1[i - 16] + s0 + w1[i - 7] + s1) | 0;
    }
    return { b0, w1 };
  }

  function compress(w) {
    let a = S[0], b = S[1], c = S[2], d = S[3], e = S[4], f = S[5], g = S[6], h = S[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    S[0] = (S[0] + a) | 0; S[1] = (S[1] + b) | 0; S[2] = (S[2] + c) | 0; S[3] = (S[3] + d) | 0;
    S[4] = (S[4] + e) | 0; S[5] = (S[5] + f) | 0; S[6] = (S[6] + g) | 0; S[7] = (S[7] + h) | 0;
  }

  // full digest for one nonce (hi, lo = 32-bit halves of the low 64 bits of the nonce); returns Int32Array(8) copy
  function digest(ctx, hi, lo) {
    const b0 = ctx.b0;
    for (let i = 0; i < 16; i++) W[i] = b0[i];
    W[11] = hi | 0; W[12] = lo | 0;
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    for (let i = 0; i < 8; i++) S[i] = IV[i];
    compress(W);
    compress(ctx.w1);
    return new Int32Array(S);
  }

  // scan `count` nonces from (hi, lo); returns the best (numerically smallest) digest by its first 64 bits
  function scan(ctx, hi, lo, count) {
    let bestS0 = -1 >>> 0, bestS1 = -1 >>> 0, bestHi = hi, bestLo = lo;
    const b0 = ctx.b0, w1 = ctx.w1;
    let h = hi | 0, l = lo | 0;
    for (let n = 0; n < count; n++) {
      for (let i = 0; i < 16; i++) W[i] = b0[i];
      W[11] = h; W[12] = l;
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15], y = W[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      for (let i = 0; i < 8; i++) S[i] = IV[i];
      compress(W);
      compress(w1);
      const s0 = S[0] >>> 0, s1 = S[1] >>> 0;
      if (s0 < bestS0 || (s0 === bestS0 && s1 < bestS1)) { bestS0 = s0; bestS1 = s1; bestHi = h; bestLo = l; }
      l = (l + 1) | 0;
      if (l === 0) h = (h + 1) | 0;
    }
    return { s0: bestS0, s1: bestS1, hi: bestHi >>> 0, lo: bestLo >>> 0 };
  }

  // leading zero bits of the first 64 bits of a digest
  function lz64(s0, s1) {
    s0 >>>= 0; s1 >>>= 0;
    if (s0) return Math.clz32(s0);
    if (s1) return 32 + Math.clz32(s1);
    return 64;
  }

  // exact contract work (Q8 bits) of a full digest: 65536 - log2Q8(hash), mirrors FixedMath
  function workQ8(words) {
    let x = 0n;
    for (let i = 0; i < 8; i++) x = (x << 32n) | BigInt(words[i] >>> 0);
    if (x === 0n) return 65535;
    const n = BigInt(x.toString(2).length - 1);
    let m = n >= 127n ? x >> (n - 127n) : x << (127n - n);
    let frac = 0n;
    for (let i = 0; i < 8; i++) {
      m = (m * m) >> 127n;
      frac <<= 1n;
      if (m >= 1n << 128n) { frac |= 1n; m >>= 1n; }
    }
    return Number(65536n - ((n << 8n) | frac));
  }

  const nonceBig = (hi, lo) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
  const hex = (words) => Array.from(words, (w) => (w >>> 0).toString(16).padStart(8, "0")).join("");

  root.MineHash = { setup, digest, scan, lz64, workQ8, nonceBig, hex };
})(typeof self !== "undefined" ? self : globalThis);
