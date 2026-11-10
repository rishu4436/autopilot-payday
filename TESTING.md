# Testing

## Unit

```powershell
pnpm test
```

Covers atomic USDC parsing, the 90 USDC Northstar shortfall, double-counting protection, API budget and reserve, refill planning, decision sentences, the funding state machine, quote expiry and retry denial, milestone locks, batch validation, approval hashes, roles, nonce replay, the recovery catalog, the captured live 402, providerQuote pass-through, missing receipts, SPL transfer amounts, and signed-message equality.

These tests do not call Hermes and do not spend USDC.

## Typecheck and build

```powershell
pnpm exec tsc --noEmit
pnpm build
```

## Browser

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

The spec signs in as the demo owner, checks the 90 USDC shortfall, and opens presentation mode on a desktop and a phone profile.

## Live, opt-in

```powershell
pnpm live:discover
pnpm live:challenge
```

`pnpm live:paid-quote` exits unless you pass `--i-understand-this-spends-usdc` and the local signer is already running. Install, unit tests, and `pnpm build` do not invoke it.

## Not claimed

No paid Hermes call and no mainnet transaction was executed while building this repository. Do not treat the demo ledger or the captured 402 as settlement evidence.
# Audit verification

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then `pnpm exec playwright install chromium` and `pnpm test:e2e`. The browser tests use **production builds**, bind fresh servers to 127.0.0.1:3100 and :3101, disable server reuse, wait for database-backed application health, and use separate temporary databases for desktop and mobile. Desktop viewport is 1920×1080. Stop manual servers on these ports before running. The intentionally rejected cross-origin request can produce an expected Next server log error.

Final reproduced counts: **92 deterministic tests and 24 Playwright checks**, all passing. `audit/verification-summary.json` references the raw logs. Unit/security tests include real PGlite transactions, nonce replay, membership/role/origin checks, exact shortfall, concurrent allocation/payout attempts, injected SQL rollback, partial holds, malicious payment terms/instructions, journal restart/daily limits, SDK v1/v2 pre-sign aborts and independent synthetic chain receipts. Browser checks cover all twelve app pages, role boundaries, fixture isolation, contributor search/theme, presentation controls, missing-wallet setup messages, emergency pause/resume, milestone draft/review/rejection and full simulated funding/payroll/public proof. They wait for the resulting page load after a submission. They do not exercise installed wallet extensions, paid Hermes responses or real Solana transactions.

To run the complete simulated scenario independently:

```powershell
$env:PGLITE_DIR = Join-Path $env:TEMP ('payday-verify-' + [guid]::NewGuid().ToString())
$env:APP_MODE = 'demo'
$env:DATABASE_URL = ''
$env:LIVE_OPERATIONS = 'false'
pnpm exec tsx scripts/verify-demo.ts
```

Use a new directory each time. No test signs or spends real funds. Live procedure: [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md). The material below predates the independent audit; final logs and the current runbook take precedence.

