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

Post-audit target suite: **132 deterministic checks and 26 Playwright checks**. See [POST-AUDIT-REPORT.md](POST-AUDIT-REPORT.md) and `audit/post-verification.json` for the final reproduced results and raw log paths. Typechecking now includes the signer, scripts and browser specifications. The previous audit's 92/24 results remain in its historical records.

The tests cover the real loopback HTTP server (authenticated health, Origin/Host/proxy defenses, malformed/oversized/extra-field requests and concurrent calls), injected payment controller failures, request/terms mutation, unauthorized signing/dispatch, replay denial, daily/lifetime/reserve limits, corrupt/truncated journal recovery holds, expired-plan chain reconciliation and public-artifact re-verification. The installed x402 SDK runs against a real local HTTP JSON-RPC fixture to test the upgraded Jayson client, four account reads, blockhash fetch, checked-transfer construction and payment-header dispatch. Only deterministic unfunded test keys can sign; the fixture intercepts merchant requests and never broadcasts.

Offline treasury tests exercise checked USDC instructions, unknown/authority/SOL/ALT rejection, fresh network/balance/reserve policy, a synthetic single-hop Jupiter ABI/profile, CPI/asset-effects rejection, owner-signed immutable manifests and real PGlite transactions for concurrent milestone claims, signed-byte persistence, crash/unknown holds, finalized failure, partial payroll and confirmed-allocation replay denial. No production pool profile is approved. Browser checks cover the existing pages/workflows and actual unpaid presentation capture, with no fabricated paid receipt. They do not exercise installed wallet extensions, paid Hermes responses, production PostgreSQL or real Solana transfers.

To run the complete simulated scenario independently:

```powershell
$env:PGLITE_DIR = Join-Path $env:TEMP ('payday-verify-' + [guid]::NewGuid().ToString())
$env:APP_MODE = 'demo'
$env:DATABASE_URL = ''
$env:LIVE_OPERATIONS = 'false'
pnpm exec tsx scripts/verify-demo.ts
```

Use a new directory each time. No test signs or spends real funds. Live procedure: [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md). The material below predates the independent audit; final logs and the current runbook take precedence.

