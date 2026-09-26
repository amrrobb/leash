# Market and competitive landscape (researched 26 Sep 2026)

## The category

"Give software bounded authority over a wallet" became a product category in 2026. Everyone converged on the same three primitives: **a spend limit**, **an allowlist**, and **an expiry**. Nobody ships **decay**, and nobody ties renewal to **proof of a present human**.

| Product | What it bounds | Who renews | Where it's enforced | Readable by anyone? |
|---|---|---|---|---|
| **MetaMask Advanced Permissions / Delegation Toolkit (ERC-7715)** | value per period, target contract, expiry ("10 USDC/day for 30 days") | the dapp asks again; the user re-signs | the smart account's caveat enforcers | no (delegation is a signed object) |
| **Coinbase Agentic Wallets (Feb 2026)** | session caps, per-transaction limits, x402 | the operator via policy | MPC signing policy, off-chain | no |
| **Safe + Zodiac Roles / spending-limit modules** | roles, caps, delays, allowlists | the Safe owners | the Safe module | on-chain, per Safe |
| **Session keys (ZeroDev, Biconomy, Rhinestone, Privy, Turnkey policies)** | scope + expiry | re-issue a key | account validator / signing policy | no |
| **AgentGuardrail, thirdweb "spend mandate", Fystack guardrails** | spending limits, velocity caps, allowlists | the operator | account or rail | mixed |
| **Aquara (Aqua keeper agent, ETHGlobal)** | one-signature delegation to a keeper that rotates Aqua strategies | n/a | n/a (the keeper holds the delegation) | no |
| **Leash** | how much the market can take per fill, **shrinking by itself** | **only a verified human (World ID)**; the agent cannot | **inside the SwapVM swap**, and the Vault | **yes: an ENS role anyone can read** |

## What is the same

Leash also bounds authority, also revokes, also expires (at 72h). If the pitch stops there, a judge who knows ERC-7715 will say "MetaMask does this".

## What is different, and why it matters

1. **Decay, not expiry.** ERC-7715 and session keys are cliffs: full authority until the deadline, then none. On Aqua a cliff strands an open position. Leash halves the cap every day, so big trades shrink first and the close path never closes. No product in the table degrades gradually.
2. **Renewal is human-gated.** In every other product, the thing that renews the permission is a signature, and an agent can hold a signing key. Leash's clock moves only on a World ID proof verified server-side, and the backend can never touch the mandate itself. The Grok × Bankr drain (May 2026) happened *after* a fix, because the fix lived in the agent's own logic; a permission the agent can renew is a permission the agent can be tricked into renewing.
3. **Enforcement inside the trade.** Spend limits live in the signer or the account; a bot that can call the router directly bypasses them. `MandateGate` is an instruction inside every quote and swap: the market itself is trimmed, whoever sends the trade.
4. **The permission is public.** A delegation is a private signed blob; a Leash mandate is an ENSv2 role on a name the owner holds. Counterparties, auditors and the router read it at execution time, and expiry of the name kills it.
5. **Aqua-specific fit.** Immutable strategies force a dock/ship loop, so delegation is unavoidable there and the delegate holds the whole balance. That is why the category is sharpest on Aqua, and why Aquara (a keeper with a one-signature delegation) is the shape Leash bounds.

## Signals that the problem is being bought

- MetaMask reports Clawnch agents earning $1.2M in fees by Feb 2026 "inside caveats enforced on-chain": scoped agent authority is live, not theoretical.
- Coinbase shipped agent wallets with session caps as a headline feature.
- Losses from unbounded bot authority keep recurring: DEXX ~$30M (Nov 2024), 3Commas ~$22M (Dec 2022), Banana Gun ~$3M (Sep 2024), Grok × Bankr twice (Mar 2025, May 2026).

## Where Leash could go next

- Compose with ERC-7715: a "leash caveat" (decaying, human-renewed) inside a MetaMask delegation, so wallets that already speak 7715 can grant a leash.
- Cumulative budget on top of the per-fill cap (state in the Vault, read by the gate).
- Same primitive for other recurring authorities: payroll streams, grant disbursement, treasury sub-limits.

## Sources

- [MetaMask: Advanced Permissions (ERC-7715)](https://docs.metamask.io/smart-accounts-kit/concepts/advanced-permissions/) · [Introducing MetaMask Advanced Permissions](https://metamask.io/news/introducing-advanced-permissions) · [Clawnch agents spend inside on-chain limits](https://metamask.io/news/clawnch-ai-agent-launchpad-delegation) · [ERC-7715 explained](https://eco.com/support/en/articles/11953354-erc-7715-explained-wallet-permissions-sessions-and-subscriptions)
- [Coinbase debuts wallet infrastructure for AI agents](https://www.pymnts.com/cryptocurrency/2026/coinbase-debuts-crypto-wallet-infrastructure-for-ai-agents/) · [Coinbase Agentic Wallets explained](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained) · [coinbase/agentkit](https://github.com/coinbase/agentkit)
- [Safe: AI agents powered by Safe smart accounts](https://docs.safe.global/home/ai-overview) · [6 guardrails to limit AI agent spending](https://fystack.io/blog/6-guardrails-to-limit-ai-agent-spending-on-payment-rails) · [AgentGuardrail](https://www.agentguardrail.xyz/) · [thirdweb: Ethereum spend mandate proposal](https://blog.thirdweb.com/ethereum-new-spend-mandate-proposal-puts-guardrails-on-ai-agent-wallets/)
- [1inch Aqua whitepaper](https://1inch.com/assets/1inch-aqua-white-paper.pdf) · [CoinDesk: 1inch launches Aqua](https://www.coindesk.com/web3/2025/11/17/1inch-launches-aqua-a-protocol-letting-multiple-defi-strategies-share-the-same-capital) · [Aquara (Aqua keeper agent)](https://github.com/raihanmd/aquara)
- Incidents: see docs/PITCH.md ("Has this actually happened?")
