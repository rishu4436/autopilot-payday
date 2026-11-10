import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { shareAction } from "@/server/actions";
import { getWorkspace } from "@/server/read";
import { evidenceLabel, solscanTx } from "@/solana/address";

export const dynamic = "force-dynamic";

export default async function ProofPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  const batches = data.session.role === "contributor"
    ? data.books.batchRows.filter((batch) => data.books.items.some((item) => item.batchId === batch.id && data.books.tasks.some((task) => task.id === item.milestoneId && data.books.people.some((person) => person.id === task.contributorId && person.userId === data.session.userId))))
    : data.books.batchRows;
  return (
    <div className="stack">
      <p className="kicker">Proof of payday</p>
      <h1 style={{ margin: 0 }}>Three signatures, three meanings</h1>
      <p>An API receipt, a swap signature, and a payout signature are different transactions. Simulated records never become Solscan links.</p>
      {batches.map((batch) => {
        const payout = data.payouts.find((row) => row.batchId === batch.id);
        const href = payout?.signature ? solscanTx(payout.signature) : null;
        return (
          <article key={batch.id} className="panel stack">
            <div className="row">
              <Link href={`/proof/${batch.id}`}><strong>{batch.id.slice(0, 8)}</strong></Link>
              <span className="badge">{evidenceLabel(batch.evidenceClass)}</span>
              <span className="badge">{batch.status}</span>
            </div>
            <p>Total {data.usdc(batch.totalAtomic)}</p>
            <p>Payout {href ? <a href={href}>{payout?.signature}</a> : payout?.signature ?? "Not paid"}</p>
            {data.session.role === "owner" && (
              <ActionForm className="row" action={shareAction}>
                <input type="hidden" name="id" value={batch.id} />
                <label><input type="checkbox" name="includeAddresses" /> Include addresses</label>
                <button className="btn" type="submit">Create read-only link</button>
              </ActionForm>
            )}
          </article>
        );
      })}
      {data.shares.length > 0 && data.session.role !== "contributor" && (
        <section className="panel">
          <h2>Share links</h2>
          {data.shares.map((share) => <p key={share.id}><Link href={`/p/${share.token}`}>/p/{share.token}</Link> · addresses {share.includeAddresses ? "visible" : "masked"} · until {share.expiresAt.toISOString()}</p>)}
        </section>
      )}
    </div>
  );
}
