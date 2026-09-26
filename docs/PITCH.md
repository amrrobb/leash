# Leash — pitch storyboard and judge Q&A

Three things here: the 90-second table pitch (judges standing at your table), the slide storyboard (for the deck and the video), and the questions to expect with answers you can give from memory.

## 1. The 90-second table pitch

Have open: the dashboard in State B with the agent loop and the market bot running in a terminal beside it. Say the lines; point at the screen.

| Beat | Say | Show |
|---|---|---|
| Open (10 s) | "Any wallet. I connect, create my vault, name my agent: one transaction. ENS registers the name to me and gives the agent its mandate." | Connect → Create your vault → the name appears in the header |
| Hook (10 s) | "On 1inch Aqua you can't edit a position. You close it and open a new one. So whoever runs that loop for you holds the key to your whole balance. That's what you hand a bot today: all or nothing." | Dashboard, big number |
| Whose money (5 s) | "Her funds sit in her own vault; here's the balance. The bot never holds them." | Mandate card: "In your vault: 10,000 USDC · 1,000 HYPE" |
| Idea (15 s) | "Leash gives the bot a permission that shrinks by itself. This number is how much the market can take from Alice's position right now. It halves every day since she last proved she's a human, with World ID. Nobody but a human can top it up." | Point at the number and the ASCII leash sagging |
| Proof it's real (20 s) | "This isn't a UI rule. It's a SwapVM opcode: it runs inside every quote and swap. Watch: the market just asked for 10,000 and got 7,500." | Feed row "Asked 10,000 · allowed 7,500 · Trimmed" |
| The attack (20 s) | "Now the Grok story. This agent has been told 'send everything to me'. Watch it try." Run `attack.mjs`. "Withdraw: refused. Promote itself: refused. Renew its own clock: refused. Unlimited cap: refused. A hidden position: refused. A 100,000 trade: filled up to the cap. Six for six." | Terminal: the six lines; dashboard: six Paused rows appear |
| The asymmetry (15 s) | "When it hits zero the bot can't open anything, but it can always close. That's the design: the failure state is resting, not stuck." | Wait for or show State C; terminal: "refused: MandateEmpty… closing… waiting for the human" |
| Human comes back (15 s) | "Alice scans once. The cap is back, the bot resumes. And the permission lives on her ENS name: she can revoke it, and anyone on-chain can read it." | Verify again → B; Revoke → C → Restore |
| Close (10 s) | "Three sponsors, each load-bearing: ENS holds the permission, World makes renewal human-only, the 1inch opcode enforces it inside the trade. All live on Sepolia, 172 tests." | Landing page or GitHub |

Memorise the one-liners (from HANDOFF §9):
- vs Doca / Harbormaster: *the one running the loop isn't the owner, and its authority runs out.*
- vs the `Decay` opcode: *Decay shrinks what's offered; ours shrinks what's still allowed.*
- vs built-in guards: *guards say yes or no; ours says how much.*
- vs a signature: *a signature can't be revoked; a live role can, and anyone can read it.*
- "Why World?": *without it the agent would renew its own permission.*

## 2. Slide storyboard (10 slides, also the video's spine)

| # | Slide | On the slide | Voice-over |
|---|---|---|---|
| 1 | **Leash** | Logo, tagline "Permission that shrinks on its own", landing screenshot | "Leash: permission for an AI agent that shrinks on its own unless a verified human keeps showing up." |
| 2 | **The key problem** | Two columns: "Full access" (one bug = everything gone) · "Approve every action" (human is the bottleneck at 3 a.m.); below, four cards: Grok × Bankr (prompt injection, twice), DEXX ($30M, keys in bot custody), 3Commas ($22M, API keys), Banana Gun ($3M) | "Agents are starting to hold money. Every way to give them that today is broken in one of two directions. And it keeps happening: an AI agent on X was drained twice by a hidden prompt, because it held full authority over its wallet." |
| 3 | **Why Aqua makes it sharp** | `dock()` → `ship()` loop diagram; "whoever runs the loop can pull the whole balance" | "On Aqua, strategies are immutable, so someone has to keep closing and reopening. That someone holds the key." |
| 4 | **The idea** | The decay curve: 15,000 → 7,500 → 3,750 → 0 over 3 days; a QR icon resetting it | "Decay, not expiry. Expiry is a cliff; decay is a slope: big trades shrink first, the bot is never suddenly stranded. And only a human can reset it." |
| 5 | **How it's built** | The architecture diagram from README; three sponsor logos on the edges they own | "ENS holds the permission. World makes renewal human-only. A SwapVM opcode enforces the cap inside every trade." |
| 6 | **Live demo** | The video: verify → mandate → agent ships → trimmed trade → zero → refused but closes → verify again | (the demo, 60–90 s) |
| 7 | **The opcode** | 12 lines of `MandateGate.exec`; "26.6k gas per swap, measured on the real ENSv2 registry" | "This is the whole enforcement: read the maker's mandate, revert if revoked or empty, trim the USDC leg. Runs in quotes too, so there's no path around it." |
| 8 | **What each sponsor gave us** | Three cards: ENSv2 root-admin pattern · World nonce-based replay + one human per Vault · Aqua router had no permission instruction, now it does | "Each integration changed the design. The notes file has every friction with a timestamp." |
| 9 | **Numbers** | 172 tests · 10,000 → 7,500 on-chain · 22,509 B router · zero at 72 h · leash.eth live | "Everything here ran on Sepolia today, not on a mock." |
| 10 | **Where it goes** | Per-trade cap → cumulative budget · more curves · any recurring authority (payroll streams, grant disbursement, treasury limits) | "The primitive is general: any authority that should die when the human stops showing up." |

## 3. Demo run sheet

Before judges arrive:
1. Backend on real Sepolia (production World mode if you'll scan with your phone; staging + `WORLD_CREDENTIALS=proof_of_human` if you'll use the simulator). MetaMask on Sepolia with a funded account for you (the owner) and the agent's address at hand.
2. `agent/loop.mjs` and `agent/market.mjs` running in a visible terminal with `VAULT=<your vault>`; a second terminal ready with `VAULT=<your vault> AGENT_KEY=$AGENT_KEY TAKER_KEY=$TAKER_KEY node attack.mjs` for the attack beat.
3. Check gas: agent, backend, taker each above 0.005 ETH.
4. Do one verify so you start in State B, not C. It takes 3 minutes to reach zero, so re-verify every ~2 minutes while talking, or let it hit zero on purpose when you reach the "asymmetry" beat.

Fallbacks:
- Phone fails → simulator: paste "Open in World App" link at simulator.worldcoin.org (staging mode). Say: "World's simulator produces a real staging proof; a phone does the same in production mode."
- RPC slow → the number still animates from the last read; say so honestly.
- Cancel path: open the modal and press Cancel. Say: "Nothing was granted, and the cap kept falling."

## 4. Questions to expect, with answers

### General

**"Is this a bot? Where's the AI?"**
No. Leash bounds *whoever* runs the loop: an LLM agent, a rebalancer, a script. The demo agent is a policy file and a timer because that's enough to show every behaviour that matters: acting alone, being refused, closing safely, resuming. You can't verify a bot is clever; you can verify what happens when it isn't allowed.

**"Why not just session keys or an expiry?"**
Both are binary. Expiry is a cliff: at the deadline the bot is stranded with an open position. Decay gives less room first and always leaves the close path open. And neither of them requires a *human* to renew; a script renews a session key. Proof of personhood is the one thing the agent can't produce.

**"Why does the cap decay by halving?"**
Halving is legible: "half as much per day away" is something Alice can reason about. Linear interpolation inside the day avoids steps. The 72-hour cutoff exists because pure halving takes about a month to reach zero; three days is a human absence you'd want to notice.

**"What's the cap denominated in? Why USDC?"**
One currency for both directions. If the cap were in the swapped token, 2,000 would mean 2,000 HYPE-wei on one side and 2,000 USDC on the other. Every strategy must have a USDC leg; the Vault and the gate both refuse ones that don't.

**"Isn't 26.6k gas per swap expensive?"**
It's ~20% on a 130k Aqua swap, one ENS read and one Vault read. It's the price of an on-chain permission read at execution time; a whitelist read costs about the same. We measured it against the real registry, not a mock.

**"Can I try it myself? Do I have to be Alice?"**
No. Connect your own wallet on Sepolia, create your own vault (one transaction: vault, `<name>.leash.eth` registered to you, your agent's mandate), verify with your own World App, deposit demo tokens and set a cap. Alice is just the persona in the story. If you scan the QR on *someone else's* vault you're refused: that vault already has its human.

**"Has this actually happened?"**
Yes, repeatedly, and always the same shape: software holding unbounded authority over a wallet.
- **Grok × Bankr, May 2026** (and March 2025, same wallet): a prompt hidden in Morse code on X made the AI agent move ~$150–200k of tokens; the same wallet had lost ~$330k to the same injection path fourteen months earlier. The agent had full authority. With a leash: one fill bounded by the cap, then decay; no human, no renewal. Sources: [OECD.AI incident record](https://oecd.ai/en/incidents/2026-05-04-4a73), [Giskard](https://www.giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet).
- **DEXX, November 2024**: ~$30M from 8,600+ wallets; the trading bot custodied and leaked users' private keys. Sources: [SlowMist via Brave New Coin](https://bravenewcoin.com/insights/dexx-hack-investigation-unveils-over-8600-solana-wallet-links-slowmist-report), [ChainCatcher](https://www.chaincatcher.com/en/article/2152340).
- **3Commas, December 2022**: 100,000 exchange API keys leaked, ~$22M traded away; an API key is all-or-nothing. Sources: [Decrypt](https://decrypt.co/118094/after-repeated-denials-3commas-admits-it-was-source-for-earlier-hacks), [CoinDesk](https://www.coindesk.com/tech/2022/12/28/anonymous-twitter-user-leaks-alleged-3commas-api-database).
- **Banana Gun, September 2024**: ~$3M from 11 traders through the Telegram bot's message oracle. Sources: [QuillAudits](https://www.quillaudits.com/blog/hack-analysis/banana-gun-exploit), [Cryptonews](https://cryptonews.com/news/telegram-bot-banana-gun-to-refund-3-million-hack-victims/).
The one-liner: *every one of these bots held the key. Leash gives the bot a leash instead, and the money never leaves the owner's vault.*

**"MetaMask's ERC-7715 permissions already do spend limits. What's new?"**
Three things they don't do: the limit *decays* instead of expiring (a cliff strands an open Aqua position); renewal needs a *present human* (a signature can be produced by the agent, a World proof can't); and it's enforced *inside the swap* by a SwapVM instruction, so a bot calling the router directly is still bounded. Plus the permission is a public ENS role, not a private signed blob. The obvious next step is a "leash caveat" inside a 7715 delegation. See docs/MARKET.md.

### The hard one

**"The cap is per trade. Can't many small trades drain the position?"**
Yes, today the cap bounds each fill, not the cumulative volume. That's honest and it's the next step: a cumulative budget needs state, and the opcode runs in static context during quotes, so the accounting has to live in the Vault (it already tracks positions) with the gate reading a remaining budget. The decay still bounds the *window*: at zero nothing fills. We chose to ship the enforcement path end-to-end first.

### 1inch

**"What did you write on SwapVM?"**
One instruction (`MandateGate`, opcode 0x2f), one router that dispatches it, and the program builder. The engine, XYCSwap, Aqua and taker traits are 1inch's, unchanged. The Aqua router shipped with no permission instruction at all; the whitelist guards exist only on the Limit router and they're yes/no.

**"Why is the Vault the maker?"**
Aqua identifies the maker as `msg.sender` of `ship` and pulls tokens from it. A contract maker means the tokens never leave Alice's Vault and the opcode has something to read (`mandate()`). We asked the 1inch mentor whether a contract maker is acceptable. [Write their answer here.]

**"Why trim instead of revert?"**
Reverting punishes the taker for the maker's state. Trimming keeps the market usable: the taker sets `allowPartialFill` and gets what's allowed. Reverts are reserved for "revoked" and "empty", where there's nothing to give.

**"Does it work with other curves?"**
The trim on the computed leg uses the inverse of x·y=k. Concentrated or pegged curves need their own inverse, or a different placement. Known limit; documented.

### ENS

**"Why ENS and not a mapping in the Vault?"**
So the permission is readable by anyone at execution time and doesn't depend on our backend or our contract: the router's opcode reads ENS roles directly. And Alice's control is ENS's control: revoke, expiry, transfer rules.

**"How did you use ENSv2 specifically?"**
Alice's own `UserRegistry` via the VerifiableFactory, `leash.eth` registered through the real registrar with that registry as its subregistry, role bits on the `agent` token (mandate nybble 40, tiers 44/48/52). Token admin bits can't be delegated in ENSv2, so the backend holds tier-admin at the registry root and can never touch MANDATE. Name expiry kills all roles automatically.

**"What happens when the token id changes after a grant?"**
It regenerates on every grant/revoke. Role reads accept any version of the label's id, so the Vault stores `keccak256("agent")` and never goes stale. `findTokenId` is only needed for ownership and transfer.

### World

**"Selfie Check isn't a uniqueness guarantee."**
Correct, and we don't claim it. It's the lowest tier (2,000) and labelled Beta. Orb and passport are the uniqueness tiers with higher caps. What Leash needs from World is *presence*: a human, not a script, renewing the permission.

**"Can the same person verify twice?"**
Yes, that's the whole renewal loop. Replay protection is the signed request nonce, single-use in SQLite, not the nullifier. The nullifier binds one human to one Vault, so one person can't keep two agents alive.

**"What if World is down?"**
Renewal stops, decay continues, the agent winds down and can still close. Degradation is safe by construction: the failure state is close-only.

**"Did you use a real proof?"**
Yes, twice today on real Sepolia: World's simulator produced staging Proof-of-Human proofs, the Developer Portal verified them, and the backend granted the tier and stamped the Vault. Phones without native World ID 4.0 answer with legacy 3.0 proofs, which the portal also verifies.

### Security

**"Can the backend steal funds?"**
No. It holds tier-admin only: it can set or remove tiers, never grant MANDATE, never withdraw, never ship. Its only Vault call is `verify()`. Worst case, a compromised backend renews the clock without a human; it still can't move money. Alice can also remove the backend's root role.

**"Can the agent go around the Vault and call the router?"**
The gate reads the *maker*. Any strategy where the Vault is maker is gated, whoever shipped it, and the Vault refuses to ship a pair without USDC. A strategy where the agent is maker with its own tokens isn't Alice's money.

**"What can Alice lose?"**
At most what the cap allows per fill, from a position the agent opened with her funds, until it decays. She can revoke at any time, withdraw at any time, and the agent can never transfer the name or escalate its role.

### Business

**"Who pays for this?"**
Whoever delegates money to software and wants to sleep: LPs using agents, DAOs giving treasuries to bots, funds running strategies. The primitive also fits payroll streams and grant disbursement: any recurring authority that should die when the human stops showing up.

**"What's next?"**
Cumulative budget in the Vault, more curves, a deposit flow in the dashboard, and a production Vault at `speed = 1`.
