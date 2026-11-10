"use client";

import { useState } from "react";
import type { ActionState } from "@/server/text";

export function MilestoneForm({ people, action }: { people: { id: string; name: string }[]; action: (prev: ActionState, formData: FormData) => Promise<ActionState> }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form className="panel stack" data-reload-after-submit="true" action={async (formData) => {
      const result = await action(null, formData);
      setMessage(result?.message ?? null);
      if (result?.ok) window.location.reload();
    }}>
      <strong>New milestone</strong>
      {message && <div className="flash">{message}</div>}
      <div className="two">
        <label className="field">Title<input name="title" required /></label>
        <label className="field">Contributor
          <select name="contributorId">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        </label>
        <label className="field">USDC amount<input name="amount" required placeholder="40" /></label>
        <label className="field">Due<input name="dueOn" type="date" required /></label>
      </div>
      <label className="field">Description<textarea name="description" required /></label>
      <label className="field">Evidence<textarea name="evidence" /></label>
      <button className="btn primary" type="submit">Create draft</button>
    </form>
  );
}
