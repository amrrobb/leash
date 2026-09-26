# World ID in Leash: the trust moment, the credential, the debrief

## The trust moment

An AI agent holds a mandate over a human's money on 1inch Aqua. The mandate halves every 24 hours and reaches zero after 72. The one event that can push it back up is **a verified human, the vault's own human, showing up**. That event is the trust moment: if the agent, or anyone else, could renew the clock, decay would be theatre.

So the question World ID has to answer for us is narrow: *is a live human, the same one as before, present right now?* Not "is this a good person", not "is this a unique human on Earth".

## Why Selfie Check is the minimum sufficient assurance

- **Presence, not reputation.** Renewal is about *now*. Selfie Check (liveness) proves a live face at the moment of the request, which is exactly the claim. Proof of Human (Orb) proves global uniqueness, a stronger and unrelated fact.
- **Same human, not unique human.** "The same one as before" is enforced by us, not by the credential: the first verified nullifier becomes the vault's human and only that nullifier can renew it (`backend/src/store.js`, `vault_humans`). A second person's proof is refused with 409. That lets a cheap credential do the job that a global-uniqueness credential would otherwise be asked to do.
- **Proportionate to exposure.** The credential sets the *ceiling* of authority, not a yes/no: Selfie Check 2,000 USDC, Passport/NFC 7,500, Orb 15,000, and the owner can only lower it. A stronger credential is not required; it is what you would bring if you wanted the agent to run more money, the same way a bank asks for more when the amount goes up. The cap values are read from the Vault contract, not the page.
- **Fail paths are the product.** Cancel, decline, an ineligible (second) human, a rejected proof, and expiry (the 72-hour decay) all leave the protected action, `Vault.ship`, blocked. The agent can still `dock` (close positions) at zero: safety never needs a proof, only growth does.

## What is verified where

- The page builds the request with IDKit v4 and a server-signed `rp_context` (`POST /api/rp-context`, single-use nonce).
- The completion result goes to the server, which forwards it untouched to `POST /api/v4/verify/{rp_id}` (`backend/src/world.js`). Only then does the backend grant the tier role on `<name>.leash.eth` and stamp `Vault.verify()`.
- Nothing about the proof is trusted client-side; the client never sees the signing key or the staging token.

## Debrief

**Time to first success:** about 5 hours from reading the docs to the first portal-verified proof (Developer Portal MCP for setup, real IDKit in the page, World's simulator as the human). Most of that was staging semantics, not the API.

**Friction encountered, in order of cost**
1. **Constraint requests cannot fall back to World ID 3.0.** With `allow_legacy_proofs: true`, a `.constraints(any(...))` request still returns `world_id_4_not_available` on a 3.0 phone; only the *presets* carry a legacy fallback, and a preset is one credential. We learned this from idkit-core's source, not the docs. Fix on our side: ask with constraints first, and on `world_id_4_not_available` let the human pick one credential and ask again with that preset.
2. **The simulator's rules are undocumented.** It completes only a single `proof_of_human` request (not `any`), and it refuses any request that permits legacy proofs with `staging_required`. Two nights' worth of "why" for two one-line rules.
3. **`world_id_4_not_available` reads like a version problem.** On our test phone (World App 4.0.4100) it meant "no credential at all"; "Get verified" offered only Orb, so no Selfie Check was possible for us. The error should say what is missing.
4. **Selfie Check legacy is a preview.** `selfieCheckLegacy()` is marked "contact us"; on our phone the selfie flow ran and then nothing came back. The page waited 7 minutes.
5. **Nullifier semantics in 4.0.** The docs say nullifiers are one-time-use and `session_id` is the stable link; for our "same human as before" check we bind the nullifier from the standard uniqueness proof and it has been stable across the simulator's proofs. A worked example of "recognise a returning user" without Session Proofs would remove the doubt.

**Missing capability or documentation:** a way to obtain a Selfie Check credential on a test account without an Orb, and a page that states, per request shape, which World ID versions can answer it.

**The one improvement with the greatest impact:** make the constraint request degrade to a legacy preset automatically (or document that it cannot), so a 3.0 phone never dead-ends on a 4.0 app.

**What worked well:** `rp_context` signing, the v4 verify endpoint, the Developer Portal MCP (the whole app setup from a terminal), and the simulator once its two rules were known.

**Where the judges' demo runs:** the hosted app is in staging mode with World's simulator standing in for the phone, because no test account with a credential was available to us; the code path (IDKit request → bridge → server verify → role grant) is the production one. `agent/simulate-human.mjs` is the one-line stand-in.
