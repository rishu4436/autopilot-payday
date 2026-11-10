import { assertHermesUrl, parseDiscovery, readUnpaid, type Discovery } from "@/hermes/protocol";
const globalCache = globalThis as unknown as { hermesInfo?: { at: number; data: Discovery } };
export function hermesBase(): string {
  const base = process.env.HERMES_BASE_URL || "https://hermes.swap.io";
  assertHermesUrl(base);
  return base;
}
export async function discoverLive(force = false): Promise<Discovery> {
  const cached = globalCache.hermesInfo;
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.data;
  const response = await fetch(`${hermesBase()}/v1/info`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Hermes discovery returned HTTP ${response.status}`);
  const data = parseDiscovery(await response.json());
  globalCache.hermesInfo = { at: Date.now(), data };
  return data;
}
export async function unpaidHermes(path: string, init: { method: string; body?: unknown }): Promise<Awaited<ReturnType<typeof readUnpaid>>> {
  const url = new URL(path, hermesBase()).toString();
  return readUnpaid(fetch, url, {
    method: init.method,
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
}
export function signerReady(): boolean {
  return false;
}
export async function paidHermes(_input: { path: string; method: string; body?: unknown; maxAtomic: string; payees: string[] }): Promise<{ status: number; body: unknown; receiptHeader: string | null }> {
  throw new Error("Web payments are quarantined. Use the separately approved local quote procedure.");
}
