# Competition evidence

`public/unpaid-challenge.json` is a genuine, timestamped, unpaid Hermes HTTP 402 capture. It uses a placeholder public address and a 0.001 SOL quote parameter. It proves neither a payer balance nor payment. Refresh with `pnpm live:challenge --save-evidence`; no signer or keypair is loaded.

`public/paid-quote.json` is intentionally absent until a separately approved payment succeeds. Afterward, `pnpm live:import-evidence` checks the private original response hash, normalized quotes, receipt signature, exact transaction message and independently queried Solana settlement before importing the strictly selected public fields. `/presentation` rechecks the chain before displaying a completed payment; unavailable verification leaves the receipt hidden. No fixture is a fallback.

The public paid artifact includes public payer/payee/treasury addresses, approved quote parameters, unsigned message bytes, API response hash, quote summaries and the **settlement response** receipt. It never includes a keypair, signer bearer token, raw provider quote payload or `X-PAYMENT`/`PAYMENT-SIGNATURE` authorization header. Review these public addresses before sharing a competition recording.

Solana independently proves the API payment. The local raw API response plus its hash records what this trusted client received; it is not a provider-signed attestation of market prices. No trade or payroll transfer follows from API payment evidence.

Keep keys, plans, raw responses, signed transaction authorizations and journals outside this repository under the owner's private ACLs. `private/` here is ignored as defense in depth, but the signer requires private paths outside the checkout. Never move raw evidence into `public/` manually.
