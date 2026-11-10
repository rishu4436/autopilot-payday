import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decidePaidRetry } from "@/domain/approval";
import { assessApiPayment } from "@/domain/policy";
import { USDC_MINT } from "@/domain/tokens";
import {
  assertHermesUrl,
  buildQuoteBody,
  buildSwapTxBody,
  decodePaymentResponse,
  normalizeQuotes,
  parseDiscovery,
  parsePaymentRequired,
  readUnpaid,
  selectSolanaUsdc,
  solanaPayees,
  normalizeNeed,
} from "./protocol";

const live402 = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/live-402-quote.json"), "utf8"));
const liveInfo = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/live-info.json"), "utf8"));

describe("hermes protocol", () => {
  it("parses the captured live 402 and ignores the Base option", () => {
    const needs = normalizeNeed(parsePaymentRequired(live402.body));
    const solana = selectSolanaUsdc(needs);
    expect(solana?.maxAmountRequired).toBe(3007n);
    expect(solana?.payTo).toBe("BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD");
    expect(solana?.asset).toBe(USDC_MINT);
    expect(solana?.feePayer).toBe("2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4");
    expect(needs.some((need) => need.network === "base")).toBe(true);
  });

  it("builds an allowlist from live discovery and refuses a mismatched payee", () => {
    const discovery = parseDiscovery(liveInfo);
    const payees = solanaPayees(discovery, "/v1/swap/quote");
    expect(payees).toContain("BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD");
    const status = discovery.endpoints.find((row) => row.path === "/v1/swap/status");
    expect(status?.payment).toBe("x402");
    const gate = assessApiPayment({
      amountAtomic: 3007n,
      asset: USDC_MINT,
      network: "solana",
      payTo: "not-the-facilitator",
      expectedAsset: USDC_MINT,
      expectedNetwork: "solana",
      allowedPayTo: payees,
      perCallMaxAtomic: 50_000n,
      dailySpentAtomic: 0n,
      dailyLimitAtomic: 1_000_000n,
      walletBalanceAtomic: 2_500_000n,
      minReserveAtomic: 1_000_000n,
      paused: false,
    });
    expect(gate.ok).toBe(false);
  });

  it("keeps providerQuote intact and rejects a paid 200 without a receipt", async () => {
    const providerQuote = { route: "raw", outAmount: "96000000" };
    const body = buildSwapTxBody({ providerKey: "jupiter", userAddress: "Wallet", providerQuote });
    expect(body.quoteResponse).toBe(providerQuote);
    const quote = buildQuoteBody({
      inputMint: "So11111111111111111111111111111111111111112",
      inputAmount: 1_000_000_000n,
      outputMint: USDC_MINT,
      userAddress: "Wallet",
      slippageBps: 50,
    });
    expect(quote).toMatchObject({ slippageBps: 50, input: { amount: "1000000000", chainKey: "sol" } });

    const unpaid = await readUnpaid(async () => new Response(JSON.stringify({ quotes: [] }), { status: 200 }), "https://hermes.swap.io/v1/swap/quote", { method: "POST" });
    expect(unpaid.kind).toBe("unverified_success");
    expect(decodePaymentResponse(null).ok).toBe(false);

    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: "5".repeat(64), network: "solana" })).toString("base64");
    const decoded = decodePaymentResponse(receipt);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.transaction).toHaveLength(64);
    expect(decodePaymentResponse(Buffer.from(JSON.stringify({ success: false })).toString("base64")).ok).toBe(false);
    expect(decidePaidRetry("settled")).toBe("deny");
  });

  it("reads minimum output from documented fields and refuses a missing one", () => {
    const quotes = normalizeQuotes({
      success: true,
      quotes: [
        {
          provider: { key: "jupiter", name: "Jupiter" },
          minimumOutAmount: "96000000",
          slippageBps: 50,
          priceImpactPct: "0.1",
          providerQuote: { ok: true },
          bestQuote: true,
          output: { amount: "97000000" },
        },
        { provider: { key: "dflow" }, providerQuote: { ok: false } },
      ],
    });
    expect(quotes[0]?.minOutAtomic).toBe(96_000_000n);
    expect(quotes[1]?.minOutAtomic).toBeNull();
  });

  it("refuses to pay a non-Hermes origin", () => {
    expect(() => assertHermesUrl("http://hermes.swap.io/v1/info")).toThrow();
    expect(() => assertHermesUrl("https://evil.example/v1/swap/quote")).toThrow();
    expect(() => assertHermesUrl("https://hermes.swap.io/v1/swap/quote")).not.toThrow();
  });

  it("parses a v2 header challenge and maps amount and top-level resource", async () => {
    const v2 = { x402Version: 2, resource: { url: "https://hermes.swap.io/v1/swap/quote" }, accepts: [{ scheme: "exact", network: "solana", amount: "3007", asset: USDC_MINT, payTo: "BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD", extra: { feePayer: "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" } }] };
    const result = await readUnpaid(async () => new Response(null, { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(v2)).toString("base64") } }), "https://hermes.swap.io/v1/swap/quote", { method: "POST" });
    const need = selectSolanaUsdc(normalizeNeed(parsePaymentRequired(result.body)));
    expect(need?.maxAmountRequired).toBe(3007n);
    expect(need?.resource).toBe("https://hermes.swap.io/v1/swap/quote");
  });

  it("uses the installed x402 client to reject malicious v1 and v2 terms before any signature", async () => {
    const { createX402Client } = await import("x402-solana/client");
    for (const version of [1, 2]) {
      let signed = false, called = false;
      const client = createX402Client({ wallet: { address: "11111111111111111111111111111111", signTransaction: async (tx) => { signed = true; return tx; } }, network: "solana", amount: 10000n,
        customFetch: async () => new Response(version === 1 ? JSON.stringify(live402.body) : null, { status: 402, headers: version === 2 ? { "payment-required": Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: "https://hermes.swap.io/v1/swap/quote" }, accepts: [{ ...live402.body.accepts[0], amount: "3007" }] })).toString("base64") } : {} }),
        beforePayment: () => { called = true; return { abort: true, reason: "test: owner has not approved" }; },
      });
      await expect(client.fetch("https://hermes.swap.io/v1/swap/quote", { method: "POST" })).rejects.toThrow("owner has not approved");
      expect(called).toBe(true); expect(signed).toBe(false);
    }
  });
});
