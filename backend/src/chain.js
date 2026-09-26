import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, http, keccak256, toBytes, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const MANDATE = 1n << 40n;

export const vaultAbi = parseAbi([
  "function capNow() view returns (uint256)",
  "function baseCap() view returns (uint256)",
  "function ownerCap() view returns (uint256)",
  "function lastVerified() view returns (uint64)",
  "function speed() view returns (uint256)",
  "function agent() view returns (address)",
  "function owner() view returns (address)",
  "function agentLabel() view returns (string)",
  "function labelId() view returns (uint256)",
  "function CAP_ORB() view returns (uint256)",
  "function CAP_DOCUMENT() view returns (uint256)",
  "function CAP_SELFIE() view returns (uint256)",
  "function PERIOD() view returns (uint256)",
  "function CUTOFF() view returns (uint256)",
  "function verify()",
  "function setCap(uint256 cap)",
  "function withdraw(address token, uint256 amount)",
  "event Shipped(bytes32 indexed strategyHash, address indexed app, address[] tokens, uint256[] amounts)",
  "event Docked(bytes32 indexed strategyHash)",
  "event Verified(uint64 at)",
  "event CapSet(uint256 cap)",
  "event Withdrawn(address indexed token, uint256 amount)",
]);

export const registryAbi = parseAbi([
  "function roles(uint256 anyId, address account) view returns (uint256)",
  "function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
]);

export const factoryAbi = parseAbi([
  "function vaultOf(address owner) view returns (address)",
  "function isVault(address vault) view returns (bool)",
  "function createVault(address agent, string label) returns (address)",
  "event VaultCreated(address indexed owner, address indexed vault, address indexed agent, string label)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const routerAbi = parseAbi([
  "function swap((address maker, uint256 traits, bytes data) order, uint256 amount, bytes takerTraitsAndData) payable returns (uint256, uint256, bytes32)",
  "event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
]);

export function labelId(label) {
  return BigInt(keccak256(toBytes(label)));
}

/** Turns raw Vault/router logs into feed entries, newest first. Pure, so it is unit-tested. */
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

/** viem-backed chain access for one deployment. Every vault-specific call takes the vault address:
 * with the factory, each owner has their own. `rpcUrl` may point at an Anvil fork. */
export function createChain({ rpcUrl, backendKey, deployments }) {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const account = backendKey ? privateKeyToAccount(backendKey) : null;
  const walletClient = account ? createWalletClient({ chain: sepolia, transport, account }) : null;
  const registry = deployments.userRegistry;
  const factory = deployments.factory;
  const infoCache = new Map();
  let policyCache = null;

  async function send(tx) {
    if (!walletClient) throw Object.assign(new Error("BACKEND_KEY is not set"), { status: 503 });
    const hash = await walletClient.writeContract(tx);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
    return hash;
  }

  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

  return {
    publicClient,

    /** Protocol policy read from the Vault code (every factory vault shares it): tier caps and the clock. */
    async policy() {
      if (!policyCache) {
        const ref = deployments.vault;
        const read = (functionName) => publicClient.readContract({ address: ref, abi: vaultAbi, functionName });
        const [orb, document, selfie, period, cutoff] = await Promise.all([read("CAP_ORB"), read("CAP_DOCUMENT"), read("CAP_SELFIE"), read("PERIOD"), read("CUTOFF")]);
        policyCache = { tiers: { orb, document, selfie }, period, cutoff, source: ref };
      }
      return policyCache;
    },

    /** True for vaults the factory made, and for the deployment's demo vault. */
    async isKnownVault(vault) {
      if (!vault || !/^0x[0-9a-fA-F]{40}$/.test(vault)) return false;
      if (deployments.vault && vault.toLowerCase() === deployments.vault.toLowerCase()) return true;
      if (!factory) return false;
      return publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "isVault", args: [vault] });
    },

    /** The vault a wallet owns through the factory, or the zero address. */
    async vaultOf(owner) {
      if (!factory) return deployments.vault ?? null;
      return publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "vaultOf", args: [owner] });
    },

    /** Immutable facts about a vault (owner, agent, label); cached. */
    async vaultInfo(vault) {
      const key = vault.toLowerCase();
      if (!infoCache.has(key)) {
        const read = (functionName) => publicClient.readContract({ address: vault, abi: vaultAbi, functionName });
        const [owner, agent, agentLabel, id] = await Promise.all([read("owner"), read("agent"), read("agentLabel"), read("labelId")]);
        infoCache.set(key, { vault, owner, agent, agentLabel, labelId: id });
      }
      return infoCache.get(key);
    },

    /** One block for every read, so the screen never mixes two chain states. */
    async readState(vault) {
      const info = await this.vaultInfo(vault);
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
        read("roles", registry, registryAbi, [info.labelId, info.agent]),
        read("balanceOf", deployments.usdc, erc20Abi, [vault]),
        deployments.hype ? read("balanceOf", deployments.hype, erc20Abi, [vault]) : 0n,
      ]);
      const alive = (agentRoles & MANDATE) !== 0n;
      return {
        vault, owner: info.owner, agent: info.agent, agentLabel: info.agentLabel,
        blockNumber: block.number, timestamp: block.timestamp, alive, cap, baseCap, ownerCap, lastVerified, speed, agentRoles, vaultUsdc, vaultHype,
      };
    },

    /** Recent Vault (and router, if deployed) events for one vault as feed entries. */
    async readFeed(vault, limit = 8) {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = deployments.factoryBlock ? BigInt(deployments.factoryBlock) : deployments.deployBlock ? BigInt(deployments.deployBlock) : latest > 2000n ? latest - 2000n : 0n;
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

    /** Backend writes: the only two things it may do after a proof. */
    async grantTier(vault, bit) {
      const info = await this.vaultInfo(vault);
      return send({ address: registry, abi: registryAbi, functionName: "grantRoles", args: [info.labelId, bit, info.agent] });
    },
    stampVerified(vault) {
      return send({ address: vault, abi: vaultAbi, functionName: "verify" });
    },

    /** Calldata for the owner's wallet to sign. The page never encodes ABI itself. */
    async buildTx(kind, p) {
      const usdcAmount = () => BigInt(p.usdc ?? 0), hypeAmount = () => BigInt(p.hype ?? 0);
      switch (kind) {
        case "createVault":
          if (!factory) throw bad("no factory in this deployment");
          if (!/^0x[0-9a-fA-F]{40}$/.test(p.agent ?? "")) throw bad("agent must be an address");
          if (!/^[a-z0-9-]{3,32}$/.test(p.label ?? "")) throw bad("label: 3-32 chars, a-z 0-9 -");
          return { to: factory, data: encodeFunctionData({ abi: factoryAbi, functionName: "createVault", args: [p.agent, p.label] }) };
        case "setCap":
          return { to: p.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "setCap", args: [BigInt(p.cap)] }) };
        case "withdraw":
          return { to: p.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [p.token, BigInt(p.amount)] }) };
        case "revoke": {
          const info = await this.vaultInfo(p.vault);
          return { to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: "revokeRoles", args: [info.labelId, MANDATE, info.agent] }) };
        }
        case "restore": {
          const info = await this.vaultInfo(p.vault);
          return { to: registry, data: encodeFunctionData({ abi: registryAbi, functionName: "grantRoles", args: [info.labelId, MANDATE, info.agent] }) };
        }
        case "depositUsdc":
          // Demo tokens mint to anyone; a real token would be `transfer(vault, amount)` from the wallet.
          return { to: deployments.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [p.vault, usdcAmount()] }) };
        case "depositHype":
          return { to: deployments.hype, data: encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [p.vault, hypeAmount()] }) };
        default:
          throw bad(`unknown tx kind ${kind}`);
      }
    },
  };
}
