import type { GeminiRuntimeConfig, PricingConfig } from "@/app/lib/protocol-types";

export const DEFAULT_EVENTBRITE_API_BASE_URL = "https://www.eventbriteapi.com/v3";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const DEFAULT_PRICING: PricingConfig = {
  tierPayoutUSDC: {
    BASIC: "10000000",
    MEDIUM: "100000000",
    ADVANCED: "1000000000",
  },
  tierMinPremiumUSDC: {
    BASIC: "400000",
    MEDIUM: "3000000",
    ADVANCED: "20000000",
  },
  categoryRiskById: {
    "101": 400,
    "102": 400,
    "103": 550,
    "104": 400,
    "105": 400,
    "106": 300,
    "107": 300,
    "108": 450,
    "109": 450,
    "110": 300,
    "111": 300,
    "112": 300,
    "113": 300,
    "114": 300,
    "115": 200,
    "116": 700,
    "117": 300,
    "118": 300,
    "119": 300,
    "120": 200,
    "199": 300,
  },
  categoryRiskByName: {
    business: 400,
    "science & tech": 400,
    music: 550,
    "sports & fitness": 450,
    "travel & outdoor": 450,
    "family & education": 200,
    education: 200,
    "seasonal & holiday": 700,
    "community & culture": 300,
    meetup: 300,
    networking: 300,
    conference: 400,
    festival: 700,
  },
  defaultCategoryRiskBps: 200,
  minCancelBps: 200,
  maxCancelBps: 2000,
  venueTypeRiskBps: {
    online: 0,
    offline: 50,
    unknown: 80,
  },
  organizerRiskBps: {
    new: 120,
    oneToTwo: 80,
    threeToNine: 0,
    tenToFifty: -60,
    aboveFifty: -120,
  },
  venueRiskBandBps: {
    low: 0,
    medium: 60,
    high: 150,
    unknown: 30,
  },
  complexityBandBps: {
    low: 0,
    medium: 60,
    high: 120,
    unknown: 40,
  },
  expenseLoadBps: 1000,
  profitLoadBps: 500,
  utilizationBandLowBps: 5000,
  utilizationBandMediumBps: 7000,
  utilizationRejectBps: 8500,
  utilizationLoadBps50To70: 500,
  utilizationLoadBps70To85: 1000,
};

export const DEFAULT_GEMINI_CONFIG: GeminiRuntimeConfig = {
  enabled: false,
  model: DEFAULT_GEMINI_MODEL,
  baseUrl: DEFAULT_GEMINI_BASE_URL,
  timeoutMs: 7000,
  maxRetries: 1,
  defaultVenueRiskBand: "unknown",
  defaultComplexityBand: "unknown",
};

