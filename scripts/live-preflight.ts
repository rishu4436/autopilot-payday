// Read-only deployment check. Never reads a keypair, signs, pays or broadcasts.
import "./load-live-env";
import { Connection } from "@solana/web3.js";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { loadBooks } from "../src/server/books";
import { readChainBalances } from "../src/server/chain";
import { liveReadiness, type ReadinessCheck } from "../src/server/live-readiness";
import { discoverLive } from "../src/server/hermes";

async function main() {
  const checks: ReadinessCheck[] = [];
  if (process.env.APP_MODE !== "live" && process.env.APP_MODE !== "live_readonly") throw new Error("Set APP_MODE=live_readonly or live in .env.live.local before checking the live workspace");
  if (!process.env.DATABASE_URL) throw new Error("Set the dedicated Vercel PostgreSQL DATABASE_URL privately in .env.live.local; no database was opened");
  const db = await getDb(), slug = process.env.ORG_SLUG || "payday-live";
  const org = (await db.execute<{ id: string }>(sql`select id from organizations where slug=${slug} and mode<>'demo'`)).rows[0];
  if (!org) throw new Error("No matching non-demo workspace. Run live:provision-org with your public addresses first");
  const books = await loadBooks(db, org.id);
  // This is an administrative configuration check, not a fabricated wallet session.
  const configured = liveReadiness(books, { id: "", userId: "", orgId: org.id, role: "owner", authMode: "unverified", displayName: "" }, { ...process.env, VERCEL: "1" }).filter((check) => check.id !== "owner");
  checks.push(...configured);
  const rows = (await db.execute(sql`select m.id from organization_members m join users u on u.id=m.user_id where m.org_id=${org.id} and m.role='owner' and u.wallet_address=${books.treasury.address}`)).rows;
  checks.push({ id: "owner_mapping", label: "Treasury owner membership", ok: rows.length === 1, detail: "The website still requires a real wallet sign-in and exact transaction signatures." });
  for (const [id, endpoint] of [["primary_rpc", process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"], ["verification_rpc", process.env.SOLANA_VERIFICATION_RPC_URL || ""]] as const) {
    try {
      const rpc = new Connection(endpoint, { disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
      checks.push({ id, label: id, ok: await rpc.getGenesisHash() === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", detail: "Read-only mainnet genesis check." });
    } catch { checks.push({ id, label: id, ok: false, detail: "RPC unavailable or invalid; endpoint credentials are not logged." }); }
  }
  try {
    const balances = await readChainBalances(books.treasury.address);
    const reserve = BigInt(books.policy.minTreasurySolAtomic) > 5_000_000n ? BigInt(books.policy.minTreasurySolAtomic) : 5_000_000n;
    checks.push({ id: "treasury_balance", label: "Treasury SOL headroom", ok: balances.solAtomic > reserve + 200_000n + 20_000_000n, detail: `Read SOL lamports ${balances.solAtomic}; USDC atomic ${balances.usdcAtomic}. Exact transaction preview calculates required funds; this conservative check covers fee/rent headroom, not the swap input.` });
  } catch { checks.push({ id: "treasury_balance", label: "Public treasury balances", ok: false, detail: "Could not read public balances; no transaction attempted." }); }
  const unresolved = (await db.execute(sql`select id from treasury_attempts where state in ('PREPARED','SIGNED','UNKNOWN') and manifest::jsonb->'proposal'->>'owner'=${books.treasury.address}`)).rows;
  checks.push({ id: "attempts", label: "No unresolved treasury attempt", ok: unresolved.length === 0, detail: `${unresolved.length} unresolved attempts. Reconcile or resume the existing transaction before creating another.` });
  try {
    const info = await discoverLive(true);
    checks.push({ id: "swapio", label: "Swap.io discovery", ok: ["/v1/swap/quote", "/v1/swap/build-tx"].every((path) => info.endpoints.some((e) => e.path === path && e.payment === "x402")), detail: "Public discovery only; no paid quote or route availability is claimed." });
  } catch { checks.push({ id: "swapio", label: "Swap.io discovery", ok: false, detail: "Public merchant discovery unavailable; no payment attempted." }); }
  console.log(JSON.stringify({ readOnly: true, checkedAt: new Date().toISOString(), configurationReady: checks.every((c) => c.ok), financialTransactionExecuted: false, checks }, null, 2));
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  console.error(message.startsWith("Set APP_MODE=") || message.startsWith("Set the dedicated Vercel") || message.startsWith("No matching non-demo") ? message : "Live preflight incomplete. Check .env.live.local, the dedicated database, public workspace provisioning and RPC configuration. No credentials are logged; no financial transaction was attempted.");
  process.exitCode = 1;
});
