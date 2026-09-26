# Leash

> Permission for an AI agent that shrinks on its own unless a verified human keeps showing up.

ETHGlobal Tokyo 2026. Alice lets an agent run her 1inch Aqua position from her own Vault. The agent can **always close** positions, and can **open** them only while its ENSv2 mandate is alive. The market can trade against her position only up to a cap that Alice's World ID tier sets, and that cap **halves every 24 hours** until she verifies again. It reaches zero after 3 days. A custom SwapVM instruction enforces the cap inside every quote and swap.

- Problem and use case: [docs/product.md](docs/product.md)
- Architecture and verified facts: [HANDOFF.md](HANDOFF.md) · [ARCHITECTURE.md](ARCHITECTURE.md)
- Setup and deploy: [docs/SETUP.md](docs/SETUP.md) · how the pieces connect: [docs/INTEGRATION.md](docs/INTEGRATION.md) · the agent: [docs/AGENT.md](docs/AGENT.md)
- Integration log / sponsor feedback: [NOTES.md](NOTES.md)

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| `Vault` | `src/Vault.sol` | Holds Alice's tokens and is the Aqua maker. `ship()` needs the ENS mandate role and a live cap; `dock()` never reads ENS; `withdraw()` is owner-only; `verify()` is backend-only. One `roles()` read per call. |
| `MandateGate` | `src/MandateGate.sol` | SwapVM opcode `0x2f`. Reads `Vault.mandate()`, reverts `MandateRevoked` / `MandateEmpty`, otherwise trims the USDC leg of the trade to the live cap (inverse x·y=k when USDC is the computed leg). |
| `MandateAquaRouter` | `src/MandateAquaRouter.sol` | The stock Aqua SwapVM router plus `0x2f`. 22,493 B. |
| ENSv2 | Alice's own `UserRegistry` | `agent.leash.eth` belongs to Alice; the agent holds the MANDATE role bit; the backend holds tier-admin at the registry root, so it can set tiers but never grant or revoke the mandate. |
| World ID v4 | `backend/` | Signs `rp_context`, forwards the proof untouched to the Developer Portal, single-use nonces in SQLite, one human per Vault, then two transactions: grant the tier bit and stamp the Vault. |
| Landing | `frontend/landing/` | Single-screen hero at `/`: video, liquid-glass card, slide-in menu, vanilla HTML/CSS/JS. "Open the dashboard" fades into `/app`. |
| Dashboard | `frontend/` | One HTML page + one JS file, served by the backend at `/app`. Four states: A (no mandate), A′ (create mandate), B (operating / trimming), C (close-only). |
| Agent + market | `agent/` | `loop.mjs` opens, re-ranges, gets refused at zero, closes and resumes on its own; `market.mjs` trades random sizes against it. Both are plain scripts with their own keys: Leash bounds them, it does not run them. |

Numbers measured on a Sepolia fork against the real ENSv2 contracts: gate overhead **26.6k gas per swap**. `ship` costs 256k gas and `capNow` costs 33.4k.

## Run it

```bash
git clone --recurse-submodules https://github.com/amrrobb/leash.git && cd leash
(cd lib/swap-vm && yarn install --frozen-lockfile --production --ignore-scripts)
(cd backend && npm ci) && (cd e2e && npm ci && npx playwright install chromium)
echo 'SEPOLIA_RPC=<archive-capable Sepolia RPC>' > .env
```

| Tests | Command | Covers |
|---|---|---|
| Contracts | `forge test --no-match-path "test/fork/*"` | Vault, decay fuzzing, gate on every leg in both token orders, real Aqua |
| Contracts on a fork | `forge test --match-path "test/fork/*"` | Real ENSv2 UserRegistry and registrar on Sepolia |
| Backend + view model | `cd backend && npm test` | Replay, portal rejection, tiers, HTTP API, feed, state logic |
| End to end | `npx --prefix e2e playwright test --config e2e/playwright.config.js` | Anvil fork, fresh deploy, real backend, browser: A → cancel → decline → A′ → B → trimmed trade → decay → C → agent still closes → recovery → portal reject → revoke → withdraw |

The e2e suite stubs World at exactly two edges: the IDKit browser script (a fake that answers as World App would) and the Developer Portal HTTP call. Everything else is real: contracts, transactions, backend and browser.

### Local demo on a fork

```bash
anvil --fork-url $SEPOLIA_RPC --chain-id 11155111 --port 8545 &
RPC=http://127.0.0.1:8545 ALICE_KEY=0x.. AGENT=0x.. BACKEND=0x.. OUT=e2e/.tmp/demo.json script/deploy.sh
cd backend && RPC_URL=http://127.0.0.1:8545 DEPLOYMENTS=../e2e/.tmp/demo.json BACKEND_KEY=0x.. DEMO_OWNER_KEY=<alice key> \
  WORLD_APP_ID=app_staging_.. WORLD_RP_ID=rp_.. WORLD_RP_SIGNING_KEY=0x.. npm start      # http://localhost:8787
# the agent and the market
DEPLOYMENT=e2e/.tmp/demo.json SALT=1 ACTION=ship  AGENT_KEY=0x.. forge script script/Agent.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
DEPLOYMENT=e2e/.tmp/demo.json SALT=1 ACTION=trade TAKER_KEY=0x.. AMOUNT=10000000000 forge script script/Agent.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
DEPLOYMENT=e2e/.tmp/demo.json SALT=1 ACTION=dock  AGENT_KEY=0x.. forge script script/Agent.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

The demo Vault runs at `SPEED=1440`: one 12-second Sepolia block is 4.8 hours of decay, and the cap reaches zero in about 3 minutes.

`DEMO_OWNER_KEY` enables `/api/demo/*`, which signs Alice's owner actions (set cap, revoke, withdraw) so the demo can run without a wallet popup. In production, Alice signs these herself.

## Sepolia

`leash.eth` is registered to Alice and points at her UserRegistry. Vault v2 (`0x52e6…B164`) and MandateAquaRouter (`0xa091…b62f`) are live and reuse the same registry, Aqua and demo tokens. All addresses are in [deployments/sepolia.json](deployments/sepolia.json); `retiredVault` is the first Vault, which predates `mandate()`.

## Attribution

- Powered by SwapVM — © Degensoft Ltd 2025
- Built on 1inch Aqua, ENSv2 (`ensdomains/contracts-v2`) and World ID (IDKit v4).
- AI tools: Claude Code wrote code under the builder's direction. Prompts and specs are in `HANDOFF.md`, `CLAUDE.md`, `ROADMAP.md` and `docs/`.
