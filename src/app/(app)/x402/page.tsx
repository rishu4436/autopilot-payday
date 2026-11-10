import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import captured from "../../../../fixtures/live-402-quote.json";
import { Microscope } from "@/components/visuals";
import { challengeAction } from "@/server/actions";
import { discoverLive } from "@/server/hermes";
import { getWorkspace } from "@/server/read";
import { evidenceLabel, solscanTx } from "@/solana/address";

export const dynamic = "force-dynamic";

export default async function X402Page() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  let discovery: Awaited<ReturnType<typeof discoverLive>> | null = null;
  let discoveryError: string | null = null;
  try {
    discovery = await discoverLive();
  } catch {
    discoveryError = "Hermes discovery is unreachable right now. The captured 402 below is a real unpaid response from 2026-11-10, not a live connection.";
  }
  const latest = data.calls[0];
  return (
    <div className="stack">
      <p className="kicker">Swap.io x402</p>
      <h1 style={{ margin: 0 }}>Pay for a quote only when payroll needs one</h1>
      <p>A subscription would charge the treasury every month. x402 charges a fraction of a cent when the agent actually needs a route. Failed calls are not charged. A 200 without a settlement receipt is not treated as paid.</p>
      <div className="row">
        <span className={discovery ? "badge mint" : "badge coral"}>{discovery ? "Hermes reachable" : "Discovery unavailable"}</span>
        <span className="badge">Payer {data.books.payer.address.slice(0, 4)}…{data.books.payer.address.slice(-4)}</span>
        <span className="badge">Network solana</span>
      </div>
      {discoveryError && <p>{discoveryError}</p>}
      <section className="panel table-wrap">
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Payment</th><th>Published base</th></tr></thead>
          <tbody>
            {(discovery?.endpoints ?? []).map((endpoint: { method: string; path: string; payment: string; basePrice?: string }) => (
              <tr key={endpoint.path}><td>{endpoint.method}</td><td>{endpoint.path}</td><td>{endpoint.payment}</td><td>{endpoint.basePrice ? `${endpoint.basePrice} atomic USDC` : "—"}</td></tr>
            ))}
          </tbody>
        </table>
        <p>Published base prices are floors. The binding price is maxAmountRequired on that request's own HTTP 402. Status is paid on the live discovery document, so this app confirms swaps with Solana RPC instead of paying for every poll.</p>
      </section>
      {data.session.role !== "auditor" && (
        <ActionForm className="panel row" action={challengeAction}>
          <label className="field">SOL amount for an unpaid quote challenge<input name="sol" defaultValue="1" /></label>
          <button className="btn primary" type="submit">Fetch live HTTP 402</button>
        </ActionForm>
      )}
      <Microscope
        request={JSON.stringify(captured.request, null, 2)}
        challenge={`Captured live unpaid response on ${captured.capturedAt}. Status ${captured.status}. Solana price ${captured.body.accepts[0]?.maxAmountRequired} atomic USDC. No settlement.`}
        payment="Not performed for this capture. A demo quote later records a SIMULATED payment and says so."
        retry="The unpaid challenge is safe to repeat. A payment whose result is unknown is not."
        response={JSON.stringify(captured.body, null, 2)}
      />
      <section className="panel stack">
        <h2>Recorded calls</h2>
        {data.calls.map((call) => {
          const href = call.receiptSignature ? solscanTx(call.receiptSignature) : null;
          return (
            <article key={call.id}>
              <span className="badge">{evidenceLabel(call.evidenceClass)}</span> {call.endpoint} · HTTP {call.httpStatus ?? "—"} · {call.amountAtomic ? data.usdc(call.amountAtomic) : "no charge"}
              <div>{href ? <a href={href}>{call.receiptSignature}</a> : call.receiptSignature ?? "No receipt"}</div>
            </article>
          );
        })}
        {latest && <pre style={{ whiteSpace: "pre-wrap" }}>{latest.responseJson.slice(0, 1200)}</pre>}
      </section>
    </div>
  );
}
