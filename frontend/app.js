// Leash dashboard. Pure view-model functions are exported for tests; DOM code runs only in a browser.

export const PERIOD = 86_400;
export const CUTOFF = 3 * PERIOD;
export const TIERS = {
  orb: { key: "orb", name: "Orb", note: "Highest assurance · unique human", cap: 15_000, bit: 1n << 44n },
  document: { key: "document", name: "Passport (NFC)", note: "Document-backed", cap: 7_500, bit: 1n << 48n },
  selfie: { key: "selfie", name: "Selfie Check", note: "Beta · liveness, medium assurance", cap: 2_000, bit: 1n << 52n },
};
const MANDATE = 1n << 40n;
const ZERO = "0x0000000000000000000000000000000000000000";
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SEPOLIA = "0xaa36a7";

/** Tier caps come from the Vault code via /api/deployment; these are only the fallback until it answers. */
export function applyPolicy(policy) {
  if (!policy?.tiers) return TIERS;
  for (const k of ["orb", "document", "selfie"]) if (policy.tiers[k] != null) TIERS[k].cap = Number(BigInt(policy.tiers[k])) / 1e6;
  return TIERS;
}

/** Same curve as Vault.limitAt: halve per 24h, linear inside the period, zero from 72h. */
export function limitAt(base, elapsed) {
  if (elapsed >= CUTOFF) return 0;
  const halved = Math.floor(base / 2 ** Math.floor(elapsed / PERIOD));
  return halved - (halved * (elapsed % PERIOD)) / (2 * PERIOD);
}

export function tierOf(roles) {
  const r = BigInt(roles ?? 0);
  return [TIERS.orb, TIERS.document, TIERS.selfie].find((t) => (r & t.bit) !== 0n) ?? null;
}

export const fmt = (n) => Math.floor(n).toLocaleString("en-US");
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

function ago(sec) {
  if (sec < 3600) return "Just now";
  const d = Math.floor(sec / 86_400), h = Math.floor((sec % 86_400) / 3600);
  return d > 0 ? `${d}d ${h}h ago` : `${h}h ago`;
}

/** Which screen to show.
 * connect: no vault to look at and no wallet · create: wallet connected, no vault · verify: vault exists,
 * no mandate yet, no proof this session · A2: proof accepted, fund and set the cap · BC: the dashboard. */
export function screenOf(s, session = {}) {
  if (!s) return session.account ? "create" : "connect";
  if (BigInt(s.ownerCap) === 0n) return session.tier ? "A2" : "verify";
  return "BC";
}

/** "10,000 USDC · 1,000 HYPE" from raw balances. */
export function balancesText(s) {
  const usdc = Number(BigInt(s.vaultUsdc ?? 0)) / 1e6, hype = Number(BigInt(s.vaultHype ?? 0)) / 1e18;
  return `${usdc.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDC · ${hype.toLocaleString("en-US", { maximumFractionDigits: 0 })} HYPE`;
}

/** Everything the dashboard (B and C) renders, from one chain snapshot at chain time `now`. */
export function dashboardView(s, now) {
  const speed = Number(s.speed);
  const alive = (BigInt(s.agentRoles) & MANDATE) !== 0n;
  const tier = tierOf(s.agentRoles);
  const base = Number(BigInt(s.baseCap)) / 1e6;
  const verified = Number(s.lastVerified) > 0;
  const elapsed = verified ? Math.max(0, now - Number(s.lastVerified)) * speed : CUTOFF;
  const authority = alive && verified ? limitAt(base, elapsed) : 0;
  const empty = authority < 1;
  const low = !empty && authority < base * 0.4;
  const left = Math.max(0, CUTOFF - elapsed);
  const ld = Math.floor(left / 86_400), lh = Math.floor((left % 86_400) / 3600);
  return {
    authority,
    authText: fmt(authority),
    capText: fmt(base),
    barPct: base ? (authority / base) * 100 : 0,
    tone: empty ? "pause" : low ? "trim" : "ok",
    statusLabel: empty ? "Close-only" : low ? "Trimming fills" : "Operating",
    statusText: empty ? "The agent can close positions, nothing else" : low ? "Large market trades are being cut down" : "The market can trade against you up to this much",
    lastText: !verified ? "Never" : elapsed >= CUTOFF ? "Over 3 days ago" : ago(elapsed),
    tierName: tier ? tier.name : "no credential",
    zeroText: empty ? "Reached" : ld > 0 ? `in ~${ld}d ${lh}h` : `in ~${lh}h`,
    openText: empty ? "Paused" : "Allowed",
    fillText: empty ? "None" : `Up to ${fmt(authority)}`,
    cNote: !alive ? "You revoked the mandate." : empty ? "Nobody verified for 3 days. Authority reached zero." : "",
    clockText: `Demo clock: 1 second = ${(speed / 3600).toFixed(1)} hours`,
    revoked: !alive,
  };
}

/** One credential -> a single request (what World's simulator accepts); several -> World App offers any of them. */
export function constraintsFor(IDKit, credentials) {
  const list = credentials?.length ? credentials : ["proof_of_human", "passport", "mnc", "selfie"];
  const reqs = list.map((c) => IDKit.CredentialRequest(c));
  return reqs.length === 1 ? reqs[0] : IDKit.any(...reqs);
}

export const TAGS = {
  you: ["Verified", "ok"],
  owner: ["Owner", "ok"],
  full: ["Filled", "ok"],
  trim: ["Trimmed", "trim"],
  blocked: ["Paused", "pause"],
  closed: ["Closed", "pause"],
};

// ---------------------------------------------------------------- browser

if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const session = { account: null, vault: null, tier: null, txs: null };
  let snap = null; // { state, fetchedAt }
  let deployment = {};

  // ---- wallet: EIP-6963 discovery first (every installed wallet announces itself, so Brave Wallet or another
  // extension cannot swallow requests meant for Rabby/MetaMask), window.ethereum as the fallback.
  // Browser tests inject a stub on window.ethereum with the same interface.
  const discovered = new Map(); // rdns -> { info, provider }
  window.addEventListener("eip6963:announceProvider", (e) => discovered.set(e.detail.info.rdns, e.detail));
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  let chosen = null; // { info, provider }
  const wallet = {
    get provider() { return chosen?.provider ?? window.ethereum; },
    get name() { return chosen?.info?.name ?? "your wallet"; },
    /** One installed wallet: use it. Several: the connect card lists them and the click picks one. */
    async pick() {
      const list = [...discovered.values()];
      let remembered = null;
      try { remembered = localStorage.getItem("leash.wallet"); } catch {}
      if (remembered && discovered.has(remembered)) return discovered.get(remembered);
      if (list.length <= 1) return list[0] ?? null;
      return new Promise((resolve) => {
        const modal = $("wallet-modal");
        const close = (w) => { modal.hidden = true; resolve(w); };
        $("wallet-choice").replaceChildren(...list.map((w) => {
          const b = document.createElement("button");
          b.className = "wallet-row"; b.type = "button"; b.dataset.testid = `wallet-${w.info.rdns}`;
          const img = document.createElement("img"); img.src = w.info.icon; img.alt = "";
          b.append(img, w.info.name);
          b.addEventListener("click", () => close(w));
          return b;
        }));
        $("wm-cancel").onclick = () => close(undefined);
        modal.hidden = false;
      });
    },
    async connect() {
      const picked = await this.pick();
      if (picked === undefined && discovered.size > 1) throw Object.assign(new Error("cancelled"), { cancelled: true });
      chosen = picked ?? null;
      if (chosen) { try { localStorage.setItem("leash.wallet", chosen.info.rdns); } catch {} }
      if (!this.provider) throw new Error("No wallet found. Install Rabby or MetaMask (any injected wallet) and reload.");
      const [account] = await this.provider.request({ method: "eth_requestAccounts" });
      const chainId = await this.provider.request({ method: "eth_chainId" });
      if (chainId !== SEPOLIA) {
        try { await this.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA }] }); }
        catch { throw new Error("Switch your wallet to Sepolia."); }
      }
      return account;
    },
    /** Sends calldata the backend built and waits for the receipt. `onStage` receives a line for the UI. */
    async send({ to, data, value }, onStage = () => {}) {
      onStage(`Confirm the transaction in ${wallet.name}. If no window opened, click its icon in your browser bar.`);
      const hash = await this.provider.request({ method: "eth_sendTransaction", params: [{ from: session.account, to, data, value: value ?? "0x0" }] });
      onStage(`Sent ${short(hash)}. Waiting for Sepolia to include it…`);
      for (let i = 0; i < 120; i++) {
        const r = await this.provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
        if (r) {
          if (r.status !== "0x1") throw new Error(`Transaction reverted (${short(hash)})`);
          return hash;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Transaction is taking too long; check your wallet");
    },
  };

  const api = async (path, body) => {
    const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
    return data;
  };
  /** ERC-8004 badge for an agent address: registered agents show their id and name, others a plain note. Never blocks. */
  const identityCache = new Map();
  async function showIdentity(id, address) {
    const el = $(id);
    if (!ADDR.test(address ?? "")) { el.hidden = true; return; }
    const key = address.toLowerCase();
    if (!identityCache.has(key)) identityCache.set(key, api(`/api/agent?address=${address}`).catch(() => null));
    const who = await identityCache.get(key);
    if (!who || $(id) !== el) return;
    el.className = `identity ${who.registered ? "tone-ok" : "tone-pause"}`;
    el.replaceChildren();
    const a = document.createElement("a");
    a.target = "_blank"; a.rel = "noopener"; a.textContent = "registry";
    if (who.registered && who.agentId) {
      el.append(`ERC-8004 agent #${who.agentId}${who.name ? ` · ${who.name}` : ""}`, " · ", a);
      a.href = `https://sepolia.etherscan.io/nft/${who.registry}/${who.agentId}`;
    } else if (who.registered) {
      // Holds an agent token it did not register itself (transferred): identity unknown, but it is in the registry.
      el.append("Holds an ERC-8004 agent token (transferred, no registration of its own)", " · ", a);
      a.href = `https://sepolia.etherscan.io/token/${who.registry}?a=${address}`;
    } else el.append("Not in the ERC-8004 registry · Leash bounds it anyway");
    el.hidden = false;
  }
  const txFor = (kind, params = {}) => api(`/api/tx?${new URLSearchParams({ kind, ...(session.vault && kind !== "createVault" ? { vault: session.vault } : {}), ...params })}`);
  const chainNow = () => (snap ? Number(snap.state.timestamp) + (Date.now() - snap.fetchedAt) / 1000 : 0);
  const isOwner = () => Boolean(snap && session.account && snap.state.owner?.toLowerCase() === session.account.toLowerCase());
  const setErr = (id, msg) => { $(id).hidden = !msg; $(id).textContent = msg ?? ""; };

  function show(screen) {
    for (const [id, on] of [["state-connect", screen === "connect"], ["state-create", screen === "create"], ["state-a", screen === "verify"], ["state-a2", screen === "A2"], ["dashboard", screen === "BC"]]) {
      const el = $(id);
      if (el) el.hidden = !on;
    }
    document.body.dataset.screen = screen;
  }

  function renderHeader() {
    $("owner-name").textContent = session.account ? short(session.account) : "Connect wallet";
    $("vault-link").hidden = !session.vault;
    if (session.vault) {
      $("vault-link").textContent = snap?.state?.agentLabel ? `${snap.state.agentLabel}.leash.eth` : short(session.vault);
      $("vault-link").href = `/app?vault=${session.vault}`;
    }
  }

  function renderTierRows() {
    $("tier-rows").replaceChildren(
      ...[TIERS.selfie, TIERS.document, TIERS.orb].map((t) => {
        const row = document.createElement("div");
        row.className = "tier";
        row.innerHTML = `<div><div class="tn"></div><div class="td"></div></div><span class="mono" style="font-size:17px"></span>`;
        row.querySelector(".tn").textContent = t.name;
        row.querySelector(".td").textContent = t.note;
        row.querySelector(".mono").textContent = `${fmt(t.cap)} USDC`;
        return row;
      }),
    );
  }

  const wave = window.LeashWave && $("leash-wave") ? window.LeashWave.mount($("leash-wave"), { ratio: 1 }) : null;

  function renderDashboard() {
    const v = dashboardView(snap.state, chainNow());
    if (wave) {
      wave.setRatio(v.barPct / 100);
      wave.setTone(v.tone);
    }
    $("auth").textContent = v.authText;
    $("cap-text").textContent = v.capText;
    $("bar").style.width = `${v.barPct.toFixed(2)}%`;
    $("bar").style.background = { ok: "var(--accent)", trim: "var(--trim-bar)", pause: "var(--pause-bar)" }[v.tone];
    $("status").className = `status tone-${v.tone}`;
    $("status-label").textContent = v.statusLabel;
    $("status-text").textContent = v.statusText;
    $("last").textContent = v.lastText;
    $("tier-name").textContent = v.tierName;
    $("zero").textContent = v.zeroText;
    $("open-text").textContent = v.openText;
    $("open-text").style.color = v.tone === "pause" ? "var(--pause-ink)" : "var(--accent)";
    $("fill-text").textContent = v.fillText;
    $("clock").textContent = v.clockText;
    $("vault-balances").textContent = balancesText(snap.state);
    $("agent-name").textContent = `${snap.state.agentLabel}.leash.eth`;
    $("agent-addr").textContent = short(snap.state.agent);
    showIdentity("agent-identity", snap.state.agent);
    $("c-note").hidden = !v.cNote;
    $("c-note").textContent = v.cNote;
    // Owner actions only for the wallet that owns this vault; anyone else looks.
    const owner = isOwner();
    $("viewer-note").hidden = owner;
    $("verify-again").hidden = v.revoked;
    $("revoke").hidden = !owner || v.tone === "pause";
    $("restore").hidden = !owner || !v.revoked;
    $("withdraw").hidden = !owner || v.tone !== "pause";
    $("deposit").hidden = !owner;
    document.body.dataset.state = v.tone === "pause" ? "C" : v.tone === "trim" ? "B-trim" : "B";
  }

  function renderFeed(entries) {
    const el = $("feed");
    if (!entries.length) {
      el.innerHTML = '<div class="feed-empty">Nothing yet. The agent\'s actions and market trades show up here.</div>';
      return;
    }
    el.replaceChildren(
      ...entries.map((e) => {
        const [label, tone] = TAGS[e.kind] ?? ["", "pause"];
        const row = document.createElement("div");
        row.className = "feed-row";
        row.dataset.kind = e.kind;
        const time = new Date(e.at * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        row.innerHTML = `<span class="time"></span><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="title"></span><span class="detail"></span></span><span class="tag tone-${tone}"></span>`;
        row.querySelector(".time").textContent = time;
        row.querySelector(".title").textContent = e.title;
        row.querySelector(".detail").textContent = e.detail;
        row.querySelector(".tag").textContent = label;
        return row;
      }),
    );
  }

  function renderA2() {
    const t = TIERS[session.tier];
    $("a2-verified").textContent = `Verified · ${t.name}`;
    $("a2-headline").textContent = `Authority up to ${fmt(t.cap)} USDC`;
    $("a2-max").textContent = `max ${fmt(t.cap)} · can only go down`;
    $("a2-name").textContent = snap ? `${snap.state.agentLabel}.leash.eth` : "";
    if (snap) $("a2-balances").textContent = balancesText(snap.state);
    const input = $("a2-cap");
    input.max = String(t.cap);
    if (!input.value) input.value = String(t.cap);
  }

  function render() {
    renderHeader();
    const screen = screenOf(snap?.state, session);
    show(screen);
    if (screen === "BC") renderDashboard();
    if (screen === "A2") renderA2();
    if (screen === "verify") $("verify-name").textContent = snap ? `${snap.state.agentLabel}.leash.eth` : "";
  }

  async function poll() {
    if (!session.vault) { render(); return; }
    try {
      const state = await api(`/api/state?vault=${session.vault}`);
      snap = { state, fetchedAt: Date.now() };
      render();
      setErr("dash-err", null);
    } catch (err) {
      setErr("dash-err", `Could not read the chain: ${err.message}`);
      return;
    }
    try {
      renderFeed(await api(`/api/feed?vault=${session.vault}`));
    } catch {
      // A failed event read must not hide a healthy dashboard; the next poll retries.
    }
  }

  /** Runs one owner transaction through the wallet, then refreshes. */
  async function ownerTx(button, errId, kind, params) {
    button.disabled = true;
    setErr(errId, null);
    try {
      await wallet.send(await txFor(kind, params));
      await poll();
    } catch (err) {
      setErr(errId, err.message);
    } finally {
      button.disabled = false;
    }
  }

  // ---------------------------------------------------------------- connect and create

  async function connect() {
    setErr("connect-err", null);
    try {
      session.account = await wallet.connect();
      listen(wallet.provider);
      try { localStorage.setItem("leash.account", session.account); } catch {}
      if (!session.vault) {
        const { vault } = await api(`/api/vault?owner=${session.account}`);
        if (vault && vault !== ZERO) session.vault = vault;
      }
      await poll();
    } catch (err) {
      if (!err.cancelled) setErr("connect-err", err.message);
      render();
    }
  }
  $("connect-wallet").addEventListener("click", connect);

  // The wallet can switch accounts or chains behind the page. Follow it: a new account that owns a vault goes
  // to its vault; one that does not keeps looking at the current vault as a visitor (or lands on Create).
  async function adoptAccount(accounts) {
    const next = accounts?.[0] ?? null;
    if ((next ?? "").toLowerCase() === (session.account ?? "").toLowerCase()) return;
    session.account = next;
    try { if (next) localStorage.setItem("leash.account", next); else localStorage.removeItem("leash.account"); } catch {}
    if (next) {
      const { vault } = await api(`/api/vault?owner=${next}`).catch(() => ({}));
      if (vault && vault !== ZERO) { session.vault = vault; history.replaceState(null, "", `/app?vault=${vault}`); }
    }
    await poll();
  }
  const listened = new WeakSet();
  function listen(provider) {
    if (!provider?.on || listened.has(provider)) return;
    listened.add(provider);
    provider.on("accountsChanged", (a) => adoptAccount(a).catch((err) => setErr("dash-err", err.message)));
    provider.on("chainChanged", () => location.reload());
  }
  listen(wallet.provider);
  $("owner-name").addEventListener("click", () => { if (!session.account) connect(); });

  $("use-demo-agent").addEventListener("click", () => {
    if (deployment.agent) { $("agent-address").value = deployment.agent; showIdentity("create-identity", deployment.agent); }
    else setErr("create-err", "No demo agent in this deployment.");
  });
  $("agent-address").addEventListener("input", (e) => showIdentity("create-identity", e.target.value.trim()));

  $("create-vault").addEventListener("click", async (e) => {
    const button = e.currentTarget; // null after the first await: keep the reference
    const label = $("agent-label").value.trim().toLowerCase();
    const agent = $("agent-address").value.trim();
    const status = (msg) => setErr("create-status", msg);
    setErr("create-err", null);
    button.disabled = true;
    try {
      status("Building the transaction…");
      await wallet.send(await txFor("createVault", { agent, label }), status);
      status("Confirmed. Looking up your vault…");
      for (let i = 0; i < 20 && !session.vault; i++) {
        const { vault } = await api(`/api/vault?owner=${session.account}`);
        if (vault && vault !== ZERO) session.vault = vault;
        else await new Promise((r) => setTimeout(r, 1500));
      }
      if (!session.vault) throw new Error("Vault created but not found yet; reload in a moment.");
      history.replaceState(null, "", `/app?vault=${session.vault}`);
      await poll();
    } catch (err) {
      setErr("create-err", err.message);
    } finally {
      status(null);
      button.disabled = false;
    }
  });

  // ---------------------------------------------------------------- A′: fund and set the cap

  const DEPOSIT = { usdc: String(10_000n * 1_000_000n), hype: String(1_000n * 10n ** 18n) };
  async function deposit(button, errId) {
    button.disabled = true;
    setErr(errId, null);
    try {
      await wallet.send(await txFor("depositUsdc", { usdc: DEPOSIT.usdc }));
      await wallet.send(await txFor("depositHype", { hype: DEPOSIT.hype }));
      await poll();
    } catch (err) {
      setErr(errId, err.message);
    } finally {
      button.disabled = false;
    }
  }
  $("a2-deposit").addEventListener("click", (e) => deposit(e.currentTarget, "a2-err"));
  $("deposit").addEventListener("click", (e) => deposit(e.currentTarget, "dash-err"));

  function step(done, text, tx) {
    const el = document.createElement("div");
    el.className = done ? "done" : "";
    el.textContent = `${done ? "☑" : "☐"} ${text}${tx ? `   ${short(tx)}` : ""}`;
    return el;
  }

  $("create-mandate").addEventListener("click", async (e) => {
    const t = TIERS[session.tier];
    const value = Math.floor(Number($("a2-cap").value));
    setErr("a2-err", null);
    if (!(value >= 1 && value <= t.cap)) {
      setErr("a2-err", `Choose between 1 and ${fmt(t.cap)} USDC. Authority can only go down from your credential's cap.`);
      return;
    }
    e.currentTarget.disabled = true;
    const tx = session.txs ?? {};
    const steps = [step(true, `Tier granted on ${snap.state.agentLabel}.leash.eth`, tx.grantTier), step(true, "Vault clock stamped", tx.verify)];
    $("a2-steps").replaceChildren(...steps, step(false, "Starting authority set", "pending…"));
    try {
      const hash = await wallet.send(await txFor("setCap", { cap: String(BigInt(value) * 1_000_000n) }));
      $("a2-steps").replaceChildren(...steps, step(true, "Starting authority set", hash));
      session.tier = null;
      await poll();
    } catch (err) {
      setErr("a2-err", err.message);
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  // ---------------------------------------------------------------- dashboard owner actions

  $("revoke").addEventListener("click", (e) => ownerTx(e.currentTarget, "dash-err", "revoke"));
  $("restore").addEventListener("click", (e) => ownerTx(e.currentTarget, "dash-err", "restore"));
  $("withdraw").addEventListener("click", (e) => ownerTx(e.currentTarget, "dash-err", "withdraw", { token: deployment.usdc ?? "", amount: snap?.state?.vaultUsdc ?? "0" }));

  // ---------------------------------------------------------------- World ID modal

  let attempt = 0;

  function loadIDKit() {
    if (window.IDKit) return Promise.resolve(window.IDKit);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/idkit.global.js";
      s.onload = () => resolve(window.IDKit);
      s.onerror = () => reject(new Error("could not load IDKit"));
      document.head.append(s);
    });
  }

  function drawQR(uri) {
    const box = $("qr");
    $("vm-link").href = uri;
    $("vm-link").hidden = false;
    box.dataset.uri = uri;
    if (window.qrcode) {
      const q = window.qrcode(0, "M");
      q.addData(uri);
      q.make();
      box.innerHTML = q.createImgTag(4, 0);
    } else {
      box.innerHTML = '<span class="quiet">Use the link below</span>';
    }
  }

  const closeModal = () => { $("verify-modal").hidden = true; };

  async function startVerify() {
    const mine = ++attempt;
    $("cancelled").hidden = true;
    setErr("vm-err", null);
    $("vm-link").hidden = true;
    $("qr").innerHTML = '<span class="quiet">Preparing…</span>';
    $("verify-modal").hidden = false;
    try {
      const ctx = await api("/api/rp-context", {});
      const IDKit = await loadIDKit();
      const request = await IDKit.request({
        app_id: ctx.app_id,
        action: ctx.action,
        rp_context: ctx.rp_context,
        allow_legacy_proofs: ctx.allow_legacy_proofs === true,
        environment: ctx.environment,
      }).constraints(constraintsFor(IDKit, ctx.credentials));
      if (mine !== attempt) return;
      drawQR(request.connectorURI);
      const completion = await request.pollUntilCompletion({ pollInterval: 2000, timeout: 180_000 });
      if (mine !== attempt) return; // cancelled while waiting: ignore the result, send nothing
      if (!completion.success) throw new Error(completion.error === "user_rejected" ? "You declined in World App. Nothing was granted." : `World ID: ${completion.error}`);
      const out = await api("/api/proof", { result: completion.result, vault: session.vault });
      session.tier = out.tier;
      session.txs = out.txs;
      closeModal();
      await poll();
    } catch (err) {
      if (mine !== attempt) return;
      setErr("vm-err", err.status === 503 ? "World ID isn't configured on this server yet." : err.message);
    }
  }

  $("vm-cancel").addEventListener("click", () => {
    attempt++; // any in-flight poll result is now ignored
    closeModal();
    if (screenOf(snap?.state, session) === "verify") $("cancelled").hidden = false;
  });
  $("verify-first").addEventListener("click", startVerify);
  $("verify-again").addEventListener("click", startVerify);

  // ---------------------------------------------------------------- boot

  renderTierRows();
  (async () => {
    try {
      deployment = await api("/api/deployment");
      applyPolicy(deployment.policy);
      renderTierRows();
    } catch {}
    const fromUrl = new URLSearchParams(location.search).get("vault");
    if (fromUrl && /^0x[0-9a-fA-F]{40}$/.test(fromUrl)) session.vault = fromUrl;
    // A wallet that connected before: pick it up silently if the provider still exposes it.
    try {
      const remembered = localStorage.getItem("leash.wallet");
      if (remembered && discovered.has(remembered)) { chosen = discovered.get(remembered); listen(wallet.provider); }
      if (localStorage.getItem("leash.account") && wallet.provider) {
        const accounts = await wallet.provider.request({ method: "eth_accounts" });
        if (accounts?.[0]) {
          session.account = accounts[0];
          if (!session.vault) {
            const { vault } = await api(`/api/vault?owner=${session.account}`);
            if (vault && vault !== ZERO) session.vault = vault;
          }
        }
      }
    } catch {}
    window.leash = { session, api, poll, render, startVerify, wallet, $, get snap() { return snap; } };
    await poll();
    setInterval(poll, 3000);
    setInterval(render, 1000);
  })();
}
