import { getDb } from "@/db/client";
import { treasuryExecutionEnabled } from "@/server/live-treasury";

export const dynamic = "force-dynamic";
export async function GET() {
  await getDb();
  return Response.json({ app: "autopilot-payday", database: "ready", webFinancialExecution: treasuryExecutionEnabled() && process.env.APP_MODE === "live" ? "owner_approved_gated" : "disabled", legacyBroadcast: "quarantined" }, { headers: { "cache-control": "no-store" } });
}
