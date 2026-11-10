const ATOMIC = /^\d+(\.\d+)?$/;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

export function parseAtomic(input: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new AmountError("Invalid decimals");
  }
  const trimmed = input.trim();
  if (!ATOMIC.test(trimmed)) {
    throw new AmountError("Amount must be a non-negative decimal string");
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (whole === undefined) throw new AmountError("Amount is empty");
  if (frac.length > decimals) throw new AmountError("Too many decimal places");
  const scale = 10n ** BigInt(decimals);
  const fraction = frac.length === 0 ? 0n : BigInt(frac.padEnd(decimals, "0"));
  return BigInt(whole) * scale + fraction;
}

export function formatAtomic(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new AmountError("Invalid decimals");
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function sumAtomic(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

export function maxZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

export function requiredOutput(shortfallAtomic: bigint, marginBps: bigint): bigint {
  if (shortfallAtomic < 0n || marginBps < 0n) throw new AmountError("Negative funding figure");
  return shortfallAtomic + (shortfallAtomic * marginBps) / 10_000n;
}

export function estimateCallCapacity(spendableAtomic: bigint, unitPriceAtomic: bigint): bigint | null {
  if (unitPriceAtomic <= 0n) return null;
  if (spendableAtomic <= 0n) return 0n;
  return spendableAtomic / unitPriceAtomic;
}
