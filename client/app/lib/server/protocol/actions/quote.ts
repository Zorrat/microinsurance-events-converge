import type {
  GeminiRuntimeConfig,
  PolicyTier,
  PricingConfig,
  ProtocolResult,
  Quote,
  QuoteCheckInput,
} from "@/app/lib/protocol-types";

import { defaultGeminiAssessment, assessGeminiRisk } from "../gemini";
import { fetchEventbriteEvent } from "../eventbrite";
import type { ContractsGateway } from "../evm";
import { computePricing } from "../pricing";
import { normalizeNonce, signQuote } from "../quotes";
import { hashEventId, mustHexAddress, nowSec, parseEventbriteEventIdFromUrl, randomNonceHex } from "../utils";

const BPS = BigInt(10_000);
const ROUND_UP_BPS = BigInt(9_999);

export type QuoteActionDeps = {
  gateway: ContractsGateway;
  eventbriteApiToken: string;
  eventbriteApiBaseUrl: string;
  quoteSignerPrivateKey: `0x${string}`;
  quoteSignerAddress?: `0x${string}`;
  quoteVersion: number;
  pricingConfig: PricingConfig;
  geminiConfig: GeminiRuntimeConfig;
  getNowSec?: () => number;
  fetchEventbriteEventImpl?: typeof fetchEventbriteEvent;
  assessGeminiRiskImpl?: typeof assessGeminiRisk;
  signQuoteImpl?: typeof signQuote;
};

const toPolicyTier = (value: unknown): PolicyTier => {
  if (typeof value !== "string") throw new Error("INVALID_POLICY_TIER");
  const normalized = value.trim().toUpperCase();
  if (normalized === "BASIC" || normalized === "MEDIUM" || normalized === "ADVANCED") return normalized;
  throw new Error("INVALID_POLICY_TIER");
};

export const handleQuoteCheck = async (
  input: QuoteCheckInput,
  deps: QuoteActionDeps,
): Promise<ProtocolResult> => {
  try {
    const quoteTtlSec = 60 * 60;
    const coverageExtensionSec = 24 * 60 * 60;
    const insured = mustHexAddress(input.insured, "insured");
    const tier = toPolicyTier(input.tier);
    const now = deps.getNowSec?.() ?? nowSec();
    const coverageStart = now;
    const quoteExpiry = now + quoteTtlSec;
    const canonicalEventId = parseEventbriteEventIdFromUrl(input.eventUrl?.trim() ?? "");

    const fetchEventbriteEventImpl = deps.fetchEventbriteEventImpl ?? fetchEventbriteEvent;
    const event = await fetchEventbriteEventImpl(canonicalEventId, deps.eventbriteApiToken, deps.eventbriteApiBaseUrl);
    const resolvedEventId = event.eventId ?? canonicalEventId;

    if (event.canceled === true) {
      return {
        ok: true,
        action: "QUOTE_CHECK",
        quoteValid: false,
        reason: "EVENT_ALREADY_CANCELED",
        event,
        canonicalEventId: resolvedEventId,
      };
    }

    const coverageBoundary = event.eventEnd ?? event.eventStart;
    if (coverageBoundary === undefined) {
      return {
        ok: true,
        action: "QUOTE_CHECK",
        quoteValid: false,
        reason: "EVENT_TIME_UNAVAILABLE",
        event,
        canonicalEventId: resolvedEventId,
      };
    }

    const coverageEnd = coverageBoundary + coverageExtensionSec;
    if (coverageEnd <= coverageStart) {
      return {
        ok: true,
        action: "QUOTE_CHECK",
        quoteValid: false,
        reason: "COVERAGE_WINDOW_ALREADY_PASSED",
        event,
        canonicalEventId: resolvedEventId,
      };
    }

    const warnings: string[] = [];
    const reserveSnapshot = await deps.gateway.getReserveSnapshot();

    const assessGeminiRiskImpl = deps.assessGeminiRiskImpl ?? assessGeminiRisk;
    let gemini = defaultGeminiAssessment(deps.geminiConfig);
    if (deps.geminiConfig.enabled) {
      try {
        gemini = await assessGeminiRiskImpl(event, deps.geminiConfig);
      } catch {
        warnings.push("GEMINI_FALLBACK_UNKNOWN");
        gemini = defaultGeminiAssessment(deps.geminiConfig);
      }
    }

    const pricing = computePricing({
      event,
      reserve: reserveSnapshot,
      tier,
      gemini,
      pricing: deps.pricingConfig,
    });

    const pricingResult = {
      tier: pricing.tier,
      payoutUSDC: pricing.payoutUSDC,
      premiumUSDC: pricing.premiumUSDC,
      pCancelBps: pricing.pCancelBps,
      expectedLossUSDC: pricing.expectedLossUSDC,
      reserveUtilizationBps: pricing.reserveUtilizationBps,
      riskBands: pricing.riskBands,
      riskBreakdownBps: pricing.riskBreakdownBps,
      loadBreakdownBps: pricing.loadBreakdownBps,
    };

    if (pricing.utilizationRejected) {
      return {
        ok: true,
        action: "QUOTE_CHECK",
        quoteValid: false,
        reason: "VAULT_UTILIZATION_TOO_HIGH",
        event,
        canonicalEventId: resolvedEventId,
        pricing: pricingResult,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }

    const newLiability = reserveSnapshot.totalActiveLiabilityUSDC + pricing.payoutUSDCBigInt;
    const requiredAfter = (newLiability * reserveSnapshot.minReserveRatioBps + ROUND_UP_BPS) / BPS;
    if (reserveSnapshot.vaultBalanceUSDC < requiredAfter) {
      return {
        ok: true,
        action: "QUOTE_CHECK",
        quoteValid: false,
        reason: "INSUFFICIENT_RESERVES_FOR_PAYOUT",
        event,
        canonicalEventId: resolvedEventId,
        pricing: pricingResult,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }

    const quote: Quote = {
      quoteVersion: deps.quoteVersion,
      insured,
      eventId: resolvedEventId,
      eventIdHash: hashEventId(resolvedEventId),
      eventStart: event.eventStart ?? 0,
      coverageStart,
      coverageEnd,
      quoteExpiry,
      payoutUSDC: pricing.payoutUSDC,
      premiumUSDC: pricing.premiumUSDC,
      nonce: normalizeNonce(input.nonce ?? randomNonceHex()),
    };

    const signQuoteImpl = deps.signQuoteImpl ?? signQuote;
    const signedQuote = await signQuoteImpl(quote, deps.quoteSignerPrivateKey, deps.quoteSignerAddress);

    return {
      ok: true,
      action: "QUOTE_CHECK",
      quoteValid: true,
      event,
      canonicalEventId: resolvedEventId,
      pricing: pricingResult,
      ...(warnings.length > 0 ? { warnings } : {}),
      signedQuote,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "QUOTE_CHECK_FAILED",
    };
  }
};
