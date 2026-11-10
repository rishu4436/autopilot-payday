import { buildQuoteBody } from "../src/hermes/protocol";
import { unpaidHermes } from "../src/server/hermes";
import { USDC_MINT, WSOL_MINT } from "../src/domain/tokens";
import { mkdirSync, writeFileSync } from "node:fs";
import { validateUnpaidEvidence } from "../src/hermes/evidence";

async function main() {
  const body = buildQuoteBody({
      inputMint: WSOL_MINT,
      inputAmount: 1_000_000n,
      outputMint: USDC_MINT,
      userAddress: "11111111111111111111111111111111",
      slippageBps: 50,
    });
  const result = await unpaidHermes("/v1/swap/quote", { method: "POST", body });
  console.log(JSON.stringify({ kind: result.kind, status: result.status, body: result.body }, null, 2));
  if (result.kind !== "payment_required") process.exit(1);
  const evidence = { schemaVersion: 1, evidenceClass: "unpaid_http_402", at: new Date().toISOString(), status: 402, url: "https://hermes.swap.io/v1/swap/quote", method: "POST", publicAddressIsPlaceholder: true, request: body, challenge: result.body };
  validateUnpaidEvidence(evidence);
  if (process.argv.includes("--save-evidence")) {
    mkdirSync("evidence/public", { recursive: true });
    writeFileSync("evidence/public/unpaid-challenge.json", JSON.stringify(evidence, null, 2), "utf8");
    console.log("Saved fresh UNPAID evidence. Placeholder address; no owner balance was checked and nothing was signed or spent.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
