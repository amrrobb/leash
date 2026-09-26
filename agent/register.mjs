// Registers this agent's key in the ERC-8004 Identity Registry, so a Leash owner who pastes the address sees
// who they are binding. The registration file is a base64 data URI: fully on-chain, nothing to host.
// Idempotent: a key that already owns an agent token is left alone.
//   AGENT_KEY=0x… node register.mjs [--name "My agent"] [--url https://…]
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { deployment, log, rpcUrl } from "./common.mjs";

if (!process.env.AGENT_KEY) throw new Error("AGENT_KEY is required");
const registry = process.env.IDENTITY_REGISTRY ?? deployment.identityRegistry;
if (!registry) throw new Error("no ERC-8004 registry in the deployment file (identityRegistry)");

const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : fallback; };
const abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

const account = privateKeyToAccount(process.env.AGENT_KEY);
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ chain: sepolia, transport, account });

const owned = await publicClient.readContract({ address: registry, abi, functionName: "balanceOf", args: [account.address] });
if (owned > 0n) {
  log("register", `${account.address} already owns an ERC-8004 agent token; nothing to do`);
  process.exit(0);
}

const file = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: arg("--name", "Leash agent"),
  description: "An agent bounded by Leash: it can only call ship and dock on a vault whose owner named it, under a cap that decays unless a verified human renews it.",
  image: "https://leash.robbyn.xyz/brand/leash-logo-512-transparent.png",
  services: [{ name: "web", endpoint: arg("--url", "https://leash.robbyn.xyz") }],
  active: true,
  supportedTrust: [],
  registrations: [],
};
const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(file)).toString("base64");
log("register", `registering ${account.address} as "${file.name}" in ${registry}`);
const hash = await walletClient.writeContract({ address: registry, abi, functionName: "register", args: [uri] });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`register reverted: ${hash}`);
const logs = await publicClient.getContractEvents({ address: registry, abi, eventName: "Registered", args: { owner: account.address }, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber });
const id = logs.at(-1)?.args.agentId;
log("register", `ERC-8004 agent #${id ?? "?"} · tx ${hash}`);
