import { createHash } from "node:crypto";
import { AddressLookupTableAccount, AddressLookupTableProgram, Connection, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { paidBuildPlanSchema, validatePaymentPlan } from "./paid-plan";
import { paidEvidenceSchema } from "./evidence";
import { decodePaymentResponse, parseBuildTransaction } from "./protocol";
import { verifySettlement } from "../solana/receipt";
import { verifyApiCapture } from "./capture-signature";

export const paidBuildEvidenceSchema = paidEvidenceSchema.omit({ plan: true, quotes: true }).extend({
  plan: paidBuildPlanSchema,
  captureSignature: z.string().min(64).max(90),
  build: z.object({ transaction: z.string().min(1).max(120_000), provider: z.string().nullable() }).strict(),
}).strict();
export type PaidBuildEvidence = z.infer<typeof paidBuildEvidenceSchema>;
export async function verifyPaidBuildEvidence(raw: unknown, rpc: Connection): Promise<PaidBuildEvidence> {
  const record = paidBuildEvidenceSchema.parse(raw), plan = validatePaymentPlan(record.plan, Date.parse(record.plan.createdAt));
  verifyApiCapture(record, true);
  const message = Buffer.from(record.messageBase64, "base64"), receipt = decodePaymentResponse(record.receiptHeader);
  if (!receipt.ok || receipt.transaction !== record.evidence.signature || createHash("sha256").update(message).digest("hex") !== record.messageHash) throw new Error("Build payment evidence mismatch");
  if (await rpc.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new Error("Expected mainnet RPC");
  const evidence = await verifySettlement(rpc, receipt.transaction, plan, message);
  if (evidence.slot !== record.evidence.slot || evidence.solscan !== record.evidence.solscan || (record.build.provider && record.build.provider !== record.plan.body.provider)) throw new Error("Build evidence differs from independent settlement");
  return record;
}
export function validateOriginalBuildResponse(record: PaidBuildEvidence, response: { status: number; receipt: string; body: string }): void {
  if (response.status !== 200 || response.receipt !== record.receiptHeader || typeof response.body !== "string" || createHash("sha256").update(response.body).digest("hex") !== record.responseSha256) throw new Error("Original build response/receipt mismatch");
  const built = parseBuildTransaction(JSON.parse(response.body));
  if (built.transaction !== record.build.transaction || built.provider !== record.build.provider) throw new Error("Unsigned transaction differs from original API response");
}
export async function canonicalUnsignedSwap(rpc: Connection, base64: string, owner: string): Promise<{ base64: string; blockhash: string; lastValidBlockHeight: number }> {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  if (tx.signatures.some((signature) => signature.some((byte) => byte !== 0)) || tx.message.header.numRequiredSignatures !== 1 || tx.message.staticAccountKeys[0]?.toBase58() !== owner) throw new Error("Expected an unsigned transaction with the treasury as its sole signer");
  const tables = tx.message.version === 0 ? tx.message.addressTableLookups : [];
  if (tables.length > 4) throw new Error("Too many provider lookup tables");
  const resolved = await Promise.all(tables.map(async (lookup) => {
    const info = await rpc.getAccountInfo(lookup.accountKey, "confirmed");
    if (!info || info.executable || !info.owner.equals(AddressLookupTableProgram.programId)) throw new Error("Unverified lookup table owner");
    const account = new AddressLookupTableAccount({ key: lookup.accountKey, state: AddressLookupTableAccount.deserialize(info.data) });
    if (!account.isActive()) throw new Error("Inactive on-chain lookup table");
    return account;
  }));
  const decoded = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: resolved });
  const latest = await rpc.getLatestBlockhash("confirmed");
  // Flatten independently resolved addresses. A provider's asserted ALT mappings
  // are never trusted; routes too large for this reviewed path are refused.
  const message = new TransactionMessage({ payerKey: decoded.payerKey, instructions: decoded.instructions, recentBlockhash: latest.blockhash }).compileToV0Message();
  if (message.staticAccountKeys.length > 64) throw new Error("Swap exceeds the reviewed account ceiling");
  const canonical = new VersionedTransaction(message).serialize();
  if (canonical.length > 1232) throw new Error("Route needs a larger lookup-table execution path; choose a simpler supported route");
  return { base64: Buffer.from(canonical).toString("base64"), ...latest };
}
