# Roadmap to demo-complete

Ordered. One item at a time; each is ticked only when its tests pass and it is pushed.

- [x] 1. Vault edge-case unit tests: fuzz limitAt monotonicity and bounds, multi-strategy dock bookkeeping, events, approvals reused across ships, withdraw while shipped
- [x] 2. Phase 4: MandateGate (Opcode._2f, reads IVault(maker).capNow(), trims only the capToken leg) + MandateAquaRouter; unit tests with real Aqua + swap-vm; size under 24,576 B; fork test on real ENSv2
- [x] 3. Phase 3: Node 22 backend (viem, SQLite nullifiers, IDKit v4 signRequest, /rp-context, /proof → World v4 verify, credential_type → tier, grantRoles + vault.verify); env-configured World credentials; node tests with World stubbed at fetch
- [x] 4. Frontend: index.html + one JS file served by the backend; State B (Main.dc.html), then A′, A, C; live chain state
- [x] 5. Playwright e2e on an Anvil fork: all four states, World cancel path, revoke, C → B recovery
- [x] 6. Agent script: ship and dock through the Vault
- [x] 7. README update

## Blocked (needs the user)
- World app_id / rp_id / signing key (phase 3 runs on env placeholders until then)
- More Sepolia ETH before any further real broadcast (deployer ~0.0058 ETH)
- 1inch mentor answer: Vault as Aqua maker
- Sepolia redeploy (needs ETH): the deployed Vault predates `mandate()`, so MandateAquaRouter cannot gate it; redeploy Vault + router together (~0.006 ETH at 1 gwei)
