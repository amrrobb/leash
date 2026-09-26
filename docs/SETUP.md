# Setup

How to run and deploy Leash as it exists in this repo. For how the pieces talk to each other, see [INTEGRATION.md](INTEGRATION.md).

## 0. Machine

- Foundry (tested with forge 1.7.1). solc 0.8.30 downloads on first build.
- Node **≥ 22.13**: the backend uses the built-in `node:sqlite`, so there is no native module to compile.
- yarn 1 for swap-vm's dependencies. `jq` for `script/deploy.sh`.

## 1. Repo layout

```
src/            Vault.sol, MandateGate.sol, MandateAquaRouter.sol, LeashOrder.sol, DemoToken.sol, interfaces/
lib/swap-vm/    git submodule, branch main (API _runOpcode). Aqua v1.0.0 comes from its npm deps: no lib/aqua
script/         DeployLeash.s.sol, deploy.sh, RegisterName.s.sol, Agent.s.sol
test/           unit (Vault, decay fuzz), gate/ (real Aqua + router), fork/ (real ENSv2 on Sepolia), mocks/
backend/        Node HTTP API: World ID, chain reads/writes, demo owner signer
frontend/       index.html + app.js (one JS file), brand/
e2e/            Playwright on an Anvil fork
deployments/    sepolia.json: the live addresses everything reads
```

## 2. Install

```bash
git clone --recurse-submodules https://github.com/amrrobb/leash.git && cd leash
(cd lib/swap-vm && yarn install --frozen-lockfile --production --ignore-scripts)
(cd backend && npm ci)
(cd e2e && npm ci && npx playwright install chromium)
forge build src --sizes        # MandateAquaRouter must stay < 24,576 B (currently 22,493)
```

The root `foundry.toml` mirrors swap-vm (0.8.30, via-IR, 700 runs) and sets `test = "test"`, so swap-vm's own suite, which takes over 20 minutes to compile, never builds.

## 3. `.env` (repo root, gitignored)

| Variable | Used by | Notes |
|---|---|---|
| `SEPOLIA_RPC` | forge, backend, e2e | Must serve historical state (Alchemy, Tenderly). publicnode can't fork |
| `ALICE_KEY` | deploy scripts | Owner of the Vault and of `leash.eth` |
| `AGENT`, `AGENT_KEY` | deploy, Agent.s.sol | Holds MANDATE on `agent.leash.eth` |
| `BACKEND`, `BACKEND_KEY` | deploy, backend | Tier-admin at registry root; the only address that can `verify()` |
| `TAKER_KEY` | Agent.s.sol `trade` | Plays "the market" in the demo |
| `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` | backend | From the World Developer Portal (§5). Without them `/api/rp-context` returns 503 |
| `WORLD_ACTION` | backend | Default `leash-verify` |
| `WORLD_VERIFY_URL` | backend | Default `https://developer.worldcoin.org/api/v4/verify` (`/{rp_id}` is appended) |
| `WORLD_ENVIRONMENT` | backend | Default `staging` |
| `DEMO_OWNER_KEY` | backend | Enables `/api/demo/*` (Alice's owner actions). Loopback-only unless `DEMO_TOKEN` is set and sent as `x-demo-token` |
| `RPC_URL`, `DEPLOYMENTS`, `DB_PATH`, `PORT` | backend | Defaults: `SEPOLIA_RPC`, `deployments/sepolia.json`, `backend/leash-<vault>.db`, `8787` |

Save any key you generate to `.env` **before** funding it.

## 4. Deploy

Fresh (new registry, Aqua, tokens, Vault, router):
```bash
RPC=$SEPOLIA_RPC ALICE_KEY=$ALICE_KEY AGENT=$AGENT BACKEND=$BACKEND SPEED=1440 OUT=e2e/.tmp/new.json script/deploy.sh
```

Redeploy the Vault and router only. This keeps `leash.eth` → Alice's registry intact, and is what's live now:
```bash
D=deployments/sepolia.json
RPC=$SEPOLIA_RPC USER_REGISTRY=$(jq -r .userRegistry $D) AQUA=$(jq -r .aqua $D) USDC=$(jq -r .usdc $D) HYPE=$(jq -r .hype $D) \
  ALICE_KEY=$ALICE_KEY AGENT=$AGENT BACKEND=$BACKEND SPEED=1440 OUT=e2e/.tmp/redeploy.json script/deploy.sh
```
Then copy the new `vault`, `router` and `deployBlock` into `deployments/sepolia.json`.

The `.eth` name takes two runs at least 60 s apart:
```bash
USER_REGISTRY=<registry> STEP=commit   forge script script/RegisterName.s.sol --rpc-url $SEPOLIA_RPC --broadcast
USER_REGISTRY=<registry> STEP=register forge script script/RegisterName.s.sol --rpc-url $SEPOLIA_RPC --broadcast
```

Cost on Sepolia at about 1 gwei: Vault 1.35M gas, router 5.0M gas, `.eth` name about 0.3M gas plus ~8 MockUSDC per year.

## 5. World ID

1. At the Developer Portal, create an app in **staging** to get `app_id` (`app_staging_…`).
2. Create the action **`leash-verify`**, with unlimited verifications per human (Alice must be able to come back).
3. Register a **Relying Party**. That gives `rp_id` (`rp_…`) and a **signing key**; save the key immediately.
4. Alice needs a **credential in World App**: Selfie Check (in-app, Beta), a passport with an NFC chip, or an Orb visit. Installing World App alone isn't enough.
5. Staging apps may need World's **simulator** instead of the real World App. Confirm at the World booth which one works for v4 staging.
6. On the first real proof, watch the backend log. A rejection prints `proof rejected (…)` with the result's shape (field names, protocol version, identifiers, nonce format). Check the identifiers against the tier map in `backend/src/world.js` and log them in NOTES.md.

## 6. Run

```bash
cd backend && DEMO_OWNER_KEY=$ALICE_KEY npm start        # http://localhost:8787, serves frontend/
```
Agent and market (`SALT` picks the strategy; reuse it for trade and dock):
```bash
DEPLOYMENT=deployments/sepolia.json SALT=1 ACTION=ship  AGENT_KEY=$AGENT_KEY forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
DEPLOYMENT=deployments/sepolia.json SALT=1 ACTION=trade TAKER_KEY=$TAKER_KEY AMOUNT=10000000000 forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
DEPLOYMENT=deployments/sepolia.json SALT=1 ACTION=dock  AGENT_KEY=$AGENT_KEY forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
```

## 7. Test

```bash
forge test --no-match-path "test/fork/*"                            # 86 unit + gate tests, offline
forge test --match-path "test/fork/*"                               # real ENSv2 on a Sepolia fork
(cd backend && npm test)                                            # backend + page logic
npx --prefix e2e playwright test --config e2e/playwright.config.js  # full journey in a browser
```
A local `pre-push` hook runs the offline contract and backend tests.

## 8. Host it (World wants a live link)

Any Node host works. Set the `.env` values there and point `RPC_URL` at real Sepolia. If `DEMO_OWNER_KEY` is set on a public host, also set `DEMO_TOKEN`; otherwise the demo routes refuse non-local callers.

## 9. Before submitting

- `forge build src --sizes`: the router must stay under 24,576 B.
- README: addresses, how to run, "Powered by SwapVM — © Degensoft Ltd 2025", AI tool attribution.
- NOTES.md: paste into the World integration debrief and the 1inch/ENS feedback.
- Video: A → verify with World App → B decaying → trimmed trade → C (agent still closes) → verify again. Include one cancel.
