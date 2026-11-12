import { PublicKey, SystemProgram, TransactionInstruction, type VersionedMessage } from "@solana/web3.js";
import { ExtensionType, TOKEN_PROGRAM_ID, createInitializeAccount3Instruction, createInitializeImmutableOwnerInstruction, createTransferCheckedInstruction, createTransferInstruction } from "@solana/spl-token";
import bs58 from "bs58";
import { z } from "zod";

const address = z.string().transform((value) => new PublicKey(value));
const atomic = z.string().regex(/^\d{1,20}$/).transform(BigInt);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// RPC may return decoded or parsed CPI. Re-encode only these exact, constrained
// semantic forms; unknown token/authority instructions never become "safe" flags.
export function decodeRpcInstruction(input: unknown, message: VersionedMessage): TransactionInstruction {
  const ix = input as { programId?: PublicKey | string; programIdIndex?: number; accounts?: (PublicKey | string | number)[]; data?: string; parsed?: { type?: string; info?: unknown } };
  const keys = message.staticAccountKeys;
  if (!ix || typeof ix !== "object") throw new Error("Malformed RPC instruction");
  const program = ix.programId !== undefined ? new PublicKey(ix.programId) : keys[ix.programIdIndex ?? -1];
  if (!program) throw new Error("Unresolved RPC program");
  if (typeof ix.data === "string" && Array.isArray(ix.accounts)) {
    return new TransactionInstruction({ programId: program, data: Buffer.from(bs58.decode(ix.data)), keys: ix.accounts.map((account) => {
      const key = typeof account === "number" ? keys[account] : new PublicKey(account);
      const index = key ? keys.findIndex((candidate) => candidate.equals(key)) : -1;
      if (index < 0) throw new Error("Unresolved RPC instruction account");
      return { pubkey: key!, isSigner: message.isAccountSigner(index), isWritable: message.isAccountWritable(index) };
    }) });
  }
  const type = ix.parsed?.type, info = ix.parsed?.info;
  let result: TransactionInstruction;
  if (program.equals(SystemProgram.programId) && type === "createAccount") {
    const p = z.object({ source: address, newAccount: address, lamports: integer, space: integer, owner: address }).strict().parse(info);
    result = SystemProgram.createAccount({ fromPubkey: p.source, newAccountPubkey: p.newAccount, lamports: p.lamports, space: p.space, programId: p.owner });
  } else if (program.equals(TOKEN_PROGRAM_ID)) {
    if (type === "transfer") {
      const p = z.object({ source: address, destination: address, authority: address, amount: atomic }).strict().parse(info);
      result = createTransferInstruction(p.source, p.destination, p.authority, p.amount);
    } else if (type === "transferChecked") {
      const p = z.object({ source: address, destination: address, mint: address, authority: address, tokenAmount: z.object({ amount: atomic, decimals: z.number().int().min(0).max(18), uiAmount: z.unknown().optional(), uiAmountString: z.string().optional() }).strict() }).strict().parse(info);
      result = createTransferCheckedInstruction(p.source, p.mint, p.destination, p.authority, p.tokenAmount.amount, p.tokenAmount.decimals);
    } else if (type === "initializeAccount3") {
      const p = z.object({ account: address, mint: address, owner: address }).strict().parse(info);
      result = createInitializeAccount3Instruction(p.account, p.mint, p.owner);
    } else if (type === "initializeImmutableOwner") {
      const p = z.object({ account: address }).strict().parse(info); result = createInitializeImmutableOwnerInstruction(p.account, TOKEN_PROGRAM_ID);
    } else if (type === "getAccountDataSize") {
      const p = z.object({ mint: address, extensionTypes: z.array(z.literal("immutableOwner")).max(1) }).strict().parse(info);
      const data = Buffer.alloc(1 + 2 * p.extensionTypes.length); data[0] = 21;
      if (p.extensionTypes.length) data.writeUInt16LE(ExtensionType.ImmutableOwner, 1);
      result = new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, data, keys: [{ pubkey: p.mint, isSigner: false, isWritable: false }] });
    } else throw new Error("Unsupported or dangerous parsed token instruction");
  } else throw new Error("Unsupported parsed instruction program");
  if (result.keys.some((key) => !keys.some((candidate) => candidate.equals(key.pubkey)))) throw new Error("Unresolved parsed instruction account");
  return result;
}
