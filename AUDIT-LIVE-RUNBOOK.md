# Local owner-operated paid quote and optional treasury tests

Audit date: 2026-11-10 (Asia/Kolkata). No paid request, financial signature, swap or payout was performed during this audit. The owner elected to manage wallet preflight personally. These instructions are a procedure, not authorization. Web payments, provider swaps, and payroll broadcasting are quarantined in code.

## 1. Prepare the machine and dedicated wallet

Use a dedicated low-value Solana mainnet wallet. Create or inspect it yourself in a local wallet or the installed Solana CLI. Never paste its key, mnemonic, signer token, or keypair JSON into chat. Never use the treasury key as the API payer. Record and compare the full public payer and treasury addresses on the local machine. The quote's `userAddress` identifies the treasury to quote for; it does not authorize swapping.

Keep the private keypair, journal and approval plan outside the repository, OneDrive, and other synced folders. On Windows create a private directory and restrict its ACL to the current account:

```powershell
$privateDir = Join-Path $env:USERPROFILE '.payday-private'
New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $privateDir /inheritance:r /grant:r "${account}:(OI)(CI)F"
```

Save the wallet's local keypair as `payer.json` there using your wallet's supported local procedure. Inspect permissions on the file too. The audit does not generate or fund it. Manually provision its canonical USDC ATA if absent and fund it only after your own transfer approval. Canonical mainnet USDC is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals). A small balance such as 0.15 USDC covers the 0.10 USDC reserve plus the hard maximum 0.01 USDC quote charge; funding and account creation have their own costs and are outside this procedure. Hermes API payments use a facilitator fee payer; the API payer must not spend SOL.

## 2. Reproduce the no-spend checks

```powershell
Set-Location D:\payday
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm live:discover
pnpm live:challenge
```

The E2E configuration starts production Payday servers on **127.0.0.1:3100** and **127.0.0.1:3101**, each with its own new temporary database. It refuses server reuse. Port 3000 was occupied by a different repository during this audit; do not assume that `localhost:3000` is Payday. Inspect `Get-NetTCPConnection -State Listen` and the owning process before manual recording. Bind manual servers explicitly to loopback and use one canonical origin. Local HTTP production runs need `APP_ORIGIN=http://127.0.0.1:3100` and `COOKIE_SECURE=false`; the exception is restricted to HTTP loopback. Hosted HTTPS keeps secure cookies. Do not expose a signer through any proxy or tunnel.

## 3. Prepare one quote without a secret or payment

Use a public address only in this terminal. `tsx` scripts read process environment; they do not load `.env.local` automatically.

```powershell
$env:LIVE_OPERATIONS = 'false'
$env:X402_PAYER_PUBLIC_KEY = '<full public API payer address>'
$env:TREASURY_PUBLIC_KEY = '<full public treasury address>'
$env:SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com'
$env:X402_APPROVED_PLAN = Join-Path $privateDir 'quote-plan.json'
pnpm live:prepare-quote
```

This checks mainnet genesis, reads payer USDC, fetches free discovery, and sends an **unpaid** quote for 0.01 SOL with 50 bps slippage. That input amount is only a quote parameter; no SOL trade is executed. It pins the exact 402 charge, canonical mint/network, full payee, facilitator fee payer, endpoint, request body, expiration and policy, and writes a canonical SHA-256 plan hash. Raw discovery/challenge evidence is saved beside the plan. No keypair is loaded. A preexisting output file is never overwritten.

Review all displayed plan fields and saved evidence. Verify the full addresses independently against official discovery and your wallet. Hard signer ceilings are **10,000 atomic USDC (0.01 USDC) per call** and **50,000 atomic USDC (0.05 USDC) per UTC day**, with a **100,000 atomic USDC (0.10 USDC) payer reserve** in generated plans. The exact approved charge is `terms.amount`, typically much lower. The signer requires exact agreement with that amount, not merely an amount under the cap. Discovery base price is not necessarily the actual request price.

**STOP FOR SEPARATE OWNER APPROVAL.** Record approval of the full plan hash, payer, payee, network/mint, exact charge, maximum, UTC daily limit and expiry. The audit and a prior unpaid challenge are not approval. Plan lifetime is at most 15 minutes. If terms change or the plan expires, prepare a new plan file, review it, and obtain fresh approval.

## 4. Only after approval: start the one-plan local signer

In the private signer terminal, set the same approved plan and hash. Set the keypair path only here. Generate a random bearer token locally; do not print, commit or paste it into chat. Supply the same token to the local CLI terminal through a private local channel. Never put this token in `.env.local`, browser variables, URLs or command history literals. Environment variables can be read by other processes running as your account; use a trusted machine.

```powershell
$env:PAYER_KEYPAIR = Join-Path $privateDir 'payer.json'
$env:X402_APPROVED_PLAN = Join-Path $privateDir 'quote-plan.json'
$env:X402_APPROVED_PLAN_SHA256 = '<separately approved plan hash>'
$env:X402_JOURNAL_DIR = Join-Path $privateDir 'journal'
$env:X402_SIGNER_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:LIVE_OPERATIONS = 'true'
pnpm signer --enable-paid-quote
```

The process binds **only 127.0.0.1:8787**. Authenticate `/health` as well as `/v1/paid`. Any Origin, browser fetch metadata, forwarded headers, noncanonical Host or missing token is rejected. Requests accept only the approved plan ID; caller-controlled URLs, payees, methods, amounts and bodies are refused. The web app cannot relay payments to it.

Use the same private journal directory across starts and plans. Its exclusive lock prevents cooperating signer processes from sharing a budget concurrently. A crash leaves `signer.lock` intentionally. Do not delete the lock merely to retry; first inspect the journal and chain. Resetting/deleting/changing the journal bypasses historical accounting and is outside the safety model.

## 5. Only after approval: execute once from the local CLI

In the second terminal set the same plan, approved hash, private token and `LIVE_OPERATIONS=true`. Do not set `PAYER_KEYPAIR` in this terminal. Choose a new result file so prior evidence is not overwritten.

```powershell
$env:X402_APPROVED_PLAN = Join-Path $privateDir 'quote-plan.json'
$env:X402_APPROVED_PLAN_SHA256 = '<separately approved plan hash>'
$env:X402_RESULT_FILE = Join-Path $privateDir 'paid-quote-result.json'
$env:LIVE_OPERATIONS = 'true'
# X402_SIGNER_TOKEN must already match the private signer process.
pnpm live:paid-quote --i-understand-this-spends-usdc
```

The signer validates terms again, reserves the exact charge with fsync before signing, checks payer balance, decodes the SDK payment's instructions, checks two required signers, source/destination ATAs, USDC amount and decimals, and compute limits. Account closures, authority changes, SOL transfers, lookup tables and extra instructions are rejected. It simulates before signing. It never signs a provider swap or payout.

## 6. Reconcile independently

Success requires a 200 with a receipt **and** RPC confirmation, a transaction message identical to the signed message, the exact payer debit/payee credit in canonical USDC, and no API payer SOL change. Save the result's actual `evidence.signature`, `evidence.slot` and `evidence.solscan` URL. Inspect that real Solscan transaction and compare addresses and amounts. Never construct a video receipt from a simulated signature or a fabricated transaction ID.

A timeout, missing receipt, lost connection, RPC failure, malformed response or crash after reservation is **uncertain**. Do not rerun the command, create a new plan to work around the hold, reset a budget, or assume an error means no charge. The journal blocks reused and unresolved plans even after restart and across UTC days. Preserve original message hashes, timestamps and records. Read the payer ATA transaction history and inspect candidate transactions independently. Confirm a matching message hash, mint, amount, source/destination, slot and finalized status. A missing transaction from a single RPC is not proof of no settlement. Use another trustworthy RPC and wait past the original transaction's valid blockhash horizon. Manual journal reconciliation has no automated CLI in this version; involve a developer to append a reviewed outcome without deleting history. Any subsequent financial attempt needs fresh explicit approval.

Stop the signer cleanly with Ctrl+C after the result. Remove private token variables from both terminals. Keep the journal and receipt as private evidence. Do not enable web financial paths.

The app's demo pause switch does not control this standalone process. Stop the signer itself to revoke its ability to execute the approved local plan. A new plan and fresh owner approval are required after expiry or changed terms.

## 7. Optional very small swap: blocked pending engineering prerequisites

The current app deliberately refuses live swap building/signing/broadcast. **Do not remove the quarantine as a demo shortcut.** Before a future separately approved test:

1. Implement and independently review provider-specific instruction decoders, resolved lookup table validation and the exact allowlist of programs and instructions. Reject unknown accounts, token transfers, account closure and authority changes. Bind source/destination token accounts, authority, mints, maximum SOL/token input, fees, minimum USDC output and slippage to an immutable approved transaction message.
2. Simulate the complete decoded transaction and review all balance movements. Re-read balances/reserves, policy, allowlists, quote expiry and last-valid block height immediately before approval. A successful simulation alone is not authorization.
3. Owner reviews a fresh small quote, for example at most 0.001 SOL input, actual current expected USDC output and a 50 bps ceiling. This is a **separate** swap approval; paid quote approval never authorizes a trade. Account for fees/rent, and reject the test if minimum sizes or reserves cannot support it.
4. Persist attempt ID, approved proposal hash, exact signed bytes, deterministic transaction signature, blockhash validity and allocations durably **before** broadcast. Never automatically re-sign/rebuild after a network error. Serialize concurrent execution with durable uniqueness.
5. After separately authorized execution, reconcile RPC transaction error/status, input/output token changes, fee/rent and finality independently; record its own real Solscan URL.

## 8. Optional USDC payout: a third separate approval

Live payout broadcasting and durable recovery are not implemented and remain blocked. For a future reviewed implementation, use one approved allowlisted recipient and at most 0.01 USDC after checking reserves, actual fees/rent and recipient ownership. Lock milestone amount and full recipient address. Decode every instruction in each chunk. Uniquely bind each milestone allocation to one attempt and each chunk to one signature before sending. Get **separate payout approval** for the exact list, amounts and fees. Confirm exact canonical USDC credit and debit from chain evidence. A partial/unknown chunk keeps its allocations locked; reconcile it before permitting a new authorization. Only a definitive failed/expired unlanded attempt can be replaced. Confirmed allocations must never be included in another chunk. Record a separate payout Solscan URL.

Until those prerequisites and approvals exist, use the labeled simulated payroll video and unpaid HTTP 402 evidence. Do not claim live integration or production readiness.
