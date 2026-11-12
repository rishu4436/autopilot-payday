import Link from "next/link";
import { ArrowDownUp, ArrowUpRight, Fingerprint, LockKeyhole, ShieldCheck, Users, Wallet } from "lucide-react";
import { loginDemoAction } from "@/server/actions";
import { WalletLogin } from "@/components/wallet-login";
import { BrandMark, TokenIcon } from "@/components/brand";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  const demo = (process.env.APP_MODE || "demo") === "demo";
  return <main className="auth-layout">
    <section className="auth-story" aria-label="About Autopilot Payday">
      <Link className="brand" href="/login" aria-label="Autopilot Payday"><BrandMark /><span className="brand-wordmark">payday<span className="brand-dot">.</span><small>by Autopilot</small></span></Link>
      <div className="auth-story-content">
        <div className="auth-eyebrow"><span className="status-dot" />Treasury operations on Solana</div>
        <h1>Your treasury.<br />Your team.<br /><span>Your call.</span></h1>
        <p className="auth-description">From funding the next milestone to settling payday. One workspace for your treasury, swaps and contributor payouts. Every transaction stays in your hands.</p>
        <div className="auth-orbit" aria-label="Treasury to swap to team, an illustration of the approval flow">
          <div className="auth-orbit-node"><TokenIcon symbol="SOL" /><span>Your treasury</span></div>
          <div className="auth-orbit-node center"><ArrowDownUp size={32} strokeWidth={1.3} aria-hidden="true" /><span>Owner-approved swap</span></div>
          <div className="auth-orbit-node"><Users size={27} strokeWidth={1.3} aria-hidden="true" /><span>Your contributors</span></div>
        </div>
        <div className="auth-benefits"><span><ShieldCheck size={14} aria-hidden="true" />Wallet-owned treasury</span><span><Fingerprint size={14} aria-hidden="true" />Exact approvals</span><span><ArrowUpRight size={14} aria-hidden="true" />On-chain receipts</span></div>
      </div>
      <div className="auth-story-footer"><span>Built for teams that build on-chain.</span><span>Powered by Solana + Swap.io</span></div>
    </section>
    <section className="auth-form-side" aria-label="Sign in to your workspace">
      <div className="auth-form-content">
        <div className="row"><span className={demo ? "badge amber" : "badge cyan"}>{demo ? "DEMO WORKSPACE" : process.env.APP_MODE === "live" ? "MAINNET WORKSPACE" : "LIVE READ-ONLY"}</span></div>
        <h2>Welcome to payday.</h2>
        <p>Connect your treasury wallet to open your workspace.</p>
        <div className="auth-wallet-card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}><h3 style={{ margin: 0 }}>Wallet sign-in</h3><Wallet size={19} className="muted" aria-hidden="true" /></div>
          <p>Connect Phantom or Solflare, then sign a one-time message to verify ownership.</p>
          <WalletLogin />
        </div>
        <div className="auth-note"><LockKeyhole size={14} aria-hidden="true" /><span>Signing in costs nothing and authorizes no transfer. Swaps and payouts require a separate approval and transaction signature.</span></div>
        {!demo && <div className="auth-setup">First time here? Your wallet must belong to a provisioned workspace. <a href="https://github.com/rishu4436/autopilot-payday/blob/main/VERCEL-LIVE-DEMO.md" target="_blank" rel="noreferrer">Workspace setup guide <ArrowUpRight size={11} style={{ display: "inline" }} aria-hidden="true" /></a></div>}
        {demo && <section className="demo-section" aria-label="Demo access"><div className="row" style={{ justifyContent: "space-between" }}><span className="kicker">Or explore the demo</span><span className="muted" style={{ fontSize: 9 }}>Simulated funds only</span></div><div className="demo-role-grid">{([["owner", "Owner"], ["approver", "Approver"], ["contributor", "Maya"], ["auditor", "Auditor"]] as const).map(([role, label]) => <form key={role} action={loginDemoAction} className="demo-role"><strong>{label}</strong><button className="btn" type="submit" data-testid={`login-${role}`}>Enter</button><input type="hidden" name="role" value={role} /></form>)}</div></section>}
        <p className="auth-copyright">Autopilot Payday · Your wallet. Your approvals. Your receipts.</p>
      </div>
    </section>
  </main>;
}
