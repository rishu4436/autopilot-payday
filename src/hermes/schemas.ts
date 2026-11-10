import { z } from "zod";

export const paymentNeedSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  maxAmountRequired: z.string().regex(/^\d+$/),
  resource: z.string().url(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().optional(),
  asset: z.string().min(1),
  extra: z.object({ feePayer: z.string().optional() }).passthrough().optional(),
}).passthrough();

export const paymentRequiredSchema = z.object({
  x402Version: z.number(),
  error: z.string().optional(),
  accepts: z.array(paymentNeedSchema).min(1),
}).passthrough();

export const discoveryEndpointSchema = z.object({
  method: z.string(),
  path: z.string(),
  operation: z.string().optional(),
  payment: z.string(),
  asset: z.string().optional(),
  basePrice: z.string().optional(),
  accepts: z.array(paymentNeedSchema).optional(),
}).passthrough();

export const discoverySchema = z.object({
  service: z.string(),
  description: z.string().optional(),
  docs: z.string().optional(),
  endpoints: z.array(discoveryEndpointSchema),
}).passthrough();

export const quoteSchema = z.object({
  success: z.boolean().optional(),
  quotes: z.array(z.object({
    provider: z.object({ key: z.string(), name: z.string().optional() }).passthrough(),
    priceImpactPct: z.union([z.string(), z.number()]).nullable().optional(),
    minimumOutAmount: z.string().optional(),
    minOutAmount: z.string().optional(),
    slippageBps: z.number().optional(),
    providerQuote: z.unknown(),
    bestQuote: z.boolean().optional(),
    output: z.object({
      amount: z.string().optional(),
      minAmount: z.string().optional(),
      minimumAmount: z.string().optional(),
    }).passthrough().optional(),
    input: z.object({ amount: z.string().optional() }).passthrough().optional(),
  }).passthrough()),
}).passthrough();

export const buildTxSchema = z.object({
  success: z.boolean().optional(),
  transaction: z.string().min(1),
  provider: z.string().optional(),
  warnings: z.array(z.unknown()).optional(),
}).passthrough();

export const transferBuildSchema = z.object({
  transactions: z.array(z.object({
    transaction: z.string().min(1),
    transfer_count: z.number().optional(),
    instruction_count: z.number().optional(),
  }).passthrough()).min(1),
  transaction_count: z.number().optional(),
  total_amount: z.string().optional(),
  batch_id: z.string().optional(),
}).passthrough();

export type Discovery = z.infer<typeof discoverySchema>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;
export type QuoteResponse = z.infer<typeof quoteSchema>;
