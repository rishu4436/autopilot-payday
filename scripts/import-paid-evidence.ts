// Read-only, independently verified import. Never loads signer credentials.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { canonicalJson } from "../src/domain/approval";
import { normalizeQuotes } from "../src/hermes/protocol";
import { verifyPaidEvidence } from "../src/hermes/evidence";
import { privatePath } from "../services/x402-signer/private-path";
async function main() {
  if (!process.env.X402_VERIFIED_RECORD || !process.env.X402_RAW_RESPONSE) throw new Error("Set X402_VERIFIED_RECORD and X402_RAW_RESPONSE to the existing private signer evidence files");
  const raw = JSON.parse(readFileSync(privatePath(process.env.X402_VERIFIED_RECORD), "utf8"));
  const response = JSON.parse(readFileSync(privatePath(process.env.X402_RAW_RESPONSE), "utf8"));
  const rpc = new Connection(process.env.SOLANA_VERIFICATION_RPC_URL || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
  const record = await verifyPaidEvidence(raw, rpc);
  if (response.status !== 200 || typeof response.body !== "string" || response.receipt !== record.receiptHeader || createHash("sha256").update(response.body).digest("hex") !== record.responseSha256) throw new Error("Original paid API response/receipt mismatch");
  const quotes = normalizeQuotes(JSON.parse(response.body)).map((q) => ({ provider: q.providerKey, inputAtomic: q.inputAmount, outputAtomic: q.outputAmount, minOutAtomic: q.minOutAtomic?.toString() ?? null }));
  if (canonicalJson(quotes) !== canonicalJson(record.quotes)) throw new Error("Public quotes differ from genuine API response");
  mkdirSync("evidence/public", { recursive: true });
  writeFileSync("evidence/public/paid-quote.json", JSON.stringify(record, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ imported: true, signature: record.evidence.signature, solscan: record.evidence.solscan }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Evidence import refused"); process.exitCode = 1; });
