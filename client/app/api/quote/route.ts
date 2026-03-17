import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";

import type { ProtocolError, QuoteResultOk } from "@/app/lib/protocol-types";
import { parseRequestJson, quoteRequestSchema } from "@/app/lib/validation";
import { handleQuoteCheck } from "@/app/lib/server/protocol/actions/quote";
import { createRelayGateway } from "@/app/lib/server/protocol/evm";
import { serverConfig } from "@/app/lib/server/env";
import { quoteRouteConfig, x402Server } from "@/app/lib/server/x402";

export const runtime = "nodejs";
export const maxDuration = 300;

type QuoteRouteResponse = QuoteResultOk | ProtocolError;

const postHandler = async (
  request: NextRequest,
): Promise<NextResponse<QuoteRouteResponse>> => {
  const body = await parseRequestJson(request, quoteRequestSchema);
  if (!body.ok) {
    return NextResponse.json({ ok: false, error: body.error }, { status: body.status });
  }

  const result = await handleQuoteCheck({
    action: "QUOTE_CHECK",
    eventUrl: body.data.eventUrl,
    insured: body.data.insured,
    tier: body.data.tier,
    ...(body.data.nonce ? { nonce: body.data.nonce } : {}),
  }, {
    gateway: createRelayGateway(serverConfig),
    eventbriteApiToken: serverConfig.eventbriteApiToken,
    eventbriteApiBaseUrl: serverConfig.eventbriteApiBaseUrl,
    quoteSignerPrivateKey: serverConfig.quoteSignerPrivateKey,
    quoteSignerAddress: serverConfig.quoteSignerAddress || undefined,
    quoteVersion: serverConfig.quoteVersion,
    pricingConfig: serverConfig.pricingConfig,
    geminiConfig: serverConfig.geminiConfig,
  });

  const responseBody = result as QuoteRouteResponse;
  return NextResponse.json(responseBody, { status: 200 });
};

export const POST = withX402(postHandler, quoteRouteConfig, x402Server);
