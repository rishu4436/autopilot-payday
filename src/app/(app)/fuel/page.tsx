import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { FuelChart } from "@/components/charts";
import { refillAction } from "@/server/actions";
import { estimateCallCapacity } from "@/domain/money";
import { getWorkspace } from "@/server/read";

export const dynamic = "force-dynamic";

export default async function FuelPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const payerConfigured = Boolean(data.books.payer.address) && data.books.payer.source !== "unconfigured";
  const spent = data.calls.reduce((sum, call) => sum + (call.amountAtomic && call.receiptSignature ? BigInt(call.amountAtomic) : 0n), 0n);
  const capacity = payerConfigured ? estimateCallCapacity(data.books.ledger.x402SpendableAtomic, 3007n) : null;
  const points = data.calls.filter((call) => call.amountAtomic).map((call) => ({
    day: call.createdAt.toISOString().slice(0, 10),
    usdc: Number(call.amountAtomic) / 1_000_000,
    evidence: call.evidenceClass,
  }));
  return (
    <div className="stack">
      <p className="kicker">Agent fuel</p>
      <h1 style={{ margin: 0 }}>USDC for API calls, not SOL for network fees</h1>
      <p>The payer needs USDC because x402 settles in USDC and the facilitator pays the payment's network fee. A swap transaction is different: the treasury wallet pays its own SOL fee.</p>
      <div className="grid-metrics" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <article className="metric"><div className="kicker">Payer balance</div><div className="num" style={{ fontSize: 28, overflowWrap: "anywhere" }}>{payerConfigured ? data.usdc(data.books.payer.usdcAtomic) : "Not configured"}</div></article>
        <article className="metric"><div className="kicker">Minimum reserve</div><div className="num" style={{ fontSize: 28 }}>{data.usdc(data.books.policy.minX402UsdcAtomic)}</div></article>
        <article className="metric"><div className="kicker">Spendable</div><div className="num" style={{ fontSize: 28, overflowWrap: "anywhere" }}>{payerConfigured ? data.usdc(data.books.ledger.x402SpendableAtomic) : "Unavailable"}</div></article>
        <article className="metric"><div className="kicker">Recorded API spend</div><div className="num" style={{ fontSize: 28 }}>{data.usdc(spent)}</div></article>
      </div>
      <section className="panel">
        <p>Capacity estimate uses the captured quote floor of 0.003007 USDC and is not a guarantee. Calls remaining at that price: {capacity === null ? "unavailable" : capacity.toString()}.</p>
        <p>Refill threshold {data.usdc(data.books.policy.refillThresholdAtomic)}. Minimum refill {data.usdc(data.books.policy.minRefillAtomic)}. Maximum {data.usdc(data.books.policy.maxRefillAtomic)}. Cooldown {data.books.policy.refillCooldownMs / 3_600_000}h.</p>
      </section>
      <section className="panel">
        <h2>{payerConfigured ? "If the payer were empty" : "API payer not configured"}</h2>
        {payerConfigured ? <><p>{data.refill.reason}</p><p>{data.bootstrap}</p><p>This preview does not change balances. A direct transfer is offered only when treasury USDC is surplus to payroll.</p></> : <p>No API payer wallet is registered. Balance, capacity and refill checks are unavailable.</p>}
      </section>
      {data.books.org.mode === "demo" && data.session.role === "owner" && (
        <ActionForm className="panel row" action={refillAction}>
          <label className="field">USDC top-up<input name="amount" defaultValue="1" /></label>
          <button className="btn" type="submit">Propose demo refill</button>
        </ActionForm>
      )}
      <FuelChart points={points} />
    </div>
  );
}
