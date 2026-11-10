import { loginDemoAction } from "@/server/actions";
import { WalletLogin } from "@/components/wallet-login";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return (
    <main className="main" style={{ maxWidth: 880, margin: "0 auto" }}>
      <p className="kicker">Autopilot Payday</p>
      <h1 className="num" style={{ fontSize: 56, margin: "8px 0" }}>Financial mission control</h1>
      <p style={{ color: "var(--muted)", maxWidth: 620 }}>
        Your team finishes the work. The treasury agent prices the funding gap and prepares payday. It does not move money until a person authorizes that exact action.
      </p>
      {(process.env.APP_MODE || "demo") === "demo" && <div className="grid-metrics" style={{ marginTop: 24 }}>
        {([
          ["owner", "Owner"],
          ["approver", "Approver"],
          ["contributor", "Maya"],
          ["auditor", "Auditor"],
        ] as const).map(([role, label]) => (
          <form key={role} action={loginDemoAction} className="panel stack">
            <input type="hidden" name="role" value={role} />
            <span className="kicker">Demo sign-in</span>
            <strong>{label}</strong>
            <button className="btn primary" type="submit" data-testid={`login-${role}`}>Enter</button>
          </form>
        ))}
      </div>}
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Wallet sign-in</h2>
        <p style={{ color: "var(--muted)" }}>A connected wallet is not a session until it signs a one-time challenge. Unknown wallets are refused.</p>
        <WalletLogin />
      </section>
    </main>
  );
}
