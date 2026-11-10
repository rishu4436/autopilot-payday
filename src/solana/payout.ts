import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { REFERENCE_SIGNATURE_FEE_LAMPORTS } from "@/domain/tokens";

export interface PayoutRecipient {
  id: string;
  address: string;
  amountAtomic: bigint;
}

export interface BuiltChunk {
  index: number;
  base64: string;
  allocationIds: string[];
  recipients: string[];
  amounts: string[];
  estimatedFeeLamports: bigint | null;
  includesAta: boolean;
}

export function buildUsdcPayouts(input: {
  payer: string;
  mint?: string;
  decimals?: number;
  recipients: PayoutRecipient[];
  blockhash: string;
  rentLamports: bigint | null;
  chunkSize?: number;
}): BuiltChunk[] {
  if (input.mint && input.mint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") throw new Error("Payroll supports canonical Solana USDC only");
  if (input.decimals !== undefined && input.decimals !== 6) throw new Error("USDC requires six decimals");
  if (new Set(input.recipients.map((row) => row.id)).size !== input.recipients.length) throw new Error("Duplicate payout allocation across chunks");
  if (input.recipients.some((row) => row.amountAtomic <= 0n || row.amountAtomic > 18446744073709551615n)) throw new Error("Payout amount must fit a positive u64");
  const mint = new PublicKey(input.mint ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const decimals = input.decimals ?? 6;
  const payer = new PublicKey(input.payer);
  const size = input.chunkSize ?? 6;
  if (!Number.isInteger(size) || size < 1 || size > 6) throw new Error("Chunk size must be between one and six");
  const chunks: BuiltChunk[] = [];
  for (let offset = 0; offset < input.recipients.length; offset += size) {
    const slice = input.recipients.slice(offset, offset + size);
    const tx = new Transaction();
    tx.feePayer = payer;
    tx.recentBlockhash = input.blockhash;
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    for (const recipient of slice) {
      if (recipient.amountAtomic <= 0n) throw new Error("Payout amount must be positive");
      const owner = new PublicKey(recipient.address);
      const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const source = getAssociatedTokenAddressSync(mint, payer, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint));
      tx.add(createTransferCheckedInstruction(source, mint, ata, payer, recipient.amountAtomic, decimals));
    }
    const rent = input.rentLamports === null ? null : input.rentLamports * BigInt(slice.length);
    chunks.push({
      index: chunks.length,
      base64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      allocationIds: slice.map((row) => row.id),
      recipients: slice.map((row) => row.address),
      amounts: slice.map((row) => row.amountAtomic.toString()),
      estimatedFeeLamports: rent === null ? null : REFERENCE_SIGNATURE_FEE_LAMPORTS + rent,
      includesAta: true,
    });
  }
  return chunks;
}

export function decodeTransferAmount(data: Uint8Array): { tag: number; amount: bigint; decimals: number } | null {
  if (data.length < 10 || data[0] !== 12) return null;
  let amount = 0n;
  for (let i = 0; i < 8; i += 1) amount += BigInt(data[1 + i] ?? 0) << (8n * BigInt(i));
  return { tag: data[0], amount, decimals: data[9] ?? 0 };
}
