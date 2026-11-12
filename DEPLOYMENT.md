# Website deployment

For the step-by-step owner-operated mainnet recording setup, see [VERCEL-LIVE-DEMO.md](VERCEL-LIVE-DEMO.md), the private configuration template `deploy/vercel-live.example`, and `pnpm live:check`.

Autopilot Payday is a Next.js website and can be hosted on Vercel with persistent PostgreSQL. The controlled swap/payroll implementation is described in [LIVE-TREASURY.md](LIVE-TREASURY.md). It is disabled by default pending independent review. No deployment, paid operation or mainnet transfer is claimed by these instructions.

## Read-only host configuration

Configure variables privately in the host, using the exact final HTTPS origin:

```
DATABASE_URL=<dedicated persistent PostgreSQL connection URL>
APP_ORIGIN=https://<your actual deployment domain>
APP_MODE=live_readonly
LIVE_OPERATIONS=false
TREASURY_EXECUTION_ENABLED=false
SOLANA_RPC_URL=<trusted mainnet RPC URL>
SOLANA_VERIFICATION_RPC_URL=<preferably independent trusted mainnet RPC URL>
HERMES_BASE_URL=https://hermes.swap.io
```

Use the Next.js framework preset, pnpm 9.15.4, Node 22 or newer, `pnpm install --frozen-lockfile` and `pnpm build`. Vercel uses its Next.js integration; it does not run a persistent `pnpm start` daemon. A self-hosted persistent Node deployment can use `pnpm start` instead. Keep the project root at the repository root so public evidence resolves.

The app refuses missing `DATABASE_URL` on Vercel/Lambda/Netlify instead of losing attempt state on an ephemeral disk. Use separate databases and matching `APP_ORIGIN` values for preview and production. The raw SQL adapter handles the PostgreSQL driver's native RowList shape; do not remove it. The schema is initialized on database opening; run provisioning privately before admitting users. Native hosted database deployment/load behavior still needs operator validation.

Provision a new non-demo owner workspace using only public addresses, following [LIVE-TREASURY.md](LIVE-TREASURY.md). No seeded Northstar data is promoted. Wallet sign-in selects the eligible organization from current membership rather than assuming Northstar. In read-only mode the owner can inspect supported transaction previews; no on-chain submission is enabled.

For a public competition simulation instead, use a **dedicated demo database**, `APP_MODE=demo`, `ALLOW_DEMO_SEED=true`, and both live flags false. Demo seeding never occurs on an external database without the explicit opt-in. Shared public demo users can modify that demo ledger; never connect it to real financial organizations.

## Private signer and later live activation

Never deploy/proxy/tunnel the local x402 signer or upload `PAYER_KEYPAIR`, `X402_SIGNER_TOKEN`, approval-plan private files or journals. The website imports only the owner's existing verified build bundle. API quote/build purchases are performed locally after separate exact-plan approvals.

After independent security review, actual live activation additionally requires `APP_MODE=live`, `LIVE_OPERATIONS=true`, `TREASURY_EXECUTION_ENABLED=true`, the exact reviewed release marker and the explicit administrative organization enable command. See the live runbook. No Settings toggle or environment flag alone grants financial authority, and every transaction still needs owner wallet signatures. Leave these disabled until the real review and exact financial approvals have occurred.

Health at `/api/health` identifies Payday and reports disabled/owner-approval-gated execution. Exercise wallet-origin checks, both supported flows, provider formats, persistent recovery and independent RPC finality in the intended host before describing it as production-ready. Check local tests with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e` and `pnpm test:e2e:live`.
