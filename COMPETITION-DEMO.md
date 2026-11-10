# Competition recording

Bounty: [Make a video about our x402 Feature](https://superteam.fun/earn/listing/make-a-video-about-our-x402-feature).

Record the product, not a fake terminal. The presentation route is `/presentation`. It is a six-scene story of Northstar Studio and is badged DEMO. Arrow keys move between scenes.

## Suggested two-minute cut

1. Login as owner. Mission control shows 125 USDC approved, 35 available, 90 short. Say that the agent did not invent a SOL price.
2. Open the flow map. Nothing is marked paid.
3. Open x402. Show Hermes discovery. Click **Fetch live HTTP 402** so the recording contains a real unpaid challenge from this session. Read the USDC amount and the payee.
4. Show Agent fuel: the payer needs USDC, the swap needs SOL, and an empty payer cannot buy the quote that would refill it.
5. Run funding analysis with `1` SOL. Authorize the quote. The result is labeled SIMULATED unless you completed the live guide. Say that out loud if it is simulated.
6. Authorize the swap and record the simulated settlement only if you are still in demo. Then draft the payroll batch, authorize it, and record the simulated payout.
7. Open Proof. Point at the three different references: API payment, swap, payout. Simulated ones do not link to Solscan.
8. If you did a real paid quote, replace steps 5 and 6 with the Solscan receipt and the wallet approval. Do not leave the simulated badge on screen while saying the payment was real.

## Do not show

- The 125 USDC Northstar payroll as if it settled on mainnet.
- A Solscan link for a `SIMULATED:` id.
- The payer secret, the signer token, or a seed phrase.

Mask addresses with the share-link checkbox off if the recording would expose operational wallets.
# Audit evidence restriction

Show the 125 USDC obligation, 35 USDC available and exact 90 USDC gap, actual unpaid 402 evidence, and clearly SIMULATED funding/payroll/proof. The fixture's 1 SOL to 90 USDC is not a market quote. No paid response, real Solscan settlement, live swap or live payout is available from this audit. `/presentation` now says so prominently. Only add those claims after the separately approved local procedure produces independently reconciled evidence. See the complete inventory in [AUDIT-REPORT.md](AUDIT-REPORT.md).

