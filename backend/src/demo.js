import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelId, registryAbi } from "./chain.js";
import { ROLE } from "./world.js";

const vaultOwnerAbi = parseAbi(["function setCap(uint256 cap)", "function withdraw(address token, uint256 amount)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** Signs Alice's owner actions with DEMO_OWNER_KEY. Demo only: in production Alice signs these herself. */
export function createDemoOwner({ rpcUrl, ownerKey, deployments }) {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(ownerKey) });
  const id = labelId(deployments.agentLabel ?? "agent");
  const send = async (tx) => {
    const hash = await walletClient.writeContract(tx);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
    return hash;
  };
  return {
    setCap: (cap) => send({ address: deployments.vault, abi: vaultOwnerAbi, functionName: "setCap", args: [cap] }),
    revokeMandate: () => send({ address: deployments.userRegistry, abi: registryAbi, functionName: "revokeRoles", args: [id, ROLE.MANDATE, deployments.agent] }),
    /** Withdraws the Vault's whole balance of the cap token (USDC) to Alice. */
    withdrawAll: async () => {
      const bal = await publicClient.readContract({ address: deployments.usdc, abi: erc20Abi, functionName: "balanceOf", args: [deployments.vault] });
      return send({ address: deployments.vault, abi: vaultOwnerAbi, functionName: "withdraw", args: [deployments.usdc, bal] });
    },
    grantMandate: () => send({ address: deployments.userRegistry, abi: registryAbi, functionName: "grantRoles", args: [id, ROLE.MANDATE, deployments.agent] }),
  };
}
