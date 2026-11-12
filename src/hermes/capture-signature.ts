import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { planHash, type PaymentPlan } from "./paid-plan";

function captureMessage(plan: PaymentPlan, responseHash: string, status: number, receipt: string): Uint8Array {
  return Buffer.from(`Autopilot Payday API capture v1\nPlan SHA256: ${planHash(plan)}\nHTTP status: ${status}\nResponse SHA256: ${responseHash}\nReceipt SHA256: ${createHash("sha256").update(receipt).digest("hex")}`);
}
// This attests the trusted local client's actual HTTP capture, not market-price
// truth or settlement. RPC verification remains separate. The fixed domain is
// never a Solana transaction or an arbitrary caller-supplied signing request.
export function signApiCapture(plan: PaymentPlan, body: string, status: number, receipt: string, secretKey: Uint8Array): string {
  const key = nacl.sign.keyPair.fromSecretKey(secretKey);
  if (bs58.encode(key.publicKey) !== plan.payer) throw new Error("API capture signer differs from the approved payer");
  return bs58.encode(nacl.sign.detached(captureMessage(plan, createHash("sha256").update(body).digest("hex"), status, receipt), key.secretKey));
}
export function verifyApiCapture(record: { plan: PaymentPlan; responseSha256: string; receiptHeader: string; captureSignature?: string }, required = false): void {
  if (!record.captureSignature && !required) return; // Historical quote artifacts remain readable.
  let valid = false;
  try { valid = nacl.sign.detached.verify(captureMessage(record.plan, record.responseSha256, 200, record.receiptHeader), bs58.decode(record.captureSignature ?? ""), bs58.decode(record.plan.payer)); } catch { valid = false; }
  if (!valid) throw new Error("API capture signature is missing or mismatched; uploaded response/request data is unauthenticated");
}
