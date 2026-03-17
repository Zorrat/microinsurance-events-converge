import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GEMINI_SYSTEM_PROMPT,
  assessGeminiRisk,
  buildGeminiRequestPayload,
  buildGeminiUserPrompt,
  parseGeminiStructuredOutput,
} from "@/app/lib/server/protocol/gemini";

import { LIVE_EVENT_SUMMARY } from "./fixtures";

describe("gemini helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the deterministic prompt and request payload", () => {
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
      eventStart: 1800000000,
      eventEnd: 1800007200,
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
    expect(payload.generationConfig).toEqual({
      candidateCount: 1,
      temperature: 0,
      topP: 0,
      topK: 1,
      maxOutputTokens: 64,
    });
    expect(payload.tools).toEqual([{ google_search: {} }]);
  });

  it("parses strict Gemini JSON output", () => {
    expect(parseGeminiStructuredOutput('{"venueRiskBand":"HIGH","complexityBand":"Medium"}')).toEqual({
      venueRiskBand: "high",
      complexityBand: "medium",
    });
    expect(
      parseGeminiStructuredOutput('```json\n{"venueRiskBand":"low","complexityBand":"high"}\n```'),
    ).toEqual({
      venueRiskBand: "low",
      complexityBand: "high",
    });

    expect(() =>
      parseGeminiStructuredOutput('{"venueRiskBand":"low","complexityBand":"low","extra":"nope"}'),
    ).toThrow("GEMINI_SCHEMA_MISMATCH");
    expect(() => parseGeminiStructuredOutput('{"venueRiskBand":"critical","complexityBand":"low"}')).toThrow(
      "GEMINI_INVALID_VENUERISKBAND_VALUE:critical",
    );
  });

  it("calls Gemini and normalizes returned risk bands", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"venueRiskBand":"HIGH","complexityBand":"medium"}' }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await assessGeminiRisk(LIVE_EVENT_SUMMARY, {
      enabled: true,
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      timeoutMs: 7000,
      maxRetries: 1,
      defaultVenueRiskBand: "unknown",
      defaultComplexityBand: "unknown",
    });

    expect(result).toEqual({ venueRiskBand: "high", complexityBand: "medium" });
    expect(capturedUrl).toContain("/models/gemini-2.5-flash:generateContent?key=gemini-key");
    expect(capturedBody).toContain(LIVE_EVENT_SUMMARY.eventId!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
