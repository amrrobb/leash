import { signRequest } from "@worldcoin/idkit-core/signing";
import { requireWorld } from "./config.js";
import { strongestCredential, verifyWithPortal } from "./world.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Signs an rp_context for IDKit and records its nonce as issued (single-use). */
export function issueRpContext({ world, store, sign = signRequest }) {
  requireWorld(world);
  const sig = sign({ action: world.action, signingKeyHex: world.signingKey });
  store.issueNonce(sig.nonce, sig.expiresAt);
  return {
    app_id: world.appId,
    action: world.action,
    environment: world.environment,
    rp_context: { rp_id: world.rpId, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
  };
}

/** Verifies a completion result and, only if every check passes, grants the tier and stamps the Vault. */
export async function handleProof({ result, world, store, chain, vault, fetchImpl = fetch }) {
  requireWorld(world);
  if (result?.protocol_version !== "4.0") throw fail(400, "expected a World ID 4.0 uniqueness proof");
  if (result.action !== world.action) throw fail(400, `proof is for action "${result.action}", expected "${world.action}"`);
  if (!store.consumeNonce(result.nonce)) throw fail(409, "rp_context nonce is unknown, expired or already used");

  await verifyWithPortal(result, world, fetchImpl);

  const best = strongestCredential(result);
  if (!best) throw fail(400, "no supported credential in the proof");
  if (!store.bindHuman(best.nullifier, vault, best.tier.name)) throw fail(409, "this human already backs another Vault");

  const grantTx = await chain.grantTier(best.tier.bit);
  const verifyTx = await chain.stampVerified();
  return { tier: best.tier.name, cap: best.tier.cap, credential: best.identifier, txs: { grantTier: grantTx, verify: verifyTx } };
}
