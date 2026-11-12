import { ArrowUpRight, ListChecks, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { batchAction, batchDecisionAction, partialAction, payoutAction } from "@/server/actions";
import { TreasuryWallet } from "@/components/treasury-wallet";
import { treasuryExecutionEnabled } from "@/server/live-treasury";
import { getWorkspace } from "@/server/read";
import { REFERENCE_SIGNATURE_FEE_LAMPORTS, REFERENCE_TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/domain/tokens";
import { formatAtomic } from "@/domain/money";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const payable = data.books.obligations.filter((row) => !data.books.items.some((item) => item.milestoneId === row.id));
  const reference = formatAtomic(REFERENCE_SIGNATURE_FEE_LAMPORTS + REFERENCE_TOKEN_ACCOUNT_RENT_LAMPORTS, 9);
  return (
    <div className="stack">
      <div className="page-heading"><div><p className="kicker">From approved work to paid work</p><h1>Contributor payroll</h1><p>One payment for each approved obligation. Every recipient reviewed.</p></div><Link className="btn" href="/milestones">Manage milestones <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
      <p>Available {data.usdc(data.books.ledger.availableUsdcAtomic)}. Shortfall {data.usdc(data.books.ledger.shortfallAtomic)}. Reference network cost {reference} SOL per new token account, labeled as a protocol figure in demo. Live mode fetches rent from RPC when a transaction is built.</p>
      {data.session.role !== "auditor" && (
        <ActionForm className="panel stack" action={batchAction}>
          <div className="section-heading" style={{ marginBottom: 0 }}><div><span className="kicker">01 · Select obligations</span><h2>Create a batch from approved milestones</h2></div><ListChecks size={19} className="accent-text" aria-hidden="true" /></div>
          {payable.map((row) => (
            <label key={row.id} className="payroll-selection"><input type="checkbox" name="milestoneId" value={row.id} /><span className="person-avatar" aria-hidden="true">{data.personName(row.contributorId).slice(0, 1)}</span><span><strong>{data.personName(row.contributorId)}</strong><small>{row.title}</small></span><span className="num">{data.usdc(row.amountAtomic)}</span></label>
          ))}
          {payable.length === 0 && <div className="empty-state"><ShieldCheck size={27} aria-hidden="true" /><strong>No unlocked approved milestones.</strong><p>Approve completed work in Milestones, then return here to prepare payroll.</p></div>}
          <button className="btn primary" type="submit" disabled={payable.length === 0}>Draft batch</button>
        </ActionForm>
      )}
      {data.books.batchRows.map((batch) => {
        const items = data.books.items.filter((item) => item.batchId === batch.id);
        return (
          <section key={batch.id} className="panel stack">
            <div className="row"><strong>Batch {batch.id.slice(0, 8)}</strong><span className="badge">{batch.evidenceClass}</span><span className="badge">{batch.status}</span></div>
            <p>Total {data.usdc(batch.totalAtomic)}. Authorization {batch.proposalHash ? "bound to this exact list" : "not signed"}.</p>
            <ul>{items.map((item) => <li key={item.id}>{item.recipient.slice(0, 4)}…{item.recipient.slice(-4)} · {data.usdc(item.amountAtomic)} · {item.status}</li>)}</ul>
            {batch.status === "DRAFT" && data.session.role !== "auditor" && (
              <div className="row">
                <ActionForm action={batchDecisionAction}><input type="hidden" name="id" value={batch.id} /><input type="hidden" name="decision" value="approved" /><button className="btn mint" type="submit">Authorize</button></ActionForm>
                <ActionForm action={batchDecisionAction}><input type="hidden" name="id" value={batch.id} /><input type="hidden" name="decision" value="rejected" /><button className="btn" type="submit">Reject</button></ActionForm>
              </div>
            )}
            {batch.status === "APPROVED" && data.books.org.mode === "demo" && data.session.role !== "auditor" && (
              <div className="row">
                <ActionForm action={payoutAction}><input type="hidden" name="id" value={batch.id} /><button className="btn primary" type="submit">Record simulated payout</button></ActionForm>
                <ActionForm action={partialAction}><input type="hidden" name="id" value={batch.id} /><button className="btn amber" type="submit">Demo partial failure</button></ActionForm>
              </div>
            )}
            {data.books.org.mode !== "demo" && batch.evidenceClass !== "simulated" && data.session.role === "owner" && ["APPROVED", "PARTIAL", "UNKNOWN", "CONFIRMING", "CONFIRMED"].includes(batch.status) && <TreasuryWallet kind="payout" batchId={batch.id} treasury={data.books.treasury.address} canPrepare={batch.status !== "CONFIRMED"} submissionEnabled={treasuryExecutionEnabled() && data.books.org.mode === "live" && data.books.org.liveEnabled && process.env.APP_MODE === "live"} />}
          </section>
        );
      })}
    </div>
  );
}
