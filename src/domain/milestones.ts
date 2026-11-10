export const WORK_STATUSES = ["DRAFT", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "NOT_PAYABLE",
  "UNPAID",
  "FUNDING_REQUIRED",
  "READY_FOR_PAYMENT",
  "PAYMENT_SUBMITTED",
  "PAID",
  "PAYMENT_FAILED",
  "UNKNOWN",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const WORK_EDGES: Record<WorkStatus, readonly WorkStatus[]> = {
  DRAFT: ["IN_PROGRESS", "SUBMITTED"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: ["IN_PROGRESS"],
};

export class MilestoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MilestoneError";
  }
}

export function assertWorkTransition(from: WorkStatus, to: WorkStatus): void {
  if (!WORK_EDGES[from].includes(to)) throw new MilestoneError(`Illegal work transition ${from} -> ${to}`);
}

export function paymentAfterApproval(): PaymentStatus {
  return "UNPAID";
}

export function paymentAfterRejection(): PaymentStatus {
  return "NOT_PAYABLE";
}

export function assertConsistent(work: WorkStatus, payment: PaymentStatus): void {
  if (work === "APPROVED" && payment === "NOT_PAYABLE") {
    throw new MilestoneError("Approved work cannot be not-payable");
  }
  if (work !== "APPROVED" && payment !== "NOT_PAYABLE" && payment !== "PAYMENT_FAILED") {
    throw new MilestoneError("Unapproved work cannot carry a payable status");
  }
  if (work === "REJECTED" && payment !== "NOT_PAYABLE") {
    throw new MilestoneError("Rejected work cannot be payable");
  }
}

export function canEditMilestone(work: WorkStatus, payment: PaymentStatus): boolean {
  if (payment === "PAID" || payment === "PAYMENT_SUBMITTED" || payment === "UNKNOWN") return false;
  return work === "DRAFT" || work === "IN_PROGRESS" || work === "REJECTED";
}

export function canAmend(work: WorkStatus, payment: PaymentStatus): boolean {
  return work === "APPROVED" && (payment === "UNPAID" || payment === "FUNDING_REQUIRED" || payment === "READY_FOR_PAYMENT" || payment === "PAYMENT_FAILED");
}

export function assertHumanApprover(role: string): void {
  if (role !== "owner" && role !== "approver") {
    throw new MilestoneError("An agent cannot approve its own milestones");
  }
}
