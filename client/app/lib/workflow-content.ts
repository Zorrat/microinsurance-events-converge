export const WORKFLOW_STAGE_ORDER = ["quote", "buy", "claim"] as const;

export type WorkflowStageKey = (typeof WORKFLOW_STAGE_ORDER)[number];

export type WorkflowExplanationBlock = {
  label: string;
  title: string;
  body: string;
  chips: string[];
};

export type WorkflowStageContent = {
  key: WorkflowStageKey;
  order: number;
  navTitle: string;
  landingDescription: string;
  consoleSummary: string;
  explanation: WorkflowExplanationBlock;
  operatorChecks: string[];
};

export const WORKFLOW_STAGE_CONTENT: Record<WorkflowStageKey, WorkflowStageContent> = {
  quote: {
    key: "quote",
    order: 1,
    navTitle: "Quote",
    landingDescription:
      "Collect event inputs, run deterministic checks, and return signed quote terms that can be minted.",
    consoleSummary:
      "Run quote validation to produce signed policy terms and a canonical event identity.",
    explanation: {
      label: "Stage Intent",
      title: "Issue verifiable quote terms",
      body:
        "This stage validates event data and insured wallet context before returning a signed quote package with payout, premium, and expiry fields.",
      chips: ["POST /api/quote", "x402 fee paid", "Creates signedQuote payload"],
    },
    operatorChecks: [
      "Confirm payment preview (network, receiver, amount) before signing.",
      "Inspect quote validity and warnings in the response chips.",
      "Reuse canonical event ID in downstream claim requests.",
    ],
  },
  buy: {
    key: "buy",
    order: 2,
    navTitle: "Buy / Mint",
    landingDescription:
      "Submit the signed quote, pass reserve and integrity checks, and mint an active nontransferable policy NFT.",
    consoleSummary:
      "Submit signed quote terms to mint policy ownership on Base Sepolia.",
    explanation: {
      label: "Stage Intent",
      title: "Convert quote into active policy",
      body:
        "Mint execution verifies signed quote integrity and expiry, then commits policy state through the CRE-controlled settlement path.",
      chips: ["POST /api/buy", "Requires quoteValid=true", "Returns policyId + txHash"],
    },
    operatorChecks: [
      "Only proceed when quote stage returns quoteValid=true.",
      "Track policyId output for later claim actions.",
      "Verify mint transaction hash on BaseScan.",
    ],
  },
  claim: {
    key: "claim",
    order: 3,
    navTitle: "Claim",
    landingDescription:
      "Check event cancellation status against policy context and resolve onchain to PAY or RESOLVE deterministically.",
    consoleSummary:
      "Evaluate policy + event inputs and settle outcome through the claim workflow action.",
    explanation: {
      label: "Stage Intent",
      title: "Settle policy outcome",
      body:
        "Claim execution evaluates cancellation conditions and routes a deterministic decision that updates policy status and payout state.",
      chips: ["POST /api/claim", "Requires policyId + eventId", "Decision: PAY or RESOLVE"],
    },
    operatorChecks: [
      "Use wallet policy detector to reduce manual policy lookup errors.",
      "Keep event ID aligned with the minted policy context.",
      "Record final decision and settlement transaction hash.",
    ],
  },
};

export const WORKFLOW_LANDING_FLOW = WORKFLOW_STAGE_ORDER.map((stageKey) => {
  const stage = WORKFLOW_STAGE_CONTENT[stageKey];
  return {
    title: stage.navTitle,
    description: stage.landingDescription,
  };
});
