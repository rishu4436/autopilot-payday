import { desc, eq } from "drizzle-orm";
import { accountTreasury } from "@/domain/accounting";
import { parsePolicy, type PolicyDoc } from "@/domain/policy-doc";
import type { AppDb } from "@/db/client";
import {
  batches,
  batchItems,
  contributors,
  milestones,
  operations,
  organizations,
  policies,
  treasuryAccounts,
} from "@/db/schema";

const LOCKING = new Set(["APPROVED", "SUBMITTED", "CONFIRMING", "UNKNOWN", "PARTIAL"]);
const OPEN_PAYMENT = new Set(["UNPAID", "FUNDING_REQUIRED", "READY_FOR_PAYMENT"]);

export async function loadBooks(db: AppDb, orgId: string) {
  const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
  if (!org) throw new Error("Organization not found");
  const accounts = await db.select().from(treasuryAccounts).where(eq(treasuryAccounts.orgId, orgId));
  const treasury = accounts.find((row) => row.kind === "treasury");
  const payer = accounts.find((row) => row.kind === "api_payer");
  if (!treasury || !payer) throw new Error("Treasury accounts are not configured");
  const policyRows = await db.select().from(policies).where(eq(policies.orgId, orgId)).orderBy(desc(policies.version)).limit(1);
  const policyRow = policyRows[0];
  if (!policyRow) throw new Error("Policy is missing");
  const policy: PolicyDoc = parsePolicy(policyRow.body);
  const people = await db.select().from(contributors).where(eq(contributors.orgId, orgId));
  const tasks = await db.select().from(milestones).where(eq(milestones.orgId, orgId));
  const batchRows = await db.select().from(batches).where(eq(batches.orgId, orgId));
  const items = batchRows.length
    ? await db.select().from(batchItems)
    : [];
  const orgItems = items.filter((item) => batchRows.some((batch) => batch.id === item.batchId));
  const lockingIds = new Set(batchRows.filter((batch) => LOCKING.has(batch.status)).map((batch) => batch.id));
  const commitments = orgItems.filter((item) => lockingIds.has(item.batchId) && item.status !== "CONFIRMED" && item.status !== "FAILED");
  const commitmentIds = commitments.map((item) => item.milestoneId);
  const obligations = tasks.filter((task) => task.workStatus === "APPROVED" && OPEN_PAYMENT.has(task.paymentStatus) && !commitmentIds.includes(task.id));
  const ledger = accountTreasury({
    treasuryUsdcAtomic: BigInt(treasury.usdcAtomic),
    treasurySolAtomic: BigInt(treasury.solAtomic),
    minTreasuryUsdcAtomic: BigInt(policy.minTreasuryUsdcAtomic),
    minTreasurySolAtomic: BigInt(policy.minTreasurySolAtomic),
    pendingPayoutUsdcAtomic: commitments.reduce((sum, item) => sum + BigInt(item.amountAtomic), 0n),
    approvedUnpaidUsdcAtomic: obligations.reduce((sum, task) => sum + BigInt(task.amountAtomic), 0n),
    obligationIds: obligations.map((task) => task.id),
    commitmentIds,
    x402UsdcAtomic: BigInt(payer.usdcAtomic),
    minX402UsdcAtomic: BigInt(policy.minX402UsdcAtomic),
  });
  const ops = await db.select().from(operations).where(eq(operations.orgId, orgId));
  const openOperation = ops
    .filter((row) => row.state !== "COMPLETED" && row.state !== "CANCELLED")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  return { org, treasury, payer, policy, people, tasks, batchRows, items: orgItems, ledger, obligations, commitments, openOperation };
}

export type Books = Awaited<ReturnType<typeof loadBooks>>;
