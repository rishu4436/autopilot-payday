// Full 32-byte base58 genesis hash returned by Solana mainnet getGenesisHash.
// Payment protocols may use its shortened CAIP-2 reference; that identifier is
// not a valid substitute for independently identifying an RPC cluster.
export const SOLANA_MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export async function assertMainnetRpc(rpc: { getGenesisHash(): Promise<string> }): Promise<void> {
  if (await rpc.getGenesisHash() !== SOLANA_MAINNET_GENESIS_HASH) throw new Error("Expected Solana mainnet RPC genesis hash");
}
