import type { EventSummary, GeminiRiskBand, GeminiRuntimeConfig } from "@/app/lib/protocol-types";

import { DEFAULT_GEMINI_CONFIG } from "./defaults";

export type GeminiRiskAssessment = {
  venueRiskBand: GeminiRiskBand;
  complexityBand: GeminiRiskBand;
};

export type GeminiRiskAssessmentRequest = {
  eventId?: string;
  eventName?: string;
  eventUrl?: string;
  categoryName?: string;
  subcategoryName?: string;
  capacity?: number;
  onlineEvent?: boolean;
  organizerPastEvents?: number;
  organizerFutureEvents?: number;
  eventStart?: number;
  eventEnd?: number;
  descriptionText?: string;
  venueName?: string;
  venueCity?: string;
  venueRegion?: string;
  venueCountry?: string;
  isSeries?: boolean;
};

type GeminiGenerateContentRequest = {
  systemInstruction: {
    parts: Array<{ text: string }>;
  };
  contents: Array<{
    role: "user";
    parts: Array<{ text: string }>;
  }>;
  tools: Array<{
    google_search: Record<string, never>;
  }>;
  generationConfig: {
    candidateCount: number;
    temperature: number;
    topP: number;
    topK: number;
    maxOutputTokens: number;
  };
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

export const GEMINI_SYSTEM_PROMPT = `You are a deterministic risk-band classifier for event cancellation insurance.
Use Google Search grounding results together with the provided event JSON.

Task:
Return exactly one JSON object with keys:
- venueRiskBand
- complexityBand

Allowed values for each key:
"low", "medium", "high", "unknown"

Hard rules:
1) Output JSON only. No markdown. No prose.
2) Do not output additional keys.
3) Use only provided event JSON and grounded Google Search evidence. Do not use unstated assumptions.
4) If data is insufficient for a decision, return "unknown".
5) If multiple rules apply, choose the highest-risk applicable band.`;

const normalizeRiskBand = (value: unknown): GeminiRiskBand => {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "unknown") {
    return normalized;
  }
  return "unknown";
};

const parseRiskBandStrict = (label: string, value: unknown): GeminiRiskBand => {
  if (typeof value !== "string") throw new Error(`GEMINI_INVALID_${label.toUpperCase()}_TYPE`);
  const normalized = value.trim().toLowerCase();
  if (normalized !== "low" && normalized !== "medium" && normalized !== "high" && normalized !== "unknown") {
    throw new Error(`GEMINI_INVALID_${label.toUpperCase()}_VALUE:${normalized}`);
  }
  return normalized;
};

export const defaultGeminiAssessment = (config?: Partial<GeminiRuntimeConfig>): GeminiRiskAssessment => {
  const merged = { ...DEFAULT_GEMINI_CONFIG, ...(config ?? {}) };
  return {
    venueRiskBand: normalizeRiskBand(merged.defaultVenueRiskBand),
    complexityBand: normalizeRiskBand(merged.defaultComplexityBand),
  };
};

export const toGeminiRiskAssessmentRequest = (event: EventSummary): GeminiRiskAssessmentRequest => ({
  eventId: event.eventId,
  eventName: event.eventName,
  eventUrl: event.eventUrl,
  categoryName: event.categoryName,
  subcategoryName: event.subcategoryName,
  capacity: event.capacity,
  onlineEvent: event.onlineEvent,
  organizerPastEvents: event.organizerPastEvents,
  organizerFutureEvents: event.organizerFutureEvents,
  eventStart: event.eventStart,
  eventEnd: event.eventEnd,
  descriptionText: event.descriptionText,
  venueName: event.venueName,
  venueCity: event.venueCity,
  venueRegion: event.venueRegion,
  venueCountry: event.venueCountry,
  isSeries: event.isSeries,
});

const buildDeterministicContext = (request: GeminiRiskAssessmentRequest): Record<string, unknown> => ({
  eventId: request.eventId ?? null,
  eventName: request.eventName ?? null,
  eventUrl: request.eventUrl ?? null,
  categoryName: request.categoryName ?? null,
  subcategoryName: request.subcategoryName ?? null,
  capacity: request.capacity ?? null,
  onlineEvent: request.onlineEvent ?? null,
  organizerPastEvents: request.organizerPastEvents ?? null,
  organizerFutureEvents: request.organizerFutureEvents ?? null,
  eventStart: request.eventStart ?? null,
  eventEnd: request.eventEnd ?? null,
  descriptionText: request.descriptionText ?? null,
  venueName: request.venueName ?? null,
  venueCity: request.venueCity ?? null,
  venueRegion: request.venueRegion ?? null,
  venueCountry: request.venueCountry ?? null,
  isSeries: request.isSeries ?? null,
});

export const buildGeminiUserPrompt = (request: GeminiRiskAssessmentRequest): string => {
  const contextJson = JSON.stringify(buildDeterministicContext(request));

  return `Classify venue and complexity risk for this event input.

Decision rubric:

Venue Risk:
- high: major disruption indicators exist in input (severe weather alert, civil unrest, safety incident, major transport disruption)
- medium: moderate disruption indicators exist (weather watch, minor transport disruption, notable local conflict)
- low: event is online OR no disruption indicators are present
- unknown: required context is missing

Complexity Risk:
- high: multi-day OR multi-venue OR large performer/speaker set OR explicit travel dependency
- medium: moderate production complexity signals (multiple speakers/vendors, medium-large attendance, partial logistics complexity)
- low: simple single-session event with limited operational complexity
- unknown: insufficient information

Input JSON:
${contextJson}`;
};

export const buildGeminiRequestPayload = (
  request: GeminiRiskAssessmentRequest,
): GeminiGenerateContentRequest => ({
  systemInstruction: {
    parts: [{ text: GEMINI_SYSTEM_PROMPT }],
  },
  contents: [
    {
      role: "user",
      parts: [{ text: buildGeminiUserPrompt(request) }],
    },
  ],
  tools: [{ google_search: {} }],
  generationConfig: {
    candidateCount: 1,
    temperature: 0,
    topP: 0,
    topK: 1,
    maxOutputTokens: 64,
  },
});

export const parseGeminiStructuredOutput = (
  rawText: string,
): { venueRiskBand: GeminiRiskBand; complexityBand: GeminiRiskBand } => {
  const parseJsonLoose = (input: string): unknown => {
    const trimmed = input.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
      if (fenced) {
        return JSON.parse(fenced.trim());
      }
      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      }
      throw new Error("GEMINI_NON_JSON_OUTPUT");
    }
  };

  let parsed: unknown;
  try {
    parsed = parseJsonLoose(rawText);
  } catch {
    throw new Error("GEMINI_NON_JSON_OUTPUT");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GEMINI_JSON_NOT_OBJECT");
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 2 || !keys.includes("venueRiskBand") || !keys.includes("complexityBand")) {
    throw new Error("GEMINI_SCHEMA_MISMATCH");
  }

  return {
    venueRiskBand: parseRiskBandStrict("venueRiskBand", obj.venueRiskBand),
    complexityBand: parseRiskBandStrict("complexityBand", obj.complexityBand),
  };
};

const parseGeminiApiResponse = (bodyText: string): GeminiRiskAssessment => {
  let parsed: GeminiGenerateContentResponse;
  try {
    parsed = JSON.parse(bodyText) as GeminiGenerateContentResponse;
  } catch {
    throw new Error("GEMINI_INVALID_RESPONSE_JSON");
  }

  const candidate = parsed.candidates?.[0];
  const partText = candidate?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!partText) {
    const blockReason = parsed.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`GEMINI_BLOCKED:${blockReason}`);
    throw new Error("GEMINI_EMPTY_CANDIDATE");
  }

  return parseGeminiStructuredOutput(partText);
};

export const assessGeminiRisk = async (
  event: EventSummary,
  config: GeminiRuntimeConfig,
): Promise<GeminiRiskAssessment> => {
  if (!config.enabled || !config.apiKey) {
    return defaultGeminiAssessment(config);
  }

  const payload = buildGeminiRequestPayload(toGeminiRiskAssessmentRequest(event));
  const url = `${config.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });
      const bodyText = await response.text();
      if (!response.ok) {
        const bodyHead = bodyText.slice(0, 180).replace(/\s+/g, " ");
        throw new Error(`GEMINI_HTTP_${response.status}:${bodyHead}`);
      }
      clearTimeout(timeout);
      return parseGeminiApiResponse(bodyText);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt >= config.maxRetries) break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`GEMINI_REQUEST_FAILED:${message}`);
};

