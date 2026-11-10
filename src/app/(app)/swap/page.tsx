import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { signedSwapAction } from "@/server/actions";
import { getWorkspace } from "@/server/read";
import { evidenceLabel, solscanTx } from "@/solana/address";

export const dynamic = "force-dynamic";

export default async function SwapPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const ready = data.swaps.find((row) => row.status === "ready" && row.unsignedTx);
  return (
    <div className="stack">
      <p className="kicker">Swap execution</p>
      <h1 style={{ margin: 0 }}>Review the route, then sign</h1>
      <p>Live swaps and payouts are disabled pending instruction validation and durable reconciliation. SIMULATED quotes are fixture data, never market prices. The 1 SOL to 90 USDC demo route has no market meaning.</p>
      {data.quotes.length === 0 && <section className="panel">No quote has been purchased.</section>}
      {data.quotes.map((quote) => (
        <article key={quote.id} className="panel">
          <div className="row">
            <strong>{quote.providerKey}</strong>
            <span className="badge">{evidenceLabel(quote.evidenceClass)}</span>
            {quote.selected && <span className="badge cyan">Selected</span>}
          </div>
          <p>Input {data.sol(quote.inputAtomic)} · Minimum output {quote.minOutAtomic ? data.usdc(quote.minOutAtomic) : "missing, execution blocked"} · Slippage {quote.slippageBps} bps</p>
          <p>Price impact {quote.priceImpact ?? "not provided"} · Expires {quote.expiresAt.toISOString()}</p>
          <p>Output amount {quote.outputAtomic ? data.usdc(quote.outputAtomic) : "not provided"}.</p>
        </article>
      ))}
      {data.swaps.map((swap) => {
        const href = swap.signature ? solscanTx(swap.signature) : null;
        return (
          <article key={swap.id} className="panel">
            <span className="badge">{evidenceLabel(swap.evidenceClass)}</span> {swap.status}
            <p>{swap.detail}</p>
            <p>{href ? <a href={href}>{swap.signature}</a> : swap.signature ?? "No signature yet"}</p>
          </article>
        );
      })}
      {ready && data.books.org.mode === "live" && (
        <ActionForm className="panel stack" action={signedSwapAction}>
          <p>Paste is not accepted. Use the connected treasury wallet from the swap authorization screen after the unsigned transaction is stored. This field is for the signed payload produced by that wallet.</p>
          <textarea name="signed" required placeholder="Signed transaction base64" />
          <button className="btn primary" type="submit">Broadcast signed swap</button>
        </ActionForm>
      )}
    </div>
  );
}
