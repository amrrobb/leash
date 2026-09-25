import { createPublicClient, createWalletClient, http, keccak256, toBytes, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const vaultAbi = parseAbi([
  "function capNow() view returns (uint256)",
  "function baseCap() view returns (uint256)",
  "function ownerCap() view returns (uint256)",
  "function lastVerified() view returns (uint64)",
  "function speed() view returns (uint256)",
  "function agent() view returns (address)",
  "function owner() view returns (address)",
  "function verify()",
  "event Shipped(bytes32 indexed strategyHash, address indexed app, address[] tokens, uint256[] amounts)",
  "event Docked(bytes32 indexed strategyHash)",
]);

export const registryAbi = parseAbi([
  "function roles(uint256 anyId, address account) view returns (uint256)",
  "function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
]);

const MANDATE = 1n << 40n;

export function labelId(label) {
  return BigInt(keccak256(toBytes(label)));
}

/** viem-backed chain access for one deployment. `rpcUrl` may point at an Anvil fork. */
export function createChain({ rpcUrl, backendKey, deployments }) {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const account = backendKey ? privateKeyToAccount(backendKey) : null;
  const walletClient = account ? createWalletClient({ chain: sepolia, transport, account }) : null;
  const vault = deployments.vault;
  const registry = deployments.userRegistry;
  const id = labelId(deployments.agentLabel ?? "agent");

  async function send(tx) {
    if (!walletClient) throw Object.assign(new Error("BACKEND_KEY is not set"), { status: 503 });
    const hash = await walletClient.writeContract(tx);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
    return hash;
  }

  return {
    publicClient,
    /** One block for every read, so the screen never mixes two chain states. */
    async readState() {
      const block = await publicClient.getBlock();
      const at = { blockNumber: block.number };
      const read = (functionName, address = vault, abi = vaultAbi, args = []) =>
        publicClient.readContract({ address, abi, functionName, args, ...at });
      const [cap, baseCap, ownerCap, lastVerified, speed, agentRoles] = await Promise.all([
        read("capNow"),
        read("baseCap"),
        read("ownerCap"),
        read("lastVerified"),
        read("speed"),
        read("roles", registry, registryAbi, [id, deployments.agent]),
      ]);
      const alive = (agentRoles & MANDATE) !== 0n;
      return { blockNumber: block.number, timestamp: block.timestamp, alive, cap, baseCap, ownerCap, lastVerified, speed, agentRoles };
    },
    grantTier(bit) {
      return send({ address: registry, abi: registryAbi, functionName: "grantRoles", args: [id, bit, deployments.agent] });
    },
    stampVerified() {
      return send({ address: vault, abi: vaultAbi, functionName: "verify" });
    },
  };
}
