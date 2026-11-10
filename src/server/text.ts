import { formatAtomic } from "@/domain/money";

export function usdc(atomic: bigint | string): string {
  return `${formatAtomic(typeof atomic === "string" ? BigInt(atomic) : atomic, 6)} USDC`;
}

export function sol(atomic: bigint | string): string {
  return `${formatAtomic(typeof atomic === "string" ? BigInt(atomic) : atomic, 9)} SOL`;
}

export function maskAddress(address: string): string {
  if (address.length < 8) return "••••";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export type ActionState = { ok: boolean; message: string; code?: string } | null;

export function fail(message: string, code?: string): ActionState {
  return { ok: false, message, code };
}

export function ok(message: string): ActionState {
  return { ok: true, message };
}
