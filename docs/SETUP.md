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
| `ALICE_KEY` | deploy scripts | Owns `leash.eth` and Alice's registry (7702-delegated; one in-flight tx at a time) |
| `OWNER_KEY`, `OWNER` | deploy, backend `DEMO_OWNER_KEY` | Vault owner: a plain key with root mandate/tier admin on the registry. Never reuse a delegated or busy key here |
| `AGENT`, `AGENT_KEY` | deploy, Agent.s.sol | Holds MANDATE on `agent.leash.eth` |
| `BACKEND`, `BACKEND_KEY` | deploy, backend | Tier-admin at registry root; the only address that can `verify()` |
| `TAKER_KEY` | Agent.s.sol `trade` | Plays "the market" in the demo |
| `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` | backend | From the World Developer Portal (§5). Without them `/api/rp-context` returns 503 |
| `WORLD_ACTION` | backend | Default `leash-verify` |
| `WORLD_VERIFY_URL` | backend | Default `https://developer.worldcoin.org/api/v4/verify` (`/{rp_id}` is appended) |
| `WORLD_ENVIRONMENT` | backend | Default `staging`; `production` for a real World App |
| `WORLD_STAGING_TOKEN` | backend | From `set_world_id_staging_verification`; sent as `x-staging-verification-token` |
| `WORLD_CREDENTIALS` | backend → page | Comma list. `proof_of_human` for the simulator (it completes only a single PoH request); default all four for a real phone |
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

Configured through the World Developer Portal MCP (`claude mcp add worldcoin-developer-portal https://developer.world.org/api/mcp --transport http --header "Authorization: Bearer <team API key>"`):

1. `get_team_context` → app `app_29bb7ef1643470c4e5535a8468422e24` ("Leash", production).
2. `configure_world_id { app_id, generate_signing_key: true }` → `rp_id` `rp_069e54311421c6ec`. The signing key is returned **once**; it went straight into `.env` as `WORLD_RP_SIGNING_KEY`. Poll `get_world_id_registration_status` until production and staging are `registered`.
3. `create_world_id_action { app_id, action: "leash-verify" }`.
4. For staging proofs (World's simulator, no phone): `set_world_id_staging_verification { app_id, enabled: true }` opens a 24 h window and returns a token → `WORLD_STAGING_TOKEN`. The backend sends it as `x-staging-verification-token` on every verify call. Set `WORLD_ENVIRONMENT=staging` and `WORLD_CREDENTIALS=proof_of_human`. To complete a request: add the Simulator MCP (`https://simulator.worldcoin.org/api/mcp`, no key) and call `complete_test_request { connect_url: <the page's "Open in World App" link> }`, or paste that link at simulator.worldcoin.org.
5. For a real phone: `WORLD_ENVIRONMENT=production`, no staging token, and Alice needs a **credential in World App**: Selfie Check (in-app, Beta), an NFC passport, or an Orb visit. World App alone proves nothing.
6. First real proof: a rejection logs `proof rejected (...)` with the result's shape. Record the identifiers in NOTES.md.

Lost the signing key? `rotate_world_id_signing_key { app_id }` returns a new one once.

## 6. Run

```bash
cd backend && DEMO_OWNER_KEY=$ALICE_KEY npm start        # http://localhost:8787, serves frontend/
```
Agent and market (`SALT` names the position; reuse it for trade and dock). Any pair works as long as one leg is USDC: `OTHER=<token>` picks the other token (default: the demo HYPE), `POOL_USDC` / `POOL_OTHER` set the pool sizes. Demo tokens mint themselves; a real token must already be in the Vault.
```bash
DEPLOYMENT=deployments/sepolia.json SALT=1 ACTION=ship  AGENT_KEY=$AGENT_KEY forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
DEPLOYMENT=deployments/sepolia.json SALT=1 ACTION=trade TAKER_KEY=$TAKER_KEY AMOUNT=10000000000 forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
DEPLOYMENT=deployments/sepolia.json SALT=1 ACTION=dock  AGENT_KEY=$AGENT_KEY forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
```

## 7. Test

```bash
forge test --no-match-path "test/fork/*"                            # 68 unit + gate tests, offline
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
