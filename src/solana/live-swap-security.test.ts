import { describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { readCpmmProfiles } from "./raydium-cpmm";
import { syntheticCpmmBuild } from "./__fixtures__/cpmm";
import { TreasuryTestBank } from "./__fixtures__/treasury-bank";
import { canonicalUnsignedSwap, validateOriginalBuildResponse } from "../hermes/build-evidence";
import { decodeRpcInstruction } from "./rpc-instructions";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("real-layout CPMM and RPC instruction boundary using synthetic accounts", () => {
  it("checks the whole pool/vault/config/oracle relationship against chain-owned account bytes", async () => {
    const bank = new TreasuryTestBank(), f = syntheticCpmmBuild(bank);
    const profiles = await readCpmmProfiles(bank.rpc as unknown as Connection, f.record.build.transaction);
    expect(profiles[0]?.kind).toBe("raydium-cpmm"); expect(profiles[0]?.id).toContain(f.pool.toBase58());
    bank.accounts.get(f.inputVault.toBase58())!.authority = Keypair.generate().publicKey.toBase58();
    await expect(readCpmmProfiles(bank.rpc as unknown as Connection, f.record.build.transaction)).rejects.toThrow("vault authority");
  });
  it.each(["owner", "layout", "mint", "swap-disabled"])("refuses a changed pool %s", async (field) => {
    const bank = new TreasuryTestBank(), f = syntheticCpmmBuild(bank), account = bank.accounts.get(f.pool.toBase58())!;
    if (field === "owner") account.programOwner = PublicKey.default.toBase58();
    if (field === "layout") account.data = new Uint8Array(636);
    if (field === "mint") Keypair.generate().publicKey.toBytes().forEach((byte, i) => { account.data![168 + i] = byte; });
    if (field === "swap-disabled") account.data![329] = 4;
    await expect(readCpmmProfiles(bank.rpc as unknown as Connection, f.record.build.transaction)).rejects.toThrow();
  });
  it("refuses broadened account privileges and modified original API responses", async () => {
    const bank = new TreasuryTestBank(), f = syntheticCpmmBuild(bank);
    validateOriginalBuildResponse(f.record, f.response);
    expect(() => validateOriginalBuildResponse(f.record, { ...f.response, body: f.response.body + " " })).toThrow("mismatch");
    const tx = VersionedTransaction.deserialize(Buffer.from(f.record.build.transaction, "base64")), decoded = TransactionMessage.decompile(tx.message);
    const ix = decoded.instructions.find((item) => item.programId.equals(f.swap.programId))!; ix.keys[2]!.isWritable = true;
    const changed = new VersionedTransaction(new TransactionMessage({ ...decoded, instructions: decoded.instructions }).compileToV0Message());
    await expect(readCpmmProfiles(bank.rpc as unknown as Connection, Buffer.from(changed.serialize()).toString("base64"))).rejects.toThrow("privileges");
  });
  it("refreshes only unsigned transaction blockhashes and rejects co-signers/signed provider payloads", async () => {
    const bank = new TreasuryTestBank(), f = syntheticCpmmBuild(bank);
    const canonical = await canonicalUnsignedSwap(bank.rpc as unknown as Connection, f.record.build.transaction, bank.owner);
    expect(canonical.blockhash).not.toBe(VersionedTransaction.deserialize(Buffer.from(f.record.build.transaction, "base64")).message.recentBlockhash);
    const signed = VersionedTransaction.deserialize(Buffer.from(f.record.build.transaction, "base64")); signed.signatures[0]![0] = 1;
    await expect(canonicalUnsignedSwap(bank.rpc as unknown as Connection, Buffer.from(signed.serialize()).toString("base64"), bank.owner)).rejects.toThrow("unsigned");
    await expect(canonicalUnsignedSwap(bank.rpc as unknown as Connection, f.record.build.transaction, Keypair.generate().publicKey.toBase58())).rejects.toThrow("sole signer");
    const lookup = VersionedTransaction.deserialize(Buffer.from(f.record.build.transaction, "base64"));
    if (lookup.message.version !== 0) throw new Error("Expected v0 fixture");
    lookup.message.addressTableLookups.push({ accountKey: Keypair.generate().publicKey, readonlyIndexes: [0], writableIndexes: [] });
    await expect(canonicalUnsignedSwap(bank.rpc as unknown as Connection, Buffer.from(lookup.serialize()).toString("base64"), bank.owner)).rejects.toThrow("lookup table owner");
  });
  it.each(["approve", "setAuthority", "closeAccount", "mintTo", "burn"])("rejects dangerous parsed SPL %s", (type) => {
    const bank = new TreasuryTestBank(), f = syntheticCpmmBuild(bank), tx = VersionedTransaction.deserialize(Buffer.from(f.record.build.transaction, "base64"));
    expect(() => decodeRpcInstruction({ programId: TOKEN_PROGRAM_ID, parsed: { type, info: {} } }, tx.message)).toThrow("dangerous");
  });
  it("re-encodes known account creation CPI and rejects extra/malformed semantic fields", () => {
    const bank = new TreasuryTestBank(), f = syntheticCpmmBuild(bank), message = VersionedTransaction.deserialize(Buffer.from(f.record.build.transaction, "base64")).message;
    const instruction = { programId: TOKEN_PROGRAM_ID, parsed: { type: "initializeAccount3", info: { account: f.source.toBase58(), mint: message.staticAccountKeys.find((key) => key.toBase58() === "So11111111111111111111111111111111111111112")!.toBase58(), owner: bank.owner } } };
    expect(decodeRpcInstruction(instruction, message).data[0]).toBe(18);
    expect(() => decodeRpcInstruction({ ...instruction, parsed: { ...instruction.parsed, info: { ...instruction.parsed.info, delegate: bank.owner } } }, message)).toThrow();
    expect(() => decodeRpcInstruction({ programIdIndex: 500, accounts: [], data: "" }, message)).toThrow("Unresolved");
  });
});
