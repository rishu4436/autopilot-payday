import { redirect } from "next/navigation";
import { TreasuryWallet } from "@/components/treasury-wallet";
import { treasuryExecutionEnabled } from "@/server/live-treasury";
import { getWorkspace } from "@/server/read";
import { evidenceLabel, solscanTx } from "@/solana/address";

export const dynamic = "force-dynamic";

export default async function SwapPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  return (
    <div className="stack">
      <p className="kicker">Swap execution</p>
      <h1 style={{ margin: 0 }}>Review the route, then sign</h1>
      <p>{data.books.org.mode === "demo" ? "SIMULATED quotes are fixture data, never market prices. The 1 SOL to 90 USDC demo route has no market meaning." : "Swap.io provides the quote and unsigned build. Review, approve and sign the exact transaction with the treasury wallet. Only independently verified finality is settlement."}</p>
      {data.quotes.length === 0 && <section className="panel">{data.books.org.mode === "demo" ? "No quote has been purchased." : "Import a verified Swap.io build bundle to prepare a live route."}</section>}
      {data.books.org.mode !== "demo" && data.session.role === "owner" && <TreasuryWallet kind="swap" treasury={data.books.treasury.address} submissionEnabled={treasuryExecutionEnabled() && data.books.org.mode === "live" && data.books.org.liveEnabled && process.env.APP_MODE === "live"} />}
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
    </div>
  );
}
