export type ChainView = "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export interface SignatureProbe {
  value: null | { err: unknown; confirmationStatus?: string | null };
  elapsedMs: number;
  timeoutMs: number;
}

export function classifySignature(probe: SignatureProbe): ChainView {
  if (probe.value?.err) return "FAILED";
  const status = probe.value?.confirmationStatus;
  if (status === "confirmed" || status === "finalized") return "CONFIRMED";
  if (probe.value === null && probe.elapsedMs >= probe.timeoutMs) return "UNKNOWN";
  return "PENDING";
}
