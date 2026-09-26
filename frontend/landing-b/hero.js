// The first viewport of variant B: page-load choreography, the two-line typewriter, the live badge and
// the hover crossfade on the visual pane. Everything degrades: no motion under prefers-reduced-motion,
// static badge text if the API is unreachable, a still green pane if the video never decodes.
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

// ---------- visual pane: hover crossfades to the ochre take of the same footage ----------
(function pane() {
  const pane = $("hero-visual"), video = $("hero-video"), canvas = $("hero-canvas");
  if (!pane || !video || !canvas) return;
  const ctx = canvas.getContext("2d");
  let on = false, drawUntil = 0;

  const set = (v) => {
    on = v;
    pane.classList.toggle("is-trim", on);
    drawUntil = performance.now() + 500; // keep drawing through the 400ms fade-out
  };
  pane.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") set(true); });
  pane.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") set(false); });
  // No hover on touch: a tap toggles the take instead.
  pane.addEventListener("click", () => { if (window.matchMedia("(hover: none)").matches) set(!on); });

  // The ochre layer is the video's current frame drawn at the pane's size (object-fit: cover), so both
  // layers show the same instant and the crossfade reads as one image changing tone.
  function frameLoop(now) {
    if ((on || now < drawUntil) && video.videoWidth > 0 && video.videoHeight > 0) {
      const w = pane.clientWidth, h = pane.clientHeight;
      if (w > 0 && h > 0) {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const cover = Math.max(w / video.videoWidth, h / video.videoHeight);
        const sw = w / cover, sh = h / cover;
        const sx = (video.videoWidth - sw) / 2, sy = (video.videoHeight - sh) / 2;
        try { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h); } catch { /* frame not decodable yet */ }
      }
    }
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
})();
