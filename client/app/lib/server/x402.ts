import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient, type RouteConfig, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

import { serverConfig } from "./env";

const coinbaseConfig = createFacilitatorConfig(
  serverConfig.cdpApiKeyId,
  serverConfig.cdpApiKeySecret,
);

const facilitatorUrl =
  serverConfig.x402FacilitatorUrl ||
  coinbaseConfig.url ||
  "https://api.cdp.coinbase.com/platform/v2/x402";
const shouldUseCoinbaseAuth = facilitatorUrl.includes("api.cdp.coinbase.com");

const configuredServer = new x402ResourceServer(
  new HTTPFacilitatorClient({
    url: facilitatorUrl,
    ...(shouldUseCoinbaseAuth ? { createAuthHeaders: coinbaseConfig.createAuthHeaders } : {}),
  }),
);

export const x402Server = registerExactEvmScheme(configuredServer, {
  networks: [serverConfig.x402Network],
});

const commonAccepts = {
  scheme: "exact" as const,
  network: serverConfig.x402Network,
  payTo: serverConfig.x402PayTo,
};

export const makeRouteConfig = (description: string, price: string): RouteConfig => ({
  accepts: {
    ...commonAccepts,
    price,
  },
  description,
});

export const quoteRouteConfig = makeRouteConfig(
  "Quote check for event cancellation policy via CRE workflow",
  serverConfig.x402QuotePriceUsd,
);

export const buyRouteConfig = makeRouteConfig(
  "Mint a policy from a previously signed quote via CRE workflow",
  serverConfig.x402BuyPriceUsd,
);

export const claimRouteConfig = makeRouteConfig(
  "Submit claim settlement check for an active policy via CRE workflow",
  serverConfig.x402ClaimPriceUsd,
);
