// The Leash agent. Runs on its own: keeps a position open while the mandate allows it, re-ranges on a
// timer, and when the human stops showing up it is refused, closes the position, and waits.
// It never asks the human for anything; renewal is her side of the leash.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { deployment, forgeAgent, log, mandate, report, root, sleep, usd } from "./common.mjs";

const policy = JSON.parse(readFileSync(process.env.POLICY ?? `${root}agent/policy.json`, "utf8"));
const statePath = process.env.STATE ?? `${root}agent/.state.json`;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { position: null, pairIndex: 0, waiting: false };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
if (!process.env.AGENT_KEY) throw new Error("AGENT_KEY is required");

const resolveToken = (t) => (t === "hype" ? deployment.hype : t);
const pairEnv = (pair) => ({
  OTHER: resolveToken(pair.other),
  POOL_USDC: String(BigInt(pair.poolUsdc) * 1_000_000n),
  POOL_OTHER: String(BigInt(pair.poolOther) * 10n ** BigInt(pair.decimals ?? 18)),
});

async function ship() {
  const pair = policy.pairs[state.pairIndex % policy.pairs.length];
  const salt = String(Math.floor(Date.now() / 1000));
  log("agent", `opening ${pair.name}/USDC: ${pair.poolUsdc} USDC + ${pair.poolOther} ${pair.name}`);
  const r = await forgeAgent("ship", { AGENT_KEY: process.env.AGENT_KEY, SALT: salt, ...pairEnv(pair) });
  if (!r.ok) {
    log("agent", `refused: ${r.reason ?? "unknown"}`);
    return r.reason ?? "refused";
  }
  state.position = { salt, pair: pair.name, other: resolveToken(pair.other), since: Date.now() };
  state.pairIndex++;
  save();
  log("agent", `open (salt ${salt})`);
  return null;
}

async function dock(why) {
  const p = state.position;
  log("agent", `closing ${p.pair}/USDC: ${why}`);
  const r = await forgeAgent("dock", { AGENT_KEY: process.env.AGENT_KEY, SALT: p.salt, OTHER: p.other });
  if (!r.ok && !/UnknownStrategy/.test(r.reason ?? "")) {
    log("agent", `close failed: ${r.reason ?? "unknown"}`);
    return false;
  }
  state.position = null;
  save();
  log("agent", "closed; funds never left the vault");
  return true;
}

async function tick() {
  const m = await mandate();
  const room = m.alive ? `${usd(m.cap)} USDC of room` : "mandate revoked";
  log("agent", `${room}${state.position ? ` · position ${state.position.pair}/USDC open` : ""}`);

  if (!m.alive || m.cap === 0n) {
    const why = m.alive ? "authority is empty" : "the owner revoked the mandate";
    if (!state.waiting) {
      // Try anyway: the refusal is the chain's answer, not ours.
      const reason = await ship();
      await report("blocked", "Agent tried to open a new range", m.alive ? "Authority is empty · waiting for you" : "Mandate revoked · waiting for the owner");
      log("agent", `close-only mode (${reason}); ${why}. Waiting for the human.`);
      state.waiting = true;
      save();
    }
    if (state.position) await dock(`risk off, ${why}`);
    return;
  }

  if (state.waiting) {
    log("agent", "the human is back; resuming");
    state.waiting = false;
    save();
  }
  if (!state.position) {
    await ship();
  } else if (Date.now() - state.position.since > policy.rerangeSeconds * 1000) {
    if (await dock("re-range on schedule")) await ship();
  }
}

log("agent", `Leash agent · vault ${deployment.vault} · ${policy.pairs.length} pair(s) in policy`);
for (;;) {
  try {
    await tick();
  } catch (e) {
    log("agent", `error: ${e.shortMessage ?? e.message}`);
  }
  await sleep(policy.pollSeconds * 1000);
}
