import { sql } from "drizzle-orm";
import { TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { type AppDb } from "../db/client";
import { type Session } from "./session";
import { loadBooks } from "./books";
import { type Books } from "./books";
import { buildUsdcPayouts } from "../solana/payout";
import { inspectTreasuryFromRpc } from "../solana/treasury-rpc";
import { readCpmmProfiles } from "../solana/raydium-cpmm";
import { type TreasuryManifest, type TreasuryProposal } from "../solana/treasury-guard";
import { canonicalUnsignedSwap, validateOriginalBuildResponse, verifyPaidBuildEvidence } from "../hermes/build-evidence";
import { TreasuryExecutionStore, treasuryApprovalMessage, verifyTreasuryEffects, type TreasuryAttempt } from "./treasury-execution";
import { canonicalJson } from "../domain/approval";
import { USDC_MINT } from "../domain/tokens";

export const TREASURY_RELEASE = "controlled-swap-payroll-v1";
export function treasuryExecutionEnabled(): boolean {
  return process.env.LIVE_OPERATIONS === "true" && process.env.TREASURY_EXECUTION_ENABLED === "true" && process.env.TREASURY_REVIEWED_RELEASE === TREASURY_RELEASE;
}
const MAX_SWAP = 10_000_000n, MAX_PAYOUT = 100_000_000n, MAX_FEE = 200_000n, MIN_SOL_RESERVE = 5_000_000n, MAX_RENT = 20_000_000n;
type Draft = { id: string; org_id: string; user_id: string; unsigned_base64: string; manifest: string; source_id: string | null; expires_at: Date | string };
export interface TreasuryPreview {
  id: string; owner: string; kind: "swap" | "payout"; batchId: string | null;
  unsignedBase64: string; approvalMessage: string; manifest: TreasuryManifest; submissionEnabled: boolean;
  apiPaymentSignature?: string;
}
export type TreasuryAttemptView = { id: string; kind: "swap" | "payout"; batchId: string | null; state: string; signature: string | null; solscan: string | null; expiresAt: string; resumable: boolean };
export interface LiveTreasuryDependencies {
  rpc: Connection; verificationRpc: Connection;
  inspect?: typeof inspectTreasuryFromRpc; profiles?: typeof readCpmmProfiles;
  verifyBuild?: typeof verifyPaidBuildEvidence; canonicalSwap?: typeof canonicalUnsignedSwap;
}
// The service never has a private key or invokes a wallet. Only an explicit
// browser wallet approval can supply the two owner signatures it requires.
export class LiveTreasuryService {
  constructor(private readonly db: AppDb, private readonly deps: LiveTreasuryDependencies) {}
  private async principal(session: Session, submit = false, reconciling = false): Promise<Books> {
    if (process.env.APP_MODE === "demo" || session.authMode !== "wallet" || session.role !== "owner") throw new Error("Live treasury requires the wallet-authenticated owner of a non-demo organization");
    const auth = await this.db.execute<{ wallet_address: string }>(sql`select u.wallet_address from sessions s join users u on u.id=s.user_id join organization_members m on m.user_id=s.user_id and m.org_id=s.org_id where s.id=${session.id} and s.user_id=${session.userId} and s.org_id=${session.orgId} and s.role='owner' and m.role='owner' and s.auth_mode='wallet' and s.expires_at>now()`);
    const books = await loadBooks(this.db, session.orgId);
    if (auth.rows.length !== 1 || books.org.mode === "demo" || auth.rows[0]!.wallet_address !== books.treasury.address) throw new Error("Current owner wallet must match the configured treasury");
    if (!reconciling && (!books.policy.enabled || books.policy.paused || books.policy.executionMode !== "approval_required" || !books.policy.allowedMints.includes(USDC_MINT))) throw new Error("Policy pauses or disallows new treasury execution");
    if (submit && (process.env.APP_MODE !== "live" || !treasuryExecutionEnabled() || books.org.mode !== "live" || !books.org.liveEnabled)) throw new Error("Treasury submission is disabled pending security review and explicit live opt-in");
    return books;
  }
  private async locked<T>(session: Session, work: (service: LiveTreasuryService) => Promise<T>): Promise<T> {
    const books = await this.principal(session, false, true);
    return this.db.transaction(async (tx) => {
      for (const name of [`org:${session.orgId}`, `treasury:${books.treasury.address}`]) {
        await tx.execute(sql`insert into locks(name,owner,expires_at) values (${name},'live-treasury',now()) on conflict do nothing`);
        await tx.execute(sql`select name from locks where name=${name} for update`);
      }
      return work(new LiveTreasuryService(tx as unknown as AppDb, this.deps));
    });
  }
  private async activeWallet(owner: string, excluding?: string): Promise<void> {
    const rows = await this.db.execute(sql`select id from treasury_attempts where state in ('PREPARED','SIGNED','UNKNOWN') and manifest::jsonb->'proposal'->>'owner'=${owner} and (${excluding ?? ""}='' or id<>${excluding ?? ""}) limit 1`);
    if (rows.rows.length) throw new Error("An existing treasury attempt is unresolved; reconcile or resume that exact transaction before preparing another");
  }
  private proposal(books: Books, kind: "swap" | "payout", blockhash: string, lastValidBlockHeight: number): TreasuryProposal {
    return { orgId: books.org.id, batchId: null, owner: books.treasury.address, kind, policyVersion: books.policy.version, expiresAt: new Date(Date.now() + 90_000).toISOString(), blockhash, lastValidBlockHeight, maxInputAtomic: "0", minOutputAtomic: "0", maxSolDebitLamports: (MAX_FEE + MAX_RENT).toString(), maxFeeLamports: MAX_FEE.toString(), maxRentLamports: MAX_RENT.toString(), solReserveLamports: (BigInt(books.policy.minTreasurySolAtomic) > MIN_SOL_RESERVE ? BigInt(books.policy.minTreasurySolAtomic) : MIN_SOL_RESERVE).toString(), usdcReserveAtomic: books.policy.minTreasuryUsdcAtomic, slippageBps: Math.min(50, books.policy.slippageCeilingBps), allocations: [] };
  }
  private recipients(books: Books): Set<string> { return new Set(books.people.filter((p) => p.active && p.allowlisted && p.mint === USDC_MINT).map((p) => p.address)); }
  private async inspect(base64: string, p: TreasuryProposal, books: Books) {
    const profiles = p.kind === "swap" ? await (this.deps.profiles ?? readCpmmProfiles)(this.deps.rpc, base64) : [];
    return (this.deps.inspect ?? inspectTreasuryFromRpc)(this.deps.rpc, base64, p, this.recipients(books), profiles);
  }
  private async persistPreview(session: Session, unsigned: string, manifest: TreasuryManifest, sourceId: string | null): Promise<TreasuryPreview> {
    const id = crypto.randomUUID();
    await this.db.execute(sql`insert into treasury_drafts(id,org_id,user_id,unsigned_base64,manifest,source_id,expires_at) values (${id},${session.orgId},${session.userId},${unsigned},${JSON.stringify(manifest)},${sourceId},${manifest.proposal.expiresAt})`);
    return this.preview({ id, org_id: session.orgId, user_id: session.userId, unsigned_base64: unsigned, manifest: JSON.stringify(manifest), source_id: sourceId, expires_at: manifest.proposal.expiresAt });
  }
  private preview(row: Draft): TreasuryPreview {
    const m = JSON.parse(row.manifest) as TreasuryManifest;
    return { id: row.id, owner: m.proposal.owner, kind: m.proposal.kind, batchId: m.proposal.batchId, unsignedBase64: row.unsigned_base64, approvalMessage: Buffer.from(treasuryApprovalMessage(m)).toString("utf8"), manifest: m, submissionEnabled: treasuryExecutionEnabled(), ...(m.proposal.kind === "swap" && row.source_id ? { apiPaymentSignature: row.source_id } : {}) };
  }
  private async batchItems(books: Books, batchId: string) {
    const batch = books.batchRows.find((b) => b.id === batchId);
    if (!batch || batch.evidenceClass === "simulated" || !["APPROVED", "PARTIAL", "UNKNOWN", "CONFIRMING"].includes(batch.status) || !batch.proposalHash) throw new Error("An authorized live payroll batch is required");
    const items = books.items.filter((item) => item.batchId === batchId && ["PENDING", "FAILED"].includes(item.status)).sort((a, b) => a.id.localeCompare(b.id));
    let total = 0n;
    const chosen: typeof items = [];
    for (const item of items) {
      const task = books.tasks.find((t) => t.id === item.milestoneId), person = task && books.people.find((p) => p.id === task.contributorId);
      if (!task || task.workStatus !== "APPROVED" || ["PAID", "PAYMENT_SUBMITTED", "UNKNOWN"].includes(task.paymentStatus) || task.lockedAmount !== item.amountAtomic || task.amountAtomic !== item.amountAtomic || task.lockedRecipient !== item.recipient || !person?.active || !person.allowlisted || person.address !== item.recipient || person.mint !== USDC_MINT || task.mint !== USDC_MINT || item.recipient === books.treasury.address) throw new Error("Payroll amount, recipient, approval or allowlist changed");
      const amount = BigInt(item.amountAtomic);
      if (amount <= 0n || amount > MAX_PAYOUT) throw new Error("A live milestone must fit the 100 USDC transaction ceiling");
      if (chosen.length === 6 || total + amount > MAX_PAYOUT) break;
      chosen.push(item); total += amount;
    }
    if (!chosen.length) throw new Error("No unpaid, unclaimed payroll items remain");
    return { chosen, total };
  }
  async previewPayout(session: Session, batchId: string): Promise<TreasuryPreview> {
    const books = await this.principal(session); await this.activeWallet(books.treasury.address);
    const { chosen, total } = await this.batchItems(books, batchId), latest = await this.deps.rpc.getLatestBlockhash("confirmed");
    const p = this.proposal(books, "payout", latest.blockhash, latest.lastValidBlockHeight);
    p.batchId = batchId; p.maxInputAtomic = total.toString(); p.allocations = chosen.map((item) => ({ id: item.id, milestoneId: item.milestoneId, recipient: item.recipient, amountAtomic: item.amountAtomic }));
    const unsigned = buildUsdcPayouts({ payer: p.owner, blockhash: p.blockhash, recipients: p.allocations.map((a) => ({ id: a.id, address: a.recipient, amountAtomic: BigInt(a.amountAtomic) })), rentLamports: null })[0]!.base64;
    const original = VersionedTransaction.deserialize(Buffer.from(unsigned, "base64"));
    const canonical = Buffer.from(new VersionedTransaction(TransactionMessage.decompile(original.message).compileToV0Message()).serialize()).toString("base64");
    const inspected = await this.inspect(canonical, p, books);
    return this.persistPreview(session, canonical, inspected.manifest, batchId);
  }
  async previewSwap(session: Session, artifact: unknown): Promise<TreasuryPreview> {
    const books = await this.principal(session); await this.activeWallet(books.treasury.address);
    const object = artifact as { record?: unknown; response?: { status: number; receipt: string; body: string } };
    if (!object || typeof object !== "object" || !object.record || !object.response) throw new Error("Upload the verified Swap.io build artifact, not a wallet key or arbitrary transaction");
    const build = await (this.deps.verifyBuild ?? verifyPaidBuildEvidence)(object.record, this.deps.verificationRpc);
    validateOriginalBuildResponse(build, object.response);
    const blockTime = await this.deps.verificationRpc.getBlockTime(build.evidence.slot);
    if (blockTime === null || !Number.isSafeInteger(blockTime) || blockTime * 1000 > Date.now() + 30_000 || Date.now() - blockTime * 1000 > books.policy.maxQuoteAgeMs || build.plan.payer !== books.payer.address || build.plan.body.userAddress !== books.treasury.address || Date.parse(build.at) > Date.now() + 30_000 || build.plan.quote.slippageBps > books.policy.slippageCeilingBps || BigInt(build.plan.quote.inputAtomic) > MAX_SWAP) throw new Error("Build is stale, for another treasury/API payer, or exceeds swap/slippage policy (0.01 SOL maximum)");
    const unsigned = await (this.deps.canonicalSwap ?? canonicalUnsignedSwap)(this.deps.rpc, build.build.transaction, books.treasury.address);
    const p = this.proposal(books, "swap", unsigned.blockhash, unsigned.lastValidBlockHeight);
    p.maxInputAtomic = build.plan.quote.inputAtomic; p.minOutputAtomic = build.plan.quote.minOutputAtomic; p.slippageBps = build.plan.quote.slippageBps;
    p.maxSolDebitLamports = (BigInt(p.maxInputAtomic) + MAX_FEE + MAX_RENT).toString();
    p.expiresAt = new Date(Math.min(Date.parse(p.expiresAt), blockTime * 1000 + books.policy.maxQuoteAgeMs)).toISOString();
    const inspected = await this.inspect(unsigned.base64, p, books);
    return this.persistPreview(session, unsigned.base64, inspected.manifest, build.evidence.signature);
  }
  private async draft(session: Session, id: string): Promise<Draft> {
    const row = (await this.db.execute<Draft>(sql`select * from treasury_drafts where id=${id} and org_id=${session.orgId} and user_id=${session.userId}`)).rows[0];
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) throw new Error("Preview is missing, expired or belongs to another owner"); return row;
  }
  private async revalidate(session: Session, row: Draft) {
    const books = await this.principal(session, true), m = JSON.parse(row.manifest) as TreasuryManifest;
    if (m.proposal.policyVersion !== books.policy.version || m.proposal.solReserveLamports !== (BigInt(books.policy.minTreasurySolAtomic) > MIN_SOL_RESERVE ? BigInt(books.policy.minTreasurySolAtomic) : MIN_SOL_RESERVE).toString() || m.proposal.usdcReserveAtomic !== books.policy.minTreasuryUsdcAtomic || m.proposal.slippageBps > books.policy.slippageCeilingBps) throw new Error("Policy changed; review a new immutable preview");
    if (m.proposal.batchId) {
      const { chosen } = await this.batchItems(books, m.proposal.batchId);
      if (canonicalJson(chosen.map((i) => ({ id: i.id, milestoneId: i.milestoneId, recipient: i.recipient, amountAtomic: i.amountAtomic }))) !== canonicalJson(m.proposal.allocations)) throw new Error("Payroll chunk changed; approval is invalid");
    }
    const result = await this.inspect(row.unsigned_base64, m.proposal, books);
    if (canonicalJson(result.manifest) !== canonicalJson(m)) throw new Error("Transaction costs/accounts changed; review a new preview");
    return result;
  }
  async approve(session: Session, draftId: string, signature: string): Promise<{ attemptId: string; unsignedBase64: string }> {
    return this.locked(session, async (service) => {
      const row = await service.draft(session, draftId), m = JSON.parse(row.manifest) as TreasuryManifest;
      await service.activeWallet(m.proposal.owner);
      const result = await service.revalidate(session, row);
      const id = await new TreasuryExecutionStore(service.db).prepare(m, session.id, signature, result.validation);
      await service.db.execute(sql`update treasury_attempts set draft_id=${row.id},source_key=${m.proposal.kind === "swap" ? row.source_id : null} where id=${id}`);
      await service.event(session, "treasury.approved", id, { proposalHash: m.proposalHash, messageHash: m.messageHash });
      return { attemptId: id, unsignedBase64: row.unsigned_base64 };
    });
  }
  private async attempt(session: Session, id: string): Promise<TreasuryAttempt> {
    const row = await new TreasuryExecutionStore(this.db).get(id);
    if (row.org_id !== session.orgId || !row.draft_id) throw new Error("Execution attempt is outside this organization or managed flow"); return row;
  }
  async resume(session: Session, id: string): Promise<TreasuryPreview> {
    await this.principal(session, true); const row = await this.attempt(session, id);
    if (row.state !== "PREPARED") throw new Error("This attempt cannot be signed again; reconcile its stored signature");
    const draft = await this.draft(session, row.draft_id!); await this.revalidate(session, draft); return this.preview(draft);
  }
  async submitSigned(session: Session, id: string, signed: string) {
    await this.locked(session, async (service) => {
      const row = await service.attempt(session, id), draft = await service.draft(session, row.draft_id!);
      await service.revalidate(session, draft);
      await new TreasuryExecutionStore(service.db).recordSigned(id, signed);
      await service.event(session, "treasury.signed", id, { persistedBeforeBroadcast: true });
    });
    return this.submitSaved(session, id);
  }
  async submitSaved(session: Session, id: string): Promise<TreasuryAttemptView> {
    const claimed = await this.locked(session, async (service) => {
      const row = await service.attempt(session, id);
      if (row.state !== "SIGNED" || !row.signed_base64 || !row.signature) throw new Error("Only a stored never-dispatched transaction may be submitted; reconcile this attempt");
      await service.revalidate(session, await service.draft(session, row.draft_id!));
      await new TreasuryExecutionStore(service.db).holdForReconciliation(id);
      await service.markSubmitted(session, row);
      await service.event(session, "treasury.dispatch_claimed", id, { signature: row.signature, noAutomaticRetry: true });
      return row;
    });
    // Commit UNKNOWN and the signed bytes before entering the network call.
    // A timeout, process crash, or mismatched RPC signature never permits another dispatch.
    try {
      if (await this.deps.rpc.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new Error("Expected mainnet RPC");
      const returned = await this.deps.rpc.sendRawTransaction(Buffer.from(claimed.signed_base64!, "base64"), { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" });
      if (returned !== claimed.signature) throw new Error("RPC signature mismatch; preserve the original deterministic signature");
    } catch { /* UNKNOWN is durable; only chain reconciliation can resolve it. */ }
    return this.view(await this.attempt(session, id));
  }
  private async markSubmitted(session: Session, row: TreasuryAttempt) {
    const m = JSON.parse(row.manifest) as TreasuryManifest;
    if (m.proposal.batchId) {
      for (const a of m.proposal.allocations) {
        await this.db.execute(sql`update payroll_items set status='UNKNOWN' where id=${a.id} and batch_id=${m.proposal.batchId}`);
        await this.db.execute(sql`update milestones set payment_status='UNKNOWN',updated_at=now() where id=${a.milestoneId} and org_id=${session.orgId}`);
      }
      await this.db.execute(sql`update payroll_batches set status='UNKNOWN' where id=${m.proposal.batchId} and org_id=${session.orgId}`);
      const index = (await this.db.execute<{ next: number }>(sql`select coalesce(max(chunk_index),-1)+1 as next from payout_transactions where batch_id=${m.proposal.batchId}`)).rows[0]!.next;
      await this.db.execute(sql`insert into payout_transactions(id,org_id,batch_id,chunk_index,signature,status,evidence_class,detail,created_at) values (${row.id},${session.orgId},${m.proposal.batchId},${index},${row.signature},'UNKNOWN','live_unverified','Submitted once; awaiting finalized chain evidence',now()) on conflict(id) do nothing`);
    }
  }
  async reconcile(session: Session, id: string): Promise<TreasuryAttemptView> {
    await this.principal(session, false, true);
    return this.locked(session, async (service) => {
      const row = await service.attempt(session, id);
      const state = await new TreasuryExecutionStore(service.db).reconcile(id, service.deps.verificationRpc);
      const result = await service.attempt(session, id);
      if (["CONFIRMED", "FAILED"].includes(state)) await service.applySettlement(session, result);
      await service.event(session, "treasury.reconciled", id, { state, signature: row.signature });
      return service.view(result);
    });
  }
  private async applySettlement(session: Session, row: TreasuryAttempt) {
    const applied = await this.db.execute(sql`update treasury_attempts set accounting_applied=true where id=${row.id} and accounting_applied=false returning id`);
    if (!applied.rows.length) return;
    const m = JSON.parse(row.manifest) as TreasuryManifest, confirmed = row.state === "CONFIRMED";
    if (m.proposal.batchId) {
      for (const a of m.proposal.allocations) {
        await this.db.execute(sql`update payroll_items set status=${confirmed ? "CONFIRMED" : "FAILED"} where id=${a.id} and batch_id=${m.proposal.batchId}`);
        await this.db.execute(sql`update milestones set payment_status=${confirmed ? "PAID" : "PAYMENT_FAILED"},updated_at=now() where id=${a.milestoneId} and org_id=${session.orgId} and locked_amount=${a.amountAtomic} and locked_recipient=${a.recipient}`);
      }
      const items = (await this.db.execute<{ status: string }>(sql`select status from payroll_items where batch_id=${m.proposal.batchId}`)).rows;
      const status = items.every((i) => i.status === "CONFIRMED") ? "CONFIRMED" : items.some((i) => i.status === "CONFIRMED") ? "PARTIAL" : items.some((i) => i.status === "UNKNOWN") ? "UNKNOWN" : "APPROVED";
      await this.db.execute(sql`update payroll_batches set status=${status},evidence_class=${status === "CONFIRMED" ? "verified_chain" : "live_unverified"} where id=${m.proposal.batchId} and org_id=${session.orgId}`);
      await this.db.execute(sql`update payout_transactions set status=${row.state},evidence_class=${confirmed ? "verified_chain" : "failed_chain"},detail=${confirmed ? "Finalized exact USDC credits and debit verified" : "Finalized transaction failure; no payroll transfer completed"} where id=${row.id}`);
    }
    const evidence = row.evidence ? JSON.parse(row.evidence) as { balances?: { solAtomic: string; usdcAtomic: string }; slot?: number } : null;
    if (evidence?.balances && Number.isSafeInteger(evidence.slot)) await this.db.execute(sql`update treasury_accounts set sol_atomic=${evidence.balances.solAtomic},usdc_atomic=${evidence.balances.usdcAtomic},source='rpc_finalized',observed_at=now(),observed_slot=${evidence.slot!} where org_id=${session.orgId} and kind='treasury' and (observed_slot is null or observed_slot<=${evidence.slot!})`);
  }
  private async event(session: Session, action: string, id: string, data: unknown) {
    await this.db.execute(sql`insert into audit_events(id,org_id,actor_id,action,entity,entity_id,data,created_at) values (${crypto.randomUUID()},${session.orgId},${session.userId},${action},'treasury_attempt',${id},${JSON.stringify(data)},now())`);
  }
  private view(row: TreasuryAttempt): TreasuryAttemptView {
    const p = (JSON.parse(row.manifest) as TreasuryManifest).proposal;
    return { id: row.id, kind: p.kind, batchId: p.batchId, state: row.state, signature: row.signature, solscan: row.state === "CONFIRMED" && row.signature ? `https://solscan.io/tx/${row.signature}` : null, expiresAt: p.expiresAt, resumable: row.state === "PREPARED" && Date.parse(p.expiresAt) > Date.now() };
  }
  async list(session: Session, kind: "swap" | "payout", batchId?: string): Promise<TreasuryAttemptView[]> {
    await this.principal(session, false, true);
    const rows = await this.db.execute<TreasuryAttempt>(sql`select * from treasury_attempts where org_id=${session.orgId} and draft_id is not null and manifest::jsonb->'proposal'->>'kind'=${kind} and (${batchId ?? ""}='' or batch_id=${batchId ?? ""}) order by created_at desc limit 30`);
    return rows.rows.map((row) => this.view(row));
  }
  async exportReceipt(session: Session, id: string) {
    await this.principal(session, false, true);
    const row = await this.attempt(session, id), m = JSON.parse(row.manifest) as TreasuryManifest;
    if (row.state !== "CONFIRMED" || !row.signature) throw new Error("Only a finalized verified transaction can be exported");
    const rpc = this.deps.verificationRpc;
    if (await rpc.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new Error("Expected mainnet RPC");
    const chain = await rpc.getTransaction(row.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    if (!chain?.meta || chain.meta.err || chain.transaction.signatures[0] !== row.signature || !Buffer.from(chain.transaction.message.serialize()).equals(Buffer.from(m.messageBase64, "base64"))) throw new Error("Finalized chain receipt no longer matches the approved transaction");
    const balances = await verifyTreasuryEffects(m, chain);
    return {
      schema: "autopilot-payday/verified-treasury-receipt/v1", network: "solana-mainnet", commitment: "finalized",
      verifiedAt: new Date().toISOString(), kind: m.proposal.kind, signature: row.signature,
      solscan: `https://solscan.io/tx/${row.signature}`, slot: chain.slot, blockTime: chain.blockTime ?? null,
      treasury: m.proposal.owner, usdcMint: USDC_MINT, feeLamports: chain.meta.fee.toString(),
      authorizedInputAtomic: m.proposal.maxInputAtomic, inputUnit: m.proposal.kind === "swap" ? "lamports" : "USDC atomic",
      minimumOutputUsdcAtomic: m.proposal.minOutputAtomic,
      recipients: m.proposal.allocations.map((a) => ({ address: a.recipient, usdcAtomic: a.amountAtomic })),
      proposalHash: m.proposalHash, messageHash: m.messageHash, finalizedTreasuryBalances: balances,
    };
  }
}
