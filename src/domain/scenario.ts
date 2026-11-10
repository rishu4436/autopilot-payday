import { USDC_DECIMALS } from "./tokens";
import { parseAtomic } from "./money";

const usdc = (value: string) => parseAtomic(value, USDC_DECIMALS);

/** Disposable demo addresses. Secrets were never stored. */
export const DEMO_WALLETS = {
  treasury: "56kYq8BSnueDrfYwH86FKddeQ59xi327VJKngEKdyKXV",
  payer: "7JvqdVoEdGsoe9Q7wfQarczJkhKi26frik2Aj3tG59Vi",
  maya: "F2kmxtWQKx9JZ22GKzbKczX8N299EakWiUPmXtkgyfFG",
  leo: "5wbMxurX2cBjNLsuFFdv1RuWPaQE8vytVM4eF6XeMNbF",
  aria: "6ERBEL4nYxwq6xAtErMXJMK24rKA4Bg3YMebfB7MVqK8",
  owner: "3Jc8Bam7gZ23Gz4WsNYUvZmU2XAfBbNrJHzwaAMWrRsq",
  approver: "5xzaruZt6DTgQm2U4RXtWLWa4NWZWWR11vzWioMDwKnV",
  auditor: "6JDqkSytuYYTwktcaQqmLQxboGGXznFmjPmpnnWBToMC",
} as const;

/** Fictional Northstar Studio ledger. Demo only. */
export const NORTHSTAR = {
  orgName: "Northstar Studio",
  project: "Product Launch",
  obligations: [
    { name: "Maya", role: "Design", title: "Brand system", amount: usdc("40") },
    { name: "Leo", role: "Engineering", title: "App engineering", amount: usdc("50") },
    { name: "Aria", role: "Motion Graphics", title: "Launch film", amount: usdc("35") },
  ],
  treasuryUsdc: usdc("35"),
  treasurySol: parseAtomic("12.5", 9),
  minTreasurySol: parseAtomic("0.05", 9),
  minTreasuryUsdc: 0n,
  x402Usdc: usdc("2.5"),
  minX402Usdc: usdc("1"),
  refillThreshold: usdc("1.5"),
  minRefill: usdc("1"),
  maxRefill: usdc("10"),
  historicalPaid: usdc("15"),
} as const;

export function northstarObligationTotal(): bigint {
  return NORTHSTAR.obligations.reduce((sum, row) => sum + row.amount, 0n);
}
