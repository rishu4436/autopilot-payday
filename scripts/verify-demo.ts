import { getDb } from "../src/db/client";
import { loadBooks } from "../src/server/books";
import { analyze, approveSwap, buyQuote, decideBatch, makeBatch, settleDemoPayout, settleDemoSwap } from "../src/server/mutate";
import type { Session } from "../src/server/session";

if (!process.env.PGLITE_DIR?.includes("verify") || process.env.DATABASE_URL || (process.env.APP_MODE && process.env.APP_MODE !== "demo")) {
  console.error("Set PGLITE_DIR to a scratch directory whose name includes 'verify'.");
  process.exit(1);
}

const session: Session = {
  id: "verify",
  userId: "user_owner",
  orgId: "org_northstar",
  role: "owner",
  authMode: "demo",
  displayName: "Northstar Owner",
};

async function main() {
  await getDb();
  const before = await loadBooks(await getDb(), session.orgId);
  console.log("before", before.ledger.shortfallAtomic.toString(), before.treasury.usdcAtomic);
  console.log("analyze", await analyze(session, "1"));
  console.log("quote", await buyQuote(session));
  console.log("swap", await approveSwap(session));
  console.log("settle", await settleDemoSwap(session));
  const mid = await loadBooks(await getDb(), session.orgId);
  console.log("after swap", mid.treasury.usdcAtomic, mid.ledger.shortfallAtomic.toString(), mid.openOperation?.state);
  const ids = mid.obligations.map((row) => row.id);
  console.log("batch", await makeBatch(session, ids));
  const drafted = await loadBooks(await getDb(), session.orgId);
  const draft = drafted.batchRows.find((row) => row.status === "DRAFT");
  if (!draft) throw new Error("draft missing");
  console.log("approve", await decideBatch(session, draft.id, "approved"));
  console.log("pay", await settleDemoPayout(session, draft.id));
  const after = await loadBooks(await getDb(), session.orgId);
  console.log("final usdc", after.treasury.usdcAtomic, "open", after.openOperation?.state, "paid", after.tasks.filter((task) => task.paymentStatus === "PAID").length);
  if (before.ledger.shortfallAtomic !== 90_000_000n) throw new Error("expected 90 USDC shortfall");
  if (after.tasks.filter((task) => ["ms_brand", "ms_eng", "ms_film"].includes(task.id) && task.paymentStatus === "PAID").length !== 3) {
    throw new Error("payroll did not settle");
  }
  console.log("demo flow ok");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
