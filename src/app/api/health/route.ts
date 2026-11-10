import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";
export async function GET() {
  await getDb();
  return Response.json({ app: "autopilot-payday", database: "ready", webFinancialExecution: "quarantined" }, { headers: { "cache-control": "no-store" } });
}
