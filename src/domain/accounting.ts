export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}

export interface LedgerInput {
  treasuryUsdcAtomic: bigint;
  treasurySolAtomic: bigint;
  minTreasuryUsdcAtomic: bigint;
  minTreasurySolAtomic: bigint;
  /** USDC locked inside payout batches that are authorized, submitted, or uncertain. */
  pendingPayoutUsdcAtomic: bigint;
  /** Approved unpaid milestones that are not already inside those batches. */
  approvedUnpaidUsdcAtomic: bigint;
  obligationIds: readonly string[];
  commitmentIds: readonly string[];
  x402UsdcAtomic: bigint;
  minX402UsdcAtomic: bigint;
}

export interface LedgerResult {
  availableUsdcAtomic: bigint;
  safeSolAtomic: bigint;
  shortfallAtomic: bigint;
  coveredAtomic: bigint;
  x402SpendableAtomic: bigint;
  x402BelowReserve: boolean;
}

export function assertNoDoubleCount(obligationIds: readonly string[], commitmentIds: readonly string[]): void {
  const committed = new Set(commitmentIds);
  for (const id of obligationIds) {
    if (committed.has(id)) {
      throw new AccountingError(`Obligation ${id} is already a pending commitment`);
    }
  }
}

export function accountTreasury(input: LedgerInput): LedgerResult {
  assertNoDoubleCount(input.obligationIds, input.commitmentIds);
  const figures = [
    input.treasuryUsdcAtomic,
    input.treasurySolAtomic,
    input.minTreasuryUsdcAtomic,
    input.minTreasurySolAtomic,
    input.pendingPayoutUsdcAtomic,
    input.approvedUnpaidUsdcAtomic,
    input.x402UsdcAtomic,
    input.minX402UsdcAtomic,
  ];
  if (figures.some((value) => value < 0n)) throw new AccountingError("Negative balance");

  const unlocked = input.treasuryUsdcAtomic - input.minTreasuryUsdcAtomic - input.pendingPayoutUsdcAtomic;
  const available = unlocked > 0n ? unlocked : 0n;
  const shortfall = input.approvedUnpaidUsdcAtomic > available ? input.approvedUnpaidUsdcAtomic - available : 0n;
  const safeSol = input.treasurySolAtomic > input.minTreasurySolAtomic
    ? input.treasurySolAtomic - input.minTreasurySolAtomic
    : 0n;
  const spendable = input.x402UsdcAtomic > input.minX402UsdcAtomic
    ? input.x402UsdcAtomic - input.minX402UsdcAtomic
    : 0n;

  return {
    availableUsdcAtomic: available,
    safeSolAtomic: safeSol,
    shortfallAtomic: shortfall,
    coveredAtomic: input.approvedUnpaidUsdcAtomic - shortfall,
    x402SpendableAtomic: spendable,
    x402BelowReserve: input.x402UsdcAtomic < input.minX402UsdcAtomic,
  };
}
