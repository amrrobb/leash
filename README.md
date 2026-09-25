# Leash

> Permission for an AI agent that shrinks on its own unless a verified human keeps showing up.

ETHGlobal Tokyo 2026. An agent manages Alice's 1inch Aqua position from a Vault. It can always close positions; it can open them only while its ENSv2 mandate is alive and a cap, set by Alice's World ID tier, has not decayed to zero. Alice verifying again restores the cap.

See [HANDOFF.md](HANDOFF.md) for architecture and [docs/product.md](docs/product.md) for the problem and use case.

## Setup

```bash
git clone --recurse-submodules https://github.com/amrrobb/leash.git
cd leash/lib/swap-vm && yarn install --frozen-lockfile --production --ignore-scripts && cd ../..
forge test                                   # unit tests (offline)
echo 'SEPOLIA_RPC=<archive-capable Sepolia RPC>' > .env
forge test --match-path "test/fork/*"        # against the real ENSv2 deployment on a Sepolia fork
```

Deploy (Alice's registry, agent name and roles, Aqua, Vault):

```bash
ALICE_KEY=... AGENT=0x... BACKEND=0x... SPEED=1440 \
  forge script script/DeployLeash.s.sol --rpc-url $SEPOLIA_RPC --broadcast
```

## Attribution

- Powered by SwapVM — © Degensoft Ltd 2025
- Built with 1inch Aqua, ENSv2 (contracts-v2), and World ID (IDKit v4).
- AI tools: Claude Code was used for implementation; prompts and specs are in `HANDOFF.md`, `CLAUDE.md` and `docs/`.
