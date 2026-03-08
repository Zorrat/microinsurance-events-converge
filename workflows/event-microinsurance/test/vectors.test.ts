import { describe, expect, it } from "bun:test";
import type { Runtime } from "@chainlink/cre-sdk";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { normalizeEventbriteEvent } from "../src/services/eventbrite";
import { computePricing } from "../src/services/pricing";
import { computeQuoteHash, hashEventId, signQuote, verifySignedQuote } from "../src/quotes";
import { encodeReportBytes } from "../src/reports";
import type { Config, Quote } from "../src/types";
import { parseEventbriteEventIdFromUrl } from "../src/utils";

const baseConfig: Config = {
  chainFamily: "evm",
  chainSelectorName: "ethereum-testnet-sepolia-base-1",
  isTestnet: true,
  receiver: "0x6163eADd9E190b1fAda7f9a3624AaBae963905C5",
  authorizedKeys: [],
  eventbriteApiBaseUrl: "https://www.eventbriteapi.com/v3",
  eventbriteApiTokenSecretName: "EVENTBRITE_API_TOKEN",
  quoteSignerPrivateKeySecretName: "QUOTE_SIGNER_PK",
  secretsNamespace: "env",
  quoteVersion: 1,
};

const mkRuntime = (nowSec: number, secrets: Record<string, string>): Runtime<Config> => {
  return {
    config: baseConfig,
    now: () => new Date(nowSec * 1000),
    log: () => {},
    callCapability: () => {
      throw new Error("not used in unit tests");
    },
    runInNodeMode: () => {
      throw new Error("not used in unit tests");
    },
    report: () => {
      throw new Error("not used in unit tests");
    },
    getSecret: ({ id }) => ({
      result: () => ({
        id: id ?? "",
        namespace: "env",
        owner: "test",
        value: secrets[id ?? ""] ?? "",
      }),
    }),
  } as unknown as Runtime<Config>;
};

const quoteVector: Quote = {
  quoteVersion: 1,
  insured: "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1",
  eventId: "evt_test_1",
  eventIdHash: "0xd0c4bb0367826e033280469c98502d8ed161a0256ec44901bf65a430607d42cc",
  eventStart: 1700000000,
  coverageStart: 1700000100,
  coverageEnd: 1700000200,
  quoteExpiry: 1893456000,
  payoutUSDC: "1000000",
  premiumUSDC: "100000",
  nonce: "0x1111111111111111111111111111111111111111111111111111111111111111",
};

describe("deterministic vectors", () => {
  it("quote hash vector is stable", () => {
    expect(hashEventId("evt_test_1")).toBe(quoteVector.eventIdHash);

    const quoteHash = computeQuoteHash(quoteVector);
    expect(quoteHash).toBe("0x21ca4e547ee25a2b85a00531de032463c566f53a15ca3d631de722804161121f");
  });

  it("quote signature verifies deterministically", async () => {
    const runtime = mkRuntime(1700000000, {
      QUOTE_SIGNER_PK: "0x59c6995e998f97a5a0044966f0945382dbf4b8f4f2745078e1bc105b9566e7f0",
    });

    const signed = await signQuote(runtime, quoteVector, baseConfig);

    expect(signed.signer).toBe("0x04d0157e19A5C560b450471D9fB041b411b8E8aE");
    expect(signed.quoteHash).toBe("0x21ca4e547ee25a2b85a00531de032463c566f53a15ca3d631de722804161121f");
    expect(signed.signature).toBe(
      "0x71d9b84ecdeb315fb3e2b54d6568dee3b007698897fd88c6ef26d45ed66ca06303faa5919f8fd3bcf5e1b2015fb219e02ca304a904345fb365e4adae9f335dad1c",
    );

    const verified = await verifySignedQuote(runtime, signed, baseConfig);
    expect(verified.signer).toBe("0x04d0157e19A5C560b450471D9fB041b411b8E8aE");
    expect(verified.quote.eventId).toBe("evt_test_1");
  });

  it("rejects quote signed by a non-workflow private key", async () => {
    const runtime = mkRuntime(1700000000, {
      QUOTE_SIGNER_PK: "0x59c6995e998f97a5a0044966f0945382dbf4b8f4f2745078e1bc105b9566e7f0",
    });

    const attacker = privateKeyToAccount(
      "0x8b3a350cf5c34c9194ca4c31ce2f5f4e6adf7dbeeb8e8f51d9f90c750f5f4f10",
    );
    const quoteHash = computeQuoteHash(quoteVector);
    const attackerSignature = await attacker.signMessage({ message: { raw: hexToBytes(quoteHash) } });

    const forged = {
      quote: quoteVector,
      quoteHash,
      signature: attackerSignature,
      signer: attacker.address,
    };

    let err = "";
    try {
      await verifySignedQuote(runtime, forged, baseConfig);
    } catch (e: any) {
      err = e?.message ?? String(e);
    }
    expect(err).toBe("BAD_QUOTE_SIGNATURE");
  });

  it("report encoding vector is stable", () => {
    const report = encodeReportBytes({
      action: 0,
      policyId: 0n,
      mint: {
        to: quoteVector.insured,
        eventId: quoteVector.eventId,
        eventIdHash: quoteVector.eventIdHash,
        eventStart: 1700000000n,
        coverageStart: 1700000100n,
        coverageEnd: 1700000200n,
        quoteExpiry: 1893456000n,
        payoutUSDC: 1000000n,
        premiumUSDC: 100000n,
      },
    });

    expect(report).toBe(
      "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000015d265dc32a575755aca19b5eceab8018cdd26f10000000000000000000000000000000000000000000000000000000000000120d0c4bb0367826e033280469c98502d8ed161a0256ec44901bf65a430607d42cc000000000000000000000000000000000000000000000000000000006553f100000000000000000000000000000000000000000000000000000000006553f164000000000000000000000000000000000000000000000000000000006553f1c80000000000000000000000000000000000000000000000000000000070dbd88000000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000186a0000000000000000000000000000000000000000000000000000000000000000a6576745f746573745f3100000000000000000000000000000000000000000000",
    );
  });

  it("eventbrite normalization handles event payload shape", () => {
    const canceled = normalizeEventbriteEvent({
      status: "canceled",
      start: { utc: "2026-03-01T10:00:00Z" },
      end: { utc: "2026-03-01T12:00:00Z" },
      category_id: "103",
      category: { id: "103", name: "Music" },
      subcategory_id: "3003",
      subcategory: { id: "3003", name: "Classical" },
      organizer: { num_past_events: 5, num_future_events: 2 },
    });

    expect(canceled.canceled).toBe(true);
    expect(canceled.eventStart).toBe(1772359200);
    expect(canceled.eventEnd).toBe(1772366400);
    expect(canceled.categoryId).toBe("103");
    expect(canceled.categoryName).toBe("Music");
    expect(canceled.subcategoryId).toBe("3003");
    expect(canceled.subcategoryName).toBe("Classical");
    expect(canceled.organizerPastEvents).toBe(5);
    expect(canceled.organizerFutureEvents).toBe(2);

    const active = normalizeEventbriteEvent({
      status: "live",
      start: { utc: "2026-02-25T06:13:20Z" },
      end: { utc: "2026-02-25T08:13:20Z" },
    });

    expect(active.canceled).toBe(false);
    expect(active.eventStart).toBe(1772000000);
    expect(active.eventEnd).toBe(1772007200);
  });

  it("extracts Eventbrite event ID from common URL variants", () => {
    expect(
      parseEventbriteEventIdFromUrl(
        "https://www.eventbrite.com/e/hoboken-stpaddys-bar-event-2026-tickets-1981881447761?aff=ebdssbcategorybrowse#search",
      ),
    ).toBe("1981881447761");

    expect(parseEventbriteEventIdFromUrl("www.eventbrite.com/e/test-event-123456789012")).toBe("123456789012");
    expect(parseEventbriteEventIdFromUrl("https://eventbrite.com/e/test?eid=998877665544")).toBe(
      "998877665544",
    );
    expect(parseEventbriteEventIdFromUrl("998877665544")).toBe("998877665544");
  });

  it("rejects non-Eventbrite URLs", () => {
    expect(() => parseEventbriteEventIdFromUrl("https://example.com/e/test-123456")).toThrow(
      "INVALID_EVENTBRITE_URL",
    );
  });

  it("maps category risk by ID and falls back to default", () => {
    const reserve = {
      requiredReserves: 1_000_000n,
      totalActiveLiabilityUSDC: 2_000_000n,
      minReserveRatioBps: 11_000n,
      vaultBalanceUSDC: 10_000_000n,
    };

    const mappedCategory = computePricing({
      event: { categoryId: "103", categoryName: "Music", onlineEvent: true, capacity: 10 },
      reserve,
      tier: "MEDIUM",
      gemini: { venueRiskBand: "unknown", complexityBand: "unknown" },
    });

    const fallbackCategory = computePricing({
      event: { categoryId: "999", categoryName: "Unknown", onlineEvent: true, capacity: 10 },
      reserve,
      tier: "MEDIUM",
      gemini: { venueRiskBand: "unknown", complexityBand: "unknown" },
    });

    expect(mappedCategory.riskBreakdownBps.category).toBe(550);
    expect(fallbackCategory.riskBreakdownBps.category).toBe(200);
  });

  it("applies tier payouts and minimum premiums", () => {
    const reserve = {
      requiredReserves: 1_000_000n,
      totalActiveLiabilityUSDC: 2_000_000n,
      minReserveRatioBps: 11_000n,
      vaultBalanceUSDC: 10_000_000n,
    };

    const event = {
      categoryId: "115",
      categoryName: "Family & Education",
      capacity: 40,
      onlineEvent: true,
      organizerPastEvents: 100,
      organizerFutureEvents: 0,
    };

    const basic = computePricing({
      event,
      reserve,
      tier: "BASIC",
      gemini: { venueRiskBand: "low", complexityBand: "low" },
    });
    const medium = computePricing({
      event,
      reserve,
      tier: "MEDIUM",
      gemini: { venueRiskBand: "low", complexityBand: "low" },
    });
    const advanced = computePricing({
      event,
      reserve,
      tier: "ADVANCED",
      gemini: { venueRiskBand: "low", complexityBand: "low" },
    });

    expect(basic.payoutUSDC).toBe("10000000");
    expect(medium.payoutUSDC).toBe("100000000");
    expect(advanced.payoutUSDC).toBe("1000000000");

    expect(basic.premiumUSDC).toBe("400000");
    expect(medium.premiumUSDC).toBe("3000000");
    expect(BigInt(advanced.premiumUSDC)).toBeGreaterThanOrEqual(20_000_000n);
  });

  it("flags utilization reject when reserve usage exceeds 85%", () => {
    const pricing = computePricing({
      event: { categoryId: "103", categoryName: "Music", onlineEvent: false, capacity: 800 },
      reserve: {
        requiredReserves: 8_500_000n,
        totalActiveLiabilityUSDC: 2_000_000n,
        minReserveRatioBps: 11_000n,
        vaultBalanceUSDC: 10_000_000n,
      },
      tier: "MEDIUM",
      gemini: { venueRiskBand: "medium", complexityBand: "medium" },
    });

    expect(pricing.reserveUtilizationBps).toBe(8500);
    expect(pricing.utilizationRejected).toBe(true);
  });
});
