# Autopilot Payday

Treasury funding and contributor payroll for a small team. An agent watches approved USDC obligations, protects reserves, and buys a Swap.io quote through x402 only when treasury USDC is short. People still authorize every swap and every payout.

The treasury wallet stays with its owner. A separate low-value wallet pays for Hermes API calls. Demo mode runs the same accounting and state machine against a labeled ledger. It does not pretend those rows are Solana transactions.

## Requirements

- Node.js 20 or newer
- pnpm 9

Postgres is optional. Local development uses embedded PGlite under `data/pglite`.

## Run

```powershell
pnpm install
copy .env.example .env.local
pnpm dev
```

`pnpm dev` binds to loopback port 3100. Open http://127.0.0.1:3100/login and choose **Owner**. The Northstar Studio demo ledger shows a 90 USDC payroll gap: 125 approved, 35 available. Use this exact origin; another application may own port 3000.

**Audit status:** live web payments, provider swaps and payroll broadcasting are quarantined. Demo fixtures cannot become live state. The separately approved local quote procedure is in [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md); results, severity table and remaining limitations are in [AUDIT-REPORT.md](AUDIT-REPORT.md). No real paid response, swap or payout has been demonstrated.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm test` | Vitest unit tests. No network spend. |
| `pnpm exec tsc --noEmit` | Strict typecheck |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm db:seed` | Open the database. Seed runs only if Northstar is absent. |
| `pnpm test:e2e` | Playwright against isolated production servers on ports 3100/3101. First run `pnpm exec playwright install chromium` and `pnpm build`. |
| `pnpm live:discover` | Free `GET /v1/info` |
| `pnpm live:challenge` | Unpaid quote. Expect HTTP 402. Spends nothing. |
| `pnpm live:prepare-quote` | Public-address balances, unpaid challenge and expiring approval plan. No signature or spend. |
| `pnpm signer --enable-paid-quote` | Explicit owner-approved local signer. Requires the pinned plan/hash, private journal, token and keypair configuration described in the runbook. |
| `pnpm live:paid-quote --i-understand-this-spends-usdc` | Execute the separately approved local plan once. Never run this during install or tests. |

## Modes

- **Demo.** Seeded Northstar ledger. Money movement is marked SIMULATED.
- **Live read-only.** RPC balances, Hermes discovery, and unpaid 402 challenges. No broadcast.
- **Live.** Web financial execution is quarantined. Setting environment flags cannot enable it. A narrow local paid quote experiment has separate approval gates; live swaps and payouts require additional engineering first.

USD prices are not invented. USDC amounts are token amounts. SOL is shown in SOL.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SECURITY.md](SECURITY.md)
- [HERMES-INTEGRATION.md](HERMES-INTEGRATION.md)
- [DATABASE.md](DATABASE.md)
- [TESTING.md](TESTING.md)
- [LIVE-DEMO-GUIDE.md](LIVE-DEMO-GUIDE.md)
- [COMPETITION-DEMO.md](COMPETITION-DEMO.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
