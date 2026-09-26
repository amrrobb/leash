/** World ID v4: tier mapping and server-side proof verification. */

export const ROLE = {
  MANDATE: 1n << 40n,
  ORB: 1n << 44n,
  DOCUMENT: 1n << 48n,
  SELFIE: 1n << 52n,
};

/** Credential identifier (IDKit v4 ResponseItem.identifier) -> Leash tier. Highest rank wins. */
const TIERS = {
  proof_of_human: { name: "orb", bit: ROLE.ORB, cap: 15_000, rank: 3 },
  passport: { name: "document", bit: ROLE.DOCUMENT, cap: 7_500, rank: 2 },
  mnc: { name: "document", bit: ROLE.DOCUMENT, cap: 7_500, rank: 2 },
  selfie: { name: "selfie", bit: ROLE.SELFIE, cap: 2_000, rank: 1 },
};

export function tierOf(identifier) {
  return TIERS[identifier] ?? null;
}

/** Picks the strongest known credential in a v4 result. Returns null if none is recognised. */
export function strongestCredential(result) {
  let best = null;
  for (const item of result?.responses ?? []) {
    const tier = tierOf(item.identifier);
    if (tier && (!best || tier.rank > best.tier.rank)) best = { tier, nullifier: item.nullifier, identifier: item.identifier };
  }
  return best;
}

/** Forwards the IDKit completion result untouched to the Developer Portal. Throws on rejection. */
export async function verifyWithPortal(result, world, fetchImpl = fetch) {
  const headers = { "Content-Type": "application/json" };
  if (world.stagingToken) headers["x-staging-verification-token"] = world.stagingToken;
  const res = await fetchImpl(`${world.verifyUrl}/${world.rpId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(result),
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok || body.success !== true) {
    const err = new Error(`World rejected the proof: ${body.detail ?? body.code ?? res.status}`);
    err.status = 400;
    err.portal = body;
    throw err;
  }
  return body;
}
