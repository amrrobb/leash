import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** Reads configuration from the environment. World settings are optional at boot so the dashboard
 * can run before credentials exist; the World routes fail loudly via requireWorld() instead. */
export function loadConfig(env = process.env) {
  const deployments = JSON.parse(readFileSync(env.DEPLOYMENTS ?? `${root}deployments/sepolia.json`, "utf8"));
  return {
    port: Number(env.PORT ?? 8787),
    rpcUrl: env.RPC_URL ?? env.SEPOLIA_RPC,
    backendKey: env.BACKEND_KEY,
    // One database per Vault: a redeploy starts clean instead of tripping "already backs another Vault".
    dbPath: env.DB_PATH ?? `${root}backend/leash-${deployments.vault.toLowerCase()}.db`,
    deployments,
    world: {
      appId: env.WORLD_APP_ID,
      rpId: env.WORLD_RP_ID,
      signingKey: env.WORLD_RP_SIGNING_KEY,
      action: env.WORLD_ACTION ?? "leash-verify",
      verifyUrl: env.WORLD_VERIFY_URL ?? "https://developer.worldcoin.org/api/v4/verify",
      environment: env.WORLD_ENVIRONMENT ?? "staging",
      // Staging proofs (World simulator) verify only inside a window opened on the portal, and every
      // verify call must carry its token. Unset for production proofs from a real World App.
      stagingToken: env.WORLD_STAGING_TOKEN,
      // Phones whose World App cannot yet produce native 4.0 proofs answer `world_id_4_not_available`.
      // With this on, IDKit may fall back to a World ID 3.0 proof, which the portal still verifies.
      allowLegacy: env.WORLD_ALLOW_LEGACY === "1" || env.WORLD_ALLOW_LEGACY === "true",
      // Which credentials the page asks World App for. World's simulator completes only a single
      // proof_of_human request, so staging runs set WORLD_CREDENTIALS=proof_of_human.
      credentials: (env.WORLD_CREDENTIALS ?? "proof_of_human,passport,mnc,selfie").split(",").map((c) => c.trim()).filter(Boolean),
    },
  };
}

export function requireWorld(world) {
  const missing = [
    ["WORLD_APP_ID", world.appId],
    ["WORLD_RP_ID", world.rpId],
    ["WORLD_RP_SIGNING_KEY", world.signingKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    const err = new Error(`World ID is not configured: set ${missing.join(", ")} (Developer Portal, staging app).`);
    err.status = 503;
    throw err;
  }
}
