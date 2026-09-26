// The hero visual of variant B: the Leash mark built from a few thousand glossy green beads, turning
// slowly on the paper. Every ~6 s the big crescent tightens a little and sheds a few beads (the leash
// pulling in); hover speeds the turn and pulls the beads towards the ochre of a trimmed fill.
//
// Geometry comes from /brand/leash-logo-512-transparent.png, measured in its 512px frame:
//   crescent  outer circle (192,256) r150, inner circle (220,258) r122 — thick on the left, opening on the right
//   ring      centre (355,256), r81, tube 9 — passes in front of the crescent at the top, behind at the bottom
//   dot       centre (440,258), r30
// Everything degrades: no WebGL (or the CDN module never arriving) leaves the PNG that is in the markup;
// prefers-reduced-motion renders one still frame and never pulses.
import * as THREE from "three";

const pane = document.getElementById("hero-visual");
const canvas = document.getElementById("hero-beads");
const fallback = document.getElementById("hero-fallback");
if (!pane || !canvas) throw new Error("beads: hero pane missing");

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = getComputedStyle(document.documentElement);
const token = (name, dflt) => (css.getPropertyValue(name).trim() || dflt);
const GREEN = new THREE.Color(token("--accent", "#0E5A4C"));
const OCHRE = new THREE.Color(token("--trim-bar", "#B7791F"));

// ---------- geometry: bead positions in logo space (512px frame, y up, z towards the viewer) ----------
const UNIT = 1 / 64; // 512px -> 8 world units
const BEAD = 7; // bead diameter, px of the logo frame; rows of beads are spaced by this
const beads = []; // { x, y, z, r, ring, theta, phi, tube, loose }

// The crescent as a tube whose radius varies with the angle: the midline is the circle between the
// two measured circles, the tube radius is half the gap between them at that angle.
const crescent = (() => {
  const OUT = { x: 192, y: 256, r: 150 }, IN = { x: 220, y: 258, r: 122 };
  const steps = 2 * Math.PI * 136 / BEAD;
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const c = Math.cos(theta), s = Math.sin(theta);
    const ro = OUT.r, ox = OUT.x + ro * c, oy = OUT.y + ro * s;
    // where the same ray from the outer centre meets the inner circle
    const dx = OUT.x - IN.x, dy = OUT.y - IN.y;
    const b = 2 * (dx * c + dy * s), cc = dx * dx + dy * dy - IN.r * IN.r;
    const ri = (-b + Math.sqrt(Math.max(0, b * b - 4 * cc))) / 2;
    const ix = OUT.x + ri * c, iy = OUT.y + ri * s;
    const tube = Math.max(0, (ro - ri) / 2);
    if (tube < BEAD * 0.42) continue; // the opening of the C
    const mx = (ox + ix) / 2, my = (oy + iy) / 2, mid = (ro + ri) / 2;
    // beads sit on a circle of radius tr inside the tube; a tube thinner than a bead is a single row
    const tr = tube - BEAD / 2 > 1.2 ? tube - BEAD / 2 : 0;
    const around = tr === 0 ? 1 : Math.max(2, Math.round((2 * Math.PI * tr) / BEAD));
    const twist = (i % 2) * (Math.PI / around); // offset alternate rows so beads pack like the reference
    for (let k = 0; k < around; k++) {
      const phi = (k / around) * Math.PI * 2 + twist;
      beads.push({
        ring: 0, theta, phi, tube: tr, mid, cx: OUT.x, cy: OUT.y,
        x: mx + tr * Math.cos(phi) * c, y: my + tr * Math.cos(phi) * s, z: tr * Math.sin(phi), r: BEAD / 2, loose: false,
      });
      n++;
    }
  }
  return n;
})();

// The small ring, tilted about its horizontal axis so its top sits in front of the crescent and its bottom behind.
const RING = { x: 355, y: 256, r: 81, tube: 9, tilt: 14 };
{
  const steps = Math.round((2 * Math.PI * RING.r) / BEAD);
  const around = Math.max(1, Math.round((2 * Math.PI * (RING.tube - BEAD / 2 + 3)) / BEAD));
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const c = Math.cos(theta), s = Math.sin(theta);
    const tr = RING.tube - BEAD / 2 + 1;
    for (let k = 0; k < around; k++) {
      const phi = (k / around) * Math.PI * 2 + (i % 2) * (Math.PI / around);
      beads.push({
        ring: 1, theta, phi, r: BEAD / 2 - 0.4, loose: false,
        x: RING.x + (RING.r + tr * Math.cos(phi)) * c,
        y: RING.y + (RING.r + tr * Math.cos(phi)) * s,
        z: tr * Math.sin(phi) - RING.tilt * s,
      });
    }
  }
}

// The dot: two Fibonacci shells so it reads as a solid bead-ball from every side.
const DOT = { x: 440, y: 258, r: 30 };
for (const shell of [DOT.r - BEAD / 2, DOT.r - BEAD * 1.35]) {
  const count = Math.round((4 * Math.PI * shell * shell) / (BEAD * BEAD * 0.86));
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2, rad = Math.sqrt(1 - y * y), a = golden * i;
    beads.push({ ring: 2, r: BEAD / 2, loose: false, x: DOT.x + shell * Math.cos(a) * rad, y: DOT.y + shell * y, z: shell * Math.sin(a) * rad });
  }
}

// A handful of crescent beads are "loose": each pulse they fly off the tube and dissolve, then return.
const LOOSE = 22;
const crescentIdx = beads.map((b, i) => (b.ring === 0 ? i : -1)).filter((i) => i >= 0);
const loose = [];
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < LOOSE; i++) {
    const idx = crescentIdx[Math.floor(rnd() * crescentIdx.length)];
    if (beads[idx].loose) { i--; continue; }
    beads[idx].loose = { dx: rnd() * 2 - 1, dy: rnd() * 2 - 1, dz: rnd() * 2 - 1, delay: rnd() * 0.35 };
    loose.push(idx);
  }
}

const COUNT = beads.length;

// ---------- renderer ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch {
  renderer = null;
}
if (!renderer) throw new Error("beads: WebGL unavailable, keeping the PNG");
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (fallback) fallback.hidden = true;
pane.classList.add("has-beads");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 0, 17);

// Two-key lighting: a warm key from the upper left, a cool fill from the right, a rim from behind, plus a
// paper-coloured hemisphere so the shadow side reads as green, not black.
scene.add(new THREE.HemisphereLight(0xfaf7ee, 0x1d2a24, 1.1));
const key = new THREE.DirectionalLight(0xfff4e0, 2.6); key.position.set(-4, 6, 8); scene.add(key);
const fill = new THREE.DirectionalLight(0xdff2ea, 0.9); fill.position.set(6, -2, 6); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(2, 4, -6); scene.add(rim);

const material = new THREE.MeshPhysicalMaterial({
  color: GREEN.clone(), roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, specularIntensity: 0.9,
});
const sphere = new THREE.SphereGeometry(1, 14, 10);
const mesh = new THREE.InstancedMesh(sphere, material, COUNT);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
// The small ring is the lighter sage of the logo; instance colours multiply the material colour.
const ringTint = new THREE.Color(2.4, 2.15, 1.9);
const white = new THREE.Color(1, 1, 1);
for (let i = 0; i < COUNT; i++) mesh.setColorAt(i, beads[i].ring === 1 ? ringTint : white);
mesh.instanceColor.needsUpdate = true;

const group = new THREE.Group();
group.add(mesh);
scene.add(group);

// ---------- per-frame bead placement ----------
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
const CENTRE = { x: 256, y: 256 };
function place(i, tighten, t) {
  const b = beads[i];
  let x = b.x, y = b.y, z = b.z, r = b.r;
  if (b.ring === 0 && tighten > 0) {
    // contract towards the crescent's axis and squeeze the tube
    const c = Math.cos(b.theta), s = Math.sin(b.theta);
    const mid = b.mid * (1 - 0.045 * tighten), tube = b.tube * (1 - 0.35 * tighten);
    x = b.cx + (mid + tube * Math.cos(b.phi)) * c;
    y = b.cy + (mid + tube * Math.cos(b.phi)) * s;
    z = tube * Math.sin(b.phi);
  }
  if (b.loose && t > 0) {
    // t is 0..1 through the pulse: the bead flies off and dissolves until 0.7, then regrows in place
    const L = b.loose;
    if (t < 0.7) {
      const p = Math.max(0, (t - L.delay) / (0.7 - L.delay));
      const fly = 1 - Math.pow(1 - p, 2.2); // ease-out: a flick, then a drift
      const c = Math.cos(b.theta), s = Math.sin(b.theta);
      const out = 30 * fly;
      x += (L.dx * 0.6 + c) * out;
      y += (L.dy * 0.6 + s) * out;
      z += (L.dz + Math.sin(b.phi)) * out * 0.9;
      r = b.r * (1 - Math.pow(p, 1.6));
    } else {
      r = b.r * Math.min(1, (t - 0.7) / 0.3);
    }
  }
  v3.set((x - CENTRE.x) * UNIT, (CENTRE.y - y) * UNIT, z * UNIT);
  s3.setScalar(r * UNIT);
  m4.compose(v3, q, s3);
  mesh.setMatrixAt(i, m4);
}
for (let i = 0; i < COUNT; i++) place(i, 0, 0);
mesh.instanceMatrix.needsUpdate = true;

// ---------- size: the pane's box, the real device pixel ratio, checked every frame ----------
let boxW = 0, boxH = 0, dpr = 0;
function fit() {
  const w = pane.clientWidth, h = pane.clientHeight;
  const d = Math.min(window.devicePixelRatio || 1, 2);
  if (w === boxW && h === boxH && d === dpr) return false;
  boxW = w; boxH = h; dpr = d;
  if (w === 0 || h === 0) return false;
  renderer.setPixelRatio(d);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Fit the 8-unit-wide mark inside the pane with a margin whatever the aspect.
  const halfW = 4.6, halfH = 3.2;
  const distW = halfW / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const distH = halfH / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.z = Math.max(distW, distH);
  camera.updateProjectionMatrix();
  return true;
}
new ResizeObserver(() => { if (fit()) render(); }).observe(pane);

// ---------- interaction ----------
let hot = false;
const setHot = (v) => { hot = v; pane.classList.toggle("is-trim", v); };
pane.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") setHot(true); });
pane.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") setHot(false); });
pane.addEventListener("click", () => { if (window.matchMedia("(hover: none)").matches) setHot(!hot); });

// ---------- animation ----------
const PULSE_EVERY = 6, PULSE_LEN = 1.9;
const BASE_SPEED = THREE.MathUtils.degToRad(7), HOT_SPEED = THREE.MathUtils.degToRad(16);
let yaw = -0.35, speed = BASE_SPEED, hotMix = 0, last = 0, lastPulse = -1;
const stats = { count: COUNT, frames: 0, fps: 0, pulses: 0 };
let fpsWindow = 0, fpsFrames = 0;
window.__beads = stats;

const tmpColor = new THREE.Color();
function render() { renderer.render(scene, camera); }

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  fit();

  // rotation, faster while hot
  speed += ((hot ? HOT_SPEED : BASE_SPEED) - speed) * Math.min(1, dt * 3);
  yaw += speed * dt;
  group.rotation.y = yaw;
  group.rotation.x = Math.sin(now / 5200) * 0.16;
  group.rotation.z = Math.cos(now / 7300) * 0.05;

  // colour: green at rest, the ochre of a trimmed fill while hot
  hotMix += ((hot ? 1 : 0) - hotMix) * Math.min(1, dt * 4);
  material.color.copy(tmpColor.copy(GREEN).lerp(OCHRE, hotMix));

  // the tightening pulse
  const T = now / 1000;
  const phase = T % PULSE_EVERY;
  const pulseIdx = Math.floor(T / PULSE_EVERY);
  const active = phase < PULSE_LEN;
  if (active || lastPulse !== pulseIdx) {
    const p = Math.min(1, phase / PULSE_LEN);
    const tighten = active ? Math.sin(Math.PI * p) : 0; // in, hold, out
    for (let i = 0; i < COUNT; i++) if (beads[i].ring === 0) place(i, tighten, active ? p : 0);
    mesh.instanceMatrix.needsUpdate = true;
    if (!active && lastPulse !== pulseIdx) { lastPulse = pulseIdx; stats.pulses++; }
  }

  render();
  stats.frames++;
  fpsFrames++;
  if (now - fpsWindow > 1000) { stats.fps = Math.round((fpsFrames * 1000) / (now - fpsWindow)); fpsWindow = now; fpsFrames = 0; }
  if (running) raf = requestAnimationFrame(frame);
}

let running = false, raf = 0;
function start() { if (running || reduced) return; running = true; last = performance.now(); fpsWindow = last; raf = requestAnimationFrame(frame); }
function stop() { running = false; cancelAnimationFrame(raf); }

fit();
if (reduced) {
  group.rotation.y = -0.35;
  group.rotation.x = 0.12;
  render();
} else {
  // Only spend GPU while the pane is on screen and the tab is visible.
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { threshold: 0.05 }).observe(pane);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
}
