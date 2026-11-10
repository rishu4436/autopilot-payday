import bs58 from "bs58";

export function isValidSolanaAddress(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

export function solscanTx(signature: string, cluster = "mainnet-beta"): string | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(signature)) return null;
  if (signature.startsWith("SIMULATED")) return null;
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${signature}${suffix}`;
}

export function solscanAccount(address: string, cluster = "mainnet-beta"): string | null {
  if (!isValidSolanaAddress(address)) return null;
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/account/${address}${suffix}`;
}

export function evidenceLabel(kind: string): string {
  if (kind === "simulated") return "SIMULATED";
  if (kind === "live_unpaid") return "LIVE UNPAID";
  if (kind === "live_paid") return "LIVE PAID";
  if (kind === "verified_chain") return "VERIFIED ON-CHAIN";
  return kind.toUpperCase();
}
