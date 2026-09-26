// The first viewport of variant B: page-load choreography, the two-line typewriter and the live badge.
// The visual pane is beads.js. Everything degrades: no motion under prefers-reduced-motion, static badge
// text if the API is unreachable.
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (id) => document.getElementById(id);
const frame = $("frame");

// ---------- choreography: the CSS only animates when .anim is present ----------
if (!reduced) frame.classList.add("anim");

// ---------- typewriter: "Permission that" (muted) / "shrinks on its own" (ink) ----------
(function typewriter() {
  const lines = [...document.querySelectorAll(".hero__line[data-line]")];
  const caret = $("caret");
  const START_DELAY = 380, CHAR_MS = 42, LINE_PAUSE = 220;
  const done = () => frame.classList.add("is-typed");

  if (reduced) {
    for (const l of lines) l.textContent = l.dataset.line;
    caret.remove();
    done();
    return;
  }
  // The caret lives at the end of whichever line is being typed.
  const typeLine = (idx) => new Promise((resolve) => {
    const el = lines[idx], text = el.dataset.line;
    el.appendChild(caret);
    let i = 0;
    const step = () => {
      i += 1;
      el.textContent = text.slice(0, i);
      el.appendChild(caret);
      if (i < text.length) setTimeout(step, CHAR_MS); else resolve();
    };
    step();
  });
  setTimeout(async () => {
    await typeLine(0);
    await new Promise((r) => setTimeout(r, LINE_PAUSE));
    await typeLine(1);
    done();
  }, START_DELAY);
})();

// ---------- badge: the demo vault's live cap, else the static line ----------
(async function badge() {
  const text = $("badge-text");
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  try {
    const dep = await (await fetch("/api/deployment", { cache: "no-store" })).json();
    const vault = dep && dep.vault;
    if (!vault) return;
    const read = async () => {
      const s = await (await fetch(`/api/state?vault=${vault}`, { cache: "no-store" })).json();
      if (!Number.isFinite(Number(s.cap))) return;
      text.textContent = `CAP ${fmt(Number(s.cap))} USDC · HALVES EVERY 24H`;
    };
    await read();
    if (!reduced) setInterval(() => read().catch(() => {}), 6000);
  } catch {
    // API unreachable: the fallback text is already in the markup.
  }
})();
