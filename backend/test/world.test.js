import { test } from "node:test";
import assert from "node:assert/strict";
import { strongestCredential, tierOf, verifyWithPortal, ROLE } from "../src/world.js";

const world = { verifyUrl: "https://portal.test/api/v4/verify", rpId: "rp_test" };

test("identifiers map to tiers and caps", () => {
  assert.equal(tierOf("proof_of_human").bit, ROLE.ORB);
  assert.equal(tierOf("passport").cap, 7_500);
  assert.equal(tierOf("selfie").bit, ROLE.SELFIE);
  assert.equal(tierOf("something_new"), null);
});

test("the strongest credential wins", () => {
  const best = strongestCredential({
    responses: [
      { identifier: "selfie", nullifier: "0x1" },
      { identifier: "proof_of_human", nullifier: "0x2" },
      { identifier: "passport", nullifier: "0x3" },
    ],
  });
  assert.equal(best.tier.name, "orb");
  assert.equal(best.nullifier, "0x2");
});

test("unknown credentials only -> null", () => {
  assert.equal(strongestCredential({ responses: [{ identifier: "x", nullifier: "0x1" }] }), null);
  assert.equal(strongestCredential({}), null);
});

test("the result is forwarded untouched to /verify/{rp_id}", async () => {
  const result = { protocol_version: "4.0", nonce: "n", action: "a", responses: [{ identifier: "selfie", nullifier: "0x1" }] };
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  await verifyWithPortal(result, world, fakeFetch);
  assert.equal(seen.url, "https://portal.test/api/v4/verify/rp_test");
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), result);
});

test("staging proofs carry the portal's staging token; production calls do not", async () => {
  const seen = [];
  const fakeFetch = async (_url, init) => (seen.push(init.headers), new Response(JSON.stringify({ success: true })));
  await verifyWithPortal({}, { ...world, stagingToken: "stg_123" }, fakeFetch);
  await verifyWithPortal({}, world, fakeFetch);
  assert.equal(seen[0]["x-staging-verification-token"], "stg_123");
  assert.equal("x-staging-verification-token" in seen[1], false);
});

test("portal rejection throws with status 400", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ success: false, code: "invalid_proof" }), { status: 400 });
  await assert.rejects(verifyWithPortal({}, world, fakeFetch), (e) => e.status === 400 && /invalid_proof/.test(e.message));
});

test("200 without success:true is still a rejection", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  await assert.rejects(verifyWithPortal({}, world, fakeFetch));
});

test("non-JSON error pages are rejections", async () => {
  const fakeFetch = async () => new Response("<html>502</html>", { status: 502 });
  await assert.rejects(verifyWithPortal({}, world, fakeFetch), /502/);
});
