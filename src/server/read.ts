import { eq } from "drizzle-orm";
import { flowVisual, needsHuman, type FundingState } from "@/domain/machine";
import { FUNDING_STATES } from "@/domain/machine";
import { assessRefill, bootstrapBlock } from "@/domain/policy";
import { getDb } from "@/db/client";
import { audits, decisions, notifications, payoutTxs, proofShares, quotes, runs, swapExecutions, x402Calls } from "@/db/schema";
import { loadBooks } from "./books";
import { getSession } from "./session";
import { sol, usdc } from "./text";

function stateOf(value: string | undefined): FundingState {
  if (value && (FUNDING_STATES as readonly string[]).includes(value)) return value as FundingState;
  return "CREATED";
}

export async function getWorkspace() {
  const session = await getSession();
  if (!session) return null;
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (session.role === "contributor") {
    books.people = books.people.filter((person) => person.userId === session.userId);
    books.tasks = books.tasks.filter((task) => books.people.some((person) => person.id === task.contributorId));
    books.items = books.items.filter((item) => books.tasks.some((task) => task.id === item.milestoneId));
    books.batchRows = books.batchRows.filter((batch) => books.items.some((item) => item.batchId === batch.id));
  }
  const [decisionRows, callRows, quoteRows, swapRows, payoutRows, noteRows, auditRows, shareRows, runRows] = await Promise.all([
    db.select().from(decisions).where(eq(decisions.orgId, session.orgId)),
    db.select().from(x402Calls).where(eq(x402Calls.orgId, session.orgId)),
    db.select().from(quotes).where(eq(quotes.orgId, session.orgId)),
    db.select().from(swapExecutions).where(eq(swapExecutions.orgId, session.orgId)),
    db.select().from(payoutTxs).where(eq(payoutTxs.orgId, session.orgId)),
    db.select().from(notifications).where(eq(notifications.orgId, session.orgId)),
    db.select().from(audits).where(eq(audits.orgId, session.orgId)),
    db.select().from(proofShares).where(eq(proofShares.orgId, session.orgId)),
    db.select().from(runs).where(eq(runs.orgId, session.orgId)),
  ]);
  if (session.role === "contributor") {
    decisionRows.length = callRows.length = quoteRows.length = swapRows.length = payoutRows.length = noteRows.length = auditRows.length = shareRows.length = runRows.length = 0;
  }
  const operation = books.openOperation;
  const flow = flowVisual(stateOf(operation?.state), callRows.some((call) => call.operationId === operation?.id && Boolean(call.receiptSignature)));
  const nextDue = books.obligations.map((row) => row.dueOn).sort()[0] ?? "No open payday";
  const freeUsdc = books.ledger.availableUsdcAtomic > books.obligations.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n)
    ? books.ledger.availableUsdcAtomic - books.obligations.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n)
    : 0n;
  const refill = assessRefill({
    paused: books.policy.paused,
    balanceAtomic: 0n,
    thresholdAtomic: BigInt(books.policy.refillThresholdAtomic),
    minRefillAtomic: BigInt(books.policy.minRefillAtomic),
    maxRefillAtomic: BigInt(books.policy.maxRefillAtomic),
    lastRefillAt: null,
    now: Date.now(),
    cooldownMs: books.policy.refillCooldownMs,
    treasuryUsdcAvailableAtomic: freeUsdc,
    treasurySolSafeAtomic: books.ledger.safeSolAtomic,
    requestedAtomic: BigInt(books.policy.minRefillAtomic),
  });
  const bootstrap = bootstrapBlock(0n, 3007n);
  const personName = (id: string) => books.people.find((person) => person.id === id)?.displayName ?? "Unknown";
  return {
    session,
    books,
    flow,
    nextDue,
    refill,
    bootstrap,
    pending: (operation && needsHuman(stateOf(operation.state)) ? 1 : 0) + books.batchRows.filter((batch) => batch.status === "DRAFT").length,
    unread: noteRows.filter((note) => !note.readAt).length,
    decisions: decisionRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    calls: callRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    quotes: quoteRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    swaps: swapRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    payouts: payoutRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    notes: noteRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    audits: auditRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    shares: shareRows,
    runs: runRows,
    personName,
    usdc,
    sol,
  };
}

export type Workspace = NonNullable<Awaited<ReturnType<typeof getWorkspace>>>;
