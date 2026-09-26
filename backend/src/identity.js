import { parseAbi } from "viem";

// ERC-8004 Identity Registry: an agent is an ERC-721 token owned by the key that registered it.
// The standard defines no reverse lookup (address -> agentId), so we read the Registered event for that owner.
export const identityAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

const cache = new Map(); // address -> { at, value }
const TTL = 60_000;

/** Reads the agent's ERC-8004 identity: { registered, agentId?, uri?, name? }. Never throws: the badge is informational. */
export async function agentIdentity({ publicClient, registry, fromBlock = 0n, fetchImpl = globalThis.fetch }, address) {
  if (!registry || !address) return { registered: false };
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value = { registered: false };
  try {
    const count = await publicClient.readContract({ address: registry, abi: identityAbi, functionName: "balanceOf", args: [address] });
    if (count > 0n) {
      const logs = await publicClient.getContractEvents({ address: registry, abi: identityAbi, eventName: "Registered", args: { owner: address }, fromBlock, toBlock: "latest" });
      const last = logs.at(-1);
      if (last) {
        value = { registered: true, agentId: last.args.agentId.toString(), uri: last.args.agentURI, registry };
        value.name = await registrationName(last.args.agentURI, fetchImpl);
      } else {
        value = { registered: true, registry }; // owns a token but registered before fromBlock
      }
    }
  } catch (err) {
    console.warn(`identity lookup failed for ${address}: ${err.shortMessage ?? err.message}`);
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The `name` from the registration file, if the URI is fetchable in time. */
export async function registrationName(uri, fetchImpl) {
  try {
    if (uri?.startsWith("data:application/json;base64,")) return JSON.parse(Buffer.from(uri.slice(29), "base64").toString()).name;
    if (!/^https?:\/\//.test(uri ?? "")) return undefined;
    const res = await fetchImpl(uri, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return undefined;
    const body = await res.json();
    return typeof body?.name === "string" ? body.name : undefined;
  } catch {
    return undefined;
  }
}
