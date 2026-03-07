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
  eventName: string;
  insured: string;
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
};

export type PricingResult = {
  computedPayoutUSDC: string;
  computedPremiumUSDC: string;
  pCancelBps: number;
  expectedLossUSDC: string;
  reserveUtilizationBps: number;
};

export type QuoteWorkflowOk = {
  ok: true;
  action: "QUOTE_CHECK";
  quoteValid: boolean;
  reason?: string;
  event: EventSummary;
  canonicalEventId?: string;
  eventNameMatch?: boolean;
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

export type WorkflowResult =
  | QuoteWorkflowOk
  | MintWorkflowOk
  | ClaimWorkflowOk
  | WorkflowError;
