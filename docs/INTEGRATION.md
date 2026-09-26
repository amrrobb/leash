# Integration — how the pieces connect

This is about the seams between ENSv2, World ID, 1inch Aqua/SwapVM, the backend and the page, as built and tested. Each rule here is backed by a test named in brackets.

## What changed from the pre-event plan

The pre-event plan (HANDOFF v0, the first SETUP/INTEGRATION drafts) was written before we read the contracts on the day. These parts turned out wrong.

| Pre-event plan | As built | Why |
|---|---|---|
| Register `agent` with admin bits, then grant the backend `ADMIN_*` on the token | The backend gets tier-admin at the **root** of Alice's registry via `grantRootRoles` | `PermissionedRegistry._getSettableRoles` strips admin bits on token resources, so token admin can never be delegated. Root roles are exempt, and `hasRoles` = root \| token [`test/fork/ENSAuthority.t.sol`] |
| Backend grants `ROLE_MANDATE \| tier` | Backend grants the **tier only**; only Alice grants or revokes MANDATE | Otherwise the backend could revive a mandate Alice revoked [`test_backendGrantsTierOnly`] |
| Program `FeeProtocol → MandateGate → XYCSwap → Salt` | `MandateGate → XYCSwap → Salt` | FeeProtocol-first is not a rule on swap-vm main; fees are optional |
| Gate args: 120 bytes `[registry][tokenId][mask][cap][clock]` | No args. The gate calls `Vault.mandate()` on the maker | One decay implementation, one ENS read, and no stale token id baked into a shipped strategy |
| Cap in the swapped token's units | Cap in USDC; the gate trims **only the USDC leg** (inverse x·y=k when USDC is the computed leg) | A 2,000 cap would otherwise clamp 2,000 HYPE-wei [`testFuzz_usdcLegNeverExceedsCap`] |
| Replay key = nullifier | Replay key = the `rp_context` **nonce** we signed (single-use, SQLite); nullifier bound to one Vault | A nullifier is fixed per (human, action), so rejecting it blocks Alice's own re-verification [`backend/test/flow.test.js`] |
| `credential_type` = `proof_of_human` / `document` / `selfie_check` | `responses[].identifier` = `proof_of_human` / `passport` / `mnc` / `selfie` | From IDKit 4.3.0's types. Still unconfirmed against a live proof |
| Verify at `developer.world.org` | `https://developer.worldcoin.org/api/v4/verify/{rp_id}` | The host IDKit 4.3.0's own README uses (override with `WORLD_VERIFY_URL`) |
| `preset(selfieCheck(...))` | `.constraints(any(proof_of_human, passport, mnc, selfie))` | World App offers whichever credential Alice has; the backend picks the tier |
| Vault `lastVerified()` is the opcode's clock | Vault `capNow()` / `mandate()` already apply decay and the 72h cutoff | Halving alone takes ~31 days to reach zero |
| `halfLifeSeconds` constructor arg | `speed` multiplier; 1,440 on the demo Vault | One 12s block = 4.8 h of decay; zero in ~3 min |
| Deploy Aqua, router and Vault in one forge script | `script/deploy.sh`: forge script, then `forge create` for the router | Creating the router inside a forge script breaks forge's constructor-argument decoding |
| Taker needs a callback contract | Plain EOA with `useTransferFromAndAquaPush` + `isFirstTransferFromTaker` | The router pulls from the taker and pushes into Aqua |
| Order tokens `tokenA = USDC` | `LeashOrder` sorts the pair | `MakerTraitsLib.build` requires `tokenA < tokenB`; on Sepolia HYPE sorts first [`MandateGateHypeFirstTest`] |

## 0. Addresses and roles

Live addresses are in `deployments/sepolia.json` (read by the backend, the scripts and the page). The role bits are defined once in Solidity (`Vault.sol`) and once in JS (`backend/src/world.js`, `frontend/app.js`):

| Role | Bit | Admin bit | Who holds it |
|---|---|---|---|
| MANDATE | `1 << 40` | `1 << 168` | agent (token) · Alice holds admin at root |
| ORB | `1 << 44` | `1 << 172` | agent (token), set by backend · backend + Alice hold admin at root |
| DOCUMENT | `1 << 48` | `1 << 176` | as ORB |
| SELFIE | `1 << 52` | `1 << 180` | as ORB |

Tier caps, in USDC: selfie 2,000 · document 7,500 · orb 15,000. The effective base is `min(ownerCap, tier cap)`.

## 1. ENS ← Alice (once) — `script/DeployLeash.s.sol`, `script/RegisterName.s.sol`

1. `VerifiableFactory.deployProxy(UserRegistryImpl, salt, initialize([Grant(alice, REGISTRAR | RENEW | (REGISTRAR | RENEW | MANDATE | ORB | DOCUMENT | SELFIE) << 128)]))`: this is Alice's own registry.
2. `register("agent", alice, 0, 0, 0, expiry)` means Alice owns the name. She passes no token roles, because root admin covers them.
3. `grantRoles(keccak256("agent"), MANDATE, agent)`.
4. `grantRootRoles((ORB | DOCUMENT | SELFIE) << 128, backend)`.
5. `leash.eth`: `ETHRegistrar.commit`, then wait at least 60 s, then `register(label, alice, secret, subregistry = Alice's registry, ...)`, paid in ENSv2 MockUSDC.

Checks: `ETHRegistry.getSubregistry("leash") == Alice's registry`; `roles(keccak256("agent"), agent)` has bit 40.

Every grant or revoke regenerates the token id. Role reads accept any version of the id, including `uint256(keccak256("agent"))`, which is what the Vault stores. Use `findTokenId` for ownership and transfer [`test_backendStillGrantsAfterIdChanges`].

## 2. Aqua + router + Vault — `script/deploy.sh`

```
Aqua()                                                         (or reuse AQUA)
Vault(owner=alice, agent, backend, aqua, ens=Alice's registry, capToken=USDC, "agent", speed)
MandateAquaRouter(aqua, weth=0, owner=alice, "Leash", "1")    (forge create)
```
The router is not a Vault constructor argument. It is passed per `ship()`, so it can change without redeploying the Vault.

Checks: `router.AQUA() == aqua`; `vault.mandate()` is `(true, 0, USDC)` before Alice sets a cap and anyone verifies.

## 3. World → backend → ENS + Vault (every verification) — `backend/src/flow.js`

```
page                         backend                                  chain
POST /api/rp-context  ───►  signRequest({action, signingKeyHex})
                            store nonce (single-use, expires)
                     ◄───   {app_id, action, environment, rp_context}
IDKit.request({...}).constraints(any(proof_of_human, passport, mnc, selfie))
QR from connectorURI · pollUntilCompletion()
POST /api/proof (completion.result, untouched)
                            1. protocol_version 4.0, action matches
                            2. consume nonce            → 409 if unknown/used/expired
                            3. POST verify/{rp_id}      → 400 if not success:true
                            4. strongest identifier     → 400 if none known
                            5. nullifier → this Vault   → 409 if bound elsewhere
                            6. grantRoles(labelId, tierBit, agent) ─────────►
                            7. vault.verify()                        ─────────►
                     ◄───   {tier, cap, txs}
```
Any failure before step 6 sends no transaction [`flow.test.js`, e2e "Portal rejection"]. A cancel in the page ignores any late answer and sends nothing [e2e "World cancel path"].

Then, in State A′, Alice sets `ownerCap` (`setCap`): that is the "Create mandate" step. Decay starts at `verify()`, not at `setCap`.

## 4. Agent → Vault → Aqua — `script/Agent.s.sol`

- `ship`: Vault checks `msg.sender == agent`, reads `roles(labelId, agent)` once, requires MANDATE and a cap above zero, approves Aqua, then calls `aqua.ship(router, abi.encode(order), tokens, amounts)`. The Aqua strategy hash equals SwapVM's `hash(order)` only with this encoding [`GateBase._ship`].
- `dock`: agent or owner, and never reads ENS. Closing works after revoke, decay or expiry [`test_dock_worksAfterRevokeAndDecay`, e2e "agent can still close"].
- Every re-ship needs a new `SALT`, because a docked strategy hash can never be shipped again.
- A strategy is a pair, two amounts and a program. The program is the same for every pair (`LeashOrder`: `MandateGate → XYCSwap → Salt`); the pair is anything the Vault holds **with a USDC leg**. `Vault.ship` rejects a token list without the cap token (`CapTokenMissing`), and the gate independently reverts `MandateTokenMissing` on any strategy that reaches it without one, so no position the Vault backs can escape the cap. Other curves (concentrated, pegged) would need their own inverse in the gate: see the trimming note above.

## 5. Taker → router → gate → Vault → ENS (every quote and swap) — `src/MandateGate.sol`

The gate runs inside `quote()` (static context) and `swap()`: `Vault.mandate()` → `(alive, cap, USDC)`.
- If not alive: `MandateRevoked`. If the cap is 0: `MandateEmpty`.
- Otherwise it trims the USDC leg to the cap. The taker needs `allowPartialFill = true`, or the trimmed fill reverts `TakerTraitsTakerAmountInMismatch`.

Cost: **26.6k gas per swap** cold against the real registry (119.5k vs 92.9k) [`test/fork/MandateGateENS.t.sol`].

## 6. Page ← backend (read side) — `backend/src/chain.js`, `frontend/app.js`

- `GET /api/state`: every read pinned to one block: `capNow`, `baseCap`, `ownerCap`, `lastVerified`, `speed`, `roles(labelId, agent)`. The page polls every 3 s and animates the number each second using the same curve as `Vault.limitAt`, on chain time.
- `GET /api/feed`: Vault events plus router `Swapped` for this maker. The ask is decoded from `swap(order, amount, ...)` calldata, so a trim reads "Asked 10,000 · allowed 1,967 USDC".
- `POST /api/demo/{set-cap,revoke,grant-mandate,withdraw}`: Alice's owner actions, signed with `DEMO_OWNER_KEY`. They answer on loopback only, or with the `x-demo-token` header.

## 7. Smoke test on real Sepolia

```bash
# 1. backend up with real World credentials and DEMO_OWNER_KEY
# 2. page → Verify with World → World App → A′ → Create mandate  => state shows cap > 0
# 3. agent ships
DEPLOYMENT=deployments/sepolia.json SALT=$(date +%s) ACTION=ship AGENT_KEY=$AGENT_KEY \
  forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
# 4. market asks 10,000 USDC => feed shows "Asked 10,000 · allowed ..."
DEPLOYMENT=deployments/sepolia.json SALT=<same> ACTION=trade TAKER_KEY=$TAKER_KEY AMOUNT=10000000000 \
  forge script script/Agent.s.sol --rpc-url $SEPOLIA_RPC --broadcast
# 5. wait ~3 min (speed 1440) => State C; a trade reverts MandateEmpty; ACTION=dock still succeeds
# 6. Verify again => back to B
```

## Failure map

| Symptom | Seam | Fix |
|---|---|---|
| `EACCannotGrantRoles` when the backend grants a tier | backend lacks root tier-admin | Alice: `grantRootRoles((ORB\|DOCUMENT\|SELFIE) << 128, backend)` |
| Tier granted but cap stays 0 | tier granted at root, not on the token | `grantRoles(labelId, tier, agent)`; `roles()` excludes root |
| `/api/proof` 409 "nonce" | proof from an old QR, or a restarted DB | New `rp_context`; nonces are single-use |
| `/api/proof` 409 "another Vault" | same human, new Vault, old DB | One DB per Vault address is the default; check `DB_PATH` |
| `/api/proof` 400 on the first real proof | identifier or field names differ from IDKit's types | Read the `proof rejected ...` log line (the result's shape, no secrets) |
| ship reverts `MakerTraitsTokensNotSorted` | USDC placed first while HYPE sorts lower | Build orders with `LeashOrder` |
| Trimmed swap reverts `TakerTraitsTakerAmountInMismatch` | taker traits | `allowPartialFill = true` |
| ERC1155 mint reverts on register | owner address has code (7702-delegated test key) | Fresh key, or a delegate that accepts ERC1155 |
| Anvil fork dies with "historical state not available" | non-archive RPC | Alchemy / Tenderly, not publicnode |
