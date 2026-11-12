// Synthetic layout/transaction fixture. No on-chain pool or paid result is asserted.
import { createHash } from "node:crypto";
import { Keypair, PublicKey, ComputeBudgetProgram, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { RAYDIUM_CPMM, CPMM_SWAP_INPUT } from "../raydium-cpmm";
import { HERMES_FEE_PAYER, HERMES_PAYEE, BUILD_URL } from "../../hermes/paid-plan";
import { USDC_MINT, WSOL_MINT } from "../../domain/tokens";
import type { PaidBuildEvidence } from "../../hermes/build-evidence";
import type { TreasuryTestBank } from "./treasury-bank";
import bs58 from "bs58";
import { signApiCapture } from "../../hermes/capture-signature";

export function syntheticCpmmBuild(bank: TreasuryTestBank) {
  const program = new PublicKey(RAYDIUM_CPMM), owner = new PublicKey(bank.owner);
  const pool = Keypair.generate().publicKey, config = Keypair.generate().publicKey, observation = Keypair.generate().publicKey;
  const inputVault = Keypair.generate().publicKey, outputVault = Keypair.generate().publicKey;
  const [authority, bump] = PublicKey.findProgramAddressSync([Buffer.from("vault_and_lp_mint_auth_seed")], program);
  const data = Buffer.alloc(637);
  createHash("sha256").update("account:PoolState").digest().copy(data, 0, 0, 8);
  for (const [offset, key] of [[8, config], [72, inputVault], [104, outputVault], [168, new PublicKey(WSOL_MINT)], [200, new PublicKey(USDC_MINT)], [232, TOKEN_PROGRAM_ID], [264, TOKEN_PROGRAM_ID], [296, observation]] as const) key.toBuffer().copy(data, offset);
  data[328] = bump;
  bank.accounts.set(pool.toBase58(), { lamports: 2039280n, programOwner: RAYDIUM_CPMM, data });
  const configData = Buffer.alloc(128); createHash("sha256").update("account:AmmConfig").digest().copy(configData, 0, 0, 8);
  bank.accounts.set(config.toBase58(), { lamports: 2039280n, programOwner: RAYDIUM_CPMM, data: configData });
  const oracleData = Buffer.alloc(4075); createHash("sha256").update("account:ObservationState").digest().copy(oracleData, 0, 0, 8); pool.toBuffer().copy(oracleData, 11);
  bank.accounts.set(observation.toBase58(), { lamports: 2039280n, programOwner: RAYDIUM_CPMM, data: oracleData });
  bank.accounts.set(inputVault.toBase58(), { lamports: 1_000_002_039_280n, mint: WSOL_MINT, authority: authority.toBase58(), amount: 1_000_000_000_000n });
  bank.accounts.set(outputVault.toBase58(), { lamports: 2039280n, mint: USDC_MINT, authority: authority.toBase58(), amount: 1_000_000_000_000n });
  const source = getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT), owner), destination = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
  bank.accounts.set(source.toBase58(), null);
  const accounts = [owner, authority, config, pool, source, destination, inputVault, outputVault, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, new PublicKey(WSOL_MINT), new PublicKey(USDC_MINT), observation];
  const swapData = Buffer.alloc(24); CPMM_SWAP_INPUT.copy(swapData); swapData.writeBigUInt64LE(1_000_000n, 8); swapData.writeBigUInt64LE(10000n, 16);
  const swap = new TransactionInstruction({ programId: program, data: swapData, keys: accounts.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: [0, 3, 4, 5, 6, 7, 12].includes(i) })) });
  const latest = bank.latest();
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }), createAssociatedTokenAccountIdempotentInstruction(owner, source, owner, new PublicKey(WSOL_MINT)), createAssociatedTokenAccountIdempotentInstruction(owner, destination, owner, new PublicKey(USDC_MINT)), SystemProgram.transfer({ fromPubkey: owner, toPubkey: source, lamports: 1_000_000 }), createSyncNativeInstruction(source), swap, createCloseAccountInstruction(source, owner, owner)];
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
  const transaction = Buffer.from(tx.serialize()).toString("base64"), receipt = Buffer.from(JSON.stringify({ success: true, transaction: bs58.encode(new Uint8Array(64).fill(8)) })).toString("base64");
  const body = JSON.stringify({ success: true, transaction, provider: "raydium" }), at = new Date().toISOString();
  const record: PaidBuildEvidence = { schemaVersion: 1, evidenceClass: "verified_chain", at,
    plan: { id: crypto.randomUUID(), createdAt: at, expiresAt: new Date(Date.now() + 60000).toISOString(), payer: Keypair.fromSeed(new Uint8Array(32).fill(231)).publicKey.toBase58(), url: BUILD_URL, method: "POST", body: { provider: "raydium", userAddress: bank.owner, chainKey: "sol", slippageBps: 50, quoteResponse: { synthetic: true } }, terms: { scheme: "exact", network: "solana", asset: USDC_MINT, amount: "3007", payTo: HERMES_PAYEE, feePayer: HERMES_FEE_PAYER, resource: BUILD_URL }, maxAtomic: "3007", dailyLimitAtomic: "50000", lifetimeLimitAtomic: "100000", reserveAtomic: "100000", quote: { paymentSignature: bs58.encode(new Uint8Array(64).fill(7)), responseSha256: "0".repeat(64), createdAt: at, inputAtomic: "1000000", outputAtomic: "10051", minOutputAtomic: "10000", slippageBps: 50 } },
    messageBase64: "synthetic-api-payment-not-an-artifact", messageHash: "0".repeat(64), responseSha256: createHash("sha256").update(body).digest("hex"), receiptHeader: receipt, captureSignature: "",
    evidence: { signature: bs58.encode(new Uint8Array(64).fill(8)), slot: 99, solscan: `https://solscan.io/tx/${bs58.encode(new Uint8Array(64).fill(8))}` }, build: { transaction, provider: "raydium" } };
  record.captureSignature = signApiCapture(record.plan, body, 200, receipt, Keypair.fromSeed(new Uint8Array(32).fill(231)).secretKey);
  return { record, response: { status: 200, receipt, body }, pool, inputVault, outputVault, source, destination, swap };
}
