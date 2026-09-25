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
