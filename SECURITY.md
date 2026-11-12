# Security

The current managed treasury implementation, gate configuration and limitations are in [LIVE-TREASURY.md](LIVE-TREASURY.md). Historical findings are preserved in [AUDIT-REPORT.md](AUDIT-REPORT.md) and [POST-AUDIT-REPORT.md](POST-AUDIT-REPORT.md). Automated tests are not an independent external security audit. No funded/mainnet execution was performed during implementation.

## Authority and custody

The treasury owner signs a readable immutable proposal message and then the exact transaction in Phantom/Solflare. Neither the server nor the agent has a treasury private key. Current database session, organization membership, owner wallet, policy, pause, recipient allowlist and locked milestone amount/address are checked again before submission. A demo organization cannot be promoted or used for live execution. New live provisioning uses public addresses only.

The website never loads the local x402 payer keypair or bearer capability. That process binds only IPv4 loopback, authenticates all endpoints and refuses browser/proxy/rebinding requests. It signs only a fixed-plan sponsored USDC API payment, not a provider's unsigned treasury transaction. Independently pinned mint, payee, facilitator, URL/body, expiry, per-call/day/lifetime limits and fresh reserves are enforced. Quote and build are different exact approvals sharing one durable journal. Stop that separate process to revoke it; the website's pause does not control it.

The local payer also signs only its own domain-separated HTTP-capture digest, after the actual response arrives. Build import requires this signature to bind request/response/receipt and reject edited browser uploads. It is never a generic caller-supplied message signing endpoint and does not authorize a treasury transfer. Settlement is verified independently; the capture signature does not attest the truth of market prices.

## Instruction and settlement checks

The first live swap path supports only direct Raydium CPMM SOL/USDC. Independent RPC account ownership/layout/PDA/config/oracle/vault checks define the profile. Exact ABI, one treasury signer, canonical asset accounts, maximum input, minimum output, fee/rent/reserves and simulated CPI effects are enforced. Lookup table ownership/state is verified and addresses flattened before owner review. Unknown routes, Token-2022, authority changes, arbitrary programs and oversized transactions fail closed. Checked USDC payroll and constrained raw/parsed account-creation CPI are decoded separately.

Signed bytes and the deterministic signature are committed before UNKNOWN is committed and the network call begins. There is one managed dispatch, no automatic re-signing or replacement. Unknown attempts hold their allocations/wallet. Finalized RPC status, identical message/signature and exact asset effects are required before payroll is marked PAID. Confirmed claims are permanent; finalized failure releases only its own claims. Accounting application and observation slots prevent old receipts/failures from reverting new balances or payments. Reconciliation can continue when new submissions are disabled or paused.

Legacy generic broadcasters/pasted signed-transaction entry points remain quarantined. The new service has explicit release/deployment/organization gates, all disabled by default. The review marker is an operator acknowledgment, not independent audit evidence. Every transaction still requires its own exact wallet approval after a deployment is armed.

## Hosting and remaining assumptions

Use HTTPS and a fixed `APP_ORIGIN`; non-loopback HTTP mutations are refused. Cookies are random, httpOnly, same-site database session identifiers with secure production transport; the HTTP exception is loopback only. There is no JWT/session signing secret variable to invent. Nonce consumption and current membership are revalidated; multiple eligible organizations fail closed until explicit selection exists.

Vercel/serverless hosts require persistent PostgreSQL and cannot fall back to local PGlite. Raw postgres-js RowList results are normalized, including transactional/savepoint callbacks, so authorization/CAS checks use the same result contract as local PGlite. Test database and RPC fixtures are isolated and never point at owner funds.

Trust remains in the local OS/private file ACLs, database, wallet software, RPC data and pinned provider programs (including their upgrade authorities). A local response hash does not cryptographically attest market prices. Same-user processes can read a key/token or rewrite a local journal; never reset/move the journal to evade a hold. Expired unsigned/unknown attempts may require manual chain forensics. There is no autonomous signing worker, negative-reconciliation shortcut, unlimited generic execution or production-readiness certification.

Keep keypairs, signer capabilities, raw provider payloads and signed transaction authorizations outside the checkout and public evidence. Never share them in chat or deploy them with the website. Public receipts prove only the operations their actual chain evidence supports. Unsupported provider formats, actual hosted PostgreSQL/network behavior, funded wallet operations and independent external review remain real-world validation work.
