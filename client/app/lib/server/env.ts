import type { Network } from "@x402/core/types";

export type CreExecutionMode = "gateway" | "simulate";

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const parseExecutionMode = (value: string | undefined): CreExecutionMode => {
  if (value === "simulate") return "simulate";
  return "gateway";
};

const rawChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 84532);
const chainId = Number.isFinite(rawChainId) ? rawChainId : 84532;
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

const normalizeX402Network = (value: string | undefined, fallback: Network): Network => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "base-sepolia" || normalized === "base_sepolia") {
    return "eip155:84532";
  }
  if (normalized === "base" || normalized === "base-mainnet" || normalized === "base_mainnet") {
    return "eip155:8453";
  }
  return value as Network;
};

const isCoinbaseFacilitator = (url: string | undefined): boolean =>
  Boolean(url && url.includes("api.cdp.coinbase.com"));

const defaultNetwork = `eip155:${chainId}` as Network;
const normalizeUsdPrice = (value: string): string => (value.startsWith("$") ? value : `$${value}`);
const sharedX402Fee =
  process.env.X402_FIXED_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_FIXED_FEE_USD ||
  "0.01";
const quoteX402Fee =
  process.env.X402_QUOTE_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_QUOTE_FEE_USD ||
  sharedX402Fee;
const buyX402Fee =
  process.env.X402_BUY_FEE_USD ||
  process.env.X402_MINT_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_BUY_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_MINT_FEE_USD ||
  sharedX402Fee;
const claimX402Fee =
  process.env.X402_CLAIM_FEE_USD ||
  process.env.NEXT_PUBLIC_X402_CLAIM_FEE_USD ||
  sharedX402Fee;

const creSignerPk =
  process.env.CRE_TRIGGER_PRIVATE_KEY || process.env.CRE_HTTP_TRIGGER_SIGNER_PK || "";
const creExecutionMode = parseExecutionMode(process.env.CRE_EXECUTION_MODE);
const creWorkflowId = process.env.CRE_WORKFLOW_ID || "";
const creClaimWorkflowId = process.env.CRE_CLAIM_WORKFLOW_ID || "";
const x402FacilitatorUrl = normalizeUrl(
  process.env.X402_FACILITATOR_URL ||
    process.env.X402_FACILITATOR_BASE_URL ||
    "https://api.cdp.coinbase.com/platform/v2/x402",
);

if (creExecutionMode === "gateway") {
  required("CRE_WORKFLOW_ID", creWorkflowId);
  required("CRE_TRIGGER_PRIVATE_KEY", creSignerPk);
}

if (isCoinbaseFacilitator(x402FacilitatorUrl)) {
  required("CDP_API_KEY_ID", process.env.CDP_API_KEY_ID);
  required("CDP_API_KEY_SECRET", process.env.CDP_API_KEY_SECRET);
}

export const serverConfig = {
  creExecutionMode,
  creGatewayUrl: process.env.CRE_GATEWAY_URL || "https://01.gateway.zone-a.cre.chain.link",
  creWorkflowId,
  creClaimWorkflowId,
  creSignerPk,
  creExecutionPollUrl: process.env.CRE_EXECUTION_POLL_URL,
  creExecutionPollMethod: process.env.CRE_EXECUTION_POLL_METHOD,
  crePollMaxMs: toPositiveInt(process.env.CRE_POLL_MAX_MS, 8000),
  crePollIntervalMs: toPositiveInt(process.env.CRE_POLL_INTERVAL_MS, 1000),
  creLocalCliBin: process.env.CRE_LOCAL_CLI_BIN || "cre",
  creLocalProjectRoot: process.env.CRE_LOCAL_PROJECT_ROOT || "../workflows",
  creLocalWorkflowPath: process.env.CRE_LOCAL_WORKFLOW_PATH || "./event-microinsurance",
  creLocalEnvFile: process.env.CRE_LOCAL_ENV_FILE || "../workflows/.env",
  creLocalTarget: process.env.CRE_LOCAL_TARGET || "staging-settings",
  creLocalTriggerIndex: toPositiveInt(process.env.CRE_LOCAL_TRIGGER_INDEX, 0),
  creLocalBroadcast: toBoolean(process.env.CRE_LOCAL_BROADCAST, true),
  creLocalTimeoutMs: toPositiveInt(process.env.CRE_LOCAL_TIMEOUT_MS, 120000),
  creLocalMaxBufferBytes: toPositiveInt(process.env.CRE_LOCAL_MAX_BUFFER_BYTES, 10485760),

  x402Network: normalizeX402Network(process.env.X402_NETWORK, defaultNetwork),
  x402PayTo: required(
    "X402_PAY_TO",
    process.env.X402_PAY_TO ||
      process.env.X402_RECEIVER_ADDRESS ||
      process.env.NEXT_PUBLIC_POLICY_VAULT,
  ),
  x402QuotePriceUsd: normalizeUsdPrice(quoteX402Fee),
  x402BuyPriceUsd: normalizeUsdPrice(buyX402Fee),
  x402ClaimPriceUsd: normalizeUsdPrice(claimX402Fee),
  x402FacilitatorUrl,

  cdpApiKeyId: process.env.CDP_API_KEY_ID,
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET,
};
