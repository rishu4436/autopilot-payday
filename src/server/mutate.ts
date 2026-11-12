import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { getDb, inTransaction } from "@/db/client";
import {
  audits,
  authChallenges,
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
  payoutTxs,
  policies,
  quotes,
  runs,
  sessions,
  swapExecutions,
  treasuryAccounts,
  users,
  x402Calls,
  organizations,
  locks,
  proofShares,
} from "@/db/schema";
import { proposalHash, type ProposalBody } from "@/domain/approval";
import { assertCan, buildSignInMessage, can, consumeNonce, isRole, withinApproverLimit } from "@/domain/authz";
import { decideFunding } from "@/domain/decisions";
import { assertHumanApprover, assertWorkTransition, canAmend, canEditMilestone, paymentAfterApproval, paymentAfterRejection, type PaymentStatus, type WorkStatus } from "@/domain/milestones";
import { FUNDING_STATES, transition, type FundingEvent, type FundingState } from "@/domain/machine";
import { parseAtomic } from "@/domain/money";
import { assessApiPayment, assessRefill } from "@/domain/policy";
import { parsePolicy } from "@/domain/policy-doc";
import { validateBatch } from "@/domain/payroll";
import { USDC_MINT, USDC_DECIMALS, SOL_DECIMALS } from "@/domain/tokens";
import { isValidSolanaAddress } from "@/solana/address";
import { loadBooks } from "./books";
import { readChainBalances } from "./chain";
import { unpaidHermes } from "./hermes";
import { clearSessionCookie, setSessionCookie, type Session } from "./session";
import { fail, ok, sol, usdc, type ActionState } from "./text";
import { selectSolanaUsdc, normalizeNeed, parsePaymentRequired, buildQuoteBody } from "@/hermes/protocol";
import { WSOL_MINT } from "@/domain/tokens";

function asFunding(value: string): FundingState {
  if (!(FUNDING_STATES as readonly string[]).includes(value)) throw new Error(`Unknown funding state ${value}`);
  return value as FundingState;
}

const mutationContext = new AsyncLocalStorage<boolean>();

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (mutationContext.getStore()) return fn();
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.insert(locks).values({ name, owner: "transaction", expiresAt: new Date() }).onConflictDoNothing();
    await tx.execute(sql`select name from locks where name = ${name} for update`);
    return inTransaction(tx as unknown as typeof db, () => mutationContext.run(true, fn));
  });
}

function serialize<A extends unknown[]>(work: (session: Session, ...args: A) => Promise<ActionState>) {
  return (session: Session, ...args: A): Promise<ActionState> =>
    withLock(`org:${session.orgId}`, () => work(session, ...args));
}

async function audit(session: Session, action: string, entity: string, entityId: string, data: unknown) {
  const db = await getDb();
  await db.insert(audits).values({
    id: crypto.randomUUID(),
    orgId: session.orgId,
    actorId: session.userId,
    action,
    entity,
    entityId,
    data: JSON.stringify(data),
    createdAt: new Date(),
  });
}

async function notify(orgId: string, kind: string, title: string, body: string, groupKey: string) {
  const db = await getDb();
  await db.insert(notifications).values({
    id: crypto.randomUUID(),
    orgId,
    kind,
    title,
    body,
    groupKey,
    readAt: null,
    createdAt: new Date(),
  });
}

function liveArmed(mode: string, liveEnabled: boolean): boolean {
  return mode === "live" && liveEnabled && process.env.LIVE_OPERATIONS === "true";
}

export async function loginDemo(role: string): Promise<ActionState> {
  if ((process.env.APP_MODE || "demo") !== "demo") return fail("Demo sign-in is disabled outside the demo deployment.");
  if (!isRole(role)) return fail("Unknown role");
  const db = await getDb();
  const userId = role === "owner" ? "user_owner" : role === "approver" ? "user_approver" : role === "contributor" ? "user_maya" : "user_auditor";
  const id = crypto.randomUUID();
  await db.insert(sessions).values({
    id,
    userId,
    orgId: "org_northstar",
    role,
    authMode: "demo",
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    createdAt: new Date(),
  });
  await setSessionCookie(id);
  return ok("Demo session started");
}

export async function logout(): Promise<void> {
  const db = await getDb();
  const { getSession } = await import("./session");
  const session = await getSession();
  if (session) await db.delete(sessions).where(eq(sessions.id, session.id));
  await clearSessionCookie();
}

async function startChallengeImpl(address: string, domain: string): Promise<{ ok: true; message: string; nonce: string } | ActionState> {
  if (!isValidSolanaAddress(address)) return fail("That is not a Solana address.", "INVALID_WALLET");
  if (!/^(localhost|127\.0\.0\.1|[a-z0-9.-]+)(:\d+)?$/i.test(domain)) return fail("Invalid sign-in domain");
  const nonce = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const expiration = new Date(Date.now() + 10 * 60_000).toISOString();
  const message = buildSignInMessage({ domain, address, nonce, issuedAt, expiration });
  const db = await getDb();
  const recent = await db.select({ id: authChallenges.id }).from(authChallenges).where(and(eq(authChallenges.domain, domain), gt(authChallenges.createdAt, new Date(Date.now() - 60_000))));
  if (recent.length >= 30) return fail("Too many sign-in challenges. Try again in a minute.", "RATE_LIMITED");
  await db.insert(authChallenges).values({
    id: crypto.randomUUID(),
    nonce,
    domain,
    address,
    message,
    expiresAt: new Date(expiration),
    usedAt: null,
    createdAt: new Date(),
  });
  return { ok: true, message, nonce };
}

export function startChallenge(address: string, domain: string) {
  return withLock(`auth:${domain}`, () => startChallengeImpl(address, domain));
}

export async function finishChallenge(address: string, signature: string, nonce: string, domain: string): Promise<ActionState> {
  const db = await getDb();
  const row = (await db.select().from(authChallenges).where(eq(authChallenges.nonce, nonce)).limit(1))[0];
  if (!row || row.address !== address || row.domain !== domain) return fail("Sign-in challenge was not found.");
  try {
    consumeNonce({ usedAt: row.usedAt ? row.usedAt.getTime() : null, expiresAt: row.expiresAt.getTime() }, Date.now());
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Challenge rejected");
  }
  let valid = false;
  try {
    valid = nacl.sign.detached.verify(new TextEncoder().encode(row.message), bs58.decode(signature), bs58.decode(address));
  } catch {
    valid = false;
  }
  if (!valid) return fail("Wallet signature did not match the challenge.", "SIGNATURE_REJECTED");
  const consumed = await db.update(authChallenges).set({ usedAt: new Date() }).where(and(eq(authChallenges.id, row.id), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, new Date()))).returning({ id: authChallenges.id });
  if (consumed.length !== 1) return fail("Challenge expired or was already consumed", "REPLAY");
  const user = (await db.select().from(users).where(eq(users.walletAddress, address)).limit(1))[0];
  if (!user) return fail("This wallet is not a member. An owner can register it in Settings.");
  const membershipRows = await db.select({ orgId: members.orgId, role: members.role, mode: organizations.mode }).from(members).innerJoin(organizations, eq(members.orgId, organizations.id)).where(eq(members.userId, user.id));
  const eligible = membershipRows.filter((member) => isRole(member.role) && ((process.env.APP_MODE || "demo") === "demo" ? member.mode === "demo" : member.mode !== "demo"));
  if (eligible.length !== 1) return fail(eligible.length > 1 ? "This wallet has multiple organizations. Explicit organization selection is required before sign-in." : "This wallet has no role on an organization in this deployment mode.");
  const member = eligible[0]!;
  if (!isRole(member.role)) return fail("Invalid organization role");
  const id = crypto.randomUUID();
  await db.insert(sessions).values({
    id,
    userId: user.id,
    orgId: member.orgId,
    role: member.role,
    authMode: "wallet",
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    createdAt: new Date(),
  });
  await setSessionCookie(id);
  return ok("Wallet session started");
}

async function saveContributorImpl(session: Session, input: { id?: string; displayName: string; roleTitle: string; address: string; notes: string; active: boolean }): Promise<ActionState> {
  assertCan(session.role, "read");
  if (session.role !== "owner" && session.role !== "approver") return fail("Only an owner or approver can edit contributors.");
  if (!isValidSolanaAddress(input.address)) return fail("Enter a valid Solana address.", "INVALID_WALLET");
  const db = await getDb();
  if (input.id) {
    const current = (await db.select().from(contributors).where(and(eq(contributors.id, input.id), eq(contributors.orgId, session.orgId))).limit(1))[0];
    if (!current) return fail("Contributor not found");
    if (!input.active && current.allowlisted && session.role !== "owner") return fail("Only the owner can remove an allowlisted recipient.");
    await db.update(contributors).set({
      displayName: input.displayName,
      roleTitle: input.roleTitle,
      address: input.address,
      notes: input.notes,
      active: input.active,
      allowlisted: input.active && input.address === current.address ? current.allowlisted : false,
    }).where(eq(contributors.id, current.id));
    await audit(session, "contributor.update", "contributor", current.id, { address: input.address });
    return ok("Contributor updated");
  }
  const id = crypto.randomUUID();
  await db.insert(contributors).values({
    id,
    orgId: session.orgId,
    userId: null,
    displayName: input.displayName,
    roleTitle: input.roleTitle,
    address: input.address,
    mint: USDC_MINT,
    active: input.active,
    allowlisted: false,
    notes: input.notes,
    createdAt: new Date(),
  });
  await audit(session, "contributor.create", "contributor", id, {});
  return ok("Contributor added. Allowlisting still needs the owner.");
}

async function setAllowlistImpl(session: Session, id: string, allowlisted: boolean): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can change the recipient allowlist.");
  const db = await getDb();
  const row = (await db.select().from(contributors).where(and(eq(contributors.id, id), eq(contributors.orgId, session.orgId))).limit(1))[0];
  if (!row) return fail("Contributor not found");
  await db.update(contributors).set({ allowlisted }).where(eq(contributors.id, id));
  await audit(session, allowlisted ? "allowlist.add" : "allowlist.remove", "contributor", id, {});
  return ok(allowlisted ? "Recipient allowlisted" : "Recipient removed from the allowlist");
}

async function saveMilestoneImpl(session: Session, input: { id?: string; title: string; description: string; contributorId: string; amount: string; dueOn: string; evidence: string }): Promise<ActionState> {
  if (session.role === "auditor") return fail("Auditors cannot edit milestones.");
  let amount: bigint;
  try {
    amount = parseAtomic(input.amount, USDC_DECIMALS);
  } catch {
    return fail("Enter a USDC amount like 40 or 40.50");
  }
  if (amount <= 0n) return fail("Amount must be positive");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return fail("Use a YYYY-MM-DD due date");
  const db = await getDb();
  const person = (await db.select().from(contributors).where(and(eq(contributors.id, input.contributorId), eq(contributors.orgId, session.orgId))).limit(1))[0];
  if (!person) return fail("Choose a contributor");
  if (session.role === "contributor" && person.userId !== session.userId) return fail("Contributors can only edit their own drafts.");
  if (input.id) {
    const row = (await db.select().from(milestones).where(and(eq(milestones.id, input.id), eq(milestones.orgId, session.orgId))).limit(1))[0];
    if (!row) return fail("Milestone not found");
    if (session.role === "contributor") {
      const existingPerson = (await db.select().from(contributors).where(eq(contributors.id, row.contributorId)).limit(1))[0];
      if (existingPerson?.userId !== session.userId) return fail("You cannot take over another contributor's milestone.");
    }
    if (!canEditMilestone(row.workStatus as WorkStatus, row.paymentStatus as PaymentStatus)) return fail("This milestone is locked.");
    await db.update(milestones).set({
      title: input.title,
      description: input.description,
      contributorId: person.id,
      amountAtomic: amount.toString(),
      dueOn: input.dueOn,
      evidence: input.evidence,
      updatedAt: new Date(),
    }).where(eq(milestones.id, row.id));
    return ok("Milestone updated");
  }
  const id = crypto.randomUUID();
  await db.insert(milestones).values({
    id,
    orgId: session.orgId,
    projectId: "proj_launch",
    contributorId: person.id,
    title: input.title,
    description: input.description,
    amountAtomic: amount.toString(),
    mint: USDC_MINT,
    decimals: 6,
    dueOn: input.dueOn,
    workStatus: "DRAFT",
    paymentStatus: "NOT_PAYABLE",
    evidence: input.evidence,
    rejectionReason: "",
    lockedAmount: null,
    lockedRecipient: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return ok("Draft milestone created");
}

async function reviewMilestoneImpl(session: Session, id: string, action: "submit" | "review" | "approve" | "reject" | "amend", reason = ""): Promise<ActionState> {
  const db = await getDb();
  const row = (await db.select().from(milestones).where(and(eq(milestones.id, id), eq(milestones.orgId, session.orgId))).limit(1))[0];
  if (!row) return fail("Milestone not found");
  const work = row.workStatus as WorkStatus;
  const payment = row.paymentStatus as PaymentStatus;
  if (action === "submit") {
    if (session.role === "contributor") {
      const person = (await db.select().from(contributors).where(eq(contributors.id, row.contributorId)).limit(1))[0];
      if (person?.userId !== session.userId) return fail("You can only submit your own milestone.");
    } else if (!can(session.role, "milestone.approve") && session.role !== "owner") {
      return fail("You cannot submit this milestone.");
    }
    assertWorkTransition(work, "SUBMITTED");
    await db.update(milestones).set({ workStatus: "SUBMITTED", updatedAt: new Date() }).where(eq(milestones.id, id));
    await notify(session.orgId, "milestone_submitted", "Milestone submitted", row.title, "milestone");
    return ok("Submitted for review");
  }
  if (action === "review") {
    assertCan(session.role, "milestone.approve");
    assertWorkTransition(work, "UNDER_REVIEW");
    await db.update(milestones).set({ workStatus: "UNDER_REVIEW", updatedAt: new Date() }).where(eq(milestones.id, id));
    return ok("Moved to review");
  }
  if (action === "approve") {
    assertHumanApprover(session.role);
    assertCan(session.role, "milestone.approve");
    const books = await loadBooks(db, session.orgId);
    if (!withinApproverLimit(session.role, BigInt(row.amountAtomic), BigInt(books.policy.approverMaxAtomic))) {
      return fail("This amount is above the approver limit. An owner must approve it.");
    }
    const person = (await db.select().from(contributors).where(eq(contributors.id, row.contributorId)).limit(1))[0];
    if (!person) return fail("Contributor missing");
    assertWorkTransition(work, "APPROVED");
    await db.update(milestones).set({
      workStatus: "APPROVED",
      paymentStatus: paymentAfterApproval(),
      lockedAmount: row.amountAtomic,
      lockedRecipient: person.address,
      updatedAt: new Date(),
    }).where(eq(milestones.id, id));
    await db.insert(milestoneEvents).values({
      id: crypto.randomUUID(),
      orgId: session.orgId,
      milestoneId: id,
      kind: "approved",
      actorId: session.userId,
      payload: JSON.stringify({ amountAtomic: row.amountAtomic, recipient: person.address }),
      createdAt: new Date(),
    });
    await notify(session.orgId, "milestone_approved", "Milestone approved", row.title, "milestone");
    await audit(session, "milestone.approve", "milestone", id, { amountAtomic: row.amountAtomic });
    return ok("Approved and locked");
  }
  if (action === "reject") {
    assertCan(session.role, "milestone.reject");
    if (!reason.trim()) return fail("A rejection needs a reason.");
    assertWorkTransition(work, "REJECTED");
    await db.update(milestones).set({
      workStatus: "REJECTED",
      paymentStatus: paymentAfterRejection(),
      rejectionReason: reason.trim(),
      lockedAmount: null,
      lockedRecipient: null,
      updatedAt: new Date(),
    }).where(eq(milestones.id, id));
    return ok("Milestone rejected");
  }
  if (action !== "amend") return fail("Unknown milestone action");
  const existingItem = (await db.select().from(batchItems).where(eq(batchItems.milestoneId, id)).limit(1))[0];
  if (existingItem) return fail("Reject the draft batch before amending this milestone.");
  if (!canAmend(work, payment)) return fail("This payment can no longer be amended.");
  if (session.role !== "owner") return fail("Only the owner can amend an approved milestone.");
  await db.update(milestones).set({
    workStatus: "IN_PROGRESS",
    paymentStatus: "NOT_PAYABLE",
    lockedAmount: null,
    lockedRecipient: null,
    version: row.version + 1,
    updatedAt: new Date(),
  }).where(eq(milestones.id, id));
  await audit(session, "milestone.amend", "milestone", id, { version: row.version + 1 });
  return ok("Approval cleared. The new version must be approved again.");
}

async function analyzeImpl(session: Session, solText: string): Promise<ActionState> {
  assertCan(session.role, "funding.approve");
  return withLock(`funding:${session.orgId}`, async () => {
    const db = await getDb();
    const books = await loadBooks(db, session.orgId);
    if (!books.policy.enabled) return fail("The agent is disabled.");
    let solIn: bigint | null = null;
    if (solText.trim()) {
      try {
        solIn = parseAtomic(solText.trim(), SOL_DECIMALS);
      } catch {
        return fail("Enter SOL in decimal form, for example 1 or 0.5");
      }
    }
    const allowlisted = books.obligations.every((task) => {
      const person = books.people.find((row) => row.id === task.contributorId);
      return Boolean(person?.active && person.allowlisted && task.lockedRecipient === person.address);
    });
    const decision = decideFunding({
      paused: books.policy.paused,
      recipientsAllowlisted: books.obligations.length === 0 || allowlisted,
      shortfallAtomic: books.ledger.shortfallAtomic,
      treasurySolAtomic: BigInt(books.treasury.solAtomic),
      minTreasurySolAtomic: BigInt(books.policy.minTreasurySolAtomic),
      proposedSolInAtomic: solIn,
      x402SpendableAtomic: books.ledger.x402SpendableAtomic,
      quotePriceAtomic: null,
      now: Date.now(),
      slippageCeilingBps: books.policy.slippageCeilingBps,
      maxQuoteAgeMs: books.policy.maxQuoteAgeMs,
      marginBps: BigInt(books.policy.marginBps),
      quote: null,
      x402Authorized: false,
      swapAuthorized: false,
    });
    const runId = crypto.randomUUID();
    let operation = books.openOperation;
    if (!operation) {
      const id = crypto.randomUUID();
      await db.insert(operations).values({
        id,
        orgId: session.orgId,
        state: "CREATED",
        blockedFrom: null,
        idempotencyKey: id,
        policyVersion: books.policy.version,
        shortfallAtomic: books.ledger.shortfallAtomic.toString(),
        solInAtomic: solIn?.toString() ?? null,
        reason: decision.reason,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      operation = (await db.select().from(operations).where(eq(operations.id, id)))[0] ?? null;
    }
    if (!operation) return fail("Could not open a funding operation");
    let state = asFunding(operation.state);
    const step = async (event: FundingEvent) => {
      state = transition(state, event, operation?.blockedFrom ? asFunding(operation.blockedFrom) : undefined);
      await db.update(operations).set({
        state,
        shortfallAtomic: books.ledger.shortfallAtomic.toString(),
        solInAtomic: solIn?.toString() ?? operation?.solInAtomic ?? null,
        policyVersion: books.policy.version,
        reason: decision.reason,
        updatedAt: new Date(),
      }).where(eq(operations.id, operation!.id));
    };
    if (state === "CREATED") await step("ANALYZE");
    if (books.policy.paused && state === "ANALYZING") {
      await step("BLOCK");
      await db.update(operations).set({ blockedFrom: "ANALYZING" }).where(eq(operations.id, operation.id));
    } else if (state === "ANALYZING" || state === "FUNDING_REQUIRED" || state === "QUOTE_REJECTED" || state === "NO_ACTION_REQUIRED" || state === "SWAP_FAILED") {
      if (books.ledger.shortfallAtomic === 0n) {
        if (state === "ANALYZING") await step("NO_ACTION");
        if (books.obligations.length > 0 && state === "NO_ACTION_REQUIRED") await step("READY_PAYROLL");
        if (books.obligations.length === 0 && state === "NO_ACTION_REQUIRED") await step("COMPLETE");
      } else if (state === "ANALYZING" || state === "QUOTE_REJECTED" || state === "SWAP_FAILED") {
        await step("NEED_FUNDS");
        if (solIn !== null && decision.code !== "SOL_RESERVE" && decision.code !== "NOT_ALLOWLISTED") {
          await step("REQUEST_QUOTE");
          await step("AUTHORIZE_X402");
        }
      } else if (state === "FUNDING_REQUIRED" && solIn !== null && decision.kind !== "reject") {
        await step("REQUEST_QUOTE");
        await step("AUTHORIZE_X402");
      }
    }
    const nextPay = books.ledger.shortfallAtomic > 0n ? "FUNDING_REQUIRED" : "READY_FOR_PAYMENT";
    for (const task of books.obligations) {
      await db.update(milestones).set({ paymentStatus: nextPay, updatedAt: new Date() }).where(eq(milestones.id, task.id));
    }
    await db.insert(runs).values({
      id: runId,
      orgId: session.orgId,
      operationId: operation.id,
      trigger: "manual",
      outcome: decision.code,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    await db.insert(decisions).values({
      id: crypto.randomUUID(),
      orgId: session.orgId,
      runId,
      operationId: operation.id,
      kind: decision.kind,
      code: decision.code,
      reason: decision.reason,
      nextAction: decision.nextAction,
      observed: JSON.stringify({
        shortfallAtomic: books.ledger.shortfallAtomic.toString(),
        availableUsdcAtomic: books.ledger.availableUsdcAtomic.toString(),
        treasurySolAtomic: books.treasury.solAtomic,
        x402SpendableAtomic: books.ledger.x402SpendableAtomic.toString(),
        solInAtomic: solIn?.toString() ?? null,
        policyVersion: books.policy.version,
      }),
      createdAt: new Date(),
    });
    await notify(session.orgId, "analysis", "Funding analysis finished", decision.reason, "funding");
    await audit(session, "funding.analyze", "operation", operation.id, { code: decision.code });
    return ok(decision.reason);
  });
}

async function buyQuoteImpl(session: Session): Promise<ActionState> {
  assertCan(session.role, "x402.approve");
  return withLock(`funding:${session.orgId}`, async () => {
    const db = await getDb();
    const books = await loadBooks(db, session.orgId);
    if (books.policy.paused) return fail("Agent is paused. API payments are blocked.", "AGENT_PAUSED");
    if (books.policy.executionMode === "observe") return fail("Observe only mode does not buy quotes.");
    const operation = books.openOperation;
    if (!operation || operation.state !== "X402_AUTHORIZATION_REQUIRED") return fail("There is no quote waiting for authorization.");
    if (!operation.solInAtomic) return fail("Set a SOL amount before buying a quote.");
    const demo = books.org.mode === "demo";
    if (!demo) return fail("Web payments are quarantined. Use the separately approved local paid-quote procedure.", "LIVE_QUARANTINED");
    if (!demo && !liveArmed(books.org.mode, books.org.liveEnabled)) {
      return fail("Live payments are off. Enable them in Settings and set LIVE_OPERATIONS=true. Read-only mode can still fetch an unpaid 402.");
    }
    const amount = demo ? 3007n : 0n;
    if (demo) {
      const gate = assessApiPayment({
        amountAtomic: amount,
        asset: USDC_MINT,
        network: "solana",
        payTo: "BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD",
        expectedAsset: USDC_MINT,
        expectedNetwork: "solana",
        allowedPayTo: ["BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD"],
        perCallMaxAtomic: BigInt(books.policy.perCallMaxAtomic),
        dailySpentAtomic: await spentToday(session.orgId),
        dailyLimitAtomic: BigInt(books.policy.dailyApiLimitAtomic),
        walletBalanceAtomic: BigInt(books.payer.usdcAtomic),
        minReserveAtomic: BigInt(books.policy.minX402UsdcAtomic),
        paused: false,
      });
      if (!gate.ok) return fail(gate.reason, gate.code);
      const nextPayer = BigInt(books.payer.usdcAtomic) - amount;
      await db.update(treasuryAccounts).set({ usdcAtomic: nextPayer.toString(), observedAt: new Date() }).where(eq(treasuryAccounts.id, books.payer.id));
      const callId = crypto.randomUUID();
      await db.insert(x402Calls).values({
        id: callId,
        orgId: session.orgId,
        operationId: operation.id,
        endpoint: "/v1/swap/quote",
        evidenceClass: "simulated",
        httpStatus: 200,
        amountAtomic: amount.toString(),
        payTo: "BPz2u6eoWLervxEqfpsMCVmKk7h6fEVsd7L5rvEibMfD",
        asset: USDC_MINT,
        network: "solana",
        requestJson: JSON.stringify({ simulated: true, note: "Not a live Swap.io settlement. The x402 Explorer can fetch a real unpaid 402." }),
        responseJson: JSON.stringify({ simulated: true }),
        receiptSignature: `SIMULATED:x402:${callId}`,
        createdAt: new Date(),
      });
      const solIn = BigInt(operation.solInAtomic);
      const minOut = solIn >= 1_000_000_000n ? books.ledger.shortfallAtomic : 1n;
      const quoteId = crypto.randomUUID();
      await db.insert(quotes).values({
        id: quoteId,
        orgId: session.orgId,
        operationId: operation.id,
        callId,
        providerKey: "simulated-route",
        inputAtomic: solIn.toString(),
        outputAtomic: minOut.toString(),
        minOutAtomic: minOut.toString(),
        slippageBps: 50,
        priceImpact: null,
        providerQuote: JSON.stringify({ simulated: true, minOut: minOut.toString() }),
        evidenceClass: "simulated",
        expiresAt: new Date(Date.now() + books.policy.maxQuoteAgeMs),
        selected: false,
        createdAt: new Date(),
      });
      const view = decideFunding({
        paused: false,
        recipientsAllowlisted: true,
        shortfallAtomic: books.ledger.shortfallAtomic,
        treasurySolAtomic: BigInt(books.treasury.solAtomic),
        minTreasurySolAtomic: BigInt(books.policy.minTreasurySolAtomic),
        proposedSolInAtomic: solIn,
        x402SpendableAtomic: nextPayer > BigInt(books.policy.minX402UsdcAtomic) ? nextPayer - BigInt(books.policy.minX402UsdcAtomic) : 0n,
        quotePriceAtomic: null,
        now: Date.now(),
        slippageCeilingBps: books.policy.slippageCeilingBps,
        maxQuoteAgeMs: books.policy.maxQuoteAgeMs,
        marginBps: BigInt(books.policy.marginBps),
        quote: { minOutAtomic: minOut, receivedAt: Date.now(), slippageBps: 50, evidenceClass: "simulated" },
        x402Authorized: true,
        swapAuthorized: false,
      });
      let state = asFunding(operation.state);
      state = transition(state, "QUOTE_START");
      state = transition(state, view.code === "MIN_OUT" || view.kind === "reject" ? "REJECT_QUOTE" : "QUOTE_OK");
      if (state === "QUOTE_RECEIVED") state = transition(state, view.kind === "reject" ? "REJECT_QUOTE" : "ACCEPT_QUOTE");
      await db.update(quotes).set({ selected: state === "SWAP_APPROVAL_REQUIRED" }).where(eq(quotes.id, quoteId));
      await db.update(operations).set({ state, reason: `SIMULATED. ${view.reason}`, updatedAt: new Date() }).where(eq(operations.id, operation.id));
      await notify(session.orgId, "x402", "SIMULATED API payment recorded", view.reason, "x402");
      return ok(`SIMULATED. ${view.reason}`);
    }

    return fail("Live web payments are quarantined.", "LIVE_QUARANTINED");
  });
}

async function spentToday(orgId: string): Promise<bigint> {
  const db = await getDb();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const calls = await db.select().from(x402Calls).where(eq(x402Calls.orgId, orgId));
  return calls.reduce((sum, call) => {
    if (!call.amountAtomic || !call.receiptSignature || call.createdAt < start) return sum;
    return sum + BigInt(call.amountAtomic);
  }, 0n);
}

async function approveSwapImpl(session: Session): Promise<ActionState> {
  assertCan(session.role, "swap.approve");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (books.policy.paused) return fail("Agent is paused.", "AGENT_PAUSED");
  const operation = books.openOperation;
  if (!operation || operation.state !== "SWAP_APPROVAL_REQUIRED") return fail("No swap is waiting for approval.");
  const quote = (await db.select().from(quotes).where(and(eq(quotes.operationId, operation.id), eq(quotes.selected, true))).limit(1))[0];
  if (!quote || !quote.minOutAtomic) return fail("The selected quote is missing a minimum output.");
  if (quote.expiresAt.getTime() < Date.now()) return fail("Quote rejected: the quote is older than the configured maximum age.", "QUOTE_EXPIRED");
  if (quote.evidenceClass !== "simulated" || books.org.mode !== "demo") return fail("Live swaps are quarantined pending instruction validation.", "LIVE_QUARANTINED");
  if (operation.policyVersion !== books.policy.version) return fail("Policy changed. Analyze and approve again.");
  const body: ProposalBody = {
    type: "swap",
    policyVersion: books.policy.version,
    orgId: session.orgId,
    assetMint: USDC_MINT,
    amountAtomic: quote.minOutAtomic,
    sourceWallet: books.treasury.address,
    destinations: [{ wallet: books.treasury.address, amountAtomic: quote.minOutAtomic }],
    quoteId: quote.id,
    minOutAtomic: quote.minOutAtomic,
    slippageBps: quote.slippageBps,
    solInAtomic: quote.inputAtomic,
    expiresAt: quote.expiresAt.toISOString(),
  };
  const hash = proposalHash(body);
  if (session.role !== "owner") return fail("Treasury swaps require owner authorization. A USDC approver limit does not authorize SOL spending.");
  await db.insert(authorizations).values({
    id: crypto.randomUUID(),
    orgId: session.orgId,
    subjectType: "swap",
    subjectId: quote.id,
    actorId: session.userId,
    proposalHash: hash,
    decision: "approved",
    createdAt: new Date(),
  });
  let state = transition(asFunding(operation.state), "APPROVE_SWAP");
  const demo = quote.evidenceClass === "simulated" || books.org.mode === "demo";
  if (demo) {
    state = transition(state, "BUILD_OK");
    const execId = crypto.randomUUID();
    await db.insert(swapExecutions).values({
      id: execId,
      orgId: session.orgId,
      operationId: operation.id,
      quoteId: quote.id,
      unsignedTx: null,
      signature: null,
      status: "ready",
      evidenceClass: "simulated",
      detail: "SIMULATED unsigned plan. No Solana transaction was built.",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.update(operations).set({ state, reason: "Waiting for the simulated settlement confirmation.", updatedAt: new Date() }).where(eq(operations.id, operation.id));
    return ok("SIMULATED swap is ready. Confirm the demo settlement before any payout.");
  }
  if (!liveArmed(books.org.mode, books.org.liveEnabled)) return fail("Live swap building is disabled.");
  return fail("Live swap construction is quarantined pending provider instruction validation and durable reconciliation.", "LIVE_QUARANTINED");
}

async function settleDemoSwapImpl(session: Session): Promise<ActionState> {
  if (session.role !== "owner" && session.role !== "approver") return fail("You cannot settle a swap.");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (books.policy.paused) return fail("Agent is paused.", "AGENT_PAUSED");
  if (books.org.mode !== "demo") return fail("Demo settlement is only available on the demo ledger.");
  const operation = books.openOperation;
  if (!operation || operation.state !== "SWAP_READY") return fail("The swap is not ready.");
  const exec = (await db.select().from(swapExecutions).where(eq(swapExecutions.operationId, operation.id)).limit(1))[0];
  const quote = exec ? (await db.select().from(quotes).where(eq(quotes.id, exec.quoteId)).limit(1))[0] : undefined;
  if (!exec || !quote?.minOutAtomic || exec.evidenceClass !== "simulated" || quote.evidenceClass !== "simulated") return fail("Simulated swap record is missing.");
  if (quote.expiresAt.getTime() <= Date.now()) return fail("Quote expired. Analyze again.", "QUOTE_EXPIRED");
  if (operation.policyVersion !== books.policy.version) return fail("Policy changed after approval.");
  const nextSol = BigInt(books.treasury.solAtomic) - BigInt(quote.inputAtomic);
  if (nextSol < BigInt(books.policy.minTreasurySolAtomic)) return fail("Funding request blocked: projected SOL balance would fall below your minimum reserve.", "SOL_RESERVE");
  const nextUsdc = BigInt(books.treasury.usdcAtomic) + BigInt(quote.minOutAtomic);
  await db.update(treasuryAccounts).set({ solAtomic: nextSol.toString(), usdcAtomic: nextUsdc.toString(), source: "demo", observedAt: new Date() }).where(eq(treasuryAccounts.id, books.treasury.id));
  const signature = `SIMULATED:swap:${exec.id}`;
  await db.update(swapExecutions).set({ signature, status: "confirmed", updatedAt: new Date() }).where(eq(swapExecutions.id, exec.id));
  let state = asFunding(operation.state);
  state = transition(state, "SUBMIT");
  state = transition(state, "SEEN");
  state = transition(state, "CONFIRM_OK");
  state = transition(state, "READY_PAYROLL");
  await db.update(operations).set({ state, reason: "SIMULATED swap recorded on the demo ledger.", updatedAt: new Date() }).where(eq(operations.id, operation.id));
  await notify(session.orgId, "swap_confirmed", "SIMULATED swap recorded", `${sol(quote.inputAtomic)} moved to ${usdc(quote.minOutAtomic)} on the demo ledger.`, "swap");
  return ok("SIMULATED swap recorded. Recalculate payroll before paying anyone.");
}

async function cancelOperationImpl(session: Session): Promise<ActionState> {
  assertCan(session.role, "funding.approve");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  const operation = books.openOperation;
  if (!operation) return fail("Nothing to cancel.");
  try {
    transition(asFunding(operation.state), "CANCEL");
  } catch {
    return fail("This operation can no longer be cancelled. Reconcile it instead.");
  }
  const bought = (await db.select().from(x402Calls).where(eq(x402Calls.operationId, operation.id))).some((call) => call.receiptSignature);
  await db.update(operations).set({
    state: "CANCELLED",
    reason: bought ? "Operation cancelled after a quote was purchased. The API payment is not reversed." : "Cancelled before payment.",
    updatedAt: new Date(),
  }).where(eq(operations.id, operation.id));
  return ok(bought ? "Cancelled. The API payment was not reversed and no swap was broadcast." : "Cancelled.");
}

async function setPausedImpl(session: Session, paused: boolean): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can pause the agent.");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  const next = { ...books.policy, paused, version: books.policy.version + 1 };
  await db.insert(policies).values({ id: crypto.randomUUID(), orgId: session.orgId, version: next.version, body: JSON.stringify(next), createdAt: new Date() });
  if (paused && books.openOperation) {
    try {
      const blockedFrom = books.openOperation.state;
      const state = transition(asFunding(blockedFrom), "BLOCK");
      await db.update(operations).set({ state, blockedFrom, reason: "Agent paused.", updatedAt: new Date() }).where(eq(operations.id, books.openOperation.id));
    } catch {
      await notify(session.orgId, "agent_paused", "Agent paused", "In-flight confirmation will continue. New money movement waits.", "agent");
    }
  }
  if (!paused && books.openOperation?.state === "BLOCKED" && books.openOperation.blockedFrom) {
    const state = transition("BLOCKED", "RESUME", asFunding(books.openOperation.blockedFrom));
    await db.update(operations).set({ state, blockedFrom: null, reason: "Agent resumed.", updatedAt: new Date() }).where(eq(operations.id, books.openOperation.id));
  }
  await audit(session, paused ? "agent.pause" : "agent.resume", "policy", String(next.version), {});
  await notify(session.orgId, "agent_paused", paused ? "Agent paused" : "Agent resumed", paused ? "New quotes, swaps, and payouts are blocked." : "The agent can propose actions again.", "agent");
  return ok(paused ? "Emergency pause is on." : "Agent resumed.");
}

async function makeBatchImpl(session: Session, ids: string[]): Promise<ActionState> {
  assertCan(session.role, "payroll.approve");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (books.policy.paused) return fail("Agent is paused.", "AGENT_PAUSED");
  if (new Set(ids).size !== ids.length || ids.length === 0) return fail("Duplicate or empty milestone selection", "DUPLICATE");
  const chosen = books.tasks.filter((task) => ids.includes(task.id));
  if (chosen.length !== ids.length) return fail("Milestone not found in this organization");
  if (chosen.some((task) => books.items.some((item) => item.milestoneId === task.id))) return fail("Milestone is already allocated", "DUPLICATE");
  if (chosen.some((task) => task.amountAtomic !== task.lockedAmount)) return fail("Approved amount changed");
  const verdict = validateBatch(chosen.map((task) => {
    const person = books.people.find((row) => row.id === task.contributorId);
    return {
      milestoneId: task.id,
      recipient: person?.address ?? "",
      amountAtomic: BigInt(task.amountAtomic),
      allowlisted: Boolean(person?.allowlisted),
      active: Boolean(person?.active),
      paymentStatus: task.paymentStatus,
      lockedRecipient: task.lockedRecipient ?? "",
      workStatus: task.workStatus,
      mint: task.mint,
      expectedMint: USDC_MINT,
    };
  }));
  if (!verdict.ok) return fail(verdict.reason, verdict.code);
  const id = crypto.randomUUID();
  await db.insert(batches).values({
    id,
    orgId: session.orgId,
    status: "DRAFT",
    totalAtomic: verdict.totalAtomic.toString(),
    operationId: books.openOperation?.id ?? null,
    proposalHash: null,
    evidenceClass: books.org.mode === "demo" ? "simulated" : "live_unpaid",
    createdAt: new Date(),
  });
  await db.insert(batchItems).values(chosen.map((task) => ({
    id: crypto.randomUUID(),
    batchId: id,
    milestoneId: task.id,
    amountAtomic: task.lockedAmount ?? task.amountAtomic,
    recipient: task.lockedRecipient ?? "",
    status: "PENDING",
  })));
  await notify(session.orgId, "payroll_batch", "Payroll batch drafted", `${chosen.length} recipients are ready for review.`, "payroll");
  return ok("Batch drafted. It is not a payment yet.");
}

async function decideBatchImpl(session: Session, batchId: string, decision: "approved" | "rejected"): Promise<ActionState> {
  assertCan(session.role, "payroll.approve");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  const batch = books.batchRows.find((row) => row.id === batchId);
  if (!batch || batch.status !== "DRAFT") return fail("That batch is not awaiting approval.");
  if (decision === "rejected") {
    await db.update(batches).set({ status: "REJECTED" }).where(eq(batches.id, batchId));
    await db.delete(batchItems).where(eq(batchItems.batchId, batchId));
    return ok("Batch rejected. The milestones can be selected again.");
  }
  if (books.policy.paused) return fail("Agent is paused.", "AGENT_PAUSED");
  if (!await validBatchRecipients(session.orgId, batchId)) return fail("Batch recipients or approvals changed.", "RECIPIENT_CHANGED");
  if (books.ledger.availableUsdcAtomic < BigInt(batch.totalAtomic)) {
    return fail(`Treasury USDC cannot cover this batch. Shortfall remains ${usdc(books.ledger.shortfallAtomic)}.`, "INSUFFICIENT_USDC");
  }
  const items = books.items.filter((item) => item.batchId === batchId);
  const body: ProposalBody = {
    type: "payout",
    policyVersion: books.policy.version,
    orgId: session.orgId,
    assetMint: USDC_MINT,
    amountAtomic: batch.totalAtomic,
    sourceWallet: books.treasury.address,
    destinations: items.map((item) => ({ wallet: item.recipient, amountAtomic: item.amountAtomic })),
  };
  if (!withinApproverLimit(session.role, BigInt(batch.totalAtomic), BigInt(books.policy.approverMaxAtomic))) {
    return fail("This payroll is above the approver limit.");
  }
  const hash = proposalHash(body);
  await db.insert(authorizations).values({
    id: crypto.randomUUID(),
    orgId: session.orgId,
    subjectType: "payout",
    subjectId: batchId,
    actorId: session.userId,
    proposalHash: hash,
    decision: "approved",
    createdAt: new Date(),
  });
  await db.update(batches).set({ status: "APPROVED", proposalHash: hash }).where(eq(batches.id, batchId));
  return ok("Batch authorized. Execution still has to be confirmed.");
}

async function settleDemoPayoutImpl(session: Session, batchId: string): Promise<ActionState> {
  assertCan(session.role, "payroll.approve");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (books.org.mode !== "demo") return fail("Use wallet signing for a live payout. Demo settlement only updates the demo ledger.");
  if (books.policy.paused) return fail("Agent is paused.", "AGENT_PAUSED");
  const batch = books.batchRows.find((row) => row.id === batchId);
  if (!batch || batch.status !== "APPROVED" || !batch.proposalHash) return fail("Authorize the batch before paying it.");
  const items = books.items.filter((item) => item.batchId === batchId);
  const again = proposalHash({
    type: "payout",
    policyVersion: books.policy.version,
    orgId: session.orgId,
    assetMint: USDC_MINT,
    amountAtomic: batch.totalAtomic,
    sourceWallet: books.treasury.address,
    destinations: items.map((item) => ({ wallet: item.recipient, amountAtomic: item.amountAtomic })),
  });
  if (again !== batch.proposalHash) return fail("The batch changed after approval. Approve it again.", "RECIPIENT_CHANGED");
  if (BigInt(books.treasury.usdcAtomic) - BigInt(batch.totalAtomic) < BigInt(books.policy.minTreasuryUsdcAtomic)) {
    return fail("The payout would break the USDC reserve.", "INSUFFICIENT_USDC");
  }
  if (!await validBatchRecipients(session.orgId, batchId)) return fail("Batch recipients or approvals changed.", "RECIPIENT_CHANGED");
  if (items.some((item) => item.status !== "PENDING")) return fail("Reconcile this batch. Some allocations are no longer pending.");
  const signature = `SIMULATED:payout:${batchId}`;
  await db.update(treasuryAccounts).set({
    usdcAtomic: (BigInt(books.treasury.usdcAtomic) - BigInt(batch.totalAtomic)).toString(),
    source: "demo",
    observedAt: new Date(),
  }).where(eq(treasuryAccounts.id, books.treasury.id));
  await db.insert(payoutTxs).values({
    id: crypto.randomUUID(),
    orgId: session.orgId,
    batchId,
    chunkIndex: 0,
    signature,
    status: "CONFIRMED",
    evidenceClass: "simulated",
    detail: "SIMULATED payout. Not a Solana transaction.",
    createdAt: new Date(),
  });
  for (const item of items) {
    await db.update(batchItems).set({ status: "CONFIRMED" }).where(eq(batchItems.id, item.id));
    await db.update(milestones).set({ paymentStatus: "PAID", updatedAt: new Date() }).where(eq(milestones.id, item.milestoneId));
  }
  await db.update(batches).set({ status: "CONFIRMED" }).where(eq(batches.id, batchId));
  if (books.openOperation?.state === "PAYROLL_READY") {
    await db.update(operations).set({ state: "COMPLETED", reason: "SIMULATED payout recorded.", updatedAt: new Date() }).where(eq(operations.id, books.openOperation.id));
  }
  await notify(session.orgId, "payout_completed", "SIMULATED payout recorded", `${usdc(batch.totalAtomic)} left the demo ledger.`, "payout");
  await audit(session, "payout.demo", "batch", batchId, { signature });
  return ok("SIMULATED payout recorded. It is not on Solana.");
}

async function markPartialImpl(session: Session, batchId: string): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can run the demo partial-failure control.");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (books.org.mode !== "demo") return fail("This control only exists on the demo ledger.");
  const items = books.items.filter((item) => item.batchId === batchId);
  if (books.policy.paused) return fail("Agent is paused.", "AGENT_PAUSED");
  const batch = books.batchRows.find((row) => row.id === batchId);
  if (!batch || batch.status !== "APPROVED" || !batch.proposalHash || items.some((item) => item.status !== "PENDING")) return fail("Only a fresh approved batch can demonstrate partial failure.");
  const currentHash = proposalHash({ type: "payout", policyVersion: books.policy.version, orgId: session.orgId, assetMint: USDC_MINT, amountAtomic: batch.totalAtomic, sourceWallet: books.treasury.address, destinations: items.map((item) => ({ wallet: item.recipient, amountAtomic: item.amountAtomic })) });
  if (currentHash !== batch.proposalHash) return fail("Policy or proposal changed after approval.");
  if (!await validBatchRecipients(session.orgId, batchId)) return fail("Recipient approval changed");
  if (BigInt(books.treasury.usdcAtomic) - BigInt(batch.totalAtomic) < BigInt(books.policy.minTreasuryUsdcAtomic)) return fail("Insufficient funding");
  const first = items[0];
  const second = items[1];
  if (!first || !second) return fail("Need at least two recipients to demonstrate a partial result.");
  await db.update(batchItems).set({ status: "CONFIRMED" }).where(eq(batchItems.id, first.id));
  await db.update(batchItems).set({ status: "FAILED" }).where(eq(batchItems.id, second.id));
  await db.update(milestones).set({ paymentStatus: "PAID", updatedAt: new Date() }).where(eq(milestones.id, first.milestoneId));
  await db.update(milestones).set({ paymentStatus: "PAYMENT_FAILED", updatedAt: new Date() }).where(eq(milestones.id, second.milestoneId));
  await db.update(batches).set({ status: "PARTIAL" }).where(eq(batches.id, batchId));
  await db.update(treasuryAccounts).set({
    usdcAtomic: (BigInt(books.treasury.usdcAtomic) - BigInt(first.amountAtomic)).toString(),
    observedAt: new Date(),
  }).where(eq(treasuryAccounts.id, books.treasury.id));
  await notify(session.orgId, "payout_partial", "SIMULATED partial payout", "One recipient is marked paid and one failed. The batch is held for reconciliation; automatic retries are disabled. Nothing was broadcast.", "payout");
  return ok("SIMULATED partial result recorded. The failed recipient was not paid twice.");
}

async function savePolicyImpl(session: Session, patch: Record<string, string>): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can change policy.");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  const next = {
    ...books.policy,
    version: books.policy.version + 1,
    minTreasurySolAtomic: parseAtomic(patch.minSol ?? "0", 9).toString(),
    minTreasuryUsdcAtomic: parseAtomic(patch.minUsdc ?? "0", 6).toString(),
    minX402UsdcAtomic: parseAtomic(patch.minX402 ?? "0", 6).toString(),
    refillThresholdAtomic: parseAtomic(patch.threshold ?? "0", 6).toString(),
    minRefillAtomic: parseAtomic(patch.minRefill ?? "0", 6).toString(),
    maxRefillAtomic: parseAtomic(patch.maxRefill ?? "0", 6).toString(),
    perCallMaxAtomic: parseAtomic(patch.perCall ?? "0", 6).toString(),
    dailyApiLimitAtomic: parseAtomic(patch.daily ?? "0", 6).toString(),
    approverMaxAtomic: parseAtomic(patch.approverMax ?? "0", 6).toString(),
    slippageCeilingBps: Number(patch.slippage ?? books.policy.slippageCeilingBps),
    maxQuoteAgeMs: Number(patch.quoteAge ?? books.policy.maxQuoteAgeMs) * 1000,
    marginBps: Number(patch.margin ?? books.policy.marginBps),
    agentName: patch.agentName || books.policy.agentName,
    purpose: patch.purpose || books.policy.purpose,
    executionMode: patch.executionMode === "observe" || patch.executionMode === "simulation" ? patch.executionMode : "approval_required",
    scopedAutomation: false as const,
  };
  const parsed = parsePolicy(JSON.stringify(next));
  await db.insert(policies).values({ id: crypto.randomUUID(), orgId: session.orgId, version: parsed.version, body: JSON.stringify(parsed), createdAt: new Date() });
  await audit(session, "policy.update", "policy", String(parsed.version), { version: parsed.version });
  return ok(`Policy version ${parsed.version} saved. Older approvals no longer match.`);
}

async function setModeImpl(session: Session, mode: string, liveEnabled: boolean): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can change the operating mode.");
  if (mode !== "demo" && mode !== "live_readonly" && mode !== "live") return fail("Unknown mode");
  const current = await loadBooks(await getDb(), session.orgId);
  if (current.treasury.source === "demo" || session.authMode === "demo") {
    if (mode !== "demo" || liveEnabled) return fail("Demo fixtures cannot become live state. Use an independently provisioned deployment.", "DEMO_ISOLATION");
  }
  if (liveEnabled) return fail("Financial execution is quarantined by the audit.", "LIVE_QUARANTINED");
  if (liveEnabled && process.env.LIVE_OPERATIONS !== "true") {
    return fail("Set LIVE_OPERATIONS=true in the server environment before enabling live money movement.");
  }
  const db = await getDb();
  await db.update(organizations).set({ mode, liveEnabled: mode === "live" && liveEnabled }).where(eq(organizations.id, session.orgId));
  await audit(session, "mode.update", "organization", session.orgId, { mode, liveEnabled });
  return ok(mode === "demo" ? "Demo ledger is active." : mode === "live_readonly" ? "Live read-only is active. No payments will be sent." : "Live mode is armed. Money movement still needs an approval for each action.");
}

async function refreshBalancesImpl(session: Session): Promise<ActionState> {
  assertCan(session.role, "read");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (books.org.mode === "demo") {
    await db.update(treasuryAccounts).set({ observedAt: new Date() }).where(eq(treasuryAccounts.orgId, session.orgId));
    return ok("Demo ledger timestamp refreshed. Chain balances were not read.");
  }
  try {
    const treasury = await readChainBalances(books.treasury.address);
    const payer = await readChainBalances(books.payer.address);
    await db.update(treasuryAccounts).set({ solAtomic: treasury.solAtomic.toString(), usdcAtomic: treasury.usdcAtomic.toString(), source: "rpc", observedAt: new Date(), observedSlot: treasury.slot }).where(and(eq(treasuryAccounts.id, books.treasury.id), sql`(${treasuryAccounts.observedSlot} is null or ${treasuryAccounts.observedSlot}<=${treasury.slot})`));
    await db.update(treasuryAccounts).set({ solAtomic: payer.solAtomic.toString(), usdcAtomic: payer.usdcAtomic.toString(), source: "rpc", observedAt: new Date(), observedSlot: payer.slot }).where(and(eq(treasuryAccounts.id, books.payer.id), sql`(${treasuryAccounts.observedSlot} is null or ${treasuryAccounts.observedSlot}<=${payer.slot})`));
    return ok(`Balances read from RPC at slot ${treasury.slot}. USD value is unavailable.`);
  } catch {
    return fail("RPC did not return balances. Existing figures were left unchanged.", "RPC_OUTAGE");
  }
}

async function captureChallengeImpl(session: Session, solText: string): Promise<ActionState> {
  if (!can(session.role, "read") && session.role !== "owner") return fail("You cannot call Hermes.");
  let lamports: bigint;
  try {
    lamports = parseAtomic(solText || "1", 9);
  } catch {
    return fail("Enter a SOL amount.");
  }
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  const body = buildQuoteBody({
    inputMint: WSOL_MINT,
    inputAmount: lamports,
    outputMint: USDC_MINT,
    userAddress: books.treasury.address,
    slippageBps: 50,
  });
  const result = await unpaidHermes("/v1/swap/quote", { method: "POST", body });
  await db.insert(x402Calls).values({
    id: crypto.randomUUID(),
    orgId: session.orgId,
    operationId: null,
    endpoint: "/v1/swap/quote",
    evidenceClass: "live_unpaid",
    httpStatus: result.status,
    amountAtomic: result.kind === "payment_required" ? selectSolanaUsdc(normalizeNeed(parsePaymentRequired(result.body)))?.maxAmountRequired.toString() ?? null : null,
    payTo: result.kind === "payment_required" ? selectSolanaUsdc(normalizeNeed(parsePaymentRequired(result.body)))?.payTo ?? null : null,
    asset: USDC_MINT,
    network: "solana",
    requestJson: JSON.stringify(body),
    responseJson: JSON.stringify(result.body),
    receiptSignature: null,
    createdAt: new Date(),
  });
  if (result.kind === "payment_required") return ok("Live unpaid HTTP 402 captured. No USDC was spent.");
  if (result.kind === "rate_limited") return fail("Hermes rate limited the unpaid request.", "RATE_LIMITED");
  return fail(`Hermes returned HTTP ${result.status}. No payment was sent.`);
}

async function markReadImpl(session: Session): Promise<ActionState> {
  const db = await getDb();
  const rows = await db.select().from(notifications).where(eq(notifications.orgId, session.orgId));
  for (const row of rows) {
    if (!row.readAt) await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, row.id));
  }
  return ok("Notifications marked read");
}

async function shareProofImpl(session: Session, batchId: string, includeAddresses: boolean): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can publish payroll proofs.");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  const batch = books.batchRows.find((row) => row.id === batchId);
  if (!batch) return fail("Batch not found");
  const token = crypto.randomUUID().replace(/-/g, "");
  await db.insert(proofShares).values({
    id: crypto.randomUUID(),
    orgId: session.orgId,
    batchId,
    token,
    includeAddresses,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    createdAt: new Date(),
  });
  return ok(token);
}

async function registerWalletImpl(session: Session, userId: string, address: string): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can register a wallet.");
  if (!isValidSolanaAddress(address)) return fail("Invalid wallet address.", "INVALID_WALLET");
  if (session.authMode !== "wallet") return fail("Wallet enrollment requires an authenticated wallet owner.");
  const db = await getDb();
  const member = (await db.select().from(members).where(and(eq(members.userId, userId), eq(members.orgId, session.orgId))).limit(1))[0];
  if (!member) return fail("That person is not in this organization.");
  const memberships = await db.select().from(members).where(eq(members.userId, userId));
  if (memberships.some((membership) => membership.orgId !== session.orgId)) return fail("Shared identities cannot be replaced by one organization's owner.");
  await db.update(users).set({ walletAddress: address }).where(eq(users.id, userId));
  await audit(session, "wallet.register", "user", userId, { address });
  return ok("Wallet registered for sign-in. Treasury funds were not moved.");
}

export async function submitSignedSwap(session: Session, signed: string): Promise<ActionState> {
  assertCan(session.role, "swap.approve");
  void signed;
  return fail("Live swaps and payouts are quarantined pending instruction validation and durable submission reconciliation.", "LIVE_QUARANTINED");
}

export async function prepareLivePayout(session: Session, batchId: string): Promise<ActionState> {
  assertCan(session.role, "payroll.approve");
  void batchId;
  return fail("Live swaps and payouts are quarantined pending instruction validation and durable submission reconciliation.", "LIVE_QUARANTINED");
}

async function refillDemoImpl(session: Session, amountText: string): Promise<ActionState> {
  if (session.role !== "owner") return fail("Only the owner can authorize a refill.");
  const db = await getDb();
  const books = await loadBooks(db, session.orgId);
  if (books.org.mode !== "demo") return fail("A live refill has to be an authorized treasury transfer. It is not executed from this demo action.");
  if (books.policy.paused) return fail("Emergency pause is on. Refill is blocked.", "AGENT_PAUSED");
  let requested: bigint;
  try {
    requested = parseAtomic(amountText, 6);
  } catch {
    return fail("Enter a USDC refill amount.");
  }
  const auditsRows = await db.select().from(audits).where(eq(audits.orgId, session.orgId));
  const last = auditsRows.filter((row) => row.action === "refill").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const surplus = books.ledger.availableUsdcAtomic > books.ledger.shortfallAtomic + (books.obligations.reduce((sum, task) => sum + BigInt(task.amountAtomic), 0n) - books.ledger.shortfallAtomic)
    ? 0n
    : 0n;
  const freeUsdc = books.ledger.availableUsdcAtomic > books.obligations.reduce((sum, task) => sum + BigInt(task.amountAtomic), 0n)
    ? books.ledger.availableUsdcAtomic - books.obligations.reduce((sum, task) => sum + BigInt(task.amountAtomic), 0n)
    : 0n;
  void surplus;
  const plan = assessRefill({
    paused: false,
    balanceAtomic: BigInt(books.payer.usdcAtomic),
    thresholdAtomic: BigInt(books.policy.refillThresholdAtomic),
    minRefillAtomic: BigInt(books.policy.minRefillAtomic),
    maxRefillAtomic: BigInt(books.policy.maxRefillAtomic),
    lastRefillAt: last ? last.createdAt.getTime() : null,
    now: Date.now(),
    cooldownMs: books.policy.refillCooldownMs,
    treasuryUsdcAvailableAtomic: freeUsdc,
    treasurySolSafeAtomic: books.ledger.safeSolAtomic,
    requestedAtomic: requested,
  });
  if (!plan.ok) return fail(plan.reason, plan.code);
  if (plan.kind !== "usdc_transfer") return fail(plan.reason);
  await db.update(treasuryAccounts).set({ usdcAtomic: (BigInt(books.treasury.usdcAtomic) - requested).toString(), observedAt: new Date() }).where(eq(treasuryAccounts.id, books.treasury.id));
  await db.update(treasuryAccounts).set({ usdcAtomic: (BigInt(books.payer.usdcAtomic) + requested).toString(), observedAt: new Date() }).where(eq(treasuryAccounts.id, books.payer.id));
  await audit(session, "refill", "treasury", books.payer.id, { amountAtomic: requested.toString(), evidenceClass: "simulated" });
  return ok(`SIMULATED USDC transfer of ${usdc(requested)} moved from treasury to the API wallet on the demo ledger.`);
}

export const saveContributor = serialize(saveContributorImpl);

export const setAllowlist = serialize(setAllowlistImpl);

export const saveMilestone = serialize(saveMilestoneImpl);

export const reviewMilestone = serialize(reviewMilestoneImpl);

export const analyze = serialize(analyzeImpl);

export const buyQuote = serialize(buyQuoteImpl);

export const approveSwap = serialize(approveSwapImpl);

export const settleDemoSwap = serialize(settleDemoSwapImpl);

export const cancelOperation = serialize(cancelOperationImpl);

export const setPaused = serialize(setPausedImpl);

export const makeBatch = serialize(makeBatchImpl);

export const decideBatch = serialize(decideBatchImpl);

export const settleDemoPayout = serialize(settleDemoPayoutImpl);

export const markPartial = serialize(markPartialImpl);

export const savePolicy = serialize(savePolicyImpl);

export const setMode = serialize(setModeImpl);

export const refreshBalances = serialize(refreshBalancesImpl);

export const captureChallenge = serialize(captureChallengeImpl);

export const markRead = serialize(markReadImpl);

export const shareProof = serialize(shareProofImpl);

export const registerWallet = serialize(registerWalletImpl);

export const refillDemo = serialize(refillDemoImpl);

async function validBatchRecipients(orgId: string, batchId: string): Promise<boolean> {
  const books = await loadBooks(await getDb(), orgId);
  const items = books.items.filter((item) => item.batchId === batchId);
  return items.length > 0 && items.every((item) => {
    const task = books.tasks.find((task) => task.id === item.milestoneId);
    const person = books.people.find((person) => person.id === task?.contributorId);
    return task?.workStatus === "APPROVED" && task.lockedAmount === item.amountAtomic &&
      task.lockedRecipient === item.recipient && person?.address === item.recipient && person.active && person.allowlisted;
  });
}
