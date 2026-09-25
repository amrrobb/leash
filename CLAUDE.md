# Leash — ETHGlobal Tokyo 2026

Read HANDOFF.md first. It is the source of truth for architecture, verified facts, and build order.

## Rules
- Hackathon "From Scratch" track: every line is written during the event. Never copy from ../v0-mandate — read it only for facts.
- Commit small and often. Conventional messages. Never squash.
- Solo builder, 36 hours. Prefer the smallest thing that demos. Ask before adding a dependency or a contract not listed in HANDOFF.md.
- Cut points are real: if a phase misses its hour, say so and propose the fallback from HANDOFF.md section 6.

## Stack
- Contracts: Foundry. swap-vm on branch `main` (API `_runOpcode`, NOT `_opcodes()`), solc 0.8.30 via_ir. ENSv2 contracts-v2 solc 0.8.25. They cannot compile together: test cross-repo behaviour on an Anvil fork.
- Dev chain: `anvil --fork-url $SEPOLIA_RPC --chain-id 11155111` (run with `setsid nohup ... &`). Final deploy: real Sepolia via QuickNode.
- Backend: Node 22, `@worldcoin/idkit-core@4`, viem, SQLite for nullifiers.
- Frontend: designed separately; you get static HTML/CSS to wire up, do not redesign.

## Always
- `forge build --sizes` after touching the router; hard limit 24,576 bytes.
- `FeeProtocol` is the first instruction in every strategy program.
- Taker traits need `allowPartialFill=true` or trimmed fills revert.
- Read ENS token ids with `findTokenId(label)`, never cache.
- Attribution in README: "Powered by SwapVM — © Degensoft Ltd 2025".
- Log every integration friction (World, ENS, 1inch) to NOTES.md as you hit it; it becomes the submission debrief.

## Never
- Write storage inside the MandateGate opcode.
- Put nullifiers in memory.
- Trust a client-side World result without the /verify round-trip.
- Add cross-chain, bridges, Jev, LLM judges, or a workflow builder.
