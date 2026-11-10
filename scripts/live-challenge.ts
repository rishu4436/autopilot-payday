import { buildQuoteBody } from "../src/hermes/protocol";
import { unpaidHermes } from "../src/server/hermes";
import { USDC_MINT, WSOL_MINT } from "../src/domain/tokens";

async function main() {
  const result = await unpaidHermes("/v1/swap/quote", {
    method: "POST",
    body: buildQuoteBody({
      inputMint: WSOL_MINT,
      inputAmount: 1_000_000_000n,
      outputMint: USDC_MINT,
      userAddress: "11111111111111111111111111111111",
      slippageBps: 50,
    }),
  });
  console.log(JSON.stringify({ kind: result.kind, status: result.status, body: result.body }, null, 2));
  if (result.kind !== "payment_required") process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
