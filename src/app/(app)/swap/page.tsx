import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDownUp, ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react";
import { TokenIcon } from "@/components/brand";
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
      <div className="page-heading"><div><p className="kicker">Treasury execution</p><h1>Swap assets</h1><p>Fund your next payday. Keep control of every step.</p></div><span className="badge cyan">SOLANA · SOL / USDC</span></div>
      <p>{data.books.org.mode === "demo" ? "SIMULATED quotes are fixture data, never market prices. The 1 SOL to 90 USDC demo route has no market meaning." : "Swap.io provides the quote and unsigned build. Review, approve and sign the exact transaction with the treasury wallet. Only independently verified finality is settlement."}</p>
      <div className="swap-layout">
        {data.books.org.mode !== "demo" && data.session.role === "owner" ? <TreasuryWallet kind="swap" treasury={data.books.treasury.address} submissionEnabled={treasuryExecutionEnabled() && data.books.org.mode === "live" && data.books.org.liveEnabled && process.env.APP_MODE === "live"} /> : <section className="panel stack swap-terminal"><div className="section-heading"><h2>SOL to USDC</h2><ArrowDownUp size={19} className="accent-text" aria-hidden="true" /></div><div className="token-pair"><div className="token-amount-box"><div className="kicker">Input asset</div><span className="token-name"><TokenIcon symbol="SOL" small />SOL</span></div><div className="swap-direction"><ArrowRight size={15} aria-hidden="true" /></div><div className="token-amount-box"><div className="kicker">Output asset</div><span className="token-name"><TokenIcon symbol="USDC" small />USDC</span></div></div><p>{data.books.org.mode === "demo" ? "No live trade is available in this simulated workspace. Run a funding analysis to explore the approval flow." : "Treasury execution is available to the wallet-authenticated owner."}</p><Link className="btn primary" href="/agent">{data.books.org.mode === "demo" ? "Open funding workflow" : "View agent activity"}<ArrowUpRight size={13} aria-hidden="true" /></Link></section>}
        <div className="stack"><section className="panel"><div className="section-heading"><h2>Built around your approval</h2><ShieldCheck size={17} className="accent-text" aria-hidden="true" /></div><div className="policy-stat"><span>Quote & build</span><strong>Swap.io</strong></div><div className="policy-stat"><span>Supported live route</span><strong>Raydium CPMM</strong></div><div className="policy-stat"><span>Live input ceiling</span><strong>0.01 SOL</strong></div><div className="policy-stat"><span>Live slippage ceiling</span><strong>50 bps</strong></div><p style={{ fontSize: 10, marginTop: 18 }}>A lower policy limit still applies. The exact message is inspected and simulated before your wallet signs.</p></section><section className="panel stack"><span className="kicker">Three different receipts</span><p style={{ fontSize: 11 }}>An API payment buys the quote or build. Your treasury signature executes the swap. A separate payout sends USDC to contributors.</p><p style={{ fontSize: 11 }}>Only finalized, independently verified transactions become settlement receipts.</p><Link className="btn text-button" href="/proof">View proof of payday <ArrowUpRight size={13} aria-hidden="true" /></Link></section></div>
      </div>
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
