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


// ---------- 04 · three lanes: permission, money, enforcement ----------
(function lanes() {
  const svg = $("lanes-svg"), root = $("lanes"), cap = $("lanes-caption");
  if (!svg) return;
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  // x positions are shared across lanes so the three Vault/ENS columns line up
  const LANES = [
    { id: "permission", label: "Permission", tag: "ENS · World", y: 58, band: [0, 112], pulse: "pulse",
      say: "A human proof grants a role bit on a name you own.",
      nodes: [
        { x: 170, w: 96, t: "Human" },
        { x: 300, w: 104, t: "World ID", s: "QR scan" },
        { x: 440, w: 104, t: "backend", s: "verifies proof" },
        { x: 590, w: 150, t: "<you>.leash.eth", s: "role bit · revocable", code: true, cls: "node--vault" },
      ] },
    { id: "money", label: "Money", tag: "your vault", y: 170, band: [112, 258], pulse: "pulse",
      say: "Your money stays in your Vault; the agent only calls ship and dock.",
      nodes: [
        { x: 170, w: 104, t: "Your wallet" },
        { x: 330, w: 150, t: "Vault", s: "your money stays here", cls: "node--vault" },
        { x: 590, w: 150, t: "Aqua position", s: "HYPE / USDC" },
        { x: 330, w: 150, t: "agent", s: "ship / dock only", dy: 62, code: true, dashedTo: 1 },
      ] },
    { id: "enforcement", label: "Enforcement", tag: "1inch · SwapVM", y: 290, band: [258, 340], pulse: "pulse pulse--trim",
      say: "Every trade passes the opcode, which trims to the cap or refuses.",
      nodes: [
        { x: 170, w: 96, t: "any trade" },
        { x: 300, w: 140, t: "MandateAquaRouter" },
        { x: 470, w: 110, t: "opcode 0x2f", s: "Vault.mandate()", code: true },
        { x: 610, w: 100, t: "ENS roles" },
        { x: 750, w: 150, t: "trim or refuse", s: "10,000 → 7,500", cls: "node--trim" },
      ] },
  ];
  const H = 40;
  LANES.forEach((L) => {
    const g = el("g", { class: "lane", tabindex: "0", role: "button", "aria-pressed": "false", "data-lane": L.id });
    g.appendChild(el("title", {}, `${L.label}: ${L.say}`));
    g.appendChild(el("rect", { x: 0, y: L.band[0], width: 960, height: L.band[1] - L.band[0], class: "lane__hit" }));
    g.appendChild(el("line", { x1: 20, y1: L.y, x2: 940, y2: L.y, class: "lane__rail" }));
    g.appendChild(el("text", { x: 20, y: L.y - 10, class: "lane__label" }, L.label));
    const tagW = L.tag.length * 6.4 + 16;
    g.appendChild(el("rect", { x: 20, y: L.y + 4, width: tagW, height: 18, rx: 9, class: "lane__tagbox" }));
    g.appendChild(el("text", { x: 28, y: L.y + 16.5, class: "lane__tag" }, L.tag));
    const main = L.nodes.filter((n) => !n.dy);
    main.forEach((n, i) => {
      if (i === 0) return;
      const p = main[i - 1];
      const d = `M${p.x + p.w} ${L.y} L${n.x} ${L.y}`;
      const id = `edge-${L.id}-${i}`;
      g.appendChild(el("path", { id, d, class: "edge" }));
      g.appendChild(el("path", { d: `M${n.x - 6} ${L.y - 4} L${n.x} ${L.y} L${n.x - 6} ${L.y + 4} Z`, class: "edge__end" }));
      if (!reduced) {
        const c = el("circle", { r: 4, class: L.pulse });
        const am = el("animateMotion", { dur: "2.2s", repeatCount: "indefinite", begin: `${(i - 1) * 0.55}s` });
        am.appendChild(el("mpath", { href: `#${id}` }));
        c.appendChild(am);
        g.appendChild(c);
      }
    });
    L.nodes.forEach((n) => {
      const y = L.y + (n.dy || 0);
      if (n.dy) {
        const to = L.nodes[n.dashedTo];
        g.appendChild(el("path", { d: `M${n.x + n.w / 2} ${y - H / 2} L${to.x + to.w / 2} ${L.y + H / 2}`, class: "edge edge--dash" }));
      }
      g.appendChild(el("rect", { x: n.x, y: y - H / 2, width: n.w, height: H, rx: 8, class: `node ${n.cls || ""}` }));
      const ty = n.s ? y - 2 : y + 4.5;
      g.appendChild(el("text", { x: n.x + n.w / 2, y: ty, "text-anchor": "middle", class: `node__text ${n.code ? "node__text--code" : ""}` }, n.t));
      if (n.s) g.appendChild(el("text", { x: n.x + n.w / 2, y: y + 12, "text-anchor": "middle", class: "node__sub" }, n.s));
    });
    svg.appendChild(g);
  });
  const groups = [...svg.querySelectorAll(".lane")];
  let active = null;
  function set(id) {
    active = id;
    root.classList.toggle("has-active", !!id);
    groups.forEach((g) => { const on = g.dataset.lane === id; g.classList.toggle("is-active", on); g.setAttribute("aria-pressed", String(on)); });
    const L = LANES.find((l) => l.id === id);
    cap.textContent = L ? L.say : "Hover or tap a lane.";
    cap.classList.toggle("is-set", !!L);
  }
  groups.forEach((g) => {
    const id = g.dataset.lane;
    g.addEventListener("mouseenter", () => set(id));
    g.addEventListener("focus", () => set(id));
    g.addEventListener("click", () => set(active === id ? null : id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(active === id ? null : id); } });
  });
  svg.addEventListener("mouseleave", () => { if (!svg.contains(document.activeElement)) set(null); });
  svg.addEventListener("focusout", (e) => { if (!svg.contains(e.relatedTarget)) set(null); });
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
    text: "No vault, no name, no permission yet." },
  { t: "Create vault", cap: 0, tone: "pause", open: "—", feed: "VaultFactory: vault + alice.leash.eth + agent mandate · 1 tx",
    title: "One transaction: vault, name, mandate.",
    text: "Her Vault, <name>.leash.eth registered to her, and the agent's MANDATE role. She keeps the admin bits." },
  { t: "World proof", cap: 15000, tone: "ok", open: "Allowed", feed: "Verified · Orb · Vault clock stamped · tier role granted",
    title: "She proves she is here with World ID.",
    text: "A QR scan. The backend verifies the proof, grants the tier and stamps the clock. Orb sets 15,000 USDC." },
  { t: "Fund", cap: 15000, tone: "ok", open: "Allowed", feed: "In your vault: 10,000 USDC · 1,000 HYPE",
    title: "She deposits and sets a cap.",
    text: "Tokens go into her own Vault, not to the agent. The cap sits at or under the tier." },
  { t: "Agent opens", cap: 15000, tone: "ok", open: "Allowed", feed: "Agent opened HYPE/USDC · Operating",
    title: "The agent opens a position by itself.",
    text: "It reads Vault.mandate() and ships through the Vault, which checks the role and the cap and becomes the maker." },
  { t: "Market trimmed", cap: 7500, tone: "ok", open: "Allowed", feed: "Asked 10,000 · allowed 7,500 · Trimmed",
    title: "A day passes. The market asks for 10,000 and gets 7,500.",
    text: "The opcode reads the decayed cap inside the swap and trims the USDC leg. Measured at 24 demo-hours." },
  { t: "Zero", cap: 0, tone: "pause", open: "Paused", feed: "Nobody verified for 3 days. Authority reached zero.",
    title: "Nobody comes back for three days. Zero.",
    text: "Cut to zero at 72 hours. Large trades were shrinking first the whole way down." },
  { t: "Refused, closes", cap: 0, tone: "pause", open: "Paused", feed: "refused: MandateEmpty · closing position · waiting for the human",
    title: "The agent is refused, but it can still close.",
    text: "It tries to open, the chain answers MandateEmpty, and it docks the position. Resting, not stuck." },
  { t: "Human returns", cap: 15000, tone: "ok", open: "Allowed", feed: "Verified again · Orb · Agent resumed",
    title: "Alice scans once. The agent resumes.",
    text: "Only a human proof moves the clock. Revoke and Restore do the same by hand." },
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
