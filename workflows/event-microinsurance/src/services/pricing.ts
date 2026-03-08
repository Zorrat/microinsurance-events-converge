import type {
  CapacityBand,
  EventSummary,
  GeminiRiskBand,
  OrganizerExperienceBand,
  PolicyTier,
  PricingConfig,
  PricingResult,
  VenueTypeBand,
} from "../types";
import type { GeminiRiskAssessment } from "./gemini";

export type ReserveSnapshot = {
  requiredReserves: bigint;
  totalActiveLiabilityUSDC: bigint;
  minReserveRatioBps: bigint;
  vaultBalanceUSDC: bigint;
};

export type PricingInput = {
  event: EventSummary;
  reserve: ReserveSnapshot;
  tier: PolicyTier;
  gemini: GeminiRiskAssessment;
  pricing?: PricingConfig;
};

export type PricingComputation = PricingResult & {
  payoutUSDCBigInt: bigint;
  premiumUSDCBigInt: bigint;
  utilizationRejected: boolean;
};

const DEFAULT_PRICING: PricingConfig = {
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

const BPS = 10_000n;

const clampInt = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const mulDivCeil = (a: bigint, b: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error("denominator must be > 0");
  return (a * b + denominator - 1n) / denominator;
};

const toSafeNumber = (value: bigint): number => {
  const max = 1_000_000_000n;
  const clipped = value > max ? max : value < 0n ? 0n : value;
  return Number(clipped);
};

const normalizeMapKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const categoryRisk = (
  event: EventSummary,
  cfg: PricingConfig,
): {
  categoryRiskBps: number;
  categoryBand: string;
} => {
  const byId = cfg.categoryRiskById ?? {};
  const byName = cfg.categoryRiskByName ?? {};
  const defaultRisk = cfg.defaultCategoryRiskBps ?? 200;

  if (typeof event.categoryId === "string" && event.categoryId.length > 0) {
    const fromId = byId[event.categoryId];
    if (typeof fromId === "number") {
      return {
        categoryRiskBps: fromId,
        categoryBand: event.categoryName ?? event.categoryId,
      };
    }
  }

  const namesToTry = [event.categoryName, event.subcategoryName]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => normalizeMapKey(v));

  for (const key of namesToTry) {
    const fromName = byName[key];
    if (typeof fromName === "number") {
      return {
        categoryRiskBps: fromName,
        categoryBand: event.categoryName ?? event.subcategoryName ?? key,
      };
    }
  }

  return {
    categoryRiskBps: defaultRisk,
    categoryBand: event.categoryName ?? event.categoryId ?? "unknown",
  };
};

const capacityRisk = (capacity: number | undefined): { capacityRiskBps: number; capacityBand: CapacityBand } => {
  if (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity < 0) {
    return { capacityRiskBps: 0, capacityBand: "unknown" };
  }

  if (capacity < 50) return { capacityRiskBps: 0, capacityBand: "<50" };
  if (capacity < 200) return { capacityRiskBps: 50, capacityBand: "50-199" };
  if (capacity <= 1000) return { capacityRiskBps: 120, capacityBand: "200-1000" };
  return { capacityRiskBps: 200, capacityBand: ">1000" };
};

const venueTypeRisk = (
  onlineEvent: boolean | undefined,
  cfg: PricingConfig,
): { venueTypeRiskBps: number; venueTypeBand: VenueTypeBand } => {
  const venueCfg = cfg.venueTypeRiskBps ?? DEFAULT_PRICING.venueTypeRiskBps!;
  if (onlineEvent === true) return { venueTypeRiskBps: venueCfg.online, venueTypeBand: "online" };
  if (onlineEvent === false) return { venueTypeRiskBps: venueCfg.offline, venueTypeBand: "offline" };
  return { venueTypeRiskBps: venueCfg.unknown, venueTypeBand: "unknown" };
};

const organizerRisk = (
  past: number | undefined,
  future: number | undefined,
  cfg: PricingConfig,
): { organizerRiskBps: number; organizerExperienceBand: OrganizerExperienceBand } => {
  const organizerCfg = cfg.organizerRiskBps ?? DEFAULT_PRICING.organizerRiskBps!;

  const hasPast = typeof past === "number" && Number.isFinite(past) && past >= 0;
  const hasFuture = typeof future === "number" && Number.isFinite(future) && future >= 0;

  if (!hasPast && !hasFuture) {
    return { organizerRiskBps: organizerCfg.new, organizerExperienceBand: "new" };
  }

  const total = Math.max(0, hasPast ? Math.floor(past!) : 0) + Math.max(0, hasFuture ? Math.floor(future!) : 0);

  if (total <= 0) return { organizerRiskBps: organizerCfg.new, organizerExperienceBand: "new" };
  if (total <= 2) return { organizerRiskBps: organizerCfg.oneToTwo, organizerExperienceBand: "1-2" };
  if (total <= 9) return { organizerRiskBps: organizerCfg.threeToNine, organizerExperienceBand: "3-9" };
  if (total <= 50) return { organizerRiskBps: organizerCfg.tenToFifty, organizerExperienceBand: "10-50" };
  return { organizerRiskBps: organizerCfg.aboveFifty, organizerExperienceBand: ">50" };
};

const bandRisk = (map: Record<GeminiRiskBand, number>, band: GeminiRiskBand): number => {
  const fromMap = map[band];
  if (typeof fromMap === "number") return fromMap;
  return map.unknown ?? 0;
};

export const computePricing = (input: PricingInput): PricingComputation => {
  const cfg = { ...DEFAULT_PRICING, ...(input.pricing ?? {}) };

  const payoutRaw = cfg.tierPayoutUSDC[input.tier];
  const minPremiumRaw = cfg.tierMinPremiumUSDC[input.tier];
  if (!payoutRaw) throw new Error(`pricing.tierPayoutUSDC missing for tier=${input.tier}`);
  if (!minPremiumRaw) throw new Error(`pricing.tierMinPremiumUSDC missing for tier=${input.tier}`);

  const payoutUSDC = BigInt(payoutRaw);

  const { categoryRiskBps, categoryBand } = categoryRisk(input.event, cfg);
  const { capacityRiskBps, capacityBand } = capacityRisk(input.event.capacity);
  const { venueTypeRiskBps, venueTypeBand } = venueTypeRisk(input.event.onlineEvent, cfg);
  const { organizerRiskBps, organizerExperienceBand } = organizerRisk(
    input.event.organizerPastEvents,
    input.event.organizerFutureEvents,
    cfg,
  );

  const venueRiskBandBpsMap = cfg.venueRiskBandBps ?? DEFAULT_PRICING.venueRiskBandBps!;
  const complexityBandBpsMap = cfg.complexityBandBps ?? DEFAULT_PRICING.complexityBandBps!;

  const venueRiskBps = bandRisk(venueRiskBandBpsMap, input.gemini.venueRiskBand);
  const complexityRiskBps = bandRisk(complexityBandBpsMap, input.gemini.complexityBand);

  const pCancelRaw =
    categoryRiskBps +
    capacityRiskBps +
    venueTypeRiskBps +
    organizerRiskBps +
    venueRiskBps +
    complexityRiskBps;

  const pCancelBps = clampInt(pCancelRaw, cfg.minCancelBps ?? 200, cfg.maxCancelBps ?? 2000);

  const expectedLossUSDC = mulDivCeil(payoutUSDC, BigInt(pCancelBps), BPS);

  const reserveUtilizationBpsBig =
    input.reserve.vaultBalanceUSDC > 0n
      ? mulDivCeil(input.reserve.requiredReserves, BPS, input.reserve.vaultBalanceUSDC)
      : 1_000_000n;

  const reserveUtilizationBps = toSafeNumber(reserveUtilizationBpsBig);

  const utilizationBandLowBps = cfg.utilizationBandLowBps ?? 5000;
  const utilizationBandMediumBps = cfg.utilizationBandMediumBps ?? 7000;
  const utilizationRejectBps = cfg.utilizationRejectBps ?? 8500;

  const utilizationLoadBps =
    reserveUtilizationBps >= utilizationBandMediumBps
      ? (cfg.utilizationLoadBps70To85 ?? 1000)
      : reserveUtilizationBps >= utilizationBandLowBps
        ? (cfg.utilizationLoadBps50To70 ?? 500)
        : 0;

  const utilizationRejected = reserveUtilizationBps >= utilizationRejectBps;

  const loadBreakdownBps = {
    expense: cfg.expenseLoadBps,
    profit: cfg.profitLoadBps,
    utilization: utilizationLoadBps,
    total: cfg.expenseLoadBps + cfg.profitLoadBps + utilizationLoadBps,
  };

  const loadedLossUSDC = mulDivCeil(expectedLossUSDC, BPS + BigInt(loadBreakdownBps.total), BPS);
  const minPremiumUSDC = BigInt(minPremiumRaw);
  const premiumUSDC = loadedLossUSDC > minPremiumUSDC ? loadedLossUSDC : minPremiumUSDC;

  return {
    tier: input.tier,
    payoutUSDCBigInt: payoutUSDC,
    premiumUSDCBigInt: premiumUSDC,
    utilizationRejected,
    pCancelBps,
    expectedLossUSDC: expectedLossUSDC.toString(),
    reserveUtilizationBps,
    riskBands: {
      category: categoryBand,
      capacityBand,
      venueType: venueTypeBand,
      organizerExperience: organizerExperienceBand,
      venueRiskBand: input.gemini.venueRiskBand,
      complexityBand: input.gemini.complexityBand,
    },
    riskBreakdownBps: {
      category: categoryRiskBps,
      capacity: capacityRiskBps,
      venueType: venueTypeRiskBps,
      organizer: organizerRiskBps,
      venueRisk: venueRiskBps,
      complexity: complexityRiskBps,
    },
    loadBreakdownBps,
    payoutUSDC: payoutUSDC.toString(),
    premiumUSDC: premiumUSDC.toString(),
  };
};
