import { createHash, timingSafeEqual } from "node:crypto";

export interface ProposalBody {
  type: "swap" | "payout" | "refill" | "x402";
  policyVersion: number;
  orgId: string;
  assetMint: string;
  amountAtomic: string;
  sourceWallet: string;
  destinations: { wallet: string; amountAtomic: string }[];
  quoteId?: string;
  minOutAtomic?: string;
  slippageBps?: number;
  solInAtomic?: string;
  expiresAt?: string;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, inner]) => [key, sortValue(inner)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function proposalHash(body: ProposalBody): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function approvalStillValid(approvedHash: string, current: ProposalBody): boolean {
  const next = proposalHash(current);
  const a = Buffer.from(approvedHash);
  const b = Buffer.from(next);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type AttemptState = "none" | "challenge_seen" | "payment_sent_unknown" | "settled" | "failed_unpaid";

export function decidePaidRetry(state: AttemptState): "allow" | "deny" {
  if (state === "none" || state === "challenge_seen" || state === "failed_unpaid") return "allow";
  return "deny";
}

export interface ConfirmationView {
  status: "none" | "submitted" | "confirmed" | "failed" | "unknown";
  signature: string | null;
}

export function nextConfirmationAction(view: ConfirmationView): "poll" | "mark_unknown" | "stop" {
  if (view.status === "confirmed" || view.status === "failed") return "stop";
  if (view.status === "unknown") return "poll";
  if (view.status === "submitted" && !view.signature) return "mark_unknown";
  if (view.status === "submitted" && view.signature) return "poll";
  return "stop";
}
