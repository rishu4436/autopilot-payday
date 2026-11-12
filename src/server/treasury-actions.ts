"use server";

import { Connection } from "@solana/web3.js";
import { getDb } from "../db/client";
import { connection } from "./chain";
import { getSession, type Session } from "./session";
import { requestDomain } from "./request-security";
import { LiveTreasuryService } from "./live-treasury";

async function serviceCall<T>(work: (service: LiveTreasuryService, session: Session) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    await requestDomain();
    const session = await getSession();
    if (!session) throw new Error("Sign in with the treasury owner wallet");
    const rpc = connection();
    const verificationRpc = new Connection(process.env.SOLANA_VERIFICATION_RPC_URL || rpc.rpcEndpoint, { commitment: "finalized", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
    return { ok: true, data: await work(new LiveTreasuryService(await getDb(), { rpc, verificationRpc }), session) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Treasury request failed";
    return { ok: false, message: message.length < 240 && !/https?:|postgres(?:ql)?:|query:|api.?key|bearer|password/i.test(message) ? message : "Transaction validation or RPC request failed. Inspect the stored attempt before authorizing another transaction." };
  }
}
export async function previewLivePayoutAction(batchId: string) {
  return serviceCall((service, session) => service.previewPayout(session, String(batchId)));
}
export async function previewLiveSwapAction(bundle: string) {
  if (typeof bundle !== "string" || bundle.length > 500_000) return { ok: false as const, message: "Select a Swap.io build bundle smaller than 500 KB" };
  return serviceCall((service, session) => service.previewSwap(session, JSON.parse(bundle)));
}
export async function approveTreasuryDraftAction(draftId: string, signature: string) {
  if (typeof signature !== "string" || signature.length > 100) return { ok: false as const, message: "Invalid owner approval signature" };
  return serviceCall((service, session) => service.approve(session, String(draftId), signature));
}
export async function submitTreasuryTransactionAction(attemptId: string, signed: string) {
  if (typeof signed !== "string" || signed.length > 4000) return { ok: false as const, message: "Signed transaction exceeds the reviewed size" };
  return serviceCall((service, session) => service.submitSigned(session, String(attemptId), signed));
}
export async function submitSavedTreasuryTransactionAction(attemptId: string) {
  return serviceCall((service, session) => service.submitSaved(session, String(attemptId)));
}
export async function reconcileTreasuryTransactionAction(attemptId: string) {
  return serviceCall((service, session) => service.reconcile(session, String(attemptId)));
}
export async function resumeTreasuryTransactionAction(attemptId: string) {
  return serviceCall((service, session) => service.resume(session, String(attemptId)));
}
export async function listTreasuryTransactionsAction(kind: "swap" | "payout", batchId?: string) {
  if (kind !== "swap" && kind !== "payout") return { ok: false as const, message: "Invalid transaction kind" };
  return serviceCall((service, session) => service.list(session, kind, batchId));
}
export async function exportTreasuryReceiptAction(attemptId: string) {
  return serviceCall((service, session) => service.exportReceipt(session, String(attemptId)));
}
