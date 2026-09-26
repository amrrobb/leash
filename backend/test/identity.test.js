import { test } from "node:test";
import assert from "node:assert/strict";
import { agentIdentity, registrationName } from "../src/identity.js";

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const AGENT = "0xFf2C23254af3FB788A9Ed558f0147ec6246e19d3";
const dataUri = (obj) => "data:application/json;base64," + Buffer.from(JSON.stringify(obj)).toString("base64");

function client({ balance, logs }) {
  const calls = [];
  return {
    calls,
    readContract: async ({ functionName, args }) => { calls.push([functionName, args]); return balance; },
    getContractEvents: async ({ eventName, args }) => { calls.push([eventName, args]); return logs; },
  };
}

test("an address that owns no agent token is not registered, and the events are not read", async () => {
  const publicClient = client({ balance: 0n, logs: [] });
  const who = await agentIdentity({ publicClient, registry: REGISTRY }, "0x" + "11".repeat(20));
  assert.deepEqual(who, { registered: false });
  assert.equal(publicClient.calls.length, 1);
});

test("a registered agent resolves to its id, URI and the name inside a data URI", async () => {
  const uri = dataUri({ type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: "Leash demo agent" });
  const publicClient = client({ balance: 1n, logs: [{ args: { agentId: 10_600n, agentURI: uri, owner: AGENT } }] });
  const who = await agentIdentity({ publicClient, registry: REGISTRY, fromBlock: 0n }, AGENT);
  assert.equal(who.registered, true);
  assert.equal(who.agentId, "10600");
  assert.equal(who.name, "Leash demo agent");
  assert.equal(who.registry, REGISTRY);
  // The event filter is by owner, which is the only on-chain path from an address to an agentId.
  assert.deepEqual(publicClient.calls[1], ["Registered", { owner: AGENT }]);
});

test("a token without a Registered event in range is still registered, just anonymous", async () => {
  const publicClient = client({ balance: 1n, logs: [] });
  const who = await agentIdentity({ publicClient, registry: REGISTRY }, "0x" + "22".repeat(20));
  assert.equal(who.registered, true);
  assert.equal(who.agentId, undefined);
});

test("no registry configured or a failing RPC never throws: the badge is informational", async () => {
  assert.deepEqual(await agentIdentity({ publicClient: null, registry: undefined }, AGENT), { registered: false });
  const publicClient = { readContract: async () => { throw new Error("429"); } };
  assert.deepEqual(await agentIdentity({ publicClient, registry: REGISTRY }, "0x" + "33".repeat(20)), { registered: false });
});

test("an https registration file is fetched with a timeout and read for its name; anything else yields no name", async () => {
  const fetchImpl = async (url, opts) => {
    assert.equal(url, "https://agent.test/agent.json");
    assert.ok(opts.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ name: "Remote agent" }) };
  };
  assert.equal(await registrationName("https://agent.test/agent.json", fetchImpl), "Remote agent");
  assert.equal(await registrationName("ipfs://Qm", fetchImpl), undefined);
  assert.equal(await registrationName("https://agent.test/x", async () => ({ ok: false })), undefined);
});
