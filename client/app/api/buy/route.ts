import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";

import type { MintWorkflowOk, WorkflowError } from "@/app/lib/cre-types";
import { buyRequestSchema, parseRequestJson } from "@/app/lib/validation";
import { executeWorkflow } from "@/app/lib/server/cre-client";
import { buyRouteConfig, x402Server } from "@/app/lib/server/x402";

export const runtime = "nodejs";

type BuyRouteResponse = MintWorkflowOk | WorkflowError;
const toStatusCode = (result: BuyRouteResponse): number => {
  if (!result.ok && result.error.startsWith("CRE_TRIGGER_FAILED:")) return 502;
  return 200;
};

const postHandler = async (
  request: NextRequest,
): Promise<NextResponse<BuyRouteResponse>> => {
  const body = await parseRequestJson(request, buyRequestSchema);
  if (!body.ok) {
    return NextResponse.json({ ok: false, error: body.error }, { status: body.status });
  }

  const result = await executeWorkflow({
    action: "MINT",
    approved: true,
    signedQuote: body.data.signedQuote,
  });

  if (result.ok && result.action !== "MINT") {
    return NextResponse.json(
      { ok: false, error: `CRE_TRIGGER_FAILED:UNEXPECTED_ACTION_${result.action}` },
      { status: 502 },
    );
  }

  const responseBody = result as BuyRouteResponse;
  return NextResponse.json(responseBody, { status: toStatusCode(responseBody) });
};

export const POST = withX402(postHandler, buyRouteConfig, x402Server);
