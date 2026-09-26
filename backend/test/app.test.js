import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.js";
import { createApp, demoAllowed, mergeFeed } from "../src/app.js";

const dir = mkdtempSync(join(tmpdir(), "leash-app-"));
const staticDir = join(dir, "public");

const world = { appId: "app_x", rpId: "rp_x", signingKey: "0x" + "22".repeat(32), action: "leash-verify", verifyUrl: "https://portal.test/v", environment: "staging" };
const VAULT = "0x333735bE6692069c9D30f25B5b4d74419Fb787d5";
const OWNER = "0x7EbC0A2Bc28bCe4B447FF526F897aC6CCDc334Ef";
const config = { world, deployments: { factory: "0x0B037692580536e8010f2A1501313d54269052C2", agentLabel: "agent" } };
const chain = {
  isKnownVault: async (v) => v?.toLowerCase() === VAULT.toLowerCase(),
  vaultOf: async (owner) => (owner.toLowerCase() === OWNER.toLowerCase() ? VAULT : "0x0000000000000000000000000000000000000000"),
  readState: async (vault) => ({ vault, cap: 1_234_000_000n, alive: true, speed: 1440n }),
  readFeed: async () => [{ at: 100, block: 5, logIndex: 0, kind: "full", title: "Agent opened a range", detail: "x", tx: "0x1" }],
  grantTier: async () => "0xg",
  stampVerified: async () => "0xv",
  buildTx: async (kind, p) => ({ to: kind === "createVault" ? config.deployments.factory : p.vault, data: `0x${kind}` }),
  policy: async () => ({ tiers: { orb: 15_000_000_000n, document: 7_500_000_000n, selfie: 2_000_000_000n }, period: 86400n, cutoff: 259200n }),
};
const sent = [];
const signer = { address: OWNER, send: async (to, data) => (sent.push([to, data]), "0xsigned") };

let server, base, bare, bareBase;
before(async () => {
  const fs = await import("node:fs");
  fs.mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<h1>leash</h1>");
  writeFileSync(join(dir, "secret.txt"), "nope");
  const store = openStore(join(dir, "t.db"));
  const okPortal = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
  server = createApp({ config, store, chain, signer, staticDir, fetchImpl: okPortal }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  bare = createApp({ config, store: openStore(join(dir, "u.db")), chain, staticDir }).listen(0);
  bareBase = `http://127.0.0.1:${bare.address().port}`;
});
after(() => {
  server.close();
  bare.close();
});

const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

test("GET /api/state needs a known vault and serialises bigints", async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 400);
  assert.equal((await fetch(`${base}/api/state?vault=0x0000000000000000000000000000000000000001`)).status, 400);
  const body = await (await fetch(`${base}/api/state?vault=${VAULT}`)).json();
  assert.deepEqual(body, { vault: VAULT, cap: "1234000000", alive: true, speed: "1440" });
});

test("GET /api/vault maps a wallet to its vault", async () => {
  assert.equal((await (await fetch(`${base}/api/vault?owner=${OWNER}`)).json()).vault, VAULT);
  assert.equal((await (await fetch(`${base}/api/vault?owner=0x0000000000000000000000000000000000000002`)).json()).vault, "0x0000000000000000000000000000000000000000");
  assert.equal((await fetch(`${base}/api/vault?owner=nope`)).status, 400);
});

test("GET /api/tx returns calldata for the wallet; vault kinds need a known vault", async () => {
  const c = await (await fetch(`${base}/api/tx?kind=createVault&agent=${OWNER}&label=alice-agent`)).json();
  assert.equal(c.to, config.deployments.factory);
  const r = await (await fetch(`${base}/api/tx?kind=revoke&vault=${VAULT}`)).json();
  assert.deepEqual(r, { to: VAULT, data: "0xrevoke" });
  assert.equal((await fetch(`${base}/api/tx?kind=revoke`)).status, 400);
});

test("rp-context then proof for a vault: end to end over HTTP", async () => {
  const ctx = await (await post(`${base}/api/rp-context`)).json();
  const result = { protocol_version: "4.0", nonce: ctx.rp_context.nonce, action: "leash-verify", responses: [{ identifier: "selfie", nullifier: "0xa" }] };
  const res = await post(`${base}/api/proof`, { result, vault: VAULT });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).txs, { grantTier: "0xg", verify: "0xv" });
  const replay = await post(`${base}/api/proof`, { result, vault: VAULT });
  assert.equal(replay.status, 409);
});

test("invalid JSON is a 400, not a crash", async () => {
  const res = await fetch(`${base}/api/proof`, { method: "POST", body: "{nope" });
  assert.equal(res.status, 400);
});

test("the test signer signs calldata the page would hand to a wallet", async () => {
  const res = await post(`${base}/api/demo/send`, { to: VAULT, data: "0xsetCap" });
  assert.deepEqual(await res.json(), { tx: "0xsigned" });
  assert.deepEqual(sent, [[VAULT, "0xsetCap"]]);
  assert.equal((await (await fetch(`${base}/api/demo/address`)).json()).address, OWNER);
});

test("signing routes do not exist without a signer", async () => {
  assert.equal((await post(`${bareBase}/api/demo/send`, { to: VAULT, data: "0x" })).status, 404);
});

test("serves the frontend and blocks path traversal", async () => {
  assert.equal(await (await fetch(`${base}/`)).text(), "<h1>leash</h1>");
  assert.equal(await (await fetch(`${base}/app`)).text(), "<h1>leash</h1>");
  assert.equal((await fetch(`${base}/`, { method: "HEAD" })).status, 200);
  const res = await fetch(`${base}/..%2Fsecret.txt`);
  assert.notEqual(await res.text(), "nope");
});

test("demo routes: loopback or token only", () => {
  const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });
  assert.equal(demoAllowed(req("127.0.0.1"), undefined), true);
  assert.equal(demoAllowed(req("::1"), undefined), true);
  assert.equal(demoAllowed(req("203.0.113.9"), undefined), false);
  assert.equal(demoAllowed(req("203.0.113.9", { "x-demo-token": "t" }), "t"), true);
  assert.equal(demoAllowed(req("203.0.113.9", { "x-demo-token": "" }), ""), false);
});

test("errors carry the RPC's detail text when viem has one", async () => {
  const chainErr = { isKnownVault: async () => true, readState: async () => { throw Object.assign(new Error("x"), { shortMessage: "Missing or invalid parameters.", details: "in-flight transaction limit reached for delegated accounts" }); } };
  const srv = createApp({ config, store: openStore(join(dir, "e.db")), chain: chainErr, staticDir }).listen(0);
  const body = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/state?vault=${VAULT}`)).json();
  srv.close();
  assert.equal(body.error, "Missing or invalid parameters. (in-flight transaction limit reached for delegated accounts)");
});

test("agent events are per vault, merge into that vault's feed, and are validated", async () => {
  const res = await post(`${base}/api/agent/event`, { vault: VAULT, kind: "blocked", title: "Agent tried to open a new range", detail: "Authority is empty · waiting for you" });
  assert.equal(res.status, 200);
  assert.equal((await post(`${base}/api/agent/event`, { vault: VAULT, kind: "you", title: "forged", detail: "" })).status, 400);
  assert.equal((await post(`${base}/api/agent/event`, { vault: "0x0000000000000000000000000000000000000001", kind: "blocked", title: "x", detail: "y" })).status, 400);
  const feed = await (await fetch(`${base}/api/feed?vault=${VAULT}`)).json();
  assert.equal(feed[0].kind, "blocked");
  assert.equal(feed[0].offchain, true);
  assert.ok(feed.some((e) => e.title === "Agent opened a range"), "chain events are merged in");
});

test("mergeFeed orders by time then block then log index", () => {
  const out = mergeFeed([{ at: 10, block: 1, logIndex: 0 }, { at: 10, block: 1, logIndex: 1 }], [{ at: 11, block: 0, logIndex: 0 }, { at: 9, block: 0, logIndex: 0 }]);
  assert.deepEqual(out.map((e) => [e.at, e.logIndex]), [[11, 0], [10, 1], [10, 0], [9, 0]]);
});

test("GET /api/deployment carries the tier policy read from the chain", async () => {
  const d = await (await fetch(`${base}/api/deployment`)).json();
  assert.deepEqual(d.policy.tiers, { orb: "15000000000", document: "7500000000", selfie: "2000000000" });
});

