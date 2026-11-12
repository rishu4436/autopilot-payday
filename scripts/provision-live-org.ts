import { SOLANA_MAINNET_GENESIS_HASH } from "../src/solana/network";
// Administrative local provisioning: public addresses and database writes only.
// It never requests a keypair, signs a transaction or transfers funds.
import "./load-live-env";
import { PublicKey } from "@solana/web3.js";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { connection, readChainBalances } from "../src/server/chain";
import { defaultPolicy } from "../src/domain/policy-doc";
import { TREASURY_RELEASE, treasuryExecutionEnabled } from "../src/server/live-treasury";
async function main() {
  if (!process.argv.includes("--provision-public-addresses")) throw new Error("Explicit --provision-public-addresses is required; this creates/configures a real non-demo organization");
  const testOnly = process.argv.includes("--test-owner-only");
  const enable = process.argv.includes("--enable-reviewed-live");
  if (testOnly && enable) throw new Error("A test-only workspace cannot enable financial execution");
  const owner = new PublicKey(process.env.TREASURY_PUBLIC_KEY || "").toBase58();
  const payer = testOnly ? "" : new PublicKey(process.env.X402_PAYER_PUBLIC_KEY || "").toBase58();
  if (!PublicKey.isOnCurve(new PublicKey(owner).toBytes()) || (!testOnly && !PublicKey.isOnCurve(new PublicKey(payer).toBytes()))) throw new Error("Treasury and API payer must be signable public wallet addresses");
  const slug = process.env.ORG_SLUG || (testOnly ? "payday-owner-uat" : "payday-live");
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug) || owner === payer) throw new Error("Use a valid unique ORG_SLUG and distinct public treasury/API payer addresses");
  if (enable && !treasuryExecutionEnabled()) throw new Error(`Complete security review and set the three explicit treasury flags for release ${TREASURY_RELEASE} before enabling live submission`);
  process.env.APP_MODE = "live_readonly"; // Never seed fixtures during provisioning.
  const db = await getDb();
  const existing = (await db.execute<{ id: string; mode: string }>(sql`select id,mode from organizations where slug=${slug}`)).rows[0];
  if (existing) {
    if (!(testOnly ? existing.mode === "uat_readonly" : ["live_readonly", "live"].includes(existing.mode))) throw new Error("Existing workspace cannot be repurposed. Use a new slug; test-only and demo workspaces cannot become live");
    const member = await db.execute(sql`select m.id from organization_members m join users u on u.id=m.user_id join treasury_accounts t on t.org_id=m.org_id and t.kind='treasury' where m.org_id=${existing.id} and m.role='owner' and u.wallet_address=${owner} and t.address=${owner}`);
    if (member.rows.length !== 1) throw new Error("Configured public treasury owner does not match this non-demo organization");
    const api = (await db.execute<{ address: string; source: string }>(sql`select address,source from treasury_accounts where org_id=${existing.id} and kind='api_payer'`)).rows;
    if (api.length !== 1 || api[0]!.address !== payer || (testOnly && api[0]!.source !== "unconfigured")) throw new Error("Configured API payer does not match this non-demo organization");
    if (!enable) { console.log(JSON.stringify({ orgId: existing.id, slug, alreadyProvisioned: true, noConfigurationChanged: true, noFinancialTransactionExecuted: true })); return; }
    await db.execute(sql`update organizations set mode='live',live_enabled=true where id=${existing.id} and mode in ('live_readonly','live')`);
    console.log(JSON.stringify({ orgId: existing.id, slug, enabled: true, noFinancialTransactionExecuted: true })); return;
  }
  if ((await db.execute(sql`select id from users where wallet_address=${owner}`)).rows.length) throw new Error("Owner wallet already belongs to an identity. Provisioning never reassigns existing users");
  if (await connection().getGenesisHash() !== SOLANA_MAINNET_GENESIS_HASH) throw new Error("Expected mainnet RPC");
  const [treasury, api] = await Promise.all([readChainBalances(owner), testOnly ? Promise.resolve(null) : readChainBalances(payer)]);
  const orgId = crypto.randomUUID(), userId = crypto.randomUUID(), policy = { ...defaultPolicy(), minTreasurySolAtomic: "20000000", minTreasuryUsdcAtomic: "0", minX402UsdcAtomic: "100000", maxQuoteAgeMs: 120_000 };
  const mode = testOnly ? "uat_readonly" : enable ? "live" : "live_readonly";
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into organizations(id,name,slug,project_name,mode,live_enabled,created_at) values (${orgId},${process.env.ORG_NAME || (testOnly ? "Payday Owner Testing" : "Payday Treasury")},${slug},${testOnly ? "Unfunded workflow testing" : "Live payroll"},${mode},${enable},now())`);
    await tx.execute(sql`insert into users(id,display_name,wallet_address,created_at) values (${userId},'Treasury owner',${owner},now())`);
    await tx.execute(sql`insert into organization_members(id,org_id,user_id,role,created_at) values (${crypto.randomUUID()},${orgId},${userId},'owner',now())`);
    await tx.execute(sql`insert into policies(id,org_id,version,body,created_at) values (${crypto.randomUUID()},${orgId},1,${JSON.stringify(policy)},now())`);
    await tx.execute(sql`insert into projects(id,org_id,name,summary) values (${crypto.randomUUID()},${orgId},${testOnly ? "Workflow testing" : "Live payroll"},'Owner-approved USDC milestones')`);
    for (const [kind, address, value] of [["treasury", owner, treasury], ["api_payer", payer, api]] as const) await tx.execute(sql`insert into treasury_accounts(id,org_id,kind,address,sol_atomic,usdc_atomic,source,observed_at,observed_slot) values (${crypto.randomUUID()},${orgId},${kind},${address},${value?.solAtomic.toString() ?? "0"},${value?.usdcAtomic.toString() ?? "0"},${value ? "rpc" : "unconfigured"},now(),${value?.slot ?? null})`);
  });
  console.log(JSON.stringify({ orgId, slug, owner, payer: payer || null, mode, noFinancialTransactionExecuted: true }, null, 2));
}
main().catch(() => { console.error("Provisioning refused or failed. Check the explicit flags, public address configuration, private database connection and mainnet RPC. No secrets are logged."); process.exitCode = 1; });
