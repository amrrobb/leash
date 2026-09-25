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
    dbPath: env.DB_PATH ?? `${root}backend/leash.db`,
    deployments,
    world: {
      appId: env.WORLD_APP_ID,
      rpId: env.WORLD_RP_ID,
      signingKey: env.WORLD_RP_SIGNING_KEY,
      action: env.WORLD_ACTION ?? "leash-verify",
      verifyUrl: env.WORLD_VERIFY_URL ?? "https://developer.worldcoin.org/api/v4/verify",
      environment: env.WORLD_ENVIRONMENT ?? "staging",
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
