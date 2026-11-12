# Controlled live swap and payroll implementation

2026-11-12. This extends the historical audit with a managed owner-wallet flow. **No funded wallet, paid API call, mainnet swap or payout has been executed during implementation.** All execution tests use unfunded deterministic wallets and a synthetic loopback RPC. A new independent security review is still required before enabling a real deployment. For the Vercel setup, read-only preflight and owner-operated recording sequence, see [VERCEL-LIVE-DEMO.md](VERCEL-LIVE-DEMO.md).

## What is implemented

Swap.io remains the quote and unsigned-build provider. The separate local API payer can purchase a fixed, hash-approved quote or unsigned build. It signs only the narrow sponsored USDC API payment. It never signs a treasury transaction. Paid-build approval is separate from quote approval, and both are separate from treasury wallet approval.

The website now supports:

1. Preview a live payroll chunk or import a verified Swap.io unsigned-build bundle.
2. Independently inspect instructions, assets, authorities, accounts, costs, reserves and fresh mainnet RPC simulation.
3. Display exact amounts, full recipients, maximum fees/rent, reserves, expiry and immutable proposal/message hashes.
4. Ask the treasury owner to sign a readable approval message, persist it and claim the allocations.
5. Ask separately for the exact on-chain transaction signature in Phantom/Solflare. The server has no treasury private key.
6. Persist valid signed bytes and their deterministic signature, then commit UNKNOWN before the single network dispatch (`maxRetries: 0`).
7. Reconcile independently until finalized. Confirmed source debit/recipient credit and fees update payroll and balances atomically. A candidate signature is not displayed as a verified receipt.

An unresolved attempt blocks new attempts for the same wallet, even across organizations. A saved SIGNED attempt can be submitted once without signing a replacement. UNKNOWN never causes automatic resubmission. PREPARED can resume the same unexpired message. An expired prepared attempt remains held for investigation; there is no automatic abandonment/negative reconciliation. Finalized failures release only their own allocation claims. Confirmed claims remain permanent. Partial payroll continues with fresh approval only for unpaid/definitively failed items. Historical failures/receipts cannot overwrite newer successful accounting or balances.

## First release scope

* Mainnet only; canonical classic SPL USDC, six decimals.
* Swap: SOL to USDC through a **direct Raydium CPMM `swap_base_input` transaction returned by Swap.io**. Input ceiling 0.01 SOL, slippage ceiling 50 bps (or a lower policy value). The 637-byte pool layout, program owner/discriminator, status, authority PDA/bump, config, oracle/pool link, vault mints/authorities, account privileges and exact instruction ABI are checked from RPC, not provider-supplied profiles.
* Provider ALTs are read independently, must belong to the lookup-table program and be active, and are flattened into a fresh, bounded v0 message before owner review. Routes over 64 accounts/1,232 bytes are refused. The final approved message is never changed during simulation or signing.
* Payroll: local checked USDC instructions, up to six allocations and 100 USDC per transaction. ATA creation and the constrained parsed/raw System/SPL CPI forms are decoded; unknown programs/instructions/authority changes are rejected.
* Fees: at most 200,000 lamports; rent: at most 20,000,000 lamports. SOL reserve is the higher of policy and 5,000,000 lamports. Payroll also preserves the configured USDC reserve. The preview displays the exact independent limits.

Jupiter/shared-account routes, Raydium CLMM/AMM-v4 provider profiles, Token-2022, multisig treasury signing and arbitrary DEX instructions are not enabled by this release. Swap.io may return an unsupported route; the app refuses it before treasury approval. Buying a build does not guarantee supported liquidity. There is no direct Jupiter API fallback. Existing generic/legacy broadcasters and pasted signed-transaction actions remain blocked.

## Default gates and review

No environment was armed by this implementation. Actual submission requires **all** of:

```
APP_MODE=live
LIVE_OPERATIONS=true
TREASURY_EXECUTION_ENABLED=true
TREASURY_REVIEWED_RELEASE=controlled-swap-payroll-v1
```

The organization must also be non-demo, mode `live`, `live_enabled=true`, have a current wallet-authenticated owner matching its treasury, and an enabled/unpaused `approval_required` policy. Session/membership, policy, allowlists, locked milestone data, balances, blockhash and simulation are checked again before signing/submission. The release marker is an operator acknowledgment **after** review, not a cryptographic certification or evidence that an independent audit happened. The Settings action cannot promote seeded fixtures or arm these gates.

Reconciliation remains available after pause or submission disablement so in-flight funds can be accounted for. A dispatch already claimed/in flight cannot be revoked by pausing. Stop the separate local API payer itself to revoke its capability; the website's pause does not control that process.

## Owner setup: no transaction or secret key required

Configure a dedicated persistent database privately. Never send its credentials, wallet keypair or signer bearer capability in chat. For hosted Vercel/serverless execution, `DATABASE_URL` is mandatory; the application refuses ephemeral PGlite fallback. Use an isolated database for each deployment and keep previews from connecting to production funds/data.

With the server in `APP_MODE=live_readonly` and the final HTTPS `APP_ORIGIN`, provision a **new**, non-demo organization locally:

```powershell
Set-Location D:\payday
$env:APP_MODE = 'live_readonly'
$env:ORG_SLUG = 'my-live-payday'
$env:ORG_NAME = 'My Payroll'
$env:TREASURY_PUBLIC_KEY = '<full public owner/treasury wallet address>'
$env:X402_PAYER_PUBLIC_KEY = '<different dedicated public API payer address>'
# Set DATABASE_URL privately to your dedicated hosted database, or use a persistent local PGLITE_DIR.
pnpm live:provision-org --provision-public-addresses
```

This checks mainnet and reads public balances. It creates no wallet, signs nothing, funds nothing and never reassigns an existing identity or promotes the Northstar demo. The treasury wallet signs into the provisioned organization; sign-in no longer assumes Northstar. Multiple eligible organizations fail closed pending explicit organization-selection support.

Create contributors, allowlist full addresses, create/review milestones, refresh real balances and authorize the exact payroll batch. Read-only transaction previews can be examined before enabling submission. No fixture balance can be promoted to live funds.

After independent security review, configure the four deployment flags above. For the same public addresses and slug, the explicit administrative enable command is:

```powershell
pnpm live:provision-org --provision-public-addresses --enable-reviewed-live
```

It requires the review/live flags and verifies the existing non-demo owner/treasury mapping. It enables the managed flow; it does not authorize or execute any transaction. Each wallet operation still needs exact owner approval. No enable command was executed in this task.

## Swap.io quote, paid build and website import

Follow [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md) for private ACLs, the independent API payer/journal, a fresh unpaid quote challenge and the **first separate quote approval**. Keep the same journal forever; quote and build payments share call/day/lifetime/reserve limits. No API keypair is uploaded to the website.

After an actually verified quote response, select its provider and prepare the **second separate API payment**, for an unsigned build:

```powershell
$env:X402_VERIFIED_RECORD = '<outside-repository quote verified-record file>'
$env:X402_RAW_RESPONSE = '<outside-repository original quote response file>'
$env:SWAP_PROVIDER_KEY = '<provider key from that actual quote>'
$env:X402_BUILD_PLAN = '<new outside-repository build-plan file>'
pnpm live:prepare-build
```

This re-verifies quote settlement and original response hash, selects the raw `providerQuote`, captures an unpaid `/v1/swap/build-tx` challenge, checks exact terms and prints the build plan/hash/charge. **Stop and separately approve those exact values.** Quote metadata must be within two minutes; build-plan expiry is capped accordingly. The same dedicated API payer, pinned payee/facilitator, 0.01 USDC call / 0.05 daily / 0.10 lifetime limits and 0.10 USDC reserve apply. Prices come from the fresh actual challenge, not a hardcoded promise.

Only after that approval, point `X402_APPROVED_PLAN` and its approved SHA-256 at the build plan, then use the private signer/CLI:

```powershell
# Same private journal/token setup as the quote runbook; LIVE_OPERATIONS=true only in these approved local terminals.
pnpm signer --enable-paid-build
# In the matching local CLI terminal, with a new private X402_RESULT_FILE:
pnpm live:paid-build --i-understand-this-spends-usdc
```

These commands buy **unsigned bytes**. They do not swap. The signer refuses signed provider payloads or additional treasury signers. The trusted local payer signs a domain-separated capture digest binding the exact approved request, HTTP status, response hash and receipt. This capture and signature are fsync'd before RPC verification; uncertainty is held. The website requires a valid API-payer capture signature for builds, so a browser cannot attach edited build data to a real payment receipt. This is client-capture authentication, not a provider-signed market-price attestation. `live:reconcile --recover-quote` can recover an existing quote **or build** response after positive settlement and capture verification; it never purchases another response or loads a private key.

Export only the existing private build evidence, after setting the two paths to the **build** record/response:

```powershell
$env:SWAP_BUILD_BUNDLE = '<new outside-repository swap-build-bundle.json>'
pnpm live:export-swap-build
```

On `/swap`, select that bundle. Keypair files are rejected locally before upload. The server independently verifies the API payment, checks the original response hash, binds the dedicated configured API payer/treasury and uses the settlement slot's RPC block time for freshness, so a caller-edited timestamp cannot refresh an old receipt. It validates/simulates the supported route and asks for separate treasury approvals. Never paste a signed transaction or private key. Raw quote/build payloads and signed bytes remain private; a local response hash is a capture-integrity record, not a provider-signed market-price attestation.

## Verification and remaining limits

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:e2e:live`, `pnpm audit`.

Final local results on 2026-11-12: 184 tests across 13 files, 26 desktop/mobile demo browser checks and one complete synthetic owner-wallet swap/payroll browser check passed. The treasury browser check also verifies the setup screen and finalized receipt downloads. Lint, typecheck, frozen dependency install and production build passed. Dependency audit reported zero advisories across all severities. Default signer startup and the paid-build CLI without explicit spending approval both refused execution. These checks establish local behavior; they do not establish a funded mainnet result or a hosted deployment.

The additional browser test starts isolated production Next on 127.0.0.1:3102, a **synthetic** Solana RPC on 127.0.0.1:3140 and a new temporary database. An injected deterministic wallet signs real fixture messages; all browser external requests are blocked. It exercises owner login, API build import, exact approval, wallet signing, one dispatch, finality, reload recovery and partial payroll. These fake bank receipts are never exported as competition evidence. The PostgreSQL-driver integration test exercises the installed driver over a local wire endpoint backed by PGlite's PostgreSQL engine; it is not a validation of a native hosted PostgreSQL deployment.

Remaining limits: no funded/mainnet execution or paid merchant response has been demonstrated; no new independent external security review or hosted deployment has occurred. Trusted RPC/provider programs, a trusted local API-payer account and dedicated persistent database remain assumptions. Program upgrades and provider formats require review. Expired/receiptless uncertain attempts may need manual forensics. There is no automatic worker signing, retry loop, negative reconciliation or unlimited generic broadcaster. The first real API payment, swap and payout each require their own precise owner approvals and genuine chain evidence.

Source references: [Raydium CPMM program/ABI](https://github.com/raydium-io/raydium-cp-swap), [official Hermes discovery](https://hermes.swap.io/v1/info), and [Solana simulation](https://solana.com/docs/rpc/http/simulatetransaction). Exact modified-file/test records are under ignored `audit/live-execution/`.
