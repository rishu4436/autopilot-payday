// Owner-operated dead-process recovery only. Never clears a payment hold or budget.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PaymentJournal } from "../services/x402-signer/journal";
import { privatePath } from "../services/x402-signer/private-path";
function main() {
  if (!process.argv.includes("--recover-dead-process") || !process.env.X402_JOURNAL_DIR) throw new Error("Stop all signer processes, then explicitly supply --recover-dead-process and the existing X402_JOURNAL_DIR");
  const directory = privatePath(process.env.X402_JOURNAL_DIR);
  // Check integrity first. Corruption or old formats require a separate manual forensic review.
  const journal = new PaymentJournal(directory);
  const rows = journal.rows();
  const paths = ["signer.lock", "journal.lock"].map((name) => join(directory, name)).filter(existsSync);
  for (const path of paths) {
    const lock = JSON.parse(readFileSync(path, "utf8"));
    if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0 || !Number.isFinite(Date.parse(lock.at))) throw new Error("Invalid lock metadata; manual review required");
    try { process.kill(lock.pid, 0); throw new Error("Lock process is alive or PID reused; refuse recovery"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  for (const path of paths) unlinkSync(path);
  console.log(JSON.stringify({ recoveredLocks: paths.length, journalRows: rows.length, paymentStateChanged: false }));
  console.log("Reconcile any reserved/prepared/signed/unknown payment. Lock recovery never authorizes a retry.");
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "Lock recovery refused"); process.exitCode = 1; }
