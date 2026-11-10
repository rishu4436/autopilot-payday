import { z } from "zod";
import { createHash } from "node:crypto";
import { canonicalJson } from "../domain/approval";
import { USDC_MINT, WSOL_MINT } from "../domain/tokens";
import { PublicKey } from "@solana/web3.js";

export const QUOTE_URL = "https://hermes.swap.io/v1/swap/quote";
export const HARD_CALL_ATOMIC = 10_000n; // 0.01 USDC; independent of callers
export const HARD_DAILY_ATOMIC = 50_000n; // 0.05 USDC, UTC, includes unknown attempts
const address = z.string().refine((v) => { try { return new PublicKey(v).toBase58() === v; } catch { return false; } });
const atomic = z.string().regex(/^[1-9]\d{0,18}$/);
export const paidPlanSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  payer: address,
  url: z.literal(QUOTE_URL),
  method: z.literal("POST"),
  body: z.object({
    input: z.object({ token: z.literal(WSOL_MINT), amount: atomic, chainKey: z.literal("sol") }).strict(),
    output: z.object({ token: z.literal(USDC_MINT), chainKey: z.literal("sol") }).strict(),
    userAddress: address,
    slippageBps: z.number().int().min(1).max(50),
  }).strict(),
  terms: z.object({
    scheme: z.literal("exact"), network: z.literal("solana"), asset: z.literal(USDC_MINT),
    amount: atomic, payTo: address, feePayer: address, resource: z.literal(QUOTE_URL),
  }).strict(),
  maxAtomic: atomic,
  dailyLimitAtomic: atomic,
  reserveAtomic: z.string().regex(/^\d{1,19}$/),
}).strict();
export type PaidPlan = z.infer<typeof paidPlanSchema>;

export function validatePlan(raw: unknown, now = Date.now()): PaidPlan {
  const plan = paidPlanSchema.parse(raw);
  const created = Date.parse(plan.createdAt), expires = Date.parse(plan.expiresAt);
  if (created > now || expires <= now || expires - created > 15 * 60_000) throw new Error("Plan expired or has an invalid lifetime");
  if (BigInt(plan.maxAtomic) > HARD_CALL_ATOMIC || BigInt(plan.terms.amount) > BigInt(plan.maxAtomic)) throw new Error("Hard per-request ceiling exceeded");
  if (BigInt(plan.dailyLimitAtomic) > HARD_DAILY_ATOMIC || BigInt(plan.dailyLimitAtomic) < BigInt(plan.terms.amount)) throw new Error("Invalid daily limit");
  if (plan.payer === plan.terms.feePayer || plan.payer === plan.terms.payTo) throw new Error("Payer must be independent of facilitator and payee");
  return plan;
}
export function planHash(plan: PaidPlan): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

export function validateTerms(plan: PaidPlan, terms: Record<string, unknown>, context: { requestUrl: string; responseUrl: string; declaredResource?: unknown }): void {
  validatePlan(plan);
  const extra = terms.extra as { feePayer?: unknown } | undefined;
  const resource = terms.resource ?? (context.declaredResource as { url?: unknown } | undefined)?.url;
  if (context.requestUrl !== plan.url || context.responseUrl !== plan.url || resource !== plan.url ||
      terms.scheme !== plan.terms.scheme || terms.network !== plan.terms.network || terms.asset !== plan.terms.asset ||
      terms.payTo !== plan.terms.payTo || extra?.feePayer !== plan.terms.feePayer || terms.amount !== plan.terms.amount ||
      (terms.maxAmountRequired !== undefined && terms.maxAmountRequired !== plan.terms.amount)) {
    throw new Error("Payment terms changed. Prepare and approve a new plan.");
  }
}
