"use client";

import { useState, type FormHTMLAttributes } from "react";
import type { ActionState } from "@/server/text";

// Server Actions persist the mutation. A normal browser navigation then reads
// its committed state without depending on a cached/streaming router update.
// This never retries a submission.
export function ActionForm({ action, children, ...props }: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & { action: (data: FormData) => Promise<void | ActionState> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form {...props} data-reload-after-submit="true" aria-busy={pending} action={async (data) => {
      if (pending) return;
      setPending(true); setError(null);
      try {
        const result = await action(data);
        if (result && !result.ok) { setPending(false); setError(result.message); return; }
        window.location.reload();
      } catch {
        setPending(false);
        setError("The action could not complete. Refresh and inspect its state before retrying.");
      }
    }}>
      {children}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
