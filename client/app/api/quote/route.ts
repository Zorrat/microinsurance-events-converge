import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";

import type { QuoteWorkflowOk, WorkflowError } from "@/app/lib/cre-types";
import { parseRequestJson, quoteRequestSchema } from "@/app/lib/validation";
import { executeWorkflow } from "@/app/lib/server/cre-client";
import { quoteRouteConfig, x402Server } from "@/app/lib/server/x402";

export const runtime = "nodejs";
export const maxDuration = 300;

type QuoteRouteResponse = QuoteWorkflowOk | WorkflowError;
const toStatusCode = (result: QuoteRouteResponse): number => {
  if (!result.ok && result.error.startsWith("CRE_TRIGGER_FAILED:")) return 502;
  return 200;
};

const postHandler = async (
  request: NextRequest,
): Promise<NextResponse<QuoteRouteResponse>> => {
  const body = await parseRequestJson(request, quoteRequestSchema);
  if (!body.ok) {
    return NextResponse.json({ ok: false, error: body.error }, { status: body.status });
  }

  const result = await executeWorkflow({
    action: "QUOTE_CHECK",
    eventUrl: body.data.eventUrl,
    insured: body.data.insured,
    tier: body.data.tier,
    ...(body.data.nonce ? { nonce: body.data.nonce } : {}),
  });

  if (result.ok && result.action !== "QUOTE_CHECK") {
    return NextResponse.json(
      { ok: false, error: `CRE_TRIGGER_FAILED:UNEXPECTED_ACTION_${result.action}` },
      { status: 502 },
    );
  }

  const responseBody = result as QuoteRouteResponse;
  return NextResponse.json(responseBody, { status: toStatusCode(responseBody) });
};

export const POST = withX402(postHandler, quoteRouteConfig, x402Server);
