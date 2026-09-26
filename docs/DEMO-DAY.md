# Demo day: run-through, partner pitches, likely questions

Everything below is what the presenter says and does. The app is at https://leash.robbyn.xyz (`/app` for the dashboard). World runs in staging with the simulator (World's own instruction for this event: "we are mocking proofs now"). Three fresh owner wallets are in `.env` as `DEMO1_KEY`, `DEMO2_KEY`, `DEMO3_KEY` (0.005 ETH each; one full run costs ~0.003 at 1 gwei). Import them into MetaMask before the day starts; each can create exactly one vault.

## Setup, once (5 min)

1. MetaMask: import `DEMO1_KEY` … `DEMO3_KEY`, network Sepolia. Never use a delegated (MetaMask smart account) address.
2. Terminal A, agent (leave running all day; it follows whichever owner you name):
   ```
   cd <repo>/agent && set -a && . ../.env && set +a
   OWNER=<the demo wallet address> BACKEND=https://leash.robbyn.xyz node loop.mjs
   ```
3. Terminal B, market (start when the dashboard shows Operating):
   ```
   OWNER=<same address> BACKEND=https://leash.robbyn.xyz MARKET_SECONDS=12 node market.mjs
   ```
4. Browser: `/app`, MetaMask unlocked, on the demo account.

Timing rule: from a verification you have ~3 minutes of authority (demo clock 1 s = 0.4 h). Verify **right before** you want the agent to run, not before deposit + cap.

## The 4-minute run-through

**0:00 · The line.** "Leash is a leash for an AI agent that runs your money. Not a key. Its authority halves every day you're away and only a verified human can bring it back."

**0:15 · Act 1, the agent (Terminal A).** "The agent exists first: its own key, registered in ERC-8004 as #10531. It's waiting; it can't do anything." Terminal shows `no vault … yet; waiting for the human`.

**0:30 · Act 2, the human.** Connect → Create your vault: name, paste the demo agent (badge "ERC-8004 agent #10531") → sign. "One transaction: my vault, `<name>.leash.eth` registered to me in an ENSv2 UserRegistry, and the agent's MANDATE role bit on that name. I keep the admin bits." Terminal A finds the vault, tries to ship, `MandateEmpty()`: "bound, zero authority."

**1:15 · World.** Verify with World → Play the human. "The trust moment is renewal. The page makes a real IDKit request; today World's simulator stands in for the phone; our server verifies the proof with World's `/verify` and only then grants the tier." → "Authority up to 15,000."

**1:45 · Fund + leash.** Add demo tokens (two signatures) → cap 15,000 → Create mandate → dashboard. Then **Verify again → Play the human** (fresh clock). Start Terminal B.

**2:15 · Act 3, the leash (1inch).** Terminal A: `open (salt …)`. Feed: "Agent opened a range". Market rows: "filled in full", then **"Asked 10,693 · allowed 6,750"**. "That's a SwapVM opcode inside the Aqua swap, reading the vault's live cap and trimming the USDC leg. Not the UI, not the agent: the swap itself."

**3:15 · Zero.** "0 · Close-only". Terminal A: `refused: MandateEmpty()` → `closed; funds never left the vault`. Market: `refused`. "Nobody verified. The agent can close, nothing else."

**3:30 · Return + control.** Verify again → agent resumes. Revoke → `NoMandate()` → docks. Withdraw → 0 USDC in the vault. (Restore if time.)

**3:50 · Finale.** `VAULT=<vault> node attack.mjs`: six attempts, six refusals on chain.

Every feed row links to its Sepolia transaction; the refusals have no tx because the revert happens in simulation, nothing is sent.

## Telling each partner what we used (2 min each)

Partner judging at ETHGlobal is usually table-to-table: each sponsor's judges come by separately (or you queue at their table), 3–5 minutes each, and they only care about their piece. Do not run the whole arc for each; open with the line, then their slice.

**World.** "Trust moment: renewal. The only thing that raises the agent's authority is a proof from this vault's own human. The claim we need is presence now, so Selfie Check is the minimum credential; stronger ones only raise the ceiling (2k/7.5k/15k). Verified server-side at `/api/v4/verify`; then a role grant and a clock stamp." Show: verify → number. Fail paths: Cancel ("nothing granted"), and say: decline, a second human (409, one human per vault), expiry (the decay). Honest note: "Our World ID App is beta-gated for Selfie, so proofs come from your simulator; that's item 3 in our debrief." Point to `docs/WORLD-DEBRIEF.md`.

**ENS.** "The permission *is* a role bit on `<name>.leash.eth` in an ENSv2 UserRegistry on Sepolia. Factory registers the name to the owner and grants MANDATE to the agent in one tx; tier caps and the mandate are read from the registry every poll, nothing hard-coded." Show: Create (one tx), then Revoke → `NoMandate()` in the terminal → Restore. Friction to mention: admin bits can't be delegated, so the backend holds tier-admin at root and can never touch MANDATE; token ids regenerate on grant/revoke.

**1inch.** "Aqua router redeployed with one extra SwapVM instruction, 0x2f MandateGate, placed before XYCSwap in the strategy program. It reads `Vault.mandate()` and trims the USDC leg to the live cap; when USDC is the computed leg it solves the inverse of x·y=k. 26.6k gas per swap." Show: a trimmed row with its Etherscan link, then the refusal at zero. Commit history: ~150 commits over the event.

## Likely questions, with answers

**Product**
- *Why would I give an agent money at all?* You already do: any bot that maintains an Aqua position must hold ship/dock authority, and strategies are immutable, so someone runs a loop. Today that someone holds a key to the whole balance. Leash bounds it.
- *Isn't this just a spending limit?* A spending limit is static and enforced by the wallet. This one decays by itself, is renewed only by a verified human, and is enforced inside the swap so the counterparty can't take more than the cap either.
- *What can the agent never do?* Raise its cap, renew its clock, transfer the name, escalate roles, withdraw. Those are owner + human proof only.
- *Why can it always close?* Closing reduces risk. Safety needs no proof; growth does.
- *What happens to money mid-trade when the cap hits zero?* Nothing moves. Open positions stay on Aqua; the agent docks them back into the vault; the owner withdraws any time.

**World**
- *Why Selfie Check and not Orb?* The claim is presence now. Orb proves uniqueness, which we don't need for renewal; we enforce "same human" ourselves by binding the first nullifier to the vault.
- *Why is the demo on staging?* No credential on our test account; World ID App is beta-gated for Selfie on our phone; World's event note says mocked proofs are fine. Same request, bridge and server-verify path as production.
- *How do you stop replay?* Single-use `rp_context` nonces issued by our server, and one nullifier per vault.
- *Can two people renew the same vault?* No: 409 "this vault already has its human." The simulator has one identity, so that path is in the tests, not on stage.

**ENS**
- *Why ENS rather than a mapping in the vault?* The permission is public, revocable, readable by anyone, and dies with the name's expiry. `agent.leash.eth` having a MANDATE bit is legible to humans and other contracts.
- *What did ENSv2 make hard?* Token admin bits can't be delegated; token ids change on every grant/revoke; delegated (7702) EOAs break ERC1155 mints in tests.

**1inch**
- *Did you modify SwapVM?* No: the engine is stock; we override `_runOpcode` in a redeployed router to add 0x2f. Official contracts, allowed by the rules.
- *What if the pair has no USDC?* `CapTokenMissing`, the vault refuses to ship. The cap is denominated in USDC by design.
- *What does the taker see?* A partial fill (they must set `allowPartialFill`) or a revert at zero. Nothing about the human is exposed.
- *Gas?* 26.6k per swap for the gate, measured against the real ENSv2 registry.

**Security / honesty**
- *What isn't production-ready?* Demo clock 1440×; demo tokens with open mint; the backend holds root tier-admin on the registry (it can grant tiers, never MANDATE); the human binding is per vault in SQLite, not on chain.
- *What did you find while testing?* Three real bugs from rehearsals (one-vault-per-human primary key; vault not passed to the agent's subprocess; market resolving the wrong vault), all in NOTES.md with timestamps.
- *Is any of it hard-coded?* Tier caps, period, cutoff, agent, owner, balances: all read from chain. `policy.json` is the agent's, not ours.

**Wallets and safety on stage**
- If MetaMask says "Internal JSON-RPC error", you're on a delegated account. Switch to a DEMO account.
- If the World modal stays open after "Play the human", the server just redeployed; wait a minute, Cancel, Verify again.
- If the number is already 0 when you want to show trading, Verify again first. The 3-minute clock is the product, say so.
