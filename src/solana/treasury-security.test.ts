import { SOLANA_MAINNET_GENESIS_HASH } from "./network";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { AuthorityType, TOKEN_PROGRAM_ID, createSetAuthorityInstruction, createSyncNativeInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { buildUsdcPayouts } from "./payout";
import { JUPITER_V6, inspectTreasuryTransaction, validateTreasurySimulation, type TreasuryContext, type TreasuryProposal } from "./treasury-guard";
import { TreasuryExecutionStore, treasuryApprovalMessage } from "../server/treasury-execution";
import { SCHEMA_SQL } from "../db/sql";
import { seedIfEmpty } from "../db/seed";
import type { AppDb } from "../db/client";
import { USDC_MINT, WSOL_MINT } from "../domain/tokens";
import { createHash } from "node:crypto";
import { inspectTreasuryFromRpc } from "./treasury-rpc";

// Deterministic unfunded fixture keys. No RPC submission exists in these tests.
const owner = Keypair.fromSeed(new Uint8Array(32).fill(201)), recipient = Keypair.fromSeed(new Uint8Array(32).fill(202)).publicKey;
const mint = new PublicKey(USDC_MINT), source = getAssociatedTokenAddressSync(mint, owner.publicKey), target = getAssociatedTokenAddressSync(mint, recipient);
function fixture(milestoneId = "ms_brand", amount = 40_000_000n) {
  const blockhash = Keypair.generate().publicKey.toBase58();
  const proposal: TreasuryProposal = { orgId: "org_northstar", batchId: "offline-test-batch", owner: owner.publicKey.toBase58(), kind: "payout", policyVersion: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), blockhash, lastValidBlockHeight: 100, maxInputAtomic: String(amount), minOutputAtomic: "0", maxSolDebitLamports: "10000", maxFeeLamports: "10000", maxRentLamports: "0", solReserveLamports: "1000000", slippageBps: 0, allocations: [{ id: `allocation-${milestoneId}`, milestoneId, recipient: recipient.toBase58(), amountAtomic: String(amount) }] };
  const base64 = buildUsdcPayouts({ payer: proposal.owner, recipients: [{ id: milestoneId, address: recipient.toBase58(), amountAtomic: amount }], blockhash, rentLamports: 0n })[0]!.base64;
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const context: TreasuryContext = { genesisHash: SOLANA_MAINNET_GENESIS_HASH, observedAt: Date.now(), accounts: new Map(), allowlistedRecipients: new Set([recipient.toBase58()]), networkFeeLamports: 5000n, rentPerAccountLamports: 2039280n, blockHeight: 50, reviewedRoutes: [] };
  for (const key of tx.message.staticAccountKeys) context.accounts.set(key.toBase58(), { address: key.toBase58(), exists: true, lamports: 10_000_000n });
  for (const ix of TransactionMessage.decompile(tx.message).instructions) context.accounts.get(ix.programId.toBase58())!.executable = true;
  context.accounts.set(source.toBase58(), { address: source.toBase58(), exists: true, lamports: 2039280n, mint: USDC_MINT, authority: proposal.owner, amount: 100_000_000n });
  context.accounts.set(target.toBase58(), { address: target.toBase58(), exists: true, lamports: 2039280n, mint: USDC_MINT, authority: recipient.toBase58(), amount: 0n });
  const manifest = inspectTreasuryTransaction(base64, proposal, context);
  const after = structuredClone(context.accounts);
  after.get(proposal.owner)!.lamports -= 5000n; after.get(source.toBase58())!.amount! -= amount; after.get(target.toBase58())!.amount! += amount;
  const simulation = { err: null, logs: [], after, innerInstructions: [] as TransactionInstruction[] };
  const approval = bs58.encode(nacl.sign.detached(treasuryApprovalMessage(manifest), owner.secretKey));
  const validation = { before: context, simulation };
  const signed = () => { tx.sign([owner]); return Buffer.from(tx.serialize()).toString("base64"); };
  return { tx, proposal, base64, context, manifest, simulation, validation, approval, signed };
}
function altered(f: ReturnType<typeof fixture>, mutate: (ixs: TransactionInstruction[]) => void) {
  const instructions = TransactionMessage.decompile(f.tx.message).instructions; mutate(instructions);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: f.proposal.blockhash, instructions }).compileToV0Message());
  return Buffer.from(tx.serialize()).toString("base64");
}
describe("offline treasury instruction and effects boundary", () => {
  function rpcFixture(f: ReturnType<typeof fixture>) {
    const keys = f.tx.message.staticAccountKeys;
    const info = (state: TreasuryContext["accounts"], address: string) => {
      const a = state.get(address)!; const data = Buffer.alloc(a.mint ? 165 : 0);
      if (a.mint) { new PublicKey(a.mint).toBuffer().copy(data); new PublicKey(a.authority!).toBuffer().copy(data, 32); data.writeBigUInt64LE(a.amount!, 64); data[108] = 1; }
      return { executable: a.executable ?? false, owner: a.mint ? TOKEN_PROGRAM_ID : SystemProgram.programId, data, lamports: Number(a.lamports), rentEpoch: 0 };
    };
    return {
      getGenesisHash: vi.fn(async () => f.context.genesisHash), getFeeForMessage: vi.fn(async () => ({ context: { slot: 123 }, value: 5000 })), getBlockHeight: vi.fn(async () => 50), isBlockhashValid: vi.fn(async () => ({ context: { slot: 123 }, value: true })), getMinimumBalanceForRentExemption: vi.fn(async () => 2039280),
      getMultipleAccountsInfoAndContext: vi.fn(async () => ({ context: { slot: 123 }, value: keys.map((key) => info(f.context.accounts, key.toBase58())) })),
      simulateTransaction: vi.fn(async (_tx: VersionedTransaction, _config: unknown) => ({ context: { slot: 124 }, value: { err: null, logs: [], innerInstructions: [], accounts: keys.map((key) => { const a = info(f.simulation.after, key.toBase58()); return { ...a, owner: a.owner.toBase58(), data: [a.data.toString("base64"), "base64"] }; }) } })),
    };
  }
  it("collects trusted RPC account/fee/blockhash data and simulates without replacing the approved message", async () => {
    const f = fixture(), rpc = rpcFixture(f);
    const result = await inspectTreasuryFromRpc(rpc as unknown as Connection, f.base64, f.proposal, f.context.allowlistedRecipients);
    expect(result.manifest.messageHash).toBe(f.manifest.messageHash);
    expect(rpc.simulateTransaction.mock.calls[0]?.[1]).toMatchObject({ sigVerify: false, replaceRecentBlockhash: false, minContextSlot: 123, innerInstructions: true });
  });
  it("refuses wrong-network RPC and incomplete simulation evidence", async () => {
    const f = fixture(), rpc = rpcFixture(f);
    rpc.getGenesisHash.mockResolvedValue("devnet");
    await expect(inspectTreasuryFromRpc(rpc as unknown as Connection, f.base64, f.proposal, f.context.allowlistedRecipients)).rejects.toThrow("mainnet");
    rpc.getGenesisHash.mockResolvedValue(f.context.genesisHash);
    rpc.simulateTransaction.mockResolvedValue({ context: { slot: 124 }, value: { err: null, logs: [], innerInstructions: [], accounts: [] } });
    await expect(inspectTreasuryFromRpc(rpc as unknown as Connection, f.base64, f.proposal, f.context.allowlistedRecipients)).rejects.toThrow("omitted complete");
  });
  it("accepts exactly approved checked USDC payroll and complete simulated effects", () => {
    const f = fixture(); expect(f.manifest.tokenDebits[source.toBase58()]).toBe("40000000");
    validateTreasurySimulation(f.manifest, f.context, f.simulation);
  });
  it.each(["amount", "destination", "authority", "mint", "decimals"])("rejects changed payout %s", (field) => {
    const f = fixture(), body = altered(f, (ixs) => {
      const ix = ixs.at(-1)!;
      if (field === "amount") ix.data.writeBigUInt64LE(1n, 1);
      if (field === "destination") ix.keys[2]!.pubkey = source;
      if (field === "authority") ix.keys[3]!.pubkey = recipient;
      if (field === "mint") ix.keys[1]!.pubkey = recipient;
      if (field === "decimals") ix.data[9] = 9;
    });
    expect(() => inspectTreasuryTransaction(body, f.proposal, f.context)).toThrow();
  });
  it("rejects authority changes, hidden SOL transfers, unknown programs, ALT and extra signers", () => {
    const f = fixture();
    const dangerous = [createSetAuthorityInstruction(source, owner.publicKey, AuthorityType.AccountOwner, recipient), SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: recipient, lamports: 1 }), new TransactionInstruction({ programId: recipient, keys: [], data: Buffer.alloc(0) })];
    for (const ix of dangerous) expect(() => inspectTreasuryTransaction(altered(f, (ixs) => { ixs.push(ix); }), f.proposal, f.context)).toThrow();
    const tx = VersionedTransaction.deserialize(Buffer.from(altered(f, () => {}), "base64"));
    if (tx.message.version !== 0) throw new Error("Expected v0");
    tx.message.addressTableLookups.push({ accountKey: recipient, readonlyIndexes: [0], writableIndexes: [] });
    expect(() => inspectTreasuryTransaction(Buffer.from(tx.serialize()).toString("base64"), f.proposal, f.context)).toThrow("lookup");
  });
  it("rejects unapproved recipients, stale/wrong-network data, expired proposals and insufficient reserves", () => {
    const f = fixture();
    for (const context of [{ ...f.context, allowlistedRecipients: new Set<string>() }, { ...f.context, genesisHash: "devnet" }, { ...f.context, observedAt: Date.now() - 20000 }, { ...f.context, networkFeeLamports: 10001n }]) expect(() => inspectTreasuryTransaction(f.base64, f.proposal, context)).toThrow();
    expect(() => inspectTreasuryTransaction(f.base64, { ...f.proposal, expiresAt: new Date(0).toISOString() }, f.context)).toThrow();
    expect(() => inspectTreasuryTransaction(f.base64, { ...f.proposal, solReserveLamports: "10000001" }, f.context)).toThrow("reserve");
  });
  it("rejects successful-looking simulations with dangerous CPI, debit or recipient effects", () => {
    const f = fixture();
    const evil = createSetAuthorityInstruction(source, owner.publicKey, AuthorityType.AccountOwner, recipient);
    expect(() => validateTreasurySimulation(f.manifest, f.context, { ...f.simulation, innerInstructions: [evil] })).toThrow("Dangerous");
    const after = structuredClone(f.simulation.after); after.get(target.toBase58())!.authority = owner.publicKey.toBase58();
    expect(() => validateTreasurySimulation(f.manifest, f.context, { ...f.simulation, after })).toThrow("credit");
    expect(() => validateTreasurySimulation(f.manifest, f.context, { ...f.simulation, logs: [`Program ${recipient} invoke [2]`] })).toThrow("program");
  });
  it("rejects missing/unknown swap routes rather than trusting provider output", () => {
    const f = fixture();
    expect(() => inspectTreasuryTransaction(f.base64, { ...f.proposal, kind: "swap", allocations: [], minOutputAtomic: "1" }, f.context)).toThrow();
    expect(f.context.reviewedRoutes).toEqual([]);
  });
  it("decodes a fixture-only single-hop Jupiter ABI and rejects unreviewed pool accounts", () => {
    const f = fixture(), jupiter = new PublicKey(JUPITER_V6), wsol = getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT), owner.publicKey);
    const poolSol = Keypair.generate().publicKey, poolUsdc = Keypair.generate().publicKey, fixtureProgram = Keypair.generate().publicKey;
    const event = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], jupiter)[0];
    const data = Buffer.alloc(35); createHash("sha256").update("global:route").digest().copy(data, 0, 0, 8);
    data.writeUInt32LE(1, 8); data[12] = 7; data[13] = 100; data[14] = 0; data[15] = 1; data.writeBigUInt64LE(1_000_000n, 16); data.writeBigUInt64LE(10000n, 24);
    const fixed = [TOKEN_PROGRAM_ID, owner.publicKey, wsol, source, jupiter, mint, jupiter, event, jupiter];
    const remaining = [{ address: poolSol.toBase58(), writable: true }, { address: poolUsdc.toBase58(), writable: true }, { address: fixtureProgram.toBase58(), writable: false }];
    const route = new TransactionInstruction({ programId: jupiter, data, keys: [...fixed.map((pubkey, i) => ({ pubkey, isSigner: i === 1, isWritable: i === 2 || i === 3 })), ...remaining.map((r) => ({ pubkey: new PublicKey(r.address), isSigner: false, isWritable: r.writable }))] });
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: f.proposal.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }), SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: wsol, lamports: 1_000_000 }), createSyncNativeInstruction(wsol), route] }).compileToV0Message());
    const context = structuredClone(f.context);
    for (const key of tx.message.staticAccountKeys) if (!context.accounts.has(key.toBase58())) context.accounts.set(key.toBase58(), { address: key.toBase58(), exists: true, lamports: 2039280n });
    for (const address of [JUPITER_V6, SystemProgram.programId.toBase58(), fixtureProgram.toBase58()]) context.accounts.get(address)!.executable = true;
    context.accounts.set(wsol.toBase58(), { address: wsol.toBase58(), exists: true, lamports: 2039280n, mint: WSOL_MINT, authority: f.proposal.owner, amount: 0n });
    context.accounts.set(poolSol.toBase58(), { address: poolSol.toBase58(), exists: true, lamports: 2039280n, mint: WSOL_MINT, authority: fixtureProgram.toBase58(), amount: 0n });
    context.accounts.set(poolUsdc.toBase58(), { address: poolUsdc.toBase58(), exists: true, lamports: 2039280n, mint: USDC_MINT, authority: fixtureProgram.toBase58(), amount: 1_000_000n });
    const proposal: TreasuryProposal = { ...f.proposal, kind: "swap", allocations: [], maxInputAtomic: "1000000", minOutputAtomic: "10000", maxSolDebitLamports: "1005000" };
    const base64 = Buffer.from(tx.serialize()).toString("base64");
    expect(() => inspectTreasuryTransaction(base64, proposal, context)).toThrow("reviewed pool");
    context.reviewedRoutes = [{ id: "synthetic-only-never-production", remainingAccounts: remaining, innerPrograms: [fixtureProgram.toBase58()] }];
    const manifest = inspectTreasuryTransaction(base64, proposal, context), after = structuredClone(context.accounts);
    after.get(proposal.owner)!.lamports -= 1005000n; after.get(source.toBase58())!.amount! += 10000n;
    const innerInstructions = [createTransferInstruction(wsol, poolSol, owner.publicKey, 1_000_000n), createTransferInstruction(poolUsdc, source, fixtureProgram, 10000n)];
    validateTreasurySimulation(manifest, context, { err: null, logs: [], after, innerInstructions });
    innerInstructions[0]!.data.writeBigUInt64LE(1_000_001n, 1);
    expect(() => validateTreasurySimulation(manifest, context, { err: null, logs: [], after, innerInstructions })).toThrow("routed input");
  });
});

let db: AppDb, store: TreasuryExecutionStore;
beforeAll(async () => {
  const client = new PGlite(); await client.exec(SCHEMA_SQL);
  db = drizzle(client) as AppDb;
  process.env.APP_MODE = "demo"; await seedIfEmpty(db);
  await db.execute(sql`update organizations set mode='live_readonly' where id='org_northstar'`);
  await db.execute(sql`update users set wallet_address=${owner.publicKey.toBase58()} where id='user_owner'`);
  await db.execute(sql`insert into sessions(id,user_id,org_id,role,auth_mode,expires_at,created_at) values ('offline-owner','user_owner','org_northstar','owner','wallet',now()+interval '1 day',now())`);
  await db.execute(sql`update contributors set address=${recipient.toBase58()} where id in ('con_maya','con_leo')`);
  await db.execute(sql`update milestones set locked_recipient=${recipient.toBase58()} where id in ('ms_brand','ms_eng')`);
  store = new TreasuryExecutionStore(db);
}, 60_000);
beforeEach(async () => {
  await db.execute(sql`truncate treasury_allocation_claims, treasury_attempts`);
  await db.execute(sql`update contributors set allowlisted=true`);
});
const prepare = (f: ReturnType<typeof fixture>) => store.prepare(f.manifest, "offline-owner", f.approval, f.validation);
function chain(f: ReturnType<typeof fixture>, signature: string, err: unknown = null) {
  const keys = f.tx.message.staticAccountKeys, balances = (after: boolean) => keys.map((k) => Number((after ? f.simulation.after : f.context.accounts).get(k.toBase58())?.lamports ?? 0n));
  const tokens = (after: boolean) => [...(after ? f.simulation.after : f.context.accounts)].filter(([, a]) => a.mint).map(([address, a]) => ({ accountIndex: keys.findIndex((k) => k.toBase58() === address), owner: a.authority, mint: a.mint, uiTokenAmount: { amount: String(a.amount), decimals: 6 } }));
  const record = { slot: 99, transaction: { message: f.tx.message, signatures: [signature] }, meta: { err, fee: 5000, innerInstructions: [], preBalances: balances(false), postBalances: balances(true), preTokenBalances: tokens(false), postTokenBalances: tokens(true) } };
  return { getGenesisHash: vi.fn(async () => SOLANA_MAINNET_GENESIS_HASH), getSignatureStatuses: vi.fn(async () => ({ value: [{ confirmationStatus: "finalized", err }] })), getTransaction: vi.fn(async () => record) } as unknown as Connection;
}
describe("durable treasury ledger with a real SQL database", () => {
  it("requires owner authorization, unchanged manifest and current allowlists", async () => {
    const f = fixture();
    await expect(store.prepare(f.manifest, "unknown", f.approval, f.validation)).rejects.toThrow("owner session");
    await expect(store.prepare({ ...f.manifest, messageHash: "0".repeat(64) }, "offline-owner", f.approval, f.validation)).rejects.toThrow("changed");
    await db.execute(sql`update contributors set allowlisted=false where id='con_maya'`);
    await expect(prepare(f)).rejects.toThrow("allowlist");
  });
  it("serializes competing claims for one milestone and prevents replay after confirmation", async () => {
    const a = fixture(), b = fixture();
    const results = await Promise.allSettled([prepare(a), prepare(b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const index = results.findIndex((r) => r.status === "fulfilled"), f = index ? b : a, id = (results[index] as PromiseFulfilledResult<string>).value;
    const signature = await store.recordSigned(id, f.signed()); await store.holdForReconciliation(id);
    expect(await store.reconcile(id, chain(f, signature))).toBe("CONFIRMED");
    await expect(prepare(fixture())).rejects.toThrow();
    expect(await store.rollup(f.proposal.orgId, "offline-test-batch")).toEqual({ confirmed: 1, held: 0, failed: 0 });
  });
  it("retains signed bytes and unknown allocations through restart and blockhash expiry", async () => {
    const f = fixture(), id = await prepare(f), signed = f.signed();
    await store.recordSigned(id, signed); await store.holdForReconciliation(id);
    const restarted = new TreasuryExecutionStore(db), rpc = chain(f, "unused");
    vi.mocked(rpc.getSignatureStatuses).mockResolvedValue({ context: { slot: 200 }, value: [null] });
    expect(await restarted.reconcile(id, rpc)).toBe("UNKNOWN");
    expect((await restarted.get(id)).signed_base64).toBe(signed);
    await expect(prepare(fixture())).rejects.toThrow();
    await expect(restarted.recordSigned(id, signed)).rejects.toThrow();
  });
  it("rejects mutated signed messages and concurrent duplicate dispatch claims", async () => {
    const f = fixture(), id = await prepare(f), other = fixture();
    await expect(store.recordSigned(id, other.signed())).rejects.toThrow("Unapproved");
    await store.recordSigned(id, f.signed());
    const results = await Promise.allSettled([store.holdForReconciliation(id), store.holdForReconciliation(id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("handles partial payroll and releases only a finalized failed chunk", async () => {
    const a = fixture(), b = fixture("ms_eng", 50_000_000n), idA = await prepare(a), idB = await prepare(b);
    const sigA = await store.recordSigned(idA, a.signed()), sigB = await store.recordSigned(idB, b.signed());
    await store.holdForReconciliation(idA); await store.holdForReconciliation(idB);
    expect(await store.reconcile(idA, chain(a, sigA))).toBe("CONFIRMED");
    expect(await store.reconcile(idB, chain(b, sigB, { InstructionError: [1, "Custom"] }))).toBe("FAILED");
    expect(await store.rollup(a.proposal.orgId, "offline-test-batch")).toEqual({ confirmed: 1, held: 0, failed: 1 });
    await expect(prepare(fixture())).rejects.toThrow();
    await expect(prepare(fixture("ms_eng", 50_000_000n))).resolves.toBeTypeOf("string");
  });
});
