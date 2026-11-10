import { bootstrapBlock } from "./policy";
import { requiredOutput } from "./money";

export type DecisionKind = "proceed" | "skip" | "propose" | "reject" | "await";

export interface Decision {
  kind: DecisionKind;
  code: string;
  reason: string;
  nextAction: string;
}

export interface QuoteView {
  minOutAtomic: bigint | null;
  receivedAt: number;
  slippageBps: number;
  evidenceClass: "simulated" | "live_paid" | "live_unpaid";
}

export interface FundingContext {
  paused: boolean;
  recipientsAllowlisted: boolean;
  shortfallAtomic: bigint;
  treasurySolAtomic: bigint;
  minTreasurySolAtomic: bigint;
  proposedSolInAtomic: bigint | null;
  x402SpendableAtomic: bigint;
  quotePriceAtomic: bigint | null;
  now: number;
  slippageCeilingBps: number;
  maxQuoteAgeMs: number;
  marginBps: bigint;
  quote: QuoteView | null;
  x402Authorized: boolean;
  swapAuthorized: boolean;
}

export function decideFunding(ctx: FundingContext): Decision {
  if (ctx.paused) {
    return {
      kind: "reject",
      code: "AGENT_PAUSED",
      reason: "Agent is paused. Queued financial actions will not run.",
      nextAction: "Resume the agent before any new treasury action.",
    };
  }
  if (!ctx.recipientsAllowlisted) {
    return {
      kind: "reject",
      code: "NOT_ALLOWLISTED",
      reason: "Payout paused: recipient wallet is not allowlisted.",
      nextAction: "Allowlist every approved recipient before funding or payout.",
    };
  }
  if (ctx.shortfallAtomic === 0n) {
    return {
      kind: "skip",
      code: "COVERED",
      reason: "No conversion required: existing available USDC covers approved payroll.",
      nextAction: "Prepare the payout batch and wait for authorization.",
    };
  }
  if (ctx.proposedSolInAtomic !== null && ctx.treasurySolAtomic - ctx.proposedSolInAtomic < ctx.minTreasurySolAtomic) {
    return {
      kind: "reject",
      code: "SOL_RESERVE",
      reason: "Funding request blocked: projected SOL balance would fall below your minimum reserve.",
      nextAction: "Reduce the SOL amount to quote, or change the reserve with an owner action.",
    };
  }
  const blocked = bootstrapBlock(ctx.x402SpendableAtomic, ctx.quotePriceAtomic);
  if (blocked && !ctx.quote) {
    return {
      kind: "reject",
      code: "BOOTSTRAP",
      reason: blocked,
      nextAction: "Move USDC from the treasury wallet into the dedicated API wallet with an authorized transfer.",
    };
  }
  if (!ctx.quote) {
    if (ctx.proposedSolInAtomic === null) {
      return {
        kind: "propose",
        code: "NEED_SOL_AMOUNT",
        reason: "A conversion may be required. The SOL input is unknown until a Swap.io quote is purchased.",
        nextAction: "Enter a SOL amount to quote. The app will not invent an exchange rate.",
      };
    }
    if (!ctx.x402Authorized) {
      return {
        kind: "await",
        code: "NEED_X402_AUTH",
        reason: "Waiting for owner authorization.",
        nextAction: "Authorize the paid Swap.io quote. The API micropayment is separate from the swap network fee.",
      };
    }
    return {
      kind: "propose",
      code: "NEED_QUOTE",
      reason: "Owner authorized a quote. The shortfall is still unmet by treasury USDC.",
      nextAction: "Purchase the Swap.io quote once, then evaluate the minimum output.",
    };
  }
  if (ctx.now - ctx.quote.receivedAt > ctx.maxQuoteAgeMs) {
    return {
      kind: "reject",
      code: "QUOTE_EXPIRED",
      reason: "Quote rejected: the quote is older than the configured maximum age.",
      nextAction: "Purchase a new quote. This one cannot authorize a swap.",
    };
  }
  if (ctx.quote.slippageBps > ctx.slippageCeilingBps) {
    return {
      kind: "reject",
      code: "SLIPPAGE",
      reason: "Quote rejected: slippage is above the configured ceiling.",
      nextAction: "Request a tighter route or raise the ceiling in policy.",
    };
  }
  if (ctx.quote.minOutAtomic === null) {
    return {
      kind: "reject",
      code: "MIN_OUT_MISSING",
      reason: "Quote rejected: the response did not include a minimum output.",
      nextAction: "Inspect the raw quote. Execution stays blocked.",
    };
  }
  if (ctx.quote.minOutAtomic < requiredOutput(ctx.shortfallAtomic, ctx.marginBps)) {
    return {
      kind: "reject",
      code: "MIN_OUT",
      reason: "Quote rejected: output falls below the configured minimum.",
      nextAction: "Quote a larger SOL input, or reduce the approved payroll.",
    };
  }
  if (!ctx.swapAuthorized) {
    return {
      kind: "await",
      code: "NEED_SWAP_AUTH",
      reason: "Waiting for owner authorization.",
      nextAction: "Authorize this exact quote. A wallet signature is still required before broadcast.",
    };
  }
  return {
    kind: "proceed",
    code: "SWAP_OK",
    reason: "The quote covers the shortfall inside slippage, age, and reserve policy.",
    nextAction: "Build the unsigned swap and ask the treasury wallet to sign it.",
  };
}
