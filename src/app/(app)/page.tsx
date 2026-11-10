import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { analyzeAction } from "@/server/actions";
import { FlowMap, Replay } from "@/components/visuals";
import { getWorkspace } from "@/server/read";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MissionPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const { books, usdc } = data;
  const metrics = [
    ["Treasury USDC", usdc(books.ledger.availableUsdcAtomic), "Available after reserve and locked batches"],
    ["Approved unpaid", usdc(books.obligations.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n)), "Not counted twice inside a locked batch"],
    ["API reserve", usdc(books.payer.usdcAtomic), `Protected minimum ${usdc(books.policy.minX402UsdcAtomic)}`],
    ["Shortfall", usdc(books.ledger.shortfallAtomic), "USDC still needed before payroll"],
    ["Next payday", data.nextDue, "Earliest approved due date"],
    ["Agent", books.openOperation?.state ?? "IDLE", books.policy.paused ? "Paused" : books.policy.executionMode],
  ];
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <p className="kicker">Mission control</p>
          <h1 style={{ margin: 0 }}>Payday is a funding problem before it is a payment.</h1>
        </div>
        <div className="row">
          <Link className="btn amber" href="/agent">Review pending actions</Link>
        </div>
      </div>
      <div className="grid-metrics">
        {metrics.map(([label, value, hint]) => (
          <article key={label} className="metric">
            <div className="kicker">{label}</div>
            <div className="num" style={{ fontSize: 28 }} data-testid={label === "Shortfall" ? "funding-shortfall" : undefined}>{value}</div>
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>{hint}</p>
          </article>
        ))}
      </div>
      <FlowMap tones={data.flow} demo={books.org.mode === "demo"} />
      <div className="two">
        <section className="panel stack">
          <div className="kicker">Run funding analysis</div>
          <p>The SOL amount is what you want quoted. The app does not invent an exchange rate. USD value of SOL is unavailable.</p>
          {data.session.role !== "auditor" && <ActionForm className="row" action={analyzeAction}>
            <label className="field">SOL to quote
              <input name="sol" placeholder="1" inputMode="decimal" />
            </label>
            <button className="btn primary" type="submit">Run funding analysis</button>
          </ActionForm>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Contributor</th><th>Work</th><th>USDC</th><th>Due</th><th>Payment</th></tr></thead>
              <tbody>
                {books.obligations.map((row) => (
                  <tr key={row.id}>
                    <td>{data.personName(row.contributorId)}</td>
                    <td>{row.title}</td>
                    <td className="num">{usdc(row.amountAtomic)}</td>
                    <td>{row.dueOn}</td>
                    <td>{row.paymentStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <Replay items={data.decisions.slice(0, 8).map((row) => ({
          id: row.id,
          at: row.createdAt.toISOString(),
          kind: row.kind,
          code: row.code,
          reason: row.reason,
          next: row.nextAction,
          observed: row.observed,
        }))} />
      </div>
      <div className="two">
        <section className="panel">
          <div className="kicker">Recent x402 calls</div>
          {data.calls.slice(0, 4).map((call) => (
            <p key={call.id}><span className="badge">{call.evidenceClass}</span> {call.endpoint} {call.amountAtomic ? usdc(call.amountAtomic) : "no charge"}</p>
          ))}
        </section>
        <section className="panel">
          <div className="kicker">Spending limits</div>
          <p>Per call {usdc(books.policy.perCallMaxAtomic)} · Daily {usdc(books.policy.dailyApiLimitAtomic)}</p>
          <p>Slippage ceiling {books.policy.slippageCeilingBps} bps · Quote age {books.policy.maxQuoteAgeMs / 1000}s</p>
          <p>Scoped automation is off. Every swap and payout needs a person.</p>
        </section>
      </div>
    </div>
  );
}
