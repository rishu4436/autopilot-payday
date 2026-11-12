import { z } from "zod";
import { createHash } from "node:crypto";
import { canonicalJson } from "../domain/approval";
import { USDC_MINT, WSOL_MINT } from "../domain/tokens";
import { PublicKey } from "@solana/web3.js";

export const QUOTE_URL = "https://hermes.swap.io/v1/swap/quote";
export const BUILD_URL = "https://hermes.swap.io/v1/swap/build-tx";
export const HARD_CALL_ATOMIC = 10_000n; // 0.01 USDC; independent of callers
export const HARD_DAILY_ATOMIC = 50_000n; // 0.05 USDC, UTC, includes unknown attempts
export const HARD_LIFETIME_ATOMIC = 100_000n;
export const HARD_RESERVE_ATOMIC = 100_000n;
// Independently pinned, not derived solely from a caller or a new challenge.
export const HERMES_PAYEE = "BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD";
export const HERMES_FEE_PAYER = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";
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
  lifetimeLimitAtomic: atomic.default("100000"),
  reserveAtomic: z.string().regex(/^\d{1,19}$/),
}).strict();
export type PaidPlan = z.infer<typeof paidPlanSchema>;
export const paidBuildPlanSchema = paidPlanSchema.omit({ url: true, body: true, terms: true }).extend({
  url: z.literal(BUILD_URL),
  body: z.object({ provider: z.string().min(1).max(80), userAddress: address, chainKey: z.literal("sol"), slippageBps: z.number().int().min(1).max(50), quoteResponse: z.record(z.string(), z.unknown()) }).strict(),
  terms: paidPlanSchema.shape.terms.extend({ resource: z.literal(BUILD_URL) }).strict(),
  quote: z.object({ paymentSignature: z.string().min(64).max(90), responseSha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), inputAtomic: atomic, minOutputAtomic: atomic, outputAtomic: atomic, slippageBps: z.number().int().min(1).max(50) }).strict(),
}).strict();
export type PaidBuildPlan = z.infer<typeof paidBuildPlanSchema>;
export type PaymentPlan = PaidPlan | PaidBuildPlan;

export function validatePlan(raw: unknown, now = Date.now()): PaidPlan {
  const plan = paidPlanSchema.parse(raw);
  const created = Date.parse(plan.createdAt), expires = Date.parse(plan.expiresAt);
  if (created > now || expires <= now || expires - created > 15 * 60_000) throw new Error("Plan expired or has an invalid lifetime");
  if (BigInt(plan.maxAtomic) > HARD_CALL_ATOMIC || BigInt(plan.terms.amount) > BigInt(plan.maxAtomic)) throw new Error("Hard per-request ceiling exceeded");
  if (BigInt(plan.dailyLimitAtomic) > HARD_DAILY_ATOMIC || BigInt(plan.dailyLimitAtomic) < BigInt(plan.terms.amount)) throw new Error("Invalid daily limit");
  if (BigInt(plan.lifetimeLimitAtomic) > HARD_LIFETIME_ATOMIC || BigInt(plan.lifetimeLimitAtomic) < BigInt(plan.terms.amount)) throw new Error("Invalid lifetime limit");
  if (BigInt(plan.reserveAtomic) < HARD_RESERVE_ATOMIC) throw new Error("Hard reserve cannot be reduced");
  if (plan.terms.payTo !== HERMES_PAYEE || plan.terms.feePayer !== HERMES_FEE_PAYER) throw new Error("Payment destination is outside the independent Hermes allowlist");
  if (plan.payer === plan.terms.feePayer || plan.payer === plan.terms.payTo) throw new Error("Payer must be independent of facilitator and payee");
  return plan;
}
export function validatePaymentPlan(raw: unknown, now = Date.now()): PaymentPlan {
  if (!raw || typeof raw !== "object" || !("url" in raw) || raw.url !== BUILD_URL) return validatePlan(raw, now);
  const p = paidBuildPlanSchema.parse(raw);
  const { quote, ...base } = p;
  if (now - Date.parse(quote.createdAt) > 120_000) throw new Error("Quote is stale for a new paid build; prepare a fresh quote");
  validatePlan({ ...base, url: QUOTE_URL, body: { input: { token: WSOL_MINT, amount: quote.inputAtomic, chainKey: "sol" }, output: { token: USDC_MINT, chainKey: "sol" }, userAddress: p.body.userAddress, slippageBps: quote.slippageBps }, terms: { ...p.terms, resource: QUOTE_URL } }, now);
  if (JSON.stringify(p.body).length > 250_000 || Date.parse(quote.createdAt) > now || p.body.slippageBps !== quote.slippageBps || BigInt(quote.minOutputAtomic) > BigInt(quote.outputAtomic) || BigInt(quote.minOutputAtomic) < BigInt(quote.outputAtomic) * BigInt(10_000 - quote.slippageBps) / 10_000n) throw new Error("Invalid build quote metadata");
  return p;
}
export function planHash(plan: PaymentPlan): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

export function validateTerms(plan: PaymentPlan, terms: Record<string, unknown>, context: { requestUrl: string; responseUrl: string; declaredResource?: unknown }): void {
  validatePaymentPlan(plan);
  const extra = terms.extra as { feePayer?: unknown } | undefined;
  const resource = terms.resource ?? (context.declaredResource as { url?: unknown } | undefined)?.url;
  if (terms.maxTimeoutSeconds !== undefined && (typeof terms.maxTimeoutSeconds !== "number" || !Number.isInteger(terms.maxTimeoutSeconds) || terms.maxTimeoutSeconds <= 0 || terms.maxTimeoutSeconds > 60)) throw new Error("Unsafe payment timeout");
  if (context.requestUrl !== plan.url || context.responseUrl !== plan.url || resource !== plan.url ||
      terms.scheme !== plan.terms.scheme || terms.network !== plan.terms.network || terms.asset !== plan.terms.asset ||
      terms.payTo !== plan.terms.payTo || extra?.feePayer !== plan.terms.feePayer || terms.amount !== plan.terms.amount ||
      (terms.maxAmountRequired !== undefined && terms.maxAmountRequired !== plan.terms.amount)) {
    throw new Error("Payment terms changed. Prepare and approve a new plan.");
  }
}
