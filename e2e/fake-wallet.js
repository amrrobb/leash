// Stand-in for an injected wallet (window.ethereum). Signing happens on the backend's test signer, so the
// page runs the exact code path it runs with MetaMask: eth_requestAccounts, eth_chainId, eth_sendTransaction,
// eth_getTransactionReceipt.
(() => {
  let account = null;
  const post = async (path, body) => {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  };
  const listeners = {};
  window.ethereum = {
    isFakeWallet: true,
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    removeListener(event, fn) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn); },
    /** Test hook: the user switches accounts inside the wallet. */
    __switchAccount(next) { account = next; for (const fn of listeners.accountsChanged ?? []) fn(next ? [next] : []); },
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
          account = (await (await fetch("/api/demo/address")).json()).address;
          return [account];
        case "eth_accounts":
          return account ? [account] : [];
        case "eth_chainId":
          return "0xaa36a7";
        case "eth_sendTransaction": {
          const { to, data, value } = params[0];
          const { tx } = await post("/api/demo/send", { to, data, value: value ? String(BigInt(value)) : "0" });
          return tx;
        }
        case "eth_getTransactionReceipt":
          return { status: "0x1", transactionHash: params[0] }; // the signer already waited for it
        default:
          throw new Error(`fake wallet: unsupported ${method}`);
      }
    },
  };
})();
