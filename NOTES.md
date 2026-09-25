# NOTES — integration log (becomes the World debrief and 1inch/ENS feedback)

Log as you go: timestamp · sponsor · what you tried · what broke · how long it cost · what doc was missing.

## World
- 

## ENS
- 

## 1inch
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
- OPEN · demo speed vs 12s blocks · contract only sees block.timestamp; at speed 14_400 one Sepolia block = 48h of decay, so the cap goes base -> base/4 -> 0 in two blocks. Demo steps 2-5 have no runway. Needs a speed choice (720-1440 gives 3-6 min to zero) before the demo Vault deploy.
- OPEN · phase 4 units · capNow() is USDC 6-dec, but MandateGate trims amountIn/amountOut in the swap token's units (CATATAN #6). Gate must clamp the USDC leg only; Vault may need an immutable capToken. Decide before the router.
- 2026-09-26 · ENS · IEAC `findTokenId(string)` matches v0's compile against contracts-v2 PermissionedRegistry. Still re-check against the 15 Sep Sepolia deployment in phase 2.

