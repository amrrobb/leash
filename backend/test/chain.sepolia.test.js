import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createChain, labelId } from "../src/chain.js";
import { ROLE } from "../src/world.js";

const config = loadConfig();

test("labelId is keccak256 of the label (value from `cast keccak agent`)", () => {
  assert.equal(labelId("agent"), 0x314c1dfbbccab41a44cf9fefc21e632eb8e01bc0346d4414114d4c3dd0e9fdf1n);
});

test("reads the deployed Sepolia Vault in one block", { skip: !config.rpcUrl && "SEPOLIA_RPC not set" }, async () => {
  const chain = createChain(config);
  const s = await chain.readState();
  assert.equal(s.speed, 1440n);
  assert.equal(s.alive, true, "agent holds MANDATE on leash.eth's registry");
  assert.equal((s.agentRoles & ROLE.MANDATE) !== 0n, true);
  assert.ok(s.blockNumber > 0n);
});
