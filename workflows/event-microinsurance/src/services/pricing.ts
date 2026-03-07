import type { EventSummary, PricingConfig, PricingResult } from "../types";

export type ReserveSnapshot = {
  requiredReserves: bigint;
  totalActiveLiabilityUSDC: bigint;
  minReserveRatioBps: bigint;
  vaultBalanceUSDC: bigint;
};

export type PricingInput = {
  event: EventSummary;
  reserve: ReserveSnapshot;
  nowSec: number;
  geminiOrdinal?: number;
  pricing?: PricingConfig;
};

export type PricingComputation = PricingResult & {
  payoutUSDC: bigint;
  premiumUSDC: bigint;
};

const DEFAULT_PRICING: PricingConfig = {
  capacityThresholds: [200, 1000],
  payoutTiersUSDC: ["10000000", "25000000", "50000000"],

  baseCancelBps: 200,
  minCancelBps: 50,
  maxCancelBps: 2000,

  capacityWeightBps: 70,
  modeWeightBps: 30,
  timeWeightBps: 50,
  salesWeightBps: 40,
  geminiWeightBps: 60,

  expenseLoadBps: 800,
  profitLoadBps: 600,
  reserveUtilizationTriggerBps: 8000,
  reserveLoadSlopeBps: 2000,

  flatFeeUSDC: "500000",
  minPremiumUSDC: "1000000",
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

const capacityTier = (capacity: number | undefined, cfg: PricingConfig): number => {
  if (!capacity || capacity <= 0) return 0;
  const thresholds = [...cfg.capacityThresholds].sort((a, b) => a - b);
  for (let i = 0; i < thresholds.length; i += 1) {
    if (capacity <= thresholds[i]) return i;
  }
  return thresholds.length;
};

const salesOrdinal = (status: string | undefined): number => {
  const s = (status ?? "").toLowerCase();
  if (s === "sold_out" || s === "sales_ended") return 2;
  if (s === "not_yet_on_sale" || s === "unavailable") return 1;
  return 0;
};

const timeOrdinal = (eventStart: number | undefined, nowSec: number): number => {
  if (!eventStart) return 0;
  const hours = (eventStart - nowSec) / 3600;
  if (hours <= 24) return 2;
  if (hours <= 24 * 7) return 1;
  return 0;
};

export const computePricing = (input: PricingInput): PricingComputation => {
  const cfg = { ...DEFAULT_PRICING, ...(input.pricing ?? {}) };
  if (cfg.payoutTiersUSDC.length === 0) throw new Error("pricing.payoutTiersUSDC must not be empty");

  const tier = Math.min(capacityTier(input.event.capacity, cfg), cfg.payoutTiersUSDC.length - 1);
  const payoutUSDC = BigInt(cfg.payoutTiersUSDC[tier]);

  const capacityOrd = tier;
  const modeOrd = input.event.onlineEvent === true ? 1 : 0;
  const timeOrd = timeOrdinal(input.event.eventStart, input.nowSec);
  const salesOrd = salesOrdinal(input.event.salesStatus);
  const geminiOrd = Math.max(0, input.geminiOrdinal ?? 0);

  const pCancelRaw =
    cfg.baseCancelBps +
    cfg.capacityWeightBps * capacityOrd +
    cfg.modeWeightBps * modeOrd +
    cfg.timeWeightBps * timeOrd +
    cfg.salesWeightBps * salesOrd +
    cfg.geminiWeightBps * geminiOrd;
  const pCancelBps = clampInt(pCancelRaw, cfg.minCancelBps, cfg.maxCancelBps);

  const expectedLossUSDC = mulDivCeil(payoutUSDC, BigInt(pCancelBps), BPS);

  const reserveUtilizationBpsBig =
    input.reserve.vaultBalanceUSDC > 0n
      ? mulDivCeil(input.reserve.requiredReserves, BPS, input.reserve.vaultBalanceUSDC)
      : 1_000_000n;

  const trigger = BigInt(cfg.reserveUtilizationTriggerBps);
  const utilizationExcess = reserveUtilizationBpsBig > trigger ? reserveUtilizationBpsBig - trigger : 0n;
  const reserveLoadBps = mulDivCeil(utilizationExcess, BigInt(cfg.reserveLoadSlopeBps), BPS);

  const totalLoadBps = BigInt(cfg.expenseLoadBps) + BigInt(cfg.profitLoadBps) + reserveLoadBps;
  const loadedLossUSDC = mulDivCeil(expectedLossUSDC, BPS + totalLoadBps, BPS);
  const premiumWithFee = loadedLossUSDC + BigInt(cfg.flatFeeUSDC);
  const minPremium = BigInt(cfg.minPremiumUSDC);
  const premiumUSDC = premiumWithFee > minPremium ? premiumWithFee : minPremium;

  return {
    payoutUSDC,
    premiumUSDC,
    computedPayoutUSDC: payoutUSDC.toString(),
    computedPremiumUSDC: premiumUSDC.toString(),
    pCancelBps,
    expectedLossUSDC: expectedLossUSDC.toString(),
    reserveUtilizationBps: toSafeNumber(reserveUtilizationBpsBig),
  };
};
