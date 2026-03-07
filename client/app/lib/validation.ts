import { z } from "zod";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid EVM address")
  .transform((value) => value as `0x${string}`);

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex value")
  .transform((value) => value as `0x${string}`);

const numericStringSchema = z
  .string()
  .regex(/^\d+$/, "must be a base-10 numeric string");

const eventSummarySchema = z
  .object({
    eventId: z.string().optional(),
    eventName: z.string().optional(),
    eventUrl: z.string().optional(),
    capacity: z.number().optional(),
    onlineEvent: z.boolean().optional(),
    salesStatus: z.string().optional(),
    canceled: z.boolean().optional(),
    eventStart: z.number().optional(),
    eventEnd: z.number().optional(),
    rawStatus: z.string().optional(),
  })
  .strict();

const pricingResultSchema = z
  .object({
    computedPayoutUSDC: numericStringSchema,
    computedPremiumUSDC: numericStringSchema,
    pCancelBps: z.number(),
    expectedLossUSDC: numericStringSchema,
    reserveUtilizationBps: z.number(),
  })
  .strict();

const quoteSchema = z
  .object({
    quoteVersion: z.number(),
    insured: addressSchema,
    eventId: z.string(),
    eventIdHash: bytes32Schema,
    eventStart: z.number(),
    coverageStart: z.number(),
    coverageEnd: z.number(),
    quoteExpiry: z.number(),
    payoutUSDC: numericStringSchema,
    premiumUSDC: numericStringSchema,
    nonce: bytes32Schema,
  })
  .strict();

const signedQuoteSchema = z
  .object({
    quote: quoteSchema,
    quoteHash: bytes32Schema,
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/)
      .transform((value) => value as `0x${string}`),
    signer: addressSchema,
  })
  .strict();

export const quoteRequestSchema = z
  .object({
    eventUrl: z.string().min(1),
    eventName: z.string().min(1),
    insured: addressSchema,
    nonce: bytes32Schema.optional(),
  })
  .strict();

export const buyRequestSchema = z
  .object({
    signedQuote: signedQuoteSchema,
  })
  .strict();

export const claimRequestSchema = z
  .object({
    policyId: z.string().min(1),
    eventId: z.string().min(1),
  })
  .strict();

const workflowErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
  })
  .strict();

const quoteWorkflowOkSchema = z
  .object({
    ok: z.literal(true),
    action: z.literal("QUOTE_CHECK"),
    quoteValid: z.boolean(),
    reason: z.string().optional(),
    event: eventSummarySchema,
    canonicalEventId: z.string().optional(),
    eventNameMatch: z.boolean().optional(),
    pricing: pricingResultSchema.optional(),
    warnings: z.array(z.string()).optional(),
    signedQuote: signedQuoteSchema.optional(),
  })
  .strict();

const mintWorkflowOkSchema = z
  .object({
    ok: z.literal(true),
    action: z.literal("MINT"),
    txHash: z.string().optional(),
    policyId: z.string().optional(),
    tokenId: z.string().optional(),
    policyNftAddress: addressSchema.optional(),
    note: z.string(),
  })
  .strict();

const claimWorkflowOkSchema = z
  .object({
    ok: z.literal(true),
    action: z.literal("CLAIM"),
    decision: z.union([z.literal("PAY"), z.literal("RESOLVE_NO_PAYOUT"), z.literal("NO_OP")]),
    txHash: z.string().optional(),
    note: z.string(),
    event: eventSummarySchema,
  })
  .strict();

export const workflowResultSchema = z.union([
  quoteWorkflowOkSchema,
  mintWorkflowOkSchema,
  claimWorkflowOkSchema,
  workflowErrorSchema,
]);

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type BuyRequest = z.infer<typeof buyRequestSchema>;
export type ClaimRequest = z.infer<typeof claimRequestSchema>;

export const parseRequestJson = async <T>(
  request: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> => {
  let json: unknown;

  try {
    json = await request.json();
  } catch {
    return { ok: false, status: 400, error: "INVALID_REQUEST_JSON" };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return { ok: false, status: 400, error: `INVALID_REQUEST:${issues.join("; ")}` };
  }

  return { ok: true, data: parsed.data };
};
