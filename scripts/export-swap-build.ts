// Export only an existing verified unsigned build and its original response.
// No keypair, signing, merchant request or chain broadcast occurs here.
import { readFileSync, writeFileSync } from "node:fs";
import { Connection } from "@solana/web3.js";
import { privatePath } from "../services/x402-signer/private-path";
import { verifyPaidBuildEvidence, validateOriginalBuildResponse } from "../src/hermes/build-evidence";
async function main() {
  if (!process.env.X402_VERIFIED_RECORD || !process.env.X402_RAW_RESPONSE || !process.env.SWAP_BUILD_BUNDLE) throw new Error("Set private X402_VERIFIED_RECORD, X402_RAW_RESPONSE and new SWAP_BUILD_BUNDLE paths");
  const rpc = new Connection(process.env.SOLANA_VERIFICATION_RPC_URL || "https://api.mainnet-beta.solana.com", { commitment: "finalized", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
  const record = await verifyPaidBuildEvidence(JSON.parse(readFileSync(privatePath(process.env.X402_VERIFIED_RECORD), "utf8")), rpc);
  const response = JSON.parse(readFileSync(privatePath(process.env.X402_RAW_RESPONSE), "utf8"));
  validateOriginalBuildResponse(record, response);
  const bundle = JSON.stringify({ record, response }, null, 2);
  if (bundle.length > 500_000) throw new Error("Build bundle exceeds the reviewed upload ceiling");
  writeFileSync(privatePath(process.env.SWAP_BUILD_BUNDLE), bundle, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ exported: true, signature: record.evidence.signature, treasury: record.plan.body.userAddress, unsignedOnly: true }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Build export failed"); process.exitCode = 1; });
