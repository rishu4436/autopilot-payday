export interface Recovery {
  code: string;
  title: string;
  recovery: string;
  autoRetryPayment: false;
}

const ROWS: readonly Recovery[] = [
  { code: "WALLET_DISCONNECTED", title: "Wallet disconnected", recovery: "Connect the treasury wallet, then repeat the signature request.", autoRetryPayment: false },
  { code: "INVALID_WALLET", title: "Invalid wallet address", recovery: "Enter a 32-byte Solana address. The field is rejected until it parses.", autoRetryPayment: false },
  { code: "SIGNATURE_REJECTED", title: "Signature rejected", recovery: "The wallet declined the prompt. Nothing was broadcast. You can request a new signature.", autoRetryPayment: false },
  { code: "MILESTONE_NOT_APPROVED", title: "Milestone is not approved", recovery: "Finish review and approve the milestone before it can enter payroll.", autoRetryPayment: false },
  { code: "DUPLICATE", title: "Duplicate milestone", recovery: "Remove the duplicate row. Each milestone can sit in only one open batch.", autoRetryPayment: false },
  { code: "ALREADY_PAID", title: "Already paid", recovery: "Open the proof record. Do not create another transfer for this milestone.", autoRetryPayment: false },
  { code: "UNSUPPORTED_TOKEN", title: "Unsupported token", recovery: "Payroll and API payments use Solana USDC. Change the asset or reject the request.", autoRetryPayment: false },
  { code: "WRONG_NETWORK", title: "Wrong network", recovery: "Only the Solana x402 option is accepted. Base and other networks are ignored.", autoRetryPayment: false },
  { code: "INSUFFICIENT_USDC", title: "Insufficient USDC", recovery: "Run funding analysis. A swap is proposed only when treasury USDC cannot cover the obligation.", autoRetryPayment: false },
  { code: "INSUFFICIENT_SOL_FEE", title: "Insufficient SOL for network fees", recovery: "Leave SOL in the treasury wallet for signatures and rent. This is separate from the x402 USDC micropayment.", autoRetryPayment: false },
  { code: "INSUFFICIENT_API_RESERVE", title: "API reserve would be breached", recovery: "Refill the dedicated x402 wallet or lower the call. The protected reserve is not spendable.", autoRetryPayment: false },
  { code: "UNEXPECTED_PAYEE", title: "Unexpected payment recipient", recovery: "Refresh Hermes discovery. Payment is refused when the 402 payTo differs from discovery.", autoRetryPayment: false },
  { code: "API_COST_OVER_BUDGET", title: "API cost over budget", recovery: "Raise the per-call or daily limit, or skip the paid call. No payment was sent.", autoRetryPayment: false },
  { code: "API_TIMEOUT", title: "API timeout before payment", recovery: "The unpaid attempt can be repeated. A timeout after payment is treated as uncertain instead.", autoRetryPayment: false },
  { code: "SETTLEMENT_UNCERTAIN", title: "Settlement uncertain", recovery: "Do not retry. Check the payer wallet on Solscan, then reconcile the receipt manually.", autoRetryPayment: false },
  { code: "MISSING_RECEIPT", title: "Missing payment receipt", recovery: "Treat the body as unverified. A 200 without X-PAYMENT-RESPONSE is not a paid result.", autoRetryPayment: false },
  { code: "MALFORMED_PAID_RESPONSE", title: "Malformed paid response", recovery: "Store the raw payload and stop. Do not build a swap from it.", autoRetryPayment: false },
  { code: "RATE_LIMITED", title: "Rate limited", recovery: "Wait and retry the unpaid request. Paid traffic is not throttled by Hermes once settled.", autoRetryPayment: false },
  { code: "NO_QUOTES", title: "No quotes", recovery: "Adjust the pair or amount. No swap can be authorized without a quote.", autoRetryPayment: false },
  { code: "QUOTE_EXPIRED", title: "Quote expired", recovery: "Purchase a fresh quote. Expired quotes cannot authorize execution.", autoRetryPayment: false },
  { code: "SLIPPAGE", title: "Slippage too high", recovery: "Reject the route or tighten policy before asking for a signature.", autoRetryPayment: false },
  { code: "UNEXPECTED_INSTRUCTION", title: "Unexpected transaction shape", recovery: "Reject the unsigned transaction. The fee payer or message does not match the approval.", autoRetryPayment: false },
  { code: "SIMULATION_FAILED", title: "Simulation failed", recovery: "Do not sign. Read the simulation logs, then build again from a new quote if needed.", autoRetryPayment: false },
  { code: "RPC_OUTAGE", title: "RPC unavailable", recovery: "Confirmation is unknown if a transaction was already sent. Otherwise wait and retry the read.", autoRetryPayment: false },
  { code: "BROADCAST_TIMEOUT", title: "Broadcast timeout", recovery: "If no signature was returned, do not send a second copy until you confirm the first is absent.", autoRetryPayment: false },
  { code: "DUPLICATE_SUBMISSION_TX", title: "Duplicate submission blocked", recovery: "Use the existing signature. Uncertain payments stay locked.", autoRetryPayment: false },
  { code: "TX_PENDING", title: "Transaction pending", recovery: "Keep polling Solana. Pending is not success and not a reason to resend.", autoRetryPayment: false },
  { code: "TX_FAILED", title: "Transaction failed", recovery: "A definitive chain error can be replaced by a new authorized attempt. The old signature stays in the audit log.", autoRetryPayment: false },
  { code: "TX_CONFIRMED_AFTER_TIMEOUT", title: "Confirmed after timeout", recovery: "Record the confirmation. Do not send another transfer for the same obligation.", autoRetryPayment: false },
  { code: "PARTIAL_PAYOUT", title: "Partial payout", recovery: "Reconcile each chunk. Retry only the chunks with a definitive failure.", autoRetryPayment: false },
  { code: "RECIPIENT_CHANGED", title: "Recipient changed", recovery: "The old approval is void. Amend the milestone and approve it again.", autoRetryPayment: false },
  { code: "RESTART_DURING_EXECUTION", title: "Restart during execution", recovery: "Resume confirmation only. Do not rebuild or resend a transaction that may have landed.", autoRetryPayment: false },
  { code: "CONCURRENT_OPERATOR", title: "Another operator holds the lock", recovery: "Wait for the lock to expire or for the other review to finish.", autoRetryPayment: false },
  { code: "INSUFFICIENT_AFTER_QUOTE", title: "Balance changed after the quote", recovery: "Discard the quote and analyze again. Do not sign the stale transaction.", autoRetryPayment: false },
  { code: "ATA_REQUIRED", title: "Token account required", recovery: "The payout can include an idempotent ATA creation. The treasury wallet needs SOL for rent.", autoRetryPayment: false },
  { code: "CANCELLED_AFTER_QUOTE", title: "Cancelled after the quote", recovery: "The x402 payment is sunk. No swap is broadcast. Start a new operation if payroll is still unpaid.", autoRetryPayment: false },
  { code: "AGENT_PAUSED", title: "Agent paused", recovery: "In-flight confirmations can finish. New quotes, swaps, and payouts wait until resume.", autoRetryPayment: false },
  { code: "BOOTSTRAP", title: "API wallet needs a bootstrap transfer", recovery: "Fund the payer with treasury USDC. It cannot buy a quote while its spendable balance is empty.", autoRetryPayment: false },
  { code: "REFILL_COOLDOWN", title: "Refill cooling down", recovery: "Wait for the cooldown, or cancel the proposal.", autoRetryPayment: false },
  { code: "SOL_RESERVE", title: "SOL reserve protected", recovery: "The quote input would break the minimum SOL reserve. Choose a smaller input.", autoRetryPayment: false },
];

const BY_CODE = new Map(ROWS.map((row) => [row.code, row]));

export function recoveryFor(code: string): Recovery {
  return BY_CODE.get(code) ?? {
    code,
    title: "Needs review",
    recovery: "Stop the money movement and inspect the audit event before trying again.",
    autoRetryPayment: false,
  };
}

export function recoveryCatalog(): readonly Recovery[] {
  return ROWS;
}
