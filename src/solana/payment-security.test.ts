import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createCloseAccountInstruction, createSetAuthorityInstruction, AuthorityType, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { HERMES_PAYEE, HERMES_FEE_PAYER, planHash, QUOTE_URL, type PaidPlan, validatePlan, validateTerms } from "../hermes/paid-plan";
import { USDC_MINT, WSOL_MINT } from "../domain/tokens";
import { validatePaymentTransaction } from "./payment-guard";
import { verifySettlement } from "./receipt";
import { PaymentJournal } from "../../services/x402-signer/journal";
import { authorizeLocalRequest } from "../../services/x402-signer/http-policy";
import { buildUsdcPayouts } from "./payout";
import { createRequire } from "node:module";
import { verifyPaidEvidence } from "../hermes/evidence";
import { createHash } from "node:crypto";

const pub = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
const payer = pub(11), payee = new PublicKey(HERMES_PAYEE), feePayer = new PublicKey(HERMES_FEE_PAYER), mint = new PublicKey(USDC_MINT);
function plan(): PaidPlan {
  const now = Date.now();
  return validatePlan({ id: crypto.randomUUID(), createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), payer: payer.toBase58(), url: QUOTE_URL, method: "POST", body: { input: { token: WSOL_MINT, amount: "10000000", chainKey: "sol" }, output: { token: USDC_MINT, chainKey: "sol" }, userAddress: payer.toBase58(), slippageBps: 50 }, terms: { scheme: "exact", network: "solana", asset: USDC_MINT, amount: "3007", payTo: payee.toBase58(), feePayer: feePayer.toBase58(), resource: QUOTE_URL }, maxAtomic: "10000", dailyLimitAtomic: "50000", reserveAtomic: "100000" });
}
function instructions() {
  return [ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, payer), mint, getAssociatedTokenAddressSync(mint, payee), payer, 3007n, 6)];
}
function transaction(list = instructions(), fee = feePayer) {
  return new VersionedTransaction(new TransactionMessage({ payerKey: fee, recentBlockhash: PublicKey.default.toBase58(), instructions: list }).compileToV0Message());
}
describe("pinned payment plans and cumulative durable policy", () => {
  it("hashes the whole immutable request, terms and limits", () => {
    const p = plan(); expect(planHash(p)).not.toBe(planHash({ ...p, reserveAtomic: "0" }));
  });
  it.each(["0", "-1", "10001", "18446744073709551616"])("rejects unsafe per-request maximum %s", (value) => {
    expect(() => validatePlan({ ...plan(), maxAtomic: value })).toThrow();
  });
  it("rejects expired and excessively long plans", () => {
    const p = plan(); expect(() => validatePlan({ ...p, expiresAt: new Date(0).toISOString() })).toThrow();
    expect(() => validatePlan({ ...p, expiresAt: new Date(Date.now() + 3600_000).toISOString() })).toThrow();
  });
  it.each(["payTo", "asset", "network", "resource", "amount", "scheme"])("rejects altered %s terms", (field) => {
    const p = plan(); const terms = { ...p.terms, extra: { feePayer: p.terms.feePayer }, [field]: "attacker" };
    expect(() => validateTerms(p, terms, { requestUrl: p.url, responseUrl: p.url })).toThrow();
  });
  it("rejects a redirected response and facilitator change", () => {
    const p = plan(), terms = { ...p.terms, extra: { feePayer: p.terms.feePayer } };
    expect(() => validateTerms(p, terms, { requestUrl: p.url, responseUrl: "https://evil.example" })).toThrow();
    expect(() => validateTerms(p, { ...terms, extra: { feePayer: pub(15).toBase58() } }, { requestUrl: p.url, responseUrl: p.url })).toThrow();
  });
  it("accepts exact v1 or v2 terms without changing their meaning", () => {
    const p = plan(); validateTerms(p, { ...p.terms, extra: { feePayer: p.terms.feePayer } }, { requestUrl: p.url, responseUrl: p.url });
    const { resource: _resource, ...terms } = p.terms;
    validateTerms(p, { ...terms, extra: { feePayer: p.terms.feePayer } }, { requestUrl: p.url, responseUrl: p.url, declaredResource: { url: p.url } });
  });
  it("reserves before signing and retains unknown state across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "payday-journal-")), journal = new PaymentJournal(directory), p = plan();
    journal.reserve(p, 1_000_000n);
    const restarted = new PaymentJournal(directory);
    expect(() => restarted.reserve(p, 1_000_000n)).toThrow("already attempted");
    expect(() => restarted.reserve(plan(), 1_000_000n)).toThrow("Uncertain");
  });
  it("enforces cumulative daily ceiling across different plan IDs", () => {
    const journal = new PaymentJournal(mkdtempSync(join(tmpdir(), "payday-daily-")));
    const p = plan(); p.dailyLimitAtomic = "6000";
    const row = journal.reserve(p, 1_000_000n); journal.append({ ...row, state: "verified" });
    expect(() => journal.reserve({ ...p, id: crypto.randomUUID() }, 1_000_000n)).toThrow("daily ceiling");
  });
  it("protects balance and reserve", () => {
    const journal = new PaymentJournal(mkdtempSync(join(tmpdir(), "payday-balance-")));
    expect(() => journal.reserve(plan(), 103_006n)).toThrow("reserve");
    expect(journal.rows()).toHaveLength(0);
  });
});
describe("payment instruction authorization", () => {
  it("rejects lookup tables in API payment messages", () => {
    const tx = transaction();
    if (tx.message.version !== 0) throw new Error("Expected v0");
    tx.message.addressTableLookups.push({ accountKey: pub(30), readonlyIndexes: [], writableIndexes: [0] });
    expect(() => validatePaymentTransaction(tx, plan())).toThrow("lookup");
  });
  it("accepts the SDK's exact three-instruction gasless payment", () => { validatePaymentTransaction(transaction(), plan()); });
  it.each(["source", "destination", "mint", "authority", "amount", "decimals"])("rejects mutated %s", (field) => {
    const list = instructions(), tx = list[2]!;
    if (field === "source") tx.keys[0]!.pubkey = pub(20);
    if (field === "mint") tx.keys[1]!.pubkey = pub(20);
    if (field === "destination") tx.keys[2]!.pubkey = pub(20);
    if (field === "authority") tx.keys[3]!.pubkey = pub(20);
    if (field === "amount") tx.data.writeBigUInt64LE(9999n, 1);
    if (field === "decimals") tx.data[9] = 9;
    expect(() => validatePaymentTransaction(transaction(list), plan())).toThrow();
  });
  it("rejects SOL transfer, account close, authority change and arbitrary programs", () => {
    const dangerous = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payee, lamports: 1 }), createCloseAccountInstruction(getAssociatedTokenAddressSync(mint, payer), payee, payer), createSetAuthorityInstruction(getAssociatedTokenAddressSync(mint, payer), payer, AuthorityType.AccountOwner, payee)];
    for (const ix of dangerous) expect(() => validatePaymentTransaction(transaction([...instructions(), ix]), plan())).toThrow();
  });
  it("rejects altered fee payer and compute ceilings", () => {
    expect(() => validatePaymentTransaction(transaction(instructions(), payer), plan())).toThrow();
    const list = instructions(); list[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000 });
    expect(() => validatePaymentTransaction(transaction(list), plan())).toThrow();
  });
});
describe("payout allocations and integer buffers", () => {
  it("rejects the same allocation ID across different chunks", () => {
    expect(() => buildUsdcPayouts({ payer: payer.toBase58(), recipients: [{ id: "same", address: payee.toBase58(), amountAtomic: 1n }, { id: "same", address: pub(14).toBase58(), amountAtomic: 1n }], blockhash: PublicKey.default.toBase58(), rentLamports: 0n, chunkSize: 1 })).toThrow("Duplicate");
  });
  it("checks the replacement integer codec at wire-format boundaries", () => {
    const codec = createRequire(import.meta.url)("../../vendor/bigint-buffer/index.cjs") as { toBigIntLE(v: Buffer): bigint; toBigIntBE(v: Buffer): bigint; toBufferLE(v: bigint, width: number): Buffer; toBufferBE(v: bigint, width: number): Buffer };
    expect(codec.toBigIntLE(Buffer.from("ffffffffffffffff", "hex"))).toBe(18446744073709551615n);
    expect(codec.toBufferLE(256n, 2).toString("hex")).toBe("0001");
    expect(codec.toBufferBE(256n, 2).toString("hex")).toBe("0100");
    expect(codec.toBigIntBE(Buffer.from("0100", "hex"))).toBe(256n);
    expect(() => codec.toBufferBE(256n, 1)).toThrow();
    expect(() => codec.toBufferLE(-1n, 8)).toThrow();
    expect(() => codec.toBufferLE(1n, 1000000)).toThrow();
  });
});
describe("signer network boundary", () => {
  const token = "test-token-is-not-a-real-secret-0000";
  const headers = { host: "127.0.0.1:8787", authorization: `Bearer ${token}` };
  it("authenticates CLI loopback requests", () => { authorizeLocalRequest("127.0.0.1", headers, token); });
  it.each([
    { host: "evil.example:8787" }, { host: "localhost:8787" }, { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" }, { "x-forwarded-host": "127.0.0.1:8787" }, { forwarded: "for=127.0.0.1" }, { authorization: "" },
  ])("rejects rebinding, proxy, browser or missing credentials: %j", (patch) => {
    expect(() => authorizeLocalRequest("127.0.0.1", { ...headers, ...patch }, token)).toThrow();
  });
  it("rejects remote peers", () => { expect(() => authorizeLocalRequest("192.168.1.5", headers, token)).toThrow(); });
});
describe("independent chain receipt validation", () => {
  function evidence() {
    const p = plan(), tx = transaction(), keys = tx.message.staticAccountKeys;
    const source = keys.findIndex((k) => k.equals(getAssociatedTokenAddressSync(mint, payer))), dest = keys.findIndex((k) => k.equals(getAssociatedTokenAddressSync(mint, payee)));
    const balance = (index: number, owner: string, amount: string) => ({ accountIndex: index, mint: USDC_MINT, owner, uiTokenAmount: { amount, decimals: 6, uiAmount: null } });
    const record = { slot: 123, transaction: { message: tx.message, signatures: [bs58.encode(new Uint8Array(64).fill(5))] }, meta: { err: null, innerInstructions: [], preBalances: keys.map(() => 1000000), postBalances: keys.map(() => 1000000), preTokenBalances: [balance(source, p.payer, "1000000"), balance(dest, p.terms.payTo, "100")], postTokenBalances: [balance(source, p.payer, "996993"), balance(dest, p.terms.payTo, "3107")] } };
    const status = { value: [{ err: null, confirmationStatus: "confirmed" }] };
    const rpc = { getSignatureStatuses: vi.fn(async () => status), getTransaction: vi.fn(async () => record) };
    return { p, tx, record, rpc, status, signature: bs58.encode(new Uint8Array(64).fill(5)) };
  }
  it("requires the approved message and exact USDC debit and credit", async () => {
    const e = evidence(); const receipt = await verifySettlement(e.rpc as unknown as Connection, e.signature, e.p, e.tx.message.serialize());
    expect(receipt.slot).toBe(123); expect(receipt.solscan).toContain(e.signature);
  });
  it("rejects a receipt-shaped response without confirmed chain settlement", async () => {
    const e = evidence(); e.status.value[0]!.confirmationStatus = "processed";
    await expect(verifySettlement(e.rpc as unknown as Connection, e.signature, e.p, e.tx.message.serialize())).rejects.toThrow("not confirmed");
  });
  it("rejects wrong amount and mutated messages", async () => {
    const e = evidence(); e.record.meta.postTokenBalances[1]!.uiTokenAmount.amount = "3108";
    await expect(verifySettlement(e.rpc as unknown as Connection, e.signature, e.p, e.tx.message.serialize())).rejects.toThrow("movement");
    await expect(verifySettlement(e.rpc as unknown as Connection, e.signature, e.p, new Uint8Array([1]))).rejects.toThrow("message mismatch");
  });
  it("reconciles an expired approval without reopening its signing window", async () => {
    const e = evidence(); e.p.createdAt = new Date(Date.now() - 3600_000).toISOString(); e.p.expiresAt = new Date(Date.now() - 3590_000).toISOString();
    expect(() => validatePlan(e.p)).toThrow("expired");
    await expect(verifySettlement(e.rpc as unknown as Connection, e.signature, e.p, e.tx.message.serialize())).resolves.toMatchObject({ signature: e.signature });
  });
  it("refuses a substituted chain signature even with matching-looking movements", async () => {
    const e = evidence(); e.record.transaction.signatures[0] = bs58.encode(new Uint8Array(64).fill(6));
    await expect(verifySettlement(e.rpc as unknown as Connection, e.signature, e.p, e.tx.message.serialize())).rejects.toThrow("message mismatch");
  });
  it("reverifies public paid artifacts and refuses self-asserted/fabricated receipts", async () => {
    const e = evidence(), message = Buffer.from(e.tx.message.serialize());
    const rpc = { ...e.rpc, getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" } as unknown as Connection;
    const record = { schemaVersion: 1, evidenceClass: "verified_chain", at: new Date().toISOString(), plan: e.p, messageBase64: message.toString("base64"), messageHash: createHash("sha256").update(message).digest("hex"), receiptHeader: Buffer.from(JSON.stringify({ success: true, transaction: e.signature })).toString("base64"), responseSha256: "0".repeat(64), evidence: { signature: e.signature, slot: 123, solscan: `https://solscan.io/tx/${e.signature}` }, quotes: [{ provider: "synthetic-test-only", inputAtomic: "1000000", outputAtomic: "10000", minOutAtomic: null }] };
    await expect(verifyPaidEvidence(record, rpc)).resolves.toMatchObject({ evidenceClass: "verified_chain" });
    e.status.value[0]!.confirmationStatus = "processed";
    await expect(verifyPaidEvidence(record, rpc)).rejects.toThrow("not confirmed");
    await expect(verifyPaidEvidence({ ...record, messageHash: "1".repeat(64) }, rpc)).rejects.toThrow("mismatch");
  });
});
