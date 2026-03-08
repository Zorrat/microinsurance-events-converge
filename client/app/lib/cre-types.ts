export type PolicyTier = "BASIC" | "MEDIUM" | "ADVANCED";
export type GeminiRiskBand = "low" | "medium" | "high" | "unknown";
export type CapacityBand = "<50" | "50-199" | "200-1000" | ">1000" | "unknown";
export type VenueTypeBand = "online" | "offline" | "unknown";
export type OrganizerExperienceBand = "new" | "1-2" | "3-9" | "10-50" | ">50" | "unknown";

export type Quote = {
  quoteVersion: number;
  insured: `0x${string}`;
  eventId: string;
  eventIdHash: `0x${string}`;
  eventStart: number;
  coverageStart: number;
  coverageEnd: number;
  quoteExpiry: number;
  payoutUSDC: string;
  premiumUSDC: string;
  nonce: `0x${string}`;
};

export type SignedQuote = {
  quote: Quote;
  quoteHash: `0x${string}`;
  signature: `0x${string}`;
  signer: `0x${string}`;
};

export type QuoteCheckInput = {
  action: "QUOTE_CHECK";
  eventUrl: string;
  insured: string;
  tier: PolicyTier;
  nonce?: `0x${string}`;
};

export type MintInput = {
  action: "MINT";
  approved: boolean;
  signedQuote: SignedQuote;
};

export type ClaimInput = {
  action: "CLAIM";
  eventId: string;
  policyId: string;
};

export type WorkflowInput = QuoteCheckInput | MintInput | ClaimInput;

export type EventSummary = {
  eventId?: string;
  eventName?: string;
  eventUrl?: string;
  capacity?: number;
  onlineEvent?: boolean;
  salesStatus?: string;
  canceled?: boolean;
  eventStart?: number;
  eventEnd?: number;
  rawStatus?: string;
  categoryId?: string;
  categoryName?: string;
  subcategoryId?: string;
  subcategoryName?: string;
  organizerPastEvents?: number;
  organizerFutureEvents?: number;
  descriptionText?: string;
  venueName?: string;
  venueCity?: string;
  venueRegion?: string;
  venueCountry?: string;
  isSeries?: boolean;
};

export type PricingResult = {
  tier: PolicyTier;
  payoutUSDC: string;
  premiumUSDC: string;
  pCancelBps: number;
  expectedLossUSDC: string;
  reserveUtilizationBps: number;
  riskBands: {
    category: string;
    capacityBand: CapacityBand;
    venueType: VenueTypeBand;
    organizerExperience: OrganizerExperienceBand;
    venueRiskBand: GeminiRiskBand;
    complexityBand: GeminiRiskBand;
  };
  riskBreakdownBps: {
    category: number;
    capacity: number;
    venueType: number;
    organizer: number;
    venueRisk: number;
    complexity: number;
  };
  loadBreakdownBps: {
    expense: number;
    profit: number;
    utilization: number;
    total: number;
  };
};

export type QuoteWorkflowOk = {
  ok: true;
  action: "QUOTE_CHECK";
  quoteValid: boolean;
  reason?: string;
  event: EventSummary;
  canonicalEventId?: string;
  pricing?: PricingResult;
  warnings?: string[];
  signedQuote?: SignedQuote;
};

export type MintWorkflowOk = {
  ok: true;
  action: "MINT";
  txHash?: string;
  policyId?: string;
  tokenId?: string;
  policyNftAddress?: `0x${string}`;
  note: string;
};

export type ClaimWorkflowOk = {
  ok: true;
  action: "CLAIM";
  decision: "PAY" | "RESOLVE_NO_PAYOUT" | "NO_OP";
  txHash?: string;
  note: string;
  event: EventSummary;
};

export type WorkflowError = {
  ok: false;
  error: string;
};

export type WorkflowResult = QuoteWorkflowOk | MintWorkflowOk | ClaimWorkflowOk | WorkflowError;
