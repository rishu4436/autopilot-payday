// Explicit local execution only. This script never reads a private key.
import { readFileSync, writeFileSync } from "node:fs";
import { validatePlan, planHash } from "../src/hermes/paid-plan";

async function main() {
  if (!process.argv.includes("--i-understand-this-spends-usdc") || process.env.LIVE_OPERATIONS !== "true") throw new Error("Owner approval required. Paid execution is disabled.");
  const token = process.env.X402_SIGNER_TOKEN;
  if (!token || !process.env.X402_APPROVED_PLAN || !process.env.X402_APPROVED_PLAN_SHA256) throw new Error("Local approved plan, hash and signer token are required");
  if (process.env.X402_SIGNER_URL && process.env.X402_SIGNER_URL !== "http://127.0.0.1:8787") throw new Error("Signer URL must be http://127.0.0.1:8787");
  const plan = validatePlan(JSON.parse(readFileSync(process.env.X402_APPROVED_PLAN, "utf8")));
  if (planHash(plan) !== process.env.X402_APPROVED_PLAN_SHA256) throw new Error("Plan approval hash mismatch");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const health = await fetch("http://127.0.0.1:8787/health", { headers, redirect: "error", signal: AbortSignal.timeout(3_000) });
  if (!health.ok) throw new Error("Authenticated local signer unavailable");
  const state = await health.json();
  if (state.address !== plan.payer || state.planHash !== planHash(plan)) throw new Error("Signer plan differs from owner approval");
  const response = await fetch("http://127.0.0.1:8787/v1/paid", { method: "POST", headers, body: JSON.stringify({ planId: plan.id }), redirect: "error", signal: AbortSignal.timeout(65_000) });
  const payload = await response.json();
  const output = process.env.X402_RESULT_FILE || "audit/paid-quote-result.json";
  writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), planHash: planHash(plan), ...payload }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: response.status, output, evidence: payload.evidence ?? null, message: payload.message ?? null }, null, 2));
  if (!response.ok) process.exitCode = 1;
}
main().catch(() => { console.error("Paid quote did not complete. Do not retry: inspect the signer journal and reconcile Solana first."); process.exitCode = 1; });
