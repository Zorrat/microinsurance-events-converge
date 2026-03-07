export type Config = {
  chainFamily: "evm";
  chainSelectorName: string;
  isTestnet: boolean;
  receiver: string;
  authorizedKeys: { type: "KEY_TYPE_ECDSA_EVM"; publicKey: string }[];

  eventbriteApiBaseUrl: string;
  eventbriteApiTokenSecretName: string;
  quoteSignerPrivateKeySecretName: string;

  secretsNamespace?: string;
  quoteSignerAddress?: `0x${string}`;
  quoteVersion?: number;

  pricing?: PricingConfig;
  gemini?: GeminiConfig;
};

export type PricingConfig = {
  capacityThresholds: number[];
  payoutTiersUSDC: string[];

  baseCancelBps: number;
  minCancelBps: number;
  maxCancelBps: number;

  capacityWeightBps: number;
  modeWeightBps: number;
  timeWeightBps: number;
  salesWeightBps: number;
  geminiWeightBps: number;

  expenseLoadBps: number;
  profitLoadBps: number;
  reserveUtilizationTriggerBps: number;
  reserveLoadSlopeBps: number;

  flatFeeUSDC: string;
  minPremiumUSDC: string;
};

export type GeminiConfig = {
  enabled?: boolean;
  defaultRiskOrdinal?: number;
};

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

export type WorkflowResult =
  | {
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
    }
  | {
      ok: true;
      action: "MINT";
      txHash?: string;
      policyId?: string;
      tokenId?: string;
      policyNftAddress?: `0x${string}`;
      note: string;
    }
  | {
      ok: true;
      action: "CLAIM";
      decision: "PAY" | "RESOLVE_NO_PAYOUT" | "NO_OP";
      txHash?: string;
      note: string;
      event: EventSummary;
    }
  | { ok: false; error: string };

export type MintData = {
  to: `0x${string}`;
  eventId: string;
  eventIdHash: `0x${string}`;
  eventStart: bigint;
  coverageStart: bigint;
  coverageEnd: bigint;
  quoteExpiry: bigint;
  payoutUSDC: bigint;
  premiumUSDC: bigint;
};

export type ReportData = {
  action: 0 | 1 | 2;
  policyId: bigint;
  mint: MintData;
};
