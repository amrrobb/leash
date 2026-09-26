// The explanatory half of the landing page: the decay loop, the demo stepper, the live read.
// Everything here is presentational; the only network calls are two GETs against our own API,
// and both fail quietly to static placeholders.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const $ = (id) => document.getElementById(id);

// Same rule as Vault.limitAt: halves every 24h, linear inside a period, zero from 72h on.
const TOP = 15000, PERIOD = 24, CUTOFF = 72;
function capAt(hours) {
  if (hours >= CUTOFF) return 0;
  const k = Math.floor(hours / PERIOD);
  const start = TOP / 2 ** k, end = start / 2;
  return start - (start - end) * ((hours - k * PERIOD) / PERIOD);
}
// The rope is 72 monospace columns; size the type so it spans its container (Plex Mono is 0.6em wide).
function fitWave(pre) {
  const fit = () => { pre.style.fontSize = `${Math.max(6, Math.min(13, pre.clientWidth / 72 / 0.6))}px`; };
  fit();
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(pre);
  return pre;
}
const toneFor = (ratio) => (ratio === 0 ? "pause" : ratio < 0.4 ? "trim" : "ok");
const PILL = { ok: "Operating", trim: "Trimming fills", pause: "Close-only" };

// ---------- reveal on scroll ----------
if (reduced || !("IntersectionObserver" in window)) {
  document.documentElement.classList.add("no-reveal");
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -10% 0px" });
  document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
}

// ---------- 03 · decay curve + leash ----------
(function decay() {
  const root = $("decay");
  if (!root) return;
  const num = $("decay-num"), hrs = $("decay-hours"), prog = $("decay-progress"), dot = $("decay-dot");
  const scan = $("decay-scan"), status = $("decay-status"), open = $("decay-open");
  const wave = window.LeashWave && $("idea-wave") ? window.LeashWave.mount(fitWave($("idea-wave")), { ratio: 1 }) : null;
  // chart geometry: x 60..600 is 0..72h, y 20..220 is 15,000..0
  const X = (h) => 60 + (h / CUTOFF) * 540, Y = (c) => 220 - (c / TOP) * 200;
  const DUR = reduced ? 1 : 14000; // ms for 0 -> 72h
  const HOLD = 2200; // ms shown at zero before the human scans

  let t0 = performance.now(), phase = "run", holdUntil = 0, scanUntil = 0;

  function render(h) {
    const c = capAt(h), ratio = c / TOP, tone = toneFor(ratio);
    num.textContent = fmt(c);
    hrs.textContent = `${Math.floor(h)}h`;
    // played path follows the polyline through the day marks
    let d = `M${X(0)} ${Y(TOP)}`;
    for (let k = 1; k * PERIOD < h; k++) d += ` L${X(k * PERIOD)} ${Y(capAt(k * PERIOD))}`;
    d += ` L${X(h)} ${Y(c)}`;
    if (h >= CUTOFF) d += ` V220`;
    prog.setAttribute("d", d);
    dot.setAttribute("cx", X(Math.min(h, CUTOFF)));
    dot.setAttribute("cy", Y(c));
    root.dataset.tone = tone;
    status.className = `pill pill--${tone}`;
    status.innerHTML = `<i></i>${PILL[tone]}`;
    open.textContent = tone === "pause" ? "Paused" : "Allowed";
    open.style.color = tone === "pause" ? "var(--pause-ink)" : "var(--ink)";
    if (wave) { wave.setRatio(ratio); wave.setTone(tone); }
  }

  function humanScans(now) {
    t0 = now; phase = "run";
    scan.setAttribute("opacity", "1");
    scanUntil = now + 1400;
  }

  function tick(now) {
    if (phase === "run") {
      const h = Math.min(CUTOFF, ((now - t0) / DUR) * CUTOFF);
      render(h);
      if (h >= CUTOFF) { phase = "hold"; holdUntil = now + HOLD; }
    } else if (phase === "hold" && now >= holdUntil) {
      humanScans(now);
    }
    if (scanUntil && now > scanUntil) { scan.setAttribute("opacity", "0"); scanUntil = 0; }
    requestAnimationFrame(tick);
  }

  if (reduced) {
    // A still frame that shows the argument: one day in, 7,500, no motion.
    render(PERIOD);
    $("decay-scan-btn").addEventListener("click", () => render(0));
    return;
  }
  render(0);
  requestAnimationFrame(tick);
  $("decay-scan-btn").addEventListener("click", () => humanScans(performance.now()));
})();

// ---------- 05 · trimmed trade bars grow when seen ----------
(function trim() {
  const fig = document.querySelector(".trim");
  if (!fig || reduced || !("IntersectionObserver" in window)) return;
  fig.classList.add("is-armed");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { fig.classList.add("is-in"); io.disconnect(); }
  }, { threshold: 0.4 });
  io.observe(fig);
})();

// ---------- 06 · the demo, step by step ----------
const STEPS = [
  { t: "Connect", cap: 0, tone: "pause", open: "—", feed: "Any wallet on Sepolia. Nothing exists yet.",
    title: "Alice connects her wallet.",
    text: "Any injected wallet on Sepolia. There is no vault, no name and no permission yet; the dashboard shows a single card." },
  { t: "Create vault", cap: 0, tone: "pause", open: "—", feed: "VaultFactory: vault + alice.leash.eth + agent mandate · 1 tx",
    title: "One transaction: vault, name, mandate.",
    text: "VaultFactory deploys her Vault, registers <name>.leash.eth to her in her own ENSv2 registry and grants the agent its MANDATE role. She keeps the admin bits." },
  { t: "World proof", cap: 15000, tone: "ok", open: "Allowed", feed: "Verified · Orb · Vault clock stamped · tier role granted",
    title: "She proves she is here with World ID.",
    text: "A QR scan in World App. The backend verifies the proof server-side, grants the tier role at the registry root and stamps the Vault clock. The credential sets the ceiling: Orb is 15,000 USDC." },
  { t: "Fund", cap: 15000, tone: "ok", open: "Allowed", feed: "In your vault: 10,000 USDC · 1,000 HYPE",
    title: "She deposits and sets a cap.",
    text: "Tokens go into her own Vault, not to the agent. Her cap can only sit at or under the tier. From here the agent works alone." },
  { t: "Agent opens", cap: 15000, tone: "ok", open: "Allowed", feed: "Agent opened HYPE/USDC · Operating",
    title: "The agent opens a position by itself.",
    text: "agent/loop.mjs reads Vault.mandate(), picks the pair from its policy and ships through the Vault. The Vault checks the role and the cap, approves Aqua and becomes the maker." },
  { t: "Market trimmed", cap: 7500, tone: "ok", open: "Allowed", feed: "Asked 10,000 · allowed 7,500 · Trimmed",
    title: "A day passes. The market asks for 10,000 and gets 7,500.",
    text: "The MandateGate opcode reads the decayed cap inside the swap and trims the USDC leg. The taker set allowPartialFill and receives what is allowed. Measured on Sepolia at 24 demo-hours." },
  { t: "Zero", cap: 0, tone: "pause", open: "Paused", feed: "Nobody verified for 3 days. Authority reached zero.",
    title: "Nobody comes back for three days. Authority reaches zero.",
    text: "The cap is cut to zero at 72 hours. Large trades were shrinking first the whole way down, so nothing about this moment is a surprise." },
  { t: "Refused, closes", cap: 0, tone: "pause", open: "Paused", feed: "refused: MandateEmpty · closing position · waiting for the human",
    title: "The agent is refused, but it can still close.",
    text: "It tries to open, the chain answers MandateEmpty, and it docks the open position: risk off. Close positions — Always. Open new ranges — only while the leash is alive. The failure state is resting, not stuck." },
  { t: "Human returns", cap: 15000, tone: "ok", open: "Allowed", feed: "Verified again · Orb · Agent resumed",
    title: "Alice scans once. The cap is back, the agent resumes.",
    text: "Only a human proof moves the clock. Revoke and Restore do the same by hand from the dashboard, and anyone on-chain can read the permission on her ENS name." },
];

(function stepper() {
  const list = $("step-list");
  if (!list) return;
  const wave = window.LeashWave && $("step-wave") ? window.LeashWave.mount(fitWave($("step-wave")), { ratio: 1 }) : null;
  const screen = document.querySelector(".screen");
  let i = 0;

  STEPS.forEach((s, n) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button"; b.className = "step-btn";
    b.innerHTML = `<span class="step-btn__n">${String(n + 1).padStart(2, "0")}</span><span>${s.t}</span>`;
    b.addEventListener("click", () => go(n));
    li.appendChild(b); list.appendChild(li);
  });
  const buttons = [...list.querySelectorAll(".step-btn")];

  function go(n) {
    i = (n + STEPS.length) % STEPS.length;
    const s = STEPS[i], ratio = s.cap / TOP;
    buttons.forEach((b, k) => { b.classList.toggle("is-active", k === i); b.setAttribute("aria-current", k === i ? "step" : "false"); });
    if (i > 0 && buttons[i].scrollIntoView && window.innerWidth < 900) buttons[i].scrollIntoView({ block: "nearest", inline: "center", behavior: reduced ? "auto" : "smooth" });
    $("step-idx").textContent = i + 1;
    $("step-title").textContent = s.title;
    $("step-text").textContent = s.text;
    $("step-cap").textContent = fmt(s.cap);
    $("step-fill").style.width = `${ratio * 100}%`;
    $("step-open").textContent = s.open;
    $("step-open").style.color = s.tone === "pause" ? "var(--pause-ink)" : "var(--ink)";
    $("step-feed").textContent = s.feed;
    const pill = $("step-pill");
    pill.className = `pill pill--${s.tone}`;
    pill.innerHTML = `<i></i>${i < 2 ? "No mandate yet" : PILL[s.tone]}`;
    screen.dataset.tone = s.tone;
    if (wave) { wave.setRatio(ratio); wave.setTone(s.tone); }
    $("step-prev").disabled = i === 0;
    $("step-next").textContent = i === STEPS.length - 1 ? "Start over" : "Next →";
  }
  $("step-prev").addEventListener("click", () => go(i - 1));
  $("step-next").addEventListener("click", () => go(i + 1));
  $("stepper").addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
  });
  go(0);
})();

// ---------- 09 · live read of the demo vault ----------
(async function live() {
  const panel = $("live-panel");
  if (!panel) return;
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const setPill = (tone, text) => { panel.dataset.tone = tone; $("live-pill-text").textContent = text; };
  try {
    const dep = await (await fetch("/api/deployment", { cache: "no-store" })).json();
    const vault = dep && dep.vault;
    if (!vault) throw new Error("no demo vault");
    $("live-vault").textContent = short(vault);
    $("live-link").href = `/app?vault=${vault}`;
    const read = async () => {
      const s = await (await fetch(`/api/state?vault=${vault}`, { cache: "no-store" })).json();
      const cap = Number(s.cap), granted = Number(s.baseCap) || Number(s.ownerCap) || TOP;
      const ratio = granted > 0 ? cap / granted : 0;
      const tone = !s.alive ? "pause" : toneFor(ratio);
      panel.dataset.state = "live";
      $("live-cap").textContent = fmt(cap);
      $("live-agent").textContent = `${s.agentLabel || "agent"}.leash.eth`;
      $("live-alive").textContent = s.alive ? "Alive" : "Revoked";
      $("live-bal").textContent = `${fmt(Number(s.vaultUsdc) / 1e6)} USDC · ${fmt(Number(s.vaultHype) / 1e18)} HYPE`;
      setPill(tone, !s.alive ? "Close-only · revoked" : PILL[tone]);
    };
    await read();
    if (!reduced) setInterval(() => read().catch(() => {}), 6000);
  } catch {
    // API unreachable: leave the static placeholders and say nothing.
    setPill("pause", "Demo vault on Sepolia");
    $("live-cap").textContent = "—";
  }
})();
