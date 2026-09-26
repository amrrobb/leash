import { createPublicClient, createWalletClient, decodeFunctionData, http, keccak256, toBytes, parseAbi } from "viem";
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
  "event Verified(uint64 at)",
  "event CapSet(uint256 cap)",
  "event Withdrawn(address indexed token, uint256 amount)",
]);

const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const routerAbi = parseAbi([
  "function swap((address maker, uint256 traits, bytes data) order, uint256 amount, bytes takerTraitsAndData) payable returns (uint256, uint256, bytes32)",
  "event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
]);

/** Turns raw Vault/router logs into feed entries, newest first. Pure, so it is unit-tested. */
const erc20Abi = parseAbi(["function symbol() view returns (string)"]);

export function toFeed(logs, { usdc, blockTimes, asks = new Map(), symbols = new Map() }) {
  const usd = (v) => Number(v) / 1e6;
  const out = [];
  for (const log of logs) {
    const at = Number(blockTimes.get(log.blockNumber) ?? 0n);
    const base = { at, block: Number(log.blockNumber), tx: log.transactionHash, logIndex: log.logIndex };
    const a = log.args;
    switch (log.eventName) {
      case "Verified":
        out.push({ ...base, kind: "you", title: "You verified with World", detail: "Authority clock reset" });
        break;
      case "CapSet":
        out.push({ ...base, kind: "owner", title: "You set the mandate", detail: `Authority up to ${usd(a.cap).toLocaleString("en-US")} USDC` });
        break;
      case "Shipped":
        out.push({ ...base, kind: "full", title: "Agent opened a range", detail: "Shipped to 1inch Aqua from your vault" });
        break;
      case "Docked":
        out.push({ ...base, kind: "closed", title: "Agent closed the position", detail: "Docked · funds never left your vault" });
        break;
      case "Withdrawn":
        out.push({ ...base, kind: "owner", title: "You withdrew", detail: "Back to your wallet" });
        break;
      case "Swapped": {
        const usdcIn = a.tokenIn.toLowerCase() === usdc.toLowerCase();
        const usdcLeg = usdcIn ? a.amountIn : a.amountOut;
        const other = (usdcIn ? a.tokenOut : a.tokenIn).toLowerCase();
        const pair = `${symbols.get(other) ?? other.slice(0, 6)}/USDC`;
        const ask = usdcIn ? asks.get(log.transactionHash) : undefined;
        const n = (v) => Math.round(usd(v)).toLocaleString("en-US");
        if (ask !== undefined && ask > usdcLeg) {
          out.push({ ...base, kind: "trim", title: `Market trade on ${pair}`, detail: `Asked ${n(ask)} · allowed ${n(usdcLeg)} USDC` });
        } else {
          out.push({ ...base, kind: "full", title: `Market trade on ${pair}`, detail: `${n(usdcLeg)} USDC filled in full` });
        }
        break;
      }
    }
  }
  return out.sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
}

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
      const [cap, baseCap, ownerCap, lastVerified, speed, agentRoles, vaultUsdc, vaultHype] = await Promise.all([
        read("capNow"),
        read("baseCap"),
        read("ownerCap"),
        read("lastVerified"),
        read("speed"),
        read("roles", registry, registryAbi, [id, deployments.agent]),
        read("balanceOf", deployments.usdc, balanceAbi, [vault]),
        deployments.hype ? read("balanceOf", deployments.hype, balanceAbi, [vault]) : 0n,
      ]);
      const alive = (agentRoles & MANDATE) !== 0n;
      return { blockNumber: block.number, timestamp: block.timestamp, alive, cap, baseCap, ownerCap, lastVerified, speed, agentRoles, vaultUsdc, vaultHype };
    },
    /** Recent Vault (and router, if deployed) events as feed entries. */
    async readFeed(limit = 8) {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = deployments.deployBlock ? BigInt(deployments.deployBlock) : latest > 2000n ? latest - 2000n : 0n;
      const [vaultLogs, routerLogs] = await Promise.all([
        publicClient.getContractEvents({ address: vault, abi: vaultAbi, fromBlock, toBlock: latest }),
        deployments.router
          ? publicClient.getContractEvents({ address: deployments.router, abi: routerAbi, eventName: "Swapped", fromBlock, toBlock: latest })
          : [],
      ]);
      const mine = routerLogs.filter((l) => l.args.maker.toLowerCase() === vault.toLowerCase());
      const logs = [...vaultLogs, ...mine];
      const blockTimes = new Map();
      await Promise.all([...new Set(logs.map((l) => l.blockNumber))].map(async (n) => blockTimes.set(n, (await publicClient.getBlock({ blockNumber: n })).timestamp)));
      // The ask is in the swap calldata (exact-in amount). Only decodable when the taker called the router directly.
      const asks = new Map();
      await Promise.all(
        mine.map(async (l) => {
          try {
            const tx = await publicClient.getTransaction({ hash: l.transactionHash });
            const { functionName, args } = decodeFunctionData({ abi: routerAbi, data: tx.input });
            if (functionName === "swap") asks.set(l.transactionHash, args[1]);
          } catch {
            // called through a contract: no ask to show
          }
        }),
      );
      const symbols = new Map();
      const others = [...new Set(mine.flatMap((l) => [l.args.tokenIn, l.args.tokenOut]).map((t) => t.toLowerCase()))].filter((t) => t !== deployments.usdc.toLowerCase());
      await Promise.all(others.map(async (t) => symbols.set(t, await publicClient.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }).catch(() => undefined))));
      return toFeed(logs, { usdc: deployments.usdc, blockTimes, asks, symbols }).slice(0, limit);
    },
    grantTier(bit) {
      return send({ address: registry, abi: registryAbi, functionName: "grantRoles", args: [id, bit, deployments.agent] });
    },
    stampVerified() {
      return send({ address: vault, abi: vaultAbi, functionName: "verify" });
    },
  };
}
