import type { Books } from "./books";
import type { Session } from "./session";
import { TREASURY_RELEASE } from "./live-treasury";
import { USDC_MINT } from "../domain/tokens";

export interface ReadinessCheck { id: string; label: string; ok: boolean; detail: string }
// Configuration readiness only. Every transaction still needs fresh validation,
// simulation and exact owner signatures. No network request or mutation here.
export function liveReadiness(books: Books, session: Session, env: Record<string, string | undefined>): ReadinessCheck[] {
  let originOk = false;
  try { const url = new URL(env.APP_ORIGIN || ""); originOk = url.protocol === "https:" && url.origin === env.APP_ORIGIN && !url.username && !url.password; } catch { /* Missing or malformed origin. */ }
  const hosted = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY);
  return [
    { id: "origin", label: "Hosted wallet origin", ok: originOk, detail: "APP_ORIGIN must equal the final HTTPS website origin, without a trailing slash." },
    { id: "database", label: "Persistent database", ok: Boolean(env.DATABASE_URL) || !hosted, detail: hosted ? "Vercel needs a dedicated DATABASE_URL. A successful page load confirms the database opened." : "Local persistent PGlite is supported; Vercel requires PostgreSQL." },
    { id: "deployment", label: "Live deployment", ok: env.APP_MODE === "live", detail: "APP_MODE=live; preview deployments should stay read-only with separate databases." },
    { id: "gates", label: "Owner-approved submission", ok: env.LIVE_OPERATIONS === "true" && env.TREASURY_EXECUTION_ENABLED === "true" && env.TREASURY_REVIEWED_RELEASE === TREASURY_RELEASE, detail: "All live flags and the reviewed release marker must match. This does not authorize a transfer." },
    { id: "organization", label: "Non-demo workspace enabled", ok: books.org.mode === "live" && books.org.liveEnabled, detail: "Provision the real public wallets into a new workspace, then explicitly enable it. Seeded demo data cannot be promoted." },
    { id: "owner", label: "Treasury wallet sign-in", ok: session.authMode === "wallet" && session.role === "owner", detail: "Sign in with the configured treasury wallet. Each transaction verifies its current membership and exact address again." },
    { id: "payer", label: "Separate API payer", ok: books.payer.address !== books.treasury.address, detail: "Only public addresses belong in this deployment. API payer secrets stay in the local signer." },
    { id: "policy", label: "Policy allows owner approvals", ok: books.policy.enabled && !books.policy.paused && books.policy.executionMode === "approval_required" && books.policy.allowedMints.includes(USDC_MINT), detail: "The policy must be enabled, unpaused, approval required, and allow canonical USDC." },
    { id: "verifier", label: "Verification RPC configured", ok: Boolean(env.SOLANA_VERIFICATION_RPC_URL) && env.SOLANA_VERIFICATION_RPC_URL !== env.SOLANA_RPC_URL, detail: "Set a trusted independent mainnet verification endpoint. This checks configuration; live preflight checks reachability and network." },
  ];
}
