import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/** A wallet stand-in for browser tests and scripted demos: signs raw calldata with DEMO_OWNER_KEY.
 * In the product the owner's own wallet signs; this exists so Playwright can play the owner. */
export function createSigner({ rpcUrl, ownerKey }) {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const account = privateKeyToAccount(ownerKey);
  const walletClient = createWalletClient({ chain: sepolia, transport, account });
  return {
    address: account.address,
    async send(to, data, value = "0") {
      const hash = await walletClient.sendTransaction({ to, data, value: BigInt(value) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
      return hash;
    },
  };
}
