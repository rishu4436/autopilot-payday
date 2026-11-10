"use client";

import { useState } from "react";
import type { ActionState } from "@/server/text";

export function ContributorTools({
  rows,
  canEdit,
  owner,
  action,
  allowAction,
}: {
  rows: { id: string; name: string; role: string; address: string; active: boolean; allowlisted: boolean; notes: string; paid: string; pending: number }[];
  canEdit: boolean;
  owner: boolean;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  allowAction: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [state, formAction] = useForm(action);
  const shown = rows.filter((row) => `${row.name} ${row.role} ${row.address}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="stack">
      <input aria-label="Search contributors" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
      {state?.message && <div className="flash">{state.message}</div>}
      <div className="table-wrap panel">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Wallet</th><th>Status</th><th>Paid</th><th>Open work</th><th></th></tr></thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td>{row.name}<div className="kicker">{row.notes}</div></td>
                <td>{row.role}</td>
                <td className="num">{row.address.slice(0, 4)}…{row.address.slice(-4)}</td>
                <td>{row.active ? "Active" : "Inactive"} · {row.allowlisted ? "Allowlisted" : "Not allowlisted"}</td>
                <td>{row.paid}</td>
                <td>{row.pending}</td>
                <td>{owner && (
                  <form action={allowAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="allowlisted" value={row.allowlisted ? "false" : "true"} />
                    <button className="btn" type="submit">{row.allowlisted ? "Remove allowlist" : "Allowlist"}</button>
                  </form>
                )}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7}>No contributors match.</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form className="panel stack" data-reload-after-submit="true" action={formAction}>
          <strong>Add a contributor</strong>
          <div className="two">
            <label className="field">Name<input name="displayName" required /></label>
            <label className="field">Role<input name="roleTitle" required /></label>
            <label className="field">Wallet<input name="address" required /></label>
            <label className="field">Notes<input name="notes" /></label>
          </div>
          <label><input type="checkbox" name="active" defaultChecked /> Active</label>
          <button className="btn primary" type="submit">Save</button>
        </form>
      )}
    </div>
  );
}

function useForm(action: (prev: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, setState] = useState<ActionState>(null);
  return [state, async (formData: FormData) => {
    const result = await action(state, formData);
    setState(result);
    if (result?.ok) window.location.reload();
  }] as const;
}
