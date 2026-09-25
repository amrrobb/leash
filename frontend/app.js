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
    lastText: verified ? ago(elapsed) : "Never",
    tierName: tier ? tier.name : "no credential",
    zeroText: empty ? "Reached" : ld > 0 ? `in ~${ld}d ${lh}h` : `in ~${lh}h`,
    openText: empty ? "Paused" : "Allowed",
    fillText: empty ? "None" : `Up to ${fmt(authority)}`,
    cNote: !alive ? "You revoked the mandate." : empty ? "Nobody verified for 3 days. Authority reached zero." : "",
    clockText: `Demo clock: 1 second = ${(speed / 3600).toFixed(1)} hours`,
    revoked: !alive,
  };
}

export const TAGS = {
  you: ["Verified", "ok"],
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

  const api = async (path, body) => {
    const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

  function renderDashboard() {
    const v = dashboardView(snap.state, chainNow());
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
    $("c-note").hidden = !v.cNote;
    $("c-note").textContent = v.cNote;
    $("withdraw").hidden = v.tone !== "pause";
    $("revoke").hidden = v.revoked;
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
    document.body.dataset.screen = screen;
  }

  async function poll() {
    try {
      const state = await api("/api/state");
      snap = { state, fetchedAt: Date.now() };
      render();
      renderFeed(await api("/api/feed"));
      $("dash-err").hidden = true;
    } catch (err) {
      $("dash-err").hidden = false;
      $("dash-err").textContent = `Could not read the chain: ${err.message}`;
    }
  }

  async function ownerAction(button, path, body) {
    button.disabled = true;
    try {
      await api(path, body);
      await poll();
    } catch (err) {
      $("dash-err").hidden = false;
      $("dash-err").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  $("revoke").addEventListener("click", (e) => ownerAction(e.currentTarget, "/api/demo/revoke"));
  $("withdraw").addEventListener("click", (e) => ownerAction(e.currentTarget, "/api/demo/withdraw"));

  window.leash = { session, api, poll, render, ownerAction, $, get snap() { return snap; } };
  poll();
  setInterval(poll, 3000);
  setInterval(render, 1000);
}
