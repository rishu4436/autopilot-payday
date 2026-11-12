import { assertMainnetRpc, SOLANA_MAINNET_GENESIS_HASH } from "../solana/network";
// Durable execution ledger. Submission is handled by the separately gated live service.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import type { AppDb } from "../db/client";
import { inspectTreasuryTransaction, treasuryProposalHash, validateTreasurySimulation, type TreasuryManifest, type TreasuryContext } from "../solana/treasury-guard";
import { canonicalJson } from "../domain/approval";
import { decodeRpcInstruction } from "../solana/rpc-instructions";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "../domain/tokens";
import type { Connection } from "@solana/web3.js";

export function treasuryApprovalMessage(m: TreasuryManifest): Uint8Array {
  const p = m.proposal;
  return Buffer.from(`Autopilot Payday treasury approval\nNetwork: Solana mainnet\nOrganization: ${p.orgId}\nKind: ${p.kind}\nTreasury: ${p.owner}\nInput atomic (${p.kind === "swap" ? "lamports" : "USDC"}): ${p.maxInputAtomic}\nMinimum output USDC atomic: ${p.minOutputAtomic}\nMaximum SOL debit lamports: ${p.maxSolDebitLamports}\nMaximum fee lamports: ${p.maxFeeLamports}\nMaximum rent lamports: ${p.maxRentLamports}\nSOL reserve lamports: ${p.solReserveLamports}\nUSDC reserve atomic: ${p.usdcReserveAtomic ?? "0"}\nRecipients: ${p.allocations.map((a) => `${a.recipient}=${a.amountAtomic} USDC atomic (${a.milestoneId})`).join("; ") || p.owner}\nPolicy: ${p.policyVersion}\nProposal: ${m.proposalHash}\nMessage: ${m.messageHash}\nExpires: ${p.expiresAt}`);
}
export type TreasuryAttempt = { id: string; org_id: string; batch_id: string | null; draft_id: string | null; state: string; manifest: string; signature: string | null; signed_base64: string | null; evidence?: string | null };
export class TreasuryExecutionStore {
  constructor(private readonly db: AppDb) {}
  async prepare(manifest: TreasuryManifest, sessionId: string, approvalSignature: string, validation: { before: TreasuryContext; simulation: Parameters<typeof validateTreasurySimulation>[2] }): Promise<string> {
    // Take a snapshot before the first await; caller mutation cannot change the approved data.
    const m = structuredClone(manifest), p = m.proposal;
    if (treasuryProposalHash(p) !== m.proposalHash || createHash("sha256").update(Buffer.from(m.messageBase64, "base64")).digest("hex") !== m.messageHash || Date.parse(p.expiresAt) <= Date.now()) throw new Error("Proposal or message changed/expired");
    const message = VersionedTransaction.deserialize(Buffer.concat([Buffer.from([1]), Buffer.alloc(64), Buffer.from(m.messageBase64, "base64")])).message;
    const inspected = inspectTreasuryTransaction(Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"), p, validation.before);
    if (canonicalJson(inspected) !== canonicalJson(m)) throw new Error("Manifest differs from independently inspected message");
    validateTreasurySimulation(inspected, validation.before, validation.simulation);
    if (message.header.numRequiredSignatures !== 1 || message.staticAccountKeys[0]?.toBase58() !== p.owner || message.recentBlockhash !== p.blockhash || !nacl.sign.detached.verify(treasuryApprovalMessage(m), bs58.decode(approvalSignature), message.staticAccountKeys[0]!.toBytes())) throw new Error("Owner approval signature mismatch");
    return this.db.transaction(async (tx) => {
      // Same organization lock as all existing web mutations; also protects policy/recipient edits.
      await tx.execute(sql`insert into locks(name,owner,expires_at) values (${`org:${p.orgId}`}, 'treasury-ledger', now()) on conflict do nothing`);
      await tx.execute(sql`select name from locks where name=${`org:${p.orgId}`} for update`);
      const authorization = await tx.execute(sql`select s.id from sessions s join users u on u.id=s.user_id join organization_members m on m.org_id=s.org_id and m.user_id=s.user_id join organizations o on o.id=s.org_id where s.id=${sessionId} and s.org_id=${p.orgId} and s.auth_mode='wallet' and s.role='owner' and m.role='owner' and u.wallet_address=${p.owner} and s.expires_at>now() and o.mode<>'demo'`);
      if (authorization.rows.length !== 1) throw new Error("Current wallet owner session required");
      const policy = await tx.execute<{ version: number }>(sql`select version from policies where org_id=${p.orgId} order by version desc limit 1`);
      if (policy.rows[0]?.version !== p.policyVersion) throw new Error("Policy version changed");
      for (const a of p.allocations) {
        const allocation = await tx.execute(sql`select t.id from milestones t join contributors c on c.id=t.contributor_id and c.org_id=t.org_id where t.org_id=${p.orgId} and t.id=${a.milestoneId} and t.work_status='APPROVED' and t.payment_status in ('UNPAID','READY_FOR_PAYMENT','FUNDING_REQUIRED','PAYMENT_FAILED') and t.mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' and c.mint=t.mint and t.amount_atomic=t.locked_amount and t.locked_amount=${a.amountAtomic} and t.locked_recipient=${a.recipient} and c.active=true and c.allowlisted=true and c.address=${a.recipient} for update`);
        if (allocation.rows.length !== 1) throw new Error("Milestone, amount or allowlist changed");
      }
      const id = crypto.randomUUID();
      await tx.execute(sql`insert into treasury_attempts(id,org_id,batch_id,proposal_hash,message_hash,manifest,approval_signature,state) values (${id},${p.orgId},${p.batchId},${m.proposalHash},${m.messageHash},${JSON.stringify(m)},${approvalSignature},'PREPARED')`);
      for (const a of p.allocations) await tx.execute(sql`insert into treasury_allocation_claims(org_id,milestone_id,attempt_id,allocation_id,recipient,amount_atomic) values (${p.orgId},${a.milestoneId},${id},${a.id},${a.recipient},${a.amountAtomic})`);
      return id;
    });
  }
  async get(id: string): Promise<TreasuryAttempt> {
    const row = (await this.db.execute<TreasuryAttempt>(sql`select * from treasury_attempts where id=${id}`)).rows[0];
    if (!row) throw new Error("Unknown execution attempt"); return row;
  }
  async recordSigned(id: string, base64: string): Promise<string> {
    const row = await this.get(id), m = JSON.parse(row.manifest) as TreasuryManifest, tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    const bytes = tx.message.serialize();
    if (row.state !== "PREPARED" || Date.parse(m.proposal.expiresAt) <= Date.now() || !Buffer.from(bytes).equals(Buffer.from(m.messageBase64, "base64")) || tx.signatures.length !== tx.message.header.numRequiredSignatures || tx.signatures.some((sig, i) => !nacl.sign.detached.verify(bytes, sig, tx.message.staticAccountKeys[i]!.toBytes()))) throw new Error("Unapproved or invalid signed transaction");
    const signature = bs58.encode(tx.signatures[0]!);
    const updated = await this.db.execute(sql`update treasury_attempts set state='SIGNED',signature=${signature},signed_base64=${base64},updated_at=now() where id=${id} and state='PREPARED' returning id`);
    if (updated.rows.length !== 1) throw new Error("Concurrent/repeated signing attempt");
    return signature; // Bytes and signature durably stored BEFORE any possible future dispatch.
  }
  async holdForReconciliation(id: string): Promise<void> {
    const updated = await this.db.execute(sql`update treasury_attempts set state='UNKNOWN',updated_at=now() where id=${id} and state='SIGNED' returning id`);
    if (updated.rows.length !== 1) throw new Error("Attempt already dispatched or held");
  }
  async reconcile(id: string, rpc: Connection): Promise<string> {
    const row = await this.get(id), m = JSON.parse(row.manifest) as TreasuryManifest;
    if (["CONFIRMED", "FAILED"].includes(row.state)) return row.state;
    if (!row.signature || !row.signed_base64) throw new Error("No signed transaction to reconcile");
    await assertMainnetRpc(rpc);
    const status = (await rpc.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
    // Absence, expiry and transport failure are never proof that an allocation is unpaid.
    if (!status || status.confirmationStatus !== "finalized") return "UNKNOWN";
    const chain = await rpc.getTransaction(row.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    if (!chain?.meta || chain.transaction.signatures[0] !== row.signature || !Buffer.from(chain.transaction.message.serialize()).equals(Buffer.from(m.messageBase64, "base64"))) throw new Error("Chain message mismatch");
    if (Boolean(status.err) !== Boolean(chain.meta.err)) throw new Error("Inconsistent chain outcome");
    const next = chain.meta.err ? "FAILED" : "CONFIRMED";
    // Settlement is deliberately still gated: positive success needs the full asset-effects validator.
    const balances = next === "CONFIRMED" ? await verifyTreasuryEffects(m, chain) : null;
    await this.db.transaction(async (tx) => {
      const changed = await tx.execute(sql`update treasury_attempts set state=${next},evidence=${JSON.stringify({ slot: chain.slot, signature: row.signature, err: chain.meta!.err, balances })},updated_at=now() where id=${id} and state in ('SIGNED','UNKNOWN') returning id`);
      if (!changed.rows.length) return;
      if (next === "FAILED") await tx.execute(sql`delete from treasury_allocation_claims where attempt_id=${id}`);
      // Confirmed claims remain forever. Existing demo tables are not advanced by this offline ledger.
    });
    return next;
  }
  async rollup(orgId: string, batchId: string): Promise<{ confirmed: number; held: number; failed: number }> {
    const rows = (await this.db.execute<{ state: string }>(sql`select state from treasury_attempts where org_id=${orgId} and batch_id=${batchId}`)).rows;
    return { confirmed: rows.filter((r) => r.state === "CONFIRMED").length, failed: rows.filter((r) => r.state === "FAILED").length, held: rows.filter((r) => !["CONFIRMED", "FAILED"].includes(r.state)).length };
  }
}
export async function verifyTreasuryEffects(m: TreasuryManifest, tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>): Promise<{ solAtomic: string; usdcAtomic: string }> {
  const meta = tx.meta!, keys = tx.transaction.message.staticAccountKeys;
  const ownerIndex = keys.findIndex((key) => key.toBase58() === m.proposal.owner);
  if (ownerIndex < 0 || meta.fee > Number(m.proposal.maxFeeLamports) || BigInt(meta.preBalances[ownerIndex]! - meta.postBalances[ownerIndex]!) > BigInt(m.proposal.maxSolDebitLamports) || BigInt(meta.postBalances[ownerIndex]!) < BigInt(m.proposal.solReserveLamports)) throw new Error("Unexpected SOL effects");
  const before: TreasuryContext = { genesisHash: SOLANA_MAINNET_GENESIS_HASH, observedAt: Date.now(), accounts: new Map(), allowlistedRecipients: new Set(m.proposal.allocations.map((a) => a.recipient)), networkFeeLamports: BigInt(meta.fee), rentPerAccountLamports: BigInt(m.rentPerAccountLamports), blockHeight: 0, reviewedRoutes: [] };
  const after: TreasuryContext["accounts"] = new Map();
  keys.forEach((key, i) => {
    if (!Number.isSafeInteger(meta.preBalances[i]) || !Number.isSafeInteger(meta.postBalances[i])) throw new Error("Unsafe RPC balance precision");
    const pre = meta.preTokenBalances?.find((b) => b.accountIndex === i), post = meta.postTokenBalances?.find((b) => b.accountIndex === i), address = key.toBase58();
    before.accounts.set(address, { address, exists: meta.preBalances[i]! > 0, lamports: BigInt(meta.preBalances[i]!), mint: pre?.mint, authority: pre?.owner, amount: pre ? BigInt(pre.uiTokenAmount.amount) : undefined });
    after.set(address, { address, exists: meta.postBalances[i]! > 0, lamports: BigInt(meta.postBalances[i]!), mint: post?.mint, authority: post?.owner, amount: post ? BigInt(post.uiTokenAmount.amount) : undefined });
  });
  if (meta.innerInstructions == null && meta.logMessages?.some((line) => /^Program \S+ invoke \[[2-9]\d*\]/.test(line))) throw new Error("Missing inner settlement evidence");
  const innerInstructions = (meta.innerInstructions ?? []).flatMap((group) => group.instructions.map((ix) => decodeRpcInstruction(ix, tx.transaction.message)));
  validateTreasurySimulation(m, before, { err: meta.err, logs: meta.logMessages ?? [], after, innerInstructions });
  for (const [address, amount] of [...Object.entries(m.tokenDebits).map(([a, v]) => [a, -BigInt(v)] as const), ...Object.entries(m.tokenCredits).map(([a, v]) => [a, BigInt(v)] as const)]) {
    const index = keys.findIndex((key) => key.toBase58() === address), pre = meta.preTokenBalances?.find((b) => b.accountIndex === index), post = meta.postTokenBalances?.find((b) => b.accountIndex === index);
    const owner = m.ataOwners[address] ?? m.proposal.owner;
    const delta = BigInt(post?.uiTokenAmount.amount ?? "0") - BigInt(pre?.uiTokenAmount.amount ?? "0");
    if (!post || post.mint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" || post.owner !== owner || post.uiTokenAmount.decimals !== 6 || (pre && (pre.mint !== post.mint || pre.owner !== owner || pre.uiTokenAmount.decimals !== 6)) || (m.proposal.kind === "swap" && amount > 0n ? delta < amount : delta !== amount)) throw new Error("Unexpected token settlement effects");
  }
  const ownerAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(m.proposal.owner));
  const index = keys.findIndex((key) => key.equals(ownerAta)), balance = meta.postTokenBalances?.find((b) => b.accountIndex === index && b.mint === USDC_MINT && b.owner === m.proposal.owner);
  if (!balance) throw new Error("Missing finalized treasury USDC balance");
  return { solAtomic: meta.postBalances[ownerIndex]!.toString(), usdcAtomic: balance.uiTokenAmount.amount };
}
