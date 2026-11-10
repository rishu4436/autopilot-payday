import { writeFileSync } from "node:fs";
import { discoverLive, unpaidHermes } from "../src/server/hermes";
import { buildQuoteBody } from "../src/hermes/protocol";
import { USDC_MINT, WSOL_MINT } from "../src/domain/tokens";

async function main() {
const capturedAt = new Date().toISOString();
const discovery = await discoverLive(true);
const request = buildQuoteBody({ inputMint: WSOL_MINT, inputAmount: 1_000_000_000n, outputMint: USDC_MINT, userAddress: "11111111111111111111111111111111", slippageBps: 50 });
const challenge = await unpaidHermes("/v1/swap/quote", { method: "POST", body: request });
writeFileSync("audit/hermes-evidence.json", JSON.stringify({ capturedAt, evidenceClass: "live_unpaid", financialSignatureCreated: false, paymentSent: false, request, discovery, challenge }, null, 2));
if (challenge.status !== 402) throw new Error(`Expected 402, received ${challenge.status}`);
console.log("Saved live discovery and unpaid HTTP 402; no financial signature or payment.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Capture failed"); process.exitCode = 1; });
