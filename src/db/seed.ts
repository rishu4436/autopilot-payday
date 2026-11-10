import { eq } from "drizzle-orm";
import { defaultPolicy } from "@/domain/policy-doc";
import { DEMO_WALLETS, NORTHSTAR } from "@/domain/scenario";
import { USDC_MINT } from "@/domain/tokens";
import type { AppDb } from "./client";
import {
  audits,
  authorizations,
  batches,
  batchItems,
  contributors,
  decisions,
  members,
  milestoneEvents,
  milestones,
  notifications,
  operations,
  organizations,
  payoutTxs,
  policies,
  projects,
  quotes,
  runs,
  swapExecutions,
  treasuryAccounts,
  users,
  x402Calls,
} from "./schema";

const ORG = "org_northstar";
const when = (iso: string) => new Date(iso);

export async function seedIfEmpty(db: AppDb): Promise<void> {
  if ((process.env.APP_MODE || "demo") !== "demo") return;
  if (process.env.DATABASE_URL && process.env.ALLOW_DEMO_SEED !== "true") return;
  const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, "northstar")).limit(1);
  if (existing.length > 0) return;

  const now = when("2026-11-10T12:00:00Z");
  const policy = defaultPolicy();
  const people = [
    { id: "user_owner", name: "Northstar Owner", wallet: DEMO_WALLETS.owner, role: "owner" },
    { id: "user_approver", name: "Treasury Approver", wallet: DEMO_WALLETS.approver, role: "approver" },
    { id: "user_maya", name: "Maya", wallet: DEMO_WALLETS.maya, role: "contributor" },
    { id: "user_auditor", name: "Read-only Auditor", wallet: DEMO_WALLETS.auditor, role: "auditor" },
  ] as const;

  await db.insert(organizations).values({
    id: ORG,
    name: NORTHSTAR.orgName,
    slug: "northstar",
    projectName: NORTHSTAR.project,
    mode: process.env.APP_MODE === "live" ? "live_readonly" : "demo",
    liveEnabled: false,
    createdAt: now,
  });

  await db.insert(users).values(people.map((person) => ({
    id: person.id,
    displayName: person.name,
    walletAddress: person.wallet,
    createdAt: now,
  })));
  await db.insert(members).values(people.map((person) => ({
    id: `mem_${person.role}`,
    orgId: ORG,
    userId: person.id,
    role: person.role,
    createdAt: now,
  })));

  await db.insert(treasuryAccounts).values([
    {
      id: "acct_treasury",
      orgId: ORG,
      kind: "treasury",
      address: DEMO_WALLETS.treasury,
      solAtomic: NORTHSTAR.treasurySol.toString(),
      usdcAtomic: NORTHSTAR.treasuryUsdc.toString(),
      source: "demo",
      observedAt: now,
    },
    {
      id: "acct_payer",
      orgId: ORG,
      kind: "api_payer",
      address: DEMO_WALLETS.payer,
      solAtomic: "0",
      usdcAtomic: NORTHSTAR.x402Usdc.toString(),
      source: "demo",
      observedAt: now,
    },
  ]);

  await db.insert(policies).values({
    id: "pol_1",
    orgId: ORG,
    version: 1,
    body: JSON.stringify(policy),
    createdAt: now,
  });

  await db.insert(contributors).values([
    { id: "con_maya", orgId: ORG, userId: "user_maya", displayName: "Maya", roleTitle: "Design", address: DEMO_WALLETS.maya, mint: USDC_MINT, active: true, allowlisted: true, notes: "Brand and product design.", createdAt: now },
    { id: "con_leo", orgId: ORG, userId: null, displayName: "Leo", roleTitle: "Engineering", address: DEMO_WALLETS.leo, mint: USDC_MINT, active: true, allowlisted: true, notes: "Product engineering.", createdAt: now },
    { id: "con_aria", orgId: ORG, userId: null, displayName: "Aria", roleTitle: "Motion Graphics", address: DEMO_WALLETS.aria, mint: USDC_MINT, active: true, allowlisted: true, notes: "Launch motion.", createdAt: now },
  ]);

  await db.insert(projects).values({
    id: "proj_launch",
    orgId: ORG,
    name: NORTHSTAR.project,
    summary: "Ship the Northstar launch. Payroll is USDC. Treasury still holds SOL.",
  });

  const [brand, engineering, film] = NORTHSTAR.obligations;
  if (!brand || !engineering || !film) throw new Error("Northstar scenario is incomplete");
  const open = [
    { id: "ms_brand", contributorId: "con_maya", title: brand.title, description: "Identity, type, and interface foundations.", amount: brand.amount, due: "2026-11-14" },
    { id: "ms_eng", contributorId: "con_leo", title: engineering.title, description: "Launch-critical product work.", amount: engineering.amount, due: "2026-11-14" },
    { id: "ms_film", contributorId: "con_aria", title: film.title, description: "Motion for the public launch.", amount: film.amount, due: "2026-11-16" },
  ];

  await db.insert(milestones).values([
    ...open.map((row) => ({
      id: row.id,
      orgId: ORG,
      projectId: "proj_launch",
      contributorId: row.contributorId,
      title: row.title,
      description: row.description,
      amountAtomic: row.amount.toString(),
      mint: USDC_MINT,
      decimals: 6,
      dueOn: row.due,
      workStatus: "APPROVED",
      paymentStatus: "UNPAID",
      evidence: "Accepted in the demo review log.",
      rejectionReason: "",
      lockedAmount: row.amount.toString(),
      lockedRecipient: row.contributorId === "con_maya" ? DEMO_WALLETS.maya : row.contributorId === "con_leo" ? DEMO_WALLETS.leo : DEMO_WALLETS.aria,
      version: 1,
      createdAt: when("2026-11-08T15:00:00Z"),
      updatedAt: when("2026-11-09T18:00:00Z"),
    })),
    {
      id: "ms_draft",
      orgId: ORG,
      projectId: "proj_launch",
      contributorId: "con_leo",
      title: "Post-launch fixes",
      description: "Not submitted. The agent cannot pay this.",
      amountAtomic: "20000000",
      mint: USDC_MINT,
      decimals: 6,
      dueOn: "2026-11-28",
      workStatus: "DRAFT",
      paymentStatus: "NOT_PAYABLE",
      evidence: "",
      rejectionReason: "",
      lockedAmount: null,
      lockedRecipient: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ms_workshop",
      orgId: ORG,
      projectId: "proj_launch",
      contributorId: "con_maya",
      title: "Discovery workshop",
      description: "Earlier demo payday. Already settled in the demo ledger.",
      amountAtomic: NORTHSTAR.historicalPaid.toString(),
      mint: USDC_MINT,
      decimals: 6,
      dueOn: "2026-10-02",
      workStatus: "APPROVED",
      paymentStatus: "PAID",
      evidence: "SIMULATED completion note.",
      rejectionReason: "",
      lockedAmount: NORTHSTAR.historicalPaid.toString(),
      lockedRecipient: DEMO_WALLETS.maya,
      version: 1,
      createdAt: when("2026-09-20T12:00:00Z"),
      updatedAt: when("2026-10-02T16:00:00Z"),
    },
  ]);

  await db.insert(milestoneEvents).values(open.map((row) => ({
    id: `ev_${row.id}`,
    orgId: ORG,
    milestoneId: row.id,
    kind: "approved",
    actorId: "user_owner",
    payload: JSON.stringify({ evidenceClass: "simulated", note: "Owner approved the demo milestone." }),
    createdAt: when("2026-11-09T18:00:00Z"),
  })));

  await db.insert(operations).values({
    id: "op_workshop",
    orgId: ORG,
    state: "COMPLETED",
    blockedFrom: null,
    idempotencyKey: "workshop-2026-10",
    policyVersion: 1,
    shortfallAtomic: NORTHSTAR.historicalPaid.toString(),
    solInAtomic: "500000000",
    reason: "SIMULATED historical payday.",
    createdAt: when("2026-10-02T15:00:00Z"),
    updatedAt: when("2026-10-02T16:00:00Z"),
  });
  await db.insert(runs).values({
    id: "run_workshop",
    orgId: ORG,
    operationId: "op_workshop",
    trigger: "seed",
    outcome: "completed",
    startedAt: when("2026-10-02T15:00:00Z"),
    finishedAt: when("2026-10-02T16:00:00Z"),
  });
  await db.insert(decisions).values({
    id: "dec_workshop",
    orgId: ORG,
    runId: "run_workshop",
    operationId: "op_workshop",
    kind: "proceed",
    code: "SWAP_OK",
    reason: "SIMULATED historical route covered the workshop.",
    nextAction: "None. This record is closed.",
    observed: JSON.stringify({ evidenceClass: "simulated", shortfallAtomic: NORTHSTAR.historicalPaid.toString() }),
    createdAt: when("2026-10-02T15:10:00Z"),
  });
  await db.insert(x402Calls).values({
    id: "call_workshop",
    orgId: ORG,
    operationId: "op_workshop",
    endpoint: "/v1/swap/quote",
    evidenceClass: "simulated",
    httpStatus: 200,
    amountAtomic: "3007",
    payTo: "BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD",
    asset: USDC_MINT,
    network: "solana",
    requestJson: JSON.stringify({ evidenceClass: "simulated", note: "Not a live Swap.io call." }),
    responseJson: JSON.stringify({ evidenceClass: "simulated", quotes: 1 }),
    receiptSignature: "SIMULATED:x402:workshop",
    createdAt: when("2026-10-02T15:12:00Z"),
  });
  await db.insert(quotes).values({
    id: "quote_workshop",
    orgId: ORG,
    operationId: "op_workshop",
    callId: "call_workshop",
    providerKey: "simulated-route",
    inputAtomic: "500000000",
    outputAtomic: NORTHSTAR.historicalPaid.toString(),
    minOutAtomic: NORTHSTAR.historicalPaid.toString(),
    slippageBps: 50,
    priceImpact: null,
    providerQuote: JSON.stringify({ simulated: true }),
    evidenceClass: "simulated",
    expiresAt: when("2026-10-02T15:13:00Z"),
    selected: true,
    createdAt: when("2026-10-02T15:12:00Z"),
  });
  await db.insert(swapExecutions).values({
    id: "swap_workshop",
    orgId: ORG,
    operationId: "op_workshop",
    quoteId: "quote_workshop",
    unsignedTx: null,
    signature: "SIMULATED:swap:workshop",
    status: "confirmed",
    evidenceClass: "simulated",
    detail: "Demo ledger settlement. Not a Solana transaction.",
    createdAt: when("2026-10-02T15:20:00Z"),
    updatedAt: when("2026-10-02T15:21:00Z"),
  });
  await db.insert(batches).values({
    id: "batch_workshop",
    orgId: ORG,
    status: "CONFIRMED",
    totalAtomic: NORTHSTAR.historicalPaid.toString(),
    operationId: "op_workshop",
    proposalHash: "simulated-workshop",
    evidenceClass: "simulated",
    createdAt: when("2026-10-02T15:30:00Z"),
  });
  await db.insert(batchItems).values({
    id: "item_workshop",
    batchId: "batch_workshop",
    milestoneId: "ms_workshop",
    amountAtomic: NORTHSTAR.historicalPaid.toString(),
    recipient: DEMO_WALLETS.maya,
    status: "CONFIRMED",
  });
  await db.insert(payoutTxs).values({
    id: "payout_workshop",
    orgId: ORG,
    batchId: "batch_workshop",
    chunkIndex: 0,
    signature: "SIMULATED:payout:workshop",
    status: "CONFIRMED",
    evidenceClass: "simulated",
    detail: "Demo payout. Not a Solana transaction.",
    createdAt: when("2026-10-02T15:40:00Z"),
  });
  await db.insert(authorizations).values({
    id: "auth_workshop",
    orgId: ORG,
    subjectType: "payout",
    subjectId: "batch_workshop",
    actorId: "user_owner",
    proposalHash: "simulated-workshop",
    decision: "approved",
    createdAt: when("2026-10-02T15:31:00Z"),
  });
  await db.insert(audits).values({
    id: "audit_seed",
    orgId: ORG,
    actorId: "user_owner",
    action: "seed",
    entity: "organization",
    entityId: ORG,
    data: JSON.stringify({ evidenceClass: "simulated", note: "Northstar demo ledger created." }),
    createdAt: now,
  });
  await db.insert(notifications).values([
    {
      id: "note_ready",
      orgId: ORG,
      kind: "payroll_ready",
      title: "Approved work is waiting",
      body: "Three milestones are approved. Treasury USDC does not cover them.",
      groupKey: "payroll",
      readAt: null,
      createdAt: when("2026-11-09T18:05:00Z"),
    },
    {
      id: "note_hist",
      orgId: ORG,
      kind: "payout_completed",
      title: "SIMULATED workshop payout",
      body: "Maya's discovery workshop is paid in the demo ledger only.",
      groupKey: "payout",
      readAt: when("2026-10-02T16:00:00Z"),
      createdAt: when("2026-10-02T15:40:00Z"),
    },
  ]);
}

export async function resetDemo(): Promise<void> {
  throw new Error("Refusing to reset. Delete the data directory explicitly if you want a fresh demo ledger.");
}
