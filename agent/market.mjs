// "The market": an ordinary taker that trades against whatever position the agent has open.
// Sizes are random so the feed shows both full fills and trims. It is refused when the mandate is empty.
import { existsSync, readFileSync } from "node:fs";
import { forgeAgent, log, root, sleep } from "./common.mjs";

const statePath = process.env.STATE ?? `${root}agent/.state.json`;
const every = Number(process.env.MARKET_SECONDS ?? 40);
const [lo, hi] = (process.env.MARKET_RANGE ?? "1500,12000").split(",").map(Number);
if (!process.env.TAKER_KEY) throw new Error("TAKER_KEY is required");

log("market", `trading every ~${every}s, ${lo}–${hi} USDC`);
for (;;) {
  await sleep((every * (0.6 + Math.random() * 0.8)) * 1000);
  const pos = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")).position : null;
  if (!pos) {
    log("market", "no position open; nothing to trade");
    continue;
  }
  const amount = Math.round(lo + Math.random() * (hi - lo));
  log("market", `asking ${amount.toLocaleString("en-US")} USDC for ${pos.pair}`);
  const r = await forgeAgent("trade", { TAKER_KEY: process.env.TAKER_KEY, SALT: pos.salt, OTHER: pos.other, AMOUNT: String(BigInt(amount) * 1_000_000n) });
  if (!r.ok) {
    log("market", `refused: ${r.reason ?? "unknown"}`);
    continue;
  }
  const sim = (r.out.match(/simulated fill \(USDC\) (\d+)/) ?? [])[1];
  log("market", `sent; simulated fill ${sim ? (Number(sim) / 1e6).toLocaleString("en-US") : "?"} USDC (the dashboard shows the mined fill)`);
}
