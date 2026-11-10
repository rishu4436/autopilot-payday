# Live demo guide

Use a new wallet with a few dollars of USDC for API calls and a separate treasury wallet with a little SOL plus only the USDC you intend to pay. Do not use a primary wallet.

## 1. Keep the key off the web app

Create the payer key with the Solana CLI on your machine. Point `PAYER_KEYPAIR` at that JSON file. Choose a long random `X402_SIGNER_TOKEN`. Put the payer's public address in `X402_PAYER_PUBLIC_KEY`.

```powershell
$env:PAYER_KEYPAIR="D:\secrets\payer.json"
$env:X402_SIGNER_TOKEN="replace-me"
pnpm signer
```

The process prints the public address and listens on 127.0.0.1:8787. It refuses to start without both variables.

## 2. Arm the app

In `.env.local`:

```
APP_MODE=demo
LIVE_OPERATIONS=true
X402_SIGNER_URL=http://127.0.0.1:8787
X402_SIGNER_TOKEN=replace-me
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Sign in as owner. In Settings, register your real Phantom address as the owner sign-in wallet, then sign in with the wallet. Switch the organization to **Live read-only** first. Refresh treasury. Confirm the balances match Solscan. USD value will say unavailable.

Only then switch to **Live** and check **arm live money movement**.

## 3. Unpaid challenge

On the x402 page, fetch a live HTTP 402. Confirm the payee, USDC mint, and atomic amount. This spends nothing.

## 4. Paid quote

Run funding analysis with a tiny SOL amount you can afford. Authorize the quote only if the 402 is inside your per-call limit. The signer pays from the API wallet. The receipt must contain a signature. Open it on Solscan before trusting the route.

If the minimum output is below the payroll gap plus your margin, the quote is rejected. The API payment is already settled and is not repeated.

## 5. Swap and payout

Authorize the swap. The app builds an unsigned transaction through Hermes and checks the fee payer. Sign it in the treasury wallet. The app broadcasts through RPC and polls status. Pending or timeout becomes unknown, not success, and is not resent.

Payouts are SPL transfers from the treasury wallet after a fresh batch approval. Each milestone can be paid once.

## If you stop

Leave live mode. Pause the agent. The signer can be closed with Ctrl+C. The key file stays on disk. Do not commit it.
# Audit amendment — use the current runbook

Follow [AUDIT-LIVE-RUNBOOK.md](AUDIT-LIVE-RUNBOOK.md) for the owner-operated paid quote procedure. It supersedes earlier commands below. Web payments, provider swaps and live payouts are disabled. Do not enable them by changing flags. No paid quote, swap or payout was performed during the audit, and there is no actual Solscan receipt yet. See [AUDIT-REPORT.md](AUDIT-REPORT.md) for verified evidence and limitations.

