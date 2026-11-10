export const FUNDING_STATES = [
  "CREATED",
  "ANALYZING",
  "NO_ACTION_REQUIRED",
  "FUNDING_REQUIRED",
  "QUOTE_REQUEST_PENDING",
  "X402_AUTHORIZATION_REQUIRED",
  "QUOTE_REQUEST_IN_PROGRESS",
  "QUOTE_RECEIVED",
  "QUOTE_REJECTED",
  "SWAP_APPROVAL_REQUIRED",
  "SWAP_BUILDING",
  "SWAP_READY",
  "SWAP_SUBMITTED",
  "SWAP_CONFIRMING",
  "SWAP_UNKNOWN",
  "SWAP_CONFIRMED",
  "SWAP_FAILED",
  "PAYROLL_READY",
  "COMPLETED",
  "BLOCKED",
  "CANCELLED",
] as const;

export type FundingState = (typeof FUNDING_STATES)[number];

export const FUNDING_EVENTS = [
  "ANALYZE",
  "NO_ACTION",
  "NEED_FUNDS",
  "REQUEST_QUOTE",
  "AUTHORIZE_X402",
  "QUOTE_START",
  "QUOTE_OK",
  "ACCEPT_QUOTE",
  "REJECT_QUOTE",
  "APPROVE_SWAP",
  "BUILD_OK",
  "BUILD_FAIL",
  "SUBMIT",
  "SEEN",
  "CONFIRM_OK",
  "CONFIRM_FAIL",
  "CONFIRM_UNKNOWN",
  "READY_PAYROLL",
  "COMPLETE",
  "BLOCK",
  "CANCEL",
  "RESUME",
] as const;

export type FundingEvent = (typeof FUNDING_EVENTS)[number];

const TABLE: Record<FundingState, Partial<Record<FundingEvent, FundingState>>> = {
  CREATED: { ANALYZE: "ANALYZING", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  ANALYZING: {
    NO_ACTION: "NO_ACTION_REQUIRED",
    NEED_FUNDS: "FUNDING_REQUIRED",
    BLOCK: "BLOCKED",
    CANCEL: "CANCELLED",
  },
  NO_ACTION_REQUIRED: { READY_PAYROLL: "PAYROLL_READY", COMPLETE: "COMPLETED", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  FUNDING_REQUIRED: { REQUEST_QUOTE: "QUOTE_REQUEST_PENDING", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  QUOTE_REQUEST_PENDING: { AUTHORIZE_X402: "X402_AUTHORIZATION_REQUIRED", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  X402_AUTHORIZATION_REQUIRED: { QUOTE_START: "QUOTE_REQUEST_IN_PROGRESS", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  QUOTE_REQUEST_IN_PROGRESS: { QUOTE_OK: "QUOTE_RECEIVED", REJECT_QUOTE: "QUOTE_REJECTED", BLOCK: "BLOCKED" },
  QUOTE_RECEIVED: { ACCEPT_QUOTE: "SWAP_APPROVAL_REQUIRED", REJECT_QUOTE: "QUOTE_REJECTED", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  QUOTE_REJECTED: { REQUEST_QUOTE: "QUOTE_REQUEST_PENDING", NEED_FUNDS: "FUNDING_REQUIRED", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  SWAP_APPROVAL_REQUIRED: { APPROVE_SWAP: "SWAP_BUILDING", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  SWAP_BUILDING: { BUILD_OK: "SWAP_READY", BUILD_FAIL: "SWAP_FAILED", BLOCK: "BLOCKED" },
  SWAP_READY: { SUBMIT: "SWAP_SUBMITTED", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  SWAP_SUBMITTED: { SEEN: "SWAP_CONFIRMING" },
  SWAP_CONFIRMING: { CONFIRM_OK: "SWAP_CONFIRMED", CONFIRM_FAIL: "SWAP_FAILED", CONFIRM_UNKNOWN: "SWAP_UNKNOWN" },
  SWAP_UNKNOWN: { CONFIRM_OK: "SWAP_CONFIRMED", CONFIRM_FAIL: "SWAP_FAILED" },
  SWAP_CONFIRMED: { READY_PAYROLL: "PAYROLL_READY" },
  SWAP_FAILED: { NEED_FUNDS: "FUNDING_REQUIRED", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  PAYROLL_READY: { COMPLETE: "COMPLETED", BLOCK: "BLOCKED", CANCEL: "CANCELLED" },
  COMPLETED: {},
  BLOCKED: { RESUME: "CREATED" },
  CANCELLED: {},
};

export class TransitionError extends Error {
  readonly from: FundingState;
  readonly event: FundingEvent;
  constructor(from: FundingState, event: FundingEvent) {
    super(`Illegal funding transition ${from} + ${event}`);
    this.name = "TransitionError";
    this.from = from;
    this.event = event;
  }
}

export function transition(state: FundingState, event: FundingEvent, blockedFrom?: FundingState): FundingState {
  if (state === "BLOCKED" && event === "RESUME") {
    if (!blockedFrom || blockedFrom === "BLOCKED" || blockedFrom === "CANCELLED" || blockedFrom === "COMPLETED") {
      throw new TransitionError(state, event);
    }
    if (blockedFrom === "SWAP_SUBMITTED" || blockedFrom === "SWAP_CONFIRMING" || blockedFrom === "SWAP_UNKNOWN") {
      throw new TransitionError(state, event);
    }
    return blockedFrom;
  }
  const next = TABLE[state][event];
  if (!next) throw new TransitionError(state, event);
  return next;
}

export function isTerminal(state: FundingState): boolean {
  return state === "COMPLETED" || state === "CANCELLED";
}

export function needsHuman(state: FundingState): boolean {
  return (
    state === "X402_AUTHORIZATION_REQUIRED" ||
    state === "SWAP_APPROVAL_REQUIRED" ||
    state === "SWAP_READY" ||
    state === "PAYROLL_READY" ||
    state === "QUOTE_REJECTED" ||
    state === "SWAP_UNKNOWN" ||
    state === "BLOCKED"
  );
}

export type EdgeTone = "idle" | "pending" | "active" | "done" | "blocked";

export interface FlowVisual {
  solToSwap: EdgeTone;
  swapToUsdc: EdgeTone;
  usdcToPayroll: EdgeTone;
  payrollToPeople: EdgeTone;
  reserveToX402: EdgeTone;
}

export function flowVisual(state: FundingState, quoteSettled: boolean): FlowVisual {
  const blocked = state === "BLOCKED" || state === "SWAP_FAILED" || state === "QUOTE_REJECTED";
  return {
    solToSwap: blocked
      ? "blocked"
      : state === "SWAP_CONFIRMED" || state === "PAYROLL_READY" || state === "COMPLETED"
        ? "done"
        : state === "SWAP_SUBMITTED" || state === "SWAP_CONFIRMING" || state === "SWAP_UNKNOWN" || state === "SWAP_READY" || state === "SWAP_BUILDING"
          ? "active"
          : state === "FUNDING_REQUIRED" || state === "SWAP_APPROVAL_REQUIRED" || state === "QUOTE_RECEIVED"
            ? "pending"
            : "idle",
    swapToUsdc:
      state === "SWAP_CONFIRMED" || state === "PAYROLL_READY" || state === "COMPLETED"
        ? "done"
        : state === "SWAP_CONFIRMING" || state === "SWAP_UNKNOWN"
          ? "active"
          : "idle",
    usdcToPayroll:
      state === "COMPLETED" ? "done" : state === "PAYROLL_READY" ? "pending" : state === "NO_ACTION_REQUIRED" ? "pending" : "idle",
    payrollToPeople: state === "COMPLETED" ? "done" : "idle",
    reserveToX402:
      state === "QUOTE_REQUEST_IN_PROGRESS"
        ? "active"
        : quoteSettled
          ? "done"
          : state === "X402_AUTHORIZATION_REQUIRED" || state === "QUOTE_REQUEST_PENDING"
            ? "pending"
            : "idle",
  };
}
