import { describe, expect, it } from "bun:test";
import type { EVMClient, HTTPClient, Runtime } from "@chainlink/cre-sdk";
import { encodeFunctionResult, hexToBytes } from "viem";

import { CREReceiverABI, ERC20ABI, PolicyVaultABI } from "../src/abi";
import { handleQuoteCheck } from "../src/actions/quote";
import {
  GEMINI_SYSTEM_PROMPT,
  assessGeminiRisk,
  buildGeminiRequestPayload,
  buildGeminiUserPrompt,
  parseGeminiStructuredOutput,
} from "../src/services/gemini";
import type { Config, EventSummary } from "../src/types";

const QUOTE_SIGNER_PK = "0x59c6995e998f97a5a0044966f0945382dbf4b8f4f2745078e1bc105b9566e7f0";
const POLICY_VAULT = "0x1000000000000000000000000000000000000001";
const USDC = "0x2000000000000000000000000000000000000002";

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
  gemini: {
    enabled: true,
    model: "gemini-2.5-flash",
    apiKeySecretName: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    timeoutMs: 7000,
    maxRetries: 1,
    defaultVenueRiskBand: "unknown",
    defaultComplexityBand: "unknown",
  },
};

const mkRuntime = (config: Config, nowIso: string, secrets: Record<string, string>): Runtime<Config> => {
  return {
    config,
    now: () => new Date(nowIso),
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

const mkEvmClient = (): EVMClient => {
  const responses: Array<`0x${string}`> = [
    encodeFunctionResult({
      abi: CREReceiverABI,
      functionName: "policyVault",
      result: POLICY_VAULT,
    }),
    encodeFunctionResult({
      abi: PolicyVaultABI,
      functionName: "requiredReserves",
      result: 1_000_000n,
    }),
    encodeFunctionResult({
      abi: PolicyVaultABI,
      functionName: "totalActiveLiabilityUSDC",
      result: 2_000_000n,
    }),
    encodeFunctionResult({
      abi: PolicyVaultABI,
      functionName: "minReserveRatioBps",
      result: 11_000,
    }),
    encodeFunctionResult({
      abi: PolicyVaultABI,
      functionName: "usdc",
      result: USDC,
    }),
    encodeFunctionResult({
      abi: ERC20ABI,
      functionName: "balanceOf",
      result: 100_000_000n,
    }),
  ];

  let idx = 0;
  return {
    callContract: () => ({
      result: () => {
        if (idx >= responses.length) throw new Error("unexpected callContract call");
        const data = hexToBytes(responses[idx]);
        idx += 1;
        return { data };
      },
    }),
  } as unknown as EVMClient;
};

type MockHttpOptions = {
  eventbritePayload: Record<string, unknown>;
  geminiStatusCode: number;
  geminiBody: unknown;
  onGeminiRequest?: (req: any, payload: unknown) => void;
};

const encodeBody = (value: unknown): Uint8Array => {
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new TextEncoder().encode(JSON.stringify(value));
};

const mkHttpClient = (options: MockHttpOptions): HTTPClient => {
  const requester = {
    sendRequest: (req: any) => ({
      result: () => {
        if (typeof req.url !== "string") throw new Error("request url missing");

        if (req.url.includes("/events/")) {
          return {
            statusCode: 200,
            body: encodeBody(options.eventbritePayload),
          };
        }

        if (req.url.includes(":generateContent")) {
          let parsedBody: unknown = undefined;
          if (req.body) {
            const raw = new TextDecoder().decode(req.body);
            parsedBody = JSON.parse(raw);
          }
          options.onGeminiRequest?.(req, parsedBody);
          return {
            statusCode: options.geminiStatusCode,
            body: encodeBody(options.geminiBody),
          };
        }

        throw new Error(`unexpected HTTP URL: ${req.url}`);
      },
    }),
  };

  return {
    sendRequest: (_runtime: Runtime<Config>, fn: any) => (input: any) => ({
      result: () => fn(requester, input),
    }),
  } as unknown as HTTPClient;
};

const eventbritePayload = {
  id: "123456789012",
  name: { text: "Test Career Fair" },
  url: "https://www.eventbrite.com/e/test-career-fair-tickets-123456789012",
  status: "live",
  start: { utc: "2027-01-02T10:00:00Z" },
  end: { utc: "2027-01-02T12:00:00Z" },
  online_event: false,
  category_id: "115",
  category: { id: "115", name: "Family & Education" },
  subcategory_id: "3003",
  subcategory: { id: "3003", name: "General" },
  organizer: { num_past_events: 12, num_future_events: 2 },
  description: { text: "Single-day venue event with a few speakers." },
  venue: {
    name: "Civic Hall",
    address: {
      city: "New York",
      region: "NY",
      country: "US",
    },
  },
  is_series: false,
};

describe("gemini deterministic integration", () => {
  it("builds a deterministic prompt and strict JSON request payload", () => {
    const prompt = buildGeminiUserPrompt({
      eventId: "evt_1",
      eventName: "Example Event",
      eventUrl: "https://example.com/e/evt_1",
      categoryName: "Business",
      subcategoryName: "Networking",
      capacity: 250,
      onlineEvent: false,
      organizerPastEvents: 4,
      organizerFutureEvents: 1,
      eventStart: 1_800_000_000,
      eventEnd: 1_800_007_200,
      descriptionText: "Hiring fair",
      venueName: "Expo Hall",
      venueCity: "Austin",
      venueRegion: "TX",
      venueCountry: "US",
      isSeries: false,
    });

    expect(prompt).toContain("Decision rubric:");
    expect(prompt).toContain("Input JSON:");

    const payload = buildGeminiRequestPayload({
      eventId: "evt_1",
      eventName: "Example Event",
    });

    expect(payload.systemInstruction.parts[0]?.text).toBe(GEMINI_SYSTEM_PROMPT);
    expect(payload.generationConfig.candidateCount).toBe(1);
    expect(payload.generationConfig.temperature).toBe(0);
    expect(payload.generationConfig.topP).toBe(0);
    expect(payload.generationConfig.topK).toBe(1);
    expect(payload.generationConfig.maxOutputTokens).toBe(64);
    expect(Object.prototype.hasOwnProperty.call(payload.generationConfig, "responseMimeType")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload.generationConfig, "responseSchema")).toBe(false);
    expect(payload.tools).toEqual([{ google_search: {} }]);
  });

  it("parses strict JSON output and rejects schema mismatches", () => {
    const parsed = parseGeminiStructuredOutput('{"venueRiskBand":"HIGH","complexityBand":"Medium"}');
    expect(parsed.venueRiskBand).toBe("high");
    expect(parsed.complexityBand).toBe("medium");

    const fenced = parseGeminiStructuredOutput(
      '```json\n{"venueRiskBand":"low","complexityBand":"high"}\n```',
    );
    expect(fenced.venueRiskBand).toBe("low");
    expect(fenced.complexityBand).toBe("high");

    expect(() =>
      parseGeminiStructuredOutput('{"venueRiskBand":"low","complexityBand":"low","extra":"nope"}'),
    ).toThrow("GEMINI_SCHEMA_MISMATCH");

    expect(() => parseGeminiStructuredOutput('{"venueRiskBand":"critical","complexityBand":"low"}')).toThrow(
      "GEMINI_INVALID_VENUERISKBAND_VALUE:critical",
    );
  });

  it("calls Gemini and normalizes returned bands", () => {
    let capturedPayload: any;
    let capturedUrl = "";
    const httpClient = mkHttpClient({
      eventbritePayload,
      geminiStatusCode: 200,
      geminiBody: {
        candidates: [
          {
            content: {
              parts: [{ text: '{"venueRiskBand":"HIGH","complexityBand":"Medium"}' }],
            },
          },
        ],
      },
      onGeminiRequest: (_req, payload) => {
        capturedUrl = _req.url;
        capturedPayload = payload;
      },
    });
    const runtime = mkRuntime(baseConfig, "2026-01-01T00:00:00Z", {
      GEMINI_API_KEY: "test-gemini-key",
      EVENTBRITE_API_TOKEN: "test-eventbrite-token",
      QUOTE_SIGNER_PK,
    });

    const event: EventSummary = {
      eventId: "123456789012",
      eventName: "Test Career Fair",
      onlineEvent: false,
      capacity: 250,
    };
    const assessment = assessGeminiRisk(runtime, httpClient, event, baseConfig);

    expect(assessment).toEqual({
      venueRiskBand: "high",
      complexityBand: "medium",
    });

    expect(capturedPayload.generationConfig.candidateCount).toBe(1);
    expect(capturedPayload.generationConfig.temperature).toBe(0);
    expect(capturedPayload.generationConfig.topP).toBe(0);
    expect(capturedPayload.generationConfig.topK).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(capturedPayload.generationConfig, "responseMimeType")).toBe(
      false,
    );
    expect(capturedPayload.tools).toEqual([{ google_search: {} }]);
    expect(capturedUrl).toContain("/models/gemini-2.5-flash:generateContent");
  });

  it("uses Gemini bands in quote pricing when enabled", async () => {
    const httpClient = mkHttpClient({
      eventbritePayload,
      geminiStatusCode: 200,
      geminiBody: {
        candidates: [
          {
            content: {
              parts: [{ text: '{"venueRiskBand":"medium","complexityBand":"high"}' }],
            },
          },
        ],
      },
    });

    const runtime = mkRuntime(baseConfig, "2026-01-01T00:00:00Z", {
      GEMINI_API_KEY: "test-gemini-key",
      EVENTBRITE_API_TOKEN: "test-eventbrite-token",
      QUOTE_SIGNER_PK,
    });
    const evm = mkEvmClient();

    const result = await handleQuoteCheck(
      runtime,
      httpClient,
      evm,
      {
        action: "QUOTE_CHECK",
        eventUrl: "https://www.eventbrite.com/e/test-career-fair-tickets-123456789012",
        insured: "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1",
        tier: "BASIC",
        nonce: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
      baseConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "QUOTE_CHECK") throw new Error("unexpected result type");
    expect(result.quoteValid).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, "eventNameMatch")).toBe(false);
    expect(result.warnings?.includes("EVENT_NAME_MISMATCH") ?? false).toBe(false);
    expect(result.pricing?.riskBands.venueRiskBand).toBe("medium");
    expect(result.pricing?.riskBands.complexityBand).toBe("high");
    expect(result.pricing?.riskBreakdownBps.venueRisk).toBe(60);
    expect(result.pricing?.riskBreakdownBps.complexity).toBe(120);
    expect(result.warnings?.includes("GEMINI_FALLBACK_UNKNOWN") ?? false).toBe(false);
  });

  it("falls back to unknown bands when Gemini fails without hard-failing quote", async () => {
    let geminiCalls = 0;
    const httpClient = mkHttpClient({
      eventbritePayload,
      geminiStatusCode: 500,
      geminiBody: { error: "internal failure" },
      onGeminiRequest: () => {
        geminiCalls += 1;
      },
    });
    const runtime = mkRuntime(baseConfig, "2026-01-01T00:00:00Z", {
      GEMINI_API_KEY: "test-gemini-key",
      EVENTBRITE_API_TOKEN: "test-eventbrite-token",
      QUOTE_SIGNER_PK,
    });
    const evm = mkEvmClient();

    const result = await handleQuoteCheck(
      runtime,
      httpClient,
      evm,
      {
        action: "QUOTE_CHECK",
        eventUrl: "https://www.eventbrite.com/e/test-career-fair-tickets-123456789012",
        insured: "0x15d265Dc32a575755ACA19b5EcEAB8018CdD26F1",
        tier: "BASIC",
        nonce: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
      baseConfig,
    );

    expect(geminiCalls).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "QUOTE_CHECK") throw new Error("unexpected result type");
    expect(result.quoteValid).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, "eventNameMatch")).toBe(false);
    expect(result.warnings?.includes("EVENT_NAME_MISMATCH") ?? false).toBe(false);
    expect(result.pricing?.riskBands.venueRiskBand).toBe("unknown");
    expect(result.pricing?.riskBands.complexityBand).toBe("unknown");
    expect(result.pricing?.riskBreakdownBps.venueRisk).toBe(30);
    expect(result.pricing?.riskBreakdownBps.complexity).toBe(40);
    expect(result.warnings?.includes("GEMINI_FALLBACK_UNKNOWN")).toBe(true);
  });
});
