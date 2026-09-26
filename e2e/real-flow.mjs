// The whole Leash flow on the HOSTED app and REAL Sepolia, driven like a person would: a fresh owner wallet
// (signed here in Node, presented to the page as an EIP-1193/EIP-6963 wallet), the real IDKit, World's
// simulator as the human, the real agent and market processes, and the real router. Records a video.
//   node real-flow.mjs            (reads ../.env for SEPOLIA_RPC, STAGE_KEY, AGENT_KEY, TAKER_KEY, DEMO_TOKEN)
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = Object.fromEntries(readFileSync(`${root}.env`, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const HOST = process.env.HOST ?? "https://leash.robbyn.xyz";
const out = process.env.OUT ?? "/private/tmp/claude-501/-Users-ammar-robb-Documents-Web3-ETHGlobal/f5dc7337-26c2-414c-af0c-2c421a0477bf/scratchpad/real-flow/";
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`, ...a);
const findings = [];
const finding = (s) => { findings.push(s); log("FINDING:", s); };

// ---- a fresh owner: key persisted BEFORE funding
const transport = http(env.SEPOLIA_RPC);
const publicClient = createPublicClient({ chain: sepolia, transport });
const ownerKey = process.env.OWNER_KEY_OVERRIDE ?? generatePrivateKey();
const owner = privateKeyToAccount(ownerKey);
writeFileSync(`${out}owner-key.txt`, `${ownerKey}\n${owner.address}\n`);
const ownerClient = createWalletClient({ chain: sepolia, transport, account: owner });
if (!process.env.OWNER_KEY_OVERRIDE) {
  const stage = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(env.STAGE_KEY) });
  const h = await stage.sendTransaction({ to: owner.address, value: parseEther("0.012") });
  await publicClient.waitForTransactionReceipt({ hash: h });
}
log("owner", owner.address, "balance", (Number(await publicClient.getBalance({ address: owner.address })) / 1e18).toFixed(4), "ETH");

// ---- the agent starts BEFORE the vault exists (OWNER= resolves it from the factory)
const agentEnv = { ...process.env, ...env, BACKEND: HOST, OWNER: owner.address, STATE: `${root}agent/.state.realflow.json`, MARKET_SECONDS: "12" };
const agentLog = [];
const loop = spawn("node", ["loop.mjs"], { cwd: `${root}agent`, env: agentEnv });
loop.stdout.on("data", (d) => { for (const l of String(d).trim().split("\n")) { agentLog.push(l); log("  agent |", l.slice(9)); } });
loop.stderr.on("data", (d) => log("  agent!|", String(d).trim().slice(0, 200)));
let market = null;

// ---- browser with a wallet that signs here
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && log("  console:", m.text().slice(0, 140)));
await page.exposeFunction("__sign", async (tx) => {
  const hash = await ownerClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
  log("  signed", hash.slice(0, 12), "→", tx.to.slice(0, 10));
  return hash;
});
await page.exposeFunction("__receipt", async (hash) => {
  const r = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
  return r ? { status: r.status === "success" ? "0x1" : "0x0", transactionHash: hash } : null;
});
await page.addInitScript((address) => {
  const listeners = {};
  const provider = {
    isStageWallet: true,
    on(e, f) { (listeners[e] ??= []).push(f); },
    removeListener(e, f) { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f); },
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return [address];
        case "eth_chainId": return "0xaa36a7";
        case "wallet_switchEthereumChain": return null;
        case "eth_sendTransaction": return window.__sign(params[0]);
        case "eth_getTransactionReceipt": return window.__receipt(params[0]);
        default: throw new Error(`stage wallet: unsupported ${method}`);
      }
    },
  };
  window.ethereum = provider;
  const info = { uuid: "0f1e2d3c-0000-4000-8000-00000000cafe", name: "Stage wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "xyz.leash.stage" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}, owner.address);

const shot = (n) => page.screenshot({ path: `${out}${n}.png` });
const text = async (id) => (await page.getByTestId(id).textContent()) ?? "";
const authority = async () => Number((await text("authority")).replace(/,/g, ""));
async function waitFor(what, fn, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(2000); }
  finding(`timed out waiting for ${what}`);
  return false;
}
async function worldViaSimulator(button) {
  await page.getByTestId(button).click();
  const link = page.locator("#vm-link");
  await link.waitFor({ state: "visible", timeout: 30_000 });
  const url = await link.getAttribute("href");
  const res = await fetch("https://simulator.worldcoin.org/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complete_test_request", arguments: { connect_url: url } } }) });
  const body = await res.text();
  const j = JSON.parse(body.slice(body.indexOf("{")));
  const r = j.result?.structuredContent ?? JSON.parse(j.result?.content?.[0]?.text ?? "{}");
  log("  simulator:", JSON.stringify(r));
  const closed = await waitFor("World modal to close", async () => page.getByTestId("verify-modal").isHidden(), 90_000);
  if (!closed) { const err = await page.locator("#vm-err").textContent(); finding(`verify error: ${err}`); return err; }
  return null;
}

try {
  // 1 connect
  await page.goto(`${HOST}/app`);
  await page.getByTestId("state-connect").waitFor();
  await shot("01-connect");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("state-create").waitFor({ timeout: 20_000 });
  log("connected as", await text("owner-name"));

  // 2 create vault
  const label = `demo-${Math.random().toString(36).slice(2, 7)}`;
  await page.getByTestId("agent-label").fill(label);
  await page.getByTestId("use-demo-agent").click();
  await waitFor("ERC-8004 badge", async () => /ERC-8004 agent #\d+/.test(await text("create-identity")), 20_000);
  log("badge:", await text("create-identity"));
  await shot("02-create");
  await page.getByTestId("create-vault").click();
  await page.getByTestId("state-a").waitFor({ timeout: 180_000 });
  const vault = await page.evaluate(() => window.leash.session.vault);
  log("vault", vault, `(${label}.leash.eth)`);
  await shot("03-verify-screen");
  await waitFor("agent to find the vault", async () => agentLog.some((l) => l.includes(`vault ${vault}`)), 30_000);

  // 3 verify (World simulator plays the human)
  const e1 = await worldViaSimulator("verify-with-world");
  if (e1) throw new Error(`first verification failed: ${e1}`);
  await page.getByTestId("state-a2").waitFor({ timeout: 30_000 });
  log("A2:", await page.locator("#a2-headline").textContent());
  await shot("04-verified");

  // 4 deposit + cap
  await page.getByTestId("a2-deposit").click();
  await waitFor("deposit", async () => (await text("a2-balances")) === "10,000 USDC · 1,000 HYPE", 180_000);
  await shot("05-funded");
  await page.getByTestId("starting-authority").fill("15000");
  await page.getByTestId("create-mandate").click();
  await page.getByTestId("dashboard").waitFor({ timeout: 180_000 });
  log("dashboard:", await text("status"), "authority", await authority());
  await shot("06-dashboard");

  // 5 the agent ships, the market trades, the leash tightens
  market = spawn("node", ["market.mjs"], { cwd: `${root}agent`, env: agentEnv });
  market.stdout.on("data", (d) => { for (const l of String(d).trim().split("\n")) log("  market|", l.slice(9)); });
  await waitFor("agent to ship", async () => (await text("feed")).includes("Agent opened a range"), 120_000);
  await shot("07-shipped");
  await waitFor("a market fill", async () => /filled in full|allowed/.test(await text("feed")), 120_000);
  await waitFor("a trimmed fill (SwapVM gate)", async () => (await text("feed")).includes("allowed"), 150_000);
  log("feed has trim:", (await text("feed")).match(/Asked [\d,]+ · allowed [\d,]+ USDC/)?.[0]);
  await shot("08-trimmed");
  await waitFor("Close-only (decay to zero)", async () => (await text("status")) === "Close-only", 300_000);
  log("zero reached; authority", await authority(), "| note:", await text("c-note"));
  await waitFor("agent refused + closed", async () => /Authority is empty/.test(await text("feed")) && /Agent closed the position/.test(await text("feed")), 120_000);
  await shot("09-close-only");

  // 6 the human returns
  const e2 = await worldViaSimulator("verify-again");
  if (e2) {
    if (/already has its human/i.test(e2)) {
      finding("simulator identity differs per proof: second verification refused as another human; using demo reset-human for the rehearsal");
      await fetch(`${HOST}/api/demo/reset-human`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-token": env.DEMO_TOKEN }, body: JSON.stringify({ vault }) });
      await page.getByTestId("verify-cancel").click();
      const e3 = await worldViaSimulator("verify-again");
      if (e3) throw new Error(`re-verification failed: ${e3}`);
    } else throw new Error(`re-verification failed: ${e2}`);
  }
  await waitFor("Operating again", async () => (await text("status")) === "Operating", 60_000);
  log("recovered; authority", await authority());
  await waitFor("agent resumes", async () => agentLog.some((l) => l.includes("the human is back")), 60_000);
  await shot("10-recovered");

  // 7 owner control: revoke, withdraw, restore
  await page.getByTestId("revoke").click();
  await waitFor("revoked", async () => (await text("c-note")).includes("revoked"), 180_000);
  await waitFor("agent refused after revoke", async () => agentLog.some((l) => /NoMandate/.test(l)), 90_000);
  await shot("11-revoked");
  await page.getByTestId("withdraw").click();
  await waitFor("withdrawn", async () => /^0 USDC/.test(await text("vault-balances")), 180_000);
  log("withdrawn; vault balances:", await text("vault-balances"));
  await shot("12-withdrawn");
  await page.getByTestId("restore").click();
  await waitFor("restored", async () => (await text("status")) !== "Close-only" || !(await text("c-note")).includes("revoked"), 180_000);
  await shot("13-restored");
  log("DONE");
} catch (err) {
  finding(`aborted: ${err.message}`);
  await shot("99-abort").catch(() => {});
} finally {
  loop.kill(); market?.kill();
  const video = page.video();
  await context.close();
  const path = await video?.path().catch(() => null);
  await browser.close();
  writeFileSync(`${out}findings.json`, JSON.stringify({ findings, agentLog }, null, 2));
  log("video:", path);
  log("findings:", findings.length ? findings : "none");
}
