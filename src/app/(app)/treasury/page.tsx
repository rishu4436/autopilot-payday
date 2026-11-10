import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { refreshAction } from "@/server/actions";
import { solscanAccount } from "@/solana/address";
import { getWorkspace } from "@/server/read";

export const dynamic = "force-dynamic";

export default async function TreasuryPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const { books, usdc, sol } = data;
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
  const cards = [
    ["Treasury SOL", sol(books.treasury.solAtomic), books.treasury.address],
    ["Treasury USDC", usdc(books.treasury.usdcAtomic), "Available " + usdc(books.ledger.availableUsdcAtomic)],
    ["API payer USDC", usdc(books.payer.usdcAtomic), "Spendable " + usdc(books.ledger.x402SpendableAtomic)],
    ["SOL reserve", sol(books.policy.minTreasurySolAtomic), "Safe to quote " + sol(books.ledger.safeSolAtomic)],
  ];
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <p className="kicker">Treasury</p>
          <h1 style={{ margin: 0 }}>Two wallets, two jobs</h1>
        </div>
        <ActionForm action={refreshAction}><button className="btn" type="submit">Refresh</button></ActionForm>
      </div>
      <p>The treasury wallet holds SOL and USDC. The API wallet holds USDC for x402 only. Nothing moves between them without an authorized transfer. USD valuation is unavailable.</p>
      <div className="grid-metrics" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        {cards.map(([label, value, hint]) => (
          <article key={label} className="metric"><div className="kicker">{label}</div><div className="num" style={{ fontSize: 28 }}>{value}</div><p>{hint}</p></article>
        ))}
      </div>
      <section className="panel table-wrap">
        <table>
          <thead><tr><th>Wallet</th><th>Address</th><th>Source</th><th>Observed</th></tr></thead>
          <tbody>
            {[books.treasury, books.payer].map((account) => {
              const href = account.source === "demo" ? null : solscanAccount(account.address, cluster);
              return (
                <tr key={account.id}>
                  <td>{account.kind}</td>
                  <td>{href ? <a href={href}>{account.address}</a> : account.address}</td>
                  <td><span className="badge">{account.source === "demo" ? "DEMO LEDGER" : account.source}</span></td>
                  <td>{account.observedAt.toISOString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Commitments</h2>
        <p>Approved unpaid {usdc(books.obligations.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n))}.</p>
        <p>Locked batches {usdc(books.commitments.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n))}.</p>
        <p>Network fee estimate is unavailable until a transaction is built. The x402 micropayment is not that fee.</p>
      </section>
    </div>
  );
}
