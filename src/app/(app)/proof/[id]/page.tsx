import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getWorkspace } from "@/server/read";
import { evidenceLabel, solscanTx } from "@/solana/address";

export const dynamic = "force-dynamic";

export default async function ProofDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getWorkspace();
  if (!data) redirect("/login");
  const batch = data.books.batchRows.find((row) => row.id === id);
  if (!batch) notFound();
  const items = data.books.items.filter((item) => item.batchId === id);
  const operationId = batch.operationId;
  const calls = data.calls.filter((call) => call.operationId === operationId);
  const quotes = data.quotes.filter((quote) => quote.operationId === operationId);
  const swaps = data.swaps.filter((swap) => swap.operationId === operationId);
  const payouts = data.payouts.filter((payout) => payout.batchId === id);
  const events = data.decisions.filter((row) => row.operationId === operationId);
  const payload = {
    batch: { id: batch.id, status: batch.status, totalAtomic: batch.totalAtomic, evidenceClass: batch.evidenceClass },
    items: items.map((item) => ({ milestoneId: item.milestoneId, amountAtomic: item.amountAtomic, status: item.status })),
    calls: calls.map((call) => ({ endpoint: call.endpoint, evidenceClass: call.evidenceClass, receipt: call.receiptSignature })),
    quotes: quotes.map((quote) => ({ provider: quote.providerKey, minOutAtomic: quote.minOutAtomic, evidenceClass: quote.evidenceClass })),
    swaps: swaps.map((swap) => ({ status: swap.status, signature: swap.signature, evidenceClass: swap.evidenceClass })),
    payouts: payouts.map((payout) => ({ status: payout.status, signature: payout.signature, evidenceClass: payout.evidenceClass })),
  };
  return (
    <article className="stack">
      <p className="kicker">Receipt</p>
      <h1 style={{ margin: 0 }}>Payday proof</h1>
      <p><span className="badge">{evidenceLabel(batch.evidenceClass)}</span> {data.usdc(batch.totalAtomic)} · {batch.status}</p>
      <section className="panel">
        <h2>Timeline</h2>
        {events.map((event) => <p key={event.id}>{event.createdAt.toISOString()} · {event.reason}</p>)}
        {events.length === 0 && <p>No decision log is linked to this batch.</p>}
      </section>
      <section className="panel table-wrap">
        <table>
          <thead><tr><th>Kind</th><th>Reference</th><th>Evidence</th></tr></thead>
          <tbody>
            {calls.map((call) => <tr key={call.id}><td>API payment</td><td>{link(call.receiptSignature)}</td><td>{evidenceLabel(call.evidenceClass)}</td></tr>)}
            {swaps.map((swap) => <tr key={swap.id}><td>Swap</td><td>{link(swap.signature)}</td><td>{evidenceLabel(swap.evidenceClass)}</td></tr>)}
            {payouts.map((payout) => <tr key={payout.id}><td>Payout</td><td>{link(payout.signature)}</td><td>{evidenceLabel(payout.evidenceClass)}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Recipients</h2>
        {items.map((item) => {
          const task = data.books.tasks.find((row) => row.id === item.milestoneId);
          return <p key={item.id}>{task ? data.personName(task.contributorId) : "Recipient"} · {task?.title} · {data.usdc(item.amountAtomic)} · {item.status}</p>;
        })}
      </section>
      <div className="row no-print">
        <a className="btn" href={`data:application/json,${encodeURIComponent(JSON.stringify(payload, null, 2))}`} download={`proof-${batch.id}.json`}>JSON</a>
        <a className="btn" href={`data:text/csv,${encodeURIComponent(csv(payload))}`} download={`proof-${batch.id}.csv`}>CSV</a>
        <Link className="btn" href="/proof">Back</Link>
      </div>
    </article>
  );
}

function link(signature: string | null) {
  if (!signature) return "—";
  const href = solscanTx(signature);
  return href ? <a href={href}>{signature}</a> : signature;
}

function csv(payload: { items: { milestoneId: string; amountAtomic: string; status: string }[] }) {
  return ["milestone,amount_atomic,status", ...payload.items.map((item) => `${item.milestoneId},${item.amountAtomic},${item.status}`)].join("\n");
}
