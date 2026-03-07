import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";

import type { ClaimWorkflowOk, WorkflowError } from "@/app/lib/cre-types";
import { claimRequestSchema, parseRequestJson } from "@/app/lib/validation";
import { executeWorkflow } from "@/app/lib/server/cre-client";
import { claimRouteConfig, x402Server } from "@/app/lib/server/x402";

export const runtime = "nodejs";

type ClaimRouteResponse = ClaimWorkflowOk | WorkflowError;
const toStatusCode = (result: ClaimRouteResponse): number => {
  if (!result.ok && result.error.startsWith("CRE_TRIGGER_FAILED:")) return 502;
  return 200;
};

const postHandler = async (
  request: NextRequest,
): Promise<NextResponse<ClaimRouteResponse>> => {
  const body = await parseRequestJson(request, claimRequestSchema);
  if (!body.ok) {
    return NextResponse.json({ ok: false, error: body.error }, { status: body.status });
  }

  const result = await executeWorkflow({
    action: "CLAIM",
    policyId: body.data.policyId,
    eventId: body.data.eventId,
  });

  if (result.ok && result.action !== "CLAIM") {
    return NextResponse.json(
      { ok: false, error: `CRE_TRIGGER_FAILED:UNEXPECTED_ACTION_${result.action}` },
      { status: 502 },
    );
  }

  const responseBody = result as ClaimRouteResponse;
  return NextResponse.json(responseBody, { status: toStatusCode(responseBody) });
};

export const POST = withX402(postHandler, claimRouteConfig, x402Server);
