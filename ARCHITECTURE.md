# Architecture

Current controlled treasury execution is documented in [LIVE-TREASURY.md](LIVE-TREASURY.md). Its draft/approval/signed/unknown/finality ledger and wallet UI supersede older statements below that no managed broadcaster or instruction authorization exists. The release remains disabled by default; the legacy generic broadcaster remains quarantined.

Autopilot Payday is one Next.js application. Modules replace a multi-package build so Windows and CI can typecheck a single project. The boundaries are still separate.

| Path | Responsibility |
| --- | --- |
| `src/domain` | Integer accounting, policy, milestone rules, funding state machine, approval hashes. No I/O. |
| `src/hermes` | Hermes request bodies, 402 parsing, receipt checks, quote normalization. |
| `src/solana` | Address checks, SPL payout builder, fee-payer and message equality, signature classification. |
| `src/server` | Sessions, ledger reads, mutations, RPC, unpaid Hermes calls, signer client. |
| `src/db` | Drizzle schema, SQL bootstrap, Northstar seed. |
| `services/x402-signer` | Loopback process that holds the payer key and calls `x402-solana`. |
| `src/app` | Mission control, treasury, contributors, milestones, payroll, agent, fuel, x402, swap, proof, analytics, settings, presentation. |

## Accounting

Available USDC is treasury USDC minus the treasury reserve minus USDC already locked in an approved or in-flight batch. Approved unpaid milestones that are not in those batches are the obligations. Shortfall is obligations minus available, floored at zero. The API wallet is a different balance. Its reserve is not subtracted from treasury USDC.

The x402 wallet cannot buy the quote that would refill itself when its spendable balance is empty. A top-up is a treasury transfer when surplus USDC exists, or a swap-then-transfer when it does not. The app never assumes the tokens already moved.

## Funding states

`CREATED → ANALYZING → NO_ACTION_REQUIRED | FUNDING_REQUIRED → quote authorization → QUOTE_RECEIVED | QUOTE_REJECTED → SWAP_APPROVAL_REQUIRED → SWAP_READY → SWAP_SUBMITTED → SWAP_CONFIRMING → SWAP_CONFIRMED | SWAP_FAILED | SWAP_UNKNOWN → PAYROLL_READY → COMPLETED`.

`SWAP_UNKNOWN` is an added state. A missing signature or a timed-out status lands there. The only exits are a later definitive confirmation or failure. The app does not send a second transaction.

Pause can block states that have not been broadcast. Confirmation continues.

## Authorization

Wallet sign-in is a one-time nonce, a domain-bound message, and a server session cookie. Demo sign-in is labeled and is not a wallet session.

Roles are owner, approver, contributor, and auditor. Approvals hash the policy version, mint, amounts, source wallet, and destinations. A changed field invalidates the old approval.

Scoped automatic signing is not implemented. The policy field is fixed to `false`.

## Evidence classes

`simulated`, `live_unpaid`, `live_paid`, and `verified_chain`. Solscan links are rendered only for real base58 signatures. Strings that start with `SIMULATED:` stay inside the app.
# Independent audit amendment — 2026-11-10

Current behavior and limitations are recorded in [AUDIT-REPORT.md](AUDIT-REPORT.md). There is no implemented background worker, live payout broadcaster or provider-specific swap instruction authorization. Those execution paths are quarantined. Organization writes now use transaction-scoped database row locks and one transaction context; the standalone local quote signer uses a durable one-plan journal. Server forms reload their page after one completed submission to display committed state reliably. Earlier architectural intentions below are not evidence that missing live functionality exists.

