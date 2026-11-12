import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { assertMainnetRpc, SOLANA_MAINNET_GENESIS_HASH } from "./network";

describe("real RPC cluster identity versus payment-network reference", () => {
  // Captured independently from the official Solana RPC and PublicNode with a
  // read-only getGenesisHash request. No wallet or signed request was involved.
  const recordedResponse = { jsonrpc: "2.0", result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", id: 1 };
  it("accepts the complete mainnet RPC response, which decodes to 32 bytes", async () => {
    expect(bs58.decode(SOLANA_MAINNET_GENESIS_HASH)).toHaveLength(32);
    await expect(assertMainnetRpc({ getGenesisHash: async () => recordedResponse.result })).resolves.toBeUndefined();
  });
  it.each([
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    `${recordedResponse.result}extra`,
  ])("rejects a shortened, CAIP, alternate or extended identity: %s", async (hash) => {
    await expect(assertMainnetRpc({ getGenesisHash: async () => hash })).rejects.toThrow("mainnet");
  });
  it("propagates an unavailable RPC instead of treating absence as mainnet", async () => {
    await expect(assertMainnetRpc({ getGenesisHash: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
  });
});
