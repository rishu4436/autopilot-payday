import { describe, expect, it } from "vitest";
import { accountTreasury } from "./accounting";
import { approvalStillValid, decidePaidRetry, nextConfirmationAction, proposalHash, type ProposalBody } from "./approval";
import { assertCan, assertSameOrg, AuthzError, buildSignInMessage, can, consumeNonce, withinApproverLimit } from "./authz";
import { decideFunding } from "./decisions";
import { flowVisual, transition, TransitionError } from "./machine";
import { assertConsistent, assertHumanApprover, assertWorkTransition, canAmend, canEditMilestone } from "./milestones";
import { formatAtomic, parseAtomic, requiredOutput } from "./money";
import { canRetryPayout, validateBatch } from "./payroll";
import { assessApiPayment, assessRefill, projectedSolOk } from "./policy";
import { rateLimit, redact } from "./rate";
import { recoveryCatalog } from "./recovery";
import { NORTHSTAR, northstarObligationTotal } from "./scenario";
import { USDC_MINT } from "./tokens";

const item = (overrides: Partial<Parameters<typeof validateBatch>[0][number]> = {}) => ({
  milestoneId: "m1",
  recipient: "Recipient1111111111111111111111111111111111",
  amountAtomic: 40_000_000n,
  allowlisted: true,
  active: true,
  paymentStatus: "UNPAID",
  lockedRecipient: "Recipient1111111111111111111111111111111111",
  workStatus: "APPROVED",
  mint: USDC_MINT,
  expectedMint: USDC_MINT,
  ...overrides,
});

describe("money", () => {
  it("parses and formats USDC without floating point", () => {
    expect(parseAtomic("125", 6)).toBe(125_000_000n);
    expect(parseAtomic("0.003007", 6)).toBe(3007n);
    expect(parseAtomic("35.5", 6)).toBe(35_500_000n);
    expect(formatAtomic(125_000_000n, 6)).toBe("125");
    expect(formatAtomic(3007n, 6)).toBe("0.003007");
    expect(() => parseAtomic("1e-3", 6)).toThrow();
    expect(() => parseAtomic("1.0000001", 6)).toThrow();
    expect(() => parseAtomic("-1", 6)).toThrow();
  });

  it("applies funding margin in atomic units", () => {
    expect(requiredOutput(90_000_000n, 0n)).toBe(90_000_000n);
    expect(requiredOutput(90_000_000n, 100n)).toBe(90_900_000n);
  });
});

describe("northstar accounting", () => {
  it("computes a 90 USDC shortfall without double counting", () => {
    const total = northstarObligationTotal();
    expect(total).toBe(125_000_000n);
    const ledger = accountTreasury({
      treasuryUsdcAtomic: NORTHSTAR.treasuryUsdc,
      treasurySolAtomic: NORTHSTAR.treasurySol,
      minTreasuryUsdcAtomic: NORTHSTAR.minTreasuryUsdc,
      minTreasurySolAtomic: NORTHSTAR.minTreasurySol,
      pendingPayoutUsdcAtomic: 0n,
      approvedUnpaidUsdcAtomic: total,
      obligationIds: ["a", "b", "c"],
      commitmentIds: [],
      x402UsdcAtomic: NORTHSTAR.x402Usdc,
      minX402UsdcAtomic: NORTHSTAR.minX402Usdc,
    });
    expect(ledger.availableUsdcAtomic).toBe(35_000_000n);
    expect(ledger.shortfallAtomic).toBe(90_000_000n);
    expect(ledger.coveredAtomic).toBe(35_000_000n);
    expect(ledger.x402SpendableAtomic).toBe(1_500_000n);
    expect(() =>
      accountTreasury({
        treasuryUsdcAtomic: 35_000_000n,
        treasurySolAtomic: 1n,
        minTreasuryUsdcAtomic: 0n,
        minTreasurySolAtomic: 0n,
        pendingPayoutUsdcAtomic: 10n,
        approvedUnpaidUsdcAtomic: 10n,
        obligationIds: ["same"],
        commitmentIds: ["same"],
        x402UsdcAtomic: 0n,
        minX402UsdcAtomic: 0n,
      }),
    ).toThrow(/pending commitment/);
  });
});

describe("api and refill policy", () => {
  const base = {
    amountAtomic: 3007n,
    asset: USDC_MINT,
    network: "solana",
    payTo: "PAY",
    expectedAsset: USDC_MINT,
    expectedNetwork: "solana",
    allowedPayTo: ["PAY"],
    perCallMaxAtomic: 50_000n,
    dailySpentAtomic: 0n,
    dailyLimitAtomic: 1_000_000n,
    walletBalanceAtomic: 2_500_000n,
    minReserveAtomic: 1_000_000n,
    paused: false,
  };

  it("accepts a 402 inside budget and reserve", () => {
    expect(assessApiPayment(base).ok).toBe(true);
  });

  it("rejects the wrong payee, pause, budget, and reserve breach", () => {
    expect(assessApiPayment({ ...base, payTo: "OTHER" }).ok).toBe(false);
    expect(assessApiPayment({ ...base, allowedPayTo: [] }).ok).toBe(false);
    expect(assessApiPayment({ ...base, paused: true }).ok).toBe(false);
    expect(assessApiPayment({ ...base, amountAtomic: 60_000n }).ok).toBe(false);
    expect(assessApiPayment({ ...base, walletBalanceAtomic: 1_001_000n, amountAtomic: 2_000n }).ok).toBe(false);
    expect(assessApiPayment({ ...base, network: "base" }).ok).toBe(false);
  });

  it("plans a USDC transfer before a swap", () => {
    const direct = assessRefill({
      paused: false,
      balanceAtomic: 800_000n,
      thresholdAtomic: 1_500_000n,
      minRefillAtomic: 1_000_000n,
      maxRefillAtomic: 10_000_000n,
      lastRefillAt: null,
      now: 10_000,
      cooldownMs: 86_400_000,
      treasuryUsdcAvailableAtomic: 5_000_000n,
      treasurySolSafeAtomic: 1_000_000_000n,
      requestedAtomic: 2_000_000n,
    });
    expect(direct.ok && direct.kind).toBe("usdc_transfer");

    const swap = assessRefill({
      paused: false,
      balanceAtomic: 800_000n,
      thresholdAtomic: 1_500_000n,
      minRefillAtomic: 1_000_000n,
      maxRefillAtomic: 10_000_000n,
      lastRefillAt: null,
      now: 10_000,
      cooldownMs: 1,
      treasuryUsdcAvailableAtomic: 0n,
      treasurySolSafeAtomic: 2_000_000_000n,
      requestedAtomic: 2_000_000n,
    });
    expect(swap.ok && swap.kind).toBe("needs_swap_then_transfer");
    expect(assessRefill({
      paused: false,
      balanceAtomic: 800_000n,
      thresholdAtomic: 1_500_000n,
      minRefillAtomic: 1_000_000n,
      maxRefillAtomic: 10_000_000n,
      lastRefillAt: 9_000,
      now: 10_000,
      cooldownMs: 5_000,
      treasuryUsdcAvailableAtomic: 5_000_000n,
      treasurySolSafeAtomic: 1n,
      requestedAtomic: 2_000_000n,
    }).ok).toBe(false);
  });

  it("blocks a SOL input that breaks the reserve", () => {
    expect(projectedSolOk(1_000_000_000n, 900_000_000n, 200_000_000n)).toBe(false);
  });
});

describe("decisions", () => {
  const ctx = {
    paused: false,
    recipientsAllowlisted: true,
    shortfallAtomic: 90_000_000n,
    treasurySolAtomic: parseAtomic("12.5", 9),
    minTreasurySolAtomic: parseAtomic("0.05", 9),
    proposedSolInAtomic: parseAtomic("1", 9),
    x402SpendableAtomic: 1_500_000n,
    quotePriceAtomic: 3007n,
    now: 1_000_000,
    slippageCeilingBps: 100,
    maxQuoteAgeMs: 60_000,
    marginBps: 0n,
    quote: null,
    x402Authorized: false,
    swapAuthorized: false,
  };

  it("uses the specified reasons", () => {
    expect(decideFunding({ ...ctx, shortfallAtomic: 0n }).reason).toBe(
      "No conversion required: existing available USDC covers approved payroll.",
    );
    expect(decideFunding({ ...ctx, proposedSolInAtomic: parseAtomic("12.5", 9) }).reason).toBe(
      "Funding request blocked: projected SOL balance would fall below your minimum reserve.",
    );
    expect(decideFunding(ctx).reason).toBe("Waiting for owner authorization.");
    expect(decideFunding({ ...ctx, recipientsAllowlisted: false }).reason).toBe(
      "Payout paused: recipient wallet is not allowlisted.",
    );
    const rejected = decideFunding({
      ...ctx,
      x402Authorized: true,
      quote: { minOutAtomic: 1n, receivedAt: 999_000, slippageBps: 50, evidenceClass: "simulated" },
    });
    expect(rejected.reason).toBe("Quote rejected: output falls below the configured minimum.");
  });

  it("does not mark payroll done before confirmation", () => {
    expect(flowVisual("QUOTE_RECEIVED", true).payrollToPeople).toBe("idle");
    expect(flowVisual("SWAP_CONFIRMING", true).swapToUsdc).toBe("active");
    expect(flowVisual("COMPLETED", true).payrollToPeople).toBe("done");
    expect(flowVisual("SWAP_CONFIRMED", true).payrollToPeople).toBe("idle");
  });
});

describe("state machine", () => {
  it("walks the happy path and rejects illegal moves", () => {
    let state = transition("CREATED", "ANALYZE");
    state = transition(state, "NEED_FUNDS");
    state = transition(state, "REQUEST_QUOTE");
    state = transition(state, "AUTHORIZE_X402");
    state = transition(state, "QUOTE_START");
    state = transition(state, "QUOTE_OK");
    state = transition(state, "ACCEPT_QUOTE");
    state = transition(state, "APPROVE_SWAP");
    state = transition(state, "BUILD_OK");
    state = transition(state, "SUBMIT");
    state = transition(state, "SEEN");
    expect(() => transition(state, "CANCEL")).toThrow(TransitionError);
    expect(() => transition(state, "BLOCK")).toThrow(TransitionError);
    state = transition(state, "CONFIRM_UNKNOWN");
    expect(state).toBe("SWAP_UNKNOWN");
    state = transition(state, "CONFIRM_OK");
    state = transition(state, "READY_PAYROLL");
    state = transition(state, "COMPLETE");
    expect(state).toBe("COMPLETED");
    expect(() => transition(state, "CANCEL")).toThrow(TransitionError);
  });

  it("resumes to the blocked state and never resends an unknown payment", () => {
    const blocked = transition("SWAP_READY", "BLOCK");
    expect(transition(blocked, "RESUME", "SWAP_READY")).toBe("SWAP_READY");
    expect(decidePaidRetry("payment_sent_unknown")).toBe("deny");
    expect(decidePaidRetry("challenge_seen")).toBe("allow");
    expect(nextConfirmationAction({ status: "submitted", signature: null })).toBe("mark_unknown");
    expect(nextConfirmationAction({ status: "unknown", signature: "sig" })).toBe("poll");
    expect(canRetryPayout("UNKNOWN")).toBe(false);
    expect(canRetryPayout("FAILED")).toBe(true);
  });
});

describe("milestones, payroll, approval", () => {
  it("locks approval and rejects contradictory edits", () => {
    expect(() => assertHumanApprover("agent")).toThrow();
    expect(() => assertWorkTransition("APPROVED", "DRAFT")).toThrow();
    expect(() => assertConsistent("REJECTED", "UNPAID")).toThrow();
    expect(canEditMilestone("APPROVED", "UNPAID")).toBe(false);
    expect(canAmend("APPROVED", "UNPAID")).toBe(true);
    expect(canAmend("APPROVED", "UNKNOWN")).toBe(false);
  });

  it("rejects duplicate, unpaid, and substituted recipients", () => {
    expect(validateBatch([item(), item()]).ok).toBe(false);
    expect(validateBatch([item({ paymentStatus: "PAID" })]).ok).toBe(false);
    expect(validateBatch([item({ recipient: "other" })]).ok).toBe(false);
    expect(validateBatch([item({ paymentStatus: "UNKNOWN" })]).ok).toBe(false);
    const ok = validateBatch([item(), item({ milestoneId: "m2", amountAtomic: 50_000_000n })]);
    expect(ok.ok && ok.totalAtomic).toBe(90_000_000n);
  });

  it("invalidates an approval when the amount changes", () => {
    const body: ProposalBody = {
      type: "payout",
      policyVersion: 1,
      orgId: "org",
      assetMint: USDC_MINT,
      amountAtomic: "125000000",
      sourceWallet: "treasury",
      destinations: [{ wallet: "maya", amountAtomic: "40000000" }],
    };
    const hash = proposalHash(body);
    expect(approvalStillValid(hash, body)).toBe(true);
    expect(approvalStillValid(hash, { ...body, amountAtomic: "125000001" })).toBe(false);
    expect(approvalStillValid(hash, { ...body, destinations: [{ wallet: "leo", amountAtomic: "40000000" }] })).toBe(false);
  });
});

describe("auth and recovery", () => {
  it("enforces roles, org scope, and nonce replay", () => {
    expect(can("auditor", "milestone.approve")).toBe(false);
    expect(can("contributor", "milestone.submit")).toBe(true);
    expect(() => assertCan("contributor", "payroll.approve")).toThrow(AuthzError);
    expect(() => assertSameOrg("a", "b")).toThrow(AuthzError);
    expect(withinApproverLimit("approver", 10n, 10n)).toBe(true);
    expect(withinApproverLimit("approver", 11n, 10n)).toBe(false);
    expect(() => consumeNonce({ usedAt: 1, expiresAt: 99 }, 2)).toThrow(/already used/);
    expect(() => consumeNonce({ usedAt: null, expiresAt: 1 }, 2)).toThrow(/expired/);
    expect(buildSignInMessage({
      domain: "localhost",
      address: "abc",
      nonce: "n",
      issuedAt: "t",
      expiration: "e",
    })).toContain("Nonce: n");
  });

  it("covers the edge-case catalog and redacts secrets", () => {
    const codes = recoveryCatalog().map((row) => row.code);
    for (const code of ["SETTLEMENT_UNCERTAIN", "PARTIAL_PAYOUT", "AGENT_PAUSED", "QUOTE_EXPIRED", "UNEXPECTED_PAYEE"]) {
      expect(codes).toContain(code);
    }
    expect(recoveryCatalog().every((row) => row.autoRetryPayment === false)).toBe(true);
    expect(redact({ secretKey: [1], signature: "ok", nested: { payer_keypair: "hide" } })).toEqual({
      secretKey: "[redacted]",
      signature: "ok",
      nested: { payer_keypair: "[redacted]" },
    });
    expect(redact(Array.from({ length: 64 }, () => 1))).toBe("[redacted-keypair]");
  });

  it("rate limits a window", () => {
    let stamps: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = rateLimit(stamps, 1_000 + i, 3, 10_000);
      expect(result.ok).toBe(true);
      stamps = result.next;
    }
    expect(rateLimit(stamps, 1_010, 3, 10_000).ok).toBe(false);
  });
});

