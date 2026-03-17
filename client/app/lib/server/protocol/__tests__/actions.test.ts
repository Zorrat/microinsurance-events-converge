import { describe, expect, it, vi } from "vitest";

import type { ContractsGateway } from "@/app/lib/server/protocol/evm";
import { handleClaim } from "@/app/lib/server/protocol/actions/claim";
import { handleMint } from "@/app/lib/server/protocol/actions/mint";
import { handleQuoteCheck } from "@/app/lib/server/protocol/actions/quote";
import { signQuote } from "@/app/lib/server/protocol/quotes";

import {
  BASE_RESERVE,
  LIVE_EVENT_SUMMARY,
  POLICY_NFT_ADDRESS,
  POLICY_VAULT_ADDRESS,
  QUOTE_SIGNER_ADDRESS,
  QUOTE_SIGNER_PRIVATE_KEY,
  RECEIVER_ADDRESS,
} from "./fixtures";

const fixedNow = 1800000000;
const claimTxHash = `0x${"12".repeat(32)}` as const;

const createGateway = (overrides: Partial<ContractsGateway> = {}): ContractsGateway => ({
  getReceiverTargets: async () => ({
    receiver: RECEIVER_ADDRESS,
    forwarder: RECEIVER_ADDRESS,
    policyNft: POLICY_NFT_ADDRESS,
    policyVault: POLICY_VAULT_ADDRESS,
    relayAddress: RECEIVER_ADDRESS,
  }),
  getReserveSnapshot: async () => BASE_RESERVE,
  getMintContext: async () => ({
    receiver: RECEIVER_ADDRESS,
    forwarder: RECEIVER_ADDRESS,
    policyNft: POLICY_NFT_ADDRESS,
    policyVault: POLICY_VAULT_ADDRESS,
    relayAddress: RECEIVER_ADDRESS,
    nextPolicyId: BigInt(7),
  }),
  getNextPolicyId: async () => BigInt(7),
  getPolicy: async () => ({
    eventIdHash: `0x${"11".repeat(32)}` as const,
    eventId: LIVE_EVENT_SUMMARY.eventId!,
    eventStart: BigInt(1700000000),
    coverageStart: BigInt(1700000100),
    coverageEnd: BigInt(1700007200),
    quoteExpiry: BigInt(1900000000),
    payoutUSDC: BigInt(10000000),
    premiumUSDC: BigInt(400000),
    insured: LIVE_EVENT_SUMMARY.eventId ? RECEIVER_ADDRESS : RECEIVER_ADDRESS,
    status: 1,
  }),
  submitReport: async () => ({ txHash: claimTxHash }),
  ...overrides,
});

const createSignedQuote = async (overrides: Partial<Parameters<typeof signQuote>[0]> = {}) => {
  const quote = {
    quoteVersion: 1,
    insured: RECEIVER_ADDRESS,
    eventId: LIVE_EVENT_SUMMARY.eventId!,
    eventIdHash: `0x${"22".repeat(32)}` as `0x${string}`,
    eventStart: LIVE_EVENT_SUMMARY.eventStart!,
    coverageStart: fixedNow,
    coverageEnd: LIVE_EVENT_SUMMARY.eventEnd! + 86400,
    quoteExpiry: fixedNow + 3600,
    payoutUSDC: "10000000",
    premiumUSDC: "400000",
    nonce: `0x${"33".repeat(32)}` as `0x${string}`,
    ...overrides,
  };
  quote.eventIdHash =
    overrides.eventIdHash ??
    (`0x${"".padStart(64, "0")}` as `0x${string}`);
  const { hashEventId } = await import("@/app/lib/server/protocol/utils");
  quote.eventIdHash = overrides.eventIdHash ?? hashEventId(quote.eventId);
  return signQuote(quote, QUOTE_SIGNER_PRIVATE_KEY, QUOTE_SIGNER_ADDRESS);
};

describe("quote action", () => {
  it("returns quote rejection reasons", async () => {
    const gateway = createGateway();
    const commonDeps = {
      gateway,
      eventbriteApiToken: "eventbrite-token",
      eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
      quoteSignerPrivateKey: QUOTE_SIGNER_PRIVATE_KEY,
      quoteSignerAddress: QUOTE_SIGNER_ADDRESS,
      quoteVersion: 1,
      pricingConfig: {
        tierPayoutUSDC: { BASIC: "10000000", MEDIUM: "100000000", ADVANCED: "1000000000" },
        tierMinPremiumUSDC: { BASIC: "400000", MEDIUM: "3000000", ADVANCED: "20000000" },
        expenseLoadBps: 1000,
        profitLoadBps: 500,
      },
      geminiConfig: {
        enabled: false,
        model: "gemini-2.5-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        timeoutMs: 7000,
        maxRetries: 1,
        defaultVenueRiskBand: "unknown",
        defaultComplexityBand: "unknown",
      },
      getNowSec: () => fixedNow,
    } as const;

    const canceled = await handleQuoteCheck(
      { action: "QUOTE_CHECK", eventUrl: LIVE_EVENT_SUMMARY.eventId!, insured: RECEIVER_ADDRESS, tier: "BASIC" },
      {
        ...commonDeps,
        fetchEventbriteEventImpl: vi.fn(async () => ({ ...LIVE_EVENT_SUMMARY, canceled: true })),
      },
    );
    expect(canceled).toMatchObject({ ok: true, action: "QUOTE_CHECK", quoteValid: false, reason: "EVENT_ALREADY_CANCELED" });

    const timeUnavailable = await handleQuoteCheck(
      { action: "QUOTE_CHECK", eventUrl: LIVE_EVENT_SUMMARY.eventId!, insured: RECEIVER_ADDRESS, tier: "BASIC" },
      {
        ...commonDeps,
        fetchEventbriteEventImpl: vi.fn(async () => ({ eventId: LIVE_EVENT_SUMMARY.eventId!, canceled: false })),
      },
    );
    expect(timeUnavailable).toMatchObject({
      ok: true,
      action: "QUOTE_CHECK",
      quoteValid: false,
      reason: "EVENT_TIME_UNAVAILABLE",
    });

    const coveragePassed = await handleQuoteCheck(
      { action: "QUOTE_CHECK", eventUrl: LIVE_EVENT_SUMMARY.eventId!, insured: RECEIVER_ADDRESS, tier: "BASIC" },
      {
        ...commonDeps,
        fetchEventbriteEventImpl: vi.fn(async () => ({
          ...LIVE_EVENT_SUMMARY,
          eventStart: fixedNow - 100000,
          eventEnd: fixedNow - 90000,
        })),
      },
    );
    expect(coveragePassed).toMatchObject({
      ok: true,
      action: "QUOTE_CHECK",
      quoteValid: false,
      reason: "COVERAGE_WINDOW_ALREADY_PASSED",
    });

    const highUtilization = await handleQuoteCheck(
      { action: "QUOTE_CHECK", eventUrl: LIVE_EVENT_SUMMARY.eventId!, insured: RECEIVER_ADDRESS, tier: "MEDIUM" },
      {
        ...commonDeps,
        gateway: createGateway({
          getReserveSnapshot: async () => ({
            requiredReserves: BigInt(8_500_000),
            totalActiveLiabilityUSDC: BigInt(2_000_000),
            minReserveRatioBps: BigInt(11_000),
            vaultBalanceUSDC: BigInt(10_000_000),
          }),
        }),
        fetchEventbriteEventImpl: vi.fn(async () => LIVE_EVENT_SUMMARY),
      },
    );
    expect(highUtilization).toMatchObject({
      ok: true,
      action: "QUOTE_CHECK",
      quoteValid: false,
      reason: "VAULT_UTILIZATION_TOO_HIGH",
    });

    const insufficientReserves = await handleQuoteCheck(
      { action: "QUOTE_CHECK", eventUrl: LIVE_EVENT_SUMMARY.eventId!, insured: RECEIVER_ADDRESS, tier: "MEDIUM" },
      {
        ...commonDeps,
        gateway: createGateway({
          getReserveSnapshot: async () => ({
            requiredReserves: BigInt(5_000_000),
            totalActiveLiabilityUSDC: BigInt(100_000_000),
            minReserveRatioBps: BigInt(11_000),
            vaultBalanceUSDC: BigInt(10_000_000),
          }),
        }),
        fetchEventbriteEventImpl: vi.fn(async () => LIVE_EVENT_SUMMARY),
      },
    );
    expect(insufficientReserves).toMatchObject({
      ok: true,
      action: "QUOTE_CHECK",
      quoteValid: false,
      reason: "INSUFFICIENT_RESERVES_FOR_PAYOUT",
    });
  });
});

describe("mint action", () => {
  it("returns BAD_QUOTE_SIGNATURE when quote verification fails", async () => {
    const result = await handleMint(
      {
        action: "MINT",
        approved: true,
        signedQuote: await createSignedQuote(),
      },
      {
        gateway: createGateway(),
        eventbriteApiToken: "eventbrite-token",
        eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
        quoteSignerPrivateKey: QUOTE_SIGNER_PRIVATE_KEY,
        quoteSignerAddress: QUOTE_SIGNER_ADDRESS,
        verifySignedQuoteImpl: vi.fn(async () => {
          throw new Error("BAD_QUOTE_SIGNATURE");
        }),
      },
    );

    expect(result).toEqual({ ok: false, error: "BAD_QUOTE_SIGNATURE" });
  });

  it("returns QUOTE_EXPIRED for an expired quote", async () => {
    const signedQuote = await createSignedQuote({ quoteExpiry: 1 });
    const result = await handleMint(
      { action: "MINT", approved: true, signedQuote },
      {
        gateway: createGateway(),
        eventbriteApiToken: "eventbrite-token",
        eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
        quoteSignerPrivateKey: QUOTE_SIGNER_PRIVATE_KEY,
        quoteSignerAddress: QUOTE_SIGNER_ADDRESS,
      },
    );

    expect(result).toEqual({ ok: false, error: "QUOTE_EXPIRED" });
  });

  it("blocks mint when the event is already canceled", async () => {
    const signedQuote = await createSignedQuote();
    const result = await handleMint(
      { action: "MINT", approved: true, signedQuote },
      {
        gateway: createGateway(),
        eventbriteApiToken: "eventbrite-token",
        eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
        quoteSignerPrivateKey: QUOTE_SIGNER_PRIVATE_KEY,
        quoteSignerAddress: QUOTE_SIGNER_ADDRESS,
        getNowSec: () => fixedNow,
        fetchEventbriteEventImpl: vi.fn(async () => ({ ...LIVE_EVENT_SUMMARY, canceled: true })),
      },
    );

    expect(result).toEqual({ ok: false, error: "EVENT_ALREADY_CANCELED" });
  });

  it("surfaces relay forwarder mismatch failures", async () => {
    const signedQuote = await createSignedQuote();
    const result = await handleMint(
      { action: "MINT", approved: true, signedQuote },
      {
        gateway: createGateway({
          submitReport: async () => {
            throw new Error("RELAY_FORWARDER_MISMATCH");
          },
        }),
        eventbriteApiToken: "eventbrite-token",
        eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
        quoteSignerPrivateKey: QUOTE_SIGNER_PRIVATE_KEY,
        quoteSignerAddress: QUOTE_SIGNER_ADDRESS,
        getNowSec: () => fixedNow,
        fetchEventbriteEventImpl: vi.fn(async () => LIVE_EVENT_SUMMARY),
      },
    );

    expect(result).toEqual({ ok: false, error: "RELAY_FORWARDER_MISMATCH" });
  });
});

describe("claim action", () => {
  it("returns NO_OP while the active policy is still pending", async () => {
    const gateway = createGateway({
      getPolicy: async () => ({
        eventIdHash: `0x${"11".repeat(32)}` as const,
        eventId: LIVE_EVENT_SUMMARY.eventId!,
        eventStart: BigInt(1700000000),
        coverageStart: BigInt(1700000100),
        coverageEnd: BigInt(1900000000),
        quoteExpiry: BigInt(1900003600),
        payoutUSDC: BigInt(10000000),
        premiumUSDC: BigInt(400000),
        insured: RECEIVER_ADDRESS,
        status: 1,
      }),
      submitReport: vi.fn(async () => ({ txHash: claimTxHash })),
    });

    const result = await handleClaim(
      { action: "CLAIM", policyId: "7", eventId: LIVE_EVENT_SUMMARY.eventId! },
      {
        gateway,
        eventbriteApiToken: "eventbrite-token",
        eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
        getNowSec: () => fixedNow,
        fetchEventbriteEventImpl: vi.fn(async () => LIVE_EVENT_SUMMARY),
      },
    );

    expect(result).toMatchObject({ ok: true, action: "CLAIM", decision: "NO_OP" });
  });

  it("returns PAY when the event is canceled", async () => {
    const submitReport = vi.fn(async () => ({ txHash: claimTxHash }));
    const result = await handleClaim(
      { action: "CLAIM", policyId: "7", eventId: LIVE_EVENT_SUMMARY.eventId! },
      {
        gateway: createGateway({ submitReport }),
        eventbriteApiToken: "eventbrite-token",
        eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
        getNowSec: () => fixedNow,
        fetchEventbriteEventImpl: vi.fn(async () => ({ ...LIVE_EVENT_SUMMARY, canceled: true })),
      },
    );

    expect(result).toMatchObject({ ok: true, action: "CLAIM", decision: "PAY", txHash: claimTxHash });
    expect(submitReport).toHaveBeenCalledTimes(1);
  });

  it("returns RESOLVE_NO_PAYOUT after the event window passes", async () => {
    const submitReport = vi.fn(async () => ({ txHash: claimTxHash }));
    const result = await handleClaim(
      { action: "CLAIM", policyId: "7", eventId: LIVE_EVENT_SUMMARY.eventId! },
      {
        gateway: createGateway({
          getPolicy: async () => ({
            eventIdHash: `0x${"11".repeat(32)}` as const,
            eventId: LIVE_EVENT_SUMMARY.eventId!,
            eventStart: BigInt(1700000000),
            coverageStart: BigInt(1700000100),
            coverageEnd: BigInt(1700000200),
            quoteExpiry: BigInt(1900003600),
            payoutUSDC: BigInt(10000000),
            premiumUSDC: BigInt(400000),
            insured: RECEIVER_ADDRESS,
            status: 1,
          }),
          submitReport,
        }),
        eventbriteApiToken: "eventbrite-token",
        eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
        getNowSec: () => fixedNow,
        fetchEventbriteEventImpl: vi.fn(async () => ({ ...LIVE_EVENT_SUMMARY, eventEnd: fixedNow - 5 })),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      action: "CLAIM",
      decision: "RESOLVE_NO_PAYOUT",
      txHash: claimTxHash,
    });
    expect(submitReport).toHaveBeenCalledTimes(1);
  });
});
