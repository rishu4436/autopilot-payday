import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, decodeTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { type PaidPlan, validatePlan } from "../hermes/paid-plan";
import { USDC_MINT } from "../domain/tokens";

// This validates only the deliberately narrow API payment shape. Provider swap
// instructions have no approved decoder and are always rejected by this guard.
export function validatePaymentTransaction(tx: VersionedTransaction, plan: PaidPlan): void {
  validatePlan(plan);
  const message = tx.message;
  if (message.version !== 0 || message.addressTableLookups.length !== 0) throw new Error("Payment lookup tables or legacy messages are not supported");
  const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map((key) => key.toBase58());
  if (signers.length !== 2 || signers[0] !== plan.terms.feePayer || signers[1] !== plan.payer) throw new Error("Unexpected payment signers or fee payer");
  const instructions = TransactionMessage.decompile(message).instructions;
  if (instructions.length !== 3) throw new Error("Unexpected extra instructions");
  const [limit, price, transfer] = instructions;
  if (!limit || !price || !transfer) throw new Error("Missing payment instructions");
  if (!limit.programId.equals(ComputeBudgetProgram.programId) || limit.keys.length || limit.data.length !== 5 || limit.data[0] !== 2 || limit.data.readUInt32LE(1) !== 20_000) throw new Error("Unexpected compute limit");
  if (!price.programId.equals(ComputeBudgetProgram.programId) || price.keys.length || price.data.length !== 9 || price.data[0] !== 3 || price.data.readBigUInt64LE(1) !== 1n) throw new Error("Unexpected compute price");
  if (!transfer.programId.equals(TOKEN_PROGRAM_ID) || transfer.keys.length !== 4 || transfer.data.length !== 10) throw new Error("Only a checked USDC transfer is approved");
  const decoded = decodeTransferCheckedInstruction(transfer);
  const mint = new PublicKey(USDC_MINT), payer = new PublicKey(plan.payer), payee = new PublicKey(plan.terms.payTo);
  if (!decoded.keys.source.pubkey.equals(getAssociatedTokenAddressSync(mint, payer)) ||
      !decoded.keys.destination.pubkey.equals(getAssociatedTokenAddressSync(mint, payee)) ||
      !decoded.keys.mint.pubkey.equals(mint) || !decoded.keys.owner.pubkey.equals(payer) ||
      !decoded.keys.owner.isSigner || decoded.data.amount !== BigInt(plan.terms.amount) || decoded.data.decimals !== 6) {
    throw new Error("Payment movement differs from the approved plan");
  }
}
