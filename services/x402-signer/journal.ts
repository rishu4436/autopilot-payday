import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/domain/approval";
import { type PaidPlan, planHash, validatePlan } from "../../src/hermes/paid-plan";

export interface JournalRow {
  planId: string; hash: string; at: string; amount: string;
  state: "reserved" | "prepared" | "signed" | "verified" | "unknown";
  signature?: string; messageHash?: string; messageBase64?: string; receiptHeader?: string;
  plan?: PaidPlan;
}
type Envelope = { version: 2; previous: string; row: JournalRow; digest: string };
const ZERO = "0".repeat(64);
function digest(previous: string, row: JournalRow): string {
  return createHash("sha256").update(canonicalJson({ previous, row, version: 2 })).digest("hex");
}
export class PaymentJournal {
  readonly path: string;
  private readonly lockPath: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "payments.jsonl"); this.lockPath = join(directory, "journal.lock");
  }
  private entries(): Envelope[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, "utf8");
    if (raw && !raw.endsWith("\n")) throw new Error("Truncated journal; reconcile manually");
    let previous = ZERO;
    return raw.split("\n").filter(Boolean).map((line) => {
      const e = JSON.parse(line) as Envelope, row = e.row;
      if (e.version !== 2 || !row?.planId || !/^[a-f0-9]{64}$/.test(row.hash) || !/^\d+$/.test(row.amount) || !Number.isFinite(Date.parse(row.at)) || e.previous !== previous || e.digest !== digest(previous, row)) throw new Error("Invalid journal chain; reconcile manually");
      previous = e.digest; return e;
    });
  }
  rows(): JournalRow[] { return this.entries().map((e) => e.row); }
  private locked<T>(work: () => T): T {
    const fd = openSync(this.lockPath, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fsyncSync(fd); return work(); } finally { closeSync(fd); unlinkSync(this.lockPath); }
  }
  private write(row: JournalRow, entries: Envelope[]): void {
    const previous = entries.at(-1)?.digest ?? ZERO;
    const fd = openSync(this.path, "a", 0o600);
    try { appendFileSync(fd, `${JSON.stringify({ version: 2, previous, row, digest: digest(previous, row) })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  }
  append(row: JournalRow): void {
    this.locked(() => {
      const entries = this.entries(), prior = entries.map((e) => e.row).filter((r) => r.planId === row.planId).at(-1);
      if (!prior || prior.hash !== row.hash || prior.amount !== row.amount || prior.at !== row.at || prior.state === "verified") throw new Error("Invalid journal state transition");
      if (row.state === "reserved" || (prior.state === "unknown" && row.state !== "verified")) throw new Error("Uncertain payment requires positive reconciliation");
      if (row.signature && entries.some((e) => e.row.planId !== row.planId && e.row.signature === row.signature)) throw new Error("Receipt signature was already used by another plan");
      this.write({ ...prior, ...row }, entries);
    });
  }
  reserve(plan: PaidPlan, balance: bigint, now = Date.now()): JournalRow {
    return this.locked(() => {
      validatePlan(plan, now);
      const entries = this.entries(), rows = entries.map((e) => e.row);
      if (rows.some((row) => row.planId === plan.id)) throw new Error("Plan already attempted. Reconcile; never retry it.");
      const latest = new Map(rows.map((row) => [row.planId, row]));
      if ([...latest.values()].some((row) => row.state !== "verified")) throw new Error("Uncertain previous payment. Reconcile before any new payment.");
      const reservations = rows.filter((row) => row.state === "reserved");
      const day = new Date(now).toISOString().slice(0, 10);
      const spent = reservations.filter((row) => row.at.startsWith(day)).reduce((sum, row) => sum + BigInt(row.amount), 0n);
      const total = reservations.reduce((sum, row) => sum + BigInt(row.amount), 0n);
      const amount = BigInt(plan.terms.amount);
      if (spent + amount > BigInt(plan.dailyLimitAtomic)) throw new Error("Cumulative daily ceiling exceeded");
      if (total + amount > BigInt(plan.lifetimeLimitAtomic)) throw new Error("Cumulative lifetime ceiling exceeded");
      if (balance < amount + BigInt(plan.reserveAtomic)) throw new Error("Payer balance or reserve insufficient");
      const row: JournalRow = { planId: plan.id, hash: planHash(plan), at: new Date(now).toISOString(), amount: amount.toString(), state: "reserved", plan };
      this.write(row, entries); return row;
    });
  }
}
