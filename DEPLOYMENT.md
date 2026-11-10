# Deployment

The app can be hosted as a Next.js server. Do not deploy the x402 signer next to it, and do not put `PAYER_KEYPAIR` in the host's environment.

## Production data

Use Postgres. PGlite on a serverless disk will not survive a restart.

```
DATABASE_URL=postgres://...
SESSION_SECRET=a long random string
APP_MODE=live_readonly
LIVE_OPERATIONS=false
SOLANA_RPC_URL=https://your-rpc.example
SOLANA_CLUSTER=mainnet-beta
HERMES_BASE_URL=https://hermes.swap.io
```

Leave `X402_SIGNER_URL` empty on the host. Paid calls then fail closed with a clear message.

## Build

```powershell
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm start
```

Run the process from the repository root so `src/db/sql.ts` and the fixtures resolve. The Node server must be long-lived. A locked-down VM or container with a Postgres URL is a better fit than a stateless function.

## Live execution

Keep the signer on a machine the owner controls:

- Firewall it to localhost.
- Fund it with a small USDC balance.
- Set `LIVE_OPERATIONS=true` only on the deployment that should broadcast, and arm the switch in Settings while signed in as the owner.
- Treasury signing still happens in the owner's browser wallet.

## Secrets checklist

- `.env.local`, `data/`, and `secrets/` are gitignored.
- Do not upload a keypair to a preview host.
- Rotate `X402_SIGNER_TOKEN` if it was ever pasted into a log.
# Audit deployment restriction

This code is approved only conditionally for a labeled simulated/live-unpaid demo, not production financial use. Web payments, provider swaps and payouts are quarantined. Use a dedicated demo database; external PostgreSQL is not seeded unless both demo mode and `ALLOW_DEMO_SEED=true` are explicitly configured. Set a canonical `APP_ORIGIN`; hosted HTTPS retains secure cookies. The local `COOKIE_SECURE=false` exception only applies to HTTP loopback. Never proxy, tunnel or deploy the local signer, or place its token/keypair in web app configuration. See [AUDIT-REPORT.md](AUDIT-REPORT.md) and [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md) before using earlier deployment instructions below.

