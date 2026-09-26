import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.js";

const dbFile = () => join(mkdtempSync(join(tmpdir(), "leash-")), "t.db");

test("a nonce is single-use", () => {
  const s = openStore(dbFile());
  s.issueNonce("n1", 2_000_000_000);
  assert.equal(s.consumeNonce("n1", 1_000), true);
  assert.equal(s.consumeNonce("n1", 1_000), false);
});

test("unknown and expired nonces are rejected", () => {
  const s = openStore(dbFile());
  assert.equal(s.consumeNonce("never-issued", 1_000), false);
  s.issueNonce("old", 500);
  assert.equal(s.consumeNonce("old", 1_000), false);
});

test("used nonces survive a restart", () => {
  const file = dbFile();
  const a = openStore(file);
  a.issueNonce("n1", 2_000_000_000);
  a.consumeNonce("n1", 1_000);
  a.close();
  const b = openStore(file);
  assert.equal(b.consumeNonce("n1", 1_000), false);
});

test("a human can re-verify for the same vault but not back a second one", () => {
  const s = openStore(dbFile());
  assert.equal(s.bindHuman("0xabc", "0xVault1", "selfie"), true);
  assert.equal(s.bindHuman("0xabc", "0xvault1", "orb"), true);
  assert.equal(s.bindHuman("0xabc", "0xVault2", "selfie"), false);
});

test("a vault has one human: a second person is refused until the owner resets", () => {
  const s = openStore(dbFile());
  assert.equal(s.bindHuman("0xalice", "0xVault1", "selfie"), true);
  assert.equal(s.bindHuman("0xjudge", "0xvault1", "orb"), false, "someone else cannot renew Alice's agent");
  assert.equal(s.unbindVault("0xVAULT1"), 1);
  assert.equal(s.bindHuman("0xjudge", "0xVault1", "orb"), true);
});

test("agent events are kept per vault", () => {
  const s = openStore(dbFile());
  s.addEvent("0xVaultA", "blocked", "tried", "no room", 10);
  s.addEvent("0xvaultb", "closed", "closed", "docked", 11);
  assert.deepEqual(s.recentEvents("0xvaulta").map((e) => e.title), ["tried"]);
  assert.deepEqual(s.recentEvents("0xVAULTB").map((e) => e.title), ["closed"]);
  assert.equal(s.recentEvents("0xnobody").length, 0);
});

