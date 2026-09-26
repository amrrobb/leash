import { test } from "node:test";
import assert from "node:assert/strict";
import { limitAt, tierOf, screenOf, dashboardView, constraintsFor, TIERS } from "../../frontend/app.js";

const H = 3600;
const MANDATE = 1n << 40n;

test("JS curve equals Vault.limitAt at the points the Solidity tests pin", () => {
  const b = 2_000;
  assert.equal(limitAt(b, 0), 2_000);
  assert.equal(limitAt(b, 12 * H), 1_500);
  assert.equal(limitAt(b, 24 * H), 1_000);
  assert.equal(limitAt(b, 36 * H), 750);
  assert.equal(limitAt(b, 48 * H), 500);
  assert.equal(limitAt(b, 72 * H), 0);
});

test("tier is the highest bit held", () => {
  assert.equal(tierOf(TIERS.selfie.bit | TIERS.orb.bit).key, "orb");
  assert.equal(tierOf(TIERS.document.bit).key, "document");
  assert.equal(tierOf(0n), null);
});

test("screen: A before a mandate, A2 after a proof, dashboard once a cap is set", () => {
  assert.equal(screenOf({ ownerCap: "0" }), "A");
  assert.equal(screenOf({ ownerCap: "0" }, { tier: "selfie" }), "A2");
  assert.equal(screenOf({ ownerCap: "2000000000" }), "BC");
});

const snap = (over = {}) => ({
  speed: "1440",
  agentRoles: (MANDATE | TIERS.selfie.bit).toString(),
  baseCap: "2000000000",
  lastVerified: "1000",
  ownerCap: "2000000000",
  ...over,
});

test("B right after verification: operating at full cap", () => {
  const v = dashboardView(snap(), 1000);
  assert.equal(v.authText, "2,000");
  assert.equal(v.tone, "ok");
  assert.equal(v.openText, "Allowed");
  assert.equal(v.tierName, "Selfie Check");
  assert.equal(v.clockText, "Demo clock: 1 second = 0.4 hours");
});

test("B trimming below 40% of base, in ochre", () => {
  // 36 demo hours = 90 real seconds at speed 1440 -> 750 of 2,000
  const v = dashboardView(snap(), 1000 + 90);
  assert.equal(v.authText, "750");
  assert.equal(v.tone, "trim");
  assert.equal(v.statusLabel, "Trimming fills");
});

test("C after 72 demo hours: close-only, grey, zero reached", () => {
  const v = dashboardView(snap(), 1000 + 180);
  assert.equal(v.authority, 0);
  assert.equal(v.tone, "pause");
  assert.equal(v.zeroText, "Reached");
  assert.equal(v.fillText, "None");
  assert.match(v.cNote, /Nobody verified/);
});

test("C after revoke says so, even with time left", () => {
  const v = dashboardView(snap({ agentRoles: TIERS.selfie.bit.toString() }), 1000);
  assert.equal(v.tone, "pause");
  assert.equal(v.revoked, true);
  assert.equal(v.cNote, "You revoked the mandate.");
});

test("constraints: one credential is a bare request, several are any()", () => {
  const IDKit = { CredentialRequest: (t) => ({ t }), any: (...n) => ({ any: n }) };
  assert.deepEqual(constraintsFor(IDKit, ["proof_of_human"]), { t: "proof_of_human" });
  assert.deepEqual(constraintsFor(IDKit, ["proof_of_human", "selfie"]), { any: [{ t: "proof_of_human" }, { t: "selfie" }] });
  assert.equal(constraintsFor(IDKit, []).any.length, 4);
});

