import { createHash } from "node:crypto";
import { createX402Client } from "x402-solana/client";
import { VersionedTransaction } from "@solana/web3.js";
import { decodePaymentResponse, normalizeQuotes, parseBuildTransaction } from "../../src/hermes/protocol";
import { type PaidPlan, type PaidBuildPlan, type PaymentPlan, validatePaymentPlan, validateTerms } from "../../src/hermes/paid-plan";
import { validatePaymentTransaction } from "../../src/solana/payment-guard";
import { PaymentJournal, type JournalRow } from "./journal";

export interface PaidQuoteDependencies {
  rpcUrl: string;
  balance: () => Promise<bigint>;
  simulate: (tx: VersionedTransaction) => Promise<void>;
  sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  verify: (signature: string, message: Uint8Array) => Promise<{ signature: string; slot: number; solscan: string }>;
  save: (record: VerifiedPaidQuote | VerifiedPaidBuild, raw: unknown) => Promise<void>;
  captureResponse?: (text: string, status: number, receipt: string) => Promise<void | string>;
  clientFactory?: (config: Parameters<typeof createX402Client>[0]) => Pick<ReturnType<typeof createX402Client>, "fetch">;
}
export interface VerifiedPaidQuote {
  schemaVersion: 1; evidenceClass: "verified_chain"; at: string; plan: PaidPlan;
  messageBase64: string; messageHash: string; receiptHeader: string; responseSha256: string;
  captureSignature?: string;
  evidence: { signature: string; slot: number; solscan: string };
  quotes: { provider: string; inputAtomic: string | null; outputAtomic: string | null; minOutAtomic: string | null }[];
}
export interface VerifiedPaidBuild extends Omit<VerifiedPaidQuote, "plan" | "quotes"> {
  plan: PaidBuildPlan; build: { transaction: string; provider: string | null };
}
async function boundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), parts: Buffer[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new Error("Quote response too large"); }
      parts.push(Buffer.from(item.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString("utf8");
}
async function executePaidOperation<T extends VerifiedPaidQuote | VerifiedPaidBuild>(plan: PaymentPlan, journal: PaymentJournal, deps: PaidQuoteDependencies, format: (base: Omit<VerifiedPaidQuote, "plan" | "quotes">, raw: unknown) => T): Promise<T> {
  validatePaymentPlan(plan);
  const signal = AbortSignal.timeout(45_000);
  let attempt: JournalRow | undefined, message: Uint8Array | undefined, verified = false, signing = false;
  let initialRequests = 0, paidDispatches = 0;
  const factory = deps.clientFactory ?? createX402Client;
  const client = factory({
    network: "solana", rpcUrl: deps.rpcUrl, amount: BigInt(plan.maxAtomic), verbose: false,
    customFetch: async (url, init) => {
      signal.throwIfAborted(); validatePaymentPlan(plan);
      if (String(url) !== plan.url || init?.method !== plan.method || init?.body !== JSON.stringify(plan.body)) throw new Error("Unexpected payment endpoint or request body");
      const headers = new Headers(init.headers), paid = headers.has("x-payment") || headers.has("payment-signature");
      if (paid ? (!message || !signing || paidDispatches++ !== 0) : initialRequests++ !== 0) throw new Error("Unauthorized or duplicate payment dispatch");
      return fetch(url, { ...init, signal, redirect: "error" });
    },
    wallet: { address: plan.payer, signTransaction: async (tx) => {
      if (!attempt || message || signing) throw new Error("Unauthorized or duplicate signing request");
      signing = true;
      signal.throwIfAborted(); validatePaymentTransaction(tx, plan);
      await deps.simulate(tx);
      if (await deps.balance() < BigInt(plan.terms.amount) + BigInt(plan.reserveAtomic)) throw new Error("Payer balance or reserve changed before signing");
      signal.throwIfAborted(); validatePaymentPlan(plan);
      message = tx.message.serialize();
      attempt = { ...attempt, state: "prepared", messageBase64: Buffer.from(message).toString("base64"), messageHash: createHash("sha256").update(message).digest("hex") };
      journal.append(attempt); // Durable message BEFORE signing; no key material.
      const signed = await deps.sign(tx);
      if (!Buffer.from(signed.message.serialize()).equals(Buffer.from(message))) throw new Error("Signer changed the approved message");
      journal.append({ ...attempt, state: "signed" });
      signal.throwIfAborted(); return signed;
    } },
    beforePayment: async (terms, context) => {
      if (attempt) throw new Error("Duplicate payment challenge");
      signal.throwIfAborted(); validateTerms(plan, terms as unknown as Record<string, unknown>, context);
      const balance = await deps.balance(); signal.throwIfAborted();
      attempt = journal.reserve(plan, balance);
    },
  });
  try {
    const response = await client.fetch(plan.url, { method: plan.method, headers: { "content-type": "application/json" }, body: JSON.stringify(plan.body), signal });
    const header = response.headers.get("x-payment-response") || response.headers.get("payment-response");
    const receipt = decodePaymentResponse(header);
    if (!attempt || !message || !header || !receipt.ok) throw new Error("No receipt; reconcile the attempted payment");
    // Save the candidate signature/header BEFORE RPC verification so a timeout is recoverable.
    attempt = { ...attempt, state: "signed", signature: receipt.transaction, receiptHeader: header };
    journal.append(attempt);
    // Capture the genuine API response even if the subsequent RPC call times out.
    let text = "", captureError: unknown, captureSignature: string | undefined;
    try { text = await boundedText(response); const signature = await deps.captureResponse?.(text, response.status, header); if (typeof signature === "string") captureSignature = signature; }
    catch (error) { captureError = error; }
    const evidence = await deps.verify(receipt.transaction, message);
    journal.append({ ...attempt, state: "verified" }); verified = true;
    if (captureError) throw captureError;
    if (response.status !== 200) throw new Error("Payment settled but API did not return a successful response");
    const raw: unknown = JSON.parse(text);
    const base: Omit<VerifiedPaidQuote, "plan" | "quotes"> = {
      schemaVersion: 1, evidenceClass: "verified_chain", at: new Date().toISOString(),
      messageBase64: Buffer.from(message).toString("base64"), messageHash: createHash("sha256").update(message).digest("hex"), receiptHeader: header,
      responseSha256: createHash("sha256").update(text).digest("hex"), evidence,
      ...(captureSignature ? { captureSignature } : {}),
    };
    const record = format(base, raw);
    await deps.save(record, raw); return record;
  } catch (error) {
    // A malformed quote or failed evidence save must never erase verified settlement.
    if (attempt && !verified) journal.append({ ...attempt, state: "unknown" });
    throw error;
  }
}
export async function executePaidQuote(plan: PaidPlan, journal: PaymentJournal, deps: PaidQuoteDependencies): Promise<VerifiedPaidQuote> {
  return executePaidOperation(plan, journal, deps, (base, raw) => {
    const quotes = normalizeQuotes(raw);
    if (!quotes.length) throw new Error("Payment settled; no usable quotes were returned");
    return { ...base, plan, quotes: quotes.map((q) => ({ provider: q.providerKey, inputAtomic: q.inputAmount, outputAtomic: q.outputAmount, minOutAtomic: q.minOutAtomic?.toString() ?? null })) };
  });
}
export async function executePaidBuild(plan: PaidBuildPlan, journal: PaymentJournal, deps: PaidQuoteDependencies): Promise<VerifiedPaidBuild> {
  return executePaidOperation(plan, journal, deps, (base, raw) => {
    const parsed = parseBuildTransaction(raw);
    if (parsed.transaction.length > 120_000 || (parsed.provider && parsed.provider !== plan.body.provider)) throw new Error("Unexpected build transaction or provider");
    const bytes = Buffer.from(parsed.transaction, "base64"), tx = VersionedTransaction.deserialize(bytes);
    if (bytes.length > 1232 || tx.signatures.some((signature) => signature.some((byte) => byte !== 0)) || tx.message.header.numRequiredSignatures !== 1 || tx.message.staticAccountKeys[0]?.toBase58() !== plan.body.userAddress) throw new Error("Build must be unsigned and require only the approved treasury wallet");
    return { ...base, plan, build: { transaction: parsed.transaction, provider: parsed.provider } };
  });
}
