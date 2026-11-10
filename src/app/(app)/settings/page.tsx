import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { modeAction, policyAction, walletRegisterAction } from "@/server/actions";
import { formatAtomic } from "@/domain/money";
import { getWorkspace } from "@/server/read";
import { signerReady } from "@/server/hermes";
import { rpcUrl } from "@/server/chain";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const policy = data.books.policy;
  const owner = data.session.role === "owner";
  return (
    <div className="stack">
      <p className="kicker">Settings and security</p>
      <h1 style={{ margin: 0 }}>The owner holds the keys. The agent holds a checklist.</h1>
      <section className="panel">
        <p>Web payments, live swaps and payouts are disabled by the audit. The local paid quote procedure requires a separate approved plan. Signer {signerReady() ? "configured" : "not connected to this app"}. RPC host is server-side.</p>
        <p>Current RPC configured: {rpcUrl().startsWith("http") ? "set" : "missing"}. Cluster {process.env.SOLANA_CLUSTER || "mainnet-beta"}.</p>
      </section>
      {owner && (
        <ActionForm className="panel stack" action={modeAction}>
          <label className="field">Mode
            <select name="mode" defaultValue={data.books.org.mode}>
              <option value="demo">Demo ledger</option>
              <option value="live_readonly">Live read-only</option>
              <option value="live">Live authorized</option>
            </select>
          </label>
          <label><input type="checkbox" name="liveEnabled" /> Also arm live money movement</label>
          <button className="btn" type="submit">Save mode</button>
        </ActionForm>
      )}
      {owner ? (
        <ActionForm className="panel stack" action={policyAction}>
          <div className="two">
            <Field name="agentName" label="Agent name" defaultValue={policy.agentName} />
            <Field name="purpose" label="Purpose" defaultValue={policy.purpose} />
            <Field name="minSol" label="Minimum SOL reserve" defaultValue={formatAtomic(BigInt(policy.minTreasurySolAtomic), 9)} />
            <Field name="minUsdc" label="Minimum treasury USDC" defaultValue={formatAtomic(BigInt(policy.minTreasuryUsdcAtomic), 6)} />
            <Field name="minX402" label="Minimum API reserve" defaultValue={formatAtomic(BigInt(policy.minX402UsdcAtomic), 6)} />
            <Field name="threshold" label="Refill threshold" defaultValue={formatAtomic(BigInt(policy.refillThresholdAtomic), 6)} />
            <Field name="minRefill" label="Minimum refill" defaultValue={formatAtomic(BigInt(policy.minRefillAtomic), 6)} />
            <Field name="maxRefill" label="Maximum refill" defaultValue={formatAtomic(BigInt(policy.maxRefillAtomic), 6)} />
            <Field name="perCall" label="Per-call API max" defaultValue={formatAtomic(BigInt(policy.perCallMaxAtomic), 6)} />
            <Field name="daily" label="Daily API max" defaultValue={formatAtomic(BigInt(policy.dailyApiLimitAtomic), 6)} />
            <Field name="approverMax" label="Approver max USDC" defaultValue={formatAtomic(BigInt(policy.approverMaxAtomic), 6)} />
            <Field name="slippage" label="Slippage ceiling bps" defaultValue={String(policy.slippageCeilingBps)} />
            <Field name="quoteAge" label="Max quote age seconds" defaultValue={String(policy.maxQuoteAgeMs / 1000)} />
            <Field name="margin" label="Funding margin bps" defaultValue={String(policy.marginBps)} />
            <label className="field">Execution
              <select name="executionMode" defaultValue={policy.executionMode}>
                <option value="simulation">Simulation</option>
                <option value="observe">Observe only</option>
                <option value="approval_required">Approval required</option>
              </select>
            </label>
          </div>
          <button className="btn primary" type="submit">Save policy version</button>
        </ActionForm>
      ) : <section className="panel">Policy edits are limited to the owner. You can read version {policy.version}.</section>}
      {owner && data.session.authMode === "wallet" && (
        <ActionForm className="panel stack" action={walletRegisterAction}>
          <label className="field">Member
            <select name="userId">
              <option value="user_owner">Owner</option>
              <option value="user_approver">Approver</option>
              <option value="user_maya">Maya</option>
              <option value="user_auditor">Auditor</option>
            </select>
          </label>
          <Field name="address" label="Sign-in wallet" defaultValue="" />
          <button className="btn" type="submit">Register sign-in wallet</button>
        </ActionForm>
      )}
      <section className="panel">
        <h2>Recent audit</h2>
        {data.audits.slice(0, 8).map((row) => <p key={row.id}>{row.createdAt.toISOString()} · {row.action} · {row.entity}</p>)}
      </section>
    </div>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return <label className="field">{label}<input name={name} defaultValue={defaultValue} /></label>;
}
