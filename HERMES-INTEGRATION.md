# Hermes integration

Base URL: `https://hermes.swap.io`.

Machine discovery: `GET /v1/info` (free). Human docs: `https://docs.swap.io/developer-tools/agent-api-x402/quickstart` and the API reference.

Checked against live discovery on 2026-11-10.

## What the live service says

| Path | Live payment | Published base that day |
| --- | --- | --- |
| `POST /v1/swap/quote` | x402 | 3000 atomic USDC |
| `POST /v1/swap/quote-2.0` | x402 | 3259 |
| `POST /v1/swap/build-tx` | x402 | 3000 |
| `POST /v1/swap/submit-tx` | x402 | 3019 |
| `POST /v1/transfer/build-tx` | x402 | 3298 |
| `GET /v1/swap/status` | x402 | 3000 |
| `GET /v1/info` | none | — |

The quickstart page still shows an unpaid poll of `/v1/swap/status` and calls it free. The API reference and live `/v1/info` mark status as paid. This app follows the live document and confirms broadcasts with Solana RPC (`getSignatureStatuses`) so it does not pay for every poll.

## Price

`basePrice` is a floor. On 2026-11-10 an unpaid quote for 1 SOL (`1000000000`) to USDC with `slippageBps: 50` returned HTTP 402 and `maxAmountRequired: "3007"` for Solana USDC. Payee `BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD`. Asset `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Facilitator fee payer `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`. The Base option in the same body is ignored.

That capture is stored in `fixtures/live-402-quote.json`. It is an unpaid challenge, not a settlement. The app does not hardcode 3007 as the price of the next call. Live mode reads the new 402.

## Calls this app makes

1. `GET /v1/info` for endpoint list, base prices, and Solana payees.
2. Unpaid `POST /v1/swap/quote` to show the challenge.
3. Paid quote only after policy and owner authorization, through `x402-solana` `createX402Client` inside the local signer.
4. Paid `POST /v1/swap/build-tx` with `quoteResponse` set to the chosen quote's raw `providerQuote`.
5. The owner signs the unsigned transaction. Broadcast prefers Solana RPC.
6. Payroll prefers a local SPL `transferChecked` builder. Hermes `POST /v1/transfer/build-tx` is documented and can be used later. The app says which builder produced a transaction. It does not silently swap providers.

## Tokens

- Wrapped SOL: `So11111111111111111111111111111111111111112`, 9 decimals.
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals.

Amounts are strings of base units. Settlement math uses bigint.

## Receipts

`X-PAYMENT-RESPONSE` is base64 JSON. The app requires `success: true` and `transaction`, `transactionHash`, or `txHash`. Anything else is not a paid result.

## Client

`x402-solana` 3.0.1, import `createX402Client` from `x402-solana/client`. Wallet shape used: `{ address, signTransaction }` and `network: "solana"`. `beforePayment` aborts when the payee or amount fails policy, before `signTransaction`.

## Status of verification

| Check | Status |
| --- | --- |
| `GET /v1/info` | Live, unpaid, captured 2026-11-10 |
| Unpaid `POST /v1/swap/quote` | Live HTTP 402, captured 2026-11-10 |
| Paid quote and receipt | Implemented. Not executed in this environment. No payer key was available. |
| On-chain swap or payout | Not executed. No treasury signature was produced. |
# Audit amendment — 2026-11-10

Live discovery and an unpaid quote were reproduced: quote base price 3000 atomic USDC, request-specific 402 price 3007 atomic USDC. `/v1/swap/status` is paid according to live guide/discovery despite the official MCP README and quickstart describing it as free. Installed x402-solana is 3.0.1; v1 and v2 challenge normalization and abort-before-signing compatibility tests are present. A real paid response, provider quote/build and batch payout API integration are unverified. Current findings: [AUDIT-REPORT.md](AUDIT-REPORT.md). Current local procedure: [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md). Earlier examples below do not waive those restrictions.

