import { redirect } from "next/navigation";
import { VolumeChart } from "@/components/charts";
import { getWorkspace } from "@/server/read";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const paid = data.books.tasks.filter((task) => task.paymentStatus === "PAID");
  const total = paid.reduce((sum, task) => sum + BigInt(task.amountAtomic), 0n);
  const quotes = data.quotes.length;
  const executed = data.swaps.filter((swap) => swap.status === "confirmed").length;
  const refusals = data.decisions.filter((row) => row.kind === "reject").length + data.audits.filter((row) => row.action === "payroll.refused").length;
  const x402 = data.calls.reduce((sum, call) => sum + (call.amountAtomic && call.receiptSignature ? BigInt(call.amountAtomic) : 0n), 0n);
  const points = paid.map((task) => ({ day: task.updatedAt.toISOString().slice(0, 10), usdc: Number(task.amountAtomic) / 1_000_000 }));
  const demo = data.books.org.mode === "demo";
  return (
    <div className="stack">
      <p className="kicker">Analytics</p>
      <h1 style={{ margin: 0 }}>Only recorded operations</h1>
      {demo && <p className="badge amber">Includes simulated demo records. These are not chain analytics.</p>}
      <div className="grid-metrics">
        <Stat label="Paid to contributors" value={data.usdc(total)} />
        <Stat label="Funded milestones" value={String(paid.length)} />
        <Stat label="Quotes" value={String(quotes)} />
        <Stat label="Quote to confirmed swap" value={quotes === 0 ? "—" : `${executed}/${quotes}`} />
        <Stat label="x402 expenses" value={data.usdc(x402)} />
        <Stat label="Policy refusals" value={String(refusals)} />
      </div>
      <section className="panel">
        <VolumeChart points={points} />
        <p>Successful swaps {executed}. Failed or unknown swaps {data.swaps.filter((swap) => swap.status === "failed" || swap.status === "unknown").length}. Current shortfall {data.usdc(data.books.ledger.shortfallAtomic)}. Reserve {data.books.ledger.x402BelowReserve ? "below minimum" : "intact"}.</p>
        <p>Average processing time is omitted when a milestone has no paired approval and payout timestamps that both came from recorded events.</p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article className="metric"><div className="kicker">{label}</div><div className="num" style={{ fontSize: 28 }}>{value}</div></article>;
}
