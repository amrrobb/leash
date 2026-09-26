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
- ~~World credentials~~ done: app + RP + action via the portal MCP; first real proof (simulator, staging) passed end to end on Sepolia 2026-09-26
- More Sepolia ETH before any further real broadcast (deployer ~0.0058 ETH)
- 1inch mentor answer: Vault as Aqua maker
- ~~Sepolia redeploy~~ done 2026-09-26: Vault v2 + router live, agent/backend/taker funded from Alice.
- ~~First real World proof~~ done: identifier `proof_of_human`, nonce 66-char hex, matches the e2e fake. Still untested: a real phone (production) with Selfie Check / passport.
- Timing on real Sepolia (measured 2026-09-26): verify → B took 24 s, B first showed 11,928 of 15,000 (orb tier); the 10,000 trade landed 60 s after verify and was trimmed to 7,500; C at 182 s. Decide: accept (recommended), lower SPEED, or stamp at Create mandate.
