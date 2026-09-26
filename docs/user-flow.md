# User flow — one page, six states

```
Connect ──► Create your vault ──► A  Verify ──► A′ Fund + set the leash ──► B  Dashboard
 (any        (name + agent;        │ cancel                                  │ time
  wallet)     ERC-8004 badge)      └──► back to A (nothing granted)          ▼
                                                                       B  Trimming (ochre)
   Revoke (from B) ────────────────────────────────────────────────►   │ ~3 days no human
                                                                       ▼
   Verify again (any state after A) ◄──────────────────────────────   C  Close-only (zero)
        │ any tier                                                     │
        └──► B, cap restored                                           └──► Withdraw (owner only)
```

Who does what
- **Owner (the connected wallet)**: creates the vault, verifies, funds it, sets the cap, revokes, restores, withdraws. Every one of these is signed by the owner's own wallet; the backend only builds calldata.
- **Agent (any address)**: `ship` and `dock`. It picks the pair and the sizes from its own policy; the vault never stores a pair. The demo agent (`agent/loop.mjs`) runs HYPE/USDC because those are the demo tokens on Sepolia; `policy.pairs` can list any pair that includes USDC.
- **Backend**: after World says yes, grants the tier bit and stamps the clock. It can never touch the MANDATE bit.
- **Visitor**: any other wallet, or no wallet, sees the vault read-only and can scan the QR to be refused (one human per vault).

Funding
- The vault is an address; send it any ERC-20. USDC is required: the cap is denominated in it and `ship` refuses a pair without it (`CapTokenMissing`).
- On Sepolia the tokens are demo tokens with an open `mint`; "Add demo USDC + HYPE" mints straight into the vault. On mainnet this is a plain transfer from the owner's wallet.
- There is no token picker: a picker would be a fake control. The vault holds whatever is sent; the agent decides what it trades.

Rules
- No navigation. Connect → Create → A → A′ → B is one card morphing. B / Trimming / C share one layout with different values.
- A′: cap input is prefilled from the credential tier and can only be lowered. `baseCap = min(ownerCap, tier cap)`.
- C is not an error: grey, not red. "Close positions → Always" stays emphasised.
- Paths judges ask for: cancel (World denied path), revoke (human control), C → B (recovery), a stranger's wallet (read-only), a stranger's World ID (refused), the attack script (six refusals). All are in `e2e/tests/journey.spec.js`.

Demo staging: terminal on one side (`agent/loop.mjs` + `agent/market.mjs`), dashboard on the other. The agent being outside the page is the point: any agent, bounded by the same contracts.
