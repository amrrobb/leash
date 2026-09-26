import { test } from "node:test";
import assert from "node:assert/strict";
import { limitAt, tierOf, screenOf, dashboardView, constraintsFor, balancesText, applyPolicy, TIERS } from "../../frontend/app.js";

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

test("screen: connect, then create, then verify, then A2 after a proof, then the dashboard", () => {
  assert.equal(screenOf(undefined, {}), "connect");
  assert.equal(screenOf(undefined, { account: "0xabc" }), "create");
  assert.equal(screenOf({ ownerCap: "0" }, { account: "0xabc" }), "verify");
  assert.equal(screenOf({ ownerCap: "0" }, { tier: "selfie" }), "A2");
  assert.equal(screenOf({ ownerCap: "2000000000" }), "BC");
  assert.equal(screenOf({ ownerCap: "2000000000" }, {}), "BC", "a visitor with a vault URL sees the dashboard");
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
  assert.equal(v.lastText, "Over 3 days ago");
  assert.equal(dashboardView(snap(), 1000 + 100_000).lastText, "Over 3 days ago", "never shows absurd demo-scaled spans");
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

test("vault balances read as whole tokens", () => {
  assert.equal(balancesText({ vaultUsdc: "10000000000", vaultHype: "1000000000000000000000" }), "10,000 USDC · 1,000 HYPE");
  assert.equal(balancesText({}), "0 USDC · 0 HYPE");
});

test("tier caps follow the chain's policy, not the page's defaults", () => {
  applyPolicy({ tiers: { orb: "20000000000", document: "9000000000", selfie: "3000000000" } });
  assert.equal(TIERS.orb.cap, 20_000);
  assert.equal(TIERS.selfie.cap, 3_000);
  applyPolicy({ tiers: { orb: "15000000000", document: "7500000000", selfie: "2000000000" } }); // restore for other tests
  assert.equal(TIERS.document.cap, 7_500);
});

