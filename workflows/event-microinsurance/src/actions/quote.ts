import {
  LAST_FINALIZED_BLOCK_NUMBER,
  bytesToHex,
  encodeCallMsg,
  type EVMClient,
  type HTTPClient,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, isAddress, zeroAddress } from "viem";

import type { Config, PolicyTier, Quote, QuoteCheckInput, WorkflowResult } from "../types";
import { CREReceiverABI, ERC20ABI, PolicyVaultABI } from "../abi";
import { fetchEventbriteEvent } from "../services/eventbrite";
import { assessGeminiRisk, assessGeminiRiskStub } from "../services/gemini";
import { computePricing } from "../services/pricing";
import { hashEventId, normalizeNonce, randomNonceHex, signQuote } from "../quotes";
import { mustHexAddress, nowSec, parseEventbriteEventIdFromUrl } from "../utils";

const toPolicyTier = (value: unknown): PolicyTier => {
  if (typeof value !== "string") throw new Error("INVALID_POLICY_TIER");
  const normalized = value.trim().toUpperCase();
  if (normalized === "BASIC" || normalized === "MEDIUM" || normalized === "ADVANCED") {
    return normalized;
  }
  throw new Error("INVALID_POLICY_TIER");
};

export const handleQuoteCheck = async (
  runtime: Runtime<Config>,
  httpClient: HTTPClient,
  evm: EVMClient,
  input: QuoteCheckInput,
  config: Config,
): Promise<WorkflowResult> => {
  try {
    // Quote path is read-only. All state mutation happens via CREReceiver reports in MINT/CLAIM.
    const QUOTE_TTL_SEC = 60 * 60;
    const COVERAGE_EXTENSION_SEC = 24 * 60 * 60;
    const insured = mustHexAddress(input.insured, "insured");
    const tier = toPolicyTier(input.tier);
    const receiver = mustHexAddress(config.receiver, "receiver");
    const rawEventUrl = input.eventUrl?.trim() ?? "";
    runtime.log(`[QUOTE_CHECK] eventUrl.raw=${rawEventUrl}`);

    const normalizedForParse = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawEventUrl)
      ? rawEventUrl
      : `https://${rawEventUrl}`;
    runtime.log(`[QUOTE_CHECK] eventUrl.normalized=${normalizedForParse}`);

    const digitCandidates = rawEventUrl.match(/[0-9]{6,}/g) ?? [];
    runtime.log(`[QUOTE_CHECK] eventUrl.digitCandidates=${digitCandidates.join(",") || "(none)"}`);

    let canonicalEventId: string;
    try {
      canonicalEventId = parseEventbriteEventIdFromUrl(rawEventUrl);
      runtime.log(`[QUOTE_CHECK] eventId.parsed=${canonicalEventId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      runtime.log(`[QUOTE_CHECK] eventId.parse-failed reason=${msg}`);
      throw e;
    }
    const readContractHex = (label: string, to: `0x${string}`, data: `0x${string}`): `0x${string}` => {
      const read = evm
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to,
            data,
          }),
          blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

      const dataHex = bytesToHex(read.data) as `0x${string}`;
      runtime.log(`[QUOTE_CHECK] evm.call label=${label} from=${zeroAddress} to=${to} data=${dataHex}`);
      if (dataHex === "0x") {
        throw new Error(`EVM_EMPTY_RESPONSE:${label} (verify receiver/contract address and chainSelectorName)`);
      }
      return dataHex;
    };
    const readAndDecode = (
      label: string,
      to: `0x${string}`,
      abi: any,
      functionName: string,
      args: readonly unknown[] = [],
    ): any => {
      const callData = encodeFunctionData({
        abi,
        functionName: functionName as any,
        args: args as any,
      });
      const dataHex = readContractHex(label, to, callData);
      runtime.log(`[QUOTE_CHECK] evm.read label=${label} to=${to} fn=${functionName} data=${dataHex}`);
      try {
        return decodeFunctionResult({
          abi,
          functionName: functionName as any,
          data: dataHex,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`EVM_DECODE_FAILED:${label}:${msg}`);
      }
    };

    const tNow = nowSec(runtime);
    const coverageStart = tNow;
    const quoteExpiry = tNow + QUOTE_TTL_SEC;

    const event = fetchEventbriteEvent(runtime, httpClient, canonicalEventId, config);
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
    const coverageEnd = coverageBoundary + COVERAGE_EXTENSION_SEC;

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

    const policyVault = readAndDecode("receiver.policyVault", receiver, CREReceiverABI, "policyVault");
    if (!isAddress(policyVault) || policyVault.toLowerCase() === zeroAddress) {
      throw new Error("INVALID_POLICY_VAULT_ADDRESS");
    }

    const requiredReserves = readAndDecode(
      "vault.requiredReserves",
      policyVault,
      PolicyVaultABI,
      "requiredReserves",
    );
    const totalActiveLiabilityUSDC = readAndDecode(
      "vault.totalActiveLiabilityUSDC",
      policyVault,
      PolicyVaultABI,
      "totalActiveLiabilityUSDC",
    );
    const minReserveRatioBps = readAndDecode(
      "vault.minReserveRatioBps",
      policyVault,
      PolicyVaultABI,
      "minReserveRatioBps",
    );
    const usdc = readAndDecode("vault.usdc", policyVault, PolicyVaultABI, "usdc");
    if (!isAddress(usdc) || usdc.toLowerCase() === zeroAddress) {
      throw new Error("INVALID_USDC_ADDRESS");
    }
    const vaultBalanceUSDC = readAndDecode("usdc.balanceOf(vault)", usdc, ERC20ABI, "balanceOf", [policyVault]);

    let gemini = assessGeminiRiskStub(event, config);
    if (config.gemini?.enabled === true) {
      try {
        gemini = assessGeminiRisk(runtime, httpClient, event, config);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        runtime.log(`[QUOTE_CHECK] gemini.live-fallback reason=${reason}`);
        warnings.push("GEMINI_FALLBACK_UNKNOWN");
        gemini = assessGeminiRiskStub(event, config);
      }
    }

    const pricing = computePricing({
      event,
      reserve: {
        requiredReserves: BigInt(requiredReserves),
        totalActiveLiabilityUSDC: BigInt(totalActiveLiabilityUSDC),
        minReserveRatioBps: BigInt(minReserveRatioBps),
        vaultBalanceUSDC: BigInt(vaultBalanceUSDC),
      },
      tier,
      gemini,
      pricing: config.pricing,
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

    const newLiability = BigInt(totalActiveLiabilityUSDC) + pricing.payoutUSDCBigInt;
    const requiredAfter = (newLiability * BigInt(minReserveRatioBps) + 9999n) / 10000n;
    if (BigInt(vaultBalanceUSDC) < requiredAfter) {
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
      quoteVersion: config.quoteVersion ?? 1,
      insured,
      eventId: resolvedEventId,
      eventIdHash: hashEventId(resolvedEventId),
      eventStart: event.eventStart ?? 0,
      coverageStart,
      coverageEnd,
      quoteExpiry,
      payoutUSDC: pricing.payoutUSDC,
      premiumUSDC: pricing.premiumUSDC,
      nonce: normalizeNonce(input.nonce ?? randomNonceHex(runtime)),
    };

    const signedQuote = await signQuote(runtime, quote, config);

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
  } catch (e: any) {
    try {
      const msg = e?.message ?? String(e);
      const stackTop = typeof e?.stack === "string" ? e.stack.split("\n")[0] : "";
      runtime.log(`[QUOTE_CHECK] error message=${msg}${stackTop ? ` stack=${stackTop}` : ""}`);
    } catch {}
    return { ok: false, error: e?.message ?? "QUOTE_CHECK_FAILED" };
  }
};
