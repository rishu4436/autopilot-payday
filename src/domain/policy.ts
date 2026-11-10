export interface ApiPaymentCheck {
  amountAtomic: bigint;
  asset: string;
  network: string;
  payTo: string;
  expectedAsset: string;
  expectedNetwork: string;
  allowedPayTo: readonly string[];
  perCallMaxAtomic: bigint;
  dailySpentAtomic: bigint;
  dailyLimitAtomic: bigint;
  walletBalanceAtomic: bigint;
  minReserveAtomic: bigint;
  paused: boolean;
}

export type Gate =
  | { ok: true; spendableAtomic: bigint }
  | { ok: false; code: string; reason: string };

export function assessApiPayment(input: ApiPaymentCheck): Gate {
  const spendable = input.walletBalanceAtomic > input.minReserveAtomic
    ? input.walletBalanceAtomic - input.minReserveAtomic
    : 0n;
  if (input.paused) {
    return { ok: false, code: "AGENT_PAUSED", reason: "Emergency pause is on. API payments are blocked." };
  }
  if (input.network !== input.expectedNetwork) {
    return { ok: false, code: "WRONG_NETWORK", reason: "The payment network is not Solana." };
  }
  if (input.asset !== input.expectedAsset) {
    return { ok: false, code: "UNSUPPORTED_TOKEN", reason: "The payment asset is not Solana USDC." };
  }
  if (input.allowedPayTo.length === 0 || !input.allowedPayTo.includes(input.payTo)) {
    return {
      ok: false,
      code: "UNEXPECTED_PAYEE",
      reason: "HTTP 402 payment recipient does not match Hermes discovery.",
    };
  }
  if (input.amountAtomic <= 0n || input.amountAtomic > input.perCallMaxAtomic) {
    return { ok: false, code: "API_COST_OVER_BUDGET", reason: "HTTP 402 payment cost is over the per-call budget." };
  }
  if (input.dailySpentAtomic + input.amountAtomic > input.dailyLimitAtomic) {
    return { ok: false, code: "API_COST_OVER_BUDGET", reason: "This call would exceed the daily API spending limit." };
  }
  if (input.amountAtomic > spendable) {
    return { ok: false, code: "INSUFFICIENT_API_RESERVE", reason: "Paying this call would breach the protected API reserve." };
  }
  return { ok: true, spendableAtomic: spendable };
}

export interface RefillInput {
  paused: boolean;
  balanceAtomic: bigint;
  thresholdAtomic: bigint;
  minRefillAtomic: bigint;
  maxRefillAtomic: bigint;
  lastRefillAt: number | null;
  now: number;
  cooldownMs: number;
  treasuryUsdcAvailableAtomic: bigint;
  treasurySolSafeAtomic: bigint;
  requestedAtomic: bigint;
}

export type RefillPlan =
  | { ok: false; code: string; reason: string }
  | { ok: true; kind: "not_needed"; reason: string }
  | { ok: true; kind: "usdc_transfer"; amountAtomic: bigint; reason: string }
  | { ok: true; kind: "needs_swap_then_transfer"; amountAtomic: bigint; reason: string };

export function assessRefill(input: RefillInput): RefillPlan {
  if (input.paused) {
    return { ok: false, code: "AGENT_PAUSED", reason: "Emergency pause is on. Refill is blocked." };
  }
  if (input.balanceAtomic >= input.thresholdAtomic) {
    return { ok: true, kind: "not_needed", reason: "API wallet is at or above the refill threshold." };
  }
  if (input.lastRefillAt !== null && input.now - input.lastRefillAt < input.cooldownMs) {
    return { ok: false, code: "REFILL_COOLDOWN", reason: "Refill cooldown has not elapsed." };
  }
  if (input.requestedAtomic < input.minRefillAtomic) {
    return { ok: false, code: "REFILL_MIN", reason: "Refill amount is below the configured minimum." };
  }
  if (input.requestedAtomic > input.maxRefillAtomic) {
    return { ok: false, code: "REFILL_MAX", reason: "Refill amount is above the configured maximum." };
  }
  if (input.treasuryUsdcAvailableAtomic >= input.requestedAtomic) {
    return {
      ok: true,
      kind: "usdc_transfer",
      amountAtomic: input.requestedAtomic,
      reason: "Treasury USDC can cover this top-up with a direct transfer. No swap is required.",
    };
  }
  if (input.treasurySolSafeAtomic > 0n) {
    return {
      ok: true,
      kind: "needs_swap_then_transfer",
      amountAtomic: input.requestedAtomic,
      reason: "Treasury USDC is not enough for this top-up. A Swap.io quote can price a SOL conversion. Nothing moves until that quote exists and the owner authorizes both the swap and the transfer.",
    };
  }
  return {
    ok: false,
    code: "INSUFFICIENT_USDC",
    reason: "Neither free treasury USDC nor SOL above the reserve can fund this top-up.",
  };
}

export function bootstrapBlock(spendableAtomic: bigint, quotePriceAtomic: bigint | null): string | null {
  if (quotePriceAtomic === null) return null;
  if (spendableAtomic >= quotePriceAtomic) return null;
  return "An empty or reserve-locked x402 wallet cannot buy the quote that would refill it. Transfer USDC into the API wallet from the treasury first.";
}

export function projectedSolOk(balance: bigint, spend: bigint, minimum: bigint): boolean {
  return balance - spend >= minimum;
}
