# Owner-operated x402 quote procedure

The subsequent managed wallet flow and separately approved unsigned-build procedure are in [LIVE-TREASURY.md](LIVE-TREASURY.md). The original quote procedure and private journal safeguards below still apply; section 8 describes the earlier offline-only state.

Updated 2026-11-10. This procedure authorizes no payment. No funded signer, real paid quote, swap or payroll transfer has been run in this audit. The owner chose to handle wallet setup and public balance checks personally. The web payment relay, live swaps, live payout preparation and broadcaster remain quarantined in code.

## 1. Private local setup

Use a dedicated low-value mainnet API payer, separate from the treasury. Never paste a mnemonic, private key, keypair JSON or signer token into chat. Inspect the full public addresses yourself. Create/fund the wallet and its canonical mainnet USDC ATA through your own wallet procedure; funding and account creation are separate operations outside this approval.

Keep keys, plans, results and the one persistent journal outside the checkout and synced folders. In PowerShell:

```powershell
Set-Location D:\payday
$privateDir = Join-Path $env:USERPROFILE '.payday-private'
New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $privateDir /inheritance:r /grant:r "${account}:(OI)(CI)F"
```

Save your locally managed keypair as `payer.json` inside that directory and inspect its ACL. Windows does not enforce POSIX mode bits; the real ACL matters. The audit never creates, reads or funds that keypair. Public canonical USDC is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals).

## 2. Exact next action: read-only owner preflight

Use public addresses only. CLI scripts read this terminal's environment, not `.env.local` automatically.

```powershell
$env:LIVE_OPERATIONS = 'false'
$env:X402_PAYER_PUBLIC_KEY = '<your full public API payer address>'
$env:TREASURY_PUBLIC_KEY = '<your full public treasury address>'
$env:SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com'
$env:X402_APPROVED_PLAN = Join-Path $privateDir ("quote-plan-" + [Guid]::NewGuid().ToString() + '.json')
pnpm live:prepare-quote
```

This verifies mainnet genesis, the owned/unfrozen payer USDC ATA and balance, reads free official discovery, captures a fresh unpaid challenge and prepares a **0.001 SOL to USDC quote request at 50 bps**. The SOL amount is a quote parameter; it is never traded. It saves the exact request, terms, 15-minute expiry, budget policy, evidence and canonical SHA-256 plan hash with no overwrite. No secret is loaded or signature made. Insufficient balance, a missing ATA or changed discovery/pins refuses preparation.

Independent hard ceilings: **10,000 atomic USDC (0.01) per request; 50,000 (0.05) per UTC day; 100,000 (0.10) over the journal's lifetime; and at least 100,000 (0.10) remaining USDC reserve.** Generated plans set their actual per-request maximum to the exact challenge charge. The public capture in this checkout asked for **3,007 atomic USDC (0.003007)**; that observation does not approve or fix a future price. The payer must have at least the fresh exact charge plus the reserve. API payment must not debit its SOL.

Pinned quote endpoint: `POST https://hermes.swap.io/v1/swap/quote`. Pinned payee: `BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD`. Pinned facilitator fee payer: `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`. An address rotation requires a new code review; do not loosen the pins to make a test pass.

## 3. Mandatory exact approval checkpoint

**STOP after preparation.** Review the saved public plan and balance locally. Obtain separate approval for: “One paid API quote only, plan ID and full SHA-256 hash [values], API payer [full address], treasury quote address [full address], mainnet canonical USDC, payee and facilitator [full addresses], exact and maximum charge [fresh amount], UTC-day/lifetime limits, reserve and expiration [values]. No swap or contributor payout.”

The approved hash binds all those fields and the entire request. A generic “continue,” an unpaid 402, or this engineering task is not financial authorization. Expired plans, changed terms or any replacement plan require fresh exact approval. Do not start the signer yet merely because preparation succeeded.

## 4. Only after separate approval: one-plan signer

In the private signer terminal, use the exact approved file/hash. Set a trustworthy mainnet read-only verification RPC, preferably independent of the SDK's RPC provider. Generate the bearer capability locally and transfer it privately to the CLI terminal; never print it or put it in the web environment, URL or literal command history.

```powershell
$env:X402_APPROVED_PLAN_SHA256 = '<separately approved full hash>'
$env:PAYER_KEYPAIR = Join-Path $privateDir 'payer.json'
$env:X402_JOURNAL_DIR = Join-Path $privateDir 'journal'
$env:SOLANA_VERIFICATION_RPC_URL = '<trusted independent mainnet HTTPS RPC URL>'
$env:X402_SIGNER_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:LIVE_OPERATIONS = 'true'
pnpm signer --enable-paid-quote
```

It binds only `127.0.0.1:8787`. All endpoints, including health, require the capability. Exact peer/Host, no browser Origin/fetch metadata, no forwarding headers, request size/time limits and one in-flight call apply. The caller can submit only the approved plan ID. The keypair public address must equal the approved payer. Both RPCs must report mainnet genesis. The signer accepts only the narrowly decoded three-instruction gasless USDC payment, validates the actual blockhash, simulates without replacing it, persists the message before signing, and allows one paid HTTP dispatch.

Use **the same journal directory forever**, including after failures and across plans/days. A cross-process signer lock, short journal lock, fsync'd append-only hash chain, per-plan single use, daily/lifetime accounting and unresolved-attempt hold are enforced. Version-1, truncated or corrupted journals fail closed; never automatically migrate or reset them. This chain detects corruption, not a malicious OS account that can rewrite history.

## 5. Only after approval: execute once

In the local CLI terminal set the same public plan, approved hash, private bearer capability and live opt-in. Do not set `PAYER_KEYPAIR` there. Choose a new private result file:

```powershell
$env:X402_RESULT_FILE = Join-Path $privateDir 'paid-quote-result.json'
$env:LIVE_OPERATIONS = 'true'
pnpm live:paid-quote --i-understand-this-spends-usdc
```

The command validates the private result path and refuses overwrite before requesting payment. Success requires a genuine API receipt, confirmed/finalized RPC status, the identical approved message and transaction signature, exact canonical USDC source debit and payee credit, and no payer SOL change. A malformed/failed quote after settlement never erases the verified payment. The private journal's `evidence` directory retains the raw response and verified record separately. A usable paid API response is not a swap execution.

## 6. Uncertainty and crash recovery

After any timeout, connection loss, missing receipt, failed verification, disk error or crash: **do not retry**. A reserved/prepared/signed/unknown attempt holds all later payments. A 409 or expired blockhash is not proof of nonpayment. Preserve the entire directory and inspect the payer ATA's transaction history using a trusted independent RPC/explorer. Candidate signatures must match the persisted exact message and amounts.

Read-only positive reconciliation, including after plan expiry:

```powershell
pnpm live:reconcile --signature <independently-observed-transaction-signature>
```

Set `X402_APPROVED_PLAN` and the original `X402_JOURNAL_DIR` first. If the receipt signature was already journaled, `pnpm live:reconcile` can use it. Optional `X402_RECONCILIATION_FILE` saves a new private result. Only a positively verified settlement can close the hold; a single RPC's missing transaction never clears it. `pnpm live:reconcile --recover-quote` can additionally reconstruct a missing verified artifact from the **existing original successful API response** captured before RPC verification; it refuses overwritten evidence, receipt mismatch or malformed quotes. It cannot recover a response that was never captured, invent quotes, refund limits or authorize another payment. Reserved attempts without a persisted message or unresolvable unsigned/receiptless outcomes require manual forensic review; there is no automatic negative reconciliation.

A crash may leave process locks. Stop all signer processes first. Then the following checks journal integrity and lock metadata and refuses deletion if any recorded PID exists, including PID reuse:

```powershell
pnpm live:recover-lock --recover-dead-process
```

It removes only dead-process locks, never journal rows, holds or budgets. Old/invalid lock metadata requires manual review. Recovery assumes a trusted local account and no concurrent operator racing the command.

## 7. Import and present genuine evidence

After an actual successful paid quote, set these to the signer-created files, using the actual plan ID:

```powershell
$env:X402_VERIFIED_RECORD = Join-Path $env:X402_JOURNAL_DIR 'evidence\<plan-id>-verified.json'
$env:X402_RAW_RESPONSE = Join-Path $env:X402_JOURNAL_DIR 'evidence\<plan-id>-response.json'
pnpm live:import-evidence
```

The importer checks the response hash, quotes, receipt and fresh on-chain settlement, and refuses overwrite of `evidence/public/paid-quote.json`. It never reads a keypair. `/presentation` displays paid quotes and a real Solscan receipt only after another chain verification. If RPC verification is unavailable, it says so and hides the completed-payment claim. Public evidence contains addresses and unsigned message bytes; inspect it before sharing. Raw provider payloads, payment authorization headers, tokens and keys remain private. A local response hash documents the trusted client's capture; it is not a provider-signed market-price attestation.

Refresh public unpaid evidence independently with `pnpm live:challenge --save-evidence`. That command uses a placeholder address and spends nothing. Stop the signer with Ctrl+C after the experiment and remove token variables from both terminals. The demo pause button does not control this independent process.

## 8. Live swaps and payroll remain blocked

The new instruction/effects guard and SQL ledger are offline engineering components. They decode checked USDC payouts and a restricted Jupiter v6 exact-in/single-Ray­dium route ABI, reject unknown programs/instructions, unresolved lookup tables, authority changes and extra asset movement, bind immutable owner-signed proposals/messages, hold allocation claims, persist signed bytes/signatures before any possible future dispatch, and reconcile finalized simple payroll outcomes including partial success. There is **no broadcaster or web route connected to the ledger**.

No production pool-account profile is approved. The read-only `treasury-rpc.ts` adapter collects account/fee/rent/blockhash data, pins a minimum simulation slot, checks post-simulation accounts and refuses incomplete or parsed-only CPI summaries. It does not broadcast or expose a web endpoint. Real provider transaction review, lookup table resolution, expanded byte-level CPI support where a node supplies only parsed summaries, swap settlement effects, production provisioning and a new independent security review are still prerequisites. Synthetic pool profiles in tests are never deployable approvals. Existing live guards remain unconditional even if environment flags are changed. Any future swap and any future payout require their own exact owner approvals, distinct from buying an API quote.

Verification commands: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm audit`. Production browser tests use isolated temporary databases on loopback ports 3100/3101 and refuse server reuse. Do not disturb unrelated applications on port 3000 or other ports. No external Git remote is configured or authorized.
