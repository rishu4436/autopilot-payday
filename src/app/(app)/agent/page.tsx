import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { cancelAction, pauseAction, quoteAction, settleSwapAction, swapAction } from "@/server/actions";
import { Replay } from "@/components/visuals";
import { recoveryFor } from "@/domain/recovery";
import { getWorkspace } from "@/server/read";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const data = await getWorkspace();
  if (!data) redirect("/login");
  if (data.session.role === "contributor") redirect("/milestones");
  const operation = data.books.openOperation;
  const recovery = operation ? recoveryFor(operation.state === "BLOCKED" ? "AGENT_PAUSED" : "TX_PENDING") : null;
  return (
    <div className="stack" id="approvals">
      <p className="kicker">Agent studio</p>
      <h1 style={{ margin: 0 }}>{data.books.policy.agentName}</h1>
      <p>{data.books.policy.purpose}</p>
      <div className="row">
        <span className="badge">{data.books.policy.executionMode}</span>
        <span className="badge">{data.books.policy.paused ? "Paused" : "Enabled"}</span>
        <span className="badge coral">Scoped automation off</span>
        <span className="badge">{operation?.state ?? "No open operation"}</span>
      </div>
      {data.session.role === "owner" && (
        <ActionForm action={pauseAction}>
          <input type="hidden" name="paused" value={data.books.policy.paused ? "false" : "true"} />
          <button className="btn coral" type="submit">{data.books.policy.paused ? "Resume agent" : "Emergency pause"}</button>
        </ActionForm>
      )}
      <section className="panel stack">
        <h2>Next permitted action</h2>
        <p>{operation?.reason || "Run an analysis from Mission Control."}</p>
        {operation?.state === "X402_AUTHORIZATION_REQUIRED" && data.session.role !== "auditor" && (
          <ActionForm action={quoteAction}><button className="btn primary" type="submit" disabled={data.books.org.mode !== "demo"}>Authorize simulated quote</button></ActionForm>
        )}
        {operation?.state === "SWAP_APPROVAL_REQUIRED" && data.session.role !== "auditor" && (
          <ActionForm action={swapAction}><button className="btn amber" type="submit">Authorize this quote</button></ActionForm>
        )}
        {operation?.state === "SWAP_READY" && data.books.org.mode === "demo" && data.session.role !== "auditor" && (
          <ActionForm action={settleSwapAction}><button className="btn mint" type="submit">Record simulated settlement</button></ActionForm>
        )}
        {operation && data.session.role !== "auditor" && (
          <ActionForm action={cancelAction}><button className="btn" type="submit">Cancel operation</button></ActionForm>
        )}
        {recovery && <p>{recovery.recovery}</p>}
      </section>
      <Replay items={data.decisions.slice(0, 12).map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        kind: row.kind,
        code: row.code,
        reason: row.reason,
        next: row.nextAction,
        observed: row.observed,
      }))} />
      <section className="panel">
        <h2>Runs</h2>
        {data.runs.length === 0 && <p>No runs yet.</p>}
        {data.runs.map((run) => <p key={run.id}>{run.trigger} · {run.outcome} · {run.startedAt.toISOString()}</p>)}
      </section>
    </div>
  );
}
