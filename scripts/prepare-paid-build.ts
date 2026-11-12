// Public/read-only preflight for a separately approved paid unsigned build.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { privatePath } from "../services/x402-signer/private-path";
import { verifyPaidEvidence } from "../src/hermes/evidence";
import { BUILD_URL, planHash, validatePaymentPlan } from "../src/hermes/paid-plan";
import { buildSwapTxBody, normalizeQuotes, normalizeNeed, parsePaymentRequired, selectSolanaUsdc } from "../src/hermes/protocol";
import { unpaidHermes } from "../src/server/hermes";

async function main() {
  if (!process.env.X402_VERIFIED_RECORD || !process.env.X402_RAW_RESPONSE || !process.env.X402_BUILD_PLAN) throw new Error("Set private X402_VERIFIED_RECORD, X402_RAW_RESPONSE and a new X402_BUILD_PLAN path");
  const rpc = new Connection(process.env.SOLANA_VERIFICATION_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
  const quote = await verifyPaidEvidence(JSON.parse(readFileSync(privatePath(process.env.X402_VERIFIED_RECORD), "utf8")), rpc);
  const response = JSON.parse(readFileSync(privatePath(process.env.X402_RAW_RESPONSE), "utf8"));
  if (response.status !== 200 || response.receipt !== quote.receiptHeader || typeof response.body !== "string" || createHash("sha256").update(response.body).digest("hex") !== quote.responseSha256) throw new Error("Original paid quote capture mismatch");
  const choices = normalizeQuotes(JSON.parse(response.body));
  const selected = choices.find((row) => row.providerKey === process.env.SWAP_PROVIDER_KEY) ?? (choices.length === 1 ? choices[0] : undefined);
  if (!selected?.outputAmount || !/^[1-9]\d*$/.test(selected.outputAmount) || selected.inputAmount !== quote.plan.body.input.amount || !selected.providerQuote || typeof selected.providerQuote !== "object" || Array.isArray(selected.providerQuote)) throw new Error("Select SWAP_PROVIDER_KEY with an exact matching input and usable output/providerQuote");
  const calculatedMin = BigInt(selected.outputAmount) * BigInt(10_000 - quote.plan.body.slippageBps) / 10_000n;
  const minimum = selected.minOutAtomic !== null && selected.minOutAtomic > calculatedMin ? selected.minOutAtomic : calculatedMin;
  const body = buildSwapTxBody({ providerKey: selected.providerKey, userAddress: quote.plan.body.userAddress, providerQuote: selected.providerQuote, slippageBps: quote.plan.body.slippageBps });
  const challenge = await unpaidHermes("/v1/swap/build-tx", { method: "POST", body });
  if (challenge.status !== 402) throw new Error(`Expected unpaid build challenge, received ${challenge.status}`);
  const need = selectSolanaUsdc(normalizeNeed(parsePaymentRequired(challenge.body)));
  if (!need?.feePayer || need.resource !== BUILD_URL || need.maxTimeoutSeconds === null || !Number.isInteger(need.maxTimeoutSeconds) || need.maxTimeoutSeconds <= 0 || need.maxTimeoutSeconds > 60) throw new Error("Unexpected build payment terms");
  const now = Date.now();
  const plan = validatePaymentPlan({ ...quote.plan, id: crypto.randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(now + 15 * 60_000, Date.parse(quote.at) + 120_000)).toISOString(), url: BUILD_URL, body,
    terms: { scheme: need.scheme, network: need.network, asset: need.asset, amount: need.maxAmountRequired.toString(), payTo: need.payTo, feePayer: need.feePayer, resource: need.resource }, maxAtomic: need.maxAmountRequired.toString(),
    quote: { paymentSignature: quote.evidence.signature, responseSha256: quote.responseSha256, createdAt: quote.at, inputAtomic: quote.plan.body.input.amount, outputAtomic: selected.outputAmount, minOutputAtomic: minimum.toString(), slippageBps: quote.plan.body.slippageBps } });
  const output = privatePath(process.env.X402_BUILD_PLAN);
  if (plan.url !== BUILD_URL) throw new Error("Expected build plan");
  writeFileSync(output, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ preparedOnly: true, output, planHash: planHash(plan), endpoint: plan.url, payer: plan.payer, payee: plan.terms.payTo, exactMaximumAtomicUsdc: plan.maxAtomic, treasury: plan.body.userAddress, inputLamports: plan.quote?.inputAtomic, minimumOutputAtomicUsdc: plan.quote?.minOutputAtomic, expiresAt: plan.expiresAt }, null, 2));
  console.log("STOP. Separately approve this exact paid BUILD plan/hash before using --enable-paid-build. It only buys unsigned bytes; a swap still requires wallet approval.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Build preflight failed"); process.exitCode = 1; });
