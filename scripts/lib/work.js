// Mirrors FixedMath.workQ8 / log2Q8 from the contracts, plus the preimage layout.
const crypto = require("crypto");

function log2Q8(x) {
  if (x <= 0n) throw new Error("log2(0)");
  const n = BigInt(x.toString(2).length - 1);
  let m = n >= 127n ? x >> (n - 127n) : x << (127n - n);
  let frac = 0n;
  for (let i = 0; i < 8; i++) {
    m = (m * m) >> 127n;
    frac <<= 1n;
    if (m >= 1n << 128n) {
      frac |= 1n;
      m >>= 1n;
    }
  }
  return (n << 8n) | frac;
}

/** @param {Buffer} hash 32 bytes */
function workQ8(hash) {
  const x = BigInt("0x" + hash.toString("hex"));
  if (x === 0n) return 65535;
  return Number(65536n - log2Q8(x));
}

/** preimage = miner(20) || nonce(32, big-endian) || challenge(32) */
function preimage(minerHex, challengeHex) {
  const buf = Buffer.alloc(84);
  Buffer.from(minerHex.replace(/^0x/, ""), "hex").copy(buf, 0);
  Buffer.from(challengeHex.replace(/^0x/, ""), "hex").copy(buf, 52);
  return buf;
}

function setNonce(buf, nonce) {
  // low 64 bits of the 32-byte nonce field (bytes 20..51); high bytes stay zero
  buf.writeBigUInt64BE(BigInt(nonce), 44);
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

/** Mine `iterations` nonces starting at `start`; returns the best (lowest) hash. */
function mineRange(minerHex, challengeHex, start, iterations) {
  const buf = preimage(minerHex, challengeHex);
  let best = null;
  let bestNonce = 0n;
  for (let i = 0n; i < BigInt(iterations); i++) {
    const nonce = BigInt(start) + i;
    setNonce(buf, nonce);
    const h = sha256(buf);
    if (best === null || Buffer.compare(h, best) < 0) {
      best = h;
      bestNonce = nonce;
    }
  }
  return { hash: best, nonce: bestNonce };
}

/** Find the first nonce whose work reaches minWorkQ8 (tests / tiny difficulties). */
// first nonce with work >= minWorkQ8; with maxWorkQ8 the work must also be < maxWorkQ8 (a narrow window, used by the
// simulator to realise an exactly sampled best-of-N work instead of the memoryless overshoot of a first passage)
function findNonce(minerHex, challengeHex, minWorkQ8, start = 0n, maxWorkQ8 = Infinity) {
  const buf = preimage(minerHex, challengeHex);
  for (let nonce = BigInt(start); ; nonce++) {
    setNonce(buf, nonce);
    const h = sha256(buf);
    const w = workQ8(h);
    if (w >= minWorkQ8 && w < maxWorkQ8) return { nonce, hash: h };
  }
}

module.exports = { log2Q8, workQ8, preimage, setNonce, sha256, mineRange, findNonce };
