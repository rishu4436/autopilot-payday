import { z } from "zod";
import { USDC_MINT } from "./tokens";
import { NORTHSTAR } from "./scenario";

export const policySchema = z.object({
  version: z.number().int().positive(),
  agentName: z.string().min(1).max(80),
  purpose: z.string().min(1).max(400),
  enabled: z.boolean(),
  paused: z.boolean(),
  executionMode: z.enum(["simulation", "observe", "approval_required"]),
  scopedAutomation: z.literal(false),
  minTreasurySolAtomic: z.string().regex(/^\d+$/),
  minTreasuryUsdcAtomic: z.string().regex(/^\d+$/),
  minX402UsdcAtomic: z.string().regex(/^\d+$/),
  refillThresholdAtomic: z.string().regex(/^\d+$/),
  minRefillAtomic: z.string().regex(/^\d+$/),
  maxRefillAtomic: z.string().regex(/^\d+$/),
  refillCooldownMs: z.number().int().nonnegative(),
  perCallMaxAtomic: z.string().regex(/^\d+$/),
  dailyApiLimitAtomic: z.string().regex(/^\d+$/),
  approverMaxAtomic: z.string().regex(/^\d+$/),
  slippageCeilingBps: z.number().int().min(1).max(1_000),
  maxQuoteAgeMs: z.number().int().positive(),
  marginBps: z.number().int().min(0).max(1_000),
  allowedMints: z.array(z.string()).min(1),
  notifyInApp: z.boolean(),
});

export type PolicyDoc = z.infer<typeof policySchema>;

export function defaultPolicy(): PolicyDoc {
  return {
    version: 1,
    agentName: "Payday Agent",
    purpose: "Fund approved payroll and keep the x402 wallet above its reserve.",
    enabled: true,
    paused: false,
    executionMode: "approval_required",
    scopedAutomation: false,
    minTreasurySolAtomic: NORTHSTAR.minTreasurySol.toString(),
    minTreasuryUsdcAtomic: NORTHSTAR.minTreasuryUsdc.toString(),
    minX402UsdcAtomic: NORTHSTAR.minX402Usdc.toString(),
    refillThresholdAtomic: NORTHSTAR.refillThreshold.toString(),
    minRefillAtomic: NORTHSTAR.minRefill.toString(),
    maxRefillAtomic: NORTHSTAR.maxRefill.toString(),
    refillCooldownMs: 86_400_000,
    perCallMaxAtomic: "50000",
    dailyApiLimitAtomic: "1000000",
    approverMaxAtomic: "500000000",
    slippageCeilingBps: 100,
    maxQuoteAgeMs: 60_000,
    marginBps: 0,
    allowedMints: [USDC_MINT],
    notifyInApp: true,
  };
}

export function parsePolicy(body: string): PolicyDoc {
  return policySchema.parse(JSON.parse(body));
}
