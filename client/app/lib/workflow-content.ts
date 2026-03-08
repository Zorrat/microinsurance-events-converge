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
      "Enter your event and get a quick quote showing premium and payout before you buy coverage.",
    consoleSummary:
      "Check event eligibility and see premium and payout terms.",
    explanation: {
      label: "How It Works",
      title: "Check your quote terms",
      body:
        "We verify the event data and return quote terms you can use to buy coverage in the next step.",
      chips: ["Step 1", "Quote check", "Fee in USDC"],
    },
    operatorChecks: [
      "Paste a valid Eventbrite URL.",
      "Pick the policy tier that matches the coverage you want.",
      "After the quote returns, review approved status, premium, and payout.",
    ],
  },
  buy: {
    key: "buy",
    order: 2,
    navTitle: "Buy / Mint",
    landingDescription:
      "Use the approved quote to mint your policy NFT and activate coverage.",
    consoleSummary:
      "Mint policy ownership from your approved quote.",
    explanation: {
      label: "How It Works",
      title: "Mint your policy NFT",
      body:
        "If your quote is approved and valid, this step mints coverage and assigns a policy NFT to your wallet.",
      chips: ["Step 2", "Buy coverage", "Creates policy NFT"],
    },
    operatorChecks: [
      "Run this step only after quote approval.",
      "Save your Policy ID and NFT ID for future reference.",
      "Use the wallet import button to add the NFT to MetaMask.",
    ],
  },
  claim: {
    key: "claim",
    order: 3,
    navTitle: "Claim",
    landingDescription:
      "Check event outcome and settle the policy as payout or no-payout.",
    consoleSummary:
      "Submit claim settlement for your selected policy.",
    explanation: {
      label: "How It Works",
      title: "Settle your claim",
      body:
        "We compare your policy and event status, then return one of three outcomes: payout, no payout, or pending.",
      chips: ["Step 3", "Claim check", "Outcome decision"],
    },
    operatorChecks: [
      "Select the right policy from wallet detection.",
      "Confirm event ID matches the selected policy.",
      "Review the final claim decision card after submission.",
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
