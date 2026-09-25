# NOTES — integration log (becomes the World debrief and 1inch/ENS feedback)

Log as you go: timestamp · sponsor · what you tried · what broke · how long it cost · what doc was missing.

## World
- 

## ENS
- 2026-09-26 04:00 JST · delegation · Plan was: Alice grants the backend tier-admin bits on the `agent` token. Impossible: `PermissionedRegistry._getSettableRoles` returns `roleBitmap >> 128` for token resources, so token admin bits exist only if passed at `register()` and can never be delegated. Root roles are exempt and `hasRoles` = root | token, so the backend gets `(ORB|DOCUMENT|SELFIE) << 128` at ROOT via `grantRootRoles`. It can set tiers on any name in Alice's registry but can never grant or revoke MANDATE. Proven on fork (test/fork/ENSAuthority.t.sol). Cost ~30 min reading source; not in any doc we found.
- 2026-09-26 04:00 JST · reads · `roles(anyId, account)` returns token roles only (root excluded); `hasRoles` includes root. `uint256(keccak256(label))` (version bits zero) is a valid anyId for both, so a contract can skip `findTokenId`. Every grant/revoke regenerates the token id (burn + mint, `tokenVersionId++`).
- 2026-09-26 04:00 JST · gas (cold, fork) · roles() 29.6k · hasRoles() 32.1k · findTokenId() 16.0k.
- 2026-09-26 04:00 JST · test trap · `makeAddr("alice")` on a Sepolia fork has an EIP-7702 delegation (`0xef0100...`), so the ERC1155 mint's `onERC1155Received` reverts. Use unique labels (`leash.alice`).

## 1inch
- 2026-09-26 06:00 JST · program order · HANDOFF/CLAUDE said "FeeProtocol must be the first instruction". Not true on swap-vm main @ feb1641: FeeProtocol is optional, docs/PROGRAMS.md only says fee placement is security-critical. Leash program: MandateGate -> XYCSwap -> Salt (no fee). Removed the rule.
- 2026-09-26 06:00 JST · computed-leg trimming · the gate runs before XYCSwap, so when the cap token is the leg the curve computes (exact-in selling HYPE for USDC, or exact-out buying HYPE with USDC) it trims the taker's leg with the inverse of x*y=k. Couples the gate to XYCSwap; documented in MandateGate.sol. Fuzzed: the USDC leg never exceeds capNow().
- 2026-09-26 06:00 JST · Aqua strategy = abi.encode(order); Aqua's keccak256(strategy) equals SwapVM `hash(order)` only in that encoding. Asserted in GateBase._ship.
- 2026-09-26 06:05 JST · MandateAquaRouter 22,493 B (margin 2,083). Gate overhead: 26.6k gas per swap cold on real ENSv2 (119.5k vs 92.9k), 4.6k warm with a mock registry.
- 2026-09-26 02:40 JST · setup · swap-vm `main` @ feb1641 pulls Aqua as an npm dep (`@1inch/aqua` github#v1.0.0), not a submodule. Adding 1inch/aqua separately would give two copies. Fix: `cd lib/swap-vm && yarn install --frozen-lockfile --production --ignore-scripts`, remap to `lib/swap-vm/node_modules/*`. Cost ~5 min.
- 2026-09-26 02:45 JST · size · AquaSwapVMRouter is 21,981 B on main @ feb1641 (v0 measured 20,858 B on an older main). Margin 2,595 B; MandateGate (+455 B in v0) still fits, ~2.1 KB left. Re-check on every pull.
- 2026-09-26 02:45 JST · Aqua semantics · `pull()` does `safeTransferFrom(maker, ...)` from Aqua, so a contract maker must `approve(aqua)`. `strategyHash = keccak256(strategy)`, and a docked hash can never be re-shipped (StrategiesMustBeImmutable), so every re-ship needs a fresh `Salt`. `dock()` needs the full token list, not just the hash.

## Decisions
- 2026-09-26 · deps · swap-vm as git submodule (branch main); Aqua + OZ + forge-std via swap-vm's own node_modules. Root foundry.toml mirrors swap-vm (0.8.30, via_ir, 700 runs) with `lib/swap-vm/` prefixed remappings; `test = "test"` so swap-vm's slow suite never compiles.
- 2026-09-26 · Vault decay · kept halve-per-24h + linear interpolation, added hard zero at elapsed >= 72h (plain halving takes ~31 days to reach 0 on 2000e6). Side effect: a cliff from ~base/8 to 0 at 72h (selfie: ~250 USDC -> 0). UI should show it as "leash runs out", not a smooth slope.
- 2026-09-26 · Vault demo clock · immutable `speed` multiplies elapsed; 1 in tests, 14_400 on the demo Vault (1s = 4h, State C after 18s).
- 2026-09-26 · Vault baseCap · USDC 6-dec units; highest tier bit the agent holds (orb 15k > document 7.5k > selfie 2k), then min with owner-set `ownerCap`. `ownerCap == 0` means no mandate yet (State A). Cap stays 0 until the first `verify()`.
- 2026-09-26 · Vault dock · reads no ENS state, stores app + token list per strategy hash (Aqua.dock needs both). App passed per ship, so MandateAquaRouter can replace the stock router without a Vault redeploy.
- 2026-09-26 · Vault gas (MockEAC, real Aqua) · ship 256,602 (first ship: 2 cold approvals + position storage) · dock 48,329 · verify 44,933 · capNow 20,374. Real ENSv2 hasRoles ~24.4k each and baseCap does up to 3 + findTokenId, so expect ship +~75-100k on Sepolia. Re-measure on the fork in phase 2.
- RESOLVED (speed = 1_440) · demo speed vs 12s blocks · contract only sees block.timestamp; at speed 14_400 one Sepolia block = 48h of decay, so the cap goes base -> base/4 -> 0 in two blocks. Demo steps 2-5 have no runway. Needs a speed choice (720-1440 gives 3-6 min to zero) before the demo Vault deploy.
- PARTLY RESOLVED (Vault.capToken added; gate logic in phase 4) · phase 4 units · capNow() is USDC 6-dec, but MandateGate trims amountIn/amountOut in the swap token's units (CATATAN #6). Gate must clamp the USDC leg only; Vault may need an immutable capToken. Decide before the router.
- 2026-09-26 · ENS · IEAC `findTokenId(string)` matches v0's compile against contracts-v2 PermissionedRegistry. Still re-check against the 15 Sep Sepolia deployment in phase 2.
- 2026-09-26 04:20 JST · Vault gas on real ENSv2 (fork) · switched to one `roles(labelId, agent)` read: ship 256,420 (same as mock) · capNow 33,422 cold. capNow is the per-swap cost MandateGate will add in phase 4 (v0 measured 25.7k with a bare hasRoles).
- 2026-09-26 04:40 JST · infra · publicnode Sepolia is not an archive node: an Anvil fork started at head fails within minutes with "historical state ... is not available". Tenderly's public gateway (`https://sepolia.gateway.tenderly.co`) served code and storage 2,000 blocks back; using it as SEPOLIA_RPC. Still one operator; get a QuickNode key for the demo deploy.
- 2026-09-26 04:45 JST · deploy dry run · `script/DeployLeash.s.sol` on an Anvil fork (Tenderly): registry, agent name, MANDATE grant, backend tier-admin, Aqua, Vault all succeed. Drove the flow: capNow 0 → setCap + backend SELFIE + verify → 2,000 USDC → 4 blocks later 1,183 USDC; backend grant of MANDATE reverts.
- 2026-09-26 · deploy trap · Alice's address must have no code: ERC1155 mint calls `onERC1155Received` on contracts and 7702-delegated EOAs. Use a fresh key, not an Anvil default or a well-known test key.
- 2026-09-26 05:10 JST · Sepolia deploy · DeployLeash + RegisterName broadcast from the Envoyage deployer (EIP-7702-delegated EOA; its delegate accepts ERC1155, confirmed by fork simulation first). leash.eth registered to Alice, subregistry = her UserRegistry; agent holds MANDATE; backend holds root tier-admin (read back on-chain). Cost ~0.0040 ETH total; deployer has ~0.0058 left. Addresses in deployments/sepolia.json.

