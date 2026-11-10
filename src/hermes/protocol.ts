import { USDC_MINT, SOLANA_X402_NETWORK, CHAIN_KEY, WSOL_MINT } from "@/domain/tokens";
import { discoverySchema, paymentRequiredSchema, quoteSchema, buildTxSchema, type Discovery, type PaymentRequired, type QuoteResponse } from "./schemas";

export type { Discovery };

export interface NormalizedNeed {
  scheme: string;
  network: string;
  maxAmountRequired: bigint;
  resource: string;
  payTo: string;
  asset: string;
  feePayer: string | null;
  maxTimeoutSeconds: number | null;
}

export function parsePaymentRequired(body: unknown): PaymentRequired {
  if (body && typeof body === "object" && "x402Version" in body && body.x402Version === 2) {
    const v2 = body as { x402Version: number; resource?: { url?: string }; accepts?: Record<string, unknown>[] };
    return paymentRequiredSchema.parse({ ...v2, accepts: v2.accepts?.map((need) => ({ ...need, maxAmountRequired: need.amount, resource: v2.resource?.url })) });
  }
  return paymentRequiredSchema.parse(body);
}

export function normalizeNeed(body: PaymentRequired): NormalizedNeed[] {
  return body.accepts.map((row) => ({
    scheme: row.scheme,
    network: row.network,
    maxAmountRequired: BigInt(row.maxAmountRequired),
    resource: row.resource,
    payTo: row.payTo,
    asset: row.asset,
    feePayer: row.extra?.feePayer ?? null,
    maxTimeoutSeconds: row.maxTimeoutSeconds ?? null,
  }));
}

export function selectSolanaUsdc(needs: readonly NormalizedNeed[]): NormalizedNeed | null {
  return needs.find((need) => need.scheme === "exact" && need.network === SOLANA_X402_NETWORK && need.asset === USDC_MINT) ?? null;
}

export function parseDiscovery(body: unknown): Discovery {
  return discoverySchema.parse(body);
}

export function solanaPayees(discovery: Discovery, path: string): string[] {
  const endpoint = discovery.endpoints.find((row) => row.path === path);
  const accepts = endpoint?.accepts ?? [];
  return accepts.filter((row) => row.network === SOLANA_X402_NETWORK && row.asset === USDC_MINT).map((row) => row.payTo);
}

export function assertHermesUrl(url: string, base = "https://hermes.swap.io"): void {
  const target = new URL(url);
  const allowed = new URL(base);
  if (target.protocol !== "https:") throw new Error("Hermes URL must be https");
  if (target.username || target.password || target.hash) throw new Error("Hermes URL contains credentials or a fragment");
  if (allowed.origin !== "https://hermes.swap.io") throw new Error("Only the official Hermes origin is supported");
  if (target.origin !== allowed.origin) {
    throw new Error("Refusing to send a payment outside the configured Hermes origin");
  }
}

export function buildQuoteBody(input: {
  inputMint: string;
  inputAmount: bigint;
  outputMint: string;
  userAddress: string;
  slippageBps: number;
}): Record<string, unknown> {
  return {
    input: { token: input.inputMint, amount: input.inputAmount.toString(), chainKey: CHAIN_KEY },
    output: { token: input.outputMint, chainKey: CHAIN_KEY },
    userAddress: input.userAddress,
    slippageBps: input.slippageBps,
  };
}

export function buildSwapTxBody(input: {
  providerKey: string;
  userAddress: string;
  providerQuote: unknown;
  slippageBps?: number;
}): Record<string, unknown> {
  return {
    provider: input.providerKey,
    userAddress: input.userAddress,
    chainKey: CHAIN_KEY,
    quoteResponse: input.providerQuote,
    ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
  };
}

export function buildTransferBody(input: {
  sourceWallet: string;
  token: string;
  destinations: { wallet: string; amountAtomic: bigint }[];
  createAta?: "auto" | "always" | "never";
}): Record<string, unknown> {
  return {
    source_wallet: input.sourceWallet,
    token: input.token,
    destinations: input.destinations.map((row) => ({ wallet: row.wallet, amount: row.amountAtomic.toString() })),
    create_ata: input.createAta ?? "auto",
    gasless: false,
  };
}

export interface NormalizedQuote {
  providerKey: string;
  providerName: string | null;
  inputAmount: string | null;
  outputAmount: string | null;
  minOutAtomic: bigint | null;
  slippageBps: number | null;
  priceImpact: string | null;
  providerQuote: unknown;
  best: boolean;
}

function readMinOut(quote: QuoteResponse["quotes"][number]): bigint | null {
  const raw = quote.minimumOutAmount ?? quote.minOutAmount ?? quote.output?.minAmount ?? quote.output?.minimumAmount;
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

export function normalizeQuotes(body: unknown): NormalizedQuote[] {
  const parsed = quoteSchema.parse(body);
  return parsed.quotes.map((quote) => ({
    providerKey: quote.provider.key,
    providerName: quote.provider.name ?? null,
    inputAmount: quote.input?.amount ?? null,
    outputAmount: quote.output?.amount ?? null,
    minOutAtomic: readMinOut(quote),
    slippageBps: quote.slippageBps ?? null,
    priceImpact: quote.priceImpactPct === undefined || quote.priceImpactPct === null ? null : String(quote.priceImpactPct),
    providerQuote: quote.providerQuote,
    best: quote.bestQuote === true,
  }));
}

export function parseBuildTransaction(body: unknown): { transaction: string; provider: string | null; warnings: unknown[] } {
  const parsed = buildTxSchema.parse(body);
  return {
    transaction: parsed.transaction,
    provider: parsed.provider ?? null,
    warnings: parsed.warnings ?? [],
  };
}

export interface PaidBodyResult {
  kind: "payment_required" | "unverified_success" | "error" | "rate_limited";
  status: number;
  body: unknown;
}

export async function readUnpaid(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<PaidBodyResult> {
  assertHermesUrl(url);
  const response = await fetchImpl(url, { ...init, redirect: "error" });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
  }
  const header = response.headers.get("payment-required");
  if (response.status === 402 && header) {
    try { body = JSON.parse(Buffer.from(header, "base64").toString("utf8")); }
    catch { throw new Error("Malformed PAYMENT-REQUIRED header"); }
  }
  if (response.status === 402) return { kind: "payment_required", status: 402, body };
  if (response.status === 429) return { kind: "rate_limited", status: 429, body };
  if (response.status === 200) return { kind: "unverified_success", status: 200, body };
  return { kind: "error", status: response.status, body };
}

export function decodePaymentResponse(header: string | null): { ok: true; transaction: string; raw: unknown } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "Missing X-PAYMENT-RESPONSE header" };
  try {
    const padded = header.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (raw.success !== true) return { ok: false, reason: "Settlement receipt is not successful" };
    const transaction = raw.transaction ?? raw.transactionHash ?? raw.txHash;
    if (typeof transaction !== "string" || transaction.length < 32) {
      return { ok: false, reason: "Settlement receipt has no transaction signature" };
    }
    return { ok: true, transaction, raw };
  } catch {
    return { ok: false, reason: "Settlement receipt could not be decoded" };
  }
}

export function defaultQuoteRequest(userAddress: string, lamports: bigint, slippageBps = 50): Record<string, unknown> {
  return buildQuoteBody({
    inputMint: WSOL_MINT,
    inputAmount: lamports,
    outputMint: USDC_MINT,
    userAddress,
    slippageBps,
  });
}
