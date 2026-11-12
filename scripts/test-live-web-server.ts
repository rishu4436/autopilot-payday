// Isolated test-only server. It never connects to Solana or loads a user key.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { SCHEMA_SQL } from "../src/db/sql";
import { seedIfEmpty } from "../src/db/seed";
import type { AppDb } from "../src/db/client";
import { defaultPolicy } from "../src/domain/policy-doc";
import { TreasuryTestBank } from "../src/solana/__fixtures__/treasury-bank";
import { TREASURY_RELEASE } from "../src/server/live-treasury";
import { Keypair, PublicKey, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { HERMES_FEE_PAYER, HERMES_PAYEE } from "../src/hermes/paid-plan";
import { syntheticCpmmBuild } from "../src/solana/__fixtures__/cpmm";
import { USDC_MINT } from "../src/domain/tokens";
import { createHash } from "node:crypto";
import { signApiCapture } from "../src/hermes/capture-signature";

async function main() {
  if (process.env.PAYDAY_SYNTHETIC_TEST !== "true") throw new Error("Test server requires PAYDAY_SYNTHETIC_TEST=true");
  const directory = mkdtempSync(join(tmpdir(), "payday-live-browser-")), client = new PGlite(directory);
  await client.waitReady; await client.exec(SCHEMA_SQL); const db = drizzle(client) as AppDb;
  process.env.APP_MODE = "demo"; process.env.DATABASE_URL = ""; await seedIfEmpty(db);
  const bank = new TreasuryTestBank();
  const apiPayer = Keypair.fromSeed(new Uint8Array(32).fill(231));
  await db.execute(sql`update treasury_accounts set address=${apiPayer.publicKey.toBase58()} where kind='api_payer'`);
  await db.execute(sql`update organizations set mode='live',live_enabled=true where id='org_northstar'`);
  await db.execute(sql`update users set wallet_address=${bank.owner} where id='user_owner'`);
  await db.execute(sql`update treasury_accounts set address=${bank.owner},sol_atomic='1000000000',usdc_atomic='150000000',source='synthetic-rpc' where kind='treasury'`);
  await db.execute(sql`update policies set body=${JSON.stringify({ ...defaultPolicy(), minTreasurySolAtomic: "20000000", minTreasuryUsdcAtomic: "0" })} where org_id='org_northstar'`);
  await db.execute(sql`insert into payroll_batches(id,org_id,status,total_atomic,operation_id,proposal_hash,evidence_class,created_at) values ('live-browser-batch','org_northstar','APPROVED','125000000',null,'synthetic-browser-batch-approval','live_unpaid',now())`);
  const tasks = (await db.execute<{ id: string; locked_recipient: string; amount_atomic: string }>(sql`select id,locked_recipient,amount_atomic from milestones where id in ('ms_brand','ms_eng','ms_film') order by id`)).rows;
  for (const [i, task] of tasks.entries()) {
    bank.registerWallet(task.locked_recipient, 0n, false);
    await db.execute(sql`insert into payroll_items(id,batch_id,milestone_id,amount_atomic,recipient,status) values (${`live-browser-${i}`},'live-browser-batch',${task.id},${task.amount_atomic},${task.locked_recipient},'PENDING')`);
  }
  await client.close(); // Next owns the only persistent PGlite handle from here.
  const artifact = syntheticCpmmBuild(bank);
  bank.registerWallet(apiPayer.publicKey.toBase58(), 100_000_000n, true);
  bank.registerWallet(HERMES_PAYEE, 0n, true);
  bank.accounts.set(HERMES_FEE_PAYER, { lamports: 1_000_000_000n });
  const mint = new PublicKey(USDC_MINT), source = getAssociatedTokenAddressSync(mint, apiPayer.publicKey), target = getAssociatedTokenAddressSync(mint, new PublicKey(HERMES_PAYEE));
  const payment = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(HERMES_FEE_PAYER), recentBlockhash: bank.latest().blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), createTransferCheckedInstruction(source, mint, target, apiPayer.publicKey, 3007n, 6)] }).compileToV0Message());
  payment.sign([apiPayer]); payment.signatures[0] = new Uint8Array(64).fill(8);
  const before = structuredClone(bank.accounts), after = structuredClone(bank.accounts);
  after.get(source.toBase58())!.amount! -= 3007n; after.get(target.toBase58())!.amount! += 3007n; after.get(HERMES_FEE_PAYER)!.lamports -= 5000n;
  bank.accounts = after;
  bank.transactions.set(artifact.record.evidence.signature, { tx: payment, run: { before, after, inner: [], logs: [] }, err: null, slot: 99 });
  artifact.record.messageBase64 = Buffer.from(payment.message.serialize()).toString("base64"); artifact.record.messageHash = createHash("sha256").update(payment.message.serialize()).digest("hex");
  const rpc = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/stats") { res.end(JSON.stringify({ synthetic: true, sends: bank.sends })); return; }
    if (req.url === "/swap-bundle") {
      const now = new Date().toISOString(); artifact.record.at = now; artifact.record.plan.createdAt = now; artifact.record.plan.expiresAt = new Date(Date.now() + 60000).toISOString(); artifact.record.plan.quote.createdAt = now;
      artifact.record.captureSignature = signApiCapture(artifact.record.plan, artifact.response.body, 200, artifact.response.receipt, apiPayer.secretKey);
      res.end(JSON.stringify(artifact)); return;
    }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    try { res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result: await bank.rpcRequest(input.method, input.params ?? []) })); }
    catch (error) { res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, error: { code: -32000, message: error instanceof Error ? error.message : "Synthetic RPC failure" } })); }
  });
  await new Promise<void>((resolve) => rpc.listen(3140, "127.0.0.1", resolve));
  const env = { ...process.env, APP_MODE: "live", APP_ORIGIN: "http://127.0.0.1:3102", DATABASE_URL: "", PGLITE_DIR: directory, COOKIE_SECURE: "false", SOLANA_RPC_URL: "http://127.0.0.1:3140", SOLANA_VERIFICATION_RPC_URL: "http://127.0.0.1:3140", LIVE_OPERATIONS: "true", TREASURY_EXECUTION_ENABLED: "true", TREASURY_REVIEWED_RELEASE: TREASURY_RELEASE };
  for (const key of ["PAYER_KEYPAIR", "X402_SIGNER_TOKEN", "X402_APPROVED_PLAN", "X402_APPROVED_PLAN_SHA256"]) delete (env as Record<string, string | undefined>)[key];
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3102"], { cwd: process.cwd(), env, windowsHide: true, stdio: "inherit" });
  const stop = () => { child.kill(); rpc.close(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  child.on("exit", (code) => { rpc.close(); process.exitCode = code ?? 1; });
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
