import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { ArrowDownUp, ArrowRight, ArrowUpRight, CalendarDays, CircleDollarSign, Fuel, ListChecks, ShieldCheck, Wallet, Zap } from "lucide-react";
import { analyzeAction } from "@/server/actions";
import { FlowMap, Replay } from "@/components/visuals";
import { TokenIcon } from "@/components/brand";
import { getWorkspace } from "@/server/read";
import { redirect } from "next/navigation";
import { formatAtomic } from "@/domain/money";

export const dynamic = "force-dynamic";
export default async function MissionPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const { books, usdc } = data;
  const payerConfigured = Boolean(books.payer.address) && books.payer.source !== "unconfigured";
  const testOnly = books.org.mode === "uat_readonly";
  const metrics = [
    { label: "Available USDC", value: usdc(books.ledger.availableUsdcAtomic), hint: "After reserves and locked batches", icon: Wallet },
    { label: "Approved unpaid", value: usdc(books.obligations.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n)), hint: `${books.obligations.length} approved obligations`, icon: ListChecks },
    { label: "Shortfall", value: usdc(books.ledger.shortfallAtomic), hint: "Funding needed before payroll", icon: CircleDollarSign },
    { label: "API reserve", value: payerConfigured ? usdc(books.payer.usdcAtomic) : "Not configured", hint: payerConfigured ? `Protected minimum ${usdc(books.policy.minX402UsdcAtomic)}` : "No API payer wallet registered", icon: Fuel },
  ];
  return <div className="stack">
    <div className="page-heading"><div><p className="kicker">Your workspace</p><h1>Treasury overview</h1><p>Every balance, obligation and approval. One clear view.</p></div><Link className="btn" href="/agent">Review pending actions <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
    <section className="overview-hero" aria-label="Treasury summary">
      <div className="balance-hero"><div className="row"><span className="balance-title">Treasury USDC balance</span><span className={books.org.mode === "demo" ? "badge amber" : "badge cyan"}>{books.org.mode === "demo" ? "SIMULATED BALANCE" : "RECORDED BALANCE"}</span></div>
        <div className="hero-balance">{formatAtomic(BigInt(books.treasury.usdcAtomic), 6)}<small>USDC</small></div>
        <div className="hero-token-row"><span><TokenIcon symbol="SOL" small />{data.sol(books.treasury.solAtomic)}</span><span><TokenIcon symbol="USDC" small />Reserve {usdc(books.policy.minTreasuryUsdcAtomic)}</span><span><CalendarDays size={13} aria-hidden="true" />Next payday: {data.nextDue}</span></div>
        <div className="hero-actions"><Link className="btn primary" href="/swap"><ArrowDownUp size={14} aria-hidden="true" />Swap & fund</Link><Link className="btn" href="/payroll">Open payroll <ArrowRight size={14} aria-hidden="true" /></Link></div>
      </div>
      <div className="hero-aside"><div className="hero-action-icon"><Zap size={18} aria-hidden="true" /></div><div className="kicker">{books.ledger.shortfallAtomic > 0n ? "Funding attention" : "Funding coverage"}</div><h2>{usdc(books.ledger.shortfallAtomic)}</h2><p>{books.ledger.shortfallAtomic > 0n ? "Still needed to cover approved obligations." : "No current funding shortfall in the recorded ledger."}</p><Link className="btn text-button" href="/treasury">View treasury <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
    </section>
    <div className="grid-metrics">{metrics.map(({ label, value, hint, icon: Icon }) => <article key={label} className="metric"><div className="metric-heading"><span className="kicker">{label}</span><Icon size={15} strokeWidth={1.5} aria-hidden="true" /></div><div className="num" style={{ overflowWrap: "anywhere" }} data-testid={label === "Shortfall" ? "funding-shortfall" : undefined}>{value}</div><p>{hint}</p></article>)}</div>
    <FlowMap tones={data.flow} demo={books.org.mode === "demo"} />
    <div className="two">
      <section className="panel stack"><div className="section-heading" style={{ marginBottom: 0 }}><div><div className="kicker">Team commitments</div><h2>Upcoming obligations</h2></div><Link className="btn text-button" href="/milestones">View all <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
        <div className="table-wrap"><table><thead><tr><th>Contributor</th><th>Work</th><th>USDC</th><th>Due</th><th>Payment</th></tr></thead><tbody>{books.obligations.map((row) => <tr key={row.id}><td><span className="table-name"><span className="person-avatar" aria-hidden="true">{data.personName(row.contributorId).slice(0, 1)}</span>{data.personName(row.contributorId)}</span></td><td className="obligation-title">{row.title}</td><td className="num">{usdc(row.amountAtomic)}</td><td>{row.dueOn}</td><td><span className="badge amber">{row.paymentStatus}</span></td></tr>)}</tbody></table></div>
        {books.obligations.length === 0 && <div className="empty-state"><ListChecks size={25} aria-hidden="true" /><strong>No unlocked obligations</strong><p>Approved milestones appear here when they are ready for payroll.</p><Link className="btn" href="/milestones">Open milestones</Link></div>}
      </section>
      <section className="panel"><div className="section-heading"><div><div className="kicker">Built-in guardrails</div><h2>Your treasury policy</h2></div><ShieldCheck size={18} className="accent-text" aria-hidden="true" /></div><div className="policy-stat"><span>API charge per call</span><strong>{usdc(books.policy.perCallMaxAtomic)}</strong></div><div className="policy-stat"><span>Daily API limit</span><strong>{usdc(books.policy.dailyApiLimitAtomic)}</strong></div><div className="policy-stat"><span>Slippage ceiling</span><strong>{books.policy.slippageCeilingBps} bps</strong></div><div className="policy-stat"><span>Maximum quote age</span><strong>{books.policy.maxQuoteAgeMs / 1000}s</strong></div><div className="policy-stat"><span>Execution</span><span className={testOnly ? "badge cyan" : "badge mint"}>{testOnly ? "TEST READ-ONLY" : books.policy.paused ? "PAUSED" : "OWNER APPROVAL"}</span></div><p style={{ fontSize: 10, marginTop: 17 }}>{testOnly ? "Financial execution cannot be enabled in this test workspace." : "Scoped automation is off. Every swap and payout needs a person."}</p></section>
    </div>
    <div className="two">
      <section className="panel stack"><div className="section-heading" style={{ marginBottom: 0 }}><div><div className="kicker">Plan before you sign</div><h2>Run funding analysis</h2></div><span className="badge">{books.openOperation?.state ?? "IDLE"}</span></div><p style={{ fontSize: 11 }}>Enter the SOL amount to quote. Analysis prepares the next step; it does not move funds. USD valuation is unavailable.</p>{data.session.role !== "auditor" && <ActionForm className="row" action={analyzeAction}><label className="field" style={{ flex: 1 }}>SOL to quote<input name="sol" placeholder={books.org.mode === "demo" ? "1" : "0.001"} inputMode="decimal" /></label><button className="btn primary" type="submit" style={{ alignSelf: "end" }}>Run funding analysis</button></ActionForm>}</section>
      <Replay items={data.decisions.slice(0, 8).map((row) => ({ id: row.id, at: row.createdAt.toISOString(), kind: row.kind, code: row.code, reason: row.reason, next: row.nextAction, observed: row.observed }))} />
    </div>
    {data.calls.length > 0 && <section className="panel"><div className="section-heading"><h2>Recent x402 activity</h2><Link className="btn text-button" href="/x402">Open explorer <ArrowUpRight size={13} aria-hidden="true" /></Link></div>{data.calls.slice(0, 4).map((call) => <div className="policy-stat" key={call.id}><span className="badge">{call.evidenceClass}</span><span>{call.endpoint}</span><strong>{call.amountAtomic ? usdc(call.amountAtomic) : "No charge"}</strong></div>)}</section>}
  </div>;
}
