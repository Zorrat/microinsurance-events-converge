import type { ClaimInput, ProtocolResult } from "@/app/lib/protocol-types";

import { fetchEventbriteEvent } from "../eventbrite";
import type { ContractsGateway } from "../evm";
import { emptyMintData, encodeReportBytes } from "../reports";
import { nowSec } from "../utils";

export type ClaimActionDeps = {
  gateway: ContractsGateway;
  eventbriteApiToken: string;
  eventbriteApiBaseUrl: string;
  claimEventbriteApiBaseUrl?: string;
  getNowSec?: () => number;
  fetchEventbriteEventImpl?: typeof fetchEventbriteEvent;
};

export const handleClaim = async (input: ClaimInput, deps: ClaimActionDeps): Promise<ProtocolResult> => {
  try {
    const policyId = BigInt(input.policyId.trim());
    const submittedEventId = input.eventId.trim();
    const policy = await deps.gateway.getPolicy(policyId);

    const canonicalEventId = typeof policy.eventId === "string" ? policy.eventId.trim() : "";
    if (canonicalEventId.length === 0) return { ok: false, error: "POLICY_NOT_FOUND_OR_NOT_MINTED" };
    if (canonicalEventId !== submittedEventId) return { ok: false, error: "EVENT_ID_MISMATCH" };

    if (policy.status === 2) {
      return {
        ok: true,
        action: "CLAIM",
        decision: "PAY",
        note: "Policy already paid. No new settlement transaction submitted.",
        event: { eventId: canonicalEventId },
      };
    }

    if (policy.status === 3) {
      return {
        ok: true,
        action: "CLAIM",
        decision: "RESOLVE_NO_PAYOUT",
        note: "Policy already resolved with no payout. No new settlement transaction submitted.",
        event: { eventId: canonicalEventId },
      };
    }

    if (policy.status !== 1) return { ok: false, error: "POLICY_NOT_ACTIVE" };

    const fetchEventbriteEventImpl = deps.fetchEventbriteEventImpl ?? fetchEventbriteEvent;
    const event = await fetchEventbriteEventImpl(
      canonicalEventId,
      deps.eventbriteApiToken,
      deps.claimEventbriteApiBaseUrl || deps.eventbriteApiBaseUrl,
    );

    const currentTime = deps.getNowSec?.() ?? nowSec();
    const policyCoverageEndSec = Number(policy.coverageEnd);
    const eventOverBoundarySec = event.eventEnd ?? policyCoverageEndSec;

    let decision: "PAY" | "RESOLVE_NO_PAYOUT" | "NO_OP" = "NO_OP";
    if (event.canceled === true) decision = "PAY";
    else if (eventOverBoundarySec !== undefined && currentTime > eventOverBoundarySec) decision = "RESOLVE_NO_PAYOUT";

    if (decision === "NO_OP") {
      return {
        ok: true,
        action: "CLAIM",
        decision,
        note: "No settlement yet.",
        event,
      };
    }

    const reportBytes =
      decision === "PAY"
        ? encodeReportBytes({ action: 1, policyId, mint: emptyMintData() })
        : encodeReportBytes({ action: 2, policyId, mint: emptyMintData() });

    const { txHash } = await deps.gateway.submitReport(reportBytes);
    return {
      ok: true,
      action: "CLAIM",
      decision,
      txHash,
      note: decision === "PAY" ? "Submitted PAY report." : "Submitted RESOLVE_NO_PAYOUT report.",
      event,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "CLAIM_FAILED",
    };
  }
};
