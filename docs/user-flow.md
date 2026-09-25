# User flow — one page, four states

```
A  No mandate ──► Verify modal ──► A′ Create mandate ──► B  Dashboard
                    │ cancel                              │ time
                    └──► back to A (nothing granted)      ▼
                                                    B  Trimming (ochre)
   Revoke (from B) ──────────────────────────────►  │ ~3 days no human
                                                    ▼
   Verify again (any state after A) ◄────────────  C  Close-only (zero)
        │ any tier                                  │
        └──► B, cap restored                        └──► Withdraw (owner only)
```

Rules
- No navigation. A → A′ → B is one card morphing. B / Trimming / C share one layout with different values.
- A′: cap input is prefilled from credential tier and can only be lowered.
- C is not an error: grey, not red. "Close positions → Always" stays emphasised.
- Paths judges ask for: cancel (World denied path), revoke (human control), C → B (recovery). Show cancel and C → B in the video.

Build order for frontend: B first (can't be faked), then A′, then A and C.
Wireframes: ../reference/design/Flow.dc.html, WF-A, WF-A2, WF-C. Hi-fi dashboard: Main.dc.html.
