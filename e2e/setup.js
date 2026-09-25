// Global setup: Anvil fork of Sepolia -> fresh Leash deploy -> World portal stub -> real backend.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = `${root}e2e/.tmp`;
export const ANVIL = "http://127.0.0.1:8547";
export const BACKEND = "http://127.0.0.1:8788";
const PORTAL_PORT = 8790;

function env() {
  const vars = {};
  if (existsSync(`${root}.env`)) {
    for (const line of readFileSync(`${root}.env`, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) vars[m[1]] = m[2];
    }
  }
  return { ...vars, ...process.env };
}

export async function rpc(method, params = []) {
  const res = await fetch(ANVIL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function waitFor(fn, what, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export default async function globalSetup() {
  const e = env();
  const forkUrl = e.SEPOLIA_RPC;
  if (!forkUrl) throw new Error("SEPOLIA_RPC is required for e2e (archive-capable Sepolia RPC)");
  mkdirSync(tmp, { recursive: true });

  const anvil = spawn("anvil", ["--fork-url", forkUrl, "--chain-id", "11155111", "--port", "8547", "--silent"], { stdio: "ignore", detached: true });
  await waitFor(async () => (await rpc("eth_chainId")) === "0xaa36a7", "anvil");

  // Fresh keys every run, funded by Anvil only. None of them exist on real Sepolia.
  const keys = { alice: generatePrivateKey(), agent: generatePrivateKey(), backend: generatePrivateKey() };
  const addr = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, privateKeyToAccount(v).address]));
  for (const a of Object.values(addr)) await rpc("anvil_setBalance", [a, "0x56BC75E2D63100000"]);
  writeFileSync(`${tmp}/keys.json`, JSON.stringify({ keys, addr }, null, 2));

  execFileSync("forge", ["script", "script/DeployLeash.s.sol", "--rpc-url", ANVIL, "--broadcast", "--slow"], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, ALICE_KEY: keys.alice, AGENT: addr.agent, BACKEND: addr.backend, SPEED: "1440", OUT: `${tmp}/deployment.json`, SALT: String(Date.now()) },
  });

  // World Developer Portal stub: accepts every proof unless its nullifier is "0xportal-reject".
  const portal = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    const reject = (body.responses ?? []).some((r) => r.nullifier === "0xportal-reject");
    res.writeHead(reject ? 400 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reject ? { success: false, code: "invalid_proof" } : { success: true }));
  }).listen(PORTAL_PORT);

  const backend = spawn("node", ["src/server.js"], {
    cwd: `${root}backend`,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
    env: {
      ...process.env,
      PORT: "8788",
      RPC_URL: ANVIL,
      DEPLOYMENTS: `${tmp}/deployment.json`,
      DB_PATH: `${tmp}/leash-${Date.now()}.db`,
      BACKEND_KEY: keys.backend,
      DEMO_OWNER_KEY: keys.alice,
      WORLD_APP_ID: "app_staging_e2e",
      WORLD_RP_ID: "rp_e2e",
      WORLD_RP_SIGNING_KEY: generatePrivateKey(),
      WORLD_VERIFY_URL: `http://127.0.0.1:${PORTAL_PORT}/verify`,
    },
  });
  await waitFor(async () => (await fetch(`${BACKEND}/api/health`)).ok, "backend");

  globalThis.__leash = { anvil, backend, portal };
  return async () => {
    portal.close();
    for (const p of [backend, anvil]) {
      try {
        process.kill(-p.pid);
      } catch {}
    }
  };
}
