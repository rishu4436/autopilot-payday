# Security

This is a treasury application with a narrow authority model. It is not an audit, and it is not an unrestricted agent wallet.

## Custody

- The owner signs treasury swaps and payouts in Phantom or Solflare.
- The server can broadcast a transaction only after the signed message bytes match the authorized unsigned transaction and the fee payer is the treasury wallet.
- The x402 secret is read by `services/x402-signer` from `PAYER_KEYPAIR` on the local machine. The Next.js process never receives that file.
- The signer listens on 127.0.0.1 and checks a bearer token.
- Logs redact fields whose names look like secrets or keypairs. Do not put a seed phrase in the database, the browser, or a prompt.

## Gates before an API payment

The unpaid 402 is parsed first. Payment proceeds only when the network is Solana, the asset is USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, the recipient is on the latest discovery allowlist, the amount is inside the per-call and daily limits, the payer stays above its reserve, and the agent is not paused.

A paid HTTP 200 without a successful `X-PAYMENT-RESPONSE` is unverified. The body is not used as a quote. Unknown settlement is not retried.

## Gates before a payout

- Milestone must be approved, unpaid, allowlisted, and locked to the same recipient.
- Each milestone can appear in only one batch item.
- The batch authorization hash is checked again at execution.
- Failed chain results can be retried as a new attempt. Unknown results cannot.
- Demo partial failure is a labeled ledger control, not a network event.

## Live arming

Live broadcast requires both `LIVE_OPERATIONS=true` and the owner switch in Settings. Either one alone does not send money.

## Remaining risk

- Hermes swap transactions are checked for fee payer and message equality, then simulated by RPC when a live build exists. They are not formally decoded instruction by instruction. The owner still has to read the wallet prompt.
- There is no strict Content-Security-Policy, because wallet adapters need room to run. Other hardening headers are set.
- Session ids are random and httpOnly. Set `SESSION_SECRET` before any production host even though the current cookie is the random session id, not a signed JWT.
- PGlite on a laptop disk is not a hosted production database.
- Rate limits are in-process. They reset when the server restarts.
- A client test and a clean build are not a security audit.
# Audit amendment — 2026-11-10

The current security disposition and remaining risks are in [AUDIT-REPORT.md](AUDIT-REPORT.md). Web financial execution, provider swaps, and live payout broadcasting are quarantined in code. Prior descriptions below of live gating or recovery describe intended behavior and must not be taken as verified readiness. A local paid quote requires the exact separately approved plan and durable journal in [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md). No real paid integration was executed during the audit.

