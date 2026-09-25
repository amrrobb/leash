# Leash — hacking handoff

> Permission for an AI agent that shrinks on its own unless a verified human keeps showing up.

Event: ETHGlobal Tokyo, 25–27 Sep 2026. Solo. From Scratch track.
Targets: ENS "Best Use of ENSv2" $6k · World "Best Use of IDKit" $7.5k · 1inch "Build an Aqua App" $5k.

**Rule:** all code is written during the event. Pre-event exploration lives in `../leash-reference/v0-mandate/` — read it for facts, never copy it. Commit small and often from the first commit.

---

## 1. The story in 30 seconds

Alice holds tokens and wants an agent to manage her position on 1inch Aqua. Aqua strategies are immutable, so changing one means `dock()` then `ship()`. Whoever can `dock` can pull the whole virtual balance. The agent therefore needs permission, and that permission needs a limit that is alive.

The mandate is a role on Alice's ENS name plus a cap that **shrinks on its own** from the last time Alice proved herself with World. The agent can always close a position and can only open one while the permission is alive. Market trades against Alice's position are trimmed by a SwapVM opcode to whatever cap remains.

## 2. Architecture

```
Alice (one page) → World IDKit → Backend ──┬─ grantRoles → ENSv2 registry (Sepolia)
                                           └─ verify()   → Vault.lastVerified

Agent (script) → Vault.ship()/dock() → Aqua (Vault = maker, tokens held by Vault)
Taker (market) → Router+MandateGate (opcode 0x2f) → reads ENS + Vault.capNow() → trims amount
```

Written by us: **Vault.sol**, **MandateGate.sol** (library), **MandateAquaRouter.sol**, **backend** (Node), **frontend** (one page). Everything else already exists.

## 3. Contracts

### Vault.sol (done, phase 1)
- `owner`, `agent`, `backend`, `aqua`, `ens`, `capToken` (USDC), `speed` are immutable; `agentLabel` is stored.
- `labelId = uint256(keccak256(agentLabel))` is immutable. ENSv2 role reads accept any version of a label's id, so it never goes stale even though the token id regenerates on every grant/revoke. Every read is a single `ens.roles(labelId, agent)` (token roles only), which gives the mandate bit and the tier at once.
- `ship(app, strategy, tokens, amounts)`: only the `agent`; requires the MANDATE bit and `capNow() > 0`. Approves Aqua (Aqua pulls from the maker), calls `aqua.ship`, stores app + token list per strategy hash.
- `dock(strategyHash)`: agent or owner. Reads no ENS state, so closing works after revoke or decay.
- `withdraw(token, amount)`: owner only. `setCap(cap)`: owner only. `verify()`: backend only, stamps `lastVerified`.
- `baseCap()` = min(`ownerCap`, highest tier the agent holds: orb 15,000 · document 7,500 · selfie 2,000 USDC). `ownerCap == 0` means no mandate yet.
- `capNow()` = `limitAt(baseCap(), (now - lastVerified) * speed)`; zero if the mandate is revoked, the name expired, or never verified.
- Gas on real ENSv2 (fork): ship 256k · capNow 33.4k cold (the per-swap cost the gate adds).
- `limitAt`: `base >> (elapsed / 24h)`, then linear interpolation inside the period, **zero from 72h**. Without the cutoff, plain halving takes ~31 days to reach zero.
- `speed`: 1 in production, **1,440 on the demo Vault** (one 12s Sepolia block = 4.8h, zero in ~3 minutes).

Open question for the 1inch mentor: **is a contract (the Vault) acceptable as the Aqua maker?**

### MandateGate.sol — proven in v0 (8 tests + 5 tests with real ENS)
- Opcode slot `Opcode._2f` (free; 0x2e is used by Glasshouse).
- Reads `ctx.query.maker` (the Vault), `ctx.swap.amountIn/amountOut`, `ctx.query.isExactIn`.
- `require(hasRoles)` → `MandateRevoked`; `limit == 0` → `MandateEmpty`; otherwise trim the register.
- Read the limit from `IVault(maker).capNow()` so there is one decay implementation.
- **Units:** `capNow()` is in `capToken` (USDC) units. Trim only the USDC leg: `amountIn` if tokenIn is `capToken`, `amountOut` if tokenOut is `capToken`.
- Read-only; never write storage (`isStaticContext` is true during quotes).

### MandateAquaRouter.sol
```solidity
contract MandateAquaRouter is Simulator, SwapVM, AquaOpcodes {
  function _dispatch(Context memory c, uint256 op, bytes calldata a) internal override { _runOpcode(c, op, a); }
  function _runOpcode(Context memory c, uint256 op, bytes calldata a) internal override {
    if (op == MandateGate.opcode.asU8()) MandateGate.exec(c, a); else super._runOpcode(c, op, a);
  }
}
```
Use swap-vm **branch `main`** (API `_runOpcode`). Tag v1.0.2 uses an `_opcodes()` array — different.
Stock AquaSwapVMRouter on main @ feb1641: 21,981 B (limit 24,576). Run `forge build --sizes` on every build.

### Strategy program (order is mandatory)
`MandateGate` → `XYCSwap` → `Salt` (built and tested). The gate must sit right before `XYCSwap`. FeeProtocol is optional on swap-vm main; the earlier "must be first" note was wrong.

## 4. ENSv2 — verified facts

- Real registry: `PermissionedRegistry`; `hasRoles(anyId, bitmap, account)`.
- **Built pattern (proven on fork, `test/fork/ENSAuthority.t.sol`):** Alice deploys her own UserRegistry via VerifiableFactory with root grants `REGISTRAR | RENEW | (REGISTRAR | RENEW | MANDATE | ORB | DOCUMENT | SELFIE) << 128`. She registers `agent` to herself and grants MANDATE to the agent. She gives the backend `(ORB | DOCUMENT | SELFIE) << 128` at **root** via `grantRootRoles`.
- **Why root:** `PermissionedRegistry._getSettableRoles` returns only regular bits on token resources, so admin bits on a token exist only if passed at `register()` and can never be delegated. Root roles are exempt, and `hasRoles` = root | token.
- **Backend rule:** grant tiers on the **token** (`grantRoles(labelId, tier, agent)`), never with `grantRootRoles`. `roles()` excludes root, so a root-level tier reads as cap 0.
- **Trust:** the backend can set or remove tiers and can also revoke Alice's own root tier-admin; it can never grant or revoke MANDATE. If the name is given to the agent, Alice cannot revoke.
- `.eth` name: `leash.eth` (`alice` is taken) via ETHRegistrar commit → 60s → register, ~8 MockUSDC/yr, subregistry = Alice's UserRegistry. Proven on fork (`test/fork/EthName.t.sol`); **not yet registered on Sepolia.**
- Do not use the ENSv2 MockUSDC as the cap token: its `nuke(address)` lets anyone burn any balance. `DeployLeash` deploys its own `DemoToken`s.
- **tokenId changes** after grant/revoke (burn + mint). Use `findTokenId(label)` for ownership/transfer; role reads accept any id version, including `keccak256(label)`.
- Expiry removes all roles automatically (`eacVersionId + 1`). No extra check needed.
- Role bits: 40 mandate · 44 orb · 48 document · 52 selfie. No clash with RegistryRolesLib.
- Gas: `hasRoles` ≈ 24.4k; overhead per swap ≈ 25.7k (129k → 155k).
- Sepolia addresses (redeployed 15 Sep; re-check `deployments/sepolia/*.json` first):
  ETHRegistry `0x1bd29e26f09b4c68c623141673e5f0a5d02709f6` · UserRegistryImpl `0xb146a81b83ac63065aeafa16f25971f70176143e` · PermissionedResolverImpl `0x742b36ef4c9f0d8b9af99a1be555200e09d6ecc0` · MockUSDC `0xf9a8540590bc66a2b98692cd6d20f122d947c752`.
- Registration is paid in testnet USDC (mintable). The UserRegistry initializer takes a `Grant[]`.
- Alice needs her own UserRegistry (via VerifiableFactory) for `alice.eth`; the agent subname lives there.

## 5. World IDKit v4 — verified facts

Package `@worldcoin/idkit-core@4.3.0`. The API DIFFERS from older docs:
- Backend: `signRequest({action, signingKeyHex})` → `rp_context {rp_id, nonce, created_at, expires_at, signature}`. Pure JS.
- Frontend: `IDKit.request({app_id, action, rp_context, allow_legacy_proofs:false}).preset(selfieCheck({signal}))` → `connectorURI` (QR) → `pollUntilCompletion()`.
- Backend: `POST https://developer.world.org/api/v4/verify/{rp_id}` with `completion.result` **untouched** → `{success, nullifier, credential_type}`. (v0 notes used `developer.worldcoin.org`; confirm which host is live.)
- Store nullifiers in **SQLite/file**, not memory (replays pass after a restart otherwise).
- Tier → cap: selfie 2,000 · document 7,500 · orb 15,000. The real `credential_type` strings are **unconfirmed** — check in the sandbox.
- After verify: 2 tx — `registry.grantRoles(tokenId, tierBit, agent)` + `vault.verify()`.
- Selfie Check is Beta. Do not claim uniqueness.
- Required: official pilot/staging (mocks are not eligible), demo video, failure path, **integration debrief** (log friction as you go).

## 6. 36-hour plan

| Hours | Work | Cut point |
|---|---|---|
| 0–2 | repo, first commit, ask mentors (1inch: Vault as maker? ENS: addresses? World: rp_id/staging) | — |
| 2–8 | **Vault** + ship/dock to Aqua on an Anvil fork of Sepolia | fails → agent = EOA maker, Alice = plain LP (weaker) |
| 8–13 | ENS: Alice's UserRegistry, agent subname, grant/revoke, Vault reads hasRoles | fails → policy in Vault, ENS as publication only |
| 13–18 | World backend + 2 tx; UI state B (dashboard) | — |
| 18–22 | **Sleep** | cannot be cut |
| 22–28 | Router + opcode, deploy to Sepolia | not working by h28 → drop 1inch |
| 28–31 | UI states A and C, polish | — |
| 31–34 | submission + checklist | do not move |
| 34–36 | demo rehearsal ×3 | — |

Dev: `anvil --fork-url $SEPOLIA_RPC --chain-id 11155111`. Final: real Sepolia.

## 7. Submission checklist

- [ ] Public repo, live link, incremental commits, AI tool attribution + prompt/spec files
- [ ] 1inch: "Powered by SwapVM — © Degensoft Ltd 2025" · token transfer visible in the demo · official Aqua/SwapVM (redeploy allowed)
- [ ] ENS: Sepolia · ENSv2 is central · no hardcoding
- [ ] World: ≥1 credential · server-side verify · trust moment explained · success + failure paths · Beta mentioned · video · debrief

## 8. 90-second demo

Opener: *"Aqua strategies can't be edited, so someone has to keep closing and reopening them. Whoever does that holds the key to your money. We make that key shrink on its own when the human stops showing up."*

1. Alice verifies with World → cap appears by tier
2. Agent ships a position through the Vault
3. Cap visibly drops while you talk (demo Vault: one block = 4.8h, zero in ~3 min)
4. A market trade asks 10,000 → 3,200 fills
5. Cap hits zero → agent can't open, still closes
6. Alice re-verifies → cap restored

World failure path: Alice cancels at the QR → no tx, the cap keeps falling.

## 9. One-liners (memorise)

- vs Doca/Harbormaster: *the one running the loop isn't the owner, and its authority runs out.*
- vs the `Decay` opcode: *Decay shrinks what's offered; ours shrinks what's still allowed.*
- vs built-in guards: *guards say yes or no; ours says how much.*
- vs subfloor: *a signature can't be revoked; a live role can, and anyone can read it.*
- "Why World?": *without it the agent would renew its own permission.*

## 10. Traps already paid for

- solc: swap-vm 0.8.30 via-IR; ENS 0.8.25. They cannot share a compile — use an Anvil fork.
- Compiling the whole swap-vm test suite takes >20 min. This repo's `foundry.toml` points `test` at `test/` only.
- Trimming needs the taker's `allowPartialFill=true`, otherwise it reverts.
- Anvil dies when the shell closes: `setsid nohup anvil ... &`.
- Product wording in the UI: what gets trimmed is the **market trade**, not the agent's action.
- Aqua strategies are keyed by `keccak256(strategy)`; a docked hash can never be re-shipped, so every re-ship needs a fresh `Salt`.
