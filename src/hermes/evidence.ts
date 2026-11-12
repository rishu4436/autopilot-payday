import { assertMainnetRpc } from "../solana/network";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Connection } from "@solana/web3.js";
import { decodePaymentResponse, normalizeNeed, parsePaymentRequired, selectSolanaUsdc } from "./protocol";
import { HERMES_FEE_PAYER, HERMES_PAYEE, HARD_CALL_ATOMIC, QUOTE_URL, paidPlanSchema, validatePlan } from "./paid-plan";
import { verifySettlement } from "../solana/receipt";
import { USDC_MINT, WSOL_MINT } from "../domain/tokens";
import { verifyApiCapture } from "./capture-signature";

const atomic = z.string().regex(/^\d{1,20}$/);
export const paidEvidenceSchema = z.object({
  schemaVersion: z.literal(1), evidenceClass: z.literal("verified_chain"), at: z.string().datetime(), plan: paidPlanSchema,
  messageBase64: z.string().min(1).max(4096), messageHash: z.string().regex(/^[a-f0-9]{64}$/),
  receiptHeader: z.string().min(1).max(8192), responseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  captureSignature: z.string().min(64).max(90).optional(),
  evidence: z.object({ signature: z.string().min(64).max(90), slot: z.number().int().positive(), solscan: z.string().url() }).strict(),
  quotes: z.array(z.object({ provider: z.string().min(1).max(80), inputAtomic: atomic.nullable(), outputAtomic: atomic.nullable(), minOutAtomic: atomic.nullable() }).strict()).min(1).max(50),
}).strict();
export type PublicPaidEvidence = z.infer<typeof paidEvidenceSchema>;
export async function verifyPaidEvidence(raw: unknown, rpc: Connection): Promise<PublicPaidEvidence> {
  const record = paidEvidenceSchema.parse(raw), plan = validatePlan(record.plan, Date.parse(record.plan.createdAt));
  verifyApiCapture(record);
  const message = Buffer.from(record.messageBase64, "base64"), receipt = decodePaymentResponse(record.receiptHeader);
  if (createHash("sha256").update(message).digest("hex") !== record.messageHash || !receipt.ok || receipt.transaction !== record.evidence.signature) throw new Error("Evidence message/receipt mismatch");
  await assertMainnetRpc(rpc);
  const evidence = await verifySettlement(rpc, receipt.transaction, plan, message);
  if (evidence.slot !== record.evidence.slot || evidence.solscan !== record.evidence.solscan) throw new Error("Evidence differs from RPC settlement");
  return { ...record, evidence };
}
export const unpaidEvidenceSchema = z.object({
  schemaVersion: z.literal(1), evidenceClass: z.literal("unpaid_http_402"), at: z.string().datetime(), status: z.literal(402),
  url: z.literal(QUOTE_URL), method: z.literal("POST"),
  publicAddressIsPlaceholder: z.literal(true),
  request: z.object({ input: z.object({ token: z.literal(WSOL_MINT), amount: z.literal("1000000"), chainKey: z.literal("sol") }).strict(), output: z.object({ token: z.literal(USDC_MINT), chainKey: z.literal("sol") }).strict(), userAddress: z.literal("11111111111111111111111111111111"), slippageBps: z.literal(50) }).strict(),
  challenge: z.unknown(),
}).strict();
export type PublicUnpaidEvidence = z.infer<typeof unpaidEvidenceSchema>;
export function validateUnpaidEvidence(raw: unknown): { record: PublicUnpaidEvidence; chargeAtomic: string } {
  const record = unpaidEvidenceSchema.parse(raw), need = selectSolanaUsdc(normalizeNeed(parsePaymentRequired(record.challenge)));
  if (!need || need.resource !== QUOTE_URL || need.payTo !== HERMES_PAYEE || need.feePayer !== HERMES_FEE_PAYER || need.maxAmountRequired <= 0n || need.maxAmountRequired > HARD_CALL_ATOMIC || (need.maxTimeoutSeconds !== null && (need.maxTimeoutSeconds <= 0 || need.maxTimeoutSeconds > 60))) throw new Error("Unexpected unpaid terms");
  return { record, chargeAtomic: need.maxAmountRequired.toString() };
}
