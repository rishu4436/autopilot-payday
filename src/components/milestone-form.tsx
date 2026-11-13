"use client";

import { useState } from "react";
import type { ActionState } from "@/server/text";

export function MilestoneForm({ people, action, initial }: { people: { id: string; name: string }[]; action: (prev: ActionState, formData: FormData) => Promise<ActionState>; initial?: { id: string; title: string; description: string; contributorId: string; amount: string; dueOn: string; evidence: string } }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form className="panel stack" data-reload-after-submit="true" action={async (formData) => {
      const result = await action(null, formData);
      setMessage(result?.message ?? null);
      if (result?.ok) window.location.reload();
    }}>
      <strong>{initial ? "Edit milestone" : "New milestone"}</strong>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {message && <div className="flash">{message}</div>}
      <div className="two">
        <label className="field">Title<input name="title" defaultValue={initial?.title} required /></label>
        <label className="field">Contributor
          <select name="contributorId" defaultValue={initial?.contributorId}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        </label>
        <label className="field">USDC amount<input name="amount" defaultValue={initial?.amount} required placeholder="40" /></label>
        <label className="field">Due<input name="dueOn" type="date" defaultValue={initial?.dueOn} required /></label>
      </div>
      <label className="field">Description<textarea aria-label="Description" name="description" defaultValue={initial?.description} required /></label>
      <label className="field">Evidence<textarea aria-label="Evidence" name="evidence" defaultValue={initial?.evidence} /></label>
      <button className="btn primary" type="submit">{initial ? "Save changes" : "Create draft"}</button>
    </form>
  );
}
