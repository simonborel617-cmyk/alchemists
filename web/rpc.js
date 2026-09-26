// A JSON-RPC provider over a list of public endpoints. Every endpoint is a plain ethers JsonRpcProvider, and every
// JSON-RPC method has its own endpoint order: plain reads (eth_call, eth_getBalance, eth_getBlockByNumber, eth_getCode)
// try `readUrls` first, eth_blockNumber tries `logUrls` first, and everything else (nonces, gas estimates, writes,
// receipts) follows `urls` as given; each order continues with the rest of the list. eth_getLogs goes to `logUrls` only
// (to every endpoint when none are given): the other nodes refuse log scans or cap them too tightly to be of use. A
// network error, a rate limit (429), a 5xx or a timeout demotes the endpoint for a cool-down and retries the request on
// the next healthy endpoint of that order, so every order settles back on its first entry once it recovers. A log node
// that refuses a range (a block cap) is not demoted: the error goes back to the scan, which asks for smaller ranges.
// Read-only: signing goes through the wallet or the burner, which wrap this provider.
//
//   const provider = AlchRpc.create(urls, chainId, { readUrls, logUrls });
//   provider.current()   -> the endpoint in use
//   provider.onSwitch(fn) -> fn(url, reason) when it moves
//   await AlchRpc.multicall(provider, [[contract, "fn", [args]], ...]) -> the results, null for a call that reverted
//
// The chain id is required: with a known network ethers never asks a node for eth_chainId, and that detection is the
// one request that would bypass the rotation (it goes through the provider's own transport before any `send`).
// Writes (eth_sendRawTransaction) go to the first healthy endpoint once, with no timeout and no retry: a node that took
// the transaction but answered late would otherwise see it again with the same nonce.
(function () {
  const RETRYABLE = /429|rate limit|too many|timeout|timed out|failed to fetch|network|econn|502|503|504|server error|bad gateway/i;
  // the methods a fast read node serves; a log scan ends at the head of the node that serves its logs, so
  // eth_blockNumber prefers the log nodes (and may still come from any other: ethers reads it for every send and wait)
  const READS = new Set(["eth_call", "eth_getBalance", "eth_getBlockByNumber", "eth_getCode"]);
  // what the node itself said when it answered with JSON-RPC errors: ethers keeps one in e.error (in e.info.error for
  // calls and estimates) under a generic message of its own; a batch in which every call failed comes back from
  // publicnode as HTTP 403 with the errors in the body, which ethers hands to every call of the batch as a server error
  // (read only from a 4xx other than 429: a 5xx or a rate limit stays an outage)
  const nodeSaid = (e) => {
    if (!e) return null;
    if (e.error && typeof e.error.code === "number") return [e.error];
    if (e.info && e.info.error) return [e.info.error];
    if (!e.info || !/^4(?!29)/.test(String(e.info.responseStatus))) return null;
    try { const b = JSON.parse(e.info.responseBody), l = Array.isArray(b) ? b : [b]; return l.length && l.every((x) => x && x.error && typeof x.error.code === "number") ? l.map((x) => x.error) : null; } catch { return null; }
  };
  function create(urls, chainId, opts = {}) {
    const { readUrls = [], logUrls = [], cooldownMs, timeoutMs, ...ethersOpts } = opts;
    const list = [...new Set([...urls, ...readUrls, ...logUrls].filter(Boolean))];
    if (!list.length) throw new Error("no rpc endpoints");
    if (!chainId) throw new Error("rpc: chainId is required");
    const network = ethers.Network.from(Number(chainId));
    const options = { staticNetwork: network, batchMaxCount: 8, batchStallTime: 20, ...ethersOpts };
    const cooldown = cooldownMs || 60000;
    const nodes = list.map((url) => ({ url, provider: new ethers.JsonRpcProvider(url, network, options), badUntil: 0 }));
    // each order: the preferred endpoints first, then the whole list as given
    const base = list.map((_, i) => i);
    const prefer = (first) => [...new Set([...first.map((u) => list.indexOf(u)).filter((i) => i >= 0), ...base])];
    const readOrder = prefer(readUrls), headOrder = prefer(logUrls);
    const logOrder = logUrls.length ? headOrder.filter((i) => logUrls.includes(list[i])) : base;
    const orderFor = (m) => (READS.has(m) ? readOrder : m === "eth_getLogs" ? logOrder : m === "eth_blockNumber" ? headOrder : base);
    let cur = 0;
    const listeners = [];
    // the first failure of a healthy endpoint announces where that order goes now; parallel requests that were in
    // flight when an endpoint died all fail at once, and their demotions after the first only extend its rest
    const demote = (i, reason, order) => {
      const t = Date.now(), wasOk = nodes[i].badUntil <= t;
      nodes[i].badUntil = t + cooldown;
      if (!wasOk) return;
      const next = order.find((j) => nodes[j].badUntil <= t);
      if (next !== undefined) { cur = next; for (const fn of listeners) { try { fn(nodes[next].url, reason); } catch {} } }
    };
    const withTimeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("rpc timeout")), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
    // the ethers provider interface the dapp uses is `send` plus the helpers built on it; routing `send` routes everything
    const facade = new ethers.JsonRpcProvider(list[0], network, options);
    facade.send = async function (method, params) {
      const order = orderFor(method);
      // a transaction is never retried elsewhere (the node may have taken it: a repeat is a nonce clash) and never cut
      // short by our timeout (the node holds the connection until the sequencer answers); everything else is a read
      const isWrite = method === "eth_sendRawTransaction" || method === "eth_sendTransaction";
      const tried = new Set();
      let lastErr = null;
      for (;;) {
        const t = Date.now();
        let i = order.find((j) => !tried.has(j) && nodes[j].badUntil <= t);
        if (i === undefined) { if (tried.size) break; i = order[0]; } // everything is cooling down: try the preferred one anyway
        tried.add(i);
        const n = nodes[i];
        if (isWrite) return n.provider.send(method, params);
        try {
          return await withTimeout(n.provider.send(method, params), timeoutMs || 25000);
        } catch (e) {
          lastErr = e;
          const said = nodeSaid(e);
          const msg = String((said && said.map((x) => x.message).join("; ")) || (e && (e.shortMessage || e.message)) || e);
          if (e && e.code === "CALL_EXCEPTION") throw e; // a revert is an answer, not an outage
          if (!RETRYABLE.test(msg) && e && e.info && e.info.error) throw e; // a JSON-RPC error from the node is an answer too
          // so is a log node refusing a range; the scan reads the node's error from e.error and asks for smaller ranges
          if (method === "eth_getLogs" && said && !RETRYABLE.test(msg)) { if (!(e.error && typeof e.error.code === "number")) e.error = said[0]; throw e; }
          demote(i, msg.slice(0, 120), order);
        }
      }
      throw lastErr;
    };
    facade.current = () => nodes[cur].url;
    facade.onSwitch = (fn) => listeners.push(fn);
    return facade;
  }
  // Multicall3 (the same address on every EVM chain, deployed on Robinhood Chain testnet and mainnet): a list of view
  // calls [contract, fn, args] in one eth_call, so the RPC counts one request; a call that reverts yields null. If the
  // aggregate itself fails (no contract, a node error), the calls go out directly, at most 16 in flight across the whole
  // list (thousands of them must not hit a node's rate limit at once), with the same null for a revert. Never use
  // Multicall3.getBlockNumber on this chain: it returns the parent-chain block.
  const MC3_ABI = ["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"];
  // fn() with at most n of them in flight at a time
  const pool = (n) => {
    let busy = 0;
    const q = [];
    const next = () => { while (busy < n && q.length) { const [fn, ok, no] = q.shift(); busy++; Promise.resolve().then(fn).then(ok, no).finally(() => { busy--; next(); }); } };
    return (fn) => new Promise((ok, no) => { q.push([fn, ok, no]); next(); });
  };
  async function multicall(provider, calls, { address, per = 300 } = {}) {
    if (!calls.length) return [];
    const mc = new ethers.Contract(address || "0xcA11bde05977b3631167028862bE2a173976CA11", MC3_ABI, provider);
    const direct = pool(16);
    const one = async (part) => {
      try {
        const res = await mc.aggregate3.staticCall(part.map(([c, fn, args = []]) => ({ target: c.target, allowFailure: true, callData: c.interface.encodeFunctionData(fn, args) })));
        return res.map((r, i) => {
          if (!r.success) return null;
          try { const d = part[i][0].interface.decodeFunctionResult(part[i][1], r.returnData); return d.length === 1 ? d[0] : d; } catch { return null; }
        });
      } catch { return Promise.all(part.map(([c, fn, args = []]) => direct(() => c[fn](...args)).catch(() => null))); }
    };
    const parts = [];
    for (let i = 0; i < calls.length; i += per) parts.push(calls.slice(i, i + per));
    return (await Promise.all(parts.map(one))).flat();
  }
  window.AlchRpc = { create, multicall };
})();
