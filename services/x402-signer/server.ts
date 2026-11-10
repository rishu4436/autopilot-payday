import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { planHash, validatePlan } from "../../src/hermes/paid-plan";
import { USDC_MINT } from "../../src/domain/tokens";
import { verifySettlement } from "../../src/solana/receipt";
import { createSignerServer } from "./http-server";
import { executePaidQuote } from "./execute";
import { PaymentJournal } from "./journal";
import { privatePath } from "./private-path";
async function main() {
  if (process.env.LIVE_OPERATIONS !== "true" || !process.argv.includes("--enable-paid-quote")) throw new Error("Paid signer disabled; separate exact-plan approval is required");
  const token = process.env.X402_SIGNER_TOKEN;
  if (!token || token.length < 32 || !process.env.PAYER_KEYPAIR || !process.env.X402_APPROVED_PLAN || !process.env.X402_APPROVED_PLAN_SHA256 || !process.env.X402_JOURNAL_DIR) throw new Error("Missing private local signer configuration");
  const plan = validatePlan(JSON.parse(readFileSync(privatePath(process.env.X402_APPROVED_PLAN), "utf8")));
  if (planHash(plan) !== process.env.X402_APPROVED_PLAN_SHA256) throw new Error("Plan differs from owner approval");
  const secret: unknown = JSON.parse(readFileSync(privatePath(process.env.PAYER_KEYPAIR), "utf8"));
  if (!Array.isArray(secret) || secret.length !== 64 || secret.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error("Invalid private keypair file");
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  if (payer.publicKey.toBase58() !== plan.payer) throw new Error("Payer does not match the approved public address");
  const options = { commitment: "confirmed" as const, disableRetryOnRateLimit: true, fetch: (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) };
  const rpc = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", options);
  const verificationRpc = new Connection(process.env.SOLANA_VERIFICATION_RPC_URL || rpc.rpcEndpoint, options);
  for (const connection of [rpc, verificationRpc]) if (await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new Error("Expected mainnet RPC");
  const directory = privatePath(process.env.X402_JOURNAL_DIR);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "signer.lock"), lockFd = openSync(lockPath, "wx", 0o600);
  writeFileSync(lockFd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  fsyncSync(lockFd);
  const journal = new PaymentJournal(directory);
  const evidenceDir = join(directory, "evidence"); mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  const save = (name: string, value: unknown) => {
    const fd = openSync(join(evidenceDir, name), "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  };
  const server = createSignerServer({ token, plan, execute: async () => {
    const record = await executePaidQuote(plan, journal, {
      rpcUrl: rpc.rpcEndpoint,
      balance: async () => {
        const account = await getAccount(rpc, getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), payer.publicKey));
        if (account.isFrozen || !account.owner.equals(payer.publicKey) || !account.mint.equals(new PublicKey(USDC_MINT))) throw new Error("Invalid payer token account");
        return account.amount;
      },
      simulate: async (tx) => {
        if (!(await rpc.isBlockhashValid(tx.message.recentBlockhash, { commitment: "confirmed" })).value) throw new Error("Payment blockhash expired or invalid");
        const result = await rpc.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed" });
        if (result.value.err) throw new Error("Payment simulation failed");
      },
      sign: async (tx) => { tx.sign([payer]); return tx; },
      verify: (signature, message) => verifySettlement(verificationRpc, signature, plan, message),
      captureResponse: async (text, status, receipt) => save(`${plan.id}-response.json`, { status, receipt, body: text }),
      save: async (verified) => save(`${plan.id}-verified.json`, verified),
    });
    return { status: 200, record };
  } });
  const release = () => { closeSync(lockFd); unlinkSync(lockPath); };
  server.listen(8787, "127.0.0.1", () => console.log(`One approved quote only; 127.0.0.1:8787; payer ${plan.payer}; plan ${plan.id}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => { release(); process.exit(0); }));
  server.on("error", () => { release(); process.exitCode = 1; });
}
main().catch(() => { console.error("Signer refused startup. Check local approval, private paths, RPC and journal locks. No secret values are logged."); process.exitCode = 1; });
