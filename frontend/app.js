// Leash dashboard. Pure view-model functions are exported for tests; DOM code runs only in a browser.

export const PERIOD = 86_400;
export const CUTOFF = 3 * PERIOD;
export const TIERS = {
  orb: { key: "orb", name: "Orb", note: "Highest assurance · unique human", cap: 15_000, bit: 1n << 44n },
  document: { key: "document", name: "Passport (NFC)", note: "Document-backed", cap: 7_500, bit: 1n << 48n },
  selfie: { key: "selfie", name: "Selfie Check", note: "Beta · liveness, medium assurance", cap: 2_000, bit: 1n << 52n },
};
const MANDATE = 1n << 40n;

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

function ago(sec) {
  if (sec < 3600) return "Just now";
  const d = Math.floor(sec / 86_400), h = Math.floor((sec % 86_400) / 3600);
  return d > 0 ? `${d}d ${h}h ago` : `${h}h ago`;
}

/** Which of the four states to show. `session.tier` is set after a proof this page submitted. */
export function screenOf(s, session = {}) {
  if (BigInt(s.ownerCap) === 0n) return session.tier ? "A2" : "A";
  return "BC";
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

/** "10,000 USDC · 1,000 HYPE" from raw balances. */
export function balancesText(s) {
  const usdc = Number(BigInt(s.vaultUsdc ?? 0)) / 1e6, hype = Number(BigInt(s.vaultHype ?? 0)) / 1e18;
  return `${usdc.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDC · ${hype.toLocaleString("en-US", { maximumFractionDigits: 0 })} HYPE`;
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
  const session = { tier: null };
  let snap = null; // { state, fetchedAt }

  // On a public host the owner routes need a token: open the page once as /app#demo=<DEMO_TOKEN> and it sticks.
  try {
    const m = location.hash.match(/demo=([^&]+)/);
    if (m) {
      localStorage.setItem("leash.demoToken", decodeURIComponent(m[1]));
      history.replaceState(null, "", location.pathname);
    }
  } catch {}
  const demoToken = () => { try { return localStorage.getItem("leash.demoToken") || ""; } catch { return ""; } };

  const api = async (path, body) => {
    const headers = { "Content-Type": "application/json" };
    if (demoToken()) headers["x-demo-token"] = demoToken();
    const res = await fetch(path, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
    return data;
  };

  const chainNow = () => (snap ? Number(snap.state.timestamp) + (Date.now() - snap.fetchedAt) / 1000 : 0);

  function show(screen) {
    for (const [id, on] of [["dashboard", screen === "BC"], ["state-a", screen === "A"], ["state-a2", screen === "A2"]]) {
      const el = $(id);
      if (el) el.hidden = !on;
    }
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
    $("c-note").hidden = !v.cNote;
    $("c-note").textContent = v.cNote;
    $("withdraw").hidden = v.tone !== "pause";
    $("revoke").hidden = v.tone === "pause"; // close-only offers verify and withdraw, as designed
    // Verifying renews the clock and tier; it cannot undo Alice's own revoke. Only she can restore it.
    $("verify-again").hidden = v.revoked;
    $("restore").hidden = !v.revoked;
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

  function render() {
    if (!snap) return;
    const screen = screenOf(snap.state, session);
    show(screen);
    if (screen === "BC") renderDashboard();
    if (screen === "A2") renderA2();
    document.body.dataset.screen = screen;
  }

  async function poll() {
    try {
      const state = await api("/api/state");
      snap = { state, fetchedAt: Date.now() };
      render();
      $("dash-err").hidden = true;
    } catch (err) {
      $("dash-err").hidden = false;
      $("dash-err").textContent = `Could not read the chain: ${err.message}`;
      return;
    }
    try {
      renderFeed(await api("/api/feed"));
    } catch {
      // A failed event read must not hide a healthy dashboard; the next poll retries.
    }
  }

  async function ownerAction(button, path, body) {
    button.disabled = true;
    try {
      await api(path, body ?? {});
      await poll();
    } catch (err) {
      $("dash-err").hidden = false;
      $("dash-err").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }


  // ---------------------------------------------------------------- State A and A'

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

  function renderA2() {
    const t = TIERS[session.tier];
    $("a2-verified").textContent = `Verified · ${t.name}`;
    $("a2-headline").textContent = `Authority up to ${fmt(t.cap)} USDC`;
    $("a2-max").textContent = `max ${fmt(t.cap)} · can only go down`;
    if (snap) $("a2-balances").textContent = balancesText(snap.state);
    const input = $("a2-cap");
    input.max = String(t.cap);
    if (!input.value) input.value = String(t.cap);
  }

  function step(done, text, tx) {
    const el = document.createElement("div");
    el.className = done ? "done" : "";
    el.textContent = `${done ? "☑" : "☐"} ${text}${tx ? `   ${tx.slice(0, 6)}…${tx.slice(-4)}` : ""}`;
    return el;
  }

  $("create-mandate").addEventListener("click", async (e) => {
    const t = TIERS[session.tier];
    const value = Math.floor(Number($("a2-cap").value));
    $("a2-err").hidden = true;
    if (!(value >= 1 && value <= t.cap)) {
      $("a2-err").hidden = false;
      $("a2-err").textContent = `Choose between 1 and ${fmt(t.cap)} USDC. Authority can only go down from your credential's cap.`;
      return;
    }
    e.currentTarget.disabled = true;
    const tx = session.txs ?? {};
    const steps = [step(true, "Role granted on agent.leash.eth", tx.grantTier), step(true, "Vault clock stamped", tx.verify)];
    $("a2-steps").replaceChildren(...steps, step(false, "Starting authority set", "pending…"));
    try {
      const out = await api("/api/demo/set-cap", { cap: String(BigInt(value) * 1_000_000n) });
      $("a2-steps").replaceChildren(...steps, step(true, "Starting authority set", out.tx));
      session.tier = null;
      await poll();
    } catch (err) {
      $("a2-err").hidden = false;
      $("a2-err").textContent = err.message;
    } finally {
      e.currentTarget.disabled = false;
    }
  });

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

  function closeModal() {
    $("verify-modal").hidden = true;
  }

  async function startVerify() {
    const mine = ++attempt;
    $("cancelled").hidden = true;
    $("vm-err").hidden = true;
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
      const out = await api("/api/proof", completion.result);
      session.tier = out.tier;
      session.txs = out.txs;
      closeModal();
      await poll();
      if (screenOf(snap.state, session) === "A2") renderA2();
    } catch (err) {
      if (mine !== attempt) return;
      $("vm-err").hidden = false;
      $("vm-err").textContent = err.status === 503 ? "World ID isn't configured on this server yet." : err.message;
    }
  }

  $("vm-cancel").addEventListener("click", () => {
    attempt++; // any in-flight poll result is now ignored
    closeModal();
    if (!snap || screenOf(snap.state, session) === "A") $("cancelled").hidden = false;
  });
  $("verify-first").addEventListener("click", startVerify);
  $("verify-again").addEventListener("click", startVerify);
  renderTierRows();

  $("revoke").addEventListener("click", (e) => ownerAction(e.currentTarget, "/api/demo/revoke"));
  $("withdraw").addEventListener("click", (e) => ownerAction(e.currentTarget, "/api/demo/withdraw"));
  $("restore").addEventListener("click", (e) => ownerAction(e.currentTarget, "/api/demo/grant-mandate"));
  const DEPOSIT = { usdc: String(10_000n * 1_000_000n), hype: String(1_000n * 10n ** 18n) };
  $("deposit").addEventListener("click", (e) => ownerAction(e.currentTarget, "/api/demo/deposit", DEPOSIT));
  $("a2-deposit").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api("/api/demo/deposit", DEPOSIT);
      await poll();
    } catch (err) {
      $("a2-err").hidden = false;
      $("a2-err").textContent = err.message;
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  window.leash = { session, api, poll, render, ownerAction, startVerify, $, get snap() { return snap; } };
  poll();
  setInterval(poll, 3000);
  setInterval(render, 1000);
}
