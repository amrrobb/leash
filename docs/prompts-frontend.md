# Frontend prompts — Leash

How to use: paste **Prompt 0** into Claude Design first to lock the style, then one prompt per screen. For a visual reference, paste **Prompt R** into ChatGPT, save the image, and attach it with Prompt 0.

---

## Prompt R — reference image (ChatGPT)

```
Create a UI mood reference for a financial web app called "Leash".
Concept: a human gives an AI agent limited permission to manage their money; the permission shrinks by itself over time and is restored when the human verifies they are present.
Show one desktop dashboard screen, 16:9. Warm off-white background (#F5F3ED), deep green primary (#0E5A4C), one large tabular number as the focal point, a thin horizontal progress bar, and a short activity list below. Calm, precise, like a modern bank or a trust instrument. Humanist sans-serif, generous whitespace, no gradients, no neon, no red, no shields, no locks, no robots, no crypto icons. Photorealistic UI render, no text that needs to be readable.
```

---

## Prompt 0 — global style (paste first)

```
We are designing "Leash": a one-page web app where a human grants an AI agent permission to manage their on-chain position, and that permission shrinks on its own unless the human keeps verifying they are present.

Design system:
- Background #F5F3ED, surfaces #FFFFFF, border #E3DFD4, text #16150F, muted text #5B5A52
- Primary #0E5A4C (deep green). Warning tint #F8EEDC / #6B3F0A (ochre) for "trimmed". Neutral grey #ECEAE3 / #3F3E38 for "paused". Never red.
- Type: IBM Plex Sans for UI, IBM Plex Mono for every number (tabular). 
- Radius 10–16px, 1px borders, no shadows, no gradients.
- Tone: calm, financial, factual. No shields, locks, alarms, robots, or crypto iconography.

Product rules that must be visible in the UI:
1. The agent can ALWAYS close positions. It can only OPEN new ones while authority is alive. Show this asymmetry explicitly.
2. What gets trimmed is a market trade against the human's position, not an action by the agent. Copy: "a trade asked for 10,000 · 3,200 filled".
3. The human's funds sit in their own vault; only they can withdraw. The agent holds permission, not money.
4. The credential the human verifies with sets how much authority comes back: Selfie Check (Beta, small), Passport (medium), Orb (full).

Desktop 1280×900. Single page, no navigation. Three states: no mandate, mandate alive, mandate revoked/empty.
```

---

## Prompt 1 — State A: no mandate yet

```
Design State A of Leash: the human has no mandate yet.

Layout: nearly empty page. Small "Leash" wordmark top-left, wallet chip top-right (alice.eth · Sepolia). One centered card, max 520px wide.

Card content:
- Headline (28px): "Give your agent permission that shrinks on its own."
- One sentence: "Your funds stay in your vault. The agent gets a leash, and the leash shortens every hour you're away."
- Primary button: "Verify with World" (opens a QR modal — design the modal too: QR placeholder, "Scan with World App", and a Cancel link).
- Under the button, three small rows explaining the tiers, each with a name, a one-line note, and the authority it grants: Selfie Check · Beta, liveness only · 2,000 USDC / Passport · document-backed · 7,500 USDC / Orb · highest assurance · 15,000 USDC.

Also design the cancelled path: after Cancel, the card shows a quiet inline line "Verification cancelled. Nothing was granted." with the button available again. No error styling.
```

---

## Prompt 2 — State A′: grant the mandate (after verification)

```
Design the step right after a successful World verification, still on the same page.

The centered card now shows:
- Top: a pill "Verified · Orb" in green tint, with "Authority up to 15,000 USDC" next to it (the number comes from the tier and cannot be edited upward).
- Form, three fields: Agent name (text, e.g. "agent" → preview "agent.alice.eth" in mono), Pair (select, HYPE/USDT), Starting authority (mono number input, prefilled with the tier cap, max = cap, can be lowered).
- A small read-only block: "Halves every 24 hours unless you return · Reaches zero in ~3 days".
- Primary button: "Create mandate". Below it, a mono line describing what will happen: "2 transactions · grant role on ENS · stamp vault clock".
- After clicking: a progress state with the two transactions as a checklist, then transition to the dashboard.
```

---

## Prompt 3 — State B: mandate alive (the main screen)

```
Design State B, the dashboard. This is the screen judges will see for 90 seconds, and one number on it must feel alive.

Top bar: wordmark, "Sepolia", wallet chip.

Left card (760px wide):
- Label "Authority remaining" + status pill on the right (Operating / Trimming trades / Close-only).
- Hero number in IBM Plex Mono, 84px, tabular: e.g. 11,432 with "USDC" beside it. This number decreases in real time.
- Thin bar under it (green → ochre when low → grey when empty), caption left "The market can trade against you up to this much", caption right "of 15,000 granted".
- Three stats: Last verified (e.g. "6h ago · via Orb"), Halves every (24 hours · unless you return), Reaches zero (in ~2d 4h · if nobody verifies).
- Buttons: "Verify again" (primary), "Revoke" (secondary, quiet). Optional presenter control "Pause clock".

Right card (remaining width):
- Title "Mandate", agent name in mono "agent.alice.eth", one line "Runs your HYPE/USDT position on 1inch Aqua".
- Three rows with a right-aligned value: Close positions → "Always" (green) / Open new ranges → "Allowed" or "Paused" / Largest trade the market can take → "Up to 11,432".
- Footer note: "Your funds sit in your own vault. The agent holds permission, not money, and only you can withdraw."

Bottom card (full width): "What happened", newest first, 5 rows. Each row: time, title + detail, right pill. Examples:
- "Market trade on HYPE/USDT · asked 10,000 · 3,200 filled" → pill "Trimmed" (ochre)
- "Market trade on HYPE/USDT · 4,000 filled in full" → "Filled" (green)
- "Agent tried to open a new range · authority is empty" → "Paused" (grey)
- "Agent closed the position · docked, funds never left your vault" → "Closed" (grey)
- "You verified with Orb · authority set to 15,000" → "Verified" (green)

Also design the "Verify again" panel that replaces the left card: headline "Show you're still here", one line "The credential you use sets how much authority the agent gets back. The clock pauses while you choose.", three selectable tier rows, Cancel link.
```

---

## Prompt 4 — State C: revoked or empty

```
Design State C: authority is zero, either because it decayed to nothing or because the human pressed Revoke.

Same dashboard layout as State B, with these differences:
- Hero number reads 0, bar is grey and empty, status pill "Close-only" in grey.
- Caption under the bar: "The agent can close positions, nothing else."
- Right card: Open new ranges → "Paused" (grey); Close positions → "Always" stays green — this contrast is the point.
- Feed shows the agent closing its position on its own.
- If revoked by the human: a quiet inline line above the buttons "You revoked the mandate. The agent can still close, and can't open." If decayed: "Nobody verified for 3 days. Authority reached zero."
- "Verify again" remains the primary action so the human can bring it back. Add a secondary "Withdraw to wallet".

No alarm styling. This is a safe state, not an error.
```

---

## Prompt 5 — presenter overlay (optional, do last)

```
Design a tiny presenter-only overlay for demos, bottom-right, 240px wide, collapsible: demo clock speed (1s = 4h), Pause/Resume, and a "Trigger market trade" button that injects a trimmed trade into the feed. Muted styling so it reads as a tool, not part of the product. Must be hideable with one click.
```
