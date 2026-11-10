import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import PresentationScenes from "../../components/presentation-scenes";
import { validateUnpaidEvidence, verifyPaidEvidence, type PublicPaidEvidence } from "../../hermes/evidence";
export const dynamic = "force-dynamic";
export default async function PresentationPage() {
  let unpaid: { at: string; chargeAtomic: string; request: unknown } | null = null, paid: PublicPaidEvidence | null = null;
  let evidenceStatus = "No verified paid quote artifact is available.";
  try {
    const { record, chargeAtomic } = validateUnpaidEvidence(JSON.parse(await readFile(join(process.cwd(), "evidence/public/unpaid-challenge.json"), "utf8")));
    unpaid = { at: record.at, chargeAtomic, request: record.request };
  } catch { /* A missing/malformed capture is displayed honestly. */ }
  try {
    const raw = JSON.parse(await readFile(join(process.cwd(), "evidence/public/paid-quote.json"), "utf8"));
    evidenceStatus = "A paid artifact exists, but fresh chain verification is unavailable.";
    const rpc = new Connection(process.env.SOLANA_VERIFICATION_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8_000) }) });
    paid = await verifyPaidEvidence(raw, rpc);
    evidenceStatus = "Payment reverified using Solana RPC.";
  } catch { /* Never display an unverified receipt as a completed payment. */ }
  return <PresentationScenes unpaid={unpaid} paid={paid} evidenceStatus={evidenceStatus} />;
}
