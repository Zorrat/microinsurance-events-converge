import type {
  CapacityBand,
  EventSummary,
  GeminiRiskBand,
  OrganizerExperienceBand,
  PolicyTier,
  PricingConfig,
  PricingResult,
  ReserveSnapshot,
  VenueTypeBand,
} from "@/app/lib/protocol-types";

import { DEFAULT_PRICING } from "./defaults";

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BPS = BigInt(10_000);
const MAX_SAFE_OUTPUT = BigInt(1_000_000_000);
const UTILIZATION_FALLBACK = BigInt(1_000_000);

export type GeminiRiskAssessment = {
  venueRiskBand: GeminiRiskBand;
  complexityBand: GeminiRiskBand;
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

const clampInt = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const mulDivCeil = (a: bigint, b: bigint, denominator: bigint): bigint => {
  if (denominator <= BIGINT_ZERO) throw new Error("denominator must be > 0");
  return (a * b + denominator - BIGINT_ONE) / denominator;
};

const toSafeNumber = (value: bigint): number => {
  const clipped = value > MAX_SAFE_OUTPUT ? MAX_SAFE_OUTPUT : value < BIGINT_ZERO ? BIGINT_ZERO : value;
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
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeMapKey(value));

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
    input.reserve.vaultBalanceUSDC > BIGINT_ZERO
      ? mulDivCeil(input.reserve.requiredReserves, BPS, input.reserve.vaultBalanceUSDC)
      : UTILIZATION_FALLBACK;

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
