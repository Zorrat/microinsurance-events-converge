import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";

import type { ProtocolError, MintResultOk } from "@/app/lib/protocol-types";
import { buyRequestSchema, parseRequestJson } from "@/app/lib/validation";
import { handleMint } from "@/app/lib/server/protocol/actions/mint";
import { createRelayGateway } from "@/app/lib/server/protocol/evm";
import { serverConfig } from "@/app/lib/server/env";
import { makeBuyRouteConfig, x402Server } from "@/app/lib/server/x402";

export const runtime = "nodejs";
export const maxDuration = 300;

type BuyRouteResponse = MintResultOk | ProtocolError;

const toBuyStatusCode = (result: BuyRouteResponse): number => {
  if (result.ok) return 200;
  if (result.error.startsWith("RELAY_")) return 502;
  return 409;
};

const postHandler = async (
  request: NextRequest,
): Promise<NextResponse<BuyRouteResponse>> => {
  const body = await parseRequestJson(request.clone(), buyRequestSchema);
  if (!body.ok) {
    return NextResponse.json({ ok: false, error: body.error }, { status: body.status });
  }

  const premiumUSDC = body.data.signedQuote.quote.premiumUSDC;
  const paidHandler = withX402(
    async (): Promise<NextResponse<BuyRouteResponse>> => {
      const result = await handleMint(
        {
          action: "MINT",
          approved: true,
          signedQuote: body.data.signedQuote,
        },
        {
          gateway: createRelayGateway(serverConfig),
          eventbriteApiToken: serverConfig.eventbriteApiToken,
          eventbriteApiBaseUrl: serverConfig.eventbriteApiBaseUrl,
          quoteSignerPrivateKey: serverConfig.quoteSignerPrivateKey,
          quoteSignerAddress: serverConfig.quoteSignerAddress || undefined,
        },
      );

      const responseBody = result as BuyRouteResponse;
      return NextResponse.json(responseBody, { status: toBuyStatusCode(responseBody) });
    },
    makeBuyRouteConfig(premiumUSDC),
    x402Server,
  );

  return paidHandler(request);
};

export const POST = postHandler;
