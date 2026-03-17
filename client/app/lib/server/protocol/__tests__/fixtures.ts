import type { EventSummary, Quote, ReserveSnapshot } from "@/app/lib/protocol-types";

export const QUOTE_SIGNER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945382dbf4b8f4f2745078e1bc105b9566e7f0" as const;
export const ATTACKER_PRIVATE_KEY =
  "0x8b3a350cf5c34c9194ca4c31ce2f5f4e6adf7dbeeb8e8f51d9f90c750f5f4f10" as const;
export const QUOTE_SIGNER_ADDRESS = "0x04d0157e19A5C560b450471D9fB041b411b8E8aE" as const;
export const INSURED_ADDRESS = "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1" as const;
export const RECEIVER_ADDRESS = "0x6163eADd9E190b1fAda7f9a3624AaBae963905C5" as const;
export const POLICY_NFT_ADDRESS = "0x1000000000000000000000000000000000000001" as const;
export const POLICY_VAULT_ADDRESS = "0x2000000000000000000000000000000000000002" as const;
export const USDC_ADDRESS = "0x3000000000000000000000000000000000000003" as const;

export const QUOTE_VECTOR: Quote = {
  quoteVersion: 1,
  insured: INSURED_ADDRESS,
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

export const BASE_RESERVE: ReserveSnapshot = {
  requiredReserves: BigInt(1_000_000),
  totalActiveLiabilityUSDC: BigInt(2_000_000),
  minReserveRatioBps: BigInt(11_000),
  vaultBalanceUSDC: BigInt(10_000_000),
};

export const LIVE_EVENT_SUMMARY: EventSummary = {
  eventId: "123456789012",
  eventName: "Test Career Fair",
  eventUrl: "https://www.eventbrite.com/e/test-career-fair-tickets-123456789012",
  canceled: false,
  eventStart: 1800000000,
  eventEnd: 1800007200,
  categoryId: "115",
  categoryName: "Family & Education",
  subcategoryId: "3003",
  subcategoryName: "General",
  organizerPastEvents: 12,
  organizerFutureEvents: 2,
  onlineEvent: false,
  capacity: 250,
  descriptionText: "Single-day venue event with a few speakers.",
  venueName: "Civic Hall",
  venueCity: "New York",
  venueRegion: "NY",
  venueCountry: "US",
  isSeries: false,
};

export const EVENTBRITE_PAYLOAD = {
  id: LIVE_EVENT_SUMMARY.eventId,
  name: { text: LIVE_EVENT_SUMMARY.eventName },
  url: LIVE_EVENT_SUMMARY.eventUrl,
  status: "live",
  start: { utc: "2027-01-15T08:00:00Z" },
  end: { utc: "2027-01-15T10:00:00Z" },
  online_event: LIVE_EVENT_SUMMARY.onlineEvent,
  category_id: LIVE_EVENT_SUMMARY.categoryId,
  category: { id: LIVE_EVENT_SUMMARY.categoryId, name: LIVE_EVENT_SUMMARY.categoryName },
  subcategory_id: LIVE_EVENT_SUMMARY.subcategoryId,
  subcategory: { id: LIVE_EVENT_SUMMARY.subcategoryId, name: LIVE_EVENT_SUMMARY.subcategoryName },
  organizer: {
    num_past_events: LIVE_EVENT_SUMMARY.organizerPastEvents,
    num_future_events: LIVE_EVENT_SUMMARY.organizerFutureEvents,
  },
  description: { text: LIVE_EVENT_SUMMARY.descriptionText },
  venue: {
    name: LIVE_EVENT_SUMMARY.venueName,
    address: {
      city: LIVE_EVENT_SUMMARY.venueCity,
      region: LIVE_EVENT_SUMMARY.venueRegion,
      country: LIVE_EVENT_SUMMARY.venueCountry,
    },
  },
  is_series: LIVE_EVENT_SUMMARY.isSeries,
};
