import { createHash } from "node:crypto";
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { USDC_MINT, WSOL_MINT } from "../domain/tokens";
import type { ReviewedRoute } from "./treasury-guard";

export const RAYDIUM_CPMM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
export const CPMM_SWAP_INPUT = createHash("sha256").update("global:swap_base_input").digest().subarray(0, 8);
const discriminator = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
// Layout/source: raydium-io/raydium-cp-swap, packed PoolState (637 bytes).
// A changed layout is refused. No provider-returned pool profile is trusted.
export async function readCpmmProfiles(rpc: Connection, base64: string): Promise<ReviewedRoute[]> {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const instructions = TransactionMessage.decompile(tx.message).instructions.filter((ix) => ix.programId.toBase58() === RAYDIUM_CPMM);
  if (instructions.length > 1) throw new Error("Only one direct CPMM swap is supported");
  const profiles: ReviewedRoute[] = [];
  for (const ix of instructions) {
    if (ix.keys.length !== 13) throw new Error("Unexpected CPMM account ABI");
    const writable = new Set([0, 3, 4, 5, 6, 7, 12]);
    if (ix.keys.some((key, i) => key.isWritable !== writable.has(i) || key.isSigner !== (i === 0))) throw new Error("Unexpected CPMM account privileges");
    const poolKey = ix.keys[3]!.pubkey, pool = await rpc.getAccountInfo(poolKey, "confirmed");
    if (!pool || pool.executable || pool.owner.toBase58() !== RAYDIUM_CPMM || pool.data.length !== 637 || !pool.data.subarray(0, 8).equals(discriminator("PoolState"))) throw new Error("Unverified CPMM pool state");
    const field = (offset: number) => new PublicKey(pool.data.subarray(offset, offset + 32));
    const config = field(8), vault0 = field(72), vault1 = field(104), mint0 = field(168), mint1 = field(200), observation = field(296);
    const [authority, bump] = PublicKey.findProgramAddressSync([Buffer.from("vault_and_lp_mint_auth_seed")], new PublicKey(RAYDIUM_CPMM));
    if (pool.data[328] !== bump || (pool.data[329]! & 4) !== 0 || !field(232).equals(TOKEN_PROGRAM_ID) || !field(264).equals(TOKEN_PROGRAM_ID) || !new Set([mint0.toBase58(), mint1.toBase58()]).has(WSOL_MINT) || !new Set([mint0.toBase58(), mint1.toBase58()]).has(USDC_MINT)) throw new Error("Unsupported CPMM mint, authority, status or token program");
    const inputVault = mint0.toBase58() === WSOL_MINT ? vault0 : vault1, outputVault = mint0.toBase58() === USDC_MINT ? vault0 : vault1;
    const [configInfo, oracleInfo, inputInfo, outputInfo] = await rpc.getMultipleAccountsInfo([config, observation, inputVault, outputVault], "confirmed");
    if (!configInfo || configInfo.executable || configInfo.owner.toBase58() !== RAYDIUM_CPMM || !configInfo.data.subarray(0, 8).equals(discriminator("AmmConfig")) || !oracleInfo || oracleInfo.executable || oracleInfo.owner.toBase58() !== RAYDIUM_CPMM || !oracleInfo.data.subarray(0, 8).equals(discriminator("ObservationState")) || oracleInfo.data.length < 43 || !new PublicKey(oracleInfo.data.subarray(11, 43)).equals(poolKey)) throw new Error("Unverified CPMM config or oracle");
    for (const [key, info, mint] of [[inputVault, inputInfo, WSOL_MINT], [outputVault, outputInfo, USDC_MINT]] as const) {
      if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) throw new Error("Unverified CPMM vault program");
      const account = unpackAccount(key, info);
      if (!account.isInitialized || account.isFrozen || !account.mint.equals(new PublicKey(mint)) || !account.owner.equals(authority) || account.delegate || account.closeAuthority) throw new Error("Unverified CPMM vault authority or asset");
    }
    const expected = [ix.keys[0]!.pubkey, authority, config, poolKey, ix.keys[4]!.pubkey, ix.keys[5]!.pubkey, inputVault, outputVault, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, new PublicKey(WSOL_MINT), new PublicKey(USDC_MINT), observation];
    if (expected.some((key, i) => !ix.keys[i]!.pubkey.equals(key))) throw new Error("CPMM accounts do not match independent on-chain state");
    profiles.push({ id: `onchain-cpmm:${poolKey}`, kind: "raydium-cpmm", remainingAccounts: ix.keys.map((key) => ({ address: key.pubkey.toBase58(), writable: key.isWritable })), innerPrograms: [RAYDIUM_CPMM] });
  }
  return profiles;
}
