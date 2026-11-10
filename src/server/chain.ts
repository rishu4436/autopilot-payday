import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, TokenAccountNotFoundError } from "@solana/spl-token";
import type { ChainView } from "@/solana/status";
import { USDC_MINT } from "@/domain/tokens";

export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function connection(): Connection {
  return new Connection(rpcUrl(), { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
}

export async function readChainBalances(address: string): Promise<{ solAtomic: bigint; usdcAtomic: bigint; slot: number }> {
  const rpc = connection();
  const owner = new PublicKey(address);
  const [sol, slot] = await Promise.all([rpc.getBalance(owner), rpc.getSlot()]);
  let usdcAtomic = 0n;
  try {
    const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner, true);
    const account = await getAccount(rpc, ata);
    usdcAtomic = BigInt(account.amount.toString());
  } catch (error) {
    if (!(error instanceof TokenAccountNotFoundError)) throw error;
  }
  return { solAtomic: BigInt(sol), usdcAtomic, slot };
}

export async function broadcastAndClassify(_rawBase64: string): Promise<{ signature: string; view: ChainView }> {
  throw new Error("Broadcast is quarantined pending durable pre-submission persistence and instruction authorization");
}
