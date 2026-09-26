import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { openStore } from "./store.js";
import { createChain } from "./chain.js";
import { createSigner } from "./demo.js";
import { createApp } from "./app.js";

const config = loadConfig();
const store = openStore(config.dbPath);
const chain = createChain(config);
const signer = process.env.DEMO_OWNER_KEY ? createSigner({ rpcUrl: config.rpcUrl, ownerKey: process.env.DEMO_OWNER_KEY }) : null;
const staticDir = fileURLToPath(new URL("../../frontend", import.meta.url));
const vendorDir = fileURLToPath(new URL("../node_modules/@worldcoin/idkit-core/dist", import.meta.url));

createApp({ config, store, chain, signer, demoToken: process.env.DEMO_TOKEN, staticDir, vendorDir }).listen(config.port, () => {
  console.log(`leash backend on http://localhost:${config.port}  factory ${config.deployments.factory ?? "none"}  demo vault ${config.deployments.vault ?? "none"}`);
  if (signer) console.log(`test signer enabled: ${signer.address} (stands in for a wallet in browser tests)`);
  if (!config.world.appId) console.log("World ID not configured: /api/rp-context and /api/proof will return 503");
});
