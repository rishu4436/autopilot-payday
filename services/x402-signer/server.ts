import { createServer, type IncomingMessage } from "node:http";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createX402Client } from "x402-solana/client";
import { decodePaymentResponse, normalizeQuotes } from "../../src/hermes/protocol";
import { planHash, validatePlan, validateTerms } from "../../src/hermes/paid-plan";
import { USDC_MINT } from "../../src/domain/tokens";
import { validatePaymentTransaction } from "../../src/solana/payment-guard";
import { verifySettlement } from "../../src/solana/receipt";
import { authorizeLocalRequest } from "./http-policy";
import { PaymentJournal, type JournalRow } from "./journal";

async function main() {
  if (process.env.LIVE_OPERATIONS !== "true" || !process.argv.includes("--enable-paid-quote")) throw new Error("Paid signer disabled. Owner approval and --enable-paid-quote are required.");
  const token = process.env.X402_SIGNER_TOKEN;
  if (!token || token.length < 32 || !process.env.PAYER_KEYPAIR || !process.env.X402_APPROVED_PLAN || !process.env.X402_APPROVED_PLAN_SHA256 || !process.env.X402_JOURNAL_DIR) throw new Error("Missing private local signer configuration (see audit runbook)");
  const plan = validatePlan(JSON.parse(readFileSync(process.env.X402_APPROVED_PLAN, "utf8")));
  if (planHash(plan) !== process.env.X402_APPROVED_PLAN_SHA256) throw new Error("Plan hash does not match owner approval");
  const secret: unknown = JSON.parse(readFileSync(process.env.PAYER_KEYPAIR, "utf8"));
  if (!Array.isArray(secret) || secret.length !== 64 || secret.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error("Invalid local Solana keypair file");
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  if (payer.publicKey.toBase58() !== plan.payer) throw new Error("Payer differs from the approved public address");
  const rpc = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
  if (await rpc.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new Error("Expected Solana mainnet RPC");
  const directory = resolve(process.env.X402_JOURNAL_DIR);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "signer.lock");
  const lockFd = openSync(lockPath, "wx", 0o600);
  const journal = new PaymentJournal(directory);
  const release = () => { closeSync(lockFd); unlinkSync(lockPath); };
  let busy = false;
  async function body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) throw new Error("Body too large");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store");
    try { authorizeLocalRequest(req.socket.remoteAddress, req.headers, token); }
    catch { res.writeHead(403).end(JSON.stringify({ message: "Local authenticated CLI access only" })); return; }
    if (req.url === "/health" && req.method === "GET") {
      res.end(JSON.stringify({ ok: true, address: plan.payer, planId: plan.id, planHash: planHash(plan), busy })); return;
    }
    if (req.url !== "/v1/paid" || req.method !== "POST") { res.writeHead(404).end(); return; }
    if (busy) { res.writeHead(409).end(JSON.stringify({ message: "Another payment is in progress" })); return; }
    busy = true;
    let attempt: JournalRow | undefined;
    try {
      const input = JSON.parse(await body(req));
      if (input.planId !== plan.id || Object.keys(input).length !== 1) throw new Error("Only the approved plan ID is accepted");
      validatePlan(plan);
      let signedMessage: Uint8Array | undefined;
      let termsValidated = false;
      const client = createX402Client({
        wallet: { address: plan.payer, signTransaction: async (tx) => {
          if (!attempt || !termsValidated || signedMessage) throw new Error("No fresh durable payment reservation");
          validatePaymentTransaction(tx, plan);
          const simulation = await rpc.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
          if (simulation.value.err) throw new Error("Payment simulation failed");
          validatePlan(plan);
          signedMessage = tx.message.serialize();
          journal.append({ ...attempt, state: "signed", messageHash: createHash("sha256").update(signedMessage).digest("hex") });
          tx.sign([payer]); return tx;
        } },
        network: "solana", rpcUrl: rpc.rpcEndpoint, amount: BigInt(plan.maxAtomic), verbose: false,
        customFetch: async (url, init) => {
          if (String(url) !== plan.url) throw new Error("Unexpected payment endpoint");
          return fetch(url, { ...init, redirect: "error" });
        },
        beforePayment: async (requirements, context) => {
          if (attempt) throw new Error("Multiple payment attempts rejected");
          validateTerms(plan, requirements as unknown as Record<string, unknown>, context);
          const account = await getAccount(rpc, getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), payer.publicKey));
          if (account.isFrozen || !account.owner.equals(payer.publicKey) || !account.mint.equals(new PublicKey(USDC_MINT))) throw new Error("Invalid payer token account");
          attempt = journal.reserve(plan, account.amount); termsValidated = true;
        },
      });
      const response = await client.fetch(plan.url, { method: plan.method, headers: { "content-type": "application/json" }, body: JSON.stringify(plan.body), signal: AbortSignal.timeout(45_000) });
      const receipt = decodePaymentResponse(response.headers.get("x-payment-response") || response.headers.get("payment-response"));
      if (!attempt || !signedMessage || response.status !== 200 || !receipt.ok) throw new Error("No independently verified paid settlement");
      const evidence = await verifySettlement(rpc, receipt.transaction, plan, signedMessage);
      journal.append({ ...attempt, state: "verified", signature: evidence.signature });
      const result: unknown = await response.json(); normalizeQuotes(result);
      res.end(JSON.stringify({ status: 200, body: result, evidence, receiptHeader: response.headers.get("x-payment-response") || response.headers.get("payment-response") }));
    } catch {
      if (attempt) journal.append({ ...attempt, state: "unknown" });
      res.writeHead(409).end(JSON.stringify({ message: attempt ? "Payment settlement requires reconciliation. This plan cannot be retried. Inspect the journal and Solana independently." : "Request rejected before signing. Inspect the plan, terms, balance and expiry locally." }));
    } finally { busy = false; }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5_000;
  server.listen(8787, "127.0.0.1", () => console.log(`One-shot paid quote signer on 127.0.0.1:8787; payer ${plan.payer}; plan ${plan.id}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { release(); process.exit(0); }));
  server.on("error", () => { release(); process.exitCode = 1; });
}
main().catch(() => { console.error("Signer refused startup. Check local approval, plan, keypair, RPC and journal lock. No secret values are logged."); process.exitCode = 1; });
