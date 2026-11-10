import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { USDC_MINT } from "../domain/tokens";
import { type PaidPlan } from "../hermes/paid-plan";
import { validatePaymentTransaction } from "./payment-guard";

export async function verifySettlement(rpc: Connection, signature: string, plan: PaidPlan, expectedMessage: Uint8Array): Promise<{ signature: string; slot: number; solscan: string }> {
  if (bs58.decode(signature).length !== 64) throw new Error("Receipt signature is invalid");
  const status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (!status || status.err || !["confirmed", "finalized"].includes(status.confirmationStatus || "")) throw new Error("Payment is not confirmed; settlement remains uncertain");
  const tx = await rpc.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta || tx.meta.err || !Buffer.from(tx.transaction.message.serialize()).equals(Buffer.from(expectedMessage))) throw new Error("Settlement message mismatch or failed transaction");
  validatePaymentTransaction(new VersionedTransaction(tx.transaction.message), plan);
  if (tx.meta.innerInstructions?.some((group) => group.instructions.length)) throw new Error("Unexpected inner payment instructions");
  const keys = tx.transaction.message.staticAccountKeys;
  const mint = new PublicKey(USDC_MINT);
  for (const [owner, expectedDelta] of [[plan.payer, -BigInt(plan.terms.amount)], [plan.terms.payTo, BigInt(plan.terms.amount)]] as const) {
    const account = getAssociatedTokenAddressSync(mint, new PublicKey(owner)).toBase58();
    const index = keys.findIndex((key) => key.toBase58() === account);
    const before = tx.meta.preTokenBalances?.find((b) => b.accountIndex === index && b.mint === USDC_MINT && b.owner === owner);
    const after = tx.meta.postTokenBalances?.find((b) => b.accountIndex === index && b.mint === USDC_MINT && b.owner === owner);
    if (!before || !after || before.uiTokenAmount.decimals !== 6 || after.uiTokenAmount.decimals !== 6 || BigInt(after.uiTokenAmount.amount) - BigInt(before.uiTokenAmount.amount) !== expectedDelta) throw new Error("On-chain USDC balance movement mismatch");
  }
  const payerIndex = keys.findIndex((key) => key.toBase58() === plan.payer);
  if (tx.meta.preBalances[payerIndex] !== tx.meta.postBalances[payerIndex]) throw new Error("Unexpected payer SOL movement");
  return { signature, slot: tx.slot, solscan: `https://solscan.io/tx/${signature}` };
}
