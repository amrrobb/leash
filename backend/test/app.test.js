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
const config = { world, deployments: { vault: "0x333735bE6692069c9D30f25B5b4d74419Fb787d5", agentLabel: "agent" } };
const chain = {
  readState: async () => ({ cap: 1_234_000_000n, alive: true, speed: 1440n }),
  readFeed: async () => [{ at: 100, block: 5, logIndex: 0, kind: "full", title: "Agent opened a range", detail: "x", tx: "0x1" }],
  grantTier: async () => "0xg",
  stampVerified: async () => "0xv",
};
const demoCalls = [];
const demo = {
  setCap: async (cap) => (demoCalls.push(["setCap", cap]), "0xc"),
  revokeMandate: async () => (demoCalls.push(["revoke"]), "0xr"),
  grantMandate: async () => (demoCalls.push(["grant"]), "0xm"),
};

let server, base, bare, bareBase;
before(async () => {
  const fs = await import("node:fs");
  fs.mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<h1>leash</h1>");
  writeFileSync(join(dir, "secret.txt"), "nope");
  const store = openStore(join(dir, "t.db"));
  const okPortal = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
  server = createApp({ config, store, chain, demo, staticDir, fetchImpl: okPortal }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  bare = createApp({ config, store: openStore(join(dir, "u.db")), chain, staticDir }).listen(0);
  bareBase = `http://127.0.0.1:${bare.address().port}`;
});
after(() => {
  server.close();
  bare.close();
});

const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

test("GET /api/state serialises bigints", async () => {
  const body = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(body, { cap: "1234000000", alive: true, speed: "1440" });
});

test("rp-context then proof: end to end over HTTP", async () => {
  const ctx = await (await post(`${base}/api/rp-context`)).json();
  const result = { protocol_version: "4.0", nonce: ctx.rp_context.nonce, action: "leash-verify", responses: [{ identifier: "selfie", nullifier: "0xa" }] };
  const res = await post(`${base}/api/proof`, result);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).txs, { grantTier: "0xg", verify: "0xv" });
  const replay = await post(`${base}/api/proof`, result);
  assert.equal(replay.status, 409);
});

test("invalid JSON is a 400, not a crash", async () => {
  const res = await fetch(`${base}/api/proof`, { method: "POST", body: "{nope" });
  assert.equal(res.status, 400);
});

test("demo owner routes call the owner signer", async () => {
  await post(`${base}/api/demo/set-cap`, { cap: "500000000" });
  await post(`${base}/api/demo/revoke`);
  await post(`${base}/api/demo/grant-mandate`);
  assert.deepEqual(demoCalls, [["setCap", 500_000_000n], ["revoke"], ["grant"]]);
});

test("demo routes do not exist without a demo signer", async () => {
  assert.equal((await post(`${bareBase}/api/demo/revoke`)).status, 404);
});

test("serves the frontend and blocks path traversal", async () => {
  assert.equal(await (await fetch(`${base}/`)).text(), "<h1>leash</h1>");
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
  const chainErr = { readState: async () => { throw Object.assign(new Error("x"), { shortMessage: "Missing or invalid parameters.", details: "in-flight transaction limit reached for delegated accounts" }); } };
  const srv = createApp({ config, store: openStore(join(dir, "e.db")), chain: chainErr, staticDir }).listen(0);
  const body = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/state`)).json();
  srv.close();
  assert.equal(body.error, "Missing or invalid parameters. (in-flight transaction limit reached for delegated accounts)");
});

test("agent events merge into the feed newest first and are validated", async () => {
  const res = await post(`${base}/api/agent/event`, { kind: "blocked", title: "Agent tried to open a new range", detail: "Authority is empty · waiting for you" });
  assert.equal(res.status, 200);
  assert.equal((await post(`${base}/api/agent/event`, { kind: "you", title: "forged", detail: "" })).status, 400);
  const feed = await (await fetch(`${base}/api/feed`)).json();
  assert.equal(feed[0].kind, "blocked");
  assert.equal(feed[0].offchain, true);
  assert.equal(feed[1].title, "Agent opened a range");
});

test("mergeFeed orders by time then block then log index", () => {
  const out = mergeFeed([{ at: 10, block: 1, logIndex: 0 }, { at: 10, block: 1, logIndex: 1 }], [{ at: 11, block: 0, logIndex: 0 }, { at: 9, block: 0, logIndex: 0 }]);
  assert.deepEqual(out.map((e) => [e.at, e.logIndex]), [[11, 0], [10, 1], [10, 0], [9, 0]]);
});

