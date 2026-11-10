import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type PaidPlan, planHash, validatePlan } from "../../src/hermes/paid-plan";

export interface JournalRow { planId: string; hash: string; at: string; amount: string; state: "reserved" | "signed" | "verified" | "unknown"; signature?: string; messageHash?: string }
export class PaymentJournal {
  readonly path: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "payments.jsonl");
  }
  rows(): JournalRow[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8").trim().split("\n").filter(Boolean).map((line) => {
      const row = JSON.parse(line) as JournalRow;
      if (!row.planId || !row.hash || !/^\d+$/.test(row.amount) || !Number.isFinite(Date.parse(row.at))) throw new Error("Invalid journal. Reconcile manually.");
      return row;
    });
  }
  append(row: JournalRow): void {
    const fd = openSync(this.path, "a", 0o600);
    try { appendFileSync(fd, `${JSON.stringify(row)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  }
  reserve(plan: PaidPlan, balance: bigint, now = Date.now()): JournalRow {
    validatePlan(plan, now);
    const rows = this.rows();
    if (rows.some((row) => row.planId === plan.id)) throw new Error("Plan already attempted. Reconcile; never retry it.");
    const latest = new Map(rows.map((row) => [row.planId, row]));
    if ([...latest.values()].some((row) => row.state !== "verified")) throw new Error("Uncertain previous payment. Reconcile before any new payment.");
    const day = new Date(now).toISOString().slice(0, 10);
    const spent = rows.filter((row) => row.state === "reserved" && row.at.startsWith(day)).reduce((sum, row) => sum + BigInt(row.amount), 0n);
    const amount = BigInt(plan.terms.amount);
    if (spent + amount > BigInt(plan.dailyLimitAtomic)) throw new Error("Cumulative daily ceiling exceeded");
    if (balance < amount + BigInt(plan.reserveAtomic)) throw new Error("Payer balance or reserve insufficient");
    const row: JournalRow = { planId: plan.id, hash: planHash(plan), at: new Date(now).toISOString(), amount: amount.toString(), state: "reserved" };
    this.append(row); // Durable before any signature or network submission.
    return row;
  }
}
