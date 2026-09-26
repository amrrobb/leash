# Leash — UI spec for redesign

One-page web app. A human (Alice) gives an AI agent permission to run her 1inch Aqua position. The permission shrinks on its own and is restored only when she proves she is present with World ID. This document lists every screen, the exact copy, the data behind each element, and the rules, so a redesign can be dropped back into `frontend/index.html` + `frontend/app.js` without breaking the app or its tests.

## 0. Constraints that must survive the redesign

- One HTML file, one JS file, no framework. Fonts: **IBM Plex Sans** (UI) and **IBM Plex Mono** (every number, tabular figures).
- No navigation. States A → A′ → B are **one card that changes**. B, B-trimming and C share **one layout** with different values. C is grey, never red: it is a resting state, not an error.
- The elements below carry `data-testid` / `id` attributes that the JS writes into and the Playwright tests read. Keep them on the equivalent element in the new design (see the table in §8).
- Desktop first: designed at **1280 × 900**. One breakpoint at 1100 px stacks the two cards. Phone layout is a nice-to-have.
- The number in B/C animates every second on the client from chain time; the page polls the backend every 3 s. Transitions should tolerate values changing under them.

## 1. Design tokens (from the hi-fi design, keep unless the redesign replaces the whole system)

| Token | Value | Use |
|---|---|---|
| bg | `#F5F3ED` | page background |
| surface | `#FFFFFF` | cards |
| border | `#E3DFD4` | 1 px card borders |
| rule | `#EDEAE1` | dividers inside cards, bar track |
| text | `#16150F` | primary text |
| muted | `#5B5A52` | secondary text, eyebrows |
| accent | `#0E5A4C` | primary button, "Always", operating bar |
| accent-ink / accent-tint | `#0A4439` / `#E3EFEA` | green status pill (Operating, Verified, Filled) |
| trim-ink / trim-tint / trim-bar | `#6B3F0A` / `#F8EEDC` / `#B7791F` | ochre: Trimming fills, Trimmed |
| pause-ink / pause-tint / pause-bar | `#3F3E38` / `#ECEAE3` / `#C9C4B5` | grey: Close-only, Paused, Closed |
| radius | 16 px cards · 10–12 px buttons/inputs · 999 px pills | no shadows, no gradients |
| eyebrow | 13 px / 600 / letter-spacing 0.08em / uppercase / muted | section labels |
| big number | Mono 84 px / 500 / letter-spacing −0.04em | authority remaining |

Tone: calm, financial, factual. No shields, locks, alarms, robots, crypto icons. Never red.

## 2. Shared header (every state)

- Left: logo mark (a ring with a dotted lead to a dot: `frontend/brand/leash-logo-512-transparent.png`) + wordmark **Leash** (20 px / 600).
- Right: network label **Sepolia** (muted) and an owner pill **leash.eth** (`data-testid="owner-name"`).

## 3. State A — no mandate yet

Shown when the Vault has no cap set (`ownerCap == 0`) and this browser has not just completed a proof.

Single card, max width 760 px, centred left.

| Element | Copy / data | Hook |
|---|---|---|
| Headline (34 px / 600, two lines) | **Give your agent permission** / **that shrinks on its own.** | |
| Body (16 px muted) | Your funds stay in your vault. The agent gets a leash, and the leash shortens every hour you are away. | |
| Primary button | **Verify with World** | `data-testid="verify-with-world"` |
| Quiet line (hidden until a cancel) | Verification cancelled. Nothing was granted. | `data-testid="cancelled"` |
| Tier rows, read-only, three rows | Selfie Check — Beta · liveness, medium assurance — **2,000 USDC** / Passport (NFC) — Document-backed — **7,500 USDC** / Orb — Highest assurance · unique human — **15,000 USDC** | container `id="tier-rows"`, each row class `tier` |

Rules: no error colour after a cancel. The tier rows are information, not choices; the credential is picked inside World App.

## 4. World ID modal (opens from A "Verify with World" and from B/C "Verify again")

Centred dialog, 440 px, over a 35 % dark scrim. The clock keeps running underneath.

| Element | Copy / data | Hook |
|---|---|---|
| Eyebrow | WORLD ID | |
| Title (24 px) | **Scan with World App** | |
| QR (232 px box, white) | QR of the IDKit connector URI; shows "Preparing…" while the request is being signed | `data-testid="qr"`, attribute `data-uri` set when ready |
| Helper (muted) | Pick a credential in the app. It sets how much authority the agent gets. | |
| Link | Open in World App (same URI, for phones) | `id="vm-link"` |
| Error line (ochre ink, hidden by default) | e.g. "You declined in World App. Nothing was granted." / "World rejected the proof: …" / "World ID isn't configured on this server yet." | `data-testid="verify-error"` |
| Cancel (text button, underlined) | Cancel | `data-testid="verify-cancel"` |

Rules: Cancel closes the modal, ignores any late answer, sends nothing to the chain, and in State A reveals the quiet line. Success closes the modal and goes to A′ (first time) or straight back to B (renewal).

## 5. State A′ — create mandate (proof accepted, no cap yet)

Same card as A, content replaced.

| Element | Copy / data | Hook |
|---|---|---|
| Status chip (green) | **Verified · {tier name}** e.g. Verified · Selfie Check | `id="a2-verified"` |
| Headline (28 px) | **Authority up to {tier cap} USDC** | `id="a2-headline"` |
| Field: Agent name | `agent` (mono) → agent.leash.eth (muted) — read-only | |
| Field: Pair | HYPE / USDC — read-only in the demo | |
| Field: Starting authority | number input, prefilled with the tier cap, unit **USDC**, right hint **max {cap} · can only go down** | input `data-testid="starting-authority"`, hint `id="a2-max"` |
| Note (14 px) | Halves every 24 hours unless you return · Reaches zero in ~3 days | |
| Primary button | **Create mandate** | `data-testid="create-mandate"` |
| Progress list (replaces nothing; appears under the button after click) | ☑ Role granted on agent.leash.eth 0x7a3f… / ☑ Vault clock stamped 0x0d1b… / ☐ Starting authority set pending… → ☑ … 0x… | `data-testid="a2-steps"` |
| Error line | e.g. "Choose between 1 and 2,000 USDC. Authority can only go down from your credential's cap." | `id="a2-err"` |

Rules: the input cannot exceed the tier cap (validation message above, ochre ink, no red). The first two steps are already done when A′ appears (they happened during verification); the third is the owner's transaction. On success the card becomes the dashboard (State B). No separate success page.

## 6. Dashboard — State B (operating), B-trimming (ochre), State C (close-only, grey)

Two cards side by side (760 px + flexible), then a full-width activity card below.

### 6a. Authority card (left, 760 px)

| Element | Copy / data | Hook |
|---|---|---|
| Eyebrow | AUTHORITY REMAINING | |
| Status pill (dot + label) | Operating (green) · Trimming fills (ochre) · Close-only (grey) | `data-testid="status"`, label `id="status-label"` |
| Big number + unit | e.g. **7,500** USDC — the live decayed cap | `data-testid="authority"` |
| Progress bar (10 px, rounded) | fill = authority / granted; colour = accent / ochre / grey | `id="bar"` |
| Sub-line left | Operating: "The market can trade against you up to this much" · Trimming: "Large market trades are being cut down" · Close-only: "The agent can close positions, nothing else" | `id="status-text"` |
| Sub-line right | of **{granted}** granted (e.g. of 15,000 granted) | `id="cap-text"` |
| **Leash wave** (ASCII, 72 × 9 monospace, ~11 fps) | A rope from the human `()` on the left to the agent `@` on the right. Taut `=====` and still at full authority; sags and ripples `~ \ /` as authority decays (ochre); at zero it lies on the ground as `.....` with the agent at the far end (grey). Drop-in: `frontend/leash-wave.js`, `LeashWave.mount(pre, {ratio}).setRatio(x).setTone("ok"\|"trim"\|"pause")` | `data-testid="leash-wave"` (a `<pre>`) |
| Fact 1 | Last verified — **{Just now / 4h ago / 1d 14h ago / Never}** — via {tier name} | `id="last"`, `id="tier-name"` |
| Fact 2 | Halves every — **24 hours** — unless you return | static |
| Fact 3 | Reaches zero — **in ~2d 0h / Reached** — if nobody verifies | `data-testid="reaches-zero"` |
| C-only note (14 px, grey ink) | "Nobody verified for 3 days. Authority reached zero." or "You revoked the mandate." | `data-testid="c-note"` |
| Buttons | **Verify again** (primary; hidden when revoked) · **Revoke mandate** (ghost; hidden in C) · **Restore mandate** (primary; only when revoked) · **Withdraw to wallet** (ghost; only in C) | `verify-again`, `revoke`, `restore`, `withdraw` |
| Clock note (right, muted 13 px) | Demo clock: 1 second = 0.4 hours | `id="clock"` |
| Error line | e.g. "Could not read the chain: …" | `data-testid="dash-error"` |

State thresholds: Operating while authority ≥ 40 % of granted · Trimming fills below 40 % · Close-only at 0 (or when revoked).

### 6b. Mandate card (right)

| Element | Copy / data | Hook |
|---|---|---|
| Eyebrow | MANDATE | |
| Name (19 px / 600) | agent.leash.eth | `data-testid="agent-name"` |
| Description (muted) | Runs Alice's HYPE/USDC position on 1inch Aqua | |
| Permission row 1 | **Close positions** — Never decays — right: **Always** (accent, always emphasised) | `data-testid="close-perm"` |
| Permission row 2 | **Open new ranges** — Needs live authority — right: **Allowed** (accent) / **Paused** (grey) | `data-testid="open-perm"` |
| Permission row 3 | **Largest trade the market can take** — Larger trades get trimmed — right (mono): **Up to 7,500** / **None** | `data-testid="fill-limit"` |
| Footer note (bg-tinted box) | Your funds sit in your own vault. The agent holds permission, not money, and only you can withdraw. | |

The contrast "Close positions → Always" vs "Open new ranges → Paused" in State C is the whole point of the product; keep it visually loud.

### 6c. Activity card (full width)

| Element | Copy / data | Hook |
|---|---|---|
| Eyebrow + right label | WHAT THE AGENT DID · Newest first | |
| Rows (grid: time 128 px · text · pill 118 px, 50 px tall, divider between) | time `HH:MM:SS` (mono) · title (15 px / 500) + detail (13 px muted, mono numbers) · pill | container `data-testid="feed"`, rows class `feed-row` with `data-kind` |
| Empty state | Nothing yet. The agent's actions and market trades show up here. | class `feed-empty` |

Row kinds and their pills:

| kind | title | detail (example) | pill |
|---|---|---|---|
| you | You verified with World | Authority clock reset | Verified (green) |
| owner | You set the mandate / You withdrew | Authority up to 15,000 USDC / Back to your wallet | Owner (green) |
| full | Agent opened a range / Market trade on HYPE/USDC | Shipped to 1inch Aqua from your vault / 500 USDC filled in full | Filled (green) |
| trim | Market trade on HYPE/USDC | Asked 10,000 · allowed 7,500 USDC | Trimmed (ochre) |
| blocked | Agent tried to open a new range | Authority is empty · waiting for you | Paused (grey) |
| closed | Agent closed the position | Docked · funds never left your vault | Closed (grey) |

### 6d. Deposit (planned, not built yet)

Alice's funds enter the Vault by a plain token transfer to the Vault address. To make that visible:
- Mandate card gets a line **In your vault: 10,000 USDC · 1,000 HYPE** (live balances), hook `data-testid="vault-balances"`.
- State A′ gets a step **Deposit** before "Create mandate" (amounts per token, one transaction each), or a **Deposit** ghost button on the dashboard. In the demo the owner signer performs it; in production Alice's wallet does.
- Feed row kind `owner`: "You deposited" · "10,000 USDC into your vault".

## 7. Transitions

```
A ──Verify with World──► modal ──cancel/decline──► A (quiet line, nothing granted)
                                └──proof accepted──► A′ ──Create mandate──► B
B ──time──► B-trimming (ochre) ──~3 demo days──► C (grey, zero)
B/C ──Verify again + proof──► B (cap restored)
B ──Revoke mandate──► C ("You revoked the mandate.", Restore mandate shown)
C ──Restore mandate──► B/B-trimming (depends on time since last proof)
C ──Withdraw to wallet──► C (funds leave the vault; feed shows "You withdrew")
```

Paths judges are told to look for: cancel (World failure path), revoke (human control), C → B (recovery). All three must be visible and calm.

## 8. Hooks the code depends on (keep on the equivalent element)

`data-testid`: owner-name, state-a, verify-with-world, cancelled, state-a2, starting-authority, create-mandate, a2-steps, verify-modal, qr, verify-error, verify-cancel, dashboard, status, authority, reaches-zero, c-note, verify-again, revoke, restore, withdraw, dash-error, agent-name, close-perm, open-perm, fill-limit, feed.

`id` written by the JS: status-label, status-text, cap-text, bar, last, tier-name, zero, open-text, fill-text, clock, tier-rows, a2-verified, a2-headline, a2-max, a2-err, a2-cap, vm-link, vm-text, vm-err, qr, feed.

Sections toggled with the `hidden` attribute: `#state-a`, `#state-a2`, `#dashboard`, `#verify-modal`. Body gets `data-screen` (A / A2 / BC) and `data-state` (B / B-trim / C) for styling hooks.

Classes used by the JS for tones: `tone-ok`, `tone-trim`, `tone-pause` on the status pill and feed pills; `feed-row`, `feed-empty`, `tier`.

## 9. Copy that must not change (product claims)

- "Close positions — Never decays — Always"
- "Open new ranges — Needs live authority"
- "Your funds sit in your own vault. The agent holds permission, not money, and only you can withdraw."
- "Verification cancelled. Nothing was granted."
- Selfie Check is labelled **Beta**; never claim uniqueness from it.
- What gets trimmed is the **market trade**, never the agent's own action.
