import { z } from "zod";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid EVM address")
  .transform((value) => value as `0x${string}`);

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex value")
  .transform((value) => value as `0x${string}`);

const numericStringSchema = z.string().regex(/^\d+$/, "must be a base-10 numeric string");

const policyTierSchema = z.union([z.literal("BASIC"), z.literal("MEDIUM"), z.literal("ADVANCED")]);
const geminiRiskBandSchema = z.union([z.literal("low"), z.literal("medium"), z.literal("high"), z.literal("unknown")]);
const capacityBandSchema = z.union([
  z.literal("<50"),
  z.literal("50-199"),
  z.literal("200-1000"),
  z.literal(">1000"),
  z.literal("unknown"),
]);
const venueTypeBandSchema = z.union([z.literal("online"), z.literal("offline"), z.literal("unknown")]);
const organizerExperienceBandSchema = z.union([
  z.literal("new"),
  z.literal("1-2"),
  z.literal("3-9"),
  z.literal("10-50"),
  z.literal(">50"),
  z.literal("unknown"),
]);

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
    categoryId: z.string().optional(),
    categoryName: z.string().optional(),
    subcategoryId: z.string().optional(),
    subcategoryName: z.string().optional(),
    organizerPastEvents: z.number().optional(),
    organizerFutureEvents: z.number().optional(),
    descriptionText: z.string().optional(),
    venueName: z.string().optional(),
    venueCity: z.string().optional(),
    venueRegion: z.string().optional(),
    venueCountry: z.string().optional(),
    isSeries: z.boolean().optional(),
  })
  .passthrough();

const pricingResultSchema = z
  .object({
    tier: policyTierSchema,
    payoutUSDC: numericStringSchema,
    premiumUSDC: numericStringSchema,
    pCancelBps: z.number(),
    expectedLossUSDC: numericStringSchema,
    reserveUtilizationBps: z.number(),
    riskBands: z
      .object({
        category: z.string(),
        capacityBand: capacityBandSchema,
        venueType: venueTypeBandSchema,
        organizerExperience: organizerExperienceBandSchema,
        venueRiskBand: geminiRiskBandSchema,
        complexityBand: geminiRiskBandSchema,
      })
      .strict(),
    riskBreakdownBps: z
      .object({
        category: z.number(),
        capacity: z.number(),
        venueType: z.number(),
        organizer: z.number(),
        venueRisk: z.number(),
        complexity: z.number(),
      })
      .strict(),
    loadBreakdownBps: z
      .object({
        expense: z.number(),
        profit: z.number(),
        utilization: z.number(),
        total: z.number(),
      })
      .strict(),
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
    insured: addressSchema,
    tier: policyTierSchema,
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

export const protocolResultSchema = z.union([
  quoteWorkflowOkSchema,
  mintWorkflowOkSchema,
  claimWorkflowOkSchema,
  workflowErrorSchema,
]);

export const workflowResultSchema = protocolResultSchema;

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
