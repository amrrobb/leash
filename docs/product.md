# Leash — problem, use case, why

> Permission for an AI agent that shrinks on its own unless a verified human keeps showing up.

## Problem
Autonomous agents are starting to hold money. Every way of giving them that power today is broken in one of two directions:
- **Full access.** An API key or wallet approval that lets the agent do anything. One bug or one prompt injection and everything is gone.
- **Per-action approval.** A human signs every transaction. Then the agent isn't autonomous, and the human is the bottleneck at 3 a.m.

On 1inch Aqua the problem is sharper: strategies are immutable once shipped. Adjusting a position means `dock()` then `ship()`. Whoever runs that loop can pull the entire virtual balance. To let an agent manage an Aqua position at all, you must hand it the key to your money.

## Use case
Alice provides liquidity on Aqua for HYPE/USDT. Markets move at night. She wants an agent to keep her position in range while she sleeps, without giving a script unlimited control — and without waking up to approve every rebalance.

## What we built
- Alice proves she is a present, unique human with World ID. The credential sets a ceiling.
- That permission is written to her agent's ENS name as roles Alice controls.
- Every hour she's away the ceiling decays. A custom SwapVM opcode reads it at execution time and trims what the market can take from her position.
- The agent can always close positions, but can only open new ones while the leash is alive.
- Her funds never leave her own vault.

## Why this solution
- **Decay, not expiry.** Expiry is a cliff. Decay is a slope: big trades shrink first, the agent is never suddenly stranded.
- **A human must come back.** If renewal can be scripted, the agent renews itself and decay is theatre. Proof-of-human is the one thing an agent can't fake.
- **Permission lives in ENS.** Readable by anyone on-chain at execution time; Alice's control doesn't depend on our backend.
- **Enforced inside SwapVM.** A wrapper can be bypassed. An opcode runs inside every quote and swap. Built-in guards say yes or no; ours says *how much*.
- **Close always, open only when alive.** A frozen agent that can't exit is worse than no agent. The failure state is a resting state, not a trap.

## What it's not
Not a firewall, not a fraud detector, not a rebalancing bot. Those exist. Leash bounds whoever runs them.
