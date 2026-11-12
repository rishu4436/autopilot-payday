import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SCHEMA_SQL } from "../db/sql";
import { seedIfEmpty } from "../db/seed";
import type { AppDb } from "../db/client";
import type { Session } from "./session";
import { LiveTreasuryService, TREASURY_RELEASE, type TreasuryPreview } from "./live-treasury";
import { treasuryApprovalMessage } from "./treasury-execution";
import { TEST_TREASURY, TreasuryTestBank } from "../solana/__fixtures__/treasury-bank";
import { defaultPolicy } from "../domain/policy-doc";
import { USDC_MINT } from "../domain/tokens";
import { PublicKey } from "@solana/web3.js";
import { syntheticCpmmBuild } from "../solana/__fixtures__/cpmm";

let db: AppDb, client: PGlite, bank: TreasuryTestBank, service: LiveTreasuryService;
const session: Session = { id: "live-wallet-owner", userId: "user_owner", orgId: "org_northstar", role: "owner", authMode: "wallet", displayName: "Synthetic owner" };
const savedEnvironment = { APP_MODE: process.env.APP_MODE, LIVE_OPERATIONS: process.env.LIVE_OPERATIONS, TREASURY_EXECUTION_ENABLED: process.env.TREASURY_EXECUTION_ENABLED, TREASURY_REVIEWED_RELEASE: process.env.TREASURY_REVIEWED_RELEASE };
beforeAll(async () => { client = new PGlite(); await client.exec(SCHEMA_SQL); db = drizzle(client) as AppDb; }, 60_000);
beforeEach(async () => {
  const tables = (await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname='public'`)).rows;
  for (const row of tables) await db.execute(sql.raw(`truncate table "${row.tablename.replaceAll('"', '""')}" cascade`));
  process.env.APP_MODE = "demo"; await seedIfEmpty(db);
  process.env.APP_MODE = "live"; process.env.LIVE_OPERATIONS = "true"; process.env.TREASURY_EXECUTION_ENABLED = "true"; process.env.TREASURY_REVIEWED_RELEASE = TREASURY_RELEASE;
  bank = new TreasuryTestBank();
  await db.execute(sql`update organizations set mode='live',live_enabled=true where id=${session.orgId}`);
  await db.execute(sql`update users set wallet_address=${bank.owner} where id=${session.userId}`);
  await db.execute(sql`insert into sessions(id,user_id,org_id,role,auth_mode,expires_at,created_at) values (${session.id},${session.userId},${session.orgId},'owner','wallet',now()+interval '1 day',now())`);
  await db.execute(sql`update treasury_accounts set address=${bank.owner},sol_atomic='1000000000',usdc_atomic='150000000',source='synthetic-rpc' where kind='treasury'`);
  await db.execute(sql`update treasury_accounts set address=${Keypair.fromSeed(new Uint8Array(32).fill(231)).publicKey.toBase58()} where kind='api_payer'`);
  const policy = { ...defaultPolicy(), minTreasurySolAtomic: "20000000", minTreasuryUsdcAtomic: "0" };
  await db.execute(sql`update policies set body=${JSON.stringify(policy)} where org_id=${session.orgId}`);
  const tasks = (await db.execute<{ id: string; locked_recipient: string; amount_atomic: string }>(sql`select id,locked_recipient,amount_atomic from milestones where id in ('ms_brand','ms_eng','ms_film') order by id`)).rows;
  await db.execute(sql`insert into payroll_batches(id,org_id,status,total_atomic,operation_id,proposal_hash,evidence_class,created_at) values ('live-batch',${session.orgId},'APPROVED','125000000',null,'synthetic-owner-batch-approval','live_unpaid',now())`);
  for (const [i, task] of tasks.entries()) {
    bank.registerWallet(task.locked_recipient, 0n, false); // Exercise genuine ATA creation CPI decoding too.
    await db.execute(sql`insert into payroll_items(id,batch_id,milestone_id,amount_atomic,recipient,status) values (${`live-${i}`},'live-batch',${task.id},${task.amount_atomic},${task.locked_recipient},'PENDING')`);
  }
  const originalSend = bank.rpc.sendRawTransaction;
  bank.rpc.sendRawTransaction = vi.fn(async (bytes) => {
    const rows = (await db.execute<{ state: string; signed_base64: string }>(sql`select state,signed_base64 from treasury_attempts where state='UNKNOWN'`)).rows;
    expect(rows.some((row) => row.signed_base64 === Buffer.from(bytes).toString("base64"))).toBe(true);
    return originalSend(bytes);
  });
  service = new LiveTreasuryService(db, { rpc: bank.rpc as unknown as Connection, verificationRpc: bank.rpc as unknown as Connection });
}, 60_000);
afterAll(async () => {
  vi.useRealTimers();
  for (const [name, value] of Object.entries(savedEnvironment)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await client.close();
});
const signedApproval = (preview: TreasuryPreview) => bs58.encode(nacl.sign.detached(treasuryApprovalMessage(preview.manifest), TEST_TREASURY.secretKey));
const signedTx = (preview: TreasuryPreview) => { const tx = VersionedTransaction.deserialize(Buffer.from(preview.unsignedBase64, "base64")); tx.sign([TEST_TREASURY]); return Buffer.from(tx.serialize()).toString("base64"); };
async function approved() { const preview = await service.previewPayout(session, "live-batch"), approved = await service.approve(session, preview.id, signedApproval(preview)); return { preview, ...approved }; }
async function milestoneStates() { return (await db.execute<{ payment_status: string }>(sql`select payment_status from milestones where id in ('ms_brand','ms_eng','ms_film')`)).rows.map((row) => row.payment_status); }

describe("controlled live treasury with synthetic RPC, actual signatures and real SQL", () => {
  it("keeps submission off by default while allowing a read-only preview", async () => {
    process.env.TREASURY_EXECUTION_ENABLED = "false";
    const preview = await service.previewPayout(session, "live-batch");
    expect(preview.manifest.newAtas.length).toBeGreaterThan(0); expect(preview.submissionEnabled).toBe(false);
    await expect(service.approve(session, preview.id, signedApproval(preview))).rejects.toThrow("disabled"); expect(bank.sends).toBe(0);
  });
  it("rejects demo, role spoofing, wrong wallet and cross-organization ownership", async () => {
    for (const bad of [{ ...session, authMode: "demo" }, { ...session, role: "auditor" as const }, { ...session, orgId: "other" }, { ...session, userId: "user_auditor" }]) await expect(service.previewPayout(bad, "live-batch")).rejects.toThrow();
    await db.execute(sql`update organization_members set role='auditor' where user_id=${session.userId}`);
    await expect(service.previewPayout(session, "live-batch")).rejects.toThrow("owner wallet"); expect(bank.sends).toBe(0);
  });
  it("runs two exact payroll chunks through real RPC inspection and finalized bookkeeping", async () => {
    const first = await approved();
    const sent = await service.submitSigned(session, first.attemptId, signedTx(first.preview));
    expect(sent.state).toBe("UNKNOWN"); expect(sent.solscan).toBeNull();
    expect(await milestoneStates()).not.toContain("PAID");
    expect((await service.reconcile(session, first.attemptId)).state).toBe("CONFIRMED");
    const second = await approved();
    await service.submitSigned(session, second.attemptId, signedTx(second.preview));
    const result = await service.reconcile(session, second.attemptId);
    expect(result.solscan).toBe(`https://solscan.io/tx/${result.signature}`);
    expect(await milestoneStates()).toEqual(["PAID", "PAID", "PAID"]); expect(bank.sends).toBe(2);
    const batch = (await db.execute<{ status: string }>(sql`select status from payroll_batches where id='live-batch'`)).rows[0];
    expect(batch?.status).toBe("CONFIRMED");
    const funds = (await db.execute<{ usdc_atomic: string }>(sql`select usdc_atomic from treasury_accounts where kind='treasury'`)).rows[0];
    expect(funds?.usdc_atomic).toBe("25000000");
    await service.reconcile(session, first.attemptId); // Historical receipt must not rewind a newer balance.
    expect((await db.execute<{ usdc_atomic: string }>(sql`select usdc_atomic from treasury_accounts where kind='treasury'`)).rows[0]?.usdc_atomic).toBe("25000000");
    await expect(service.previewPayout(session, "live-batch")).rejects.toThrow();
  });
  it("rejects mutated messages and invalid signatures before any network dispatch", async () => {
    const a = await approved(), altered = VersionedTransaction.deserialize(Buffer.from(a.preview.unsignedBase64, "base64"));
    altered.message.recentBlockhash = Keypair.generate().publicKey.toBase58(); altered.sign([TEST_TREASURY]);
    await expect(service.submitSigned(session, a.attemptId, Buffer.from(altered.serialize()).toString("base64"))).rejects.toThrow("Unapproved");
    await expect(service.submitSigned(session, a.attemptId, a.preview.unsignedBase64)).rejects.toThrow("invalid signed"); expect(bank.sends).toBe(0);
    expect((await service.resume(session, a.attemptId)).manifest.messageHash).toBe(a.preview.manifest.messageHash);
  });
  it("serializes competing approvals and signed submissions, persisting bytes before dispatch", async () => {
    const p = await service.previewPayout(session, "live-batch");
    const approvals = await Promise.allSettled([service.approve(session, p.id, signedApproval(p)), service.approve(session, p.id, signedApproval(p))]);
    expect(approvals.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const id = (approvals.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ attemptId: string }>).value.attemptId;
    const results = await Promise.allSettled([service.submitSigned(session, id, signedTx(p)), service.submitSigned(session, id, signedTx(p))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(bank.sends).toBe(1);
  });
  it("reconciles a lost response without resubmitting or re-signing", async () => {
    bank.outcome = "timeout-landed";
    const a = await approved(); expect((await service.submitSigned(session, a.attemptId, signedTx(a.preview))).state).toBe("UNKNOWN");
    await expect(service.submitSaved(session, a.attemptId)).rejects.toThrow("never-dispatched");
    const restarted = new LiveTreasuryService(db, { rpc: bank.rpc as unknown as Connection, verificationRpc: bank.rpc as unknown as Connection });
    expect((await restarted.reconcile(session, a.attemptId)).state).toBe("CONFIRMED"); expect(bank.sends).toBe(1);
  });
  it("holds absent/uncertain transactions and does not claim an unpaid payroll is paid", async () => {
    bank.outcome = "timeout-absent"; const a = await approved(); await service.submitSigned(session, a.attemptId, signedTx(a.preview));
    expect((await service.reconcile(session, a.attemptId)).state).toBe("UNKNOWN");
    await expect(service.previewPayout(session, "live-batch")).rejects.toThrow("unresolved");
    await expect(service.submitSaved(session, a.attemptId)).rejects.toThrow(); expect(bank.sends).toBe(1); expect(await milestoneStates()).not.toContain("PAID");
  });
  it("handles partial success and a fresh retry only for the definitively failed chunk", async () => {
    const a = await approved(); await service.submitSigned(session, a.attemptId, signedTx(a.preview)); await service.reconcile(session, a.attemptId);
    bank.outcome = "failed"; const b = await approved(); await service.submitSigned(session, b.attemptId, signedTx(b.preview)); expect((await service.reconcile(session, b.attemptId)).state).toBe("FAILED");
    expect((await milestoneStates()).filter((s) => s === "PAID")).toHaveLength(a.preview.manifest.proposal.allocations.length);
    bank.outcome = "success"; const c = await approved();
    expect(c.preview.manifest.proposal.allocations).toEqual(b.preview.manifest.proposal.allocations);
    expect(c.preview.manifest.messageHash).not.toBe(b.preview.manifest.messageHash);
    await service.submitSigned(session, c.attemptId, signedTx(c.preview)); await service.reconcile(session, c.attemptId);
    await service.reconcile(session, b.attemptId); // Old failure must never overwrite the replacement's confirmed payment.
    expect(await milestoneStates()).toEqual(["PAID", "PAID", "PAID"]); expect(bank.sends).toBe(3);
    const chunks = (await db.execute<{ chunk_index: number }>(sql`select chunk_index from payout_transactions where batch_id='live-batch' order by chunk_index`)).rows;
    expect(chunks.map((row) => row.chunk_index)).toEqual([0, 1, 2]);
  });
  it("rechecks policy and allowlisting after the preview and before signing", async () => {
    const p = await service.previewPayout(session, "live-batch");
    await db.execute(sql`update contributors set allowlisted=false where address=${p.manifest.proposal.allocations[0]!.recipient}`);
    await expect(service.approve(session, p.id, signedApproval(p))).rejects.toThrow("allowlist"); expect(bank.sends).toBe(0);
  });
  it("requires a valid owner approval and refuses signed-byte substitution from another org", async () => {
    const p = await service.previewPayout(session, "live-batch");
    const wrong = Keypair.fromSeed(new Uint8Array(32).fill(229));
    await expect(service.approve(session, p.id, bs58.encode(nacl.sign.detached(treasuryApprovalMessage(p.manifest), wrong.secretKey)))).rejects.toThrow("signature mismatch");
    const a = await service.approve(session, p.id, signedApproval(p));
    await expect(service.resume({ ...session, orgId: "another" }, a.attemptId)).rejects.toThrow(); expect(bank.sends).toBe(0);
  });
  it("allows reconciliation after pause/revocation of the submission opt-in", async () => {
    const a = await approved(); await service.submitSigned(session, a.attemptId, signedTx(a.preview));
    process.env.TREASURY_EXECUTION_ENABLED = "false";
    const row = (await db.execute<{ body: string }>(sql`select body from policies where org_id=${session.orgId}`)).rows[0]!;
    await db.execute(sql`update policies set body=${JSON.stringify({ ...JSON.parse(row.body), paused: true })} where org_id=${session.orgId}`);
    expect((await service.reconcile(session, a.attemptId)).state).toBe("CONFIRMED"); expect(bank.sends).toBe(1);
  });
  it("rolls back finality bookkeeping atomically and recovers without another dispatch", async () => {
    const a = await approved(); await service.submitSigned(session, a.attemptId, signedTx(a.preview));
    await db.execute(sql`alter table payroll_items add constraint synthetic_settlement_failure check(status<>'CONFIRMED') not valid`);
    try {
      await expect(service.reconcile(session, a.attemptId)).rejects.toThrow();
      expect((await service.list(session, "payout", "live-batch"))[0]?.state).toBe("UNKNOWN"); expect(await milestoneStates()).not.toContain("PAID");
    } finally { await db.execute(sql`alter table payroll_items drop constraint synthetic_settlement_failure`); }
    expect((await service.reconcile(session, a.attemptId)).state).toBe("CONFIRMED"); expect(bank.sends).toBe(1);
  });
  it("protects a changed live USDC reserve before signing", async () => {
    const source = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), TEST_TREASURY.publicKey).toBase58();
    const a = await approved(); bank.accounts.get(source)!.amount = 1n;
    await expect(service.submitSigned(session, a.attemptId, signedTx(a.preview))).rejects.toThrow("USDC"); expect(bank.sends).toBe(0);
  });
  it("runs a constrained Swap.io unsigned build through validation, wallet signing and swap finality", async () => {
    const artifact = syntheticCpmmBuild(bank);
    const live = new LiveTreasuryService(db, { rpc: bank.rpc as unknown as Connection, verificationRpc: bank.rpc as unknown as Connection, verifyBuild: async () => artifact.record });
    const preview = await live.previewSwap(session, artifact);
    expect(preview.manifest.proposal.minOutputAtomic).toBe("10000"); expect(preview.manifest.closesWsol).toBe(true);
    const approved = await live.approve(session, preview.id, signedApproval(preview));
    await live.submitSigned(session, approved.attemptId, signedTx(preview));
    expect((await live.reconcile(session, approved.attemptId)).state).toBe("CONFIRMED"); expect(bank.sends).toBe(1);
    const funds = (await db.execute<{ usdc_atomic: string }>(sql`select usdc_atomic from treasury_accounts where kind='treasury'`)).rows[0]!;
    expect(funds.usdc_atomic).toBe("150010000");
    const replay = await live.previewSwap(session, artifact);
    await expect(live.approve(session, replay.id, signedApproval(replay))).rejects.toThrow();
    expect(bank.sends).toBe(1);
  });
  it("uses the verified settlement slot time rather than a caller-edited freshness timestamp", async () => {
    const artifact = syntheticCpmmBuild(bank);
    bank.rpc.getBlockTime = async () => Math.floor(Date.now() / 1000) - 3600;
    const live = new LiveTreasuryService(db, { rpc: bank.rpc as unknown as Connection, verificationRpc: bank.rpc as unknown as Connection, verifyBuild: async () => artifact.record });
    await expect(live.previewSwap(session, artifact)).rejects.toThrow("stale"); expect(bank.sends).toBe(0);
  });
  it("exports a public receipt only after finality and rechecks the independent chain", async () => {
    const a = await approved();
    await expect(service.exportReceipt(session, a.attemptId)).rejects.toThrow("Only a finalized");
    await service.submitSigned(session, a.attemptId, signedTx(a.preview));
    await expect(service.exportReceipt(session, a.attemptId)).rejects.toThrow("Only a finalized");
    await service.reconcile(session, a.attemptId);
    const receipt = await service.exportReceipt(session, a.attemptId);
    expect(receipt.commitment).toBe("finalized"); expect(receipt.recipients).toHaveLength(a.preview.manifest.proposal.allocations.length);
    expect(receipt.messageHash).toBe(a.preview.manifest.messageHash);
    expect(JSON.stringify(receipt)).not.toContain(a.preview.unsignedBase64);
    expect(JSON.stringify(receipt)).not.toContain("approval_signature");
    await expect(service.exportReceipt({ ...session, orgId: "other" }, a.attemptId)).rejects.toThrow();
    bank.rpc.getTransaction = async () => null;
    await expect(service.exportReceipt(session, a.attemptId)).rejects.toThrow("Finalized chain receipt");
    expect(bank.sends).toBe(1);
  });
});
