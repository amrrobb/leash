// ASCII leash. A rope from the human (left ring) to the agent (right dot). Taut and still at full
// authority; it sags and ripples as authority decays; at zero it lies slack on the ground.
// Usage: const w = LeashWave.mount(preElement, { ratio: 1 }); w.setRatio(0.4); w.setTone("trim");
(function (global) {
  const COLS = 72, ROWS = 9;

  function frame(ratio, t) {
    const r = Math.max(0, Math.min(1, ratio));
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));
    const top = 1, floor = ROWS - 2;
    const sag = (floor - top) * (1 - r); // 0 when taut, full drop at zero
    const ripple = 0.9 * (1 - r) + 0.08; // faint motion even when taut, so it reads as alive
    const speed = 1.2 + 2.5 * (1 - r);
    const x0 = 3, x1 = COLS - 4;
    let prevY = null;
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / (x1 - x0);
      const hang = Math.sin(Math.PI * u) * sag;
      const wave = Math.sin(u * 9 - t * speed) * ripple * Math.sin(Math.PI * u);
      let y = top + hang + wave;
      if (r === 0) y = floor + Math.sin(u * 7 - t * 0.8) * 0.4; // slack on the ground
      y = Math.max(top, Math.min(floor, y));
      const row = Math.round(y);
      const slope = prevY === null ? 0 : y - prevY;
      const ch = r === 0 ? "." : Math.abs(slope) < 0.18 ? (r > 0.85 ? "=" : "~") : slope > 0 ? "\\" : "/";
      grid[row][x] = ch;
      prevY = y;
    }
    grid[top][x0 - 2] = "("; grid[top][x0 - 1] = ")"; // the human: a ring
    const endRow = r === 0 ? floor : Math.round(top);
    grid[endRow][x1 + 1] = "@"; // the agent
    return grid.map((row) => row.join("")).join("\n");
  }

  function mount(el, opts = {}) {
    let ratio = opts.ratio ?? 1, t = 0, raf = null, last = 0;
    el.setAttribute("aria-hidden", "true");
    function tick(now) {
      if (now - last > 90) { // ~11 fps: ASCII should flicker, not glide
        t += 0.35;
        el.textContent = frame(ratio, t);
        last = now;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return {
      setRatio(v) { ratio = v; },
      setTone(tone) { el.dataset.tone = tone; },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  global.LeashWave = { mount, frame };
})(typeof window !== "undefined" ? window : globalThis);
