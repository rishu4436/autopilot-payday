# Record a real Payday transaction on Vercel

The website has owner-wallet swap and USDC payroll execution. This guide prepares a **real mainnet demonstration**. No funded transaction, hosted deployment or independent external security review has been completed by these instructions. Keep a small dedicated demo treasury and approve each exact transaction in your own wallet. Deployment flags permit the signing flow; they never authorize a transfer on their own.

## 1. Configure your host and public wallets

Use Node 22 or newer and the repository's pnpm version (the local checks ran on Node 24). Create a dedicated PostgreSQL database and Vercel project; use a separate database for previews. No GitHub remote is required for a local CLI deployment:

```powershell
Set-Location D:\payday
pnpm dlx vercel@latest login
pnpm dlx vercel@latest link
Copy-Item deploy/vercel-live.example .env.live.local
```

Edit `.env.live.local` privately. Enter your final production HTTPS origin, PostgreSQL URL, two trusted mainnet RPC endpoints, treasury/owner public address and a **different** API-payer public address. The payout recipient is entered later in Contributors. Do not put a wallet secret, signer token or keypair path in this file. Operator commands now load this file automatically; existing terminal environment variables take precedence. Do not run a local web process against the same embedded database as another process.

In Vercel Project Settings → Environment Variables, configure these for **Production** using the same values:

| Variable | Initial value |
| --- | --- |
| `DATABASE_URL` | Dedicated PostgreSQL connection URL; private |
| `APP_ORIGIN` | Exact final `https://your-project.vercel.app` origin; no trailing slash |
| `APP_MODE` | `live_readonly` |
| `LIVE_OPERATIONS` | `false` |
| `TREASURY_EXECUTION_ENABLED` | `false` |
| `ALLOW_DEMO_SEED` | `false` |
| `COOKIE_SECURE` | `true` |
| `SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` |
| `SOLANA_RPC_URL` | Trusted primary mainnet endpoint; keep credentials server-side |
| `SOLANA_VERIFICATION_RPC_URL` | Trusted independent mainnet endpoint; private |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` or a browser-safe endpoint without secret credentials |
| `HERMES_BASE_URL` | `https://hermes.swap.io` |
| `X402_PAYER_PUBLIC_KEY` | Dedicated public API-payer address |

The three `ORG_*` / `TREASURY_PUBLIC_KEY` provisioning values are used locally; the database stores the resulting workspace and wallet mapping. If the production domain is not assigned yet, first deploy read-only, then set its exact origin and redeploy. Sign-in rejects alternate/preview domains. Keep previews read-only and isolated.

Provision and deploy:

```powershell
pnpm live:provision-org --provision-public-addresses
pnpm dlx vercel@latest deploy --prod
```

Provisioning reads public mainnet balances, creates a new real workspace and signs nothing. Re-running with the same exact wallet mappings leaves configuration unchanged. It refuses to promote seeded demo organizations. Open the final production domain, connect your treasury wallet and sign in. Unknown wallets are refused. Settings → **Live demo setup** shows configuration gaps; Treasury → refresh balances reads actual funds.

The repository includes `vercel.json` build settings, Node runtime configuration, a 60-second app function duration and `.vercelignore` exclusions for local databases, environment files, signer journals, keys and private evidence. Inspect the deployment source list if you keep other private files in the working directory. `vendor/bigint-buffer` must remain in the upload because the lockfile references it.

## 2. Enable owner-approved mainnet execution

After reviewing the release and its limits, change these in **both** `.env.live.local` and Vercel Production:

```dotenv
APP_MODE=live
LIVE_OPERATIONS=true
TREASURY_EXECUTION_ENABLED=true
TREASURY_REVIEWED_RELEASE=controlled-swap-payroll-v1
```

The reviewed release marker is an operator acknowledgment, not evidence that an independent audit occurred. Do not describe it as an audit certification.

```powershell
pnpm live:provision-org --provision-public-addresses --enable-reviewed-live
pnpm live:check
pnpm dlx vercel@latest deploy --prod
```

`live:check` reads configuration, workspace/owner mapping, current public treasury balances, mainnet genesis hashes, unresolved attempts and public Swap.io discovery. It never pays, signs or broadcasts, and does not log RPC/database credentials. It deliberately reports incomplete setup with a nonzero exit status. Its conservative balance check does not replace the exact transaction simulation. After deployment, verify Settings and `/api/health` on the final origin; health should identify Payday and `owner_approved_gated`. A green configuration check is not a claim that a real Swap.io route is supported or a funded transaction succeeded.

Keep enough SOL for the configured treasury reserve (initially **0.02 SOL**), actual swap input, fee and any token account creation. Previews reserve up to 0.0002 SOL fee and 0.02 SOL rent conservatively. Payroll requires actual USDC above the configured reserve. The local API payer must have canonical USDC for each separately approved API charge plus its **0.10 USDC** reserve. Prices are taken from each fresh challenge.

## 3. Prepare the real Swap.io segment

Follow [LIVE-TREASURY.md](LIVE-TREASURY.md#swapio-quote-paid-build-and-website-import) and [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md) for the dedicated local payer, private journal, approved quote, separately approved build and bundle export. The web app never receives the API wallet's key. The private signer terminal remains separately configured; it does not load `.env.live.local` automatically.

The quote preparation uses **0.001 SOL** input. Treasury execution permits at most **0.01 SOL** and **50 bps** slippage. Only a direct **Raydium CPMM SOL→USDC** transaction returned by Swap.io is supported. Other routes are refused before treasury approval; do not pay repeatedly hoping a different route will pass. No direct Jupiter fallback is enabled. Merchant pricing/route availability and a genuine paid response have not been verified in this task.

Complete private setup before recording. Quote/build preparation is time sensitive: quote metadata is capped at two minutes, and a treasury preview lasts at most 90 seconds and the underlying blockhash lifetime. Import the fresh verified build bundle on `/swap`, review its exact amount, minimum USDC output, fee/rent/reserve limits and treasury address, sign the approval message, then separately sign the exact transaction. If a quote/preview expires **before an attempt is approved**, prepare a fresh preview. If an attempt is already PREPARED/SIGNED/UNKNOWN, use its resume/reconcile path; never authorize a replacement while it is unresolved.

## 4. Prepare one small real payout

Use a separate recipient wallet you control for the recording. In Contributors, add its public address and explicitly allowlist it. Create one small USDC milestone (for example **0.01 USDC**), submit evidence and approve it. Refresh balances after the swap or your own wallet funding. Draft and authorize the batch on Payroll, then preview the next unpaid chunk.

The supported ceiling is six allocations and 100 USDC per transaction. Review the **full** recipient and amount in the transaction preview, sign its exact approval message, then sign and submit once through your treasury wallet. No seeded milestone or simulated balance is used in the real workspace.

## 5. Recording sequence and submission evidence

1. Show the final HTTPS website, LIVE badge, your real workspace name and treasury public address. Keep private terminals/configuration off-camera.
2. Show the verified Swap.io API-build payment separately from the swap. Explain that it paid for unsigned build bytes.
3. On Swap, show the exact SOL input, minimum USDC output and your wallet confirmation. Wait for the attempt to become **CONFIRMED**, then open its verified Solscan receipt.
4. Show the new real balance, the approved milestone and the exact payout recipient/USDC amount. Approve and sign the payout once.
5. Wait for **CONFIRMED**, open its verified Solscan transaction and show the recipient token credit. Refreshing the page should preserve the receipt and paid milestone.
6. Click **Download verified receipt** for swap and payout. The server independently rechecks each finalized transaction, original message and asset effects before exporting JSON. Downloads contain public addresses, exact authorized amounts, signature, slot, fee and hashes; no signed bytes, wallet keys, session IDs or private API response are included.

Submit the recording, deployed URL, genuine API-payment/swap/payout links and downloaded receipts as separate evidence. Never submit synthetic test-bank transactions as mainnet proof. This guide creates no genuine evidence until you run and finalize the real operations.

If a response is lost or state is UNKNOWN, wait/reconcile the existing signature. Reconciliation remains available after pausing or disabling new submission. Do not repeatedly click paid commands, create a replacement payment or resubmit an uncertain transaction. Expired approved attempts remain held for investigation. Once recording is finished, disable new submission with `TREASURY_EXECUTION_ENABLED=false` and redeploy; existing receipts/reconciliation remain accessible.

Reference: [Vercel deploy CLI](https://vercel.com/docs/cli/deploy), [environment variables](https://vercel.com/docs/environment-variables), [function duration](https://vercel.com/docs/functions/configuring-functions/duration), [.vercelignore](https://vercel.com/docs/deployments/vercel-ignore).
