import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const rpcUrl = process.env.RPC_URL ?? process.env.SEPOLIA_RPC;
export const deploymentPath = process.env.DEPLOYMENT ?? `${root}deployments/sepolia.json`;
export const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
// The vault this agent works for. With the factory, every owner has their own: pass VAULT, or OWNER to
// resolve it from the factory (and wait for it, so the agent can be started before the human creates it).
if (process.env.VAULT) deployment.vault = process.env.VAULT;
export const backend = process.env.BACKEND ?? "http://127.0.0.1:8787";

export const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
const vaultAbi = parseAbi(["function mandate() view returns (bool alive, uint256 cap, address token)"]);

const factoryAbi = parseAbi(["function vaultOf(address owner) view returns (address)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

/** With OWNER set, polls the factory until that wallet has a vault, then points the agent at it. */
export async function resolveVault() {
  if (!process.env.OWNER || process.env.VAULT) return deployment.vault;
  if (!deployment.factory) throw new Error("OWNER needs a factory in the deployment file");
  let said = false;
  for (;;) {
    const v = await publicClient.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "vaultOf", args: [process.env.OWNER] });
    if (v && v !== ZERO) { deployment.vault = v; return v; }
    if (!said) { log("agent", `no vault for ${process.env.OWNER} yet; waiting for the human to create one`); said = true; }
    await sleep(5000);
  }
}

export async function mandate() {
  const [alive, cap, token] = await publicClient.readContract({ address: deployment.vault, abi: vaultAbi, functionName: "mandate" });
  return { alive, cap, token };
}

export const usd = (v) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 });
export const stamp = () => new Date().toISOString().slice(11, 19);
export const log = (who, msg) => console.log(`${stamp()} [${who}] ${msg}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs script/Agent.s.sol. Resolves { ok, reason, out }; a revert in the simulation means nothing was sent. */
export function forgeAgent(action, env) {
  return new Promise((resolve) => {
    execFile(
      "forge",
      ["script", "script/Agent.s.sol", "--rpc-url", rpcUrl, "--broadcast"],
      // VAULT is passed explicitly: with OWNER= the vault was resolved in-process and the script must not fall back to the deployment's demo vault.
      { cwd: root, env: { ...process.env, ACTION: action, DEPLOYMENT: deploymentPath, VAULT: deployment.vault, ...env }, maxBuffer: 8e6 },
      (err, stdout, stderr) => {
        const out = `${stdout}\n${stderr}`;
        const reason =
          (out.match(/script failed: ([A-Za-z]+\(?[^\n]*)/) ?? [])[1]?.trim() ??
          (out.match(/\b(MandateEmpty|MandateRevoked|MandateTokenMissing|NoMandate|NotAgent|CapTokenMissing|UnknownStrategy)\b[^\n]*/) ?? [])[0]?.trim() ??
          (err ? "refused" : undefined);
        resolve({ ok: !err, reason, out });
      },
    );
  });
}

/** Tells the dashboard what the agent tried. Best effort: the chain is the record, this is the narration. */
export async function report(kind, title, detail) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.DEMO_TOKEN) headers["x-demo-token"] = process.env.DEMO_TOKEN; // needed when the dashboard is hosted elsewhere
    await fetch(`${backend}/api/agent/event`, { method: "POST", headers, body: JSON.stringify({ vault: deployment.vault, kind, title, detail }) });
  } catch {
    // dashboard not running; fine
  }
}
