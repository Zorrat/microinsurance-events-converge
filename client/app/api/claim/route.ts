import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";

import type { ClaimResultOk, ProtocolError } from "@/app/lib/protocol-types";
import { claimRequestSchema, parseRequestJson } from "@/app/lib/validation";
import { handleClaim } from "@/app/lib/server/protocol/actions/claim";
import { createRelayGateway } from "@/app/lib/server/protocol/evm";
import { serverConfig } from "@/app/lib/server/env";
import { claimRouteConfig, x402Server } from "@/app/lib/server/x402";

export const runtime = "nodejs";
export const maxDuration = 300;

type ClaimRouteResponse = ClaimResultOk | ProtocolError;

const postHandler = async (
  request: NextRequest,
): Promise<NextResponse<ClaimRouteResponse>> => {
  const body = await parseRequestJson(request, claimRequestSchema);
  if (!body.ok) {
    return NextResponse.json({ ok: false, error: body.error }, { status: body.status });
  }

  const result = await handleClaim({
    action: "CLAIM",
    policyId: body.data.policyId.trim(),
    eventId: body.data.eventId.trim(),
  }, {
    gateway: createRelayGateway(serverConfig),
    eventbriteApiToken: serverConfig.eventbriteApiToken,
    eventbriteApiBaseUrl: serverConfig.eventbriteApiBaseUrl,
    claimEventbriteApiBaseUrl: serverConfig.claimEventbriteApiBaseUrl,
  });

  const responseBody = result as ClaimRouteResponse;
  return NextResponse.json(responseBody, { status: 200 });
};

export const POST = withX402(postHandler, claimRouteConfig, x402Server);
