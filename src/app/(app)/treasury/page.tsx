import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownUp, ArrowUpRight, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { refreshAction } from "@/server/actions";
import { solscanAccount } from "@/solana/address";
import { getWorkspace } from "@/server/read";
import { TokenIcon } from "@/components/brand";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "@/domain/tokens";

export const dynamic = "force-dynamic";
export default async function TreasuryPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const { books, usdc, sol } = data;
  const payerConfigured = Boolean(books.payer.address) && books.payer.source !== "unconfigured";
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
  const usdcAccount = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(books.treasury.address), true).toBase58();
  return <div className="stack">
    <div className="page-heading"><div><p className="kicker">Assets & reserves</p><h1>Your treasury</h1><p>{payerConfigured ? "Two wallets. Clear boundaries. Every movement approved." : "Treasury wallet configured. Separate API payer not configured."}</p></div><div className="row"><ActionForm action={refreshAction}><button className="btn" type="submit"><RefreshCw size={14} aria-hidden="true" />Refresh</button></ActionForm><Link className="btn primary" href="/swap"><ArrowDownUp size={14} aria-hidden="true" />Swap assets</Link></div></div>
    <div className="two wallet-grid">{[books.treasury, books.payer].map((account) => {
      const treasury = account.kind === "treasury";
      const configured = Boolean(account.address) && account.source !== "unconfigured";
      const href = !configured || account.source === "demo" ? null : solscanAccount(account.address, cluster);
      return <section className="panel wallet-account" key={account.id}>
        <div className="wallet-account-heading"><div className="row"><Wallet size={17} className="accent-text" aria-hidden="true" /><h2 style={{ margin: 0, fontSize: 15 }}>{treasury ? "Treasury wallet" : "x402 API wallet"}</h2></div><span className={account.source === "demo" ? "badge amber" : "badge cyan"}>{!configured ? "NOT CONFIGURED" : account.source === "demo" ? "DEMO LEDGER" : account.source}</span></div>
        <p style={{ fontSize: 11 }}>{treasury ? "Holds SOL and USDC for owner-approved swaps and payroll." : configured ? "Dedicated USDC balance for separately approved Swap.io API payments." : "No API payer wallet is registered. Balance and spendable funds are unavailable."}</p>
        <div className="wallet-balances"><div className="wallet-balance-item"><TokenIcon symbol="SOL" /><div><small>Solana</small><div className="num">{configured ? sol(account.solAtomic) : "—"}</div></div></div><div className="wallet-balance-item"><TokenIcon symbol="USDC" /><div><small>USD Coin</small><div className="num">{configured ? usdc(account.usdcAtomic) : "—"}</div></div></div></div>
        <div className="treasury-address">{href ? <a href={href} target="_blank" rel="noreferrer">{account.address} <ArrowUpRight size={11} style={{ display: "inline" }} aria-hidden="true" /></a> : configured ? account.address : "Not configured"}</div>
        <div className="wallet-account-footer"><span>{!configured ? "Spendable unavailable" : treasury ? "Available " + usdc(books.ledger.availableUsdcAtomic) : "Spendable " + usdc(books.ledger.x402SpendableAtomic)}</span><span>{configured ? "Observed " + account.observedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "No RPC observation"}</span></div>
      </section>;
    })}</div>
    <section className="panel stack" style={{ overflowWrap: "anywhere" }}><h2>USDC account details</h2><div>Canonical USDC mint: <a href={solscanAccount(USDC_MINT, cluster) ?? undefined} target="_blank" rel="noreferrer">{USDC_MINT}</a></div><div>Derived treasury USDC token account: <a href={solscanAccount(usdcAccount, cluster) ?? undefined} target="_blank" rel="noreferrer">{usdcAccount}</a></div><p>This is the associated token account used for balance checks. A derived address does not prove the account exists; an unfunded wallet may not have created it yet.</p></section>
    <div className="grid-metrics"><article className="metric"><div className="kicker">Protected SOL reserve</div><div className="num">{sol(books.policy.minTreasurySolAtomic)}</div><p>Preserved before any treasury movement</p></article><article className="metric"><div className="kicker">Protected USDC reserve</div><div className="num">{usdc(books.policy.minTreasuryUsdcAtomic)}</div><p>Excluded from available payroll funding</p></article><article className="metric"><div className="kicker">Approved unpaid</div><div className="num">{usdc(books.obligations.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n))}</div><p>Approved obligations outside locked batches</p></article><article className="metric"><div className="kicker">Locked batches</div><div className="num">{usdc(books.commitments.reduce((sum, row) => sum + BigInt(row.amountAtomic), 0n))}</div><p>Already reserved against approved payroll</p></article></div>
    <section className="panel"><div className="section-heading"><h2>Reserves come first</h2><ShieldCheck size={18} className="accent-text" aria-hidden="true" /></div><p>Nothing moves between these wallets without an authorized transfer. Exact network fees and rent are checked when a transaction is built. The x402 API charge is a separate payment. USD valuation of SOL is unavailable.</p></section>
  </div>;
}
