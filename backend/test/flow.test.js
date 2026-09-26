import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.js";
import { issueRpContext, handleProof, describeResult } from "../src/flow.js";
import { ROLE } from "../src/world.js";

const world = {
  appId: "app_staging_x",
  rpId: "rp_x",
  signingKey: "0x" + "11".repeat(32),
  action: "leash-verify",
  verifyUrl: "https://portal.test/api/v4/verify",
  environment: "staging",
};
const VAULT = "0x333735bE6692069c9D30f25B5b4d74419Fb787d5";

let store, chain, calls, portalCalls;
const portal = (body, status = 200) => async () => {
  portalCalls++;
  return new Response(JSON.stringify(body), { status });
};
const okPortal = portal({ success: true });

beforeEach(() => {
  store = openStore(join(mkdtempSync(join(tmpdir(), "leash-")), "t.db"));
  calls = [];
  portalCalls = 0;
  chain = {
    grantTier: async (bit) => (calls.push(["grantTier", bit]), "0xgrant"),
    stampVerified: async () => (calls.push(["verify"]), "0xverify"),
  };
});

function freshResult(identifier = "selfie", nullifier = "0xn1") {
  const ctx = issueRpContext({ world, store });
  return { protocol_version: "4.0", nonce: ctx.rp_context.nonce, action: "leash-verify", responses: [{ identifier, nullifier }], environment: "staging" };
}

test("rp_context is signed with the real IDKit signer and carries app and action", () => {
  const ctx = issueRpContext({ world, store });
  assert.equal(ctx.app_id, "app_staging_x");
  assert.equal(ctx.rp_context.rp_id, "rp_x");
  assert.match(ctx.rp_context.signature, /^0x[0-9a-f]{130}$/);
  assert.ok(ctx.rp_context.expires_at > ctx.rp_context.created_at);
  assert.deepEqual(ctx.credentials, ["proof_of_human", "passport", "mnc", "selfie"]);
  assert.deepEqual(issueRpContext({ world: { ...world, credentials: ["proof_of_human"] }, store }).credentials, ["proof_of_human"]);
});

test("happy path: selfie -> grant SELFIE then stamp the Vault, in that order", async () => {
  const out = await handleProof({ result: freshResult("selfie"), world, store, chain, vault: VAULT, fetchImpl: okPortal });
  assert.deepEqual(calls, [["grantTier", ROLE.SELFIE], ["verify"]]);
  assert.equal(out.tier, "selfie");
  assert.equal(out.cap, 2_000);
  assert.deepEqual(out.txs, { grantTier: "0xgrant", verify: "0xverify" });
});

test("orb proof grants the ORB bit", async () => {
  await handleProof({ result: freshResult("proof_of_human"), world, store, chain, vault: VAULT, fetchImpl: okPortal });
  assert.deepEqual(calls[0], ["grantTier", ROLE.ORB]);
});

test("replaying a proof is rejected before the portal and before any tx", async () => {
  const result = freshResult();
  await handleProof({ result, world, store, chain, vault: VAULT, fetchImpl: okPortal });
  calls = [];
  portalCalls = 0;
  await assert.rejects(handleProof({ result, world, store, chain, vault: VAULT, fetchImpl: okPortal }), (e) => e.status === 409);
  assert.equal(portalCalls, 0);
  assert.deepEqual(calls, []);
});

test("a nonce we never issued is rejected", async () => {
  const result = { ...freshResult(), nonce: "0xforged" };
  await assert.rejects(handleProof({ result, world, store, chain, vault: VAULT, fetchImpl: okPortal }), (e) => e.status === 409);
  assert.deepEqual(calls, []);
});

test("portal rejection (the World failure path) sends no transaction", async () => {
  await assert.rejects(
    handleProof({ result: freshResult(), world, store, chain, vault: VAULT, fetchImpl: portal({ success: false, code: "invalid_proof" }, 400) }),
    (e) => e.status === 400,
  );
  assert.deepEqual(calls, []);
});

test("the same human can re-verify: renewal works", async () => {
  await handleProof({ result: freshResult("selfie", "0xalice"), world, store, chain, vault: VAULT, fetchImpl: okPortal });
  await handleProof({ result: freshResult("selfie", "0xalice"), world, store, chain, vault: VAULT, fetchImpl: okPortal });
  assert.equal(calls.filter(([c]) => c === "verify").length, 2);
});

test("one human cannot back a second Vault", async () => {
  await handleProof({ result: freshResult("selfie", "0xalice"), world, store, chain, vault: VAULT, fetchImpl: okPortal });
  calls = [];
  await assert.rejects(
    handleProof({ result: freshResult("selfie", "0xalice"), world, store, chain, vault: "0x0000000000000000000000000000000000000bad", fetchImpl: okPortal }),
    (e) => e.status === 409,
  );
  assert.deepEqual(calls, []);
});

test("wrong action and legacy proofs are rejected", async () => {
  await assert.rejects(handleProof({ result: { ...freshResult(), action: "other" }, world, store, chain, vault: VAULT, fetchImpl: okPortal }), /expected "leash-verify"/);
  await assert.rejects(handleProof({ result: { ...freshResult(), protocol_version: "3.0" }, world, store, chain, vault: VAULT, fetchImpl: okPortal }), /4.0/);
  assert.deepEqual(calls, []);
});

test("legacy 3.0 proofs: rejected by default, accepted when WORLD_ALLOW_LEGACY is on", async () => {
  const legacy = { ...freshResult("selfie", "0xl1"), protocol_version: "3.0" };
  await assert.rejects(handleProof({ result: legacy, world, store, chain, vault: VAULT, fetchImpl: okPortal }), /4.0/);
  assert.deepEqual(calls, []);
  const out = await handleProof({ result: { ...freshResult("selfie", "0xl2"), protocol_version: "3.0" }, world: { ...world, allowLegacy: true }, store, chain, vault: VAULT, fetchImpl: okPortal });
  assert.equal(out.protocol, "3.0");
  assert.deepEqual(calls, [["grantTier", ROLE.SELFIE], ["verify"]]);
  assert.equal(issueRpContext({ world: { ...world, allowLegacy: true }, store }).allow_legacy_proofs, true);
  assert.equal(issueRpContext({ world, store }).allow_legacy_proofs, false);
});

test("unsupported credential sends no transaction", async () => {
  await assert.rejects(handleProof({ result: freshResult("unknown_cred"), world, store, chain, vault: VAULT, fetchImpl: okPortal }), /no supported credential/);
  assert.deepEqual(calls, []);
});

test("missing World config fails loudly with 503", () => {
  assert.throws(() => issueRpContext({ world: { ...world, rpId: undefined }, store }), (e) => e.status === 503 && /WORLD_RP_ID/.test(e.message));
});

test("rejection diagnostics show the shape, never the proof or nullifier", () => {
  const d = describeResult({ protocol_version: "4.0", nonce: "0x1234567890abcdef", action: "leash-verify", responses: [{ identifier: "selfie", nullifier: "0xsecret", proof: ["0xp"] }] });
  assert.deepEqual(d.identifiers, ["selfie"]);
  assert.equal(d.nonce, "0x12345678… (18 chars)");
  assert.doesNotMatch(JSON.stringify(d), /0xsecret|0xp/);
});

