import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { openStore } from "./store.js";
import { createChain } from "./chain.js";
import { createDemoOwner } from "./demo.js";
import { createApp } from "./app.js";

const config = loadConfig();
const store = openStore(config.dbPath);
const chain = createChain(config);
const demo = process.env.DEMO_OWNER_KEY ? createDemoOwner({ ...config, ownerKey: process.env.DEMO_OWNER_KEY }) : null;
const staticDir = fileURLToPath(new URL("../../frontend", import.meta.url));

createApp({ config, store, chain, demo, staticDir }).listen(config.port, () => {
  console.log(`leash backend on http://localhost:${config.port}  vault ${config.deployments.vault}`);
  if (demo) console.log("demo owner signer enabled (stands in for Alice's wallet)");
  if (!config.world.appId) console.log("World ID not configured: /api/rp-context and /api/proof will return 503");
});
