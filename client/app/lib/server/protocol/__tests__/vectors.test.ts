import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { normalizeEventbriteEvent } from "@/app/lib/server/protocol/eventbrite";
import { computePricing } from "@/app/lib/server/protocol/pricing";
import { computeQuoteHash, signQuote, verifySignedQuote } from "@/app/lib/server/protocol/quotes";
import { encodeReportBytes } from "@/app/lib/server/protocol/reports";
import { hashEventId, parseEventbriteEventIdFromUrl } from "@/app/lib/server/protocol/utils";

import {
  ATTACKER_PRIVATE_KEY,
  BASE_RESERVE,
  INSURED_ADDRESS,
  QUOTE_SIGNER_PRIVATE_KEY,
  QUOTE_VECTOR,
} from "./fixtures";

describe("protocol vectors", () => {
  it("keeps quote hashing stable", () => {
    expect(hashEventId("evt_test_1")).toBe(QUOTE_VECTOR.eventIdHash);
    expect(computeQuoteHash(QUOTE_VECTOR)).toBe("0x21ca4e547ee25a2b85a00531de032463c566f53a15ca3d631de722804161121f");
  });

  it("signs and verifies a deterministic quote", async () => {
    const signed = await signQuote(QUOTE_VECTOR, QUOTE_SIGNER_PRIVATE_KEY);

    expect(signed.signer).toBe("0x04d0157e19A5C560b450471D9fB041b411b8E8aE");
    expect(signed.quoteHash).toBe("0x21ca4e547ee25a2b85a00531de032463c566f53a15ca3d631de722804161121f");
    expect(signed.signature).toBe(
      "0x71d9b84ecdeb315fb3e2b54d6568dee3b007698897fd88c6ef26d45ed66ca06303faa5919f8fd3bcf5e1b2015fb219e02ca304a904345fb365e4adae9f335dad1c",
    );

    const verified = await verifySignedQuote(signed, QUOTE_SIGNER_PRIVATE_KEY);
    expect(verified.signer).toBe(signed.signer);
    expect(verified.quote.eventId).toBe("evt_test_1");
  });

  it("rejects a quote signed by the wrong key", async () => {
    const attacker = privateKeyToAccount(ATTACKER_PRIVATE_KEY);
    const quoteHash = computeQuoteHash(QUOTE_VECTOR);
    const signature = await attacker.signMessage({ message: { raw: hexToBytes(quoteHash) } });

    await expect(
      verifySignedQuote(
        {
          quote: QUOTE_VECTOR,
          quoteHash,
          signature,
          signer: attacker.address,
        },
        QUOTE_SIGNER_PRIVATE_KEY,
      ),
    ).rejects.toThrow("BAD_QUOTE_SIGNATURE");
  });

  it("keeps report encoding stable", () => {
    const report = encodeReportBytes({
      action: 0,
      policyId: BigInt(0),
      mint: {
        to: INSURED_ADDRESS,
        eventId: QUOTE_VECTOR.eventId,
        eventIdHash: QUOTE_VECTOR.eventIdHash,
        eventStart: BigInt(1700000000),
        coverageStart: BigInt(1700000100),
        coverageEnd: BigInt(1700000200),
        quoteExpiry: BigInt(1893456000),
        payoutUSDC: BigInt(1000000),
        premiumUSDC: BigInt(100000),
      },
    });

    expect(report).toBe(
      "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000015d265dc32a575755aca19b5eceab8018cdd26f10000000000000000000000000000000000000000000000000000000000000120d0c4bb0367826e033280469c98502d8ed161a0256ec44901bf65a430607d42cc000000000000000000000000000000000000000000000000000000006553f100000000000000000000000000000000000000000000000000000000006553f164000000000000000000000000000000000000000000000000000000006553f1c80000000000000000000000000000000000000000000000000000000070dbd88000000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000186a0000000000000000000000000000000000000000000000000000000000000000a6576745f746573745f3100000000000000000000000000000000000000000000",
    );
  });

  it("normalizes Eventbrite payloads", () => {
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
    expect(canceled.organizerPastEvents).toBe(5);

    const active = normalizeEventbriteEvent({
      status: "live",
      start: { utc: "2026-02-25T06:13:20Z" },
      end: { utc: "2026-02-25T08:13:20Z" },
    });

    expect(active.canceled).toBe(false);
    expect(active.eventStart).toBe(1772000000);
    expect(active.eventEnd).toBe(1772007200);
  });

  it("extracts Eventbrite event IDs from common URLs", () => {
    expect(
      parseEventbriteEventIdFromUrl(
        "https://www.eventbrite.com/e/hoboken-stpaddys-bar-event-2026-tickets-1981881447761?aff=ebdssbcategorybrowse#search",
      ),
    ).toBe("1981881447761");
    expect(parseEventbriteEventIdFromUrl("www.eventbrite.com/e/test-event-123456789012")).toBe("123456789012");
    expect(parseEventbriteEventIdFromUrl("https://eventbrite.com/e/test?eid=998877665544")).toBe("998877665544");
    expect(parseEventbriteEventIdFromUrl("998877665544")).toBe("998877665544");
    expect(() => parseEventbriteEventIdFromUrl("https://example.com/e/test-123456")).toThrow("INVALID_EVENTBRITE_URL");
  });

  it("applies category mapping, tier payouts, and utilization rejection", () => {
    const mappedCategory = computePricing({
      event: { categoryId: "103", categoryName: "Music", onlineEvent: true, capacity: 10 },
      reserve: BASE_RESERVE,
      tier: "MEDIUM",
      gemini: { venueRiskBand: "unknown", complexityBand: "unknown" },
    });
    const fallbackCategory = computePricing({
      event: { categoryId: "999", categoryName: "Unknown", onlineEvent: true, capacity: 10 },
      reserve: BASE_RESERVE,
      tier: "MEDIUM",
      gemini: { venueRiskBand: "unknown", complexityBand: "unknown" },
    });

    expect(mappedCategory.riskBreakdownBps.category).toBe(550);
    expect(fallbackCategory.riskBreakdownBps.category).toBe(200);

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
      reserve: BASE_RESERVE,
      tier: "BASIC",
      gemini: { venueRiskBand: "low", complexityBand: "low" },
    });
    const medium = computePricing({
      event,
      reserve: BASE_RESERVE,
      tier: "MEDIUM",
      gemini: { venueRiskBand: "low", complexityBand: "low" },
    });
    const advanced = computePricing({
      event,
      reserve: BASE_RESERVE,
      tier: "ADVANCED",
      gemini: { venueRiskBand: "low", complexityBand: "low" },
    });

    expect(basic.payoutUSDC).toBe("10000000");
    expect(medium.payoutUSDC).toBe("100000000");
    expect(advanced.payoutUSDC).toBe("1000000000");
    expect(basic.premiumUSDC).toBe("400000");
    expect(medium.premiumUSDC).toBe("3000000");
    expect(BigInt(advanced.premiumUSDC)).toBeGreaterThanOrEqual(BigInt(20_000_000));

    const utilizationRejected = computePricing({
      event: { categoryId: "103", categoryName: "Music", onlineEvent: false, capacity: 800 },
      reserve: {
        requiredReserves: BigInt(8_500_000),
        totalActiveLiabilityUSDC: BigInt(2_000_000),
        minReserveRatioBps: BigInt(11_000),
        vaultBalanceUSDC: BigInt(10_000_000),
      },
      tier: "MEDIUM",
      gemini: { venueRiskBand: "medium", complexityBand: "medium" },
    });

    expect(utilizationRejected.reserveUtilizationBps).toBe(8500);
    expect(utilizationRejected.utilizationRejected).toBe(true);
  });
});
