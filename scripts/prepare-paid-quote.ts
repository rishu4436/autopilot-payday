// Read-only: public address only; no keypair, signature, payment or broadcast.
import { writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { buildQuoteBody, normalizeNeed, parsePaymentRequired, selectSolanaUsdc, solanaPayees } from "../src/hermes/protocol";
import { discoverLive, unpaidHermes } from "../src/server/hermes";
import { planHash, QUOTE_URL, validatePlan } from "../src/hermes/paid-plan";
import { USDC_MINT, WSOL_MINT } from "../src/domain/tokens";
import { privatePath } from "../services/x402-signer/private-path";

async function main() {
  if (!process.env.X402_APPROVED_PLAN) throw new Error("Set X402_APPROVED_PLAN to a new private file outside the repository");
  const output = privatePath(process.env.X402_APPROVED_PLAN);
  const payer = new PublicKey(process.env.X402_PAYER_PUBLIC_KEY || "");
  const treasury = new PublicKey(process.env.TREASURY_PUBLIC_KEY || payer.toBase58());
  const rpc = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });
  if (await rpc.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") throw new Error("Expected Solana mainnet");
  const account = await getAccount(rpc, getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), payer));
  const discovery = await discoverLive(true);
  const body = buildQuoteBody({ inputMint: WSOL_MINT, inputAmount: 1_000_000n, outputMint: USDC_MINT, userAddress: treasury.toBase58(), slippageBps: 50 });
  const challenge = await unpaidHermes("/v1/swap/quote", { method: "POST", body });
  if (challenge.status !== 402) throw new Error(`Expected unpaid 402, received ${challenge.status}`);
  const need = selectSolanaUsdc(normalizeNeed(parsePaymentRequired(challenge.body)));
  if (!need?.feePayer || need.resource !== QUOTE_URL || !solanaPayees(discovery, "/v1/swap/quote").includes(need.payTo)) throw new Error("Discovery and challenge terms mismatch");
  const now = Date.now();
  const plan = validatePlan({ id: crypto.randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60_000).toISOString(), payer: payer.toBase58(), url: QUOTE_URL, method: "POST", body,
    terms: { scheme: need.scheme, network: need.network, asset: need.asset, amount: need.maxAmountRequired.toString(), payTo: need.payTo, feePayer: need.feePayer, resource: need.resource }, maxAtomic: need.maxAmountRequired.toString(), dailyLimitAtomic: "50000", lifetimeLimitAtomic: "100000", reserveAtomic: "100000" });
  if (account.isFrozen || !account.owner.equals(payer) || !account.mint.equals(new PublicKey(USDC_MINT)) || account.amount < BigInt(plan.terms.amount) + BigInt(plan.reserveAtomic)) throw new Error("Payer needs an unfrozen owned USDC ATA and sufficient reserve");
  writeFileSync(output, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
  writeFileSync(`${output}.evidence.json`, JSON.stringify({ capturedAt: new Date().toISOString(), discovery, challenge, balanceAtomic: account.amount.toString() }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ preparedOnly: true, output, planHash: planHash(plan), plan, balanceAtomic: account.amount.toString() }, null, 2));
  console.log("STOP. Obtain separate owner approval of this hash and payment before starting the signer or paid command.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Read-only preparation failed"); process.exitCode = 1; });
