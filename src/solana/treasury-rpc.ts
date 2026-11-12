import { assertMainnetRpc, SOLANA_MAINNET_GENESIS_HASH } from "./network";
// Read-only adapter. Never loads a keypair, signs, builds a paid request or broadcasts.
import { Connection, PublicKey, SystemProgram, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { decodeRpcInstruction } from "./rpc-instructions";
import { inspectTreasuryTransaction, validateTreasurySimulation, type AccountSnapshot, type ReviewedRoute, type TreasuryContext, type TreasuryProposal } from "./treasury-guard";

function snapshot(address: PublicKey, info: AccountInfo<Buffer> | null): AccountSnapshot {
  if (!info) return { address: address.toBase58(), exists: false, lamports: 0n };
  if (!Number.isSafeInteger(info.lamports) || info.lamports < 0) throw new Error("Unsafe RPC balance precision");
  const state: AccountSnapshot = { address: address.toBase58(), exists: true, lamports: BigInt(info.lamports), executable: info.executable };
  if (info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length === 165) {
    const account = unpackAccount(address, info);
    if (!account.isInitialized || account.isFrozen) throw new Error("Uninitialized or frozen token account");
    state.mint = account.mint.toBase58(); state.authority = account.owner.toBase58(); state.amount = account.amount;
  }
  return state;
}
export async function inspectTreasuryFromRpc(rpc: Connection, base64: string, proposal: TreasuryProposal, allowlistedRecipients: Set<string>, reviewedRoutes: readonly ReviewedRoute[] = []) {
  await assertMainnetRpc(rpc);
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  if (tx.message.version === 0 && tx.message.addressTableLookups.length) throw new Error("Unresolved lookup tables are forbidden");
  const keys = tx.message.staticAccountKeys;
  if (keys.length > 64) throw new Error("Transaction exceeds the reviewed account ceiling");
  const [accounts, fee, rent, blockHeight, valid] = await Promise.all([
    rpc.getMultipleAccountsInfoAndContext(keys, { commitment: "confirmed" }), rpc.getFeeForMessage(tx.message, "confirmed"),
    rpc.getMinimumBalanceForRentExemption(165, "confirmed"), rpc.getBlockHeight("confirmed"), rpc.isBlockhashValid(proposal.blockhash, { commitment: "confirmed" }),
  ]);
  if (!valid.value || fee.value === null || !Number.isSafeInteger(fee.value) || !Number.isSafeInteger(rent) || accounts.value.length !== keys.length) throw new Error("Invalid blockhash, fees, rent or account snapshot");
  const ownerIndex = keys.findIndex((key) => key.toBase58() === proposal.owner), owner = accounts.value[ownerIndex];
  if (!owner || !owner.owner.equals(SystemProgram.programId) || owner.executable) throw new Error("Treasury must be a system-owned wallet");
  const before: TreasuryContext = { genesisHash: SOLANA_MAINNET_GENESIS_HASH, observedAt: Date.now(), accounts: new Map(keys.map((key, i) => [key.toBase58(), snapshot(key, accounts.value[i]!)])), allowlistedRecipients: new Set(allowlistedRecipients), networkFeeLamports: BigInt(fee.value), rentPerAccountLamports: BigInt(rent), blockHeight, reviewedRoutes: structuredClone(reviewedRoutes) };
  const manifest = inspectTreasuryTransaction(base64, proposal, before);
  const simulated = await rpc.simulateTransaction(tx, { commitment: "confirmed", sigVerify: false, replaceRecentBlockhash: false, minContextSlot: accounts.context.slot, innerInstructions: true, accounts: { encoding: "base64", addresses: keys.map((key) => key.toBase58()) } });
  const result = simulated.value;
  if (!result.logs || !result.accounts || result.accounts.length !== keys.length || simulated.context.slot < accounts.context.slot || result.innerInstructions === undefined) throw new Error("RPC omitted complete simulation evidence");
  if (!result.innerInstructions?.length && result.logs.some((line) => /^Program \S+ invoke \[[2-9]\d*\]/.test(line))) throw new Error("RPC omitted invoked inner instructions");
  const after = new Map(keys.map((key, i) => {
    const value = result.accounts![i];
    if (value && (value.data.length !== 2 || value.data[1] !== "base64")) throw new Error("Unsupported simulated account encoding");
    return [key.toBase58(), snapshot(key, value ? { ...value, owner: new PublicKey(value.owner), data: Buffer.from(value.data[0]!, "base64"), rentEpoch: value.rentEpoch ?? 0 } : null)] as const;
  }));
  const innerInstructions = (result.innerInstructions ?? []).flatMap((group) => group.instructions.map((ix) => decodeRpcInstruction(ix, tx.message)));
  const simulation = { err: result.err, logs: result.logs, after, innerInstructions };
  validateTreasurySimulation(manifest, before, simulation);
  return { manifest, validation: { before, simulation }, snapshotSlot: accounts.context.slot, simulationSlot: simulated.context.slot };
}
