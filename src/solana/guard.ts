import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export function messagesMatch(unsignedBase64: string, signedBase64: string): boolean {
  const unsigned = decode(unsignedBase64);
  const signed = decode(signedBase64);
  if (unsigned.kind !== signed.kind) return false;
  return unsigned.message.equals(signed.message);
}

export function feePayerOf(base64: string): string {
  return decode(base64).feePayer.toBase58();
}

function decode(base64: string): { kind: "legacy" | "versioned"; message: Buffer; feePayer: PublicKey } {
  const bytes = Buffer.from(base64, "base64");
  try {
    const versioned = VersionedTransaction.deserialize(bytes);
    return {
      kind: "versioned",
      message: Buffer.from(versioned.message.serialize()),
      feePayer: versioned.message.staticAccountKeys[0] ?? PublicKey.default,
    };
  } catch {
    const legacy = Transaction.from(bytes);
    if (!legacy.feePayer) throw new Error("Transaction has no fee payer");
    return { kind: "legacy", message: legacy.serializeMessage(), feePayer: legacy.feePayer };
  }
}

export function assertFeePayer(base64: string, expected: string): void {
  const payer = feePayerOf(base64);
  if (payer !== expected) {
    throw new Error("Fee payer does not match the authorized treasury wallet");
  }
}
