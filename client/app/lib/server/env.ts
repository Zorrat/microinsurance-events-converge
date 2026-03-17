import type { Network } from "@x402/core/types";

import type { GeminiRiskBand, GeminiRuntimeConfig, PricingConfig } from "@/app/lib/protocol-types";
import {
  DEFAULT_EVENTBRITE_API_BASE_URL,
  DEFAULT_GEMINI_CONFIG,
  DEFAULT_PRICING,
} from "@/app/lib/server/protocol/defaults";

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
};

const normalizeUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
};

const normalizePrivateKey = (value: string | undefined): `0x${string}` | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return undefined;
  return withPrefix as `0x${string}`;
};

const resolvePrivateKey = (
  primaryName: string,
  values: Array<string | undefined>,
): `0x${string}` => {
  for (const value of values) {
    const normalized = normalizePrivateKey(value);
    if (normalized) return normalized;
  }
  throw new Error(`Missing or invalid private key environment variable: ${primaryName}`);
};

const normalizeX402Network = (value: string | undefined, fallback: Network): Network => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "base-sepolia" || normalized === "base_sepolia") return "eip155:84532";
  if (normalized === "base" || normalized === "base-mainnet" || normalized === "base_mainnet") return "eip155:8453";
  return value as Network;
};

const isCoinbaseFacilitator = (url: string | undefined): boolean =>
  Boolean(url && url.includes("api.cdp.coinbase.com"));

const parseJsonEnv = <T>(value: string | undefined, fallback: T): T => {
  if (!value?.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalizeGeminiRiskBand = (value: string | undefined, fallback: GeminiRiskBand): GeminiRiskBand => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "unknown") {
    return normalized;
  }
  return fallback;
};

const DEFAULT_CHAIN_ID = 84532;
const rawChainId = Number(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || DEFAULT_CHAIN_ID);
const chainId = Number.isFinite(rawChainId) ? rawChainId : DEFAULT_CHAIN_ID;
const defaultNetwork = `eip155:${chainId}` as Network;

const sharedX402Fee =
  process.env.X402_FIXED_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_FIXED_FEE_USD ||
  "0.01";
const quoteX402Fee =
  process.env.X402_QUOTE_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_QUOTE_FEE_USD ||
  sharedX402Fee;
const claimX402Fee =
  process.env.X402_CLAIM_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_CLAIM_FEE_USD ||
  sharedX402Fee;

const normalizeUsdPrice = (value: string): string => (value.startsWith("$") ? value : `$${value}`);

const relayPrivateKey = resolvePrivateKey("RELAY_PRIVATE_KEY", [
  process.env.RELAY_PRIVATE_KEY,
  process.env.CRE_TRIGGER_PRIVATE_KEY,
  process.env.CRE_HTTP_TRIGGER_SIGNER_PK,
  process.env.CRE_ETH_PRIVATE_KEY,
]);

const receiverAddress =
  process.env.POLICY_RECEIVER ||
  process.env.NEXT_PUBLIC_POLICY_RECEIVER ||
  process.env.NEXT_PUBLIC_CRE_RECEIVER ||
  "";

const baseRpcUrl =
  process.env.BASE_RPC_URL ||
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  "https://sepolia.base.org";

const quoteSignerPrivateKey = resolvePrivateKey("QUOTE_SIGNER_PK", [process.env.QUOTE_SIGNER_PK]);
const usdcAddress =
  process.env.USDC_ADDRESS ||
  process.env.NEXT_PUBLIC_USDC_ADDRESS ||
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const serverConfig = {
  chainId,
  baseRpcUrl,
  receiverAddress: required("POLICY_RECEIVER", receiverAddress) as `0x${string}`,
  usdcAddress: required("USDC_ADDRESS", usdcAddress) as `0x${string}`,
  relayPrivateKey,
  quoteSignerPrivateKey,
  quoteSignerAddress: (process.env.QUOTE_SIGNER_ADDRESS || "") as `0x${string}`,
  quoteVersion: toPositiveInt(process.env.QUOTE_VERSION, 1),
  eventbriteApiToken: required("EVENTBRITE_API_TOKEN"),
  eventbriteApiBaseUrl: normalizeUrl(process.env.EVENTBRITE_API_BASE_URL) || DEFAULT_EVENTBRITE_API_BASE_URL,
  claimEventbriteApiBaseUrl: normalizeUrl(process.env.CLAIM_EVENTBRITE_API_BASE_URL),
  pricingConfig: {
    ...DEFAULT_PRICING,
    ...parseJsonEnv<PricingConfig>(process.env.PRICING_CONFIG_JSON, DEFAULT_PRICING),
  },
  geminiConfig: {
    ...DEFAULT_GEMINI_CONFIG,
    ...parseJsonEnv<Partial<GeminiRuntimeConfig>>(process.env.GEMINI_CONFIG_JSON, {}),
    enabled: toBoolean(process.env.GEMINI_ENABLED, DEFAULT_GEMINI_CONFIG.enabled),
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_CONFIG.model,
    apiKey: process.env.GEMINI_API_KEY,
    baseUrl: normalizeUrl(process.env.GEMINI_BASE_URL) || DEFAULT_GEMINI_CONFIG.baseUrl,
    timeoutMs: toPositiveInt(process.env.GEMINI_TIMEOUT_MS, DEFAULT_GEMINI_CONFIG.timeoutMs),
    maxRetries: toPositiveInt(process.env.GEMINI_MAX_RETRIES, DEFAULT_GEMINI_CONFIG.maxRetries),
    defaultVenueRiskBand: normalizeGeminiRiskBand(
      process.env.GEMINI_DEFAULT_VENUE_RISK_BAND,
      DEFAULT_GEMINI_CONFIG.defaultVenueRiskBand,
    ),
    defaultComplexityBand: normalizeGeminiRiskBand(
      process.env.GEMINI_DEFAULT_COMPLEXITY_BAND,
      DEFAULT_GEMINI_CONFIG.defaultComplexityBand,
    ),
  } satisfies GeminiRuntimeConfig,

  x402Network: normalizeX402Network(process.env.X402_NETWORK, defaultNetwork),
  x402PayTo: required(
    "X402_PAY_TO",
    process.env.X402_PAY_TO ||
      process.env.X402_RECEIVER_ADDRESS ||
      process.env.NEXT_PUBLIC_POLICY_VAULT,
  ),
  x402QuotePriceUsd: normalizeUsdPrice(quoteX402Fee),
  x402ClaimPriceUsd: normalizeUsdPrice(claimX402Fee),
  x402FacilitatorUrl: normalizeUrl(
    process.env.X402_FACILITATOR_URL ||
      process.env.X402_FACILITATOR_BASE_URL ||
      "https://api.cdp.coinbase.com/platform/v2/x402",
  ),
  x402UsesCoinbaseFacilitator: isCoinbaseFacilitator(
    normalizeUrl(
      process.env.X402_FACILITATOR_URL ||
        process.env.X402_FACILITATOR_BASE_URL ||
        "https://api.cdp.coinbase.com/platform/v2/x402",
    ),
  ),
  cdpApiKeyId: process.env.CDP_API_KEY_ID,
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET,
};
