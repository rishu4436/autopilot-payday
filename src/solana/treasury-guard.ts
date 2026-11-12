import { SOLANA_MAINNET_GENESIS_HASH } from "./network";
import { createHash } from "node:crypto";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, decodeTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { canonicalJson } from "../domain/approval";
import { USDC_MINT, WSOL_MINT } from "../domain/tokens";
import { RAYDIUM_CPMM, CPMM_SWAP_INPUT } from "./raydium-cpmm";

export const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const ROUTE = createHash("sha256").update("global:route").digest().subarray(0, 8);
const ata = (mint: string, owner: string) => getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true).toBase58();
export interface TreasuryProposal {
  orgId: string; batchId: string | null; owner: string; kind: "swap" | "payout"; policyVersion: number;
  expiresAt: string; blockhash: string; lastValidBlockHeight: number;
  maxInputAtomic: string; minOutputAtomic: string; maxSolDebitLamports: string;
  maxFeeLamports: string; maxRentLamports: string; solReserveLamports: string; slippageBps: number;
  usdcReserveAtomic?: string;
  allocations: { id: string; milestoneId: string; recipient: string; amountAtomic: string }[];
}
export interface AccountSnapshot { address: string; lamports: bigint; exists: boolean; executable?: boolean; mint?: string; authority?: string; amount?: bigint }
export interface ReviewedRoute {
  id: string;
  kind?: "raydium-cpmm" | "jupiter-raydium-v4";
  // Must come from a separately security-reviewed registry, never providerQuote.
  remainingAccounts: { address: string; writable: boolean }[];
  innerPrograms: string[];
}
export interface TreasuryContext {
  genesisHash: string; observedAt: number;
  accounts: Map<string, AccountSnapshot>; allowlistedRecipients: Set<string>;
  networkFeeLamports: bigint; rentPerAccountLamports: bigint; blockHeight: number;
  reviewedRoutes: readonly ReviewedRoute[];
}
export interface TreasuryManifest {
  proposal: TreasuryProposal; proposalHash: string; messageHash: string; messageBase64: string;
  programs: string[]; allowedInnerPrograms: string[]; tokenDebits: Record<string, string>; tokenCredits: Record<string, string>;
  ataOwners: Record<string, string>; newAtas: string[]; maxSolDebit: string; closesWsol: boolean; rentPerAccountLamports: string;
}
export function treasuryProposalHash(proposal: TreasuryProposal): string {
  return createHash("sha256").update(canonicalJson(proposal)).digest("hex");
}
export function inspectTreasuryTransaction(base64: string, proposal: TreasuryProposal, context: TreasuryContext, now = Date.now()): TreasuryManifest {
  if (context.genesisHash !== SOLANA_MAINNET_GENESIS_HASH || context.observedAt > now || now - context.observedAt > 15_000) throw new Error("Fresh mainnet snapshots required");
  if (!["swap", "payout"].includes(proposal.kind) || !Number.isSafeInteger(context.blockHeight) || !Number.isSafeInteger(proposal.lastValidBlockHeight)) throw new Error("Invalid proposal kind or block height");
  if (proposal.kind === "payout" && !proposal.batchId) throw new Error("Payroll approval requires an immutable batch ID");
  if (!proposal.orgId || !Number.isSafeInteger(proposal.policyVersion) || proposal.policyVersion < 1 || !Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= now || context.blockHeight > proposal.lastValidBlockHeight) throw new Error("Expired proposal or blockhash");
  for (const value of [proposal.maxInputAtomic, proposal.minOutputAtomic, proposal.maxSolDebitLamports, proposal.maxFeeLamports, proposal.maxRentLamports, proposal.solReserveLamports]) if (!/^\d{1,20}$/.test(value)) throw new Error("Invalid atomic-unit ceiling");
  if (!Number.isInteger(proposal.slippageBps) || proposal.slippageBps < 0 || proposal.slippageBps > 100) throw new Error("Slippage ceiling exceeded");
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64")), message = tx.message;
  if (message.version === 0 && message.addressTableLookups.length) throw new Error("Unresolved lookup tables are forbidden pending a reviewed resolver");
  if (message.recentBlockhash !== proposal.blockhash || message.header.numRequiredSignatures !== 1 || message.staticAccountKeys[0]?.toBase58() !== proposal.owner) throw new Error("Unexpected fee payer, signers or blockhash");
  if (context.networkFeeLamports < 0n || context.networkFeeLamports > BigInt(proposal.maxFeeLamports)) throw new Error("Network fee ceiling exceeded");
  const owner = context.accounts.get(proposal.owner);
  if (!owner?.exists) throw new Error("Missing treasury balance snapshot");
  const instructions = TransactionMessage.decompile(message).instructions;
  const source = ata(proposal.kind === "swap" ? WSOL_MINT : USDC_MINT, proposal.owner), destination = ata(USDC_MINT, proposal.owner);
  const debit: Record<string, string> = {}, credit: Record<string, string> = {}, ataOwners: Record<string, string> = {};
  const allowedAtas = new Map<string, { owner: string; mint: string }>();
  const expected = new Map<string, number>();
  if (new Set(proposal.allocations.map((a) => a.id)).size !== proposal.allocations.length || new Set(proposal.allocations.map((a) => a.milestoneId)).size !== proposal.allocations.length) throw new Error("Duplicate allocation or milestone");
  let total = 0n;
  for (const a of proposal.allocations) {
    if (!a.id || !a.milestoneId || !/^[1-9]\d{0,18}$/.test(a.amountAtomic) || !context.allowlistedRecipients.has(a.recipient)) throw new Error("Unapproved recipient or amount");
    const address = ata(USDC_MINT, a.recipient), key = `${address}:${a.amountAtomic}`;
    expected.set(key, (expected.get(key) ?? 0) + 1); allowedAtas.set(address, { owner: a.recipient, mint: USDC_MINT });
    credit[address] = ((BigInt(credit[address] ?? "0")) + BigInt(a.amountAtomic)).toString(); total += BigInt(a.amountAtomic);
  }
  if (proposal.kind === "payout" && (!proposal.allocations.length || total !== BigInt(proposal.maxInputAtomic))) throw new Error("Payout list does not match its approved amount");
  if (proposal.kind === "swap" && (proposal.allocations.length || BigInt(proposal.maxInputAtomic) <= 0n || BigInt(proposal.minOutputAtomic) <= 0n)) throw new Error("Invalid swap proposal");
  if (proposal.kind === "swap") { allowedAtas.set(source, { owner: proposal.owner, mint: WSOL_MINT }); allowedAtas.set(destination, { owner: proposal.owner, mint: USDC_MINT }); credit[destination] = proposal.minOutputAtomic; }
  for (const [address, expectedAccount] of allowedAtas) {
    const snapshot = context.accounts.get(address);
    if (!snapshot || (snapshot.exists && (snapshot.mint !== expectedAccount.mint || snapshot.authority !== expectedAccount.owner))) throw new Error("Recipient token account has an unexpected mint or authority");
    ataOwners[address] = expectedAccount.owner;
  }
  let funding = 0n, routes = 0, limit = 0, price = 0, syncs = 0, closed = false;
  const created = new Set<string>(), programs = new Set<string>(), inner = new Set([TOKEN_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), SystemProgram.programId.toBase58(), JUPITER_V6]);
  for (const ix of instructions) {
    const program = ix.programId.toBase58(); programs.add(program);
    if (!context.accounts.get(program)?.executable) throw new Error("Unverified executable program");
    for (const key of ix.keys) if (!context.accounts.has(key.pubkey.toBase58())) throw new Error("Unresolved instruction account");
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      if (ix.keys.length) throw new Error("Unexpected compute accounts");
      if (ix.data[0] === 2 && ix.data.length === 5 && !limit) { limit = ix.data.readUInt32LE(1); if (!limit || limit > 400_000) throw new Error("Compute ceiling exceeded"); }
      else if (ix.data[0] === 3 && ix.data.length === 9 && !price) { const value = ix.data.readBigUInt64LE(1); if (value > 100_000n) throw new Error("Priority fee ceiling exceeded"); price = Number(value) + 1; }
      else throw new Error("Unexpected compute instruction");
    } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.keys.length !== 6) throw new Error("Only idempotent ATA creation is permitted");
      const [payer, account, recipient, mint, system, token] = ix.keys, approved = account && allowedAtas.get(account.pubkey.toBase58());
      if (!approved || payer?.pubkey.toBase58() !== proposal.owner || !payer.isSigner || recipient?.pubkey.toBase58() !== approved.owner || mint?.pubkey.toBase58() !== approved.mint || !system?.pubkey.equals(SystemProgram.programId) || !token?.pubkey.equals(TOKEN_PROGRAM_ID) || created.has(account!.pubkey.toBase58())) throw new Error("Unexpected token account creation");
      created.add(account!.pubkey.toBase58()); ataOwners[account!.pubkey.toBase58()] = approved.owner;
    } else if (ix.programId.equals(SystemProgram.programId)) {
      if (proposal.kind !== "swap" || ix.data.length !== 12 || ix.data.readUInt32LE(0) !== 2 || ix.keys.length !== 2 || ix.keys[0]?.pubkey.toBase58() !== proposal.owner || ix.keys[1]?.pubkey.toBase58() !== source || routes || funding) throw new Error("Unexpected SOL transfer or system instruction");
      funding = ix.data.readBigUInt64LE(4); if (funding !== BigInt(proposal.maxInputAtomic)) throw new Error("SOL funding exceeds the immutable swap input");
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (proposal.kind === "payout" && ix.data.length === 10 && ix.data[0] === 12 && ix.keys.length === 4) {
        const decoded = decodeTransferCheckedInstruction(ix), target = decoded.keys.destination.pubkey.toBase58(), key = `${target}:${decoded.data.amount}`;
        if (decoded.keys.source.pubkey.toBase58() !== source || decoded.keys.owner.pubkey.toBase58() !== proposal.owner || !decoded.keys.owner.isSigner || decoded.keys.mint.pubkey.toBase58() !== USDC_MINT || decoded.data.decimals !== 6 || !(expected.get(key) ?? 0)) throw new Error("Unexpected USDC transfer");
        expected.set(key, expected.get(key)! - 1);
      } else if (proposal.kind === "swap" && ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1 && ix.keys[0]?.pubkey.toBase58() === source && !routes && !syncs) { syncs++; }
      else if (proposal.kind === "swap" && ix.data.length === 1 && ix.data[0] === 9 && ix.keys.length === 3 && ix.keys[0]?.pubkey.toBase58() === source && ix.keys[1]?.pubkey.toBase58() === proposal.owner && ix.keys[2]?.pubkey.toBase58() === proposal.owner && routes === 1 && !closed) { closed = true; }
      else throw new Error("Authority change, approval, account closure or unexpected token instruction");
    } else if (program === RAYDIUM_CPMM) {
      if (proposal.kind !== "swap" || routes++ || !funding || syncs !== 1 || ix.data.length !== 24 || !ix.data.subarray(0, 8).equals(CPMM_SWAP_INPUT) || ix.keys.length !== 13 || ix.keys[0]!.pubkey.toBase58() !== proposal.owner || !ix.keys[0]!.isSigner || ix.keys[4]!.pubkey.toBase58() !== source || ix.keys[5]!.pubkey.toBase58() !== destination || ix.data.readBigUInt64LE(8) !== BigInt(proposal.maxInputAtomic) || ix.data.readBigUInt64LE(16) < BigInt(proposal.minOutputAtomic)) throw new Error("CPMM input, minimum output, signer or destination differs from approval");
      const accounts = ix.keys.map((key) => ({ address: key.pubkey.toBase58(), writable: key.isWritable }));
      const reviewed = context.reviewedRoutes.find((profile) => profile.kind === "raydium-cpmm" && canonicalJson(profile.remainingAccounts) === canonicalJson(accounts));
      if (!reviewed || ix.keys.slice(1).some((key) => key.isSigner)) throw new Error("CPMM pool lacks independent account verification");
      inner.add(RAYDIUM_CPMM);
    } else if (program === JUPITER_V6) {
      if (proposal.kind !== "swap" || routes++ || !funding || syncs !== 1 || ix.data.length !== 35 || !ix.data.subarray(0, 8).equals(ROUTE) || ix.data.readUInt32LE(8) !== 1 || ix.data[12] !== 7 || ix.data[13] !== 100 || ix.data[14] !== 0 || ix.data[15] !== 1) throw new Error("Unsupported Jupiter route; only the reviewed exact-in single-Ray­dium ABI is decoded");
      const input = ix.data.readBigUInt64LE(16), out = ix.data.readBigUInt64LE(24), slip = ix.data.readUInt16LE(32);
      if (input !== BigInt(proposal.maxInputAtomic) || slip > proposal.slippageBps || ix.data[34] !== 0 || out * BigInt(10_000 - slip) / 10_000n < BigInt(proposal.minOutputAtomic)) throw new Error("Swap input, output, platform fee or slippage changed");
      const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], new PublicKey(JUPITER_V6))[0].toBase58();
      const required = [TOKEN_PROGRAM_ID.toBase58(), proposal.owner, source, destination, JUPITER_V6, USDC_MINT, JUPITER_V6, eventAuthority, JUPITER_V6];
      if (required.some((address, i) => ix.keys[i]?.pubkey.toBase58() !== address)) throw new Error("Swap accounts or destination differ from approval");
      const remaining = ix.keys.slice(9).map((key) => ({ address: key.pubkey.toBase58(), writable: key.isWritable }));
      const reviewed = context.reviewedRoutes.find((profile) => profile.kind !== "raydium-cpmm" && canonicalJson(profile.remainingAccounts) === canonicalJson(remaining));
      if (!reviewed || ix.keys.slice(9).some((key) => key.isSigner)) throw new Error("No separately reviewed pool-account profile");
      for (const address of reviewed.innerPrograms) { if (!context.accounts.get(address)?.executable) throw new Error("Unverified route program"); inner.add(address); }
    } else throw new Error(`Unrecognized program ${program}`);
  }
  if (!limit || (proposal.kind === "swap" ? routes !== 1 : [...expected.values()].some((n) => n !== 0))) throw new Error("Incomplete approved transaction");
  if (proposal.kind === "payout") debit[source] = total.toString();
  const sourceAccount = context.accounts.get(source);
  if (!sourceAccount || (sourceAccount.exists && (sourceAccount.authority !== proposal.owner || sourceAccount.mint !== (proposal.kind === "swap" ? WSOL_MINT : USDC_MINT)))) throw new Error("Unapproved source token account");
  if (proposal.kind === "payout" && (sourceAccount.amount ?? 0n) < total) throw new Error("Insufficient USDC funding");
  if (proposal.kind === "payout" && (!/^\d{1,20}$/.test(proposal.usdcReserveAtomic ?? "0") || (sourceAccount.amount ?? 0n) - total < BigInt(proposal.usdcReserveAtomic ?? "0"))) throw new Error("USDC reserve would be breached");
  if (proposal.kind === "swap" && (sourceAccount.amount ?? 0n) !== 0n) throw new Error("Pre-existing WSOL needs a separate reviewed spending proposal");
  const newAtas = [...created].filter((address) => !context.accounts.get(address)!.exists);
  const writable = new Set([proposal.owner, source, ...allowedAtas.keys()]);
  if (proposal.kind === "swap") for (const ix of instructions.filter((ix) => [JUPITER_V6, RAYDIUM_CPMM].includes(ix.programId.toBase58()))) {
    for (const key of (ix.programId.toBase58() === RAYDIUM_CPMM ? ix.keys : ix.keys.slice(9)).filter((key) => key.isWritable)) writable.add(key.pubkey.toBase58());
  }
  for (let i = 0; i < message.staticAccountKeys.length; i++) if (message.isAccountWritable(i) && !writable.has(message.staticAccountKeys[i]!.toBase58())) throw new Error("Unexpected writable account");
  if ([...allowedAtas].some(([address]) => !context.accounts.get(address)!.exists && !created.has(address))) throw new Error("Missing required ATA creation");
  const rent = BigInt(newAtas.length) * context.rentPerAccountLamports, debitSol = funding + context.networkFeeLamports + rent;
  if (rent < 0n || rent > BigInt(proposal.maxRentLamports) || debitSol > BigInt(proposal.maxSolDebitLamports) || owner.lamports - debitSol < BigInt(proposal.solReserveLamports)) throw new Error("SOL reserve, fee or rent ceiling exceeded");
  const bytes = Buffer.from(message.serialize());
  return { proposal: structuredClone(proposal), proposalHash: treasuryProposalHash(proposal), messageHash: createHash("sha256").update(bytes).digest("hex"), messageBase64: bytes.toString("base64"), programs: [...programs], allowedInnerPrograms: [...inner], tokenDebits: debit, tokenCredits: credit, ataOwners, newAtas, maxSolDebit: debitSol.toString(), closesWsol: closed, rentPerAccountLamports: context.rentPerAccountLamports.toString() };
}

export function validateTreasurySimulation(manifest: TreasuryManifest, before: TreasuryContext, result: { err: unknown; logs: string[]; after: Map<string, AccountSnapshot>; innerInstructions: TransactionInstruction[] }): void {
  if (result.err) throw new Error("Failed or unsafe simulation");
  const allowed = new Set([...manifest.programs, ...manifest.allowedInnerPrograms]);
  for (const line of result.logs) { const program = /^Program (\S+) invoke/.exec(line)?.[1]; if (program && !allowed.has(program)) throw new Error("Unexpected inner program"); }
  const p = manifest.proposal, oldOwner = before.accounts.get(p.owner), newOwner = result.after.get(p.owner);
  let routedInput = 0n;
  for (const ix of result.innerInstructions) {
    if (!allowed.has(ix.programId.toBase58())) throw new Error("Unexpected inner instruction program");
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      const tag = ix.data[0];
      if (tag === 3 || tag === 12) {
        const source = ix.keys[0]?.pubkey.toBase58(), target = ix.keys[tag === 12 ? 2 : 1]?.pubkey.toBase58();
        const sourceState = source ? (before.accounts.get(source)?.mint ? before.accounts.get(source) : result.after.get(source)?.mint ? result.after.get(source) : source === ata(WSOL_MINT, p.owner) && manifest.newAtas.includes(source) ? { mint: WSOL_MINT, authority: p.owner } : undefined) : undefined, targetState = target ? (result.after.get(target)?.mint ? result.after.get(target) : before.accounts.get(target)) : undefined;
        if (!sourceState?.mint || !targetState?.mint || sourceState.mint !== targetState.mint || ![WSOL_MINT, USDC_MINT].includes(sourceState.mint) || ix.data.length !== (tag === 3 ? 9 : 10)) throw new Error("Unresolved inner token movement");
        if (sourceState.authority === p.owner) {
          if (p.kind !== "swap" || source !== ata(WSOL_MINT, p.owner)) throw new Error("Unexpected additional treasury debit");
          routedInput += ix.data.readBigUInt64LE(1);
        }
      } else if (tag === 18 && ix.data.length === 33) {
        const address = ix.keys[0]?.pubkey.toBase58();
        if (!address || !manifest.newAtas.includes(address) || ix.keys.length !== 2 || ix.keys[1]?.pubkey.toBase58() !== (address === ata(WSOL_MINT, p.owner) ? WSOL_MINT : USDC_MINT) || new PublicKey(ix.data.subarray(1)).toBase58() !== manifest.ataOwners[address]) throw new Error("Unexpected token account initialization");
      } else if (tag === 21 || tag === 22) {
        if (tag === 21 && (ix.keys.length !== 1 || ![WSOL_MINT, USDC_MINT].includes(ix.keys[0]!.pubkey.toBase58()) || !(ix.data.length === 1 || (ix.data.length === 3 && ix.data.readUInt16LE(1) === 7)))) throw new Error("Unexpected token size query");
        if (tag === 22 && (ix.data.length !== 1 || ix.keys.length !== 1)) throw new Error("Unexpected immutable-owner instruction");
        if (tag === 22 && (!ix.keys[0] || !manifest.newAtas.includes(ix.keys[0].pubkey.toBase58()))) throw new Error("Unexpected immutable-owner initialization");
      } else throw new Error("Dangerous inner token instruction");
    } else if (ix.programId.equals(SystemProgram.programId)) {
      const address = ix.keys[1]?.pubkey.toBase58();
      if (ix.data.length !== 52 || ix.data.readUInt32LE(0) !== 0 || ix.keys[0]?.pubkey.toBase58() !== p.owner || !address || !manifest.newAtas.includes(address) || ix.data.readBigUInt64LE(4) !== before.rentPerAccountLamports || ix.data.readBigUInt64LE(12) !== 165n || !new PublicKey(ix.data.subarray(20)).equals(TOKEN_PROGRAM_ID)) throw new Error("Unexpected inner SOL/account movement");
    }
  }
  if (p.kind === "swap" && routedInput !== BigInt(p.maxInputAtomic)) throw new Error("Simulated routed input differs from approval");
  if (p.kind === "swap") {
    const wrapped = result.after.get(ata(WSOL_MINT, p.owner));
    if (manifest.closesWsol ? wrapped?.exists : (!wrapped?.exists || wrapped.mint !== WSOL_MINT || wrapped.authority !== p.owner || wrapped.amount !== 0n)) throw new Error("Unexpected final wrapped SOL account");
  }
  if (!oldOwner || !newOwner || oldOwner.lamports - newOwner.lamports > BigInt(p.maxSolDebitLamports) || newOwner.lamports < BigInt(p.solReserveLamports)) throw new Error("Simulation breaks the SOL spending policy");
  for (const [address, old] of before.accounts) {
    const next = result.after.get(address);
    if (old.authority === p.owner && old.mint && address !== ata(WSOL_MINT, p.owner)) {
      if (!next || next.authority !== old.authority || next.mint !== old.mint) throw new Error("Token authority, mint or account changed");
      const delta = (next.amount ?? 0n) - (old.amount ?? 0n), expectedDebit = BigInt(manifest.tokenDebits[address] ?? "0"), expectedCredit = BigInt(manifest.tokenCredits[address] ?? "0");
      if (expectedDebit ? delta !== -expectedDebit : expectedCredit ? delta < expectedCredit : delta !== 0n) throw new Error("Unexpected treasury token movement");
    }
  }
  for (const [address, minimum] of Object.entries(manifest.tokenCredits)) {
    const next = result.after.get(address), old = before.accounts.get(address);
    if (!next || next.mint !== USDC_MINT || next.authority !== manifest.ataOwners[address] || next.amount === undefined || next.amount - (old?.amount ?? 0n) < BigInt(minimum)) throw new Error("Missing approved recipient credit");
    if (p.kind === "payout" && next.amount - (old?.amount ?? 0n) !== BigInt(minimum)) throw new Error("Payout credit differs from the approved amount");
  }
}
