import { Keypair, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { classifySignature } from "./status";
import { assertFeePayer, messagesMatch } from "./guard";
import { buildUsdcPayouts, decodeTransferAmount } from "./payout";
import { isValidSolanaAddress, solscanTx } from "./address";

describe("chain guards", () => {
  it("does not treat a timeout as failure or success", () => {
    expect(classifySignature({ value: null, elapsedMs: 10, timeoutMs: 1000 })).toBe("PENDING");
    expect(classifySignature({ value: null, elapsedMs: 2000, timeoutMs: 1000 })).toBe("UNKNOWN");
    expect(classifySignature({ value: { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }, elapsedMs: 10, timeoutMs: 1000 })).toBe("FAILED");
    expect(classifySignature({ value: { err: null, confirmationStatus: "finalized" }, elapsedMs: 5000, timeoutMs: 1000 })).toBe("CONFIRMED");
    expect(classifySignature({ value: { err: null, confirmationStatus: "processed" }, elapsedMs: 10, timeoutMs: 1000 })).toBe("PENDING");
  });

  it("builds a checked USDC transfer and rejects a mutated message", () => {
    const payer = Keypair.generate();
    const recipient = Keypair.generate().publicKey.toBase58();
    const [chunk] = buildUsdcPayouts({
      payer: payer.publicKey.toBase58(),
      recipients: [{ id: "item-1", address: recipient, amountAtomic: 40_000_000n }],
      blockhash: "11111111111111111111111111111111",
      rentLamports: 2_039_280n,
    });
    expect(chunk).toBeTruthy();
    if (!chunk) throw new Error("missing chunk");
    expect(chunk.amounts).toEqual(["40000000"]);
    expect(chunk.estimatedFeeLamports).toBe(5_000n + 2_039_280n);
    assertFeePayer(chunk.base64, payer.publicKey.toBase58());

    const tx = Transaction.from(Buffer.from(chunk.base64, "base64"));
    const transfer = tx.instructions.find((ix) => decodeTransferAmount(ix.data));
    expect(decodeTransferAmount(transfer?.data ?? new Uint8Array())).toMatchObject({ amount: 40_000_000n, decimals: 6 });
    tx.partialSign(payer);
    const signed = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    expect(messagesMatch(chunk.base64, signed)).toBe(true);

    const [other] = buildUsdcPayouts({
      payer: payer.publicKey.toBase58(),
      recipients: [{ id: "item-1", address: recipient, amountAtomic: 40_000_001n }],
      blockhash: "11111111111111111111111111111111",
      rentLamports: 2_039_280n,
    });
    expect(messagesMatch(chunk.base64, other?.base64 ?? "")).toBe(false);
    expect(isValidSolanaAddress(payer.publicKey.toBase58())).toBe(true);
    expect(isValidSolanaAddress("not-an-address")).toBe(false);
    expect(solscanTx("SIMULATED:payroll")).toBeNull();
    expect(solscanTx("1".repeat(87))).toMatch(/^https:\/\/solscan.io\/tx\//);
  });
});
