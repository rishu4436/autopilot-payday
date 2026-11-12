import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { signApiCapture, verifyApiCapture } from "./capture-signature";
import { TreasuryTestBank } from "../solana/__fixtures__/treasury-bank";
import { syntheticCpmmBuild } from "../solana/__fixtures__/cpmm";

describe("authenticated local API captures", () => {
  it("authenticates the original response without loading a key in the verifier", () => {
    const artifact = syntheticCpmmBuild(new TreasuryTestBank());
    expect(() => verifyApiCapture(artifact.record, true)).not.toThrow();
  });
  it.each(["body", "receipt", "request", "payer"])("rejects a caller-edited %s even if its payment receipt is real", (field) => {
    const record = syntheticCpmmBuild(new TreasuryTestBank()).record;
    if (field === "body") record.responseSha256 = "1".repeat(64);
    if (field === "receipt") record.receiptHeader += "A";
    if (field === "request") record.plan.body.quoteResponse = { replaced: true };
    if (field === "payer") record.plan.payer = Keypair.generate().publicKey.toBase58();
    expect(() => verifyApiCapture(record, true)).toThrow("capture signature");
  });
  it("refuses missing build capture authentication and the wrong local capture signer", () => {
    const artifact = syntheticCpmmBuild(new TreasuryTestBank());
    expect(() => verifyApiCapture({ ...artifact.record, captureSignature: undefined }, true)).toThrow("capture signature");
    expect(() => signApiCapture(artifact.record.plan, artifact.response.body, 200, artifact.response.receipt, Keypair.generate().secretKey)).toThrow("differs");
  });
});
