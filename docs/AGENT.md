# The agent — use case, how it works, why the problem is real

## The use case

Alice provides liquidity on 1inch Aqua. Aqua strategies are immutable: to adjust a position you `dock()` it and `ship()` a new one. Markets move at night, so she wants software to keep her position in range while she sleeps.

Every way she can give that software power today is broken in one of two directions:

- **Full access.** Whoever can `dock()` can pull the whole virtual balance. Give a bot her key, or approve it as operator, and one bug or one prompt injection takes everything.
- **Per-action approval.** She signs every rebalance. Then the bot is not autonomous, and she is the bottleneck at 3 a.m.

Leash is the third option. The bot gets a **mandate**: a role on Alice's ENS name and a cap that shrinks by itself from the last moment a verified human showed up. The bot can always close; it can open only while the mandate is alive; and the market can never take more than the cap from her position. When Alice stops showing up, the bot winds down instead of running unbounded. When she comes back, it resumes.

## Who decides what

| Question | Who answers it | Where it lives |
|---|---|---|
| Is this bot allowed at all? | Alice | MANDATE role bit on `agent.leash.eth` (revocable, readable by anyone) |
| How much can the market take from my position? | Alice's World ID tier, decaying with time, capped by her own number | `Vault.capNow()`, enforced by the `MandateGate` opcode inside every quote and swap |
| Which pair, how big, when to re-range? | The agent | `agent/policy.json` and its own loop |
| Which tokens can it use at all? | Alice, by what she puts in the Vault; every pair must have a USDC leg | `Vault.ship` (`CapTokenMissing`) and the gate (`MandateTokenMissing`) |
| Can it renew its own permission? | No. Only a World ID proof from a human moves the clock | `Vault.verify()` is backend-only, after a server-side proof check |

Alice does not pick strategies in the dashboard. She holds the leash; the agent walks.

## How the loop works (`agent/loop.mjs`)

Every 10 seconds:

1. Read `Vault.mandate()`: alive?, how much room?
2. **Room > 0 and no position:** open one. Pick the next pair from the policy, choose a salt, `ship` through the Vault. The Vault checks the role and the cap, approves Aqua, and becomes the maker.
3. **Room > 0 and the position is older than `rerangeSeconds`:** close and re-open ("re-range"). On an x·y=k pool this is a timer standing in for a price trigger; the mechanics are identical.
4. **Room = 0, or the mandate is revoked:** try to open anyway, get refused by the chain (`MandateEmpty` / `NoMandate`), report the refusal to the dashboard ("Agent tried to open a new range · Paused"), then **close the open position** (risk off) and wait. It keeps polling; it never asks the human for anything.
5. **Room returns** (Alice verified again, or restored the mandate): resume at step 2.

The agent's state is one small file (which position is open). The chain is the record; the dashboard shows both the on-chain events and the agent's reported refusals.

`agent/market.mjs` is the counter-party: every ~40 s it trades a random size (1,500–12,000 USDC) against the open position. Small trades fill in full; large ones are trimmed to the live cap; at zero they are refused. Nothing about it is special: it is a plain wallet calling the router.

## Bring your own agent

Leash is the permission layer, not the agent. Any software that holds the agent key can run under a leash; it needs two calls on the Vault and nothing else:

```solidity
// open: the Vault checks the ENS role and the live cap, approves Aqua, ships as maker
bytes32 h = vault.ship(router, abi.encode(order), tokens, amounts);
// close: always allowed for the agent, reads no ENS state
vault.dock(h);
```

`order` is built with `LeashOrder.build(vault, usdc, other, salt)` (the program `MandateGate → XYCSwap → Salt`); `tokens` must include the cap token (USDC). Everything else (which pair, how big, when) is the agent's own policy. An LLM agent gets these as two tools; a rebalancing service calls them from its loop; `agent/loop.mjs` is the 100-line reference that does exactly this.

What the agent can never do, whatever it is: raise its cap, renew its own clock, transfer the name, escalate its role, or withdraw. Those live with Alice and with a human proof.

## The attack (`agent/attack.mjs`)

The Grok × Bankr incident, replayed against a leash. The agent is treated as fully compromised ("send everything to me") and tries every way to reach the money. Every attempt is a real call from the agent's key; the chain answers:

| Attempt | Refused by |
|---|---|
| Withdraw the whole vault to itself | `Vault.withdraw`: `NotOwner` |
| Raise its own ceiling to the Orb tier | ENSv2 registry: `EACCannotGrantRoles` (the agent holds no admin bit) |
| Renew its own permission (stamp the clock) | `Vault.verify`: `NotBackend` |
| Set its own cap to unlimited | `Vault.setCap`: `NotOwner` |
| Open a position the cap cannot see (no USDC leg) | `Vault.ship`: `CapTokenMissing` (`MandateEmpty` when the cap is already zero) |
| A trade asking for 100,000 USDC in one fill | `MandateGate` trims it to the live cap |

Each refusal is written to the owner's feed ("Agent tried to … · Paused"). Run it live during the demo: `VAULT=<vault> AGENT_KEY=$AGENT_KEY TAKER_KEY=$TAKER_KEY node attack.mjs`. What the compromised agent *can* still do is exactly what the product allows: open positions within the cap while the leash is alive, and close them at any time.

## Why there is no "AI" inside the agent

Leash bounds whoever runs the loop. The loop here is a policy file and a timer because that is enough to show every behaviour that matters: acting alone, being refused, closing safely, resuming. An LLM agent, a rebalancing service or a script would be bounded the same way, by the same contracts. Judges cannot verify that a bot is clever; they can verify what happens when it is not allowed.

## Why the problem is real

- **Immutable strategies force a loop.** On Aqua there is no "edit position". Anyone who maintains a position must hold dock/ship authority, so delegation is unavoidable, and the delegate holds the whole balance.
- **Delegation today is binary.** Operator approvals, session keys and API keys grant everything or nothing, and they do not expire on their own unless someone builds an expiry. Expiry is a cliff: at the deadline the bot is stranded with an open position. Decay is a slope: the bot gets less room first and can still close.
- **Renewal must be human.** If the bot can renew its own permission, decay is theatre. Proof of personhood is the one thing a script cannot fake, and World ID makes it a QR scan rather than a signature the bot could produce.
- **The check must run where the trade happens.** A backend that refuses to ship can be bypassed by a bot that calls the router directly. The gate is a SwapVM instruction: it runs inside the quote and the swap, for every taker, with no way around it.

## What the demo shows, in order

1. Alice verifies with World; the cap appears by tier.
2. The agent opens a position by itself.
3. The market trades; large trades are trimmed as the cap decays.
4. The cap reaches zero. The agent is refused, closes the position, and waits.
5. Alice verifies again. The agent resumes.
6. Alice revokes; the agent is refused and closes. Alice restores; it resumes.

Measured on Sepolia (2026-09-26): gate cost 26.6k gas per swap; a 10,000 USDC ask trimmed to 7,500 at 24 demo-hours; zero at 72 demo-hours.
