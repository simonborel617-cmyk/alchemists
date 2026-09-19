// WebGPU miner: the same preimage as sha256.js, hashed on the card with a WGSL compute shader.
// One dispatch scans WG*64*ITERS nonces from a 64-bit base; every hash with lz >= floor competes through atomicMax on
// (lz << 24 | index), so a dispatch returns its best hash; the page verifies it on the CPU and ratchets the floor.
(function (root) {
  "use strict";
  const WG = 1024, WGSIZE = 64, ITERS = 256; // 16,777,216 nonces per dispatch, index fits in 24 bits
  const WGSL = `
struct Job { b0: array<u32,16>, w1: array<u32,64>, k: array<u32,64>, baseHi: u32, baseLo: u32, floor: u32, iters: u32 }
@group(0) @binding(0) var<storage, read> job: Job;
@group(0) @binding(1) var<storage, read_write> best: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> outDigest: array<u32, 8>;

fn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }

fn sha(hi: u32, lo: u32) -> array<u32, 8> {
  var w: array<u32, 64>;
  for (var i = 0u; i < 16u; i++) { w[i] = job.b0[i]; }
  w[11] = hi; w[12] = lo;
  for (var i = 16u; i < 64u; i++) {
    let x = w[i - 15u]; let y = w[i - 2u];
    let s0 = rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3u);
    let s1 = rotr(y, 17u) ^ rotr(y, 19u) ^ (y >> 10u);
    w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
  }
  var a = 0x6a09e667u; var b = 0xbb67ae85u; var c = 0x3c6ef372u; var d = 0xa54ff53au;
  var e = 0x510e527fu; var f = 0x9b05688cu; var g = 0x1f83d9abu; var h = 0x5be0cd19u;
  for (var i = 0u; i < 64u; i++) {
    let t1 = h + (rotr(e, 6u) ^ rotr(e, 11u) ^ rotr(e, 25u)) + ((e & f) ^ (~e & g)) + job.k[i] + w[i];
    let t2 = (rotr(a, 2u) ^ rotr(a, 13u) ^ rotr(a, 22u)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  let m0 = 0x6a09e667u + a; let m1 = 0xbb67ae85u + b; let m2 = 0x3c6ef372u + c; let m3 = 0xa54ff53au + d;
  let m4 = 0x510e527fu + e; let m5 = 0x9b05688cu + f; let m6 = 0x1f83d9abu + g; let m7 = 0x5be0cd19u + h;
  a = m0; b = m1; c = m2; d = m3; e = m4; f = m5; g = m6; h = m7;
  for (var i = 0u; i < 64u; i++) {
    let t1 = h + (rotr(e, 6u) ^ rotr(e, 11u) ^ rotr(e, 25u)) + ((e & f) ^ (~e & g)) + job.k[i] + job.w1[i];
    let t2 = (rotr(a, 2u) ^ rotr(a, 13u) ^ rotr(a, 22u)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  return array<u32, 8>(m0 + a, m1 + b, m2 + c, m3 + d, m4 + e, m5 + f, m6 + g, m7 + h);
}

@compute @workgroup_size(${WGSIZE})
fn mine(@builtin(global_invocation_id) gid: vec3<u32>) {
  let iters = job.iters;
  let start = gid.x * iters;
  for (var it = 0u; it < iters; it++) {
    let idx = start + it;
    let lo = job.baseLo + idx;
    var hi = job.baseHi;
    if (lo < job.baseLo) { hi = hi + 1u; }
    let d = sha(hi, lo);
    var lz = countLeadingZeros(d[0]);
    if (d[0] == 0u) { lz = 32u + countLeadingZeros(d[1]); }
    if (lz >= job.floor) { atomicMax(&best, (lz << 24u) | (idx & 0xFFFFFFu)); }
  }
}

@compute @workgroup_size(1)
fn one() {
  let d = sha(job.baseHi, job.baseLo);
  for (var i = 0u; i < 8u; i++) { outDigest[i] = d[i]; }
}
`;
  const KWORDS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  class GpuMiner {
    static available() { return !!(root.navigator && root.navigator.gpu); }

    static async create() {
      if (!GpuMiner.available()) throw new Error("WebGPU is not available in this browser");
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("no WebGPU adapter");
      const device = await adapter.requestDevice();
      const m = new GpuMiner(device);
      let info = "";
      try { const i = adapter.info || {}; info = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(" "); } catch {}
      m.info = info || "WebGPU adapter";
      await m.init();
      return m;
    }

    constructor(device) { this.device = device; this.perDispatch = WG * WGSIZE * ITERS; this.hashes = 0; }

    async init() {
      const d = this.device;
      const module = d.createShaderModule({ code: WGSL });
      this.job = d.createBuffer({ size: (16 + 64 + 64 + 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.best = d.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      this.out = d.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      this.stage = d.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      this.stageOut = d.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const layout = d.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ] });
      const pl = d.createPipelineLayout({ bindGroupLayouts: [layout] });
      this.pMine = await d.createComputePipelineAsync({ layout: pl, compute: { module, entryPoint: "mine" } });
      this.pOne = await d.createComputePipelineAsync({ layout: pl, compute: { module, entryPoint: "one" } });
      this.bind = d.createBindGroup({ layout, entries: [
        { binding: 0, resource: { buffer: this.job } }, { binding: 1, resource: { buffer: this.best } }, { binding: 2, resource: { buffer: this.out } },
      ] });
      this.words = new Uint32Array(16 + 64 + 64 + 4);
      this.words.set(KWORDS.map((x) => x >>> 0), 80);
    }

    // new challenge/address; base = random 64-bit start
    setJob(addrHex, chHex, floor, baseHi, baseLo) {
      const ctx = MineHash.setup(addrHex, chHex);
      for (let i = 0; i < 16; i++) this.words[i] = ctx.b0[i] >>> 0;
      for (let i = 0; i < 64; i++) this.words[16 + i] = ctx.w1[i] >>> 0;
      this.baseHi = baseHi >>> 0; this.baseLo = baseLo >>> 0; this.floor = floor >>> 0;
      this.ctx = ctx;
      this.upload();
    }
    setFloor(floor) { this.floor = floor >>> 0; this.upload(); }
    upload() {
      this.words[144] = this.baseHi; this.words[145] = this.baseLo; this.words[146] = this.floor; this.words[147] = ITERS;
      this.device.queue.writeBuffer(this.job, 0, this.words);
    }

    // one dispatch; resolves to {lz, hi, lo} of the best hash >= floor in it, or null
    async dispatch() {
      const d = this.device;
      d.queue.writeBuffer(this.best, 0, new Uint32Array([0]));
      const enc = d.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pMine); pass.setBindGroup(0, this.bind); pass.dispatchWorkgroups(WG); pass.end();
      enc.copyBufferToBuffer(this.best, 0, this.stage, 0, 4);
      d.queue.submit([enc.finish()]);
      await this.stage.mapAsync(GPUMapMode.READ);
      const v = new Uint32Array(this.stage.getMappedRange())[0];
      this.stage.unmap();
      const baseHi = this.baseHi, baseLo = this.baseLo;
      // advance the base
      const nextLo = (baseLo + this.perDispatch) >>> 0;
      this.baseHi = nextLo < baseLo ? (baseHi + 1) >>> 0 : baseHi;
      this.baseLo = nextLo;
      this.upload();
      this.hashes += this.perDispatch;
      if (!v) return null;
      const lz = v >>> 24, idx = v & 0xFFFFFF;
      const lo = (baseLo + idx) >>> 0, hi = lo < baseLo ? (baseHi + 1) >>> 0 : baseHi;
      return { lz, hi, lo };
    }

    // hash exactly the base nonce on the card and return the hex digest (selftest)
    async selftest() {
      this.setJob("0x1111111111111111111111111111111111111111", "0x4242424242424242424242424242424242424242424242424242424242424242", 64, 1, 2);
      const d = this.device;
      const enc = d.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pOne); pass.setBindGroup(0, this.bind); pass.dispatchWorkgroups(1); pass.end();
      enc.copyBufferToBuffer(this.out, 0, this.stageOut, 0, 32);
      d.queue.submit([enc.finish()]);
      await this.stageOut.mapAsync(GPUMapMode.READ);
      const w = new Uint32Array(this.stageOut.getMappedRange().slice(0));
      this.stageOut.unmap();
      const hex = MineHash.hex(w);
      return { hex, ok: hex === "51a1202b9b37848969f81d5c3bc3f1b874ad0591ef4e54b2c72c15a9fbf813ce" };
    }

    destroy() { try { this.device.destroy(); } catch {} }
  }

  root.GpuMiner = GpuMiner;
})(typeof self !== "undefined" ? self : globalThis);
