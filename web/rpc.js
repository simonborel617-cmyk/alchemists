// A JSON-RPC provider over a list of public endpoints. Every endpoint is a plain ethers JsonRpcProvider; requests go
// to the current one, and a network error, a rate limit (429), a 5xx or a timeout moves the current pointer to the
// next endpoint and retries the request there. A demoted endpoint is tried again after a cool-down, so the list
// settles back on its first entry once it recovers. Read-only: signing goes through the wallet or the burner, which
// wrap this provider.
//
//   const provider = AlchRpc.create(["https://a", "https://b"], 46630, { batchMaxCount: 8 });
//   provider.current()   -> the endpoint in use
//   provider.onSwitch(fn) -> fn(url, reason) when it moves
//
// The chain id is required: with a known network ethers never asks a node for eth_chainId, and that detection is the
// one request that would bypass the rotation (it goes through the provider's own transport before any `send`).
// Writes (eth_sendRawTransaction) go to the current endpoint once, with no timeout and no retry: a node that took the
// transaction but answered late would otherwise see it again with the same nonce.
(function () {
  const RETRYABLE = /429|rate limit|too many|timeout|timed out|failed to fetch|network|econn|502|503|504|server error|bad gateway/i;
  function create(urls, chainId, opts = {}) {
    const list = [...new Set(urls.filter(Boolean))];
    if (!list.length) throw new Error("no rpc endpoints");
    if (!chainId) throw new Error("rpc: chainId is required");
    const network = ethers.Network.from(Number(chainId));
    const options = { staticNetwork: network, batchMaxCount: 8, batchStallTime: 20, ...opts };
    const cooldown = opts.cooldownMs || 60000;
    const nodes = list.map((url) => ({ url, provider: new ethers.JsonRpcProvider(url, network, options), badUntil: 0 }));
    let cur = 0;
    const listeners = [];
    const pick = () => {
      const t = Date.now();
      for (let i = 0; i < nodes.length; i++) if (nodes[i].badUntil <= t) return i; // the first healthy one, so the list prefers its head
      return cur;
    };
    const demote = (i, reason) => {
      nodes[i].badUntil = Date.now() + cooldown;
      const next = pick();
      if (next !== cur) { cur = next; for (const fn of listeners) { try { fn(nodes[cur].url, reason); } catch {} } }
    };
    const withTimeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("rpc timeout")), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
    // the ethers provider interface the dapp uses is `send` plus the helpers built on it; routing `send` routes everything
    const facade = new ethers.JsonRpcProvider(list[0], network, options);
    facade.send = async function (method, params) {
      const first = pick();
      if (first !== cur) cur = first;
      let lastErr = null;
      const tried = new Set();
      // parallel requests that were in flight when an endpoint died all fail at once; each of them demotes it (a no-op
      // after the first) and retries on whatever is healthy now, so a burst of reads survives one outage
      for (let attempt = 0; attempt < nodes.length; attempt++) {
        const i = cur, n = nodes[i];
        if (tried.has(i)) break;
        tried.add(i);
        // a transaction is never retried elsewhere (the node may have taken it: a repeat is a nonce clash) and never cut
        // short by our timeout (the node holds the connection until the sequencer answers); everything else is a read
        const isWrite = method === "eth_sendRawTransaction" || method === "eth_sendTransaction";
        if (isWrite) return n.provider.send(method, params);
        try {
          return await withTimeout(n.provider.send(method, params), opts.timeoutMs || 25000);
        } catch (e) {
          lastErr = e;
          const msg = String((e && (e.shortMessage || e.message)) || e);
          if (e && e.code === "CALL_EXCEPTION") throw e; // a revert is an answer, not an outage
          if (!RETRYABLE.test(msg) && e && e.info && e.info.error) throw e; // a JSON-RPC error from the node is an answer too
          demote(i, msg.slice(0, 120));
          const next = pick();
          if (next === i) break; // nothing else to try
          cur = next;
        }
      }
      throw lastErr;
    };
    facade.current = () => nodes[cur].url;
    facade.onSwitch = (fn) => listeners.push(fn);
    return facade;
  }
  window.AlchRpc = { create };
})();
