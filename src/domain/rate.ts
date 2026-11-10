export function rateLimit(timestamps: readonly number[], now: number, limit: number, windowMs: number): { ok: boolean; next: number[] } {
  const next = timestamps.filter((stamp) => now - stamp < windowMs);
  if (next.length >= limit) return { ok: false, next };
  next.push(now);
  return { ok: true, next };
}

const SECRET_KEY = /secret|keypair|seed|private|password|session|signer|cookie|authorization|x-payment|payer_keypair/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (Array.isArray(value)) {
    if (value.length === 64 && value.every((item) => typeof item === "number")) return "[redacted-keypair]";
    return value.map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1);
    }
    return output;
  }
  return value;
}
