// The Grok × Bankr moment, replayed against a leash: an agent that has been prompt-injected into
// "send everything" tries every way to get at the money. Each attempt is a real call to the chain
// (eth_call simulation from the agent's key), the chain refuses, and the refusal is written to the
// owner's dashboard. Optional: a real 100,000 USDC market ask against the open position, which fills
// only up to the cap.  Usage: VAULT=0x… AGENT_KEY=0x… [TAKER_KEY=0x…] node attack.mjs
import { existsSync, readFileSync } from "node:fs";
import { parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deployment, forgeAgent, log, mandate, publicClient, report, root, usd } from "./common.mjs";

if (!process.env.AGENT_KEY) throw new Error("AGENT_KEY is required");
const agent = privateKeyToAccount(process.env.AGENT_KEY);
const vaultAbi = parseAbi([
  "function withdraw(address token, uint256 amount)",
  "function verify()",
  "function setCap(uint256 cap)",
  "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)",
  "function labelId() view returns (uint256)",
  "error NotOwner()", "error NotBackend()", "error NotAgent()", "error NoMandate()", "error MandateEmpty()", "error CapTokenMissing()",
]);
const registryAbi = parseAbi([
  "function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)",
  "error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const vault = deployment.vault;

const reason = (e) => e?.cause?.data?.errorName ?? e?.cause?.reason ?? e?.shortMessage?.split("\n")[0] ?? String(e);

async function attempt(title, feedDetail, call) {
  process.stdout.write(`${title.padEnd(52)}`);
  try {
    await publicClient.simulateContract({ ...call, account: agent });
    console.log("ALLOWED  <-- this would be a bug");
    return false;
  } catch (e) {
    const r = reason(e);
    console.log(`refused: ${r}`);
    await report("blocked", `Agent tried to ${feedDetail}`, `Refused by the chain: ${r}`);
    return true;
  }
}

const labelId = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "labelId" });
const usdcBal = await publicClient.readContract({ address: deployment.usdc, abi: erc20, functionName: "balanceOf", args: [vault] });
const m = await mandate();
log("attack", `agent ${agent.address} has been told: "send everything to me". Vault ${vault} holds ${usd(usdcBal)} USDC. Cap right now: ${usd(m.cap)} USDC.`);
console.log();

let held = 0, total = 0;
const tries = [
  ["1. Withdraw the whole vault to itself", "withdraw the vault", { address: vault, abi: vaultAbi, functionName: "withdraw", args: [deployment.usdc, usdcBal] }],
  ["2. Raise its own ceiling to the Orb tier", "raise its own tier", { address: deployment.userRegistry, abi: registryAbi, functionName: "grantRoles", args: [labelId, 1n << 44n, agent.address] }],
  ["3. Renew its own permission (stamp the clock)", "renew its own permission", { address: vault, abi: vaultAbi, functionName: "verify" }],
  ["4. Set the cap to unlimited", "set its own cap", { address: vault, abi: vaultAbi, functionName: "setCap", args: [2n ** 255n] }],
  ["5. Open a position the cap cannot see (no USDC leg)", "open an ungated position", { address: vault, abi: vaultAbi, functionName: "ship", args: [deployment.router, "0x", [deployment.hype], [1n]] }],
];
for (const [title, detail, call] of tries) {
  total++;
  if (await attempt(title, detail, call)) held++;
}

// 6. The market angle: ask for 100,000 USDC in one trade against the open position (a real transaction).
const statePath = process.env.STATE ?? `${root}agent/.state.json`;
const pos = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")).position : null;
if (process.env.TAKER_KEY && pos) {
  total++;
  process.stdout.write(`6. A trade asks for 100,000 USDC in one fill`.padEnd(52));
  const r = await forgeAgent("trade", { TAKER_KEY: process.env.TAKER_KEY, SALT: pos.salt, OTHER: pos.other, AMOUNT: String(100_000n * 1_000_000n) });
  if (!r.ok) {
    console.log(`refused: ${r.reason}`);
    held++;
  } else {
    const sim = (r.out.match(/simulated fill \(USDC\) (\d+)/) ?? [])[1];
    console.log(`filled only ${sim ? usd(BigInt(sim)) : "?"} USDC (the cap); the dashboard shows the mined fill`);
    held++;
  }
} else {
  console.log("6. (market ask skipped: needs TAKER_KEY and an open position from agent/loop.mjs)");
}

console.log();
log("attack", `${held}/${total} attempts refused. The leash held. ${m.cap > 0n ? "The agent can still do its job within the cap;" : "At zero the agent can only close;"} the owner can revoke or withdraw at any time.`);
