export interface BatchItemInput {
  milestoneId: string;
  recipient: string;
  amountAtomic: bigint;
  allowlisted: boolean;
  active: boolean;
  paymentStatus: string;
  lockedRecipient: string;
  workStatus: string;
  mint: string;
  expectedMint: string;
}

export type BatchVerdict = { ok: true; totalAtomic: bigint } | { ok: false; code: string; reason: string };

export function validateBatch(items: readonly BatchItemInput[]): BatchVerdict {
  if (items.length === 0) return { ok: false, code: "EMPTY", reason: "Select at least one approved milestone." };
  const seen = new Set<string>();
  let total = 0n;
  for (const item of items) {
    if (seen.has(item.milestoneId)) {
      return { ok: false, code: "DUPLICATE", reason: "This milestone is already in the batch." };
    }
    seen.add(item.milestoneId);
    if (item.mint !== item.expectedMint) {
      return { ok: false, code: "UNSUPPORTED_TOKEN", reason: "Payroll pays Solana USDC only." };
    }
    if (item.workStatus !== "APPROVED") {
      return { ok: false, code: "MILESTONE_NOT_APPROVED", reason: "Only approved milestones can be paid." };
    }
    if (item.paymentStatus === "PAID") {
      return { ok: false, code: "ALREADY_PAID", reason: "This milestone is already paid." };
    }
    if (item.paymentStatus === "PAYMENT_SUBMITTED" || item.paymentStatus === "UNKNOWN") {
      return {
        ok: false,
        code: "DUPLICATE_SUBMISSION_TX",
        reason: "This milestone has a submitted or uncertain payment. It will not be sent again.",
      };
    }
    if (!item.allowlisted || !item.active) {
      return { ok: false, code: "NOT_ALLOWLISTED", reason: "Payout paused: recipient wallet is not allowlisted." };
    }
    if (item.recipient !== item.lockedRecipient) {
      return { ok: false, code: "RECIPIENT_CHANGED", reason: "Recipient wallet changed after approval. The approval is void." };
    }
    if (item.amountAtomic <= 0n) {
      return { ok: false, code: "BAD_AMOUNT", reason: "Payment amount must be positive." };
    }
    total += item.amountAtomic;
  }
  return { ok: true, totalAtomic: total };
}

export function canRetryPayout(status: string): boolean {
  return status === "FAILED" || status === "PAYMENT_FAILED";
}

export function batchRollup(statuses: readonly string[]): "CONFIRMED" | "FAILED" | "PARTIAL" | "UNKNOWN" | "PENDING" | "EMPTY" {
  if (statuses.length === 0) return "EMPTY";
  const set = new Set(statuses);
  if (set.has("UNKNOWN")) return "UNKNOWN";
  if ([...set].every((status) => status === "CONFIRMED")) return "CONFIRMED";
  if ([...set].every((status) => status === "FAILED")) return "FAILED";
  if (set.has("CONFIRMED") && set.has("FAILED")) return "PARTIAL";
  return "PENDING";
}
