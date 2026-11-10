// Read-only chain reconciliation. Never imports a Keypair, signs or broadcasts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { planHash, validatePlan } from "../src/hermes/paid-plan";
import { verifySettlement } from "../src/solana/receipt";
import { PaymentJournal } from "../services/x402-signer/journal";
import { privatePath } from "../services/x402-signer/private-path";
import { decodePaymentResponse, normalizeQuotes } from "../src/hermes/protocol";
import { paidEvidenceSchema } from "../src/hermes/evidence";

async function main() {
  if (!process.env.X402_APPROVED_PLAN || !process.env.X402_JOURNAL_DIR) throw new Error("Set the public approval plan path and the existing private journal directory");
  const raw = JSON.parse(readFileSync(privatePath(process.env.X402_APPROVED_PLAN), "utf8"));
  const plan = validatePlan(raw, Date.parse(raw.createdAt));
  const directory = privatePath(process.env.X402_JOURNAL_DIR), journal = new PaymentJournal(directory);
  const row = journal.rows().filter((row) => row.planId === plan.id).at(-1);
  if (!row?.messageBase64 || row.hash !== planHash(plan)) throw new Error("No persisted approved message for this plan");
  const signatureIndex = process.argv.indexOf("--signature");
  const signature = signatureIndex >= 0 ? process.argv[signatureIndex + 1] : row.signature;
  if (!signature || signature.endsWith(".ts")) throw new Error("Provide --signature with the independently observed Solana transaction signature");
  const rpc = new Connection(process.env.SOLANA_VERIFICATION_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
  if (await rpc.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new Error("Expected mainnet RPC");
  const evidence = await verifySettlement(rpc, signature, plan, Buffer.from(row.messageBase64, "base64"));
  if (row.state !== "verified") journal.append({ ...row, state: "verified", signature: evidence.signature });
  let quoteResponseRecovered = false;
  if (process.argv.includes("--recover-quote")) {
    const response = JSON.parse(readFileSync(join(directory, "evidence", `${plan.id}-response.json`), "utf8"));
    const receipt = decodePaymentResponse(response.receipt);
    if (response.status !== 200 || typeof response.body !== "string" || !receipt.ok || receipt.transaction !== signature || response.receipt !== row.receiptHeader) throw new Error("Settlement verified but no matching successful original quote response was captured");
    const quotes = normalizeQuotes(JSON.parse(response.body));
    const recovered = paidEvidenceSchema.parse({ schemaVersion: 1, evidenceClass: "verified_chain", at: new Date().toISOString(), plan, messageBase64: row.messageBase64, messageHash: createHash("sha256").update(Buffer.from(row.messageBase64, "base64")).digest("hex"), receiptHeader: response.receipt, responseSha256: createHash("sha256").update(response.body).digest("hex"), evidence,
      quotes: quotes.map((q) => ({ provider: q.providerKey, inputAtomic: q.inputAmount, outputAtomic: q.outputAmount, minOutAtomic: q.minOutAtomic?.toString() ?? null })) });
    writeFileSync(join(directory, "evidence", `${plan.id}-verified.json`), JSON.stringify(recovered, null, 2), { flag: "wx", mode: 0o600 });
    quoteResponseRecovered = true;
  }
  const output = process.env.X402_RECONCILIATION_FILE;
  const record = { at: new Date().toISOString(), planId: plan.id, planHash: planHash(plan), evidenceClass: "verified_chain", evidence, quoteResponseRecovered };
  if (output) writeFileSync(privatePath(output), JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(record, null, 2));
  console.log("Settlement verified independently. Only an existing genuine response can be recovered; another payment is never authorized.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Reconciliation failed; keep the payment held"); process.exitCode = 1; });
